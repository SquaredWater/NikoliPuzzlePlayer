import { blockerOf, cycleLink, islandSums, structureOf, violations } from './index.js';
import { drawCircle, drawDot, drawOuterBorder, drawText, COLORS } from '../../app/draw.js';

const RADIUS = 0.38;

/** 坐标所在的岛（落在圆内），没有则为 -1。 */
function islandAt(puzzle, p) {
  return puzzle.islands.findIndex((s) => Math.hypot(p.x - s.c - 0.5, p.y - s.r - 0.5) <= RADIUS + 0.07);
}

/** 坐标附近的 link：点在两岛之间的通道内，取离连线最近的；已有桥的优先。 */
function linkAt(puzzle, state, p) {
  let best = -1;
  let bestD = 0.5;
  puzzle.links.forEach(({ a, b }, l) => {
    const A = puzzle.islands[a];
    const B = puzzle.islands[b];
    let d;
    if (A.r === B.r) {
      if (p.x <= A.c + 0.5 || p.x >= B.c + 0.5) return;
      d = Math.abs(p.y - A.r - 0.5);
    } else {
      if (p.y <= A.r + 0.5 || p.y >= B.r + 0.5) return;
      d = Math.abs(p.x - A.c - 0.5);
    }
    if (state.b[l] > 0) d -= 0.05;
    if (d < bestD) {
      best = l;
      bestD = d;
    }
  });
  return best;
}

function linkEnds(puzzle, l, u) {
  const A = puzzle.islands[puzzle.links[l].a];
  const B = puzzle.islands[puzzle.links[l].b];
  return [(A.c + 0.5) * u, (A.r + 0.5) * u, (B.c + 0.5) * u, (B.r + 0.5) * u];
}

function drawBridge(ctx, puzzle, l, count, u, color, width) {
  const [x1, y1, x2, y2] = linkEnds(puzzle, l, u);
  const horiz = y1 === y2;
  const gap = u * 0.09;
  const offsets = count === 2 ? [-gap, gap] : [0];
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  for (const o of offsets) {
    ctx.moveTo(x1 + (horiz ? 0 : o), y1 + (horiz ? o : 0));
    ctx.lineTo(x2 + (horiz ? 0 : o), y2 + (horiz ? o : 0));
  }
  ctx.stroke();
}

function cycle(api, l, delta) {
  const puzzle = api.puzzle();
  const state = api.state();
  const next = cycleLink(puzzle, state, l, delta);
  if (!next) {
    api.message('桥不能交叉：先拆掉挡路的桥', 'error');
    return;
  }
  api.apply(next);
}

export default {
  controls: [
    '点击两个岛之间的空隙（或从岛向相邻的岛拖动）架桥：0 → 1 → 2 → 0 座循环；右键反向循环。',
    '桥不能交叉，会交叉时不允许架设。数字满足的岛显示为绿色。',
  ],

  size(puzzle) {
    return { cols: puzzle.width, rows: puzzle.height };
  },

  draw(ctx, { puzzle, state, unit: u, showErrors, wrong, ui }) {
    const { width: W, height: H, islands } = puzzle;
    ctx.fillStyle = COLORS.paper;
    ctx.fillRect(0, 0, W * u, H * u);

    const occupied = new Set(islands.map((s) => s.r * W + s.c));
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        if (!occupied.has(r * W + c)) drawDot(ctx, (c + 0.5) * u, (r + 0.5) * u, Math.max(1, u * 0.035), '#ccc');
      }
    }
    drawOuterBorder(ctx, W, H, u);

    const drag = ui.drag;
    if (drag && drag.link >= 0) {
      const ok = blockerOf(puzzle, state, drag.link) < 0 || state.b[drag.link] > 0;
      drawBridge(ctx, puzzle, drag.link, 1, u, ok ? 'rgba(30, 110, 255, 0.3)' : 'rgba(211, 47, 47, 0.3)', u * 0.34);
    }

    const bad = showErrors ? violations(puzzle, state) : { islands: new Set(), links: new Set() };
    const wrongSet = new Set(wrong || []);
    const lineW = Math.max(2, u * 0.06);
    state.b.forEach((v, l) => {
      if (!v) return;
      const red = wrongSet.has(l) || bad.links.has(l);
      drawBridge(ctx, puzzle, l, v, u, red ? COLORS.error : COLORS.ink, red ? lineW * 1.6 : lineW);
    });

    const sums = islandSums(puzzle, state);
    const start = drag ? drag.island : -1;
    islands.forEach((s, i) => {
      const cx = (s.c + 0.5) * u;
      const cy = (s.r + 0.5) * u;
      const err = bad.islands.has(i);
      const fill = err ? COLORS.errorFill : sums[i] === s.n ? '#cdeccd' : COLORS.paper;
      const stroke = err ? COLORS.error : i === start ? COLORS.accent : COLORS.ink;
      drawCircle(ctx, cx, cy, u * RADIUS, { fill, stroke, width: i === start || err ? 2.5 : 1.5 });
      drawText(ctx, s.n, cx, cy, u * 0.46, err ? COLORS.error : COLORS.ink);
    });
  },

  createInput(api) {
    const ui = { drag: null };
    return {
      ui,
      down(p, ev) {
        const puzzle = api.puzzle();
        const delta = ev.button === 2 ? -1 : 1;
        const island = islandAt(puzzle, p);
        if (island >= 0) {
          ui.drag = { island, link: -1, delta };
          api.redraw();
          return;
        }
        const l = linkAt(puzzle, api.state(), p);
        if (l >= 0) cycle(api, l, delta);
      },
      move(p) {
        if (!ui.drag) return;
        const s = api.puzzle().islands[ui.drag.island];
        const dx = p.x - s.c - 0.5;
        const dy = p.y - s.r - 0.5;
        let link = -1;
        if (Math.max(Math.abs(dx), Math.abs(dy)) > 0.5) {
          const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0;
          link = structureOf(api.puzzle()).dirLink[ui.drag.island][dir];
        }
        if (link !== ui.drag.link) {
          ui.drag.link = link;
          api.redraw();
        }
      },
      up() {
        const drag = ui.drag;
        if (!drag) return;
        ui.drag = null;
        if (drag.link >= 0) cycle(api, drag.link, drag.delta);
        else api.message('从岛向相邻的岛拖动可以架桥，也可以直接点击两岛之间的空隙');
        api.redraw();
      },
      cancel() {
        ui.drag = null;
        api.redraw();
      },
    };
  },
};
