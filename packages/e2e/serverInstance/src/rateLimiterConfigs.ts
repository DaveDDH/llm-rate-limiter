/**
 * Configuration presets for E2E testing different scenarios.
 * Each preset defines models, escalation order, and resource estimations.
 *
 * This file re-exports from the rateLimiterConfigs module for backwards compatibility.
 */

export type { RateLimiterPreset, ConfigPresetName } from './rateLimiterConfigs/index.js';

export {
  defaultConfig,
  slotCalculationConfig,
  fixedRatioConfig,
  flexibleRatioConfig,
  instanceScalingConfig,
  slotCalcTpmConfig,
  slotCalcRpmConfig,
  slotCalcConcurrentConfig,
  slotCalcTpmRpmConfig,
  slotCalcMultiModelConfig,
  slotCalcRatiosConfig,
  slotCalcTpdConfig,
  slotCalcRpdConfig,
  slotCalcUnevenRatiosConfig,
  slotCalcMemoryConfig,
  configPresets,
  getConfigPreset,
  isValidPresetName,
} from './rateLimiterConfigs/index.js';
