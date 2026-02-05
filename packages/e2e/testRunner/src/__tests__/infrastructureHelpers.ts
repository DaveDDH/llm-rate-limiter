/**
 * Shared infrastructure helpers for self-contained e2e tests.
 * Each test boots its own instances and proxy, requiring only Redis to be running.
 */
import { bootInstance, cleanRedis, killAllInstances } from '../instanceLifecycle.js';
import { bootProxy, killProxy } from '../proxyLifecycle.js';
import type { ConfigPresetName } from '../resetInstance.js';

export const PROXY_PORT = 3000;
export const INSTANCE_PORT_1 = 3001;
export const INSTANCE_PORT_2 = 3002;
export const PROXY_URL = `http://localhost:${PROXY_PORT}`;
export const INSTANCE_URLS = [`http://localhost:${INSTANCE_PORT_1}`, `http://localhost:${INSTANCE_PORT_2}`];
export const BEFORE_ALL_TIMEOUT_MS = 60000;
export const AFTER_ALL_TIMEOUT_MS = 30000;

/**
 * Boot all infrastructure: clean Redis, start instances, start proxy.
 */
export const bootInfrastructure = async (configPreset: ConfigPresetName = 'default'): Promise<void> => {
  await cleanRedis();
  await bootInstance(INSTANCE_PORT_1, configPreset);
  await bootInstance(INSTANCE_PORT_2, configPreset);
  await bootProxy([INSTANCE_PORT_1, INSTANCE_PORT_2], PROXY_PORT);
};

/**
 * Tear down all infrastructure: kill proxy, kill instances.
 * Ignores errors if components weren't started.
 */
export const teardownInfrastructure = async (): Promise<void> => {
  try {
    await killProxy();
  } catch {
    // Proxy may not have started
  }
  try {
    await killAllInstances();
  } catch {
    // Instances may not have started
  }
};
