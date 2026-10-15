// 填数类游戏（数独、数和）共用的输入与绘制工具。

/** 按键对应的数字：1..max 返回数字，清除键返回 0，其他返回 null。兼容 Shift+数字。 */
export function digitFromKey(ev, max) {
  const m = /^(?:Digit|Numpad)(\d)$/.exec(ev.code || '');
  const d = m ? Number(m[1]) : /^\d$/.test(ev.key) ? Number(ev.key) : null;
  if (d !== null) return d === 0 ? 0 : d <= max ? d : null;
  if (ev.key === 'Backspace' || ev.key === 'Delete' || ev.key === ' ') return 0;
  return null;
}

const ARROWS = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

/** 方向键移动选中格（越界时环绕）；不是方向键返回 null。 */
export function moveSelection(sel, key, width, height) {
  const d = ARROWS[key];
  if (!d) return null;
  const r = sel ? (sel.r + d[0] + height) % height : 0;
  const c = sel ? (sel.c + d[1] + width) % width : 0;
  return { r, c };
}

/** 在格子 (x, y) 内画笔记数字，按 3 列排布。 */
export function drawNotes(ctx, mask, x, y, u, max, color = '#666') {
  if (!mask) return;
  const cols = max <= 4 ? 2 : 3;
  const rows = Math.ceil(max / cols);
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.max(8, Math.round((u / Math.max(cols, rows)) * 0.75))}px system-ui, sans-serif`;
  for (let d = 1; d <= max; d++) {
    if (!(mask & (1 << (d - 1)))) continue;
    const i = d - 1;
    const cx = x + ((i % cols) + 0.5) * (u / cols);
    const cy = y + (Math.floor(i / cols) + 0.5) * (u / rows);
    ctx.fillText(String(d), cx, cy + 1);
  }
}
