import { edgeIndex, geometry, violations } from './index.js';
import { drawCross, drawDot, drawGrid, drawText, nearestGridEdge, COLORS } from '../../app/draw.js';

// 盘面四周留白（格），让边框上的线和顶点不被裁掉
const M = 0.3;

/** 边的两个端点（以格为单位）。 */
function edgeEnds(G, e) {
  if (e < G.nH) {
    const r = Math.floor(e / G.W);
    const c = e % G.W;
    return [c, r, c + 1, r];
  }
  const k = e - G.nH;
  const r = Math.floor(k / (G.W + 1));
  const c = k % (G.W + 1);
  return [c, r, c, r + 1];
}

function strokeEdges(ctx, G, list, u, color, width) {
  if (!list.length) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const e of list) {
    const [x1, y1, x2, y2] = edgeEnds(G, e);
    ctx.moveTo(x1 * u, y1 * u);
    ctx.lineTo(x2 * u, y2 * u);
  }
  ctx.stroke();
}

export default {
  controls: [
    '左键点击格线画线，再点一次擦除；按住左键沿格线拖动可连续画线（或连续擦除）。',
    '右键点击格线打 ×（表示此处不能画线），再点一次取消；右键拖动可连续打 ×。',
  ],

  size(puzzle) {
    return { cols: puzzle.width + M * 2, rows: puzzle.height + M * 2 };
  },

  draw(ctx, { puzzle, state, unit: u, showErrors, wrong, ui, solved }) {
    const { width: W, height: H, clues } = puzzle;
    const G = geometry(W, H);
    const e = ui.drag ? ui.drag.e : state.e;
    ctx.fillStyle = COLORS.paper;
    ctx.fillRect(0, 0, (W + M * 2) * u, (H + M * 2) * u);
    ctx.translate(M * u, M * u);
    drawGrid(ctx, W, H, u, { color: '#dcdcdc', dash: [2, 4] });

    const bad = showErrors ? violations(puzzle, e) : null;
    for (let i = 0; i < G.N; i++) {
      if (clues[i] < 0) continue;
      const color = bad && bad.cells.has(i) ? COLORS.error : COLORS.given;
      drawText(ctx, clues[i], ((i % W) + 0.5) * u, (Math.floor(i / W) + 0.5) * u, u * 0.55, color);
    }

    const crossWidth = Math.max(1.2, u * 0.04);
    for (let x = 0; x < G.E; x++) {
      if (e[x] !== 2) continue;
      const [x1, y1, x2, y2] = edgeEnds(G, x);
      drawCross(ctx, ((x1 + x2) / 2) * u, ((y1 + y2) / 2) * u, u * 0.09, COLORS.mark, crossWidth);
    }

    const wrongSet = new Set(wrong || []);
    const normal = [];
    const red = [];
    for (let x = 0; x < G.E; x++) {
      if (e[x] === 1) (wrongSet.has(x) || (bad && bad.edges.has(x)) ? red : normal).push(x);
    }
    const lineWidth = Math.max(3, u * 0.12);
    strokeEdges(ctx, G, normal, u, solved ? COLORS.ink : COLORS.entry, lineWidth);
    strokeEdges(ctx, G, red, u, COLORS.error, lineWidth);

    const dot = Math.max(1.5, u * 0.06);
    for (let r = 0; r <= H; r++) {
      for (let c = 0; c <= W; c++) {
        const isBad = bad && bad.verts.has(G.vid(r, c));
        drawDot(ctx, c * u, r * u, isBad ? dot * 2.2 : dot, isBad ? COLORS.error : COLORS.ink);
      }
    }
  },

  createInput(api) {
    const ui = { drag: null };
    const toGrid = (p) => ({ x: p.x - M, y: p.y - M });
    // 离 g 足够近的顶点，返回 { r, c } 或 null
    const vertexNear = (puzzle, g) => {
      const r = Math.round(g.y);
      const c = Math.round(g.x);
      if (r < 0 || r > puzzle.height || c < 0 || c > puzzle.width) return null;
      return Math.hypot(g.x - c, g.y - r) <= 0.3 ? { r, c } : null;
    };
    return {
      ui,
      down(p, ev) {
        const puzzle = api.puzzle();
        const g = toGrid(p);
        const edge = nearestGridEdge(g, puzzle.width, puzzle.height);
        if (!edge) return;
        const i = edgeIndex(puzzle, edge);
        const e = api.state().e.slice();
        const mark = ev.button === 2 ? 2 : 1;
        e[i] = e[i] === mark ? 0 : mark;
        ui.drag = { e, value: e[i], vertex: vertexNear(puzzle, g) };
        api.redraw();
      },
      // 拖动：从一个顶点移到同行/同列的另一个顶点时，把途经的边都设为同一状态
      move(p) {
        if (!ui.drag) return;
        const puzzle = api.puzzle();
        const v = vertexNear(puzzle, toGrid(p));
        if (!v) return;
        const from = ui.drag.vertex;
        ui.drag.vertex = v;
        if (!from || (from.r === v.r && from.c === v.c)) return;
        if (from.r !== v.r && from.c !== v.c) return;
        const G = geometry(puzzle.width, puzzle.height);
        const steps = Math.abs(v.r - from.r) + Math.abs(v.c - from.c);
        const dr = Math.sign(v.r - from.r);
        const dc = Math.sign(v.c - from.c);
        for (let k = 0; k < steps; k++) {
          const r = from.r + dr * k;
          const c = from.c + dc * k;
          let i;
          if (dr === 0) i = G.hEdge(r, dc > 0 ? c : c - 1);
          else i = G.vEdge(dr > 0 ? r : r - 1, c);
          ui.drag.e[i] = ui.drag.value;
        }
        api.redraw();
      },
      up() {
        if (!ui.drag) return;
        const e = ui.drag.e;
        ui.drag = null;
        api.apply({ e });
        api.redraw();
      },
      cancel() {
        ui.drag = null;
        api.redraw();
      },
    };
  },
};
