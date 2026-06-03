/**
 * /core — 纯游戏逻辑层
 * 不依赖 UI/引擎，可独立单元测试
 */
export { RNG } from './rng';
export { Combat } from './combat';
export type { CombatConfig, CombatLogEntry } from './combat';
export { executeEffect, executeEffects, calculateDamage, dealDamage } from './effects';
export { applyStatus, getStacks, tickStatuses, decayStatuses, STATUS_DEFS } from './status';
export type {
  EffectType, TargetType, Effect,
  StatusId, StatusInstance, StatusDef,
  SkillData, IntentAction, IntentOption, EnemyData,
  Player, Enemy, CombatPhase, CombatState,
} from './types';
