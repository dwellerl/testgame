import { describe, it, expect } from 'vitest';
import { RNG } from './rng';

describe('RNG - 种子化随机数生成器', () => {
  it('相同种子产生相同序列（可复现性）', () => {
    const rng1 = new RNG(42);
    const rng2 = new RNG(42);

    const seq1 = Array.from({ length: 10 }, () => rng1.next());
    const seq2 = Array.from({ length: 10 }, () => rng2.next());

    expect(seq1).toEqual(seq2);
  });

  it('不同种子产生不同序列', () => {
    const rng1 = new RNG(42);
    const rng2 = new RNG(123);

    const seq1 = Array.from({ length: 5 }, () => rng1.next());
    const seq2 = Array.from({ length: 5 }, () => rng2.next());

    expect(seq1).not.toEqual(seq2);
  });

  it('next() 返回 [0, 1) 范围内的值', () => {
    const rng = new RNG(999);
    for (let i = 0; i < 1000; i++) {
      const val = rng.next();
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(1);
    }
  });

  it('nextInt() 返回指定范围内的整数', () => {
    const rng = new RNG(7);
    for (let i = 0; i < 100; i++) {
      const val = rng.nextInt(1, 6);
      expect(val).toBeGreaterThanOrEqual(1);
      expect(val).toBeLessThanOrEqual(6);
      expect(Number.isInteger(val)).toBe(true);
    }
  });

  it('pick() 从数组中选取元素', () => {
    const rng = new RNG(55);
    const items = ['火', '冰', '雷', '风'];
    const picked = rng.pick(items);
    expect(items).toContain(picked);
  });

  it('pick() 空数组抛出异常', () => {
    const rng = new RNG(1);
    expect(() => rng.pick([])).toThrow('Cannot pick from empty array');
  });

  it('shuffle() 返回新数组，不修改原数组', () => {
    const rng = new RNG(100);
    const original = [1, 2, 3, 4, 5];
    const shuffled = rng.shuffle(original);

    expect(shuffled).toHaveLength(original.length);
    expect(shuffled.sort()).toEqual([...original].sort());
    expect(original).toEqual([1, 2, 3, 4, 5]); // 原数组未变
  });

  it('shuffle() 相同种子产生相同洗牌结果', () => {
    const items = ['A', 'B', 'C', 'D', 'E'];
    const rng1 = new RNG(77);
    const rng2 = new RNG(77);

    expect(rng1.shuffle(items)).toEqual(rng2.shuffle(items));
  });
});
