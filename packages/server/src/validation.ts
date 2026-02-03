/**
 * Validation utilities for request bodies.
 */
import type { QueueJobRequestBody } from './types.js';

interface ValidationResult {
  valid: true;
  data: QueueJobRequestBody;
}

interface ValidationError {
  valid: false;
  error: string;
}

type ValidateQueueJobResult = ValidationResult | ValidationError;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const getString = (obj: Record<string, unknown>, key: string): string | undefined => {
  const { [key]: value } = obj;
  return typeof value === 'string' ? value : undefined;
};

const isObjectValue = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const getObject = (obj: Record<string, unknown>, key: string): Record<string, unknown> | undefined => {
  const { [key]: value } = obj;
  return isObjectValue(value) ? value : undefined;
};

/**
 * Validate the queue-job request body.
 */
export const validateQueueJobRequest = (body: unknown): ValidateQueueJobResult => {
  if (!isRecord(body)) {
    return {
      valid: false,
      error: 'Request body must be an object',
    };
  }

  const jobId = getString(body, 'jobId');
  if (jobId === undefined) {
    return {
      valid: false,
      error: 'jobId must be a string',
    };
  }

  const jobType = getString(body, 'jobType');
  if (jobType === undefined) {
    return {
      valid: false,
      error: 'jobType must be a string',
    };
  }

  const payload = getObject(body, 'payload');
  if (payload === undefined) {
    return {
      valid: false,
      error: 'payload must be an object',
    };
  }

  return {
    valid: true,
    data: { jobId, jobType, payload },
  };
};
