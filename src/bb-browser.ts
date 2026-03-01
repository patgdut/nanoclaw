/**
 * bb-browser daemon lifecycle management.
 * Starts the daemon when NanoClaw starts, stops it on shutdown.
 */
import { ChildProcess, spawn } from 'child_process';
import { existsSync } from 'fs';
import { logger } from './logger.js';

const DAEMON_JS = '/Users/pat/Documents/GitHub/bb-browser/dist/daemon.js';

let daemonProcess: ChildProcess | null = null;

export function startBbBrowserDaemon(): void {
  if (!existsSync(DAEMON_JS)) {
    logger.warn({ path: DAEMON_JS }, 'bb-browser daemon not found, skipping');
    return;
  }

  logger.info('Starting bb-browser daemon');
  daemonProcess = spawn(process.execPath, [DAEMON_JS, '--host', '0.0.0.0'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  daemonProcess.stdout?.on('data', (d) =>
    logger.debug({ source: 'bb-browser' }, d.toString().trim()),
  );
  daemonProcess.stderr?.on('data', (d) =>
    logger.debug({ source: 'bb-browser' }, d.toString().trim()),
  );

  daemonProcess.on('exit', (code, signal) => {
    logger.info({ code, signal }, 'bb-browser daemon exited');
    daemonProcess = null;
  });
}

export function stopBbBrowserDaemon(): void {
  if (!daemonProcess) return;
  logger.info('Stopping bb-browser daemon');
  daemonProcess.kill('SIGTERM');
  daemonProcess = null;
}
