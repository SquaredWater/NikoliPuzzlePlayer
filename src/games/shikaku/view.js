import { rectFromCorners } from './puzzle.js';
import { placeRect, rectIndexAt, rectStatus, removeRectAt } from './index.js';
import { cellAt, drawGrid, drawOuterBorder, COLORS } from '../../app/draw.js';

function rectPx(rect, u) {
  return [rect.c * u, rect.r * u, rect.w * u, rect.h * u];
}

function clueColor(clue) {
  // 避开红色色相，以免与“不合规”的红色混淆
  return `hsl(${30 + ((clue * 137.508) % 300)}, 65%, 84%)`;
}

export default {
  controls: [
    '在格子上按下并拖动画矩形，拖动时会显示尺寸；新矩形会替换掉与之重叠的旧矩形。',
    '单击（或右键）已有矩形将其删除；单击空格画 1×1 矩形。',
  ],

  size(puzzle) {
    return { cols: puzzle.width, rows: puzzle.height };
  },

  draw(ctx, { puzzle, state, unit: u, showErrors, wrong, ui }) {
    const { width: W, height: H, clues } = puzzle;
    ctx.fillStyle = COLORS.paper;
    ctx.fillRect(0, 0, W * u, H * u);

    for (const rect of state.rects) {
      const status = rectStatus(puzzle, rect);
      if (!status.ok && showErrors) ctx.fillStyle = COLORS.errorFill;
      else ctx.fillStyle = status.clue >= 0 ? clueColor(status.clue) : '#ddd';
      ctx.fillRect(...rectPx(rect, u));
    }

    drawGrid(ctx, W, H, u);

    const wrongSet = new Set(wrong || []);
    state.rects.forEach((rect, i) => {
      const [x, y, w, h] = rectPx(rect, u);
      const bad = wrongSet.has(i);
      ctx.strokeStyle = bad ? COLORS.error : '#333';
      ctx.lineWidth = bad ? 4 : 2.5;
      ctx.setLineDash(rect.hint && !bad ? [6, 3] : []);
      ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
    });
    ctx.setLineDash([]);
    drawOuterBorder(ctx, W, H, u);

    ctx.fillStyle = COLORS.ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.round(u * 0.5)}px system-ui, sans-serif`;
    for (const clue of clues) ctx.fillText(String(clue.value), clue.c * u + u / 2, clue.r * u + u / 2 + 1);

    if (ui.drag) {
      const { start, end } = ui.drag;
      const rect = rectFromCorners(start.r, start.c, end.r, end.c);
      const [x, y, w, h] = rectPx(rect, u);
      ctx.fillStyle = 'rgba(30, 110, 255, 0.22)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = COLORS.accent;
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
      const label = `${rect.h}×${rect.w}=${rect.h * rect.w}`;
      ctx.font = `bold ${Math.max(12, Math.round(u * 0.32))}px system-ui, sans-serif`;
      const tw = ctx.measureText(label).width + 8;
      const th = Math.max(16, Math.round(u * 0.42));
      const lx = Math.min(Math.max(x + w / 2, tw / 2), W * u - tw / 2);
      const ly = y > th ? y - th / 2 - 2 : y + h + th / 2 + 2;
      ctx.fillStyle = COLORS.accent;
      ctx.fillRect(lx - tw / 2, ly - th / 2, tw, th);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, lx, ly + 1);
    }
  },

  createInput(api) {
    const ui = { drag: null };
    return {
      ui,
      down(p, ev) {
        const puzzle = api.puzzle();
        const cell = cellAt(p, puzzle.width, puzzle.height);
        if (!cell) return;
        if (ev.button === 2) {
          api.apply(removeRectAt(api.state(), cell.r, cell.c));
          return;
        }
        ui.drag = { start: cell, end: cell };
        api.redraw();
      },
      move(p) {
        if (!ui.drag) return;
        const puzzle = api.puzzle();
        const cell = cellAt(p, puzzle.width, puzzle.height, true);
        if (cell.r === ui.drag.end.r && cell.c === ui.drag.end.c) return;
        ui.drag.end = cell;
        api.redraw();
      },
      up() {
        if (!ui.drag) return;
        const { start, end } = ui.drag;
        ui.drag = null;
        const puzzle = api.puzzle();
        const state = api.state();
        if (start.r === end.r && start.c === end.c) {
          if (rectIndexAt(state, start.r, start.c) >= 0) api.apply(removeRectAt(state, start.r, start.c));
          else api.apply(placeRect(puzzle, state, { r: start.r, c: start.c, h: 1, w: 1 }));
        } else {
          api.apply(placeRect(puzzle, state, rectFromCorners(start.r, start.c, end.r, end.c)));
        }
        api.redraw();
      },
      cancel() {
        ui.drag = null;
        api.redraw();
      },
    };
  },
};
