/**
 * 战斗 UI — Hades 式技能槽版本
 * 固有技能（基础攻击/防御）+ 5 个技能槽 + 共鸣值条 + 被动栏
 */

import { Combat, CombatConfig } from '../core/combat';
import type { SkillData, InnateSkilData, EnemyData, Enemy, StatusInstance, Effect, SkillSlot, PassiveData } from '../core/types';
import { RESONANCE_MAX } from '../core/types';
import { STATUS_DEFS } from '../core/status';
import type { StatusId } from '../core/types';

import innateSkills from '../data/skills/innate.json';
import slotsPool from '../data/skills/slots.json';
import act1Enemies from '../data/enemies/act1.json';

/** 状态机制说明文本 */
const STATUS_TOOLTIPS: Record<StatusId, string> = {
  burn: '燃烧：每回合受到等于层数的伤害，并对其他敌人各造成 1 点溅射。每回合衰减 1 层。',
  poison: '中毒：每回合受到等于层数的伤害。每回合衰减 1 层。',
  weak: '虚弱：造成的伤害减少 25%。每回合衰减 1 层。',
  vulnerable: '易伤：受到的伤害增加 50%。每回合衰减 1 层。',
  strength_up: '力量提升：每层使伤害 +1。不会衰减。',
};

/** 生成带 CSS tooltip 的状态名称 HTML */
function statusWithTooltip(statusId: StatusId, text?: string): string {
  const def = STATUS_DEFS[statusId];
  const tooltip = STATUS_TOOLTIPS[statusId];
  const displayText = text || def.name;
  return `<span class="has-tooltip ${def.isDebuff ? 'debuff' : 'buff'}" data-tooltip="${tooltip}">${displayText}</span>`;
}

/** 格式化状态列表 */
function formatStatuses(statuses: StatusInstance[]): string {
  if (statuses.length === 0) return '';
  return statuses
    .map(s => {
      const def = STATUS_DEFS[s.id];
      const tooltip = STATUS_TOOLTIPS[s.id];
      return `<span class="status-tag ${def.isDebuff ? 'debuff' : 'buff'} has-tooltip" data-tooltip="${tooltip}">${def.name}×${s.stacks}</span>`;
    })
    .join(' ');
}

/** 根据效果生成描述 */
function describeEffects(effects: Effect[], target?: string): string {
  const parts: string[] = [];
  if (target === 'all_enemies') {
    parts.push('<span class="aoe-tag">群攻</span>');
  }
  for (const eff of effects) {
    switch (eff.type) {
      case 'damage': parts.push(`${eff.value} 伤害`); break;
      case 'heal': parts.push(`恢复 ${eff.value} HP`); break;
      case 'shield': parts.push(`${eff.value} 护盾`); break;
      case 'apply_status':
        if (eff.status) {
          const statusHtml = statusWithTooltip(eff.status);
          parts.push(`${eff.stacks || 1} 层${statusHtml}`);
        }
        break;
      case 'gain_ap': parts.push(`+${eff.value} AP`); break;
    }
  }
  return parts.join('，');
}

/**
 * 根据层数和难度从敌人池中选敌
 * - 层 1-2：tier 1（前期弱敌）
 * - 层 3-4：tier 1+2（过渡）
 * - 层 5-6：tier 2+3（中后期）
 * - 层 7+：tier 3（强敌）
 * - 精英战：可选 tier 上浮 1 级
 * - 数量：前期 2 个，后期 2-3 个
 */
function pickEnemies(pool: EnemyData[], seed: number, floor = 1, isElite = false): EnemyData[] {
  // 确定允许的 tier 范围
  let allowedTiers: number[];
  if (floor <= 2) {
    allowedTiers = [1];
  } else if (floor <= 4) {
    allowedTiers = [1, 2];
  } else if (floor <= 6) {
    allowedTiers = [2, 3];
  } else {
    allowedTiers = [3];
  }

  // 精英战允许更高 tier
  if (isElite) {
    const maxTier = Math.max(...allowedTiers);
    if (maxTier < 3 && !allowedTiers.includes(maxTier + 1)) {
      allowedTiers.push(maxTier + 1);
    }
  }

  // 筛选符合 tier 的敌人
  let eligible = pool.filter(e => allowedTiers.includes(e.tier ?? 1));
  if (eligible.length === 0) eligible = pool; // fallback

  // 确定数量：前期 2 个，后期可能 3 个
  const count = (floor >= 4 && seed % 3 !== 0) ? 3 : 2;

  // 确定性 shuffle
  const shuffled = [...eligible].sort((a, b) => {
    const ha = (seed * 31 + a.id.charCodeAt(0)) % 997;
    const hb = (seed * 31 + b.id.charCodeAt(0)) % 997;
    return ha - hb;
  });
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

/** 槽位类型中文名 */
function slotTypeName(type: string): string {
  switch (type) {
    case 'light_a': return '轻击A';
    case 'light_b': return '轻击B';
    case 'heavy': return '重击';
    case 'support': return '辅助';
    case 'ultimate': return '大招';
    default: return type;
  }
}

/** 外部配置（由 Game 驱动时使用） */
export interface CombatUIConfig {
  playerHp: number;
  playerMaxHp: number;
  playerMaxAp: number;
  innateSkills: InnateSkilData[];
  slots: SkillSlot[];
  passives: PassiveData[];
  enemies: EnemyData[];
  seed: number;
  /** 当前层数（从 1 开始） */
  floor?: number;
  isElite?: boolean;
  isBoss?: boolean;
  /** 遗物提供的初始护盾 */
  playerStartShield?: number;
  onCombatEnd?: (result: 'victory' | 'defeat') => void;
}

/** 战斗 UI 控制器 */
export class CombatUI {
  private combat: Combat;
  private container: HTMLElement;
  private logEl: HTMLElement;
  private stateEl: HTMLElement;
  private actionsEl: HTMLElement;
  private messageEl: HTMLElement;
  private onCombatEnd?: (result: 'victory' | 'defeat') => void;

  constructor(container: HTMLElement, externalConfig?: CombatUIConfig) {
    this.container = container;
    this.container.innerHTML = `
      <div id="combat-wrapper">
        <h1>残响轮回 — 战斗</h1>
        <div id="combat-state"></div>
        <div id="combat-message"></div>
        <div id="combat-actions"></div>
        <div id="combat-log"></div>
      </div>
    `;

    this.stateEl = document.getElementById('combat-state')!;
    this.messageEl = document.getElementById('combat-message')!;
    this.actionsEl = document.getElementById('combat-actions')!;
    this.logEl = document.getElementById('combat-log')!;

    if (externalConfig) {
      this.onCombatEnd = externalConfig.onCombatEnd;
      // Boss 战直接使用传入的敌人数据，普通战使用 pickEnemies 筛选
      const selectedEnemies = externalConfig.isBoss
        ? externalConfig.enemies
        : pickEnemies(
            externalConfig.enemies,
            externalConfig.seed,
            externalConfig.floor ?? 1,
            externalConfig.isElite ?? false,
          );
      const config: CombatConfig = {
        playerHp: externalConfig.playerHp,
        playerMaxAp: externalConfig.playerMaxAp,
        innateSkills: externalConfig.innateSkills,
        slots: externalConfig.slots,
        passives: externalConfig.passives,
        enemies: selectedEnemies,
        seed: externalConfig.seed,
      };
      this.combat = new Combat(config);
      // 应用遗物初始护盾
      if (externalConfig.playerStartShield && externalConfig.playerStartShield > 0) {
        this.combat.state.player.shield = externalConfig.playerStartShield;
      }
      const label = externalConfig.isBoss ? '👑 Boss战' : externalConfig.isElite ? '💀 精英战' : '⚔️ 战斗';
      const bossTitle = externalConfig.isBoss && selectedEnemies.length > 0 && 'title' in selectedEnemies[0]
        ? ` — ${(selectedEnemies[0] as any).title}`
        : '';
      this.addLogLine(`${label}${bossTitle} 开始！遇敌: ${selectedEnemies.map(e => e.name).join('、')}`);
    } else {
      // 独立模式（调试用）
      const seed = Math.floor(Math.random() * 100000);
      const selectedEnemies = pickEnemies(act1Enemies as EnemyData[], seed);
      const config: CombatConfig = {
        playerHp: 75,
        playerMaxAp: 4,
        innateSkills: innateSkills as InnateSkilData[],
        slots: [
          { type: 'light_a', skill: null },
          { type: 'light_b', skill: null },
          { type: 'heavy', skill: null },
          { type: 'support', skill: null },
          { type: 'ultimate', skill: null },
        ],
        passives: [],
        enemies: selectedEnemies,
        seed,
      };
      this.combat = new Combat(config);
      this.addLogLine(`⏰ 战斗开始！遇敌: ${selectedEnemies.map(e => e.name).join('、')} | 种子: ${seed}`);
    }

    this.render();
  }

  getPlayerHp(): number {
    return this.combat.state.player.hp;
  }

  private render(): void {
    this.renderState();
    this.renderActions();
  }

  private renderState(): void {
    const { player, enemies, turn, phase } = this.combat.state;

    let html = `<div class="turn-info">第 ${turn} 回合 — ${this.phaseLabel(phase)}</div>`;

    // 玩家状态
    html += `<div class="player-status">`;
    html += `<strong>🛡 守钟人</strong> `;
    html += `HP: ${player.hp}/${player.maxHp}`;
    if (player.shield > 0) html += ` | 护盾: ${player.shield}`;
    html += ` | AP: ${player.ap}/${player.maxAp}`;
    html += ` | <span class="resonance-display">共鸣: ${player.resonance}/${RESONANCE_MAX}</span>`;
    const playerStatuses = formatStatuses(player.statuses);
    if (playerStatuses) html += ` | ${playerStatuses}`;
    html += `</div>`;

    // 共鸣值条
    const resonancePct = (player.resonance / RESONANCE_MAX) * 100;
    const resonanceFull = player.resonance >= RESONANCE_MAX;
    html += `<div class="resonance-bar-wrapper">`;
    html += `<div class="resonance-bar ${resonanceFull ? 'full' : ''}" style="width: ${resonancePct}%"></div>`;
    html += `</div>`;

    // 被动技能展示
    if (player.passives.length > 0) {
      html += `<div class="passives-bar">`;
      for (const p of player.passives) {
        html += `<span class="passive-tag has-tooltip" data-tooltip="${p.desc}">${p.name}</span>`;
      }
      html += `</div>`;
    }

    // 敌人状态
    html += `<div class="enemies-status">`;
    for (let ei = 0; ei < enemies.length; ei++) {
      const enemy = enemies[ei];
      if (enemy.hp <= 0) {
        html += `<div class="enemy dead">💀 ${enemy.data.name} — 已击败</div>`;
        continue;
      }
      // Boss 特殊展示
      const bossInfo = this.combat.getBossPhaseInfo(ei);
      const namePrefix = bossInfo ? '👑' : '👹';
      html += `<div class="enemy${bossInfo ? ' boss-enemy' : ''}">`;
      html += `<strong>${namePrefix} ${enemy.data.name}</strong> `;
      html += `HP: ${enemy.hp}/${enemy.data.hp}`;
      if (enemy.shield > 0) html += ` | 护盾: ${enemy.shield}`;
      if (bossInfo) {
        html += ` | <span class="boss-phase">阶段: ${bossInfo.phaseName} (${bossInfo.phaseIndex}/${bossInfo.totalPhases})</span>`;
      }
      const enemyStatuses = formatStatuses(enemy.statuses);
      if (enemyStatuses) html += ` | ${enemyStatuses}`;
      html += ` | 意图: ${this.formatIntent(enemy)}`;
      html += `</div>`;
    }
    html += `</div>`;

    this.stateEl.innerHTML = html;
  }

  private renderActions(): void {
    const { phase, player } = this.combat.state;

    if (phase === 'victory') {
      this.actionsEl.innerHTML = '';
      this.messageEl.innerHTML = `<div class="result victory">🎉 胜利！</div>`;
      if (this.onCombatEnd) {
        const btn = document.createElement('button');
        btn.className = 'restart-btn';
        btn.textContent = '继续 →';
        btn.addEventListener('click', () => this.onCombatEnd!('victory'));
        this.actionsEl.appendChild(btn);
      } else {
        this.addRestartButton();
      }
      return;
    }
    if (phase === 'defeat') {
      this.actionsEl.innerHTML = '';
      this.messageEl.innerHTML = `<div class="result defeat">💀 守钟人倒下了...</div>`;
      if (this.onCombatEnd) {
        const btn = document.createElement('button');
        btn.className = 'restart-btn';
        btn.textContent = '结算 →';
        btn.addEventListener('click', () => this.onCombatEnd!('defeat'));
        this.actionsEl.appendChild(btn);
      } else {
        this.addRestartButton();
      }
      return;
    }

    if (phase !== 'player_turn') {
      this.actionsEl.innerHTML = '<p class="enemy-acting">⏳ 敌人行动中...</p>';
      return;
    }

    this.messageEl.innerHTML = '';

    let html = '<div class="skill-panel">';

    // 固有技能区
    html += '<div class="innate-skills">';
    html += '<div class="section-label">固有</div>';
    for (let i = 0; i < player.innateSkills.length; i++) {
      const skill = player.innateSkills[i];
      const canUse = player.ap >= skill.apCost;
      html += `<button class="skill-btn innate-btn" data-type="innate" data-index="${i}" ${canUse ? '' : 'disabled'}>`;
      html += `<span class="skill-name">${skill.name} [${skill.apCost}AP]</span>`;
      html += `<span class="skill-desc">${describeEffects(skill.effects, skill.target)}</span>`;
      html += `</button>`;
    }
    html += '</div>';

    // 槽位技能区
    html += '<div class="slot-skills">';
    html += '<div class="section-label">技能槽</div>';
    for (let i = 0; i < player.slots.length; i++) {
      const slot = player.slots[i];
      if (!slot.skill) {
        // 空槽
        html += `<button class="skill-btn empty-slot" disabled>`;
        html += `<span class="skill-name">${slotTypeName(slot.type)}</span>`;
        html += `<span class="skill-desc">— 空 —</span>`;
        html += `</button>`;
      } else {
        const skill = slot.skill;
        let canUse: boolean;
        if (slot.type === 'ultimate') {
          canUse = player.resonance >= RESONANCE_MAX;
        } else {
          canUse = player.ap >= skill.apCost;
        }
        const costLabel = slot.type === 'ultimate' ? `[共鸣]` : `[${skill.apCost}AP]`;
        html += `<button class="skill-btn slot-btn ${slot.type}-btn ${canUse ? '' : 'locked'}" data-type="slot" data-index="${i}" ${canUse ? '' : 'disabled'}>`;
        html += `<span class="slot-label">${slotTypeName(slot.type)}</span>`;
        html += `<span class="skill-name">${skill.name} ${costLabel}</span>`;
        html += `<span class="skill-desc">${describeEffects(skill.effects, skill.target)}</span>`;
        html += `</button>`;
      }
    }
    html += '</div>';

    // 结束回合
    html += `<button class="end-turn-btn">结束回合</button>`;
    html += '</div>';

    this.actionsEl.innerHTML = html;

    // 绑定事件
    this.actionsEl.querySelectorAll('.skill-btn:not(:disabled)').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const button = (e.target as HTMLElement).closest('.skill-btn') as HTMLElement;
        if (!button) return;
        const type = button.dataset.type;
        const index = parseInt(button.dataset.index!);
        if (type === 'innate') {
          this.onInnateSelected(index);
        } else if (type === 'slot') {
          this.onSlotSelected(index);
        }
      });
    });

    this.actionsEl.querySelector('.end-turn-btn')?.addEventListener('click', () => {
      this.onEndTurn();
    });
  }

  private onInnateSelected(innateIndex: number): void {
    const skill = this.combat.state.player.innateSkills[innateIndex];
    if (skill.target === 'self') {
      this.executeInnate(innateIndex, 0);
    } else {
      const alive = this.combat.aliveEnemies().map((e, i) => ({
        enemy: e,
        index: this.combat.state.enemies.indexOf(e),
      }));
      if (alive.length === 1) {
        this.executeInnate(innateIndex, alive[0].index);
      } else {
        this.showTargetSelection('innate', innateIndex, alive);
      }
    }
  }

  private onSlotSelected(slotIndex: number): void {
    const slot = this.combat.state.player.slots[slotIndex];
    if (!slot.skill) return;

    if (slot.skill.target === 'self' || slot.skill.target === 'all_enemies') {
      this.executeSlot(slotIndex, 0);
    } else {
      const alive = this.combat.aliveEnemies().map((e) => ({
        enemy: e,
        index: this.combat.state.enemies.indexOf(e),
      }));
      if (alive.length === 1) {
        this.executeSlot(slotIndex, alive[0].index);
      } else {
        this.showTargetSelection('slot', slotIndex, alive);
      }
    }
  }

  private showTargetSelection(type: 'innate' | 'slot', skillIndex: number, targets: { enemy: Enemy; index: number }[]): void {
    this.messageEl.innerHTML = '<p>选择目标：</p>';
    let html = '<div class="target-buttons">';
    for (const { enemy, index } of targets) {
      html += `<button class="target-btn" data-target="${index}">${enemy.data.name} (HP: ${enemy.hp})</button>`;
    }
    html += `<button class="cancel-btn">取消</button>`;
    html += '</div>';
    this.actionsEl.innerHTML = html;

    this.actionsEl.querySelectorAll('.target-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const button = (e.target as HTMLElement).closest('.target-btn') as HTMLElement;
        if (!button) return;
        const targetIdx = parseInt(button.dataset.target!);
        if (type === 'innate') this.executeInnate(skillIndex, targetIdx);
        else this.executeSlot(skillIndex, targetIdx);
      });
    });

    this.actionsEl.querySelector('.cancel-btn')!.addEventListener('click', () => {
      this.render();
    });
  }

  private executeInnate(innateIndex: number, targetIndex: number): void {
    const prevLogLen = this.combat.log.length;
    const success = this.combat.useInnateSkill(innateIndex, targetIndex);
    if (!success) {
      this.messageEl.innerHTML = '<p class="error">无法使用！</p>';
      return;
    }
    this.flushLogs(prevLogLen);
    this.render();
  }

  private executeSlot(slotIndex: number, targetIndex: number): void {
    const prevLogLen = this.combat.log.length;
    const success = this.combat.useSlotSkill(slotIndex, targetIndex);
    if (!success) {
      this.messageEl.innerHTML = '<p class="error">无法使用！</p>';
      return;
    }
    this.flushLogs(prevLogLen);
    this.render();
  }

  private flushLogs(fromIndex: number): void {
    for (let i = fromIndex; i < this.combat.log.length; i++) {
      const entry = this.combat.log[i];
      this.addLogLine(`[回合${entry.turn}] ${entry.actor} → ${entry.action}: ${entry.detail}`);
    }
  }

  private async onEndTurn(): Promise<void> {
    this.actionsEl.innerHTML = '<p class="enemy-acting">⏳ 敌人行动中...</p>';

    const prevLogLen = this.combat.log.length;
    this.combat.endPlayerTurn();

    const newEntries = this.combat.log.slice(prevLogLen);
    for (const entry of newEntries) {
      this.addLogLine(`[回合${entry.turn}] ${entry.actor} → ${entry.action}: ${entry.detail}`);
      this.renderState();
      await this.delay(600);
    }

    if (!this.combat.isOver()) {
      this.addLogLine(`--- 第 ${this.combat.state.turn} 回合开始 ---`);
    }

    this.render();
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private addRestartButton(): void {
    const btn = document.createElement('button');
    btn.className = 'restart-btn';
    btn.textContent = '🔄 再来一局';
    btn.addEventListener('click', () => {
      this.logEl.innerHTML = '';
      // 重新创建独立模式战斗
      const seed = Math.floor(Math.random() * 100000);
      const selectedEnemies = pickEnemies(act1Enemies as EnemyData[], seed);
      const config: CombatConfig = {
        playerHp: 75,
        playerMaxAp: 4,
        innateSkills: innateSkills as InnateSkilData[],
        slots: [
          { type: 'light_a', skill: null },
          { type: 'light_b', skill: null },
          { type: 'heavy', skill: null },
          { type: 'support', skill: null },
          { type: 'ultimate', skill: null },
        ],
        passives: [],
        enemies: selectedEnemies,
        seed,
      };
      this.combat = new Combat(config);
      this.addLogLine(`⏰ 新战斗开始！遇敌: ${selectedEnemies.map(e => e.name).join('、')}`);
      this.render();
    });
    this.actionsEl.appendChild(btn);
  }

  private addLogLine(text: string): void {
    const line = document.createElement('div');
    line.className = 'log-line';
    line.textContent = text;
    this.logEl.appendChild(line);
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  private phaseLabel(phase: string): string {
    switch (phase) {
      case 'player_turn': return '你的回合';
      case 'enemy_turn': return '敌人回合';
      case 'victory': return '胜利';
      case 'defeat': return '失败';
      default: return phase;
    }
  }

  private formatIntent(enemy: Enemy): string {
    const intent = enemy.currentIntent;
    if (!intent) return '???';
    switch (intent.action) {
      case 'attack': return `⚔️ 攻击 ${intent.value}`;
      case 'defend': return `🛡 防御 ${intent.value}`;
      case 'buff': return `⬆️ 强化`;
      case 'debuff': return `⬇️ 削弱`;
      default: return '???';
    }
  }
}
