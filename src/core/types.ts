/**
 * 核心类型定义
 * Hades 式技能槽战斗系统
 */

// ============ 效果系统 ============

/** 效果类型枚举 — 所有技能的原子操作 */
export type EffectType =
  | 'damage'        // 造成伤害
  | 'heal'          // 恢复生命
  | 'shield'        // 获得护盾（格挡）
  | 'apply_status'  // 施加状态效果
  | 'gain_ap';      // 获得额外行动力

/** 效果目标 */
export type TargetType =
  | 'single_enemy'  // 单体敌人
  | 'all_enemies'   // 全体敌人
  | 'self';         // 自身

/** 一个效果的数据描述 */
export interface Effect {
  type: EffectType;
  value: number;
  /** apply_status 时指定状态 ID */
  status?: StatusId;
  /** apply_status 时的层数 */
  stacks?: number;
}

// ============ 状态效果 ============

/** 状态效果 ID */
export type StatusId = 'burn' | 'poison' | 'weak' | 'vulnerable' | 'strength_up';

/** 状态效果的运行时实例（附着在角色身上） */
export interface StatusInstance {
  id: StatusId;
  stacks: number;
}

/** 状态效果的静态定义 */
export interface StatusDef {
  id: StatusId;
  name: string;
  /** 是否每回合衰减 1 层 */
  decayPerTurn: boolean;
  /** 是否是负面效果 */
  isDebuff: boolean;
}

// ============ 技能槽系统 ============

/** 槽位类型 */
export type SlotType =
  | 'light_a'   // 轻击 A
  | 'light_b'   // 轻击 B
  | 'heavy'     // 重击
  | 'support'   // 辅助
  | 'ultimate'; // 大招

/** 技能数据（对应 /data 下的 JSON） */
export interface SkillData {
  id: string;
  name: string;
  apCost: number;
  target: TargetType;
  effects: Effect[];
  tags: string[];
  /** 该技能属于哪个槽位池 */
  slotType: SlotType;
  /** 技能描述（给玩家看的） */
  desc?: string;
}

/** 固有技能数据（基础攻击/基础防御，不占槽） */
export interface InnateSkilData {
  id: string;
  name: string;
  apCost: number;
  target: TargetType;
  effects: Effect[];
}

/** 技能槽（运行时） */
export interface SkillSlot {
  type: SlotType;
  /** 当前绑定的技能，null 表示空槽 */
  skill: SkillData | null;
}

// ============ 被动技能 ============

/** 被动触发时机 */
export type PassiveTrigger =
  | 'on_turn_start'      // 每回合开始
  | 'on_turn_end'        // 每回合结束
  | 'on_use_skill'       // 使用技能时
  | 'on_take_damage'     // 受到伤害时
  | 'on_deal_damage'     // 造成伤害时
  | 'on_kill'            // 击杀时
  | 'on_ultimate'        // 释放大招时
  | 'permanent';         // 永久生效（属性加成等）

/** 被动技能数据 */
export interface PassiveData {
  id: string;
  name: string;
  desc: string;
  trigger: PassiveTrigger;
  effects: Effect[];
  tags: string[];
}

// ============ 遗物系统 ============

/** 遗物触发时机（全局/战斗外为主） */
export type RelicTrigger =
  | 'on_combat_start'     // 战斗开始时
  | 'on_combat_end'       // 战斗结束时（胜利）
  | 'on_floor_start'      // 进入新楼层时
  | 'on_enter_shop'       // 进入商店时
  | 'on_rest'             // 营地休息时
  | 'on_gold_gain'        // 获得金币时
  | 'on_take_relic'       // 获取遗物时
  | 'passive_stat';       // 永久属性加成（不需要触发）

/** 遗物效果类型 */
export type RelicEffectType =
  | 'heal'                // 恢复 HP
  | 'max_hp_up'           // 最大 HP 提升
  | 'gold_bonus'          // 额外金币
  | 'shop_discount'       // 商店折扣（value 为折扣百分比，如 70 = 7 折）
  | 'ap_bonus'            // 战斗开始时额外 AP
  | 'shield_start'        // 战斗开始时获得护盾
  | 'bonus_reward_gold'   // 战斗奖励额外金币
  | 'rest_bonus_heal'     // 营地额外恢复（value 为百分比）
  | 'preview_next_floor'; // 预览下一层节点类型

/** 遗物效果数据 */
export interface RelicEffect {
  type: RelicEffectType;
  value: number;
}

/** 遗物稀有度 */
export type RelicRarity = 'common' | 'rare' | 'legendary';

/** 遗物数据定义 */
export interface RelicData {
  id: string;
  name: string;
  desc: string;
  rarity: RelicRarity;
  trigger: RelicTrigger;
  effects: RelicEffect[];
}

/** 遗物槽上限 */
export const RELIC_SLOT_MAX = 5;

// ============ 敌人 ============

/** 敌人意图动作类型 */
export type IntentAction = 'attack' | 'defend' | 'buff' | 'debuff';

/** 敌人的一个意图选项 */
export interface IntentOption {
  weight: number;
  action: IntentAction;
  value: number;
  /** debuff 时施加的状态 */
  status?: StatusId;
}

/** 敌人数据（对应 /data 下的 JSON） */
export interface EnemyData {
  id: string;
  name: string;
  hp: number;
  /** 难度分级：1=前期、2=中期、3=后期 */
  tier?: number;
  intents: IntentOption[];
}

// ============ Boss 系统 ============

/** Boss 阶段转换时的特殊效果 */
export interface BossPhaseTransition {
  /** 转阶段时的台词/文本（UI 展示） */
  dialogue?: string;
  /** 转阶段时自身恢复的护盾 */
  shieldGain?: number;
  /** 转阶段时清除自身所有负面状态 */
  clearDebuffs?: boolean;
  /** 转阶段时对玩家施加状态 */
  applyToPlayer?: { status: StatusId; stacks: number };
}

/** Boss 的一个阶段 */
export interface BossPhase {
  /** 阶段名称（UI 展示） */
  name: string;
  /** HP 百分比阈值：当 HP <= maxHp * threshold 时进入此阶段（0-1） */
  hpThreshold: number;
  /** 此阶段的意图池（替换默认意图） */
  intents: IntentOption[];
  /** 进入此阶段时的转换效果 */
  transition?: BossPhaseTransition;
}

/** Boss 数据（扩展 EnemyData） */
export interface BossData extends EnemyData {
  /** 标记为 Boss */
  isBoss: true;
  /** Boss 标题/称号 */
  title: string;
  /** 多阶段定义（按 hpThreshold 从高到低排列） */
  phases: BossPhase[];
}

// ============ 战斗运行时 ============

/** 共鸣值配置 */
export const RESONANCE_MAX = 6;

/** 战斗中的角色（玩家） */
export interface Player {
  hp: number;
  maxHp: number;
  ap: number;
  maxAp: number;
  shield: number;
  statuses: StatusInstance[];
  /** 固有技能：基础攻击 + 基础防御 */
  innateSkills: InnateSkilData[];
  /** 5 个技能槽 */
  slots: SkillSlot[];
  /** 被动技能列表 */
  passives: PassiveData[];
  /** 共鸣值（满 RESONANCE_MAX 可释放大招） */
  resonance: number;
}

/** 战斗中的敌人实例 */
export interface Enemy {
  data: EnemyData;
  hp: number;
  shield: number;
  statuses: StatusInstance[];
  /** 当前回合的意图（已决定，展示给玩家） */
  currentIntent: IntentOption | null;
}

/** 战斗阶段 */
export type CombatPhase =
  | 'player_turn'   // 玩家回合
  | 'enemy_turn'    // 敌人回合
  | 'victory'       // 胜利
  | 'defeat';       // 失败

/** 战斗状态（完整快照） */
export interface CombatState {
  phase: CombatPhase;
  turn: number;
  player: Player;
  enemies: Enemy[];
}
