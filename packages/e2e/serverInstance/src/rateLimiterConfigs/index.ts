/**
 * Configuration presets for E2E testing different scenarios.
 * Each preset defines models, escalation order, and resource estimations.
 */

// Re-export types
export type { RateLimiterPreset, ConfigPresetName } from './types.js';

// Re-export individual configs
export { defaultConfig } from './defaultConfig.js';
export {
  localRatioTwoTypesConfig,
  localRatioThreeTypesConfig,
  localRatioEqualThreeConfig,
  localRatioZeroAllocConfig,
} from './localRatioConfigs.js';
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
  slotCalcTpmSingleConfig,
  slotCalcZeroSlotsConfig,
  slotCalcRpmLimitingConfig,
} from './slotCalcRatioConfigs.js';

export {
  memCalcBasicConfig,
  memCalcDistributedWinsConfig,
  memCalcFreeRatioConfig,
  memCalcMemoryWinsConfig,
  memCalcRatiosConfig,
  memCalcZeroMemoryConfig,
} from './memoryCalcConfigs.js';

export {
  mediumErrorMemoryConfig,
  mediumFixedProtectionMultiFixedConfig,
  mediumFixedProtectionThreeTypeConfig,
  mediumFixedProtectionTwoTypeConfig,
  mediumMaxWaitExplicitConfig,
  mediumMaxWaitPerModelConfig,
  mediumMaxWaitReleaseConfig,
  mediumMaxWaitSingleModelConfig,
  mediumMaxWaitTimeoutConfig,
  mediumMaxWaitTwoModelConfig,
  mediumQueueConcurrentConfig,
} from './mediumTestConfigs.js';

export {
  mhMemoryConstrainConfig,
  mhMemoryRatioInteractConfig,
  mhMemoryDiffEstimatesConfig,
  mhMemoryAllLimitsConfig,
  mhEscalationThreeModelConfig,
  mhEscalationTpmConfig,
  mhEscalationRpmConfig,
  mhEscalationConcConfig,
  mhEscalationMultiTimeoutConfig,
  mhEscalationTpmWait5sConfig,
  mhEscalationConcWait5sConfig,
} from './mediumHighConfigs.js';

export {
  highMultiResourceConfig,
  highMultiModelConfig,
  highTwoLayerConfig,
  highTwoLayerEqualConfig,
  highTpmRpmTrackingConfig,
  highRpmTrackingConfig,
  highTimeWindowConfig,
} from './highTestConfigs.js';

export {
  highDistributedBasicConfig,
  highDistributedThreeConfig,
  highDistributedMixedConfig,
  highDistributedTimeWindowConfig,
  highDistributedMultiModelConfig,
  highDistributedPubSubConfig,
  highDistributedWaitConfig,
} from './highDistributedConfigs.js';

export {
  highestMemoryDistributedConfig,
  highestDistributedAcquireConfig,
  highestAcquireAtomicityConfig,
  highestDistributedWaitQueueConfig,
  highestDistributedEscalationConfig,
  highestJobPriorityConfig,
  highestHighConcurrencyConfig,
  highestEdgeFloorConfig,
  highestEdgeZeroSlotsConfig,
  highestEdgeAllFixedConfig,
  highestEdgeSingleFlexConfig,
} from './highestTestConfigs.js';

// Re-export registry and helpers from registry file
export { configPresets, getConfigPreset, isValidPresetName } from './registry.js';
