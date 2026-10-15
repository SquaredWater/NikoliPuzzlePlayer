import { conflicts, isWhite, setDigit, structOf, toggleNote } from './index.js';
import { cellAt, drawGrid, drawOuterBorder, drawText, strokeCell, COLORS } from '../../app/draw.js';
import { digitFromKey, drawNotes } from '../../app/digits.js';

const BLACK = '#3a3a3a';
const CLUE = '#fff';
const CLUE_ERROR = '#ff7b7b';
const ARROWS = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

/** 方向键移动到该方向上的下一个白格（跳过黑格，越界环绕）；不是方向键返回 null。 */
function moveSelection(puzzle, sel, key) {
  const d = ARROWS[key];
  if (!d) return null;
  const { width: W, height: H } = puzzle;
  if (!sel) {
    const first = puzzle.solution.findIndex((x) => x > 0);
    return first < 0 ? null : { r: Math.floor(first / W), c: first % W };
  }
  let { r, c } = sel;
  for (let k = 0; k < Math.max(W, H); k++) {
    r = (r + d[0] + H) % H;
    c = (c + d[1] + W) % W;
    if (isWhite(puzzle, r * W + c)) return { r, c };
  }
  return sel;
}

export default {
  controls: [
    '点击白格选中，按数字键 1~9 填数，按 0 / Backspace / Delete 清除；方向键移动选中格（自动跳过黑格）。',
    '按 N 或点“笔记”切换笔记模式；按住 Shift 输入数字也可直接记笔记。',
    '再次输入同一个数字会将其清除。填数时会自动删掉同段笔记里的该数字。',
  ],

  size(puzzle) {
    return { cols: puzzle.width, rows: puzzle.height };
  },

  pad(puzzle, ui) {
    const items = [];
    for (let d = 1; d <= 9; d++) items.push({ label: String(d), key: String(d) });
    items.push({ label: '清除', key: 'Delete' });
    items.push({ label: '笔记', key: 'n', active: ui.notes, title: '切换笔记模式（N）' });
    return items;
  },

  draw(ctx, { puzzle, state, unit: u, showErrors, wrong, ui }) {
    const { width: W, height: H, solution, across, down } = puzzle;
    const S = structOf(puzzle);
    ctx.fillStyle = COLORS.paper;
    ctx.fillRect(0, 0, W * u, H * u);

    const sel = ui.sel && isWhite(puzzle, ui.sel.r * W + ui.sel.c) ? ui.sel : null;
    if (sel) {
      const cell = sel.r * W + sel.c;
      ctx.fillStyle = COLORS.same;
      for (const p of S.peers[S.varOf[cell]]) ctx.fillRect((p % W) * u, Math.floor(p / W) * u, u, u);
      ctx.fillStyle = COLORS.select;
      ctx.fillRect(sel.c * u, sel.r * u, u, u);
    }

    drawGrid(ctx, W, H, u);

    const bad = showErrors ? conflicts(puzzle, state) : { cells: new Set(), clues: new Set() };
    const clueSize = Math.max(7, u * 0.3);
    for (let i = 0; i < W * H; i++) {
      const x = (i % W) * u;
      const y = Math.floor(i / W) * u;
      if (solution[i]) {
        const d = state.v[i];
        if (d) drawText(ctx, d, x + u / 2, y + u / 2, u * 0.6, bad.cells.has(i) ? COLORS.error : COLORS.entry, false);
        else if (state.notes[i]) drawNotes(ctx, state.notes[i], x, y, u, 9);
        continue;
      }
      ctx.fillStyle = BLACK;
      ctx.fillRect(x, y, u, u);
      if (!across[i] && !down[i]) continue;
      ctx.strokeStyle = '#999';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 1, y + 1);
      ctx.lineTo(x + u - 1, y + u - 1);
      ctx.stroke();
      if (across[i]) drawText(ctx, across[i], x + u * 0.7, y + u * 0.3, clueSize, bad.clues.has(`${i}:0`) ? CLUE_ERROR : CLUE);
      if (down[i]) drawText(ctx, down[i], x + u * 0.3, y + u * 0.7, clueSize, bad.clues.has(`${i}:1`) ? CLUE_ERROR : CLUE);
    }

    drawOuterBorder(ctx, W, H, u);
    if (sel) {
      ctx.strokeStyle = COLORS.accent;
      ctx.lineWidth = 2;
      ctx.strokeRect(sel.c * u + 1, sel.r * u + 1, u - 2, u - 2);
    }
    for (const i of wrong || []) strokeCell(ctx, Math.floor(i / W), i % W, u);
  },

  createInput(api) {
    const ui = { sel: null, notes: false };
    return {
      ui,
      down(p) {
        const puzzle = api.puzzle();
        const cell = cellAt(p, puzzle.width, puzzle.height);
        if (!cell || !isWhite(puzzle, cell.r * puzzle.width + cell.c)) return;
        ui.sel = cell;
        api.redraw();
      },
      key(ev) {
        const puzzle = api.puzzle();
        if (ev.key === 'n' || ev.key === 'N') {
          ui.notes = !ui.notes;
          api.redraw();
          return true;
        }
        const moved = moveSelection(puzzle, ui.sel, ev.key);
        if (moved) {
          ui.sel = moved;
          api.redraw();
          return true;
        }
        const d = digitFromKey(ev, 9);
        if (d === null) return false;
        if (!ui.sel) {
          api.message('请先点击选中一个白格');
          return true;
        }
        const cell = ui.sel.r * puzzle.width + ui.sel.c;
        if (!isWhite(puzzle, cell)) return true;
        const state = api.state();
        if (d === 0) api.apply(setDigit(puzzle, state, cell, 0));
        else if (ui.notes || ev.shiftKey) api.apply(toggleNote(puzzle, state, cell, d));
        else api.apply(setDigit(puzzle, state, cell, state.v[cell] === d ? 0 : d));
        return true;
      },
    };
  },
};
