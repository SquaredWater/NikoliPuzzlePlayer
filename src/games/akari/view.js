import { clueErrors, lampConflicts, lightMap, setCells } from './index.js';
import { cellAt, drawCircle, drawDot, drawGrid, drawOuterBorder, drawText, strokeCell, COLORS } from '../../app/draw.js';

const LIT = '#fff1a8';
const WALL = '#2a2a2a';
const WALL_BAD = '#c62828';
const BULB = '#ffc61a';
const BULB_EDGE = '#8a6a00';

/** 拖动中尚未提交的标点也画出来。 */
function shownCells(state, ui) {
  if (!ui.drag) return state.b;
  const b = state.b.slice();
  for (const i of ui.drag.cells) b[i] = ui.drag.value;
  return b;
}

export default {
  controls: [
    '左键单击白格放置 / 移除灯泡。',
    '右键单击（或按住 Shift 单击）标记点，表示此处没有灯泡；按住右键拖动可连续标点或擦除点。',
    '被灯泡照亮的格子显示为淡黄色。',
  ],

  size(puzzle) {
    return { cols: puzzle.width, rows: puzzle.height };
  },

  draw(ctx, { puzzle, state, unit: u, showErrors, wrong, ui }) {
    const { width: W, height: H, grid } = puzzle;
    const b = shownCells(state, ui);
    const lit = lightMap(puzzle, b);
    const badLamps = showErrors ? lampConflicts(puzzle, b) : new Set();
    const badClues = showErrors ? clueErrors(puzzle, b, lit) : new Set();

    ctx.fillStyle = COLORS.paper;
    ctx.fillRect(0, 0, W * u, H * u);
    for (let i = 0; i < W * H; i++) {
      const x = (i % W) * u;
      const y = Math.floor(i / W) * u;
      if (grid[i] >= 0) ctx.fillStyle = badClues.has(i) ? WALL_BAD : WALL;
      else if (lit[i]) ctx.fillStyle = LIT;
      else continue;
      ctx.fillRect(x, y, u, u);
    }
    drawGrid(ctx, W, H, u);
    drawOuterBorder(ctx, W, H, u);

    for (let i = 0; i < W * H; i++) {
      const cx = (i % W) * u + u / 2;
      const cy = Math.floor(i / W) * u + u / 2;
      const g = grid[i];
      if (g >= 0) {
        if (g <= 4) drawText(ctx, g, cx, cy, u * 0.58, '#fff');
      } else if (b[i] === 1) {
        const bad = badLamps.has(i);
        drawCircle(ctx, cx, cy, u * 0.3, { fill: bad ? COLORS.error : BULB, stroke: bad ? '#7f1010' : BULB_EDGE, width: Math.max(1.5, u * 0.04) });
        drawDot(ctx, cx - u * 0.09, cy - u * 0.09, u * 0.07, 'rgba(255, 255, 255, 0.75)');
      } else if (b[i] === 2) {
        drawDot(ctx, cx, cy, Math.max(2, u * 0.08), COLORS.mark);
      }
    }

    for (const i of wrong || []) strokeCell(ctx, Math.floor(i / W), i % W, u);
  },

  createInput(api) {
    const ui = { drag: null }; // 标点拖动：{ value, cells, last }
    const whiteAt = (p) => {
      const { width: W, height: H, grid } = api.puzzle();
      const cell = cellAt(p, W, H);
      if (!cell) return -1;
      const i = cell.r * W + cell.c;
      return grid[i] < 0 ? i : -1;
    };
    // 拖动时只改动空格或点，不碰灯泡
    const addDragCell = (i) => {
      const { drag } = ui;
      if (drag.cells.includes(i)) return;
      const cur = api.state().b[i];
      if (drag.value === 2 ? cur === 0 : cur === 2) drag.cells.push(i);
    };
    return {
      ui,
      down(p, ev) {
        const i = whiteAt(p);
        if (i < 0) return;
        const b = api.state().b;
        if (ev.button === 2 || ev.shiftKey) {
          ui.drag = { value: b[i] === 2 ? 0 : 2, cells: [i], last: i };
          api.redraw();
          return;
        }
        api.apply(setCells(api.puzzle(), api.state(), [i], b[i] === 1 ? 0 : 1));
      },
      move(p) {
        if (!ui.drag) return;
        const i = whiteAt(p);
        if (i < 0 || i === ui.drag.last) return;
        // 指针移动较快时补上同一行 / 列中跳过的格子
        const W = api.puzzle().width;
        const grid = api.puzzle().grid;
        const a = ui.drag.last;
        const ar = Math.floor(a / W);
        const ac = a % W;
        const br = Math.floor(i / W);
        const bc = i % W;
        if (ar === br || ac === bc) {
          const step = ar === br ? Math.sign(bc - ac) : Math.sign(br - ar) * W;
          for (let j = a + step; j !== i; j += step) if (grid[j] < 0) addDragCell(j);
        }
        addDragCell(i);
        ui.drag.last = i;
        api.redraw();
      },
      up() {
        if (!ui.drag) return;
        const { value, cells } = ui.drag;
        ui.drag = null;
        api.apply(setCells(api.puzzle(), api.state(), cells, value));
        api.redraw();
      },
      cancel() {
        ui.drag = null;
        api.redraw();
      },
    };
  },
};
