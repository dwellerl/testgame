/**
 * 种子化随机数生成器（Mulberry32）
 * 所有游戏随机都必须通过此模块，禁止直接使用 Math.random()
 * 保证可复现性：相同种子 → 相同序列
 */

export class RNG {
  private state: number;

  constructor(seed: number) {
    this.state = seed | 0;
  }

  /** 返回 [0, 1) 的浮点数 */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** 返回 [min, max] 的整数（含两端） */
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /** 从数组中随机选一个元素 */
  pick<T>(array: readonly T[]): T {
    if (array.length === 0) {
      throw new Error('Cannot pick from empty array');
    }
    return array[this.nextInt(0, array.length - 1)];
  }

  /** Fisher-Yates 洗牌，返回新数组 */
  shuffle<T>(array: readonly T[]): T[] {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
}
