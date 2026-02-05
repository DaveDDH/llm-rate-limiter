/**
 * Configuration preset registry and helper functions.
 */
import { defaultConfig } from './defaultConfig.js';
import {
  slotCalcConcurrentConfig,
  slotCalcMultiModelConfig,
  slotCalcRpmConfig,
  slotCalcTpmConfig,
  slotCalcTpmRpmConfig,
} from './slotCalcLimitConfigs.js';
import {
  slotCalcMemoryConfig,
  slotCalcRatiosConfig,
  slotCalcRpdConfig,
  slotCalcRpmLimitingConfig,
  slotCalcTpdConfig,
  slotCalcTpdRpdConfig,
  slotCalcTpmSingleConfig,
  slotCalcUnevenRatiosConfig,
  slotCalcZeroSlotsConfig,
} from './slotCalcRatioConfigs.js';
import {
  fixedRatioConfig,
  flexibleRatioConfig,
  instanceScalingConfig,
  slotCalculationConfig,
} from './slotTestConfigs.js';
import type { ConfigPresetName, RateLimiterPreset } from './types.js';

/** Registry of all configuration presets */
export const configPresets: Record<ConfigPresetName, RateLimiterPreset> = {
  default: defaultConfig,
  slotCalculation: slotCalculationConfig,
  fixedRatio: fixedRatioConfig,
  flexibleRatio: flexibleRatioConfig,
  instanceScaling: instanceScalingConfig,
  'slotCalc-tpm': slotCalcTpmConfig,
  'slotCalc-rpm': slotCalcRpmConfig,
  'slotCalc-tpd': slotCalcTpdConfig,
  'slotCalc-rpd': slotCalcRpdConfig,
  'slotCalc-concurrent': slotCalcConcurrentConfig,
  'slotCalc-tpm-rpm': slotCalcTpmRpmConfig,
  'slotCalc-multi-model': slotCalcMultiModelConfig,
  'slotCalc-ratios': slotCalcRatiosConfig,
  'slotCalc-uneven-ratios': slotCalcUnevenRatiosConfig,
  'slotCalc-memory': slotCalcMemoryConfig,
  'slotCalc-tpd-rpd': slotCalcTpdRpdConfig,
  'slotCalc-zero-slots': slotCalcZeroSlotsConfig,
  'slotCalc-rpm-limiting': slotCalcRpmLimitingConfig,
  'slotCalc-tpm-single': slotCalcTpmSingleConfig,
};

/** Get a configuration preset by name */
export const getConfigPreset = (name: ConfigPresetName): RateLimiterPreset => configPresets[name];

/** Check if a string is a valid preset name */
export const isValidPresetName = (name: string): name is ConfigPresetName => name in configPresets;
