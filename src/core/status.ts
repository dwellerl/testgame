/**
 * 状态效果系统
 * 管理状态的定义、施加、回合处理（tick）
 */

import type { StatusDef, StatusId, StatusInstance, Player, Enemy } from './types';

/** 所有状态效果的静态定义 */
export const STATUS_DEFS: Record<StatusId, StatusDef> = {
  burn: {
    id: 'burn',
    name: '燃烧',
    decayPerTurn: true,
    isDebuff: true,
  },
  poison: {
    id: 'poison',
    name: '中毒',
    decayPerTurn: true,
    isDebuff: true,
  },
  weak: {
    id: 'weak',
    name: '虚弱',
    decayPerTurn: true,
    isDebuff: true,
  },
  vulnerable: {
    id: 'vulnerable',
    name: '易伤',
    decayPerTurn: true,
    isDebuff: true,
  },
  strength_up: {
    id: 'strength_up',
    name: '力量提升',
    decayPerTurn: false,
    isDebuff: false,
  },
};

/** 目标类型：玩家或敌人 */
type Combatant = Player | Enemy;

/** 给目标施加状态（叠加层数） */
export function applyStatus(target: Combatant, statusId: StatusId, stacks: number): void {
  const existing = target.statuses.find(s => s.id === statusId);
  if (existing) {
    existing.stacks += stacks;
  } else {
    target.statuses.push({ id: statusId, stacks });
  }
}

/** 获取目标身上某状态的层数（没有则返回 0） */
export function getStacks(target: Combatant, statusId: StatusId): number {
  const s = target.statuses.find(st => st.id === statusId);
  return s ? s.stacks : 0;
}

/** tickStatuses 的返回值 */
export interface TickResult {
  /** 对目标自身造成的总 DoT 伤害 */
  damage: number;
  /** 燃烧溅射对其他单位各造成的伤害 */
  splashDamage: number;
}

/**
 * 回合开始时处理状态效果（DoT 等）
 * @param target 当前触发状态的单位
 * @param allies 同阵营其他存活单位（用于燃烧溅射），可选
 * 返回 TickResult
 */
export function tickStatuses(target: Combatant, allies?: Combatant[]): TickResult {
  let damage = 0;
  let splashDamage = 0;

  for (const status of target.statuses) {
    switch (status.id) {
      case 'burn':
        // 燃烧：每回合造成等于层数的伤害，并对其他同阵营单位各造成 1 点溅射
        damage += status.stacks;
        if (allies && allies.length > 0) {
          splashDamage = 1;
          for (const ally of allies) {
            if (ally.hp > 0) {
              const shieldAbsorb = Math.min(ally.shield, 1);
              ally.shield -= shieldAbsorb;
              ally.hp -= (1 - shieldAbsorb);
            }
          }
        }
        break;
      case 'poison':
        // 中毒：每回合造成等于层数的伤害
        damage += status.stacks;
        break;
      // weak / vulnerable / strength_up 不造成伤害，在效果计算时生效
    }
  }

  // 对有 hp 的目标扣血（先扣护盾）
  if (damage > 0) {
    const shieldAbsorb = Math.min(target.shield, damage);
    target.shield -= shieldAbsorb;
    target.hp -= (damage - shieldAbsorb);
  }

  return { damage, splashDamage };
}

/** 回合结束时衰减状态层数，移除归零的状态 */
export function decayStatuses(target: Combatant): void {
  for (const status of target.statuses) {
    const def = STATUS_DEFS[status.id];
    if (def.decayPerTurn) {
      status.stacks -= 1;
    }
  }
  // 移除层数 <= 0 的状态
  target.statuses = target.statuses.filter(s => s.stacks > 0);
}
