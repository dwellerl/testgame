/**
 * 节点图系统
 * 管理单局地图的生成与遍历
 * 支持分支路径：每层 1-3 个节点，层间随机连线
 */

import { RNG } from './rng';

// ============ 节点类型 ============

/** 节点遭遇类型 */
export type NodeType =
  | 'combat'        // 普通战斗
  | 'elite'         // 精英战斗（更难，奖励更好）
  | 'event'         // 随机事件（文字抉择）
  | 'shop'          // 商店
  | 'campfire'      // 营地（回血/升级）
  | 'boss';         // Boss（终点）

/** 节点状态 */
export type NodeStatus =
  | 'locked'        // 未解锁（还没走到附近）
  | 'available'     // 可选择进入
  | 'current'       // 当前所在
  | 'completed'     // 已完成
  | 'skipped';      // 被跳过（选了另一条路）

/** 地图节点 */
export interface MapNode {
  id: string;
  type: NodeType;
  status: NodeStatus;
  /** 在路径中的层级（0 = 起点后第一个节点） */
  floor: number;
  /** 连接到的下一层节点 ID 列表 */
  nextIds: string[];
}

/** 单局地图 */
export interface GameMap {
  nodes: MapNode[];
  /** 当前所在节点 ID（null 表示还未进入第一个节点） */
  currentNodeId: string | null;
  /** 总层数（不含 boss） */
  totalFloors: number;
  seed: number;
}

// ============ 地图生成配置 ============

/** 地图生成参数 */
export interface MapGenConfig {
  /** 总层数（不含 boss），默认 7 */
  floors?: number;
  /** 种子 */
  seed: number;
}

/** 默认层数 */
const DEFAULT_FLOORS = 7;

/**
 * 节点类型在各层的分布权重
 * 设计原则：
 * - 第 1 层必定战斗（让玩家热身）
 * - 中间层随机出现事件/商店/营地
 * - Boss 前一层有营地（保底回血机会）
 * - 精英出现在中后段（第 3 层起）
 */
interface FloorWeights {
  combat: number;
  elite: number;
  event: number;
  shop: number;
  campfire: number;
}

function getFloorWeights(floor: number, totalFloors: number): FloorWeights {
  // 第一层：必定普通战斗
  if (floor === 0) {
    return { combat: 100, elite: 0, event: 0, shop: 0, campfire: 0 };
  }

  // Boss 前一层：必定营地
  if (floor === totalFloors - 1) {
    return { combat: 0, elite: 0, event: 0, shop: 0, campfire: 100 };
  }

  // 中间层：根据位置调整权重
  const progress = floor / totalFloors; // 0~1 进度

  return {
    combat: 40,
    elite: progress > 0.3 ? 20 : 0,    // 30% 进度后出精英
    event: 20,
    shop: progress > 0.2 ? 15 : 0,      // 20% 进度后出商店
    campfire: progress > 0.4 ? 15 : 10,  // 中后段营地概率略高
  };
}

// ============ 地图生成 ============

/**
 * 获取一层应有多少节点
 * - 第 0 层（开局）：1 个节点（必定战斗）
 * - 最后一层（Boss 前）：1 个节点（必定营地）
 * - Boss 层：1 个节点
 * - 中间层：2-3 个节点
 */
function getNodesPerFloor(floor: number, totalFloors: number, rng: RNG): number {
  // 首尾固定 1 个
  if (floor === 0 || floor === totalFloors - 1) return 1;
  // 中间层 2-3 个
  return rng.next() < 0.4 ? 3 : 2;
}

/**
 * 生成分支节点图
 * 每层 1-3 个节点，层间随机连线保证可达性
 */
export function generateMap(config: MapGenConfig): GameMap {
  const totalFloors = config.floors ?? DEFAULT_FLOORS;
  const rng = new RNG(config.seed);
  const nodes: MapNode[] = [];

  // 按层生成节点
  const layers: MapNode[][] = [];

  for (let floor = 0; floor < totalFloors; floor++) {
    const count = getNodesPerFloor(floor, totalFloors, rng);
    const layer: MapNode[] = [];

    for (let i = 0; i < count; i++) {
      const nodeType = pickNodeType(floor, totalFloors, rng);
      const node: MapNode = {
        id: `node_${floor}_${i}`,
        type: nodeType,
        status: floor === 0 ? 'available' : 'locked',
        floor,
        nextIds: [],
      };
      layer.push(node);
      nodes.push(node);
    }

    layers.push(layer);
  }

  // 添加 Boss 节点
  const bossNode: MapNode = {
    id: 'node_boss',
    type: 'boss',
    status: 'locked',
    floor: totalFloors,
    nextIds: [],
  };
  nodes.push(bossNode);
  layers.push([bossNode]);

  // 生成层间连线
  generateEdges(layers, rng);

  // 保底检查：确保至少有 1 个商店、1 个营地
  ensureMinimumTypes(nodes, totalFloors, rng);

  return {
    nodes,
    currentNodeId: null,
    totalFloors,
    seed: config.seed,
  };
}

/**
 * 生成层间连线
 * 规则：
 * 1. 每个节点至少连一条到下一层的边（保证可达）
 * 2. 下一层每个节点至少被一条边连入（保证不孤立）
 * 3. 额外随机添加一些连线增加路径多样性
 */
function generateEdges(layers: MapNode[][], rng: RNG): void {
  for (let i = 0; i < layers.length - 1; i++) {
    const currentLayer = layers[i];
    const nextLayer = layers[i + 1];

    // 步骤 1：每个当前层节点至少连一条到下一层
    for (const node of currentLayer) {
      const targetIdx = rng.nextInt(0, nextLayer.length - 1);
      const targetId = nextLayer[targetIdx].id;
      if (!node.nextIds.includes(targetId)) {
        node.nextIds.push(targetId);
      }
    }

    // 步骤 2：确保下一层每个节点至少被连入一次
    for (let j = 0; j < nextLayer.length; j++) {
      const nextId = nextLayer[j].id;
      const isConnected = currentLayer.some(n => n.nextIds.includes(nextId));
      if (!isConnected) {
        // 从当前层随机选一个节点连过来
        const sourceIdx = rng.nextInt(0, currentLayer.length - 1);
        currentLayer[sourceIdx].nextIds.push(nextId);
      }
    }

    // 步骤 3：额外随机连线（约 30% 概率额外加一条边）
    if (currentLayer.length > 1 && nextLayer.length > 1) {
      for (const node of currentLayer) {
        if (rng.next() < 0.3 && node.nextIds.length < nextLayer.length) {
          // 找一个还没连的目标
          const unconnected = nextLayer.filter(n => !node.nextIds.includes(n.id));
          if (unconnected.length > 0) {
            const pick = unconnected[rng.nextInt(0, unconnected.length - 1)];
            node.nextIds.push(pick.id);
          }
        }
      }
    }
  }
}

/** 根据权重选择节点类型 */
function pickNodeType(floor: number, totalFloors: number, rng: RNG): NodeType {
  const weights = getFloorWeights(floor, totalFloors);
  const entries: [NodeType, number][] = [
    ['combat', weights.combat],
    ['elite', weights.elite],
    ['event', weights.event],
    ['shop', weights.shop],
    ['campfire', weights.campfire],
  ];

  const totalWeight = entries.reduce((sum, [, w]) => sum + w, 0);
  let roll = rng.next() * totalWeight;

  for (const [type, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return type;
  }

  return 'combat'; // fallback
}

/** 保底机制：确保地图中至少出现关键节点类型 */
function ensureMinimumTypes(nodes: MapNode[], totalFloors: number, rng: RNG): void {
  const middleNodes = nodes.filter(n => n.floor > 0 && n.floor < totalFloors - 1);

  // 检查是否有商店
  const hasShop = middleNodes.some(n => n.type === 'shop');
  if (!hasShop && middleNodes.length > 0) {
    const candidates = middleNodes.filter(n => n.type === 'combat');
    if (candidates.length > 0) {
      const idx = Math.floor(rng.next() * candidates.length);
      candidates[idx].type = 'shop';
    }
  }

  // 检查是否有非保底营地
  const hasCampfire = middleNodes.some(n => n.type === 'campfire');
  if (!hasCampfire && middleNodes.length > 1) {
    const candidates = middleNodes.filter(n => n.type === 'combat' && n.floor >= 2);
    if (candidates.length > 0) {
      const idx = Math.floor(rng.next() * candidates.length);
      candidates[idx].type = 'campfire';
    }
  }
}

// ============ 地图状态管理 ============

/** 进入一个节点（标记为 current） */
export function enterNode(map: GameMap, nodeId: string): boolean {
  const node = map.nodes.find(n => n.id === nodeId);
  if (!node || node.status !== 'available') return false;

  // 把当前节点标记为 current
  if (map.currentNodeId) {
    const prev = map.nodes.find(n => n.id === map.currentNodeId);
    if (prev) prev.status = 'completed';
  }

  node.status = 'current';
  map.currentNodeId = nodeId;

  return true;
}

/** 完成当前节点，解锁下一层，跳过同层未选节点 */
export function completeCurrentNode(map: GameMap): void {
  if (!map.currentNodeId) return;

  const current = map.nodes.find(n => n.id === map.currentNodeId);
  if (!current) return;

  current.status = 'completed';

  // 同层其他 available 节点标记为 skipped
  for (const node of map.nodes) {
    if (node.floor === current.floor && node.id !== current.id && node.status === 'available') {
      node.status = 'skipped';
    }
  }

  // 解锁下一层中从当前节点可达的节点
  for (const nextId of current.nextIds) {
    const next = map.nodes.find(n => n.id === nextId);
    if (next && next.status === 'locked') {
      next.status = 'available';
    }
  }

  map.currentNodeId = null;
}

/** 获取当前可选择的节点列表 */
export function getAvailableNodes(map: GameMap): MapNode[] {
  return map.nodes.filter(n => n.status === 'available');
}

/** 获取指定层的所有节点 */
export function getNodesAtFloor(map: GameMap, floor: number): MapNode[] {
  return map.nodes.filter(n => n.floor === floor);
}

/** 获取节点类型的中文名称 */
export function getNodeTypeName(type: NodeType): string {
  switch (type) {
    case 'combat': return '⚔️ 战斗';
    case 'elite': return '💀 精英';
    case 'event': return '❓ 事件';
    case 'shop': return '🛒 商店';
    case 'campfire': return '🏕️ 营地';
    case 'boss': return '👑 Boss';
  }
}
