/**
 * 游戏主控制器
 * 管理地图 ↔ 战斗 ↔ 营地/商店/事件 的场景切换
 * Hades 式技能槽版本
 */

import { generateMap, completeCurrentNode, type GameMap, type MapNode } from '../core/map';
import { MapUI } from './map-ui';
import { CombatUI } from './combat-ui';
import type { EnemyData, SkillData, InnateSkilData, SkillSlot, PassiveData, Effect, RelicData, BossData } from '../core/types';
import { RELIC_SLOT_MAX } from '../core/types';
import { createRelicInventory, addRelic, replaceRelic, isRelicFull, triggerRelics, getPassiveStatBonuses, type RelicInventory, type TriggerContext } from '../core/relics';
import act1Enemies from '../data/enemies/act1.json';
import boss1Data from '../data/enemies/boss1.json';
import innateSkillsData from '../data/skills/innate.json';
import slotsPoolData from '../data/skills/slots.json';
import act1Passives from '../data/passives/act1.json';
import act1Relics from '../data/relics/act1.json';

/** 被动技能池 */
const passivePool: PassiveData[] = act1Passives as PassiveData[];

/** 遗物池 */
const relicPool: RelicData[] = act1Relics as RelicData[];

/** Boss 数据 */
const bossEnemy: BossData = boss1Data as unknown as BossData;

/** 游戏状态 */
type GameScene = 'map' | 'combat' | 'campfire' | 'shop' | 'event' | 'victory' | 'defeat';

/** 局内玩家持久状态（跨战斗保留） */
interface RunState {
  hp: number;
  maxHp: number;
  maxAp: number;
  /** 固有技能 */
  innateSkills: InnateSkilData[];
  /** 5 个技能槽 */
  slots: SkillSlot[];
  /** 已获得的被动技能 */
  passives: PassiveData[];
  /** 遗物背包 */
  relics: RelicInventory;
  /** 金币（本局） */
  gold: number;
}

/** 初始 RunState 工厂 */
function createInitialRunState(): RunState {
  return {
    hp: 75,
    maxHp: 75,
    maxAp: 4,
    innateSkills: innateSkillsData as InnateSkilData[],
    slots: [
      { type: 'light_a', skill: null },
      { type: 'light_b', skill: null },
      { type: 'heavy', skill: null },
      { type: 'support', skill: null },
      { type: 'ultimate', skill: null },
    ],
    passives: [],
    relics: createRelicInventory(),
    gold: 0,
  };
}

/** 游戏主控制器 */
export class Game {
  private container: HTMLElement;
  private scene: GameScene = 'map';
  private map: GameMap;
  private mapUI: MapUI | null = null;
  private combatUI: CombatUI | null = null;
  private runState: RunState;
  private seed: number;

  constructor(container: HTMLElement) {
    this.container = container;
    this.seed = Math.floor(Math.random() * 100000);

    // 生成地图
    this.map = generateMap({ seed: this.seed });

    // 初始化局内状态 — 开始时槽位为空，只有固有技能
    this.runState = createInitialRunState();

    this.showMap();
  }

  /** 显示地图场景 */
  private showMap(): void {
    this.scene = 'map';
    this.container.innerHTML = '';

    // 显示玩家状态栏
    const statusBar = document.createElement('div');
    statusBar.id = 'run-status-bar';
    const filledSlots = this.runState.slots.filter(s => s.skill !== null).length;
    const relicCount = this.runState.relics.relics.length;
    statusBar.innerHTML = `
      <span>❤️ ${this.runState.hp}/${this.runState.maxHp}</span>
      <span>⚡ AP ${this.runState.maxAp}</span>
      <span>🎰 槽位 ${filledSlots}/5</span>
      <span>🏺 遗物 ${relicCount}/${RELIC_SLOT_MAX}</span>
      <span>💰 ${this.runState.gold}</span>
    `;
    this.container.appendChild(statusBar);

    // 显示地图
    const mapContainer = document.createElement('div');
    mapContainer.id = 'map-container';
    this.container.appendChild(mapContainer);

    this.mapUI = new MapUI(mapContainer, this.map, (node) => this.onNodeEntered(node));
  }

  /** 玩家选择进入一个节点 */
  private onNodeEntered(node: MapNode): void {
    switch (node.type) {
      case 'combat':
      case 'elite':
        this.startCombat(node.type === 'elite');
        break;
      case 'boss':
        this.startCombat(false, true);
        break;
      case 'campfire':
        this.showCampfire();
        break;
      case 'shop':
        this.showShop();
        break;
      case 'event':
        this.showEvent();
        break;
    }
  }

  /** 进入战斗 */
  private startCombat(isElite: boolean, isBoss = false): void {
    this.scene = 'combat';
    this.container.innerHTML = '';

    // 触发遗物：on_combat_start
    const combatStartResult = triggerRelics(this.runState.relics, 'on_combat_start', this.getTriggerCtx());
    // 遗物提供的临时护盾和额外 AP 会传入 CombatUI
    const bonusShield = combatStartResult.shieldGain;
    const bonusAp = combatStartResult.apDelta;

    const combatContainer = document.createElement('div');
    combatContainer.id = 'combat-container';
    this.container.appendChild(combatContainer);

    const currentNode = this.map.nodes.find(n => n.status === 'current');
    const floor = currentNode ? currentNode.floor + 1 : 1; // floor 从 0 起，展示从 1 起
    const combatSeed = this.seed + (floor * 100);

    // Boss 战使用专用 Boss 数据，普通战使用敌人池
    const enemyPool: EnemyData[] = isBoss ? [bossEnemy] : (act1Enemies as EnemyData[]);

    this.combatUI = new CombatUI(combatContainer, {
      playerHp: this.runState.hp,
      playerMaxHp: this.runState.maxHp,
      playerMaxAp: this.runState.maxAp + bonusAp,
      playerStartShield: bonusShield,
      innateSkills: this.runState.innateSkills,
      slots: this.runState.slots,
      passives: this.runState.passives,
      enemies: enemyPool,
      seed: combatSeed,
      floor,
      isElite,
      isBoss,
      onCombatEnd: (result) => this.onCombatEnd(result, isElite || isBoss),
    });
  }

  /** 战斗结束回调 */
  private onCombatEnd(result: 'victory' | 'defeat', isEliteOrBoss = false): void {
    if (result === 'defeat') {
      this.showRunEnd(false);
      return;
    }

    // 胜利：更新玩家 HP
    if (this.combatUI) {
      this.runState.hp = this.combatUI.getPlayerHp();
    }

    // 奖励金币
    let goldReward = 15 + Math.floor(Math.random() * 10);

    // 触发遗物：on_combat_end
    const combatEndResult = triggerRelics(this.runState.relics, 'on_combat_end', this.getTriggerCtx());
    goldReward += combatEndResult.goldDelta;
    this.runState.hp = Math.min(this.runState.hp + combatEndResult.hpDelta, this.runState.maxHp);

    this.runState.gold += goldReward;

    // 检查是否是 Boss 战胜利
    const currentNode = this.map.nodes.find(n => n.id === this.map.currentNodeId);
    const isBossVictory = currentNode?.type === 'boss';

    // 完成当前节点
    completeCurrentNode(this.map);

    // Boss 胜利 → 通关
    if (isBossVictory) {
      this.showRunEnd(true);
      return;
    }

    // 精英/Boss 掉落遗物（Boss 已 return，这里只处理精英）
    if (isEliteOrBoss) {
      this.showRelicReward(() => this.showReward());
      return;
    }

    // 普通战斗胜利奖励：技能或被动
    this.showReward();
  }

  /** 获取触发上下文 */
  private getTriggerCtx(): TriggerContext {
    return {
      hp: this.runState.hp,
      maxHp: this.runState.maxHp,
      gold: this.runState.gold,
      maxAp: this.runState.maxAp,
    };
  }

  /** 战斗胜利后的奖励选择：技能和被动混合随机 3 个 */
  private showReward(): void {
    this.container.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.id = 'event-wrapper';
    this.container.appendChild(wrapper);

    const slotNames: Record<string, string> = {
      light_a: '轻击A', light_b: '轻击B', heavy: '重击', support: '辅助', ultimate: '大招'
    };

    // 状态名映射（纯文本，用于奖励描述）
    const statusNames: Record<string, string> = {
      burn: '燃烧', poison: '中毒', weak: '虚弱', vulnerable: '易伤', strength_up: '力量提升'
    };

    // 收集候选：空槽技能 + 未拥有的被动
    type RewardItem = { kind: 'skill'; data: SkillData } | { kind: 'passive'; data: PassiveData };
    const candidates: RewardItem[] = [];

    // 空槽对应的技能
    const emptySlots = this.runState.slots.filter(s => s.skill === null);
    for (const slot of emptySlots) {
      const pool = (slotsPoolData as Record<string, SkillData[]>)[slot.type];
      if (pool) {
        for (const skill of pool) {
          candidates.push({ kind: 'skill', data: skill });
        }
      }
    }

    // 未拥有的被动
    const ownedPassives = new Set(this.runState.passives.map(p => p.id));
    for (const p of passivePool) {
      if (!ownedPassives.has(p.id)) {
        candidates.push({ kind: 'passive', data: p });
      }
    }

    // 无可用奖励时给金币
    if (candidates.length === 0) {
      wrapper.innerHTML = `
        <h1>🎁 奖励</h1>
        <p>已无更多可获取的能力！获得 30 金币作为补偿。</p>
        <div class="event-options">
          <button class="event-btn" data-choice="continue">
            <span class="option-name">继续</span>
            <span class="option-desc">获得 30 金币</span>
          </button>
        </div>
      `;
      this.runState.gold += 30;
      wrapper.querySelector('.event-btn')!.addEventListener('click', () => this.showMap());
      return;
    }

    // 随机取 3 个
    const shuffled = [...candidates].sort(() => Math.random() - 0.5);
    const choices = shuffled.slice(0, Math.min(3, shuffled.length));

    /** 生成效果描述文本 */
    function describeEffects(effects: Effect[]): string {
      if (effects.length === 0) return '';
      const parts: string[] = [];
      for (const eff of effects) {
        switch (eff.type) {
          case 'damage': parts.push(`${eff.value} 伤害`); break;
          case 'heal': parts.push(`恢复 ${eff.value} HP`); break;
          case 'shield': parts.push(`${eff.value} 护盾`); break;
          case 'apply_status':
            if (eff.status) parts.push(`${eff.stacks || 1} 层${statusNames[eff.status] || eff.status}`);
            break;
          case 'gain_ap': parts.push(`+${eff.value} AP`); break;
        }
      }
      return parts.join('、');
    }

    /** 渲染一个奖励选项 */
    function renderChoice(item: RewardItem, index: number): string {
      if (item.kind === 'skill') {
        const skill = item.data;
        const targetLabel = skill.target === 'all_enemies' ? '【群攻】' : skill.target === 'self' ? '【自身】' : '';
        const effectsText = describeEffects(skill.effects);
        const costLabel = skill.slotType === 'ultimate' ? '共鸣释放' : `${skill.apCost} AP`;
        return `
          <button class="event-btn reward-skill" data-choice="${index}">
            <span class="option-name">⚔️ ${skill.name}</span>
            <span class="option-detail">${costLabel} · ${slotNames[skill.slotType]}槽 ${targetLabel}</span>
            <span class="option-effects">${effectsText}</span>
            <span class="option-desc">${skill.desc || ''}</span>
          </button>
        `;
      } else {
        const passive = item.data;
        return `
          <button class="event-btn reward-passive" data-choice="${index}">
            <span class="option-name">🔮 ${passive.name}</span>
            <span class="option-detail">被动 · 永久生效</span>
            <span class="option-desc">${passive.desc}</span>
          </button>
        `;
      }
    }

    wrapper.innerHTML = `
      <h1>⬆️ 战利品</h1>
      <p>选择一项能力：</p>
      <div class="event-options">
        ${choices.map((item, i) => renderChoice(item, i)).join('')}
        <button class="event-btn" data-choice="skip">
          <span class="option-name">跳过</span>
          <span class="option-desc">不选择，继续前进</span>
        </button>
      </div>
    `;

    wrapper.querySelectorAll('.event-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const button = (e.target as HTMLElement).closest('.event-btn') as HTMLElement;
        if (!button) return;
        const choice = button.dataset.choice;
        if (choice === 'skip') {
          this.showMap();
          return;
        }
        const idx = parseInt(choice!);
        const selected = choices[idx];
        if (selected.kind === 'skill') {
          const slotIndex = this.runState.slots.findIndex(s => s.type === selected.data.slotType);
          if (slotIndex >= 0) {
            this.runState.slots[slotIndex].skill = selected.data;
          }
        } else {
          this.runState.passives.push(selected.data);
        }
        this.showMap();
      });
    });
  }

  /** 遗物奖励选择（精英/Boss 掉落） */
  private showRelicReward(onDone: () => void): void {
    this.container.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.id = 'event-wrapper';
    this.container.appendChild(wrapper);

    // 从遗物池中挑选玩家未拥有的 2-3 个
    const owned = new Set(this.runState.relics.relics.map(r => r.id));
    const available = relicPool.filter(r => !owned.has(r.id));

    if (available.length === 0) {
      // 没有可用遗物，直接给金币
      this.runState.gold += 30;
      wrapper.innerHTML = `
        <h1>🏺 遗物</h1>
        <p>已无更多遗物可获取！获得 30 金币作为补偿。</p>
        <div class="event-options">
          <button class="event-btn" data-choice="continue">
            <span class="option-name">继续</span>
          </button>
        </div>
      `;
      wrapper.querySelector('.event-btn')!.addEventListener('click', () => onDone());
      return;
    }

    const shuffled = [...available].sort(() => Math.random() - 0.5);
    const choices = shuffled.slice(0, Math.min(3, shuffled.length));

    const rarityLabel = (r: RelicData) => {
      switch (r.rarity) {
        case 'common': return '普通';
        case 'rare': return '稀有';
        case 'legendary': return '传说';
      }
    };

    wrapper.innerHTML = `
      <h1>🏺 获得遗物</h1>
      <p>选择一件遗物（${this.runState.relics.relics.length}/${RELIC_SLOT_MAX} 已装备）：</p>
      <div class="event-options">
        ${choices.map((relic, i) => `
          <button class="event-btn relic-choice" data-choice="${i}">
            <span class="option-name">🏺 ${relic.name}</span>
            <span class="option-detail">${rarityLabel(relic)}</span>
            <span class="option-desc">${relic.desc}</span>
          </button>
        `).join('')}
        <button class="event-btn" data-choice="skip">
          <span class="option-name">跳过</span>
          <span class="option-desc">不选择遗物</span>
        </button>
      </div>
    `;

    wrapper.querySelectorAll('.event-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const button = (e.target as HTMLElement).closest('.event-btn') as HTMLElement;
        if (!button) return;
        const choice = button.dataset.choice;
        if (choice === 'skip') {
          onDone();
          return;
        }
        const idx = parseInt(choice!);
        const selected = choices[idx];
        this.acquireRelic(selected, onDone);
      });
    });
  }

  /** 获取遗物（处理满槽替换） */
  private acquireRelic(relic: RelicData, onDone: () => void): void {
    if (!isRelicFull(this.runState.relics)) {
      addRelic(this.runState.relics, relic);
      onDone();
      return;
    }

    // 槽位已满，展示替换界面
    this.container.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.id = 'event-wrapper';
    this.container.appendChild(wrapper);

    wrapper.innerHTML = `
      <h1>🏺 遗物已满</h1>
      <p>选择一个遗物替换为「${relic.name}」（${relic.desc}）：</p>
      <div class="event-options">
        ${this.runState.relics.relics.map((r, i) => `
          <button class="event-btn" data-choice="${i}">
            <span class="option-name">🏺 ${r.name}</span>
            <span class="option-desc">${r.desc}</span>
          </button>
        `).join('')}
        <button class="event-btn" data-choice="cancel">
          <span class="option-name">放弃</span>
          <span class="option-desc">不替换，丢弃新遗物</span>
        </button>
      </div>
    `;

    wrapper.querySelectorAll('.event-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const button = (e.target as HTMLElement).closest('.event-btn') as HTMLElement;
        if (!button) return;
        const choice = button.dataset.choice;
        if (choice === 'cancel') {
          onDone();
          return;
        }
        const idx = parseInt(choice!);
        replaceRelic(this.runState.relics, idx, relic);
        onDone();
      });
    });
  }

  /** 营地场景 */
  private showCampfire(): void {
    this.scene = 'campfire';

    // 计算遗物加成的休息恢复
    const restResult = triggerRelics(this.runState.relics, 'on_rest', this.getTriggerCtx());
    const baseHealPercent = 30;
    const bonusPercent = restResult.restBonusPercent;
    const totalPercent = baseHealPercent + bonusPercent;
    const bonusText = bonusPercent > 0 ? `（含遗物加成 +${bonusPercent}%）` : '';

    this.container.innerHTML = `
      <div id="campfire-wrapper">
        <h1>🏕️ 营地</h1>
        <p>火光在残破的钟楼下跳动，你可以短暂休息。</p>
        <div class="campfire-options">
          <button class="campfire-btn" data-action="rest">
            <span class="option-name">休息</span>
            <span class="option-desc">恢复 ${totalPercent}% 最大生命值${bonusText}</span>
          </button>
          <button class="campfire-btn" data-action="train">
            <span class="option-name">冥想</span>
            <span class="option-desc">最大 AP +1（永久）</span>
          </button>
        </div>
      </div>
    `;

    this.container.querySelectorAll('.campfire-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const button = (e.target as HTMLElement).closest('.campfire-btn') as HTMLElement;
        if (!button) return;
        const action = button.dataset.action;
        if (action === 'rest') {
          const heal = Math.floor(this.runState.maxHp * totalPercent / 100);
          this.runState.hp = Math.min(this.runState.hp + heal, this.runState.maxHp);
        } else if (action === 'train') {
          this.runState.maxAp += 1;
        }
        completeCurrentNode(this.map);
        this.showMap();
      });
    });
  }

  /** 商店场景 */
  private showShop(): void {
    this.scene = 'shop';

    // 触发遗物：on_enter_shop（获取折扣）
    const shopResult = triggerRelics(this.runState.relics, 'on_enter_shop', this.getTriggerCtx());
    const discount = shopResult.shopDiscount; // 100 = 无折扣，70 = 7 折
    const discountText = discount < 100 ? ` (${discount / 10} 折)` : '';

    const healPrice = Math.floor(20 * discount / 100);
    const maxHpPrice = Math.floor(30 * discount / 100);
    const relicPrice = Math.floor(50 * discount / 100);

    // 随机挑一个未拥有的遗物作为商店商品
    const owned = new Set(this.runState.relics.relics.map(r => r.id));
    const shopRelics = relicPool.filter(r => !owned.has(r.id));
    const shopRelic = shopRelics.length > 0 ? shopRelics[Math.floor(Math.random() * shopRelics.length)] : null;

    this.container.innerHTML = `
      <div id="shop-wrapper">
        <h1>🛒 商店${discountText}</h1>
        <p>一个蒙面商人从阴影中现身。"需要点什么？"</p>
        <div class="shop-options">
          <button class="shop-btn" data-action="heal">
            <span class="option-name">生命药水（${healPrice} 金）</span>
            <span class="option-desc">恢复 20 HP</span>
          </button>
          <button class="shop-btn" data-action="maxhp">
            <span class="option-name">生命结晶（${maxHpPrice} 金）</span>
            <span class="option-desc">最大生命值 +10</span>
          </button>
          ${shopRelic ? `
          <button class="shop-btn" data-action="relic">
            <span class="option-name">🏺 ${shopRelic.name}（${relicPrice} 金）</span>
            <span class="option-desc">${shopRelic.desc}</span>
          </button>
          ` : ''}
        </div>
        <button class="shop-leave-btn">离开商店</button>
        <div class="shop-gold">💰 当前金币: ${this.runState.gold}</div>
      </div>
    `;

    this.container.querySelectorAll('.shop-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const button = (e.target as HTMLElement).closest('.shop-btn') as HTMLElement;
        if (!button) return;
        const action = button.dataset.action;
        if (action === 'heal' && this.runState.gold >= healPrice) {
          this.runState.gold -= healPrice;
          this.runState.hp = Math.min(this.runState.hp + 20, this.runState.maxHp);
          this.showShop();
        } else if (action === 'maxhp' && this.runState.gold >= maxHpPrice) {
          this.runState.gold -= maxHpPrice;
          this.runState.maxHp += 10;
          this.runState.hp += 10;
          this.showShop();
        } else if (action === 'relic' && shopRelic && this.runState.gold >= relicPrice) {
          this.runState.gold -= relicPrice;
          this.acquireRelic(shopRelic, () => this.showShop());
        }
      });
    });

    this.container.querySelector('.shop-leave-btn')!.addEventListener('click', () => {
      completeCurrentNode(this.map);
      this.showMap();
    });
  }

  /** 随机事件场景 */
  private showEvent(): void {
    this.scene = 'event';

    // 随机事件列表（包含普通事件和遗物事件）
    type EventOption = { name: string; desc: string; action: () => void; giveRelic?: boolean };
    interface GameEvent { title: string; desc: string; option1: EventOption; option2: EventOption; }

    const normalEvents: GameEvent[] = [
      {
        title: '古老的祭坛',
        desc: '你发现了一座被遗忘的祭坛，上面微微发光。',
        option1: { name: '祈祷', desc: '恢复 15 HP', action: () => { this.runState.hp = Math.min(this.runState.hp + 15, this.runState.maxHp); } },
        option2: { name: '献祭', desc: '失去 5 HP，获得 25 金', action: () => { this.runState.hp -= 5; this.runState.gold += 25; } },
      },
      {
        title: '受伤的旅人',
        desc: '一个旅人倒在路边，似乎受了重伤。',
        option1: { name: '救助', desc: '消耗 10 HP，获得 30 金', action: () => { this.runState.hp -= 10; this.runState.gold += 30; } },
        option2: { name: '忽略', desc: '无事发生', action: () => {} },
      },
      {
        title: '时间裂隙',
        desc: '空气中出现了一道细小的裂缝，散发着不稳定的能量。',
        option1: { name: '触碰', desc: '最大 HP +5 或 -5（随机）', action: () => { const r = Math.random() > 0.5 ? 5 : -5; this.runState.maxHp += r; this.runState.hp = Math.min(this.runState.hp, this.runState.maxHp); } },
        option2: { name: '远离', desc: '获得 10 金', action: () => { this.runState.gold += 10; } },
      },
    ];

    // 遗物事件（有未拥有的遗物时才可能出现）
    const owned = new Set(this.runState.relics.relics.map(r => r.id));
    const availableRelics = relicPool.filter(r => !owned.has(r.id));

    const relicEvents: GameEvent[] = availableRelics.length > 0 ? [
      {
        title: '神秘的宝箱',
        desc: '一个古老的宝箱半埋在地下，上面刻着奇异的符文。',
        option1: { name: '打开', desc: '获得一件遗物，但失去 10 HP', action: () => { this.runState.hp -= 10; }, giveRelic: true },
        option2: { name: '警惕离开', desc: '获得 15 金', action: () => { this.runState.gold += 15; } },
      },
    ] : [];

    // 30% 概率触发遗物事件（如果有可用遗物）
    const useRelicEvent = relicEvents.length > 0 && Math.random() < 0.3;
    const events = useRelicEvent ? relicEvents : normalEvents;
    const event = events[Math.floor(Math.random() * events.length)];

    this.container.innerHTML = `
      <div id="event-wrapper">
        <h1>❓ ${event.title}</h1>
        <p class="event-desc">${event.desc}</p>
        <div class="event-options">
          <button class="event-btn" data-choice="1">
            <span class="option-name">${event.option1.name}</span>
            <span class="option-desc">${event.option1.desc}</span>
          </button>
          <button class="event-btn" data-choice="2">
            <span class="option-name">${event.option2.name}</span>
            <span class="option-desc">${event.option2.desc}</span>
          </button>
        </div>
      </div>
    `;

    this.container.querySelectorAll('.event-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const button = (e.target as HTMLElement).closest('.event-btn') as HTMLElement;
        if (!button) return;
        const choice = button.dataset.choice;
        const option = choice === '1' ? event.option1 : event.option2;
        option.action();

        if (this.runState.hp <= 0) {
          this.showRunEnd(false);
          return;
        }

        // 如果选项给予遗物，先展示遗物奖励再继续
        if (option.giveRelic) {
          this.showRelicReward(() => {
            completeCurrentNode(this.map);
            this.showMap();
          });
        } else {
          completeCurrentNode(this.map);
          this.showMap();
        }
      });
    });
  }

  /** 本局结束 */
  private showRunEnd(victory: boolean): void {
    this.scene = victory ? 'victory' : 'defeat';
    const title = victory ? '🎉 黎明到来' : '💀 循环重置';
    const subtitle = victory
      ? '你成功撑过了这一夜。时钟的指针缓缓转动...'
      : '黑暗吞噬了一切。但记忆不会消散...';

    const filledSlots = this.runState.slots.filter(s => s.skill !== null).length;

    const relicNames = this.runState.relics.relics.map(r => r.name).join('、') || '无';

    this.container.innerHTML = `
      <div id="run-end-wrapper">
        <h1>${title}</h1>
        <p>${subtitle}</p>
        <div class="run-stats">
          <p>到达层数: ${this.map.nodes.filter(n => n.status === 'completed').length} / ${this.map.nodes.length}</p>
          <p>获得金币: ${this.runState.gold}</p>
          <p>装备技能: ${filledSlots}/5 槽</p>
          <p>被动技能: ${this.runState.passives.length} 个</p>
          <p>遗物: ${this.runState.relics.relics.length}/${RELIC_SLOT_MAX} — ${relicNames}</p>
        </div>
        <button class="restart-btn" id="new-run-btn">🔄 开始新的循环</button>
      </div>
    `;

    this.container.querySelector('#new-run-btn')!.addEventListener('click', () => {
      this.seed = Math.floor(Math.random() * 100000);
      this.map = generateMap({ seed: this.seed });
      this.runState = createInitialRunState();
      this.showMap();
    });
  }
}
