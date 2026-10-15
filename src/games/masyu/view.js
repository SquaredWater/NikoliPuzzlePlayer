import { findViolations, layoutOf, setEdge } from './index.js';
import { BLACK, WHITE } from './model.js';
import { cellAt, drawCircle, drawCross, drawGrid, drawOuterBorder, nearestGridEdge, COLORS } from '../../app/draw.js';

/** 点 p 附近（两格中心之间）的边，没有则 -1。 */
function edgeNear(puzzle, p) {
  const { width: W, height: H } = puzzle;
  const L = layoutOf(W, H);
  const g = nearestGridEdge({ x: p.x - 0.5, y: p.y - 0.5 }, W - 1, H - 1);
  if (!g) return -1;
  // 中心点网格上的横线段 (r,c) 连 (r,c)-(r,c+1)；竖线段 (r,c) 连 (r,c)-(r+1,c)
  return g.dir === 'h' ? L.right[g.r * W + g.c] : L.down[g.r * W + g.c];
}

/** 相邻两格之间的边，不相邻则 -1。 */
function edgeBetween(puzzle, a, b) {
  const L = layoutOf(puzzle.width, puzzle.height);
  for (let d = 0; d < 4; d++) if (L.nb[a * 4 + d] === b) return L.ce[a * 4 + d];
  return -1;
}

export default {
  controls: [
    '按住左键从一个格子拖到相邻格子画线；若拖动的第一段原本有线，则这次拖动改为擦线。',
    '左键单击两个格子中心之间的位置切换该段线；右键单击切换 ×（标记此处不连线）。',
  ],

  size(puzzle) {
    return { cols: puzzle.width, rows: puzzle.height };
  },

  draw(ctx, { puzzle, state, unit: u, showErrors, wrong, ui, solved }) {
    const { width: W, height: H, pearls } = puzzle;
    const L = layoutOf(W, H);
    const cur = ui.drag && ui.drag.state ? ui.drag.state : state;
    ctx.fillStyle = COLORS.paper;
    ctx.fillRect(0, 0, W * u, H * u);

    const bad = showErrors ? findViolations(puzzle, cur) : { cells: new Set(), edges: new Set() };
    ctx.fillStyle = COLORS.errorFill;
    for (const i of bad.cells) ctx.fillRect((i % W) * u, Math.floor(i / W) * u, u, u);

    drawGrid(ctx, W, H, u, { color: '#ddd' });
    drawOuterBorder(ctx, W, H, u, '#999');

    const center = (i) => [(i % W) * u + u / 2, Math.floor(i / W) * u + u / 2];
    const wrongSet = new Set(wrong || []);
    ctx.lineCap = 'round';
    for (let e = 0; e < L.E; e++) {
      const [x1, y1] = center(L.ea[e]);
      const [x2, y2] = center(L.eb[e]);
      if (cur.e[e] === 1) {
        const red = wrongSet.has(e) || bad.edges.has(e);
        ctx.strokeStyle = red ? COLORS.error : solved ? COLORS.hint : COLORS.entry;
        ctx.lineWidth = Math.max(3, u * (wrongSet.has(e) ? 0.2 : 0.14));
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      } else if (cur.e[e] === 2) {
        drawCross(ctx, (x1 + x2) / 2, (y1 + y2) / 2, u * 0.1, COLORS.mark, Math.max(1.5, u * 0.04));
      }
    }

    const radius = u * 0.32;
    const stroke = Math.max(1.5, u * 0.05);
    for (let i = 0; i < W * H; i++) {
      if (!pearls[i]) continue;
      const [x, y] = center(i);
      if (pearls[i] === WHITE) drawCircle(ctx, x, y, radius, { fill: '#fff', stroke: COLORS.ink, width: stroke });
      else if (pearls[i] === BLACK) drawCircle(ctx, x, y, radius, { fill: COLORS.ink, stroke: COLORS.ink, width: stroke });
      if (bad.cells.has(i)) drawCircle(ctx, x, y, radius + stroke * 1.5, { stroke: COLORS.error, width: stroke * 1.5 });
    }
  },

  createInput(api) {
    // drag：{ cell 当前所在格, mode 1 画线 / 0 擦线 / null 尚未移动, state 拖动中的盘面 }
    const ui = { drag: null };
    return {
      ui,
      down(p, ev) {
        const puzzle = api.puzzle();
        if (ev.button === 2) {
          const e = edgeNear(puzzle, p);
          if (e < 0) return;
          const state = api.state();
          api.apply(setEdge(state, e, state.e[e] === 2 ? 0 : 2));
          return;
        }
        const cell = cellAt(p, puzzle.width, puzzle.height);
        ui.drag = { cell: cell ? cell.r * puzzle.width + cell.c : -1, mode: null, state: null };
      },
      move(p) {
        const drag = ui.drag;
        if (!drag) return;
        const puzzle = api.puzzle();
        const W = puzzle.width;
        const cell = cellAt(p, W, puzzle.height, true);
        const target = cell.r * W + cell.c;
        if (drag.cell < 0) drag.cell = target;
        if (target === drag.cell) return;
        let state = drag.state || api.state();
        // 一次跳过多格时逐格走过去（先走差得多的方向）
        while (drag.cell !== target) {
          const r = Math.floor(drag.cell / W);
          const c = drag.cell % W;
          const dr = cell.r - r;
          const dc = cell.c - c;
          const next = Math.abs(dc) >= Math.abs(dr) ? drag.cell + Math.sign(dc) : drag.cell + Math.sign(dr) * W;
          const e = edgeBetween(puzzle, drag.cell, next);
          if (drag.mode === null) drag.mode = state.e[e] === 1 ? 0 : 1;
          if (drag.mode === 1) state = setEdge(state, e, 1);
          else if (state.e[e] === 1) state = setEdge(state, e, 0);
          drag.cell = next;
        }
        drag.state = state;
        api.redraw();
      },
      up(p) {
        const drag = ui.drag;
        if (!drag) return;
        ui.drag = null;
        if (drag.mode === null) {
          // 没有拖过格子：视为单击，切换附近的边
          const puzzle = api.puzzle();
          const state = api.state();
          const e = edgeNear(puzzle, p);
          if (e >= 0) api.apply(setEdge(state, e, state.e[e] === 1 ? 0 : 1));
          api.redraw();
          return;
        }
        if (!api.apply(drag.state)) api.redraw();
      },
      cancel() {
        ui.drag = null;
        api.redraw();
      },
    };
  },
};
