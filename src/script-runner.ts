/**
 * Lightweight script runner for direct command execution in containers
 * Used for menu commands that don't need full agent sessions
 */
import { spawn } from 'child_process';

import { CONTAINER_IMAGE, TIMEZONE } from './config.js';
import { logger } from './logger.js';
import { CONTAINER_RUNTIME_BIN } from './container-runtime.js';

export interface ScriptRunnerOptions {
  /** Command (binary name or full path) to run inside the container */
  script: string;
  args?: string[];
  timeout?: number;
}

/**
 * Run a command in a lightweight container without full agent setup.
 * Overrides the default entrypoint so the command runs directly.
 * The container image already has bb-browser and all skills installed.
 */
export async function runScript(
  options: ScriptRunnerOptions,
): Promise<{ success: boolean; output: string; error?: string }> {
  const { script, args = [], timeout = 30000 } = options;

  const containerName = `nanoclaw-script-${Date.now()}`;
  const containerArgs = [
    'run',
    '--rm',
    '--name',
    containerName,
    '-e',
    `TZ=${TIMEZONE}`,
    // Override entrypoint so the command runs directly (not via agent entrypoint.sh)
    '--entrypoint',
    'bash',
    CONTAINER_IMAGE,
    '-c',
    `${script} ${args.join(' ')}`,
  ];

  logger.debug(
    { script, args, containerName },
    'Running script in lightweight container',
  );

  return new Promise((resolve) => {
    const container = spawn(CONTAINER_RUNTIME_BIN, containerArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      container.kill('SIGTERM');
      setTimeout(() => {
        if (!container.killed) {
          container.kill('SIGKILL');
        }
      }, 5000);
    }, timeout);

    container.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    container.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    container.on('close', (code) => {
      clearTimeout(timeoutHandle);

      if (timedOut) {
        logger.warn({ script, containerName }, 'Script execution timed out');
        resolve({
          success: false,
          output: stdout,
          error: `Script timed out after ${timeout}ms`,
        });
        return;
      }

      if (code !== 0) {
        logger.warn(
          { script, code, stderr: stderr.slice(-200) },
          'Script execution failed',
        );
        resolve({
          success: false,
          output: stdout,
          error: stderr || `Script exited with code ${code}`,
        });
        return;
      }

      logger.info({ script, outputLength: stdout.length }, 'Script completed');
      resolve({
        success: true,
        output: stdout,
      });
    });

    container.on('error', (err) => {
      clearTimeout(timeoutHandle);
      logger.error({ script, error: err }, 'Script spawn error');
      resolve({
        success: false,
        output: '',
        error: `Failed to spawn container: ${err.message}`,
      });
    });
  });
}
