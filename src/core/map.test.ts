import { describe, it, expect } from 'vitest';
import {
  generateMap,
  enterNode,
  completeCurrentNode,
  getAvailableNodes,
  getNodesAtFloor,
  type GameMap,
  type NodeType,
} from './map';

describe('Map - 节点图系统（分支路径）', () => {
  describe('生成', () => {
    it('生成默认 7 层 + boss 的地图', () => {
      const map = generateMap({ seed: 42 });
      expect(map.totalFloors).toBe(7);
      // 节点数 >= 8（7层至少各1个 + boss）
      expect(map.nodes.length).toBeGreaterThanOrEqual(8);
      expect(map.currentNodeId).toBeNull();
    });

    it('第一层只有 1 个节点且必定是战斗', () => {
      for (let seed = 0; seed < 20; seed++) {
        const map = generateMap({ seed });
        const floor0 = getNodesAtFloor(map, 0);
        expect(floor0).toHaveLength(1);
        expect(floor0[0].type).toBe('combat');
      }
    });

    it('最后一层（boss 前）只有 1 个节点且必定是营地', () => {
      for (let seed = 0; seed < 20; seed++) {
        const map = generateMap({ seed });
        const preBoss = getNodesAtFloor(map, map.totalFloors - 1);
        expect(preBoss).toHaveLength(1);
        expect(preBoss[0].type).toBe('campfire');
      }
    });

    it('Boss 节点存在且 nextIds 为空', () => {
      const map = generateMap({ seed: 99 });
      const bossNode = map.nodes.find(n => n.id === 'node_boss');
      expect(bossNode).toBeDefined();
      expect(bossNode!.type).toBe('boss');
      expect(bossNode!.nextIds).toHaveLength(0);
    });

    it('中间层有 2-3 个节点', () => {
      const map = generateMap({ seed: 42 });
      // 检查中间层（floor 1 到 totalFloors-2）
      for (let floor = 1; floor < map.totalFloors - 1; floor++) {
        const layerNodes = getNodesAtFloor(map, floor);
        expect(layerNodes.length).toBeGreaterThanOrEqual(2);
        expect(layerNodes.length).toBeLessThanOrEqual(3);
      }
    });

    it('每个非 boss 节点至少有 1 条出边', () => {
      const map = generateMap({ seed: 42 });
      for (const node of map.nodes) {
        if (node.type !== 'boss') {
          expect(node.nextIds.length, `${node.id} 没有出边`).toBeGreaterThanOrEqual(1);
        }
      }
    });

    it('每个非首层节点至少有 1 条入边', () => {
      const map = generateMap({ seed: 42 });
      for (const node of map.nodes) {
        if (node.floor === 0) continue; // 首层无入边正常
        const hasIncoming = map.nodes.some(n => n.nextIds.includes(node.id));
        expect(hasIncoming, `${node.id} 没有入边`).toBe(true);
      }
    });

    it('保底机制：至少有 1 个商店', () => {
      for (let seed = 0; seed < 30; seed++) {
        const map = generateMap({ seed });
        const hasShop = map.nodes.some(n => n.type === 'shop');
        expect(hasShop, `seed=${seed} 缺少商店`).toBe(true);
      }
    });

    it('相同种子生成相同地图', () => {
      const map1 = generateMap({ seed: 123 });
      const map2 = generateMap({ seed: 123 });
      expect(map1.nodes.map(n => ({ id: n.id, type: n.type, nextIds: n.nextIds })))
        .toEqual(map2.nodes.map(n => ({ id: n.id, type: n.type, nextIds: n.nextIds })));
    });

    it('不同种子生成不同地图', () => {
      const map1 = generateMap({ seed: 1 });
      const map2 = generateMap({ seed: 2 });
      const ids1 = map1.nodes.map(n => n.type).join(',');
      const ids2 = map2.nodes.map(n => n.type).join(',');
      expect(ids1).not.toBe(ids2);
    });

    it('支持自定义层数', () => {
      const map = generateMap({ seed: 42, floors: 10 });
      expect(map.totalFloors).toBe(10);
      const bossNode = map.nodes.find(n => n.type === 'boss');
      expect(bossNode).toBeDefined();
      expect(bossNode!.floor).toBe(10);
    });

    it('初始状态只有第一层节点 available', () => {
      const map = generateMap({ seed: 42 });
      const floor0 = getNodesAtFloor(map, 0);
      for (const node of floor0) {
        expect(node.status).toBe('available');
      }
      // 其他层都是 locked
      for (const node of map.nodes) {
        if (node.floor > 0) {
          expect(node.status).toBe('locked');
        }
      }
    });
  });

  describe('状态管理', () => {
    function freshMap() {
      return generateMap({ seed: 42 });
    }

    it('进入第一个节点', () => {
      const map = freshMap();
      const firstNode = getNodesAtFloor(map, 0)[0];
      const success = enterNode(map, firstNode.id);
      expect(success).toBe(true);
      expect(map.currentNodeId).toBe(firstNode.id);
      expect(firstNode.status).toBe('current');
    });

    it('不能进入 locked 节点', () => {
      const map = freshMap();
      const floor1 = getNodesAtFloor(map, 1);
      const success = enterNode(map, floor1[0].id);
      expect(success).toBe(false);
    });

    it('完成节点后解锁下一层可达节点', () => {
      const map = freshMap();
      const firstNode = getNodesAtFloor(map, 0)[0];
      enterNode(map, firstNode.id);
      completeCurrentNode(map);

      expect(firstNode.status).toBe('completed');
      expect(map.currentNodeId).toBeNull();

      // 下一层中 firstNode.nextIds 指向的节点应该是 available
      for (const nextId of firstNode.nextIds) {
        const next = map.nodes.find(n => n.id === nextId);
        expect(next!.status).toBe('available');
      }
    });

    it('选择分支后同层其他节点变为 skipped', () => {
      const map = freshMap();
      // 进入并完成第一层
      const firstNode = getNodesAtFloor(map, 0)[0];
      enterNode(map, firstNode.id);
      completeCurrentNode(map);

      // 第二层应有多个 available 节点
      const available = getAvailableNodes(map);
      if (available.length > 1) {
        // 进入第一个
        enterNode(map, available[0].id);
        completeCurrentNode(map);

        // 同层其他 available 应变为 skipped
        for (let i = 1; i < available.length; i++) {
          if (available[i].floor === available[0].floor) {
            expect(available[i].status).toBe('skipped');
          }
        }
      }
    });

    it('getAvailableNodes 返回当前可选节点', () => {
      const map = freshMap();
      let available = getAvailableNodes(map);
      expect(available).toHaveLength(1); // 首层只有 1 个

      // 进入并完成第一层
      enterNode(map, available[0].id);
      completeCurrentNode(map);

      // 第二层应有多个可选
      available = getAvailableNodes(map);
      expect(available.length).toBeGreaterThanOrEqual(1);
    });

    it('能从头走到 boss', () => {
      const map = freshMap();

      for (let floor = 0; floor <= map.totalFloors; floor++) {
        const available = getAvailableNodes(map);
        expect(available.length, `floor=${floor} 没有可选节点`).toBeGreaterThan(0);

        // 进入第一个可选节点
        enterNode(map, available[0].id);
        completeCurrentNode(map);
      }

      // Boss 应该已 completed
      const bossNode = map.nodes.find(n => n.id === 'node_boss');
      expect(bossNode!.status).toBe('completed');
    });
  });
});
