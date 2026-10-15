import { violations } from './index.js';
import { cellAt, drawDot, drawGrid, drawOuterBorder, drawText, strokeCell, COLORS } from '../../app/draw.js';

const ERROR_SHADE = '#c62828';

export default {
  controls: [
    '左键点击格子：未定 → 涂黑 → 打点（确定为白）→ 未定，循环切换。',
    '右键点击格子：打点 / 取消打点。',
    '按住拖动：把经过的格子都设为与第一个格子相同的新状态。',
  ],

  size(puzzle) {
    return { cols: puzzle.width, rows: puzzle.height };
  },

  draw(ctx, { puzzle, state, unit: u, showErrors, wrong, ui }) {
    const { width: W, height: H, clues } = puzzle;
    const c = ui.drag ? ui.drag.c : state.c;
    ctx.fillStyle = COLORS.paper;
    ctx.fillRect(0, 0, W * u, H * u);
    const bad = showErrors ? violations(puzzle, c) : null;

    if (bad) {
      ctx.fillStyle = COLORS.errorFill;
      for (const i of bad.regions) ctx.fillRect((i % W) * u, Math.floor(i / W) * u, u, u);
    }
    drawGrid(ctx, W, H, u);
    for (let i = 0; i < W * H; i++) {
      if (c[i] !== 1 || clues[i]) continue;
      const isBad = bad && (bad.pools.has(i) || bad.cut.has(i));
      ctx.fillStyle = isBad ? ERROR_SHADE : COLORS.shade;
      ctx.fillRect((i % W) * u, Math.floor(i / W) * u, u, u);
    }
    drawOuterBorder(ctx, W, H, u);

    const dot = Math.max(2, u * 0.09);
    for (let i = 0; i < W * H; i++) {
      const x = ((i % W) + 0.5) * u;
      const y = (Math.floor(i / W) + 0.5) * u;
      if (clues[i]) drawText(ctx, clues[i], x, y, u * 0.55, COLORS.given);
      else if (c[i] === 2) drawDot(ctx, x, y, dot, COLORS.mark);
    }

    // 错误的黑格：白色内框 + 红色粗框，在深色底上也醒目
    const lw = Math.max(3, u * 0.1);
    for (const i of wrong || []) {
      const r = Math.floor(i / W);
      const col = i % W;
      strokeCell(ctx, r, col, u, '#fff', lw + 4);
      strokeCell(ctx, r, col, u, COLORS.error, lw);
    }
  },

  createInput(api) {
    const ui = { drag: null };
    // 把格子 (r, c) 设为拖动的目标状态（数字格不变）
    const paint = (puzzle, r, col) => {
      const i = r * puzzle.width + col;
      if (!puzzle.clues[i]) ui.drag.c[i] = ui.drag.value;
    };
    return {
      ui,
      down(p, ev) {
        const puzzle = api.puzzle();
        const cell = cellAt(p, puzzle.width, puzzle.height);
        if (!cell) return;
        const i = cell.r * puzzle.width + cell.c;
        if (puzzle.clues[i]) return;
        const cur = api.state().c[i];
        const value = ev.button === 2 ? (cur === 2 ? 0 : 2) : (cur + 1) % 3;
        ui.drag = { c: api.state().c.slice(), value, last: cell };
        paint(puzzle, cell.r, cell.c);
        api.redraw();
      },
      // 拖动：从上一个格子到当前格子连线上的格子都设为同一状态（移动过快也不会漏格）
      move(p) {
        if (!ui.drag) return;
        const puzzle = api.puzzle();
        const cell = cellAt(p, puzzle.width, puzzle.height, true);
        const { last } = ui.drag;
        if (cell.r === last.r && cell.c === last.c) return;
        const steps = Math.max(Math.abs(cell.r - last.r), Math.abs(cell.c - last.c));
        for (let k = 1; k <= steps; k++) {
          paint(puzzle, Math.round(last.r + ((cell.r - last.r) * k) / steps), Math.round(last.c + ((cell.c - last.c) * k) / steps));
        }
        ui.drag.last = cell;
        api.redraw();
      },
      up() {
        if (!ui.drag) return;
        const { c } = ui.drag;
        ui.drag = null;
        api.apply({ c });
        api.redraw();
      },
      cancel() {
        ui.drag = null;
        api.redraw();
      },
    };
  },
};
