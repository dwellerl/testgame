/**
 * 遗物系统单元测试
 */
import { describe, it, expect } from 'vitest';
import {
  createRelicInventory,
  addRelic,
  removeRelic,
  replaceRelic,
  isRelicFull,
  triggerRelics,
  getPassiveStatBonuses,
  type RelicInventory,
  type TriggerContext,
} from './relics';
import { type RelicData, RELIC_SLOT_MAX } from './types';

// 测试用遗物
const mockRelic = (id: string, overrides?: Partial<RelicData>): RelicData => ({
  id,
  name: `遗物_${id}`,
  desc: '测试遗物',
  rarity: 'common',
  trigger: 'on_combat_start',
  effects: [],
  ...overrides,
});

const defaultCtx: TriggerContext = {
  hp: 50,
  maxHp: 75,
  gold: 30,
  maxAp: 4,
};

describe('遗物系统', () => {
  describe('槽位管理', () => {
    it('创建空背包', () => {
      const inv = createRelicInventory();
      expect(inv.relics).toHaveLength(0);
      expect(isRelicFull(inv)).toBe(false);
    });

    it('添加遗物直到满', () => {
      const inv = createRelicInventory();
      for (let i = 0; i < RELIC_SLOT_MAX; i++) {
        expect(addRelic(inv, mockRelic(`r${i}`))).toBe(true);
      }
      expect(inv.relics).toHaveLength(RELIC_SLOT_MAX);
      expect(isRelicFull(inv)).toBe(true);
    });

    it('满了无法添加', () => {
      const inv = createRelicInventory();
      for (let i = 0; i < RELIC_SLOT_MAX; i++) {
        addRelic(inv, mockRelic(`r${i}`));
      }
      expect(addRelic(inv, mockRelic('extra'))).toBe(false);
      expect(inv.relics).toHaveLength(RELIC_SLOT_MAX);
    });

    it('不可重复添加相同 ID', () => {
      const inv = createRelicInventory();
      addRelic(inv, mockRelic('r1'));
      expect(addRelic(inv, mockRelic('r1'))).toBe(false);
      expect(inv.relics).toHaveLength(1);
    });

    it('移除遗物', () => {
      const inv = createRelicInventory();
      addRelic(inv, mockRelic('r1'));
      addRelic(inv, mockRelic('r2'));
      expect(removeRelic(inv, 'r1')).toBe(true);
      expect(inv.relics).toHaveLength(1);
      expect(inv.relics[0].id).toBe('r2');
    });

    it('移除不存在的遗物返回 false', () => {
      const inv = createRelicInventory();
      expect(removeRelic(inv, 'nonexist')).toBe(false);
    });

    it('替换遗物', () => {
      const inv = createRelicInventory();
      addRelic(inv, mockRelic('r1'));
      addRelic(inv, mockRelic('r2'));
      const old = replaceRelic(inv, 0, mockRelic('r3'));
      expect(old?.id).toBe('r1');
      expect(inv.relics[0].id).toBe('r3');
      expect(inv.relics).toHaveLength(2);
    });

    it('替换时不可与现有重复', () => {
      const inv = createRelicInventory();
      addRelic(inv, mockRelic('r1'));
      addRelic(inv, mockRelic('r2'));
      const old = replaceRelic(inv, 0, mockRelic('r2'));
      expect(old).toBeNull();
      expect(inv.relics[0].id).toBe('r1'); // 未改变
    });
  });

  describe('触发引擎', () => {
    it('匹配 trigger 的遗物生效', () => {
      const inv = createRelicInventory();
      addRelic(inv, mockRelic('shield', {
        trigger: 'on_combat_start',
        effects: [{ type: 'shield_start', value: 8 }],
      }));
      const result = triggerRelics(inv, 'on_combat_start', defaultCtx);
      expect(result.shieldGain).toBe(8);
      expect(result.triggeredRelics).toContain('遗物_shield');
    });

    it('不匹配的 trigger 不生效', () => {
      const inv = createRelicInventory();
      addRelic(inv, mockRelic('shield', {
        trigger: 'on_combat_start',
        effects: [{ type: 'shield_start', value: 8 }],
      }));
      const result = triggerRelics(inv, 'on_rest', defaultCtx);
      expect(result.shieldGain).toBe(0);
      expect(result.triggeredRelics).toHaveLength(0);
    });

    it('多个遗物效果累加', () => {
      const inv = createRelicInventory();
      addRelic(inv, mockRelic('gold1', {
        trigger: 'on_floor_start',
        effects: [{ type: 'gold_bonus', value: 5 }],
      }));
      addRelic(inv, mockRelic('gold2', {
        trigger: 'on_floor_start',
        effects: [{ type: 'gold_bonus', value: 3 }],
      }));
      const result = triggerRelics(inv, 'on_floor_start', defaultCtx);
      expect(result.goldDelta).toBe(8);
      expect(result.triggeredRelics).toHaveLength(2);
    });

    it('商店折扣取最优', () => {
      const inv = createRelicInventory();
      addRelic(inv, mockRelic('disc1', {
        trigger: 'on_enter_shop',
        effects: [{ type: 'shop_discount', value: 80 }],
      }));
      addRelic(inv, mockRelic('disc2', {
        trigger: 'on_enter_shop',
        effects: [{ type: 'shop_discount', value: 70 }],
      }));
      const result = triggerRelics(inv, 'on_enter_shop', defaultCtx);
      expect(result.shopDiscount).toBe(70); // 取最低
    });

    it('passive_stat 通过 getPassiveStatBonuses 获取', () => {
      const inv = createRelicInventory();
      addRelic(inv, mockRelic('hp_up', {
        trigger: 'passive_stat',
        effects: [{ type: 'max_hp_up', value: 15 }],
      }));
      const result = getPassiveStatBonuses(inv);
      expect(result.maxHpDelta).toBe(15);
    });

    it('heal 效果正确累加', () => {
      const inv = createRelicInventory();
      addRelic(inv, mockRelic('healer', {
        trigger: 'on_rest',
        effects: [
          { type: 'heal', value: 10 },
          { type: 'rest_bonus_heal', value: 10 },
        ],
      }));
      const result = triggerRelics(inv, 'on_rest', defaultCtx);
      expect(result.hpDelta).toBe(10);
      expect(result.restBonusPercent).toBe(10);
    });
  });
});
