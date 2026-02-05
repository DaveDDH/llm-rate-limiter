import 'dotenv/config';
import { createServer, request as httpRequest } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';

const PROXY_PORT = 3000;
const TARGET_HOST = 'localhost';
const HTTP_BAD_GATEWAY = 502;
const HTTP_INTERNAL_ERROR = 500;
const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const FIRST_INDEX = 0;
const SECOND_INDEX = 1;
const DEFAULT_RATIO_VALUE = 1;
const DEFAULT_PORT_1 = 3001;
const DEFAULT_PORT_2 = 3002;
const MIN_LENGTH = 0;

/** Get environment variable value */
const getEnvVar = (key: string): string | undefined => process.env[key];

/**
 * Parse target ports from environment variable or use defaults.
 * Set TARGET_PORTS env var to customize, e.g., "3001" for single instance
 * or "3001,3002" for two instances.
 */
const parseTargetPorts = (): number[] => {
  const envPorts = getEnvVar('TARGET_PORTS');
  if (envPorts !== undefined && envPorts.length > MIN_LENGTH) {
    return envPorts.split(',').map((p) => parseInt(p.trim(), 10));
  }
  // Default: both instances
  return [DEFAULT_PORT_1, DEFAULT_PORT_2];
};

/**
 * Parse target ratio from environment variable.
 * Set TARGET_RATIO env var to customize distribution, e.g., "26:25" for 26 jobs to first instance, 25 to second.
 * If not set, uses equal distribution (1:1:1:... for N instances).
 */
const parseTargetRatio = (portCount: number): number[] => {
  const envRatio = getEnvVar('TARGET_RATIO');
  if (envRatio !== undefined && envRatio.length > MIN_LENGTH) {
    const ratios = envRatio.split(':').map((r) => parseInt(r.trim(), 10));
    if (ratios.length === portCount && ratios.every((r) => !isNaN(r) && r > MIN_LENGTH)) {
      return ratios;
    }
    // Invalid ratio, fall back to equal distribution
  }
  // Default: equal distribution
  return Array.from({ length: portCount }, () => DEFAULT_RATIO_VALUE);
};

const TARGET_PORTS: readonly number[] = parseTargetPorts();
let currentRatio: number[] = parseTargetRatio(TARGET_PORTS.length);

const log = (message: string): void => {
  process.stdout.write(`${message}\n`);
};

const logError = (message: string): void => {
  process.stderr.write(`${message}\n`);
};

const DEFAULT_PORT = DEFAULT_PORT_1;
const INITIAL_JOB_COUNT = 0;

/** Track job counts per instance for ratio-based distribution */
const jobCounts: number[] = Array.from({ length: TARGET_PORTS.length }, () => INITIAL_JOB_COUNT);

/** Calculate total ratio sum */
const getRatioSum = (): number => currentRatio.reduce((sum, r) => sum + r, INITIAL_JOB_COUNT);

/** Calculate deficit for a given index */
const calculateDeficit = (index: number, totalJobs: number, ratioSum: number): number => {
  const targetShare = (currentRatio[index] ?? DEFAULT_RATIO_VALUE) / ratioSum;
  const expectedJobs = totalJobs * targetShare;
  const actualJobs = jobCounts[index] ?? INITIAL_JOB_COUNT;
  return expectedJobs - actualJobs;
};

/** Find the index with the best (largest) deficit */
const findBestDeficitIndex = (totalJobs: number, ratioSum: number): number => {
  let bestIndex = FIRST_INDEX;
  let bestDeficit = -Infinity;

  for (let i = FIRST_INDEX; i < TARGET_PORTS.length; i += SECOND_INDEX) {
    const deficit = calculateDeficit(i, totalJobs, ratioSum);

    if (deficit > bestDeficit) {
      bestDeficit = deficit;
      bestIndex = i;
    }
  }

  return bestIndex;
};

/**
 * Get the next target port based on ratio distribution.
 * Uses deficit-based selection: sends to the instance that is furthest below its target ratio.
 */
const getNextTargetPort = (): number => {
  if (TARGET_PORTS.length === FIRST_INDEX) {
    return DEFAULT_PORT;
  }
  if (TARGET_PORTS.length === SECOND_INDEX) {
    return TARGET_PORTS[FIRST_INDEX] ?? DEFAULT_PORT;
  }

  const totalJobs = jobCounts.reduce((sum, c) => sum + c, INITIAL_JOB_COUNT);
  const ratioSum = getRatioSum();

  const bestIndex = findBestDeficitIndex(totalJobs, ratioSum);

  // Increment the count for the selected instance
  jobCounts[bestIndex] = (jobCounts[bestIndex] ?? INITIAL_JOB_COUNT) + SECOND_INDEX;

  return TARGET_PORTS[bestIndex] ?? DEFAULT_PORT;
};

/** Reset job counts (can be called via API endpoint) */
const resetJobCounts = (): void => {
  for (let i = FIRST_INDEX; i < jobCounts.length; i += SECOND_INDEX) {
    jobCounts[i] = INITIAL_JOB_COUNT;
  }
};

/** Set the distribution ratio */
const setRatio = (ratioStr: string): boolean => {
  const ratios = ratioStr.split(':').map((r) => parseInt(r.trim(), 10));
  if (ratios.length === TARGET_PORTS.length && ratios.every((r) => !isNaN(r) && r > MIN_LENGTH)) {
    currentRatio = ratios;
    return true;
  }
  return false;
};

/** Type guard to check if value is a Buffer */
const isBuffer = (value: unknown): value is Buffer => Buffer.isBuffer(value);

/** Collect request body */
const collectBody = async (req: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    if (isBuffer(chunk)) {
      chunks.push(chunk);
    }
  }
  return Buffer.concat(chunks).toString('utf8');
};

/** Interface for ratio request body */
interface RatioRequestBody {
  ratio: string;
}

/** Type guard to check if value has ratio property */
const isRatioRequestBody = (value: unknown): value is RatioRequestBody => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  if (!('ratio' in value)) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return typeof obj.ratio === 'string';
};

/** Handle reset endpoint */
const handleReset = (res: ServerResponse): void => {
  resetJobCounts();
  res.writeHead(HTTP_OK, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: true, message: 'Job counts reset' }));
};

/** Handle stats endpoint */
const handleStats = (res: ServerResponse): void => {
  res.writeHead(HTTP_OK, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      ports: TARGET_PORTS,
      ratio: currentRatio,
      jobCounts,
      totalJobs: jobCounts.reduce((sum, c) => sum + c, INITIAL_JOB_COUNT),
    })
  );
};

/** Process ratio update from parsed body */
const processRatioUpdate = (parsed: unknown, res: ServerResponse): void => {
  if (!isRatioRequestBody(parsed)) {
    res.writeHead(HTTP_BAD_REQUEST, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'Invalid request body' }));
    return;
  }

  const { ratio } = parsed;
  if (setRatio(ratio)) {
    resetJobCounts();
    log(`Ratio updated to: ${currentRatio.join(':')}`);
    res.writeHead(HTTP_OK, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, ratio: currentRatio }));
  } else {
    res.writeHead(HTTP_BAD_REQUEST, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'Invalid ratio format' }));
  }
};

/** Handle ratio endpoint */
const handleRatio = (req: IncomingMessage, res: ServerResponse): void => {
  collectBody(req)
    .then((body) => {
      const parsed: unknown = JSON.parse(body);
      processRatioUpdate(parsed, res);
    })
    .catch((err: unknown) => {
      res.writeHead(HTTP_BAD_REQUEST, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: String(err) }));
    });
};

/** Handle proxy config API endpoints */
const handleConfigApi = (req: IncomingMessage, res: ServerResponse): boolean => {
  if (req.url === '/proxy/reset' && req.method === 'POST') {
    handleReset(res);
    return true;
  }
  if (req.url === '/proxy/stats' && req.method === 'GET') {
    handleStats(res);
    return true;
  }
  if (req.url === '/proxy/ratio' && req.method === 'POST') {
    handleRatio(req, res);
    return true;
  }
  return false;
};

const proxyRequest = (req: IncomingMessage, res: ServerResponse): void => {
  // Handle proxy config API endpoints
  if (handleConfigApi(req, res)) {
    return;
  }

  const targetPort = getNextTargetPort();

  log(`Proxying ${req.method} ${req.url} -> port ${targetPort} (counts: ${jobCounts.join(', ')})`);

  const proxyReq = httpRequest(
    {
      hostname: TARGET_HOST,
      port: targetPort,
      path: req.url,
      method: req.method,
      headers: req.headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? HTTP_INTERNAL_ERROR, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on('error', (error) => {
    logError(`Proxy error to port ${targetPort}: ${error.message}`);
    res.writeHead(HTTP_BAD_GATEWAY);
    res.end('Bad Gateway');
  });

  req.pipe(proxyReq);
};

const server = createServer(proxyRequest);

server.listen(PROXY_PORT, () => {
  log(`Proxy server listening on port ${PROXY_PORT}`);
  log(`Load balancing between ports: ${TARGET_PORTS.join(', ')}`);
  log(`Distribution ratio: ${currentRatio.join(':')}`);
  log(`API endpoints: POST /proxy/reset, POST /proxy/ratio, GET /proxy/stats`);
});
