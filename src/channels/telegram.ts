import { Bot } from 'grammy';

import { ASSISTANT_NAME, TRIGGER_PATTERN } from '../config.js';
import { getTasksForGroup } from '../db.js';
import { logger } from '../logger.js';
import {
  Channel,
  OnChatMetadata,
  OnInboundMessage,
  RegisteredGroup,
} from '../types.js';

/**
 * Convert Claude's Markdown output to Telegram-safe HTML.
 *
 * Strategy:
 *  1. Extract code blocks / inline code first (protect from further processing).
 *  2. HTML-escape the remaining text.
 *  3. Apply bold / italic / strikethrough / link patterns.
 *  4. Restore code blocks.
 */
function markdownToHtml(md: string): string {
  const blocks: string[] = [];
  const inlines: string[] = [];

  // 1a. Fenced code blocks (``` … ```)
  let text = md.replace(/```(?:[^\n`]*)?\n?([\s\S]*?)```/g, (_, code) => {
    blocks.push(`<pre>${esc(code.replace(/\n$/, ''))}</pre>`);
    return `\x00B${blocks.length - 1}\x00`;
  });

  // 1b. Inline code (` … `)
  text = text.replace(/`([^`\n]+)`/g, (_, code) => {
    inlines.push(`<code>${esc(code)}</code>`);
    return `\x00I${inlines.length - 1}\x00`;
  });

  // 2. HTML-escape non-code text
  text = esc(text);

  // 3. Markdown formatting (order matters: ** before *)
  text = text.replace(/\*\*(.+?)\*\*/gs, '<b>$1</b>');
  text = text.replace(/\*([^*\n]+)\*/g, '<i>$1</i>');
  text = text.replace(/(?<!_)_([^_\n]+)_(?!_)/g, '<i>$1</i>');
  text = text.replace(/~~(.+?)~~/g, '<s>$1</s>');
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // 4. Restore code spans
  text = text.replace(/\x00I(\d+)\x00/g, (_, i) => inlines[+i]);
  text = text.replace(/\x00B(\d+)\x00/g, (_, i) => blocks[+i]);

  return text;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}



export interface TelegramChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
  clearSession: (folder: string) => void;
}

export class TelegramChannel implements Channel {
  name = 'telegram';

  private bot: Bot | null = null;
  private opts: TelegramChannelOpts;
  private botToken: string;

  constructor(botToken: string, opts: TelegramChannelOpts) {
    this.botToken = botToken;
    this.opts = opts;
  }

  async connect(): Promise<void> {
    this.bot = new Bot(this.botToken);

    // Command to get chat ID (useful for registration)
    this.bot.command('chatid', (ctx) => {
      const chatId = ctx.chat.id;
      const chatType = ctx.chat.type;
      const chatName =
        chatType === 'private'
          ? ctx.from?.first_name || 'Private'
          : (ctx.chat as any).title || 'Unknown';

      ctx.reply(
        `Chat ID: \`tg:${chatId}\`\nName: ${chatName}\nType: ${chatType}`,
        { parse_mode: 'Markdown' },
      );
    });

    // Command to check bot status
    this.bot.command('ping', (ctx) => {
      ctx.reply(`${ASSISTANT_NAME} is online.`);
    });

    this.bot.command('start', (ctx) => {
      ctx.reply(`Hi! I'm ${ASSISTANT_NAME}. Send me a message to get started.`);
    });

    this.bot.command('help', (ctx) => {
      ctx.reply(
        `Commands:\n` +
        `/start - Start a conversation\n` +
        `/help - Show this help\n` +
        `/tasks - List scheduled tasks\n` +
        `/reset - Reset conversation memory\n` +
        `/ping - Check bot status\n` +
        `/chatid - Get this chat's registration ID`,
      );
    });

    this.bot.command('tasks', (ctx) => {
      const chatJid = `tg:${ctx.chat.id}`;
      const group = this.opts.registeredGroups()[chatJid];
      if (!group) {
        ctx.reply('This chat is not registered.');
        return;
      }
      const tasks = getTasksForGroup(group.folder);
      const active = tasks.filter((t) => t.status === 'active');
      if (active.length === 0) {
        ctx.reply('No scheduled tasks.');
        return;
      }
      const lines = active.map((t, i) => {
        const schedule =
          t.schedule_type === 'cron'
            ? `cron: ${t.schedule_value}`
            : t.schedule_type === 'interval'
              ? `every ${t.schedule_value}`
              : `once: ${t.next_run ?? 'pending'}`;
        const next = t.next_run ? `\n  next: ${t.next_run}` : '';
        return `${i + 1}. ${t.prompt.slice(0, 60)}${t.prompt.length > 60 ? '…' : ''}\n  ${schedule}${next}`;
      });
      ctx.reply(`Scheduled tasks (${active.length}):\n\n${lines.join('\n\n')}`);
    });

    this.bot.command('reset', (ctx) => {
      const chatJid = `tg:${ctx.chat.id}`;
      const group = this.opts.registeredGroups()[chatJid];
      if (!group) {
        ctx.reply('This chat is not registered.');
        return;
      }
      this.opts.clearSession(group.folder);
      ctx.reply('Conversation memory cleared. Next message starts a fresh session.');
    });

    this.bot.on('message:text', async (ctx) => {
      // Skip commands
      if (ctx.message.text.startsWith('/')) return;

      const chatJid = `tg:${ctx.chat.id}`;
      let content = ctx.message.text;
      const timestamp = new Date(ctx.message.date * 1000).toISOString();
      const senderName =
        ctx.from?.first_name ||
        ctx.from?.username ||
        ctx.from?.id.toString() ||
        'Unknown';
      const sender = ctx.from?.id.toString() || '';
      const msgId = ctx.message.message_id.toString();

      // Determine chat name
      const chatName =
        ctx.chat.type === 'private'
          ? senderName
          : (ctx.chat as any).title || chatJid;

      // Translate Telegram @bot_username mentions into TRIGGER_PATTERN format.
      // Telegram @mentions (e.g., @andy_ai_bot) won't match TRIGGER_PATTERN
      // (e.g., ^@Andy\b), so we prepend the trigger when the bot is @mentioned.
      const botUsername = ctx.me?.username?.toLowerCase();
      if (botUsername) {
        const entities = ctx.message.entities || [];
        const isBotMentioned = entities.some((entity) => {
          if (entity.type === 'mention') {
            const mentionText = content
              .substring(entity.offset, entity.offset + entity.length)
              .toLowerCase();
            return mentionText === `@${botUsername}`;
          }
          return false;
        });
        if (isBotMentioned && !TRIGGER_PATTERN.test(content)) {
          content = `@${ASSISTANT_NAME} ${content}`;
        }
      }

      // Store chat metadata for discovery
      const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
      this.opts.onChatMetadata(chatJid, timestamp, chatName, 'telegram', isGroup);

      // Only deliver full message for registered groups
      const group = this.opts.registeredGroups()[chatJid];
      if (!group) {
        logger.debug(
          { chatJid, chatName },
          'Message from unregistered Telegram chat',
        );
        return;
      }

      // Deliver message — startMessageLoop() will pick it up
      this.opts.onMessage(chatJid, {
        id: msgId,
        chat_jid: chatJid,
        sender,
        sender_name: senderName,
        content,
        timestamp,
        is_from_me: false,
      });

      logger.info(
        { chatJid, chatName, sender: senderName },
        'Telegram message stored',
      );
    });

    // Handle non-text messages with placeholders so the agent knows something was sent
    const storeNonText = (ctx: any, placeholder: string) => {
      const chatJid = `tg:${ctx.chat.id}`;
      const group = this.opts.registeredGroups()[chatJid];
      if (!group) return;

      const timestamp = new Date(ctx.message.date * 1000).toISOString();
      const senderName =
        ctx.from?.first_name ||
        ctx.from?.username ||
        ctx.from?.id?.toString() ||
        'Unknown';
      const caption = ctx.message.caption ? ` ${ctx.message.caption}` : '';

      const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
      this.opts.onChatMetadata(chatJid, timestamp, undefined, 'telegram', isGroup);
      this.opts.onMessage(chatJid, {
        id: ctx.message.message_id.toString(),
        chat_jid: chatJid,
        sender: ctx.from?.id?.toString() || '',
        sender_name: senderName,
        content: `${placeholder}${caption}`,
        timestamp,
        is_from_me: false,
      });
    };

    this.bot.on('message:photo', (ctx) => storeNonText(ctx, '[Photo]'));
    this.bot.on('message:video', (ctx) => storeNonText(ctx, '[Video]'));
    this.bot.on('message:voice', (ctx) =>
      storeNonText(ctx, '[Voice message]'),
    );
    this.bot.on('message:audio', (ctx) => storeNonText(ctx, '[Audio]'));
    this.bot.on('message:document', (ctx) => {
      const name = ctx.message.document?.file_name || 'file';
      storeNonText(ctx, `[Document: ${name}]`);
    });
    this.bot.on('message:sticker', (ctx) => {
      const emoji = ctx.message.sticker?.emoji || '';
      storeNonText(ctx, `[Sticker ${emoji}]`);
    });
    this.bot.on('message:location', (ctx) => storeNonText(ctx, '[Location]'));
    this.bot.on('message:contact', (ctx) => storeNonText(ctx, '[Contact]'));

    // Handle errors gracefully
    this.bot.catch((err) => {
      logger.error({ err: err.message }, 'Telegram bot error');
    });

    // Start polling — returns a Promise that resolves when started
    return new Promise<void>((resolve) => {
      this.bot!.start({
        onStart: (botInfo) => {
          logger.info(
            { username: botInfo.username, id: botInfo.id },
            'Telegram bot connected',
          );
          console.log(`\n  Telegram bot: @${botInfo.username}`);
          console.log(
            `  Send /chatid to the bot to get a chat's registration ID\n`,
          );
          resolve();
        },
      });
    });
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this.bot) {
      logger.warn('Telegram bot not initialized');
      return;
    }

    const numericId = jid.replace(/^tg:/, '');
    const html = markdownToHtml(text);

    // Telegram has a 4096 character limit per message — split if needed
    const MAX_LENGTH = 4096;
    const chunks: string[] = [];
    for (let i = 0; i < html.length; i += MAX_LENGTH) {
      chunks.push(html.slice(i, i + MAX_LENGTH));
    }

    try {
      for (const chunk of chunks) {
        await this.bot.api.sendMessage(numericId, chunk, { parse_mode: 'HTML' });
      }
      logger.info({ jid, length: text.length }, 'Telegram message sent');
    } catch (htmlErr) {
      // HTML parse error — fall back to plain text
      logger.warn({ jid, err: htmlErr }, 'HTML send failed, retrying as plain text');
      try {
        for (let i = 0; i < text.length; i += MAX_LENGTH) {
          await this.bot.api.sendMessage(numericId, text.slice(i, i + MAX_LENGTH));
        }
        logger.info({ jid, length: text.length }, 'Telegram message sent (plain text fallback)');
      } catch (err) {
        logger.error({ jid, err }, 'Failed to send Telegram message');
      }
    }
  }

  isConnected(): boolean {
    return this.bot !== null;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('tg:');
  }

  async disconnect(): Promise<void> {
    if (this.bot) {
      this.bot.stop();
      this.bot = null;
      logger.info('Telegram bot stopped');
    }
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    if (!this.bot || !isTyping) return;
    try {
      const numericId = jid.replace(/^tg:/, '');
      await this.bot.api.sendChatAction(numericId, 'typing');
    } catch (err) {
      logger.debug({ jid, err }, 'Failed to send Telegram typing indicator');
    }
  }
}
