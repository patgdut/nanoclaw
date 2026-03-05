/**
 * bb-browser daemon lifecycle management.
 * Starts the daemon when NanoClaw starts, stops it on shutdown.
 * Monitors extension connection and auto-launches Chrome if needed.
 */
import { ChildProcess, spawn, exec } from 'child_process';
import { existsSync } from 'fs';
import { platform } from 'os';
import { logger } from './logger.js';

const DAEMON_JS = '/Users/pat/Documents/GitHub/bb-browser/dist/daemon.js';
const DAEMON_PORT = 19824;
const HEALTH_CHECK_INTERVAL = 30000; // 30 seconds
const CHROME_LAUNCH_COOLDOWN = 60000; // 1 minute

let daemonProcess: ChildProcess | null = null;
let healthCheckTimer: NodeJS.Timeout | null = null;
let lastChromeLaunch = 0;

/**
 * Check daemon status via HTTP
 */
async function checkDaemonStatus(): Promise<{
  running: boolean;
  extensionConnected: boolean;
}> {
  try {
    const response = await fetch(`http://127.0.0.1:${DAEMON_PORT}/status`);
    if (!response.ok) {
      return { running: false, extensionConnected: false };
    }
    const data = (await response.json()) as {
      running?: boolean;
      extensionConnected?: boolean;
    };
    return {
      running: data.running ?? false,
      extensionConnected: data.extensionConnected ?? false,
    };
  } catch {
    return { running: false, extensionConnected: false };
  }
}

/**
 * Launch Chrome browser
 */
function launchChrome(): void {
  const now = Date.now();
  if (now - lastChromeLaunch < CHROME_LAUNCH_COOLDOWN) {
    logger.debug('Chrome launch cooldown active, skipping');
    return;
  }

  lastChromeLaunch = now;
  logger.info('Launching Chrome browser');

  const os = platform();
  let command: string;

  if (os === 'darwin') {
    // macOS
    command = 'open -a "Google Chrome"';
  } else if (os === 'linux') {
    // Linux - try common Chrome executables
    command =
      'google-chrome || google-chrome-stable || chromium-browser || chromium';
  } else if (os === 'win32') {
    // Windows
    command = 'start chrome';
  } else {
    logger.warn({ os }, 'Unsupported OS for Chrome auto-launch');
    return;
  }

  exec(command, (error) => {
    if (error) {
      logger.warn({ error: error.message }, 'Failed to launch Chrome');
    } else {
      logger.info('Chrome launched successfully');
    }
  });
}

/**
 * Health check loop
 */
async function healthCheck(): Promise<void> {
  const status = await checkDaemonStatus();

  if (!status.running) {
    logger.warn('bb-browser daemon not responding');
    return;
  }

  if (!status.extensionConnected) {
    logger.info('bb-browser extension not connected, launching Chrome');
    launchChrome();
  }
}

/**
 * Start health check monitoring
 */
function startHealthCheck(): void {
  if (healthCheckTimer) return;

  // Initial check after 10 seconds
  setTimeout(() => {
    healthCheck();
  }, 10000);

  // Periodic checks
  healthCheckTimer = setInterval(() => {
    healthCheck();
  }, HEALTH_CHECK_INTERVAL);
}

/**
 * Stop health check monitoring
 */
function stopHealthCheck(): void {
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer);
    healthCheckTimer = null;
  }
}

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
    stopHealthCheck();
  });

  // Start health monitoring
  startHealthCheck();
}

export function stopBbBrowserDaemon(): void {
  stopHealthCheck();

  if (!daemonProcess) return;
  logger.info('Stopping bb-browser daemon');
  daemonProcess.kill('SIGTERM');
  daemonProcess = null;
}
