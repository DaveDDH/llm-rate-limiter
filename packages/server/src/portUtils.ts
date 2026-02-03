/**
 * Utility functions for port availability checking.
 */
import { createServer, type Server } from 'node:net';
import { once } from 'node:events';

const attemptListen = async (server: Server, port: number): Promise<boolean> => {
  try {
    server.listen(port);
    await once(server, 'listening');
    server.close();
    await once(server, 'close');
    return true;
  } catch {
    return false;
  }
};

/**
 * Check if a port is available.
 * @param port - The port number to check
 * @returns Promise resolving to true if port is available, false otherwise
 */
export const isPortAvailable = async (port: number): Promise<boolean> => {
  const server = createServer();
  return await attemptListen(server, port);
};

/**
 * Find an available port from the given list.
 * @param ports - Array of ports to try in order
 * @returns Promise resolving to the first available port
 * @throws Error if no ports are available
 */
export const findAvailablePort = async (ports: number[]): Promise<number> => {
  const results = await Promise.all(
    ports.map(async (port) => ({
      port,
      available: await isPortAvailable(port),
    }))
  );

  const available = results.find((r) => r.available);
  if (available !== undefined) {
    return available.port;
  }

  throw new Error(`No available ports found. Tried: ${ports.join(', ')}`);
};
