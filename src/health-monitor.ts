import { logger } from './logger.js';
import { getAllRegisteredGroups, getLatestIncomingMessage } from './db.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface HealthCheckConfig {
  // 消息在队列中超过这个时间未处理，视为卡住（毫秒）
  messageStuckThreshold: number;
  // 检查间隔（毫秒）
  checkInterval: number;
  // 容器空闲超过这个时间还在运行，视为卡住（毫秒）
  containerIdleThreshold: number;
}

const DEFAULT_CONFIG: HealthCheckConfig = {
  messageStuckThreshold: 5 * 60 * 1000, // 5分钟
  checkInterval: 60 * 1000, // 每分钟检查一次
  containerIdleThreshold: 35 * 60 * 1000, // 35分钟（超过30分钟空闲超时+5分钟缓冲）
};

export class HealthMonitor {
  private config: HealthCheckConfig;
  private intervalId: NodeJS.Timeout | null = null;
  private lastProcessedTime: Map<string, number> = new Map();
  private containerStartTimes: Map<string, number> = new Map();

  constructor(config: Partial<HealthCheckConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  start(): void {
    if (this.intervalId) {
      logger.warn('Health monitor already running');
      return;
    }

    logger.info(
      {
        messageStuckThreshold: this.config.messageStuckThreshold,
        checkInterval: this.config.checkInterval,
      },
      'Health monitor started',
    );

    this.intervalId = setInterval(() => {
      this.performHealthCheck().catch((err) => {
        logger.error({ err }, 'Health check failed');
      });
    }, this.config.checkInterval);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('Health monitor stopped');
    }
  }

  recordMessageProcessing(groupFolder: string): void {
    this.lastProcessedTime.set(groupFolder, Date.now());
  }

  recordContainerStart(containerName: string): void {
    this.containerStartTimes.set(containerName, Date.now());
  }

  recordContainerStop(containerName: string): void {
    this.containerStartTimes.delete(containerName);
  }

  private async performHealthCheck(): Promise<void> {
    await this.checkStuckMessages();
    await this.checkIdleContainers();
  }

  private async checkStuckMessages(): Promise<void> {
    try {
      const groups = getAllRegisteredGroups();
      const now = Date.now();

      for (const [jid, group] of Object.entries(groups)) {
        const latestMessage = getLatestIncomingMessage(jid);
        if (!latestMessage) continue;

        const messageTime = new Date(latestMessage.timestamp).getTime();
        const lastProcessed = this.lastProcessedTime.get(group.folder) || 0;

        if (
          messageTime > lastProcessed &&
          now - messageTime > this.config.messageStuckThreshold
        ) {
          logger.warn(
            {
              group: group.folder,
              messageAge: now - messageTime,
              threshold: this.config.messageStuckThreshold,
            },
            'Detected stuck messages, attempting recovery',
          );

          await this.recoverStuckMessages(group.folder);
        }
      }
    } catch (err) {
      logger.error({ err }, 'Failed to check stuck messages');
    }
  }

  private async checkIdleContainers(): Promise<void> {
    try {
      // 获取所有运行中的 nanoclaw 容器
      const { stdout } = await execAsync(
        'docker ps --filter "name=nanoclaw-" --format "{{.Names}},{{.RunningFor}}"',
      );

      const containers = stdout
        .trim()
        .split('\n')
        .filter((line) => line);

      for (const line of containers) {
        const [name] = line.split(',');
        const startTime = this.containerStartTimes.get(name);

        if (startTime) {
          const runningTime = Date.now() - startTime;

          if (runningTime > this.config.containerIdleThreshold) {
            logger.warn(
              {
                container: name,
                runningTime,
                threshold: this.config.containerIdleThreshold,
              },
              'Detected idle container, stopping it',
            );

            await this.stopIdleContainer(name);
          }
        }
      }
    } catch (err) {
      // Docker 命令可能失败（比如没有运行的容器），这是正常的
      if (err instanceof Error && !err.message.includes('No such container')) {
        logger.debug({ err }, 'Failed to check idle containers');
      }
    }
  }

  private async recoverStuckMessages(groupFolder: string): Promise<void> {
    try {
      // 尝试停止该群组可能卡住的容器
      const containerName = `nanoclaw-${groupFolder}`;
      await execAsync(`docker stop ${containerName}`).catch(() => {
        // 容器可能不存在，忽略错误
      });

      logger.info({ group: groupFolder }, 'Stopped stuck container');

      // 更新最后处理时间，避免重复恢复
      this.lastProcessedTime.set(groupFolder, Date.now());
    } catch (err) {
      logger.error(
        { err, group: groupFolder },
        'Failed to recover stuck messages',
      );
    }
  }

  private async stopIdleContainer(containerName: string): Promise<void> {
    try {
      await execAsync(`docker stop ${containerName}`);
      this.containerStartTimes.delete(containerName);
      logger.info({ container: containerName }, 'Stopped idle container');
    } catch (err) {
      logger.error(
        { err, container: containerName },
        'Failed to stop idle container',
      );
    }
  }
}

// 单例实例
let healthMonitor: HealthMonitor | null = null;

export function getHealthMonitor(
  config?: Partial<HealthCheckConfig>,
): HealthMonitor {
  if (!healthMonitor) {
    healthMonitor = new HealthMonitor(config);
  }
  return healthMonitor;
}
