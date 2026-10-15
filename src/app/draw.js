// 各游戏 view 共用的绘制与坐标工具。坐标约定：p = { x, y }，单位为“格”，原点为盘面左上角。

export const COLORS = {
  paper: '#fff',
  ink: '#111',
  grid: '#ccc',
  border: '#222',
  accent: '#1e6eff',
  given: '#111',
  entry: '#1e5bd8',
  error: '#d32f2f',
  errorFill: '#f4b9b9',
  shade: '#333',
  mark: '#888',
  hint: '#2e7d32',
  select: 'rgba(30, 110, 255, 0.18)',
  same: 'rgba(30, 110, 255, 0.08)',
};

/** 坐标所在的格子；clamp 为真时夹到盘面内，否则越界返回 null。 */
export function cellAt(p, width, height, clamp = false) {
  let c = Math.floor(p.x);
  let r = Math.floor(p.y);
  if (clamp) {
    c = Math.min(width - 1, Math.max(0, c));
    r = Math.min(height - 1, Math.max(0, r));
  } else if (r < 0 || c < 0 || r >= height || c >= width) {
    return null;
  }
  return { r, c };
}

/**
 * 最近的格线边：在 width×height 格的网格上，
 *   { dir: 'h', r, c } 为第 r 条横线上第 c 段（r: 0..height, c: 0..width-1）
 *   { dir: 'v', r, c } 为第 c 条竖线上第 r 段（r: 0..height-1, c: 0..width）
 * 离边太远（超过 tolerance 格）返回 null。
 * 珍珠等“连格子中心”的游戏可传入 { x: x - 0.5, y: y - 0.5 } 与 (width-1)×(height-1)。
 */
export function nearestGridEdge(p, width, height, tolerance = 0.35) {
  const hr = Math.round(p.y);
  const hc = Math.floor(p.x);
  const hd = Math.abs(p.y - hr);
  const vc = Math.round(p.x);
  const vr = Math.floor(p.y);
  const vd = Math.abs(p.x - vc);
  const hOk = hr >= 0 && hr <= height && hc >= 0 && hc < width && hd <= tolerance;
  const vOk = vc >= 0 && vc <= width && vr >= 0 && vr < height && vd <= tolerance;
  if (hOk && (!vOk || hd <= vd)) return { dir: 'h', r: hr, c: hc };
  if (vOk) return { dir: 'v', r: vr, c: vc };
  return null;
}

export function drawGrid(ctx, width, height, u, { color = COLORS.grid, dash = null } = {}) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  if (dash) ctx.setLineDash(dash);
  ctx.beginPath();
  for (let c = 0; c <= width; c++) {
    ctx.moveTo(c * u + 0.5, 0);
    ctx.lineTo(c * u + 0.5, height * u);
  }
  for (let r = 0; r <= height; r++) {
    ctx.moveTo(0, r * u + 0.5);
    ctx.lineTo(width * u, r * u + 0.5);
  }
  ctx.stroke();
  ctx.restore();
}

export function drawOuterBorder(ctx, width, height, u, color = COLORS.border) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.strokeRect(-1, -1, width * u + 2, height * u + 2);
}

/** 在 (cx, cy) 居中绘制文字；size 为字号像素。 */
export function drawText(ctx, text, cx, cy, size, color = COLORS.ink, bold = true) {
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${bold ? 'bold ' : ''}${Math.round(size)}px system-ui, sans-serif`;
  ctx.fillText(String(text), cx, cy + size * 0.05);
}

export function drawCross(ctx, cx, cy, half, color = COLORS.mark, width = 1.5) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(cx - half, cy - half);
  ctx.lineTo(cx + half, cy + half);
  ctx.moveTo(cx + half, cy - half);
  ctx.lineTo(cx - half, cy + half);
  ctx.stroke();
}

export function drawDot(ctx, cx, cy, radius, color = COLORS.mark) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
}

export function drawCircle(ctx, cx, cy, radius, { fill = null, stroke = COLORS.ink, width = 1.5 } = {}) {
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.stroke();
  }
}

/** 在格子 (r, c) 周围画一个闪烁用的红框。 */
export function strokeCell(ctx, r, c, u, color = COLORS.error, width = 3) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.strokeRect(c * u + width / 2, r * u + width / 2, u - width, u - width);
}
