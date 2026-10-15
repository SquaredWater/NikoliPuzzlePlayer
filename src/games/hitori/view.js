import { violations } from './index.js';
import { cellAt, drawCircle, drawGrid, drawOuterBorder, drawText, strokeCell, COLORS } from '../../app/draw.js';

/** 拖动中的预览：把正在涂的格子叠加到盘面上。 */
function shownCells(state, ui) {
  if (!ui.paint) return state.c;
  const c = state.c.slice();
  for (const i of ui.paint.cells) c[i] = ui.paint.target;
  return c;
}

export default {
  controls: [
    '左键单击格子涂黑，再次单击取消；右键单击画圈（标记确定不涂黑），再次单击取消。',
    '按住拖动可以连续涂黑或画圈（只作用于与起点原状态相同的格子）。',
  ],

  size(puzzle) {
    return { cols: puzzle.width, rows: puzzle.height };
  },

  draw(ctx, { puzzle, state, unit: u, showErrors, wrong, ui }) {
    const n = puzzle.width;
    const c = shownCells(state, ui);
    const bad = showErrors ? violations(puzzle, c) : null;
    ctx.fillStyle = COLORS.paper;
    ctx.fillRect(0, 0, n * u, n * u);

    for (let i = 0; i < n * n; i++) {
      const x = (i % n) * u;
      const y = Math.floor(i / n) * u;
      if (c[i] === 1) {
        ctx.fillStyle = bad && bad.black.has(i) ? '#b3261e' : COLORS.shade;
        ctx.fillRect(x, y, u, u);
      } else if (bad && bad.apart.has(i)) {
        ctx.fillStyle = COLORS.errorFill;
        ctx.fillRect(x, y, u, u);
      }
    }

    drawGrid(ctx, n, n, u);
    drawOuterBorder(ctx, n, n, u);

    const size = u * (n >= 10 ? 0.5 : 0.55);
    for (let i = 0; i < n * n; i++) {
      const cx = (i % n) * u + u / 2;
      const cy = Math.floor(i / n) * u + u / 2;
      if (c[i] === 1) {
        drawText(ctx, puzzle.numbers[i], cx, cy, size, bad && bad.black.has(i) ? '#f3c4c0' : '#8a8a8a');
        continue;
      }
      const dup = bad && bad.circle.has(i);
      if (c[i] === 2) {
        drawCircle(ctx, cx, cy, u * 0.38, { stroke: dup ? COLORS.error : COLORS.ink, width: Math.max(1.5, u * 0.05) });
      }
      drawText(ctx, puzzle.numbers[i], cx, cy, size, dup ? COLORS.error : COLORS.ink);
    }

    for (const i of wrong || []) {
      const r = Math.floor(i / n);
      strokeCell(ctx, r, i % n, u, COLORS.error, 4);
      // 深色格上再加一道浅色内框，否则红框看不清
      if (c[i] === 1) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.strokeRect((i % n) * u + 6, r * u + 6, u - 12, u - 12);
      }
    }
  },

  createInput(api) {
    const ui = { paint: null };
    const indexAt = (p) => {
      const n = api.puzzle().width;
      const cell = cellAt(p, n, n);
      return cell ? cell.r * n + cell.c : -1;
    };
    const visit = (p) => {
      const i = indexAt(p);
      if (i < 0 || ui.paint.cells.includes(i) || api.state().c[i] !== ui.paint.from) return false;
      ui.paint.cells.push(i);
      return true;
    };
    return {
      ui,
      down(p, ev) {
        const i = indexAt(p);
        if (i < 0) return;
        const from = api.state().c[i];
        const mark = ev.button === 2 ? 2 : 1;
        ui.paint = { target: from === mark ? 0 : mark, from, cells: [i], last: p };
        api.redraw();
      },
      move(p) {
        if (!ui.paint) return;
        // 沿移动路径取样，快速拖动时不漏格
        const { last } = ui.paint;
        const steps = Math.ceil(Math.max(Math.abs(p.x - last.x), Math.abs(p.y - last.y)) * 4);
        let changed = false;
        for (let k = 1; k <= steps; k++) {
          const t = k / steps;
          if (visit({ x: last.x + (p.x - last.x) * t, y: last.y + (p.y - last.y) * t })) changed = true;
        }
        ui.paint.last = p;
        if (changed) api.redraw();
      },
      up() {
        if (!ui.paint) return;
        const { target, cells } = ui.paint;
        ui.paint = null;
        const c = api.state().c.slice();
        for (const i of cells) c[i] = target;
        if (!api.apply({ c })) api.redraw();
      },
      cancel() {
        ui.paint = null;
        api.redraw();
      },
    };
  },
};
