/**
 * 回合制战斗状态机（Hades 式技能槽版本）
 * 管理战斗流程：初始化 → 玩家回合 → 敌人回合 → 循环直到胜负
 */

import type { CombatState, EnemyData, Enemy, Player, SkillData, InnateSkilData, SkillSlot, PassiveData, IntentOption, SlotType, BossData, BossPhase } from './types';
import { RESONANCE_MAX } from './types';
import { RNG } from './rng';
import { executeEffects, calculateDamage, dealDamage } from './effects';
import { tickStatuses, decayStatuses, applyStatus } from './status';

/** 判断一个 EnemyData 是否是 BossData */
export function isBossData(data: EnemyData): data is BossData {
  return 'isBoss' in data && (data as BossData).isBoss === true;
}

/** 战斗配置 */
export interface CombatConfig {
  playerHp: number;
  playerMaxAp: number;
  innateSkills: InnateSkilData[];
  slots: SkillSlot[];
  passives: PassiveData[];
  enemies: EnemyData[];
  seed: number;
}

/** 战斗日志条目 */
export interface CombatLogEntry {
  turn: number;
  actor: string;
  action: string;
  detail: string;
}

/** Boss 阶段跟踪 */
interface BossPhaseState {
  /** Boss 数据 */
  bossData: BossData;
  /** 当前处于第几阶段（-1 = 初始阶段，0 = phases[0]，1 = phases[1]...） */
  currentPhaseIndex: number;
}

/** 战斗引擎 */
export class Combat {
  state: CombatState;
  rng: RNG;
  log: CombatLogEntry[];
  /** Boss 阶段跟踪（key = enemy 在 enemies 数组中的 index） */
  bossPhases: Map<number, BossPhaseState> = new Map();

  constructor(config: CombatConfig) {
    this.rng = new RNG(config.seed);
    this.log = [];

    const player: Player = {
      hp: config.playerHp,
      maxHp: config.playerHp,
      ap: config.playerMaxAp,
      maxAp: config.playerMaxAp,
      shield: 0,
      statuses: [],
      innateSkills: config.innateSkills,
      slots: config.slots,
      passives: config.passives,
      resonance: 0,
    };

    const enemies: Enemy[] = config.enemies.map((data, index) => {
      // 如果是 Boss，初始化阶段跟踪
      if (isBossData(data)) {
        this.bossPhases.set(index, {
          bossData: data,
          currentPhaseIndex: -1, // 初始阶段（使用默认 intents）
        });
      }
      return {
        data,
        hp: data.hp,
        shield: 0,
        statuses: [],
        currentIntent: null,
      };
    });

    this.state = {
      phase: 'player_turn',
      turn: 1,
      player,
      enemies,
    };

    // 触发 on_turn_start 被动（第一回合）
    this.triggerPassives('on_turn_start');

    // 战斗开始时，敌人决定第一回合意图
    this.rollEnemyIntents();
  }

  // ============ 玩家行动 ============

  /**
   * 使用固有技能（基础攻击/基础防御）
   * @param innateIndex 固有技能索引（0=攻击，1=防御）
   * @param targetIndex 目标敌人索引
   */
  useInnateSkill(innateIndex: number, targetIndex: number): boolean {
    if (this.state.phase !== 'player_turn') return false;

    const { player } = this.state;
    const skill = player.innateSkills[innateIndex];
    if (!skill) return false;
    if (player.ap < skill.apCost) return false;

    player.ap -= skill.apCost;

    // 确定目标并执行
    if (skill.target === 'self') {
      executeEffects(skill.effects, { source: player, target: player });
      this.addLog('守钟人', skill.name, `对自身使用`);
    } else {
      const target = this.state.enemies[targetIndex];
      if (!target || target.hp <= 0) return false;
      executeEffects(skill.effects, { source: player, target });
      this.addLog('守钟人', skill.name, `对 ${target.data.name} 造成效果`);
    }

    // 积累共鸣值
    this.gainResonance(1);

    // 触发 on_use_skill 被动
    this.triggerPassives('on_use_skill');

    this.checkEnemyDeaths();
    if (this.aliveEnemies().length === 0) {
      this.state.phase = 'victory';
    } else {
      // 检查 Boss 阶段转换
      this.checkBossPhaseTransitions();
    }

    return true;
  }

  /**
   * 使用槽位技能
   * @param slotIndex 槽位索引（0-4）
   * @param targetIndex 目标敌人索引
   */
  useSlotSkill(slotIndex: number, targetIndex: number): boolean {
    if (this.state.phase !== 'player_turn') return false;

    const { player } = this.state;
    const slot = player.slots[slotIndex];
    if (!slot || !slot.skill) return false;

    const skill = slot.skill;

    // 大招需要共鸣值满，不消耗 AP
    if (slot.type === 'ultimate') {
      if (player.resonance < RESONANCE_MAX) return false;
      player.resonance = 0;
    } else {
      if (player.ap < skill.apCost) return false;
      player.ap -= skill.apCost;
    }

    // 确定目标并执行
    if (skill.target === 'all_enemies') {
      for (const enemy of this.aliveEnemies()) {
        executeEffects(skill.effects, { source: player, target: enemy });
      }
      this.addLog('守钟人', skill.name, `对全体敌人使用`);
    } else if (skill.target === 'self') {
      executeEffects(skill.effects, { source: player, target: player });
      this.addLog('守钟人', skill.name, `对自身使用`);
    } else {
      const target = this.state.enemies[targetIndex];
      if (!target || target.hp <= 0) return false;
      executeEffects(skill.effects, { source: player, target });
      this.addLog('守钟人', skill.name, `对 ${target.data.name} 造成效果`);
    }

    // 非大招积累共鸣，大招触发 on_ultimate 被动
    if (slot.type === 'ultimate') {
      this.triggerPassives('on_ultimate');
      this.addLog('守钟人', '共鸣', `大招释放！共鸣值归零`);
    } else {
      this.gainResonance(1);
      this.triggerPassives('on_use_skill');
    }

    this.checkEnemyDeaths();
    if (this.aliveEnemies().length === 0) {
      this.state.phase = 'victory';
    } else {
      // 检查 Boss 阶段转换
      this.checkBossPhaseTransitions();
    }

    return true;
  }

  /** 积累共鸣值 */
  private gainResonance(amount: number): void {
    const { player } = this.state;
    const prev = player.resonance;
    player.resonance = Math.min(player.resonance + amount, RESONANCE_MAX);
    if (prev < RESONANCE_MAX && player.resonance >= RESONANCE_MAX) {
      this.addLog('守钟人', '共鸣', `共鸣值已满！大招就绪`);
    }
  }

  /** 玩家结束回合 */
  endPlayerTurn(): void {
    if (this.state.phase !== 'player_turn') return;

    const { player } = this.state;

    // 触发 on_turn_end 被动
    this.triggerPassives('on_turn_end');

    // 玩家回合结束：衰减状态
    decayStatuses(player);

    // 切换到敌人回合
    this.state.phase = 'enemy_turn';
    this.executeEnemyTurn();
  }

  // ============ 敌人回合 ============

  private executeEnemyTurn(): void {
    for (const enemy of this.aliveEnemies()) {
      // 敌人回合开始：状态 tick（DoT）
      const otherEnemies = this.aliveEnemies().filter(e => e !== enemy);
      const tickResult = tickStatuses(enemy, otherEnemies);
      if (tickResult.damage > 0) {
        this.addLog(enemy.data.name, '状态伤害', `受到 ${tickResult.damage} 点持续伤害`);
      }
      if (tickResult.splashDamage > 0) {
        const splashedNames = otherEnemies
          .filter(e => e.hp > 0 || tickResult.splashDamage > 0)
          .map(e => (e as Enemy).data.name)
          .join('、');
        this.addLog(enemy.data.name, '燃烧溅射', `火焰蔓延至 ${splashedNames}，各受到 1 点伤害`);
      }

      // 检查敌人是否被 DoT 杀死
      if (enemy.hp <= 0) continue;

      // 执行意图
      const intent = enemy.currentIntent;
      if (intent) {
        this.executeIntent(enemy, intent);
      }

      // 敌人回合结束：衰减状态
      decayStatuses(enemy);
      enemy.shield = 0;
    }

    // 检查敌人死亡
    this.checkEnemyDeaths();

    // 检查胜负
    if (this.state.player.hp <= 0) {
      this.state.phase = 'defeat';
      return;
    }
    if (this.aliveEnemies().length === 0) {
      this.state.phase = 'victory';
      return;
    }

    // 进入下一回合
    this.state.turn += 1;
    this.state.phase = 'player_turn';

    // 玩家新回合：清零护盾、恢复 AP、状态 tick
    const { player } = this.state;
    player.shield = 0;
    player.ap = player.maxAp;

    const playerTick = tickStatuses(player);
    if (playerTick.damage > 0) {
      this.addLog('守钟人', '状态伤害', `受到 ${playerTick.damage} 点持续伤害`);
    }
    if (player.hp <= 0) {
      this.state.phase = 'defeat';
      return;
    }

    // 触发 on_turn_start 被动
    this.triggerPassives('on_turn_start');

    // 敌人决定新意图
    this.rollEnemyIntents();
  }

  private executeIntent(enemy: Enemy, intent: IntentOption): void {
    const { player } = this.state;

    switch (intent.action) {
      case 'attack': {
        const damage = calculateDamage(intent.value, enemy, player);
        dealDamage(player, damage);
        this.addLog(enemy.data.name, '攻击', `造成 ${damage} 点伤害`);
        // 触发 on_take_damage 被动
        this.triggerPassives('on_take_damage');
        break;
      }
      case 'defend': {
        enemy.shield += intent.value;
        this.addLog(enemy.data.name, '防御', `获得 ${intent.value} 点护盾`);
        break;
      }
      case 'buff': {
        applyStatus(enemy, 'strength_up', intent.value);
        this.addLog(enemy.data.name, '强化', `力量提升 ${intent.value} 层`);
        break;
      }
      case 'debuff': {
        if (intent.status) {
          applyStatus(player, intent.status, intent.value);
          this.addLog(enemy.data.name, '削弱', `对守钟人施加 ${intent.status} ${intent.value} 层`);
        }
        break;
      }
    }
  }

  // ============ 被动系统 ============

  /** 触发指定时机的被动效果 */
  private triggerPassives(trigger: string): void {
    const { player } = this.state;
    for (const passive of player.passives) {
      if (passive.trigger !== trigger) continue;
      // 对有 effects 的被动执行效果（target 为自身）
      if (passive.effects.length > 0) {
        executeEffects(passive.effects, { source: player, target: player });
      }
    }
  }

  // ============ 意图系统 ============

  private rollEnemyIntents(): void {
    for (const enemy of this.aliveEnemies()) {
      const index = this.state.enemies.indexOf(enemy);
      enemy.currentIntent = this.weightedPick(this.getEnemyIntents(enemy, index));
    }
  }

  private weightedPick(options: IntentOption[]): IntentOption {
    const totalWeight = options.reduce((sum, o) => sum + o.weight, 0);
    let roll = this.rng.next() * totalWeight;
    for (const option of options) {
      roll -= option.weight;
      if (roll <= 0) return option;
    }
    return options[options.length - 1];
  }

  // ============ Boss 阶段系统 ============

  /** 检查并执行 Boss 阶段转换（返回是否发生了转换） */
  checkBossPhaseTransitions(): { transitioned: boolean; dialogue?: string; phaseName?: string } {
    for (const [index, phaseState] of this.bossPhases) {
      const enemy = this.state.enemies[index];
      if (enemy.hp <= 0) continue;

      const { bossData, currentPhaseIndex } = phaseState;
      const hpPercent = enemy.hp / bossData.hp; // 用原始 maxHp 计算

      // 检查是否应该进入下一个阶段
      for (let i = 0; i < bossData.phases.length; i++) {
        if (i <= currentPhaseIndex) continue; // 已经过了的阶段跳过
        const phase = bossData.phases[i];
        if (hpPercent <= phase.hpThreshold) {
          // 进入新阶段
          phaseState.currentPhaseIndex = i;
          this.addLog(enemy.data.name, '阶段转换', `进入「${phase.name}」阶段`);

          // 应用转阶段效果
          if (phase.transition) {
            const t = phase.transition;
            if (t.shieldGain) {
              enemy.shield += t.shieldGain;
              this.addLog(enemy.data.name, '强化', `获得 ${t.shieldGain} 护盾`);
            }
            if (t.clearDebuffs) {
              enemy.statuses = enemy.statuses.filter(s => s.id === 'strength_up');
              this.addLog(enemy.data.name, '净化', '清除所有负面状态');
            }
            if (t.applyToPlayer) {
              applyStatus(this.state.player, t.applyToPlayer.status, t.applyToPlayer.stacks);
              this.addLog(enemy.data.name, '威压', `对守钟人施加 ${t.applyToPlayer.status} ${t.applyToPlayer.stacks} 层`);
            }
            if (t.dialogue) {
              this.addLog(enemy.data.name, '对话', t.dialogue);
            }
          }

          // 立刻用新阶段的意图池重新 roll 意图
          enemy.currentIntent = this.weightedPick(phase.intents);

          return { transitioned: true, dialogue: phase.transition?.dialogue, phaseName: phase.name };
        }
      }
    }
    return { transitioned: false };
  }

  /** 获取 Boss 当前阶段信息（供 UI 展示） */
  getBossPhaseInfo(enemyIndex: number): { phaseName: string; phaseIndex: number; totalPhases: number } | null {
    const phaseState = this.bossPhases.get(enemyIndex);
    if (!phaseState) return null;
    const { bossData, currentPhaseIndex } = phaseState;
    const phaseName = currentPhaseIndex >= 0
      ? bossData.phases[currentPhaseIndex].name
      : '初始阶段';
    return { phaseName, phaseIndex: currentPhaseIndex + 1, totalPhases: bossData.phases.length + 1 };
  }

  /** 获取指定敌人当前使用的意图池（考虑 Boss 阶段） */
  private getEnemyIntents(enemy: Enemy, index: number): IntentOption[] {
    const phaseState = this.bossPhases.get(index);
    if (phaseState && phaseState.currentPhaseIndex >= 0) {
      return phaseState.bossData.phases[phaseState.currentPhaseIndex].intents;
    }
    return enemy.data.intents;
  }

  // ============ 辅助方法 ============

  aliveEnemies(): Enemy[] {
    return this.state.enemies.filter(e => e.hp > 0);
  }

  private checkEnemyDeaths(): void {
    for (const enemy of this.state.enemies) {
      if (enemy.hp <= 0 && enemy.currentIntent !== null) {
        this.addLog(enemy.data.name, '死亡', '被击败');
        enemy.currentIntent = null;
        this.triggerPassives('on_kill');
      }
    }
  }

  private addLog(actor: string, action: string, detail: string): void {
    this.log.push({ turn: this.state.turn, actor, action, detail });
  }

  isOver(): boolean {
    return this.state.phase === 'victory' || this.state.phase === 'defeat';
  }

  /** 获取可用的槽位技能（已装备且不为空） */
  getUsableSlots(): { index: number; slot: SkillSlot }[] {
    return this.state.player.slots
      .map((slot, index) => ({ index, slot }))
      .filter(({ slot }) => slot.skill !== null);
  }

  /** 大招是否可用 */
  isUltimateReady(): boolean {
    const ultSlot = this.state.player.slots.find(s => s.type === 'ultimate');
    return !!ultSlot?.skill && this.state.player.resonance >= RESONANCE_MAX;
  }
}
