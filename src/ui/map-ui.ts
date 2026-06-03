/**
 * 节点图 UI
 * 分层显示地图，每层多个可选节点，展示分支路径
 */

import { GameMap, MapNode, getNodeTypeName, getAvailableNodes, getNodesAtFloor, enterNode } from '../core/map';

/** 节点选择回调 */
export type OnNodeSelected = (node: MapNode) => void;

/** 地图 UI 控制器 */
export class MapUI {
  private container: HTMLElement;
  private map: GameMap;
  private onNodeSelected: OnNodeSelected;

  constructor(container: HTMLElement, map: GameMap, onNodeSelected: OnNodeSelected) {
    this.container = container;
    this.map = map;
    this.onNodeSelected = onNodeSelected;
    this.render();
  }

  /** 更新地图数据并重新渲染 */
  update(map: GameMap): void {
    this.map = map;
    this.render();
  }

  private render(): void {
    const totalFloors = this.map.totalFloors;

    let html = `
      <div id="map-wrapper">
        <h1>残响轮回 — 钟渊之夜</h1>
        <div class="map-progress">${this.getProgress()}</div>
        <div class="map-layers">
    `;

    // 按层渲染（包含 Boss 层）
    for (let floor = 0; floor <= totalFloors; floor++) {
      const layerNodes = getNodesAtFloor(this.map, floor);
      const floorLabel = floor === totalFloors ? 'Boss' : `第 ${floor + 1} 层`;

      html += `<div class="map-layer" data-floor="${floor}">`;
      html += `<div class="layer-label">${floorLabel}</div>`;
      html += `<div class="layer-nodes">`;

      for (const node of layerNodes) {
        const statusClass = node.status;
        const isAvailable = node.status === 'available';
        const isCurrent = node.status === 'current';
        const isSkipped = node.status === 'skipped';
        const typeName = getNodeTypeName(node.type);

        html += `<div class="map-node ${statusClass} ${node.type}" data-id="${node.id}">`;
        html += `<span class="node-icon">${typeName}</span>`;

        if (isAvailable) {
          html += `<button class="node-enter-btn" data-id="${node.id}">进入</button>`;
        } else if (isCurrent) {
          html += `<span class="node-current-label">当前</span>`;
        } else if (isSkipped) {
          html += `<span class="node-skipped-label">跳过</span>`;
        }

        html += `</div>`;
      }

      html += `</div>`; // .layer-nodes
      html += `</div>`; // .map-layer

      // 层间连接线（非最后一层）
      if (floor < totalFloors) {
        html += `<div class="layer-connector">`;
        // 渲染简化的连线指示
        const nextFloorNodes = getNodesAtFloor(this.map, floor + 1);
        if (layerNodes.length > 1 || nextFloorNodes.length > 1) {
          html += `<span class="connector-branch">⋮</span>`;
        } else {
          html += `<span class="connector-line">│</span>`;
        }
        html += `</div>`;
      }
    }

    html += `
        </div>
      </div>
    `;

    this.container.innerHTML = html;

    // 绑定点击事件
    this.container.querySelectorAll('.node-enter-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const button = (e.target as HTMLElement).closest('.node-enter-btn') as HTMLElement;
        if (!button) return;
        const nodeId = button.dataset.id!;
        const node = this.map.nodes.find(n => n.id === nodeId);
        if (node) {
          enterNode(this.map, nodeId);
          this.onNodeSelected(node);
        }
      });
    });
  }

  private getProgress(): string {
    const completed = this.map.nodes.filter(n => n.status === 'completed').length;
    const total = this.map.nodes.length;
    return `进度: ${completed} / ${total}`;
  }
}
