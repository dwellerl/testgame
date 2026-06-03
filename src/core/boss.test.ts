/**
 * Boss 多阶段系统测试
 */

import { describe, it, expect } from 'vitest';
import { Combat, CombatConfig, isBossData } from './combat';
import type { BossData, InnateSkilData, SkillSlot } from './types';

// 测试用 Boss 数据
const testBoss: BossData = {
  id: 'test_boss',
  name: '测试Boss',
  title: '试炼之主',
  isBoss: true,
  hp: 100,
  tier: 4,
  intents: [
    { weight: 50, action: 'attack', value: 8 },
    { weight: 50, action: 'defend', value: 10 },
  ],
  phases: [
    {
      name: '狂暴阶段',
      hpThreshold: 0.5,
      intents: [
        { weight: 70, action: 'attack', value: 15 },
        { weight: 30, action: 'buff', value: 3 },
      ],
      transition: {
        dialogue: '"感受我的力量！"',
        shieldGain: 10,
        applyToPlayer: { status: 'weak', stacks: 2 },
      },
    },
    {
      name: '绝望阶段',
      hpThreshold: 0.2,
      intents: [
        { weight: 80, action: 'attack', value: 20 },
        { weight: 20, action: 'debuff', value: 3, status: 'vulnerable' },
      ],
      transition: {
        dialogue: '"一切终将归于虚无！"',
        shieldGain: 20,
        clearDebuffs: true,
      },
    },
  ],
};

// 高攻击技能（用于快速打 Boss）
const heavyStrike: InnateSkilData = {
  id: 'heavy_test',
  name: '重击测试',
  apCost: 1,
  target: 'single_enemy',
  effects: [{ type: 'damage', value: 30 }],
};

function createBossCombat(seed = 42): Combat {
  const config: CombatConfig = {
    playerHp: 100,
    playerMaxAp: 10,
    innateSkills: [heavyStrike],
    slots: [
      { type: 'light_a', skill: null },
      { type: 'light_b', skill: null },
      { type: 'heavy', skill: null },
      { type: 'support', skill: null },
      { type: 'ultimate', skill: null },
    ],
    passives: [],
    enemies: [testBoss],
    seed,
  };
  return new Combat(config);
}

describe('isBossData', () => {
  it('应该正确识别 Boss 数据', () => {
    expect(isBossData(testBoss)).toBe(true);
  });

  it('应该正确识别非 Boss 数据', () => {
    const normalEnemy = { id: 'e1', name: '普通敌人', hp: 30, intents: [] };
    expect(isBossData(normalEnemy)).toBe(false);
  });
});

describe('Boss 阶段系统', () => {
  it('应该初始化时处于初始阶段', () => {
    const combat = createBossCombat();
    const phaseInfo = combat.getBossPhaseInfo(0);
    expect(phaseInfo).not.toBeNull();
    expect(phaseInfo!.phaseName).toBe('初始阶段');
    expect(phaseInfo!.phaseIndex).toBe(0);
    expect(phaseInfo!.totalPhases).toBe(3); // 初始 + 2 阶段
  });

  it('Boss HP 降到 50% 时应该进入第一阶段', () => {
    const combat = createBossCombat();
    // Boss 有 100 HP，重击 30 伤害，两次打到 40 HP（低于 50%）
    combat.useInnateSkill(0, 0); // 100 -> 70
    const phase1 = combat.getBossPhaseInfo(0);
    expect(phase1!.phaseName).toBe('初始阶段'); // 还没到 50%

    combat.useInnateSkill(0, 0); // 70 -> 40（低于 50）
    const phase2 = combat.getBossPhaseInfo(0);
    expect(phase2!.phaseName).toBe('狂暴阶段');
    expect(phase2!.phaseIndex).toBe(1);
  });

  it('阶段转换时应该给 Boss 加护盾', () => {
    const combat = createBossCombat();
    combat.useInnateSkill(0, 0); // 100 -> 70
    combat.useInnateSkill(0, 0); // 70 -> 40（触发阶段 1：+10 护盾）
    expect(combat.state.enemies[0].shield).toBe(10);
  });

  it('阶段转换时应该对玩家施加状态', () => {
    const combat = createBossCombat();
    combat.useInnateSkill(0, 0); // 100 -> 70
    combat.useInnateSkill(0, 0); // 触发阶段 1：对玩家施加 weak 2 层
    const weakStatus = combat.state.player.statuses.find(s => s.id === 'weak');
    expect(weakStatus).toBeDefined();
    expect(weakStatus!.stacks).toBe(2);
  });

  it('Boss HP 降到 20% 时应该进入第二阶段', () => {
    const combat = createBossCombat();
    combat.state.player.ap = 20;
    combat.useInnateSkill(0, 0); // 100 -> 70
    combat.useInnateSkill(0, 0); // 70 -> 40（进入狂暴阶段，+10 护盾，玩家被加 weak）
    // 清除 weak 以确保后续伤害不减少
    combat.state.player.statuses = [];
    combat.useInnateSkill(0, 0); // 30 伤害 -> 护盾吸收 10，剩余 20 打 HP -> 20 HP (0.2 <= 0.2)
    const phase = combat.getBossPhaseInfo(0);
    expect(phase!.phaseName).toBe('绝望阶段');
    expect(phase!.phaseIndex).toBe(2);
  });

  it('第二阶段转换时应该清除 Boss 负面状态', () => {
    const combat = createBossCombat();
    combat.state.player.ap = 20;
    // 先给 Boss 加个 debuff
    combat.state.enemies[0].statuses.push({ id: 'poison', stacks: 3 });
    expect(combat.state.enemies[0].statuses.some(s => s.id === 'poison')).toBe(true);

    // 打到第二阶段
    combat.useInnateSkill(0, 0); // 100 -> 70
    combat.useInnateSkill(0, 0); // 70 -> 40（阶段 1，玩家被加 weak）
    combat.state.player.statuses = []; // 清 weak
    combat.useInnateSkill(0, 0); // 40+10盾 -> 20 HP（阶段 2，清 debuff）

    // poison 应该被清除（只保留 strength_up 类 buff）
    expect(combat.state.enemies[0].statuses.some(s => s.id === 'poison')).toBe(false);
  });

  it('第二阶段应该给 Boss 加更多护盾', () => {
    const combat = createBossCombat();
    combat.state.player.ap = 20;
    combat.useInnateSkill(0, 0); // 100 -> 70
    combat.useInnateSkill(0, 0); // 70 -> 40（+10 护盾，玩家被加 weak）
    combat.state.player.statuses = []; // 清 weak
    combat.useInnateSkill(0, 0); // 打穿护盾到 20 HP（+20 护盾）
    expect(combat.state.enemies[0].shield).toBe(20);
  });

  it('阶段转换时应该生成对话日志', () => {
    const combat = createBossCombat();
    combat.useInnateSkill(0, 0); // 100 -> 70
    combat.useInnateSkill(0, 0); // 触发阶段 1
    const dialogueLog = combat.log.find(l => l.action === '对话');
    expect(dialogueLog).toBeDefined();
    expect(dialogueLog!.detail).toBe('"感受我的力量！"');
  });

  it('阶段转换时应该重新 roll 意图', () => {
    const combat = createBossCombat();
    const intentBefore = combat.state.enemies[0].currentIntent;
    combat.useInnateSkill(0, 0); // 100 -> 70
    combat.useInnateSkill(0, 0); // 触发阶段 1 -> 重新 roll
    const intentAfter = combat.state.enemies[0].currentIntent;
    // 新意图应该来自阶段 1 的意图池（attack 15 或 buff 3）
    expect(intentAfter).not.toBeNull();
    if (intentAfter!.action === 'attack') {
      expect(intentAfter!.value).toBe(15);
    } else {
      expect(intentAfter!.action).toBe('buff');
      expect(intentAfter!.value).toBe(3);
    }
  });

  it('击败 Boss 后应该进入 victory', () => {
    const combat = createBossCombat();
    combat.state.player.ap = 30;
    combat.useInnateSkill(0, 0); // 100 -> 70
    combat.useInnateSkill(0, 0); // 70 -> 40（阶段 1，+10 盾，weak）
    combat.state.player.statuses = []; // 清 weak
    combat.useInnateSkill(0, 0); // 40+10盾 -> 20 HP（阶段 2，+20 盾）
    combat.useInnateSkill(0, 0); // 30 伤害 -> 打穿 20 盾 + 10 HP -> 10 HP
    combat.useInnateSkill(0, 0); // 10 -> dead
    expect(combat.state.phase).toBe('victory');
  });

  it('非 Boss 敌人不应有阶段信息', () => {
    const config: CombatConfig = {
      playerHp: 100,
      playerMaxAp: 10,
      innateSkills: [heavyStrike],
      slots: [
        { type: 'light_a', skill: null },
        { type: 'light_b', skill: null },
        { type: 'heavy', skill: null },
        { type: 'support', skill: null },
        { type: 'ultimate', skill: null },
      ],
      passives: [],
      enemies: [{ id: 'e1', name: '小怪', hp: 30, intents: [{ weight: 100, action: 'attack', value: 5 }] }],
      seed: 42,
    };
    const combat = new Combat(config);
    expect(combat.getBossPhaseInfo(0)).toBeNull();
  });

  it('rollEnemyIntents 应该使用当前阶段的意图池', () => {
    const combat = createBossCombat();
    combat.state.player.ap = 20;
    combat.useInnateSkill(0, 0); // 100 -> 70
    combat.useInnateSkill(0, 0); // 触发阶段 1

    // 结束回合让敌人行动，然后新回合会 rollEnemyIntents
    combat.endPlayerTurn();

    // 如果还活着，新的意图应来自阶段 1 的池
    if (combat.state.enemies[0].hp > 0) {
      const intent = combat.state.enemies[0].currentIntent;
      expect(intent).not.toBeNull();
      // 阶段 1 的意图只有 attack(15) 和 buff(3)
      if (intent!.action === 'attack') {
        expect(intent!.value).toBe(15);
      } else {
        expect(intent!.action).toBe('buff');
        expect(intent!.value).toBe(3);
      }
    }
  });
});
