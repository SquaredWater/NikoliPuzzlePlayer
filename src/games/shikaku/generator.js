import { createRng } from '../../engine/rng.js';
import { assertParams } from '../../engine/generate.js';
import { logicSolve } from './solver.js';

// minLevel/maxLevel：要求解题所需的推理等级落在此区间（见 solver.js）。
// candidates：收集多少道合格题后从中挑最难的一道。
const DIFFICULTY_CONFIG = {
  easy: { minArea: 2, maxArea: 6, peak: 3.5, spread: 1.5, minLevel: 1, maxLevel: 1, candidates: 1 },
  medium: { minArea: 2, maxArea: 10, peak: 5.5, spread: 2.5, minLevel: 2, maxLevel: 2, candidates: 3 },
  hard: { minArea: 2, maxArea: 18, peak: 9, spread: 4, minLevel: 3, maxLevel: 3, candidates: 3 },
};

const MAX_ATTEMPTS = 200;
const MAX_REPAIRS = 12;

function configFor(difficulty, width, height) {
  const base = DIFFICULTY_CONFIG[difficulty];
  const cap = Math.max(base.minArea + 2, Math.floor((width * height) / 3));
  return { ...base, maxArea: Math.min(base.maxArea, cap) };
}

/** 随机把盘面切分成矩形：按行优先找到第一个空格，以它为左上角随机选一个矩形。 */
export function randomPartition(width, height, cfg, rng) {
  const owner = new Int32Array(width * height).fill(-1);
  const rects = [];
  const areaWeight = (a) => Math.exp(-((a - cfg.peak) ** 2) / (2 * cfg.spread ** 2));
  const shapeWeight = (h, w) => 1 / (1 + 0.4 * (Math.max(h, w) / Math.min(h, w) - 1));

  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (owner[r * width + c] !== -1) continue;
      const options = [];
      const weights = [];
      let fallback = { h: 1, w: 1 };
      let maxH = height - r;
      for (let w = 1; c + w - 1 < width; w++) {
        const col = c + w - 1;
        if (owner[r * width + col] !== -1) break;
        let free = 0;
        while (free < maxH && owner[(r + free) * width + col] === -1) free++;
        maxH = free;
        for (let h = 1; h <= maxH; h++) {
          const a = h * w;
          if (a > cfg.maxArea) break;
          if (a < cfg.minArea) {
            if (a > fallback.h * fallback.w) fallback = { h, w };
            continue;
          }
          options.push({ h, w });
          weights.push(areaWeight(a) * shapeWeight(h, w));
        }
      }
      const pick = options.length ? options[rng.weightedIndex(weights)] : fallback;
      const rect = { r, c, h: pick.h, w: pick.w };
      for (let rr = r; rr < r + rect.h; rr++) {
        for (let cc = c; cc < c + rect.w; cc++) owner[rr * width + cc] = rects.length;
      }
      rects.push(rect);
    }
  }
  mergeSmallRects(rects, cfg, rng);
  return applyRandomSymmetry(rects, width, height, rng);
}

function mergeable(a, b) {
  if (a.r === b.r && a.h === b.h && (a.c + a.w === b.c || b.c + b.w === a.c)) return true;
  if (a.c === b.c && a.w === b.w && (a.r + a.h === b.r || b.r + b.h === a.r)) return true;
  return false;
}

// 扫描法在边角处难免留下过小的矩形，尽量与相邻矩形合并。
function mergeSmallRects(rects, cfg, rng) {
  for (let i = 0; i < rects.length; i++) {
    const a = rects[i];
    if (a.h * a.w >= cfg.minArea) continue;
    const partners = [];
    for (let j = 0; j < rects.length; j++) {
      const b = rects[j];
      if (j !== i && mergeable(a, b) && a.h * a.w + b.h * b.w <= cfg.maxArea + 1) partners.push(j);
    }
    if (!partners.length) continue;
    const j = rng.pick(partners);
    const b = rects[j];
    const merged = {
      r: Math.min(a.r, b.r),
      c: Math.min(a.c, b.c),
      h: a.r === b.r ? a.h : a.h + b.h,
      w: a.r === b.r ? a.w + b.w : a.w,
    };
    rects[Math.min(i, j)] = merged;
    rects.splice(Math.max(i, j), 1);
    i = -1;
  }
}

function applyRandomSymmetry(rects, width, height, rng) {
  const flipH = rng.next() < 0.5;
  const flipV = rng.next() < 0.5;
  const transpose = width === height && rng.next() < 0.5;
  return rects.map((rect) => {
    let { r, c, h, w } = rect;
    if (flipH) c = width - c - w;
    if (flipV) r = height - r - h;
    if (transpose) [r, c, h, w] = [c, r, w, h];
    return { r, c, h, w };
  });
}

function randomClue(rect, rng) {
  return {
    r: rect.r + rng.int(0, rect.h - 1),
    c: rect.c + rng.int(0, rect.w - 1),
    value: rect.h * rect.w,
  };
}

function scoreOf(res) {
  return res.level * 1000 + res.steps[3] * 10 + res.steps[2];
}

/**
 * 生成一道有唯一解的题目。相同参数（含 seed）总是生成同一道题。
 * 难度通过矩形大小分布 + 逻辑求解器所需推理等级来控制。
 */
export function generatePuzzle({ width, height, difficulty, seed }) {
  assertParams({ difficulty, seed });
  if (width < 3 || height < 3) throw new Error(`尺寸过小：${width}x${height}`);
  const rng = createRng(seed);
  const cfg = configFor(difficulty, width, height);
  let best = null;

  const tryPartition = (config, maxLevel) => {
    const rects = randomPartition(width, height, config, rng);
    let clues = rects.map((rect) => randomClue(rect, rng));
    for (let repair = 0; repair <= MAX_REPAIRS; repair++) {
      const res = logicSolve({ width, height, clues }, maxLevel);
      if (res.solved) return { rects, clues, res };
      // 推不下去：只重新摆放尚未确定的那些线索的位置。
      clues = clues.map((clue, i) => (res.done[i] ? clue : randomClue(rects[i], rng)));
    }
    return null;
  };

  // 收集若干道满足难度要求的题，取推理最复杂的一道。
  let qualified = 0;
  for (let attempt = 0; attempt < MAX_ATTEMPTS && qualified < cfg.candidates; attempt++) {
    const found = tryPartition(cfg, cfg.maxLevel);
    if (!found) continue;
    const ok = found.res.level >= cfg.minLevel;
    if (ok) qualified++;
    const bestOk = best && best.res.level >= cfg.minLevel;
    if (!best || (ok && !bestOk) || (ok === bestOk && scoreOf(found.res) > scoreOf(best.res))) best = found;
  }

  // 极端情况兜底：放宽限制直到得到可逻辑求解的题。
  for (let extra = 0; !best && extra < 500; extra++) {
    best = tryPartition({ ...cfg, maxArea: Math.max(cfg.minArea + 2, cfg.maxArea - extra) }, 3);
  }
  if (!best) throw new Error('生成失败');

  const { clues, res } = best;
  return {
    game: 'shikaku',
    width,
    height,
    difficulty,
    seed,
    clues,
    solution: res.solution,
    order: res.order,
    grade: { level: res.level, steps: res.steps.slice(1) },
  };
}
