// 盘面与矩形的通用工具。矩形统一表示为 { r, c, h, w }（左上角行、列，高、宽）。

export function rectArea(rect) {
  return rect.h * rect.w;
}

export function rectContains(rect, r, c) {
  return r >= rect.r && r < rect.r + rect.h && c >= rect.c && c < rect.c + rect.w;
}

export function rectsOverlap(a, b) {
  return a.r < b.r + b.h && b.r < a.r + a.h && a.c < b.c + b.w && b.c < a.c + a.w;
}

export function sameRect(a, b) {
  return a.r === b.r && a.c === b.c && a.h === b.h && a.w === b.w;
}

export function rectFromCorners(r1, c1, r2, c2) {
  const r = Math.min(r1, r2);
  const c = Math.min(c1, c2);
  return { r, c, h: Math.abs(r1 - r2) + 1, w: Math.abs(c1 - c2) + 1 };
}

export function rectCells(rect, width) {
  const cells = [];
  for (let r = rect.r; r < rect.r + rect.h; r++) {
    for (let c = rect.c; c < rect.c + rect.w; c++) cells.push(r * width + c);
  }
  return cells;
}

/** 每个格子对应的线索下标，无线索为 -1。 */
export function buildClueGrid(puzzle) {
  const grid = new Int32Array(puzzle.width * puzzle.height).fill(-1);
  puzzle.clues.forEach((clue, i) => {
    grid[clue.r * puzzle.width + clue.c] = i;
  });
  return grid;
}

export function cluesInRect(puzzle, clueGrid, rect) {
  const found = [];
  for (let r = rect.r; r < rect.r + rect.h; r++) {
    for (let c = rect.c; c < rect.c + rect.w; c++) {
      const i = clueGrid[r * puzzle.width + c];
      if (i >= 0) found.push(i);
    }
  }
  return found;
}

/**
 * 枚举每条线索所有可能的矩形：面积等于线索值、包含该线索且不包含其他线索。
 * 返回数组，下标为线索序号，元素为 { clue, r, c, h, w, cells }。
 */
export function enumerateCandidates(puzzle) {
  const { width: W, height: H, clues } = puzzle;
  const stride = W + 1;
  const pre = new Int32Array((H + 1) * stride);
  const mark = new Uint8Array(W * H);
  for (const clue of clues) mark[clue.r * W + clue.c] = 1;
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      pre[(r + 1) * stride + c + 1] =
        mark[r * W + c] + pre[r * stride + c + 1] + pre[(r + 1) * stride + c] - pre[r * stride + c];
    }
  }
  const count = (r, c, h, w) =>
    pre[(r + h) * stride + c + w] - pre[r * stride + c + w] - pre[(r + h) * stride + c] + pre[r * stride + c];

  return clues.map((clue, i) => {
    const list = [];
    const v = clue.value;
    for (let h = 1; h <= Math.min(v, H); h++) {
      if (v % h !== 0) continue;
      const w = v / h;
      if (w > W) continue;
      for (let r0 = Math.max(0, clue.r - h + 1); r0 <= Math.min(clue.r, H - h); r0++) {
        for (let c0 = Math.max(0, clue.c - w + 1); c0 <= Math.min(clue.c, W - w); c0++) {
          if (count(r0, c0, h, w) !== 1) continue;
          const rect = { clue: i, r: r0, c: c0, h, w };
          rect.cells = rectCells(rect, W);
          list.push(rect);
        }
      }
    }
    return list;
  });
}
