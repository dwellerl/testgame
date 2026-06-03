/**
 * 效果系统
 * 执行技能/意图产生的原子效果（damage/heal/shield/apply_status/gain_ap）
 * 处理伤害修正（虚弱减伤、易伤增伤、力量加成）
 */

import type { Effect, Player, Enemy } from './types';
import { applyStatus, getStacks } from './status';

/** 效果执行的上下文 */
interface EffectContext {
  source: Player | Enemy;
  target: Player | Enemy;
}

/**
 * 计算实际伤害（考虑修正）
 * - 力量提升：每层 +1 伤害
 * - 虚弱（在攻击者身上）：伤害 × 0.75
 * - 易伤（在目标身上）：伤害 × 1.5
 */
export function calculateDamage(baseDamage: number, source: Player | Enemy, target: Player | Enemy): number {
  let damage = baseDamage;

  // 力量加成（来源身上的 strength_up 层数）
  damage += getStacks(source, 'strength_up');

  // 虚弱（来源身上）：伤害打折
  if (getStacks(source, 'weak') > 0) {
    damage = Math.floor(damage * 0.75);
  }

  // 易伤（目标身上）：伤害增加
  if (getStacks(target, 'vulnerable') > 0) {
    damage = Math.floor(damage * 1.5);
  }

  return Math.max(0, damage);
}

/**
 * 对目标造成伤害（先扣护盾，再扣血）
 * 返回实际造成的 HP 伤害
 */
export function dealDamage(target: Player | Enemy, amount: number): number {
  const shieldAbsorb = Math.min(target.shield, amount);
  target.shield -= shieldAbsorb;
  const hpDamage = amount - shieldAbsorb;
  target.hp -= hpDamage;
  return hpDamage;
}

/** 执行单个效果 */
export function executeEffect(effect: Effect, ctx: EffectContext): void {
  switch (effect.type) {
    case 'damage': {
      const finalDamage = calculateDamage(effect.value, ctx.source, ctx.target);
      dealDamage(ctx.target, finalDamage);
      break;
    }
    case 'heal': {
      // 治疗不超过最大生命（只有 Player 有 maxHp）
      if ('maxHp' in ctx.target) {
        ctx.target.hp = Math.min(ctx.target.hp + effect.value, ctx.target.maxHp);
      } else {
        // 敌人用 data.hp 作为上限
        const enemy = ctx.target as Enemy;
        enemy.hp = Math.min(enemy.hp + effect.value, enemy.data.hp);
      }
      break;
    }
    case 'shield': {
      ctx.target.shield += effect.value;
      break;
    }
    case 'apply_status': {
      if (effect.status && effect.stacks) {
        applyStatus(ctx.target, effect.status, effect.stacks);
      }
      break;
    }
    case 'gain_ap': {
      if ('ap' in ctx.target) {
        (ctx.target as Player).ap += effect.value;
      }
      break;
    }
  }
}

/**
 * 执行一组效果（一个技能的所有效果）
 */
export function executeEffects(effects: Effect[], ctx: EffectContext): void {
  for (const effect of effects) {
    executeEffect(effect, ctx);
  }
}
