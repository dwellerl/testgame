/**
 * 应用入口 — 启动游戏主循环
 */
import { Game } from './ui/game';
import './style.css';

const app = document.getElementById('app')!;
new Game(app);
