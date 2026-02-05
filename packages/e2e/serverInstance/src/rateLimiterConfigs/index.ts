/**
 * Configuration presets for E2E testing different scenarios.
 * Each preset defines models, escalation order, and resource estimations.
 */

// Re-export types
export type { RateLimiterPreset, ConfigPresetName } from './types.js';

// Re-export individual configs
export { defaultConfig } from './defaultConfig.js';
export {
  slotCalculationConfig,
  fixedRatioConfig,
  flexibleRatioConfig,
  instanceScalingConfig,
} from './slotTestConfigs.js';
export {
  slotCalcTpmConfig,
  slotCalcRpmConfig,
  slotCalcConcurrentConfig,
  slotCalcTpmRpmConfig,
  slotCalcMultiModelConfig,
} from './slotCalcLimitConfigs.js';
export {
  slotCalcRatiosConfig,
  slotCalcTpdConfig,
  slotCalcRpdConfig,
  slotCalcUnevenRatiosConfig,
  slotCalcMemoryConfig,
  slotCalcTpdRpdConfig,
  slotCalcZeroSlotsConfig,
  slotCalcRpmLimitingConfig,
} from './slotCalcRatioConfigs.js';

// Re-export registry and helpers from registry file
export { configPresets, getConfigPreset, isValidPresetName } from './registry.js';
