/**
 * 遗物系统
 * 管理遗物的 5 槽位、装备/替换、触发引擎
 * 
 * 设计原则（D-003）：
 * - 来源：精英/Boss 击败后必掉、商店购买、事件奖励（不混入战斗奖励池）
 * - 数量：有限 5 槽，满了需要替换
 * - 作用域：全局/战斗外触发
 */

import { RelicData, RelicTrigger, RelicEffect, RELIC_SLOT_MAX } from './types';

// ============ 遗物持有状态 ============

/** 玩家当前持有的遗物（运行时） */
export interface RelicInventory {
  /** 已装备的遗物（最多 RELIC_SLOT_MAX 个） */
  relics: RelicData[];
}

/** 创建空的遗物背包 */
export function createRelicInventory(): RelicInventory {
  return { relics: [] };
}

// ============ 遗物管理 ============

/** 是否已满 */
export function isRelicFull(inv: RelicInventory): boolean {
  return inv.relics.length >= RELIC_SLOT_MAX;
}

/** 添加遗物（未满时直接添加） */
export function addRelic(inv: RelicInventory, relic: RelicData): boolean {
  if (inv.relics.length >= RELIC_SLOT_MAX) return false;
  if (inv.relics.some(r => r.id === relic.id)) return false; // 不可重复
  inv.relics.push(relic);
  return true;
}

/** 替换指定位置的遗物（满了时用） */
export function replaceRelic(inv: RelicInventory, index: number, newRelic: RelicData): RelicData | null {
  if (index < 0 || index >= inv.relics.length) return null;
  if (inv.relics.some(r => r.id === newRelic.id)) return null; // 不可重复
  const old = inv.relics[index];
  inv.relics[index] = newRelic;
  return old;
}

/** 移除遗物 */
export function removeRelic(inv: RelicInventory, relicId: string): boolean {
  const index = inv.relics.findIndex(r => r.id === relicId);
  if (index === -1) return false;
  inv.relics.splice(index, 1);
  return true;
}

// ============ 触发引擎 ============

/** 触发上下文：传递给遗物效果处理的参数 */
export interface TriggerContext {
  /** 当前 HP */
  hp: number;
  /** 最大 HP */
  maxHp: number;
  /** 当前金币 */
  gold: number;
  /** 最大 AP */
  maxAp: number;
}

/** 触发结果：遗物效果产生的变化 */
export interface TriggerResult {
  /** HP 变化量（正=恢复，负=扣除） */
  hpDelta: number;
  /** 最大 HP 变化量 */
  maxHpDelta: number;
  /** 金币变化量 */
  goldDelta: number;
  /** AP 变化量（临时，仅战斗开始时有意义） */
  apDelta: number;
  /** 护盾获得量 */
  shieldGain: number;
  /** 商店折扣百分比（100 = 无折扣） */
  shopDiscount: number;
  /** 额外休息恢复百分比 */
  restBonusPercent: number;
  /** 触发的遗物名称（用于 UI 展示） */
  triggeredRelics: string[];
}

/** 创建空的触发结果 */
function emptyResult(): TriggerResult {
  return {
    hpDelta: 0,
    maxHpDelta: 0,
    goldDelta: 0,
    apDelta: 0,
    shieldGain: 0,
    shopDiscount: 100,
    restBonusPercent: 0,
    triggeredRelics: [],
  };
}

/**
 * 触发所有匹配时机的遗物效果
 * @param inv 遗物背包
 * @param trigger 当前时机
 * @param ctx 上下文
 * @returns 累积的效果变化
 */
export function triggerRelics(
  inv: RelicInventory,
  trigger: RelicTrigger,
  ctx: TriggerContext
): TriggerResult {
  const result = emptyResult();

  for (const relic of inv.relics) {
    if (relic.trigger !== trigger) continue;

    // 处理该遗物的所有效果
    for (const effect of relic.effects) {
      applyRelicEffect(effect, ctx, result);
    }
    result.triggeredRelics.push(relic.name);
  }

  return result;
}

/** 获取被动属性加成（passive_stat 类型的遗物） */
export function getPassiveStatBonuses(inv: RelicInventory): TriggerResult {
  const result = emptyResult();
  const ctx: TriggerContext = { hp: 0, maxHp: 0, gold: 0, maxAp: 0 };

  for (const relic of inv.relics) {
    if (relic.trigger !== 'passive_stat') continue;
    for (const effect of relic.effects) {
      applyRelicEffect(effect, ctx, result);
    }
    result.triggeredRelics.push(relic.name);
  }

  return result;
}

/** 应用单个遗物效果到结果中 */
function applyRelicEffect(effect: RelicEffect, _ctx: TriggerContext, result: TriggerResult): void {
  switch (effect.type) {
    case 'heal':
      result.hpDelta += effect.value;
      break;
    case 'max_hp_up':
      result.maxHpDelta += effect.value;
      break;
    case 'gold_bonus':
      result.goldDelta += effect.value;
      break;
    case 'shop_discount':
      // 取最低折扣（多个折扣遗物取最优）
      result.shopDiscount = Math.min(result.shopDiscount, effect.value);
      break;
    case 'ap_bonus':
      result.apDelta += effect.value;
      break;
    case 'shield_start':
      result.shieldGain += effect.value;
      break;
    case 'bonus_reward_gold':
      result.goldDelta += effect.value;
      break;
    case 'rest_bonus_heal':
      result.restBonusPercent += effect.value;
      break;
    case 'preview_next_floor':
      // 特殊效果，由 UI 层处理
      break;
  }
}
