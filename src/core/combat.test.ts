import { describe, it, expect } from 'vitest';
import { Combat, CombatConfig } from './combat';
import type { SkillData, EnemyData, InnateSkilData, SkillSlot, PassiveData } from './types';
import { RESONANCE_MAX } from './types';

// ========== 测试用数据 ==========

/** 固有技能 */
const innateAttack: InnateSkilData = {
  id: 'innate_attack',
  name: '基础攻击',
  apCost: 1,
  target: 'single_enemy',
  effects: [{ type: 'damage', value: 4 }],
};

const innateDefend: InnateSkilData = {
  id: 'innate_defend',
  name: '基础防御',
  apCost: 1,
  target: 'self',
  effects: [{ type: 'shield', value: 4 }],
};

/** 槽位技能 */
const fireJab: SkillData = {
  id: 'light_a_flame_jab',
  name: '焰刺',
  apCost: 1,
  target: 'single_enemy',
  effects: [
    { type: 'damage', value: 5 },
    { type: 'apply_status', status: 'burn', stacks: 2 },
  ],
  tags: ['fire'],
  slotType: 'light_a',
  desc: '快速刺击附带灼烧',
};

const sparkChain: SkillData = {
  id: 'light_b_spark_chain',
  name: '弧光连击',
  apCost: 1,
  target: 'all_enemies',
  effects: [{ type: 'damage', value: 3 }],
  tags: ['fire', 'aoe'],
  slotType: 'light_b',
  desc: '火花弹射全体敌人',
};

const heavyDemolish: SkillData = {
  id: 'heavy_demolish',
  name: '粉碎',
  apCost: 3,
  target: 'single_enemy',
  effects: [{ type: 'damage', value: 18 }],
  tags: ['physical'],
  slotType: 'heavy',
  desc: '全力一击',
};

const supportIronWall: SkillData = {
  id: 'support_iron_wall',
  name: '铁壁',
  apCost: 1,
  target: 'self',
  effects: [{ type: 'shield', value: 10 }],
  tags: ['defense'],
  slotType: 'support',
  desc: '坚实防护',
};

const ultTimeShatter: SkillData = {
  id: 'ult_time_shatter',
  name: '时间断裂',
  apCost: 0,
  target: 'all_enemies',
  effects: [
    { type: 'damage', value: 15 },
    { type: 'apply_status', status: 'vulnerable', stacks: 2 },
  ],
  tags: ['temporal', 'aoe'],
  slotType: 'ultimate',
  desc: '撕裂时间洪流',
};

/** 测试用敌人 */
const shade: EnemyData = {
  id: 'enemy_shade',
  name: '残影',
  hp: 30,
  intents: [
    { weight: 60, action: 'attack', value: 6 },
    { weight: 40, action: 'defend', value: 5 },
  ],
};

const clockSpider: EnemyData = {
  id: 'enemy_clock_spider',
  name: '钟蛛',
  hp: 45,
  intents: [
    { weight: 40, action: 'attack', value: 8 },
    { weight: 30, action: 'defend', value: 6 },
    { weight: 30, action: 'debuff', value: 2, status: 'weak' },
  ],
};

/** 被动技能 */
const passiveThickSkin: PassiveData = {
  id: 'passive_thick_skin',
  name: '厚甲',
  desc: '每回合开始获得 2 点护盾',
  trigger: 'on_turn_start',
  effects: [{ type: 'shield', value: 2 }],
  tags: ['defense'],
};

const passiveResonanceEcho: PassiveData = {
  id: 'passive_resonance_echo',
  name: '共鸣回响',
  desc: '释放大招后获得 2 AP',
  trigger: 'on_ultimate',
  effects: [{ type: 'gain_ap', value: 2 }],
  tags: ['ultimate'],
};

// ========== 辅助 ==========

function createSlots(overrides: Partial<Record<string, SkillData | null>> = {}): SkillSlot[] {
  return [
    { type: 'light_a', skill: overrides.light_a ?? null },
    { type: 'light_b', skill: overrides.light_b ?? null },
    { type: 'heavy', skill: overrides.heavy ?? null },
    { type: 'support', skill: overrides.support ?? null },
    { type: 'ultimate', skill: overrides.ultimate ?? null },
  ];
}

function createCombat(opts: {
  enemies?: EnemyData[];
  seed?: number;
  slots?: SkillSlot[];
  passives?: PassiveData[];
  playerHp?: number;
  playerMaxAp?: number;
} = {}): Combat {
  const config: CombatConfig = {
    playerHp: opts.playerHp ?? 75,
    playerMaxAp: opts.playerMaxAp ?? 4,
    innateSkills: [innateAttack, innateDefend],
    slots: opts.slots ?? createSlots({ light_a: fireJab }),
    passives: opts.passives ?? [],
    enemies: opts.enemies ?? [shade],
    seed: opts.seed ?? 42,
  };
  return new Combat(config);
}

// ========== 测试 ==========

describe('Combat - Hades 式技能槽战斗', () => {
  describe('初始化', () => {
    it('正确初始化玩家状态', () => {
      const combat = createCombat();
      const { player } = combat.state;

      expect(player.hp).toBe(75);
      expect(player.maxHp).toBe(75);
      expect(player.ap).toBe(4);
      expect(player.shield).toBe(0);
      expect(player.resonance).toBe(0);
      expect(player.innateSkills).toHaveLength(2);
      expect(player.slots).toHaveLength(5);
    });

    it('初始阶段为玩家回合', () => {
      const combat = createCombat();
      expect(combat.state.phase).toBe('player_turn');
      expect(combat.state.turn).toBe(1);
    });

    it('敌人初始有意图', () => {
      const combat = createCombat();
      expect(combat.state.enemies[0].currentIntent).not.toBeNull();
    });

    it('相同种子产生相同意图', () => {
      const c1 = createCombat({ seed: 123 });
      const c2 = createCombat({ seed: 123 });
      expect(c1.state.enemies[0].currentIntent).toEqual(c2.state.enemies[0].currentIntent);
    });
  });

  describe('固有技能', () => {
    it('基础攻击消耗 1 AP，造成 4 伤害', () => {
      const combat = createCombat();
      combat.useInnateSkill(0, 0); // 基础攻击
      expect(combat.state.player.ap).toBe(3);
      expect(combat.state.enemies[0].hp).toBe(30 - 4);
    });

    it('基础防御消耗 1 AP，加 4 护盾', () => {
      const combat = createCombat();
      combat.useInnateSkill(1, 0); // 基础防御
      expect(combat.state.player.ap).toBe(3);
      expect(combat.state.player.shield).toBe(4);
    });

    it('AP 不足时无法使用', () => {
      const combat = createCombat({ playerMaxAp: 1 });
      combat.useInnateSkill(0, 0); // 用掉 1 AP
      const result = combat.useInnateSkill(0, 0);
      expect(result).toBe(false);
    });

    it('使用固有技能增加 1 点共鸣', () => {
      const combat = createCombat();
      expect(combat.state.player.resonance).toBe(0);
      combat.useInnateSkill(0, 0);
      expect(combat.state.player.resonance).toBe(1);
    });
  });

  describe('槽位技能', () => {
    it('使用轻击A（焰刺）消耗 AP 并造成效果', () => {
      const combat = createCombat();
      combat.useSlotSkill(0, 0); // light_a = 焰刺
      expect(combat.state.player.ap).toBe(3);
      expect(combat.state.enemies[0].hp).toBe(30 - 5);
      const burn = combat.state.enemies[0].statuses.find(s => s.id === 'burn');
      expect(burn).toBeDefined();
      expect(burn!.stacks).toBe(2);
    });

    it('空槽位无法使用', () => {
      const combat = createCombat({ slots: createSlots() }); // 全空
      const result = combat.useSlotSkill(0, 0);
      expect(result).toBe(false);
    });

    it('群攻技能对所有存活敌人生效', () => {
      const slots = createSlots({ light_b: sparkChain });
      const combat = createCombat({ enemies: [shade, clockSpider], slots });
      combat.useSlotSkill(1, 0); // light_b = 弧光连击 (all_enemies)
      expect(combat.state.enemies[0].hp).toBe(30 - 3);
      expect(combat.state.enemies[1].hp).toBe(45 - 3);
    });

    it('辅助技能对自身生效', () => {
      const slots = createSlots({ support: supportIronWall });
      const combat = createCombat({ slots });
      combat.useSlotSkill(3, 0); // support = 铁壁
      expect(combat.state.player.shield).toBe(10);
    });

    it('使用槽位技能增加共鸣值', () => {
      const combat = createCombat();
      combat.useSlotSkill(0, 0);
      expect(combat.state.player.resonance).toBe(1);
    });
  });

  describe('大招与共鸣系统', () => {
    it('共鸣值满时才能释放大招', () => {
      const slots = createSlots({ ultimate: ultTimeShatter });
      const combat = createCombat({ slots });
      // 共鸣未满，无法使用
      const result = combat.useSlotSkill(4, 0);
      expect(result).toBe(false);
    });

    it('大招释放后共鸣归零', () => {
      const slots = createSlots({ ultimate: ultTimeShatter, light_a: fireJab });
      const combat = createCombat({ slots });
      // 手动填满共鸣
      combat.state.player.resonance = RESONANCE_MAX;

      const result = combat.useSlotSkill(4, 0); // ultimate
      expect(result).toBe(true);
      expect(combat.state.player.resonance).toBe(0);
    });

    it('大招不消耗 AP', () => {
      const slots = createSlots({ ultimate: ultTimeShatter });
      const combat = createCombat({ slots });
      combat.state.player.resonance = RESONANCE_MAX;

      const apBefore = combat.state.player.ap;
      combat.useSlotSkill(4, 0);
      expect(combat.state.player.ap).toBe(apBefore); // AP 不变
    });

    it('大招对全体敌人造成伤害', () => {
      const slots = createSlots({ ultimate: ultTimeShatter });
      const combat = createCombat({ slots, enemies: [shade, clockSpider] });
      combat.state.player.resonance = RESONANCE_MAX;

      combat.useSlotSkill(4, 0);
      expect(combat.state.enemies[0].hp).toBe(30 - 15);
      expect(combat.state.enemies[1].hp).toBe(45 - 15);
    });

    it('共鸣值累积到满时记录日志', () => {
      const combat = createCombat();
      combat.state.player.resonance = RESONANCE_MAX - 1;
      const logBefore = combat.log.length;
      combat.useInnateSkill(0, 0); // +1 共鸣 → 满
      const newLogs = combat.log.slice(logBefore);
      const resonanceLog = newLogs.find(l => l.action === '共鸣' && l.detail.includes('满'));
      expect(resonanceLog).toBeDefined();
    });
  });

  describe('被动系统', () => {
    it('on_turn_start 被动在回合开始触发', () => {
      const combat = createCombat({ passives: [passiveThickSkin] });
      // 第一回合开始时就会触发
      expect(combat.state.player.shield).toBe(2);
    });

    it('on_ultimate 被动在大招释放后触发', () => {
      const slots = createSlots({ ultimate: ultTimeShatter });
      const combat = createCombat({ slots, passives: [passiveResonanceEcho] });
      combat.state.player.resonance = RESONANCE_MAX;

      const apBefore = combat.state.player.ap;
      combat.useSlotSkill(4, 0);
      // 大招不消耗 AP，被动增加 2 AP
      expect(combat.state.player.ap).toBe(apBefore + 2);
    });
  });

  describe('护盾机制', () => {
    it('护盾先于 HP 被消耗', () => {
      const combat = createCombat();
      combat.state.player.shield = 10;
      const hpBefore = combat.state.player.hp;

      combat.state.enemies[0].currentIntent = { weight: 100, action: 'attack', value: 6 };
      combat.endPlayerTurn();

      // 6 伤害被 10 护盾吸收，HP 不变（新回合开始护盾清零）
      expect(combat.state.player.hp).toBe(hpBefore);
      expect(combat.state.player.shield).toBe(0); // 新回合清零
    });

    it('护盾不足时剩余伤害扣 HP', () => {
      const combat = createCombat();
      combat.state.player.shield = 3;
      const hpBefore = combat.state.player.hp;

      combat.state.enemies[0].currentIntent = { weight: 100, action: 'attack', value: 6 };
      combat.endPlayerTurn();

      // 3 护盾吸收 3 伤害，剩余 3 点扣 HP
      expect(combat.state.player.hp).toBe(hpBefore - 3);
    });
  });

  describe('状态效果', () => {
    it('燃烧在敌人回合 tick 并衰减', () => {
      const combat = createCombat();
      combat.useSlotSkill(0, 0); // 焰刺：5伤害 + 2 层燃烧

      const enemy = combat.state.enemies[0];
      const hpAfter = enemy.hp; // 30 - 5 = 25

      enemy.currentIntent = { weight: 100, action: 'defend', value: 5 };
      combat.endPlayerTurn();

      // 2 层燃烧 = 2 点伤害，然后衰减到 1 层
      expect(enemy.hp).toBe(hpAfter - 2);
      const burn = enemy.statuses.find(s => s.id === 'burn');
      expect(burn!.stacks).toBe(1);
    });

    it('燃烧溅射对其他敌人造成 1 点伤害', () => {
      const combat = createCombat({ enemies: [shade, clockSpider] });
      // 对残影施加燃烧
      combat.useSlotSkill(0, 0); // 焰刺 → 残影

      const enemy1 = combat.state.enemies[1]; // 钟蛛
      const hp1Before = enemy1.hp; // 45

      combat.state.enemies[0].currentIntent = { weight: 100, action: 'defend', value: 5 };
      combat.state.enemies[1].currentIntent = { weight: 100, action: 'defend', value: 5 };
      combat.endPlayerTurn();

      // 残影燃烧时，钟蛛应受 1 点溅射
      expect(enemy1.hp).toBe(hp1Before - 1);
    });
  });

  describe('回合流转', () => {
    it('结束回合后回到玩家回合，turn +1', () => {
      const combat = createCombat();
      combat.state.enemies[0].currentIntent = { weight: 100, action: 'defend', value: 5 };
      combat.endPlayerTurn();

      expect(combat.state.phase).toBe('player_turn');
      expect(combat.state.turn).toBe(2);
    });

    it('新回合恢复 AP', () => {
      const combat = createCombat();
      combat.useInnateSkill(0, 0); // -1 AP
      expect(combat.state.player.ap).toBe(3);

      combat.state.enemies[0].currentIntent = { weight: 100, action: 'defend', value: 5 };
      combat.endPlayerTurn();

      expect(combat.state.player.ap).toBe(4); // 满 AP
    });

    it('护盾在新回合清零', () => {
      const combat = createCombat();
      combat.useInnateSkill(1, 0); // +4 护盾
      expect(combat.state.player.shield).toBe(4);

      combat.state.enemies[0].currentIntent = { weight: 100, action: 'defend', value: 5 };
      combat.endPlayerTurn();

      expect(combat.state.player.shield).toBe(0);
    });
  });

  describe('胜负判定', () => {
    it('敌人 HP 归零判定胜利', () => {
      const weakEnemy: EnemyData = { id: 'weak', name: '弱鸡', hp: 3, intents: [{ weight: 100, action: 'defend', value: 1 }] };
      const combat = createCombat({ enemies: [weakEnemy] });
      combat.useInnateSkill(0, 0); // 4 伤害 > 3 HP
      expect(combat.state.phase).toBe('victory');
    });

    it('玩家 HP 归零判定失败', () => {
      const strongEnemy: EnemyData = { id: 'strong', name: '巨兽', hp: 999, intents: [{ weight: 100, action: 'attack', value: 100 }] };
      const combat = createCombat({ enemies: [strongEnemy] });
      combat.endPlayerTurn();
      expect(combat.state.phase).toBe('defeat');
    });
  });

  describe('完整战斗模拟', () => {
    it('只用固有技能能打赢残影', () => {
      const combat = createCombat({ slots: createSlots() }); // 无槽位技能
      let turns = 0;
      const maxTurns = 20;

      while (!combat.isOver() && turns < maxTurns) {
        turns++;
        while (combat.state.player.ap >= 1 && combat.state.phase === 'player_turn') {
          combat.useInnateSkill(0, 0); // 基础攻击
          if (combat.isOver()) break;
        }
        if (!combat.isOver()) combat.endPlayerTurn();
      }

      expect(combat.isOver()).toBe(true);
      // 残影 30HP，每回合 4×4=16 伤害，2 回合必杀
      expect(combat.state.phase).toBe('victory');
      expect(turns).toBeLessThanOrEqual(3);
    });

    it('带槽位技能的完整战斗', () => {
      const slots = createSlots({ light_a: fireJab, heavy: heavyDemolish });
      const combat = createCombat({ enemies: [clockSpider], slots, seed: 77 });
      let turns = 0;
      const maxTurns = 15;

      while (!combat.isOver() && turns < maxTurns) {
        turns++;
        if (combat.state.phase !== 'player_turn') break;

        // 策略：第一回合重击，之后焰刺+基础攻击
        if (turns === 1 && combat.state.player.ap >= 3) {
          combat.useSlotSkill(2, 0); // heavy = 粉碎 (3AP)
          while (combat.state.player.ap >= 1 && combat.state.phase === 'player_turn') {
            combat.useInnateSkill(0, 0);
            if (combat.isOver()) break;
          }
        } else {
          while (combat.state.player.ap >= 1 && combat.state.phase === 'player_turn') {
            if (combat.state.player.ap >= 1) {
              combat.useSlotSkill(0, 0) || combat.useInnateSkill(0, 0);
            }
            if (combat.isOver()) break;
          }
        }

        if (!combat.isOver() && combat.state.phase === 'player_turn') {
          combat.endPlayerTurn();
        }
      }

      expect(combat.isOver()).toBe(true);
      expect(turns).toBeLessThan(maxTurns);
    });
  });
});
