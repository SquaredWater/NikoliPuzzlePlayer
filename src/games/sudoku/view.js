import { conflicts, digitAt, setDigit, toggleNote } from './index.js';
import { cellAt, drawGrid, drawOuterBorder, drawText, strokeCell, COLORS } from '../../app/draw.js';
import { digitFromKey, drawNotes, moveSelection } from '../../app/digits.js';

export default {
  controls: [
    '点击选中格子，按数字键填数，按 0 / Backspace / Delete 清除；方向键移动选中格。',
    '按 N 或点“笔记”切换笔记模式；按住 Shift 输入数字也可直接记笔记。',
    '再次输入同一个数字会将其清除。填数时会自动删掉同行、列、宫笔记里的该数字。',
  ],

  size(puzzle) {
    return { cols: puzzle.width, rows: puzzle.height };
  },

  pad(puzzle, ui) {
    const items = [];
    for (let d = 1; d <= puzzle.width; d++) items.push({ label: String(d), key: String(d) });
    items.push({ label: '清除', key: 'Delete' });
    items.push({ label: '笔记', key: 'n', active: ui.notes, title: '切换笔记模式（N）' });
    return items;
  },

  draw(ctx, { puzzle, state, unit: u, showErrors, wrong, ui }) {
    const n = puzzle.width;
    const [br, bc] = puzzle.box;
    ctx.fillStyle = COLORS.paper;
    ctx.fillRect(0, 0, n * u, n * u);

    const sel = ui.sel;
    if (sel) {
      const selDigit = digitAt(puzzle, state, sel.r * n + sel.c);
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          const sameUnit =
            r === sel.r || c === sel.c || (Math.floor(r / br) === Math.floor(sel.r / br) && Math.floor(c / bc) === Math.floor(sel.c / bc));
          const sameDigit = selDigit && digitAt(puzzle, state, r * n + c) === selDigit;
          if (sameUnit || sameDigit) {
            ctx.fillStyle = sameDigit ? 'rgba(30, 110, 255, 0.16)' : COLORS.same;
            ctx.fillRect(c * u, r * u, u, u);
          }
        }
      }
      ctx.fillStyle = COLORS.select;
      ctx.fillRect(sel.c * u, sel.r * u, u, u);
    }

    drawGrid(ctx, n, n, u);
    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let c = bc; c < n; c += bc) {
      ctx.moveTo(c * u, 0);
      ctx.lineTo(c * u, n * u);
    }
    for (let r = br; r < n; r += br) {
      ctx.moveTo(0, r * u);
      ctx.lineTo(n * u, r * u);
    }
    ctx.stroke();
    drawOuterBorder(ctx, n, n, u);

    const bad = showErrors ? conflicts(puzzle, state) : new Set();
    for (let i = 0; i < n * n; i++) {
      const r = Math.floor(i / n);
      const c = i % n;
      const given = puzzle.givens[i];
      const d = given || state.v[i];
      if (d) {
        const color = bad.has(i) && !given ? COLORS.error : given ? COLORS.given : COLORS.entry;
        drawText(ctx, d, c * u + u / 2, r * u + u / 2, u * 0.6, color, !!given);
        if (bad.has(i) && given) {
          ctx.fillStyle = 'rgba(211, 47, 47, 0.15)';
          ctx.fillRect(c * u, r * u, u, u);
        }
      } else if (state.notes[i]) {
        drawNotes(ctx, state.notes[i], c * u, r * u, u, n);
      }
    }

    for (const i of wrong || []) strokeCell(ctx, Math.floor(i / n), i % n, u);
  },

  createInput(api) {
    const ui = { sel: null, notes: false };
    return {
      ui,
      down(p) {
        const n = api.puzzle().width;
        const cell = cellAt(p, n, n);
        if (!cell) return;
        ui.sel = cell;
        api.redraw();
      },
      key(ev) {
        const puzzle = api.puzzle();
        const n = puzzle.width;
        if (ev.key === 'n' || ev.key === 'N') {
          ui.notes = !ui.notes;
          api.redraw();
          return true;
        }
        const moved = moveSelection(ui.sel, ev.key, n, n);
        if (moved) {
          ui.sel = moved;
          api.redraw();
          return true;
        }
        const d = digitFromKey(ev, n);
        if (d === null) return false;
        if (!ui.sel) {
          api.message('请先点击选中一个格子');
          return true;
        }
        const cell = ui.sel.r * n + ui.sel.c;
        if (puzzle.givens[cell]) return true;
        const state = api.state();
        if (d === 0) api.apply(setDigit(puzzle, state, cell, 0));
        else if (ui.notes || ev.shiftKey) api.apply(toggleNote(puzzle, state, cell, d));
        else api.apply(setDigit(puzzle, state, cell, state.v[cell] === d ? 0 : d));
        return true;
      },
    };
  },
};
