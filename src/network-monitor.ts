import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from './logger.js';

const execAsync = promisify(exec);

interface NetworkStatus {
  isConnected: boolean;
  wifiConnected: boolean;
  wifiSSID: string | null;
  lastCheck: Date;
  consecutiveFailures: number;
}

const status: NetworkStatus = {
  isConnected: true,
  wifiConnected: false,
  wifiSSID: null,
  lastCheck: new Date(),
  consecutiveFailures: 0,
};

const CHECK_INTERVAL = 5 * 60 * 1000; // 5分钟检查一次
const MAX_FAILURES_BEFORE_ACTION = 2; // 连续失败2次后采取行动
const TEST_HOSTS = ['api.telegram.org', '8.8.8.8', '1.1.1.1'];

async function checkWifiStatus(): Promise<{
  connected: boolean;
  ssid: string | null;
}> {
  try {
    // 先检查是否有 WiFi 接口
    const { stdout: portsOutput } = await execAsync(
      '/usr/sbin/networksetup -listallhardwareports | grep -A 1 "Wi-Fi"',
      { timeout: 5000 },
    );

    if (!portsOutput || portsOutput.trim().length === 0) {
      return await checkEthernetStatus();
    }

    const deviceMatch = portsOutput.match(/Device: (\w+)/);
    if (!deviceMatch) {
      return await checkEthernetStatus();
    }

    const wifiDevice = deviceMatch[1];

    // 检查 WiFi 连接状态
    const { stdout } = await execAsync(
      `/usr/sbin/networksetup -getairportnetwork ${wifiDevice}`,
      { timeout: 5000 },
    );

    if (stdout.includes('You are not associated with an AirPort network')) {
      // WiFi 未连接，检查该接口是否作为以太网活动
      const ethStatus = await checkSpecificInterface(wifiDevice);
      if (ethStatus.connected) {
        return ethStatus;
      }
      return await checkEthernetStatus();
    }

    const ssidMatch = stdout.match(/Current Wi-Fi Network: (.+)/);
    if (ssidMatch) {
      const ssid = ssidMatch[1].trim();
      return { connected: true, ssid };
    }

    return await checkEthernetStatus();
  } catch (err) {
    logger.debug({ err }, 'WiFi 状态检查失败，尝试检查以太网');
    return await checkEthernetStatus();
  }
}

async function checkSpecificInterface(
  interfaceName: string,
): Promise<{ connected: boolean; ssid: string | null }> {
  try {
    const { stdout } = await execAsync(
      `/sbin/ifconfig ${interfaceName} | grep "status:"`,
      { timeout: 5000 },
    );

    if (stdout && stdout.includes('active')) {
      return { connected: true, ssid: interfaceName };
    }

    return { connected: false, ssid: null };
  } catch (err) {
    return { connected: false, ssid: null };
  }
}

async function checkEthernetStatus(): Promise<{
  connected: boolean;
  ssid: string | null;
}> {
  try {
    // 直接检查常见的以太网接口
    for (const iface of ['en0', 'en1', 'en2', 'en3']) {
      try {
        const { stdout } = await execAsync(
          `/sbin/ifconfig ${iface} 2>/dev/null | grep "status:"`,
          { timeout: 3000 },
        );

        if (stdout && stdout.includes('active')) {
          return { connected: true, ssid: iface };
        }
      } catch (err: any) {
        // 接口不存在，继续检查下一个
      }
    }

    return { connected: false, ssid: null };
  } catch (err) {
    return { connected: false, ssid: null };
  }
}

async function reconnectWifi(): Promise<boolean> {
  try {
    logger.warn('尝试重新连接网络...');

    // 检查是否有 WiFi 接口
    const { stdout: portsOutput } = await execAsync(
      '/usr/sbin/networksetup -listallhardwareports | grep -A 1 "Wi-Fi"',
      { timeout: 5000 },
    ).catch(() => ({ stdout: '' }));

    const deviceMatch = portsOutput.match(/Device: (\w+)/);

    if (deviceMatch) {
      const wifiDevice = deviceMatch[1];

      // 关闭 WiFi
      await execAsync(
        `/usr/sbin/networksetup -setairportpower ${wifiDevice} off`,
        { timeout: 5000 },
      );
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // 打开 WiFi
      await execAsync(
        `/usr/sbin/networksetup -setairportpower ${wifiDevice} on`,
        { timeout: 5000 },
      );
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // 检查是否重新连接成功
      const wifiStatus = await checkWifiStatus();
      if (wifiStatus.connected) {
        logger.info({ ssid: wifiStatus.ssid }, '网络重新连接成功');
        return true;
      }
    } else {
      // 没有 WiFi，尝试重启以太网接口
      logger.warn('未找到 WiFi 接口，尝试重启以太网');
      await execAsync(
        'sudo /sbin/ifconfig en0 down && sudo /sbin/ifconfig en0 up',
        { timeout: 10000 },
      ).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 5000));

      const ethStatus = await checkEthernetStatus();
      if (ethStatus.connected) {
        logger.info('以太网重新连接成功');
        return true;
      }
    }

    logger.warn('网络重新连接失败');
    return false;
  } catch (err) {
    logger.error({ err }, '网络重新连接操作失败');
    return false;
  }
}

async function testConnection(): Promise<boolean> {
  // 测试多个主机，只要有一个能连接就认为网络正常
  for (const host of TEST_HOSTS) {
    try {
      const { stdout } = await execAsync(
        `curl -s --connect-timeout 5 --max-time 10 https://${host} || curl -s --connect-timeout 5 --max-time 10 http://${host}`,
        { timeout: 15000 },
      );
      if (stdout || stdout === '') {
        return true;
      }
    } catch {
      // 继续测试下一个主机
    }
  }
  return false;
}

async function wakeNetwork(): Promise<void> {
  logger.warn('尝试唤醒网络连接...');

  try {
    // 1. 检查网络接口状态（WiFi 或以太网）
    const networkStatus = await checkWifiStatus();
    if (!networkStatus.connected) {
      logger.warn('网络接口未连接，尝试重新连接');
      const reconnected = await reconnectWifi();
      if (reconnected) {
        return; // 网络重连成功，直接返回
      }
    }

    // 2. 尝试ping网关
    await execAsync(
      "route -n get default | grep gateway | awk '{print $2}' | xargs ping -c 1",
      {
        timeout: 5000,
      },
    ).catch(() => {});

    // 3. 尝试DNS查询
    await execAsync('nslookup google.com', { timeout: 5000 }).catch(() => {});

    // 4. 尝试HTTP请求
    await execAsync(
      'curl -s --connect-timeout 3 --max-time 5 http://www.google.com > /dev/null',
      {
        timeout: 8000,
      },
    ).catch(() => {});

    logger.info('网络唤醒操作已执行');
  } catch (err) {
    logger.error({ err }, '网络唤醒失败');
  }
}

async function checkNetwork(): Promise<void> {
  // 检查网络接口状态
  const wifiStatus = await checkWifiStatus();
  status.wifiConnected = wifiStatus.connected;
  status.wifiSSID = wifiStatus.ssid;

  // 检查网络连接
  const isConnected = await testConnection();
  status.lastCheck = new Date();

  // 首次检查或状态变化时记录
  const isFirstCheck = status.consecutiveFailures === 0 && status.isConnected;

  if (!isConnected) {
    status.consecutiveFailures++;
    logger.warn(
      {
        consecutiveFailures: status.consecutiveFailures,
        wifiConnected: status.wifiConnected,
        wifiSSID: status.wifiSSID,
      },
      '网络连接检测失败',
    );

    if (status.consecutiveFailures >= MAX_FAILURES_BEFORE_ACTION) {
      await wakeNetwork();

      // 等待5秒后重新测试
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const recoveredIsConnected = await testConnection();
      const recoveredWifiStatus = await checkWifiStatus();

      if (recoveredIsConnected) {
        logger.info({ wifiSSID: recoveredWifiStatus.ssid }, '网络已恢复');
        status.isConnected = true;
        status.wifiConnected = recoveredWifiStatus.connected;
        status.wifiSSID = recoveredWifiStatus.ssid;
        status.consecutiveFailures = 0;
      } else {
        logger.error('网络唤醒后仍无法连接');
        status.isConnected = false;
      }
    } else {
      status.isConnected = false;
    }
  } else {
    if (!status.isConnected || status.consecutiveFailures > 0) {
      logger.info({ wifiSSID: status.wifiSSID }, '网络连接已恢复正常');
    }
    status.isConnected = true;
    status.consecutiveFailures = 0;
  }
}

export function startNetworkMonitor(): void {
  logger.info('启动网络监控');

  // 立即执行一次检查
  checkNetwork()
    .then(() => {
      logger.info(
        {
          interface: status.wifiSSID,
          connected: status.isConnected,
        },
        '网络状态初始检查完成',
      );
    })
    .catch((err) => {
      logger.error({ err }, '网络检查失败');
    });

  // 定期检查
  setInterval(() => {
    checkNetwork().catch((err) => {
      logger.error({ err }, '网络检查失败');
    });
  }, CHECK_INTERVAL);
}

export function getNetworkStatus(): NetworkStatus {
  return { ...status };
}
