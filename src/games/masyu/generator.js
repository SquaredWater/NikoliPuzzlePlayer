// 珍珠出题：
//   1. 在 (W-1)×(H-1) 个“格子中心之间的小方块”上生长一个单连通、无洞、无对角接触的区域，
//      区域边界就是经过格子中心的单一回路；
//   2. 在回路上放全部候选珍珠，若逻辑解不出，就在未确定的边附近翻转小方块做局部修补；
//   3. 按随机顺序删珍珠，删后仍能在难度等级内逻辑解出才保留删除。
// 多次失败时逐级放宽难度，最后用固定种子的兜底回路。
import { createRng } from '../../engine/rng.js';
import { assertParams, DIFFICULTY_LEVELS, minimizeClues, pickGraded } from '../../engine/generate.js';
import { logicSolve } from '../../engine/logic.js';
import { BLACK, WHITE, buildModel, layoutOf } from './model.js';

// 生长打分（越小越优先）：放不了珍珠的形态扣分；按区域内相邻方块数给奖励，偏向长出细枝使回路曲折
const SAMPLE = 10;
const SHORT_PENALTY = 1;
const LONG_PENALTY = 1;
const GROW_BONUS = [0, 1, 0.3, 0, 0];
const NOISE = 1;

/** 方块区域。方块 (i,j) 的四角是格子 (i,j) (i,j+1) (i+1,j) (i+1,j+1)。 */
class Region {
  constructor(W, H) {
    this.W = W;
    this.H = H;
    this.BW = W - 1;
    this.BH = H - 1;
    this.inR = new Uint8Array(this.BW * this.BH);
    this.queue = new Int32Array(this.inR.length);
    this.seen = new Uint8Array(this.inR.length);
  }

  blk(i, j) {
    return i >= 0 && j >= 0 && i < this.BH && j < this.BW ? this.inR[i * this.BW + j] : 0;
  }

  // 格子 (r,c) 处两个对角方块在区域内、另两个不在：回路会在此交叉
  pinched(r, c) {
    const a = this.blk(r - 1, c - 1);
    const b = this.blk(r - 1, c);
    return a === this.blk(r, c) && b === this.blk(r, c - 1) && a !== b;
  }

  /** 从 starts 出发，在 inR[k] === want 的方块间扩散，返回到达数。 */
  flood(starts, want) {
    const { inR, queue, seen, BW, BH } = this;
    seen.fill(0);
    let head = 0;
    let tail = 0;
    for (const k of starts) {
      seen[k] = 1;
      queue[tail++] = k;
    }
    while (head < tail) {
      const k = queue[head++];
      const i = Math.floor(k / BW);
      const j = k % BW;
      if (i > 0) tail = this.push(k - BW, want, tail);
      if (i < BH - 1) tail = this.push(k + BW, want, tail);
      if (j > 0) tail = this.push(k - 1, want, tail);
      if (j < BW - 1) tail = this.push(k + 1, want, tail);
    }
    return tail;
  }

  push(n, want, tail) {
    if (this.inR[n] !== want || this.seen[n]) return tail;
    this.seen[n] = 1;
    this.queue[tail++] = n;
    return tail;
  }

  /** 区域连通、非空，且区域外的方块都能连到盘面外（无洞）。 */
  simple() {
    const { inR, BW, BH } = this;
    const inside = [];
    const border = [];
    let outside = 0;
    for (let k = 0; k < inR.length; k++) {
      if (inR[k]) {
        if (!inside.length) inside.push(k);
        continue;
      }
      outside++;
      const i = Math.floor(k / BW);
      const j = k % BW;
      if (i === 0 || j === 0 || i === BH - 1 || j === BW - 1) border.push(k);
    }
    const total = inR.length - outside;
    if (!total || this.flood(inside, 1) !== total) return false;
    return this.flood(border, 0) === outside;
  }

  /** 翻转方块 k；若结果不是简单多边形则撤销并返回 false。 */
  toggle(k, checkAll = true) {
    const i = Math.floor(k / this.BW);
    const j = k % this.BW;
    this.inR[k] ^= 1;
    const ok =
      !this.pinched(i, j) &&
      !this.pinched(i, j + 1) &&
      !this.pinched(i + 1, j) &&
      !this.pinched(i + 1, j + 1) &&
      (!checkAll || this.simple());
    if (!ok) this.inR[k] ^= 1;
    return ok;
  }

  edgeH(r, c) {
    return c >= 0 && c < this.W - 1 && this.blk(r - 1, c) !== this.blk(r, c);
  }

  edgeV(r, c) {
    return r >= 0 && r < this.H - 1 && this.blk(r, c - 1) !== this.blk(r, c);
  }

  /** 格子类型：0 不在回路上，1 直行，2 转弯。 */
  kind(r, c) {
    const u = this.edgeV(r - 1, c);
    const d = this.edgeV(r, c);
    const l = this.edgeH(r, c - 1);
    const rt = this.edgeH(r, c);
    if (!(u || d || l || rt)) return 0;
    return (u && d) || (l && rt) ? 1 : 2;
  }

  covered() {
    let n = 0;
    for (let r = 0; r < this.H; r++) for (let c = 0; c < this.W; c++) if (this.kind(r, c)) n++;
    return n;
  }

  // 方块 (i,j) 附近放不了珍珠的形态：两端都转弯的短段（阶梯）、三格以上直线的中段，
  // 这些地方缺少珍珠约束，容易多解。翻转方块只改变其四角的类型，统计外扩一圈即可。
  badNear(i, j) {
    let n = 0;
    for (let r = i - 1; r <= i + 2; r++) {
      for (let c = j - 1; c <= j + 2; c++) {
        const k = this.kind(r, c);
        if (!k) continue;
        const nbs = [];
        if (this.edgeV(r - 1, c)) nbs.push(this.kind(r - 1, c));
        if (this.edgeV(r, c)) nbs.push(this.kind(r + 1, c));
        if (this.edgeH(r, c - 1)) nbs.push(this.kind(r, c - 1));
        if (this.edgeH(r, c)) nbs.push(this.kind(r, c + 1));
        if (k === 2) n += SHORT_PENALTY * 0.5 * nbs.filter((x) => x === 2).length;
        else if (nbs[0] === 1 && nbs[1] === 1) n += LONG_PENALTY;
      }
    }
    return n;
  }

  /** 区域边界 → 每条边 0/1（边编号见 model.js）。 */
  edges() {
    const L = layoutOf(this.W, this.H);
    const sol = new Array(L.E).fill(0);
    for (let i = 0; i < L.N; i++) {
      const r = Math.floor(i / this.W);
      const c = i % this.W;
      if (L.right[i] >= 0 && this.edgeH(r, c)) sol[L.right[i]] = 1;
      if (L.down[i] >= 0 && this.edgeV(r, c)) sol[L.down[i]] = 1;
    }
    return sol;
  }
}

/** 随机生长区域，直到回路经过约 coverage 比例的格子。 */
export function growRegion(W, H, rng, coverage) {
  const R = new Region(W, H);
  const { BW, inR } = R;
  inR[rng.int(0, inR.length - 1)] = 1;
  const target = Math.round(coverage * W * H);
  const rejected = new Uint8Array(inR.length);
  let covered = 4;
  while (covered < target) {
    const cand = [];
    for (let k = 0; k < inR.length; k++) {
      if (inR[k] || rejected[k]) continue;
      const i = Math.floor(k / BW);
      const j = k % BW;
      const n = R.blk(i - 1, j) + R.blk(i + 1, j) + R.blk(i, j - 1) + R.blk(i, j + 1);
      if (n === 1 || n === 2) cand.push([k, n]);
    }
    if (!cand.length) break;
    // 随机抽几个候选打分，按分数依次尝试
    const scored = rng
      .shuffle(cand)
      .slice(0, SAMPLE)
      .map(([k, n]) => {
        const i = Math.floor(k / BW);
        const j = k % BW;
        const before = R.badNear(i, j);
        inR[k] = 1;
        const after = R.badNear(i, j);
        inR[k] = 0;
        return [k, after - before - GROW_BONUS[n] + rng.next() * NOISE];
      })
      .sort((a, b) => a[1] - b[1]);
    let added = false;
    for (const [k] of scored) {
      if (R.toggle(k)) {
        added = true;
        break;
      }
      rejected[k] = 1;
    }
    if (!added) continue;
    rejected.fill(0);
    covered = R.covered();
  }
  return R;
}

/** 回路上所有可放珍珠的位置：返回每格 0 / WHITE / BLACK。 */
export function pearlCandidates(W, H, sol) {
  const { N, ce, nb } = layoutOf(W, H);
  const line = (i, d) => i >= 0 && ce[i * 4 + d] >= 0 && sol[ce[i * 4 + d]] === 1;
  const straight = (i) => (line(i, 0) && line(i, 2)) || (line(i, 1) && line(i, 3));
  const out = new Array(N).fill(0);
  for (let i = 0; i < N; i++) {
    let deg = 0;
    for (let d = 0; d < 4; d++) if (line(i, d)) deg++;
    if (deg !== 2) continue;
    if (straight(i)) {
      const a = line(i, 0) ? 0 : 1;
      if (!straight(nb[i * 4 + a]) || !straight(nb[i * 4 + a + 2])) out[i] = WHITE;
    } else {
      let ok = true;
      for (let d = 0; d < 4; d++) if (line(i, d) && !line(nb[i * 4 + d], d)) ok = false;
      if (ok) out[i] = BLACK;
    }
  }
  return out;
}

function unresolved(res) {
  let n = 0;
  for (const v of res.values) if (v < 0) n++;
  return n;
}

/**
 * 局部修补：全部候选珍珠逻辑解不出时，在某条未确定的边两侧附近翻转一个方块，
 * 未确定的边不增加就接受。返回 { sol, pearls, result } 或 null。
 */
export function repairLoop(R, rng, level, budget) {
  const { W, H, BW, BH } = R;
  const L = layoutOf(W, H);
  const minCover = Math.round(W * H * 0.5);
  const evaluate = () => {
    const sol = R.edges();
    const pearls = pearlCandidates(W, H, sol);
    return { sol, pearls, result: logicSolve(buildModel(W, H, pearls), level) };
  };
  let cur = evaluate();
  let score = unresolved(cur.result);
  for (let it = 0; it < budget && !cur.result.solved; it++) {
    const open = [];
    cur.result.values.forEach((v, e) => v < 0 && open.push(e));
    const e = rng.pick(open);
    const a = L.ea[e];
    const r = Math.floor(a / W);
    const c = a % W;
    // 横边两侧是方块 (r-1,c)、(r,c)；竖边两侧是 (r,c-1)、(r,c)。再加上它们的邻块
    const near = [];
    const sides = L.eb[e] === a + 1 ? [[r - 1, c], [r, c]] : [[r, c - 1], [r, c]];
    for (const [i, j] of sides) {
      for (const [di, dj] of [[0, 0], [0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const ni = i + di;
        const nj = j + dj;
        if (ni >= 0 && nj >= 0 && ni < BH && nj < BW) near.push(ni * BW + nj);
      }
    }
    const k = rng.pick(near);
    if (!R.toggle(k)) continue;
    const next = evaluate();
    const s = unresolved(next.result);
    if (s <= score && R.covered() >= minCover) {
      cur = next;
      score = s;
    } else {
      R.inR[k] ^= 1;
    }
  }
  return cur.result.solved ? cur : null;
}

const repairBudget = (W, H) => 200 + 25 * Math.max(W, H);

/** 兜底：用固定种子依次尝试（与题目种子无关，结果确定；测试中对全部允许尺寸验证过能成功）。 */
export function fallbackBase(W, H) {
  for (let k = 1; k <= 20; k++) {
    const rng = createRng(k);
    const base = repairLoop(growRegion(W, H, rng, 0.75), rng, 2, repairBudget(W, H) * 2);
    if (base) return base;
  }
  return null;
}

const KEEP_RATIO = { easy: 0.45, medium: 0, hard: 0 };

/** 删珍珠：base 为全部候选珍珠（已确认 2 级内可解），按随机顺序删。 */
function minimize(W, H, base, rng, difficulty, maxLevel) {
  const full = base.pearls;
  const cells = [];
  full.forEach((p, i) => p && cells.push(i));
  const pearlsOf = (active) => {
    const p = new Array(W * H).fill(0);
    cells.forEach((cell, k) => {
      if (active[k]) p[cell] = full[cell];
    });
    return p;
  };
  const ok = (level) => (act) => logicSolve(buildModel(W, H, pearlsOf(act)), level).solved;
  let active;
  if (maxLevel < 3) {
    const minKeep = Math.round(cells.length * KEEP_RATIO[difficulty]);
    active = minimizeClues(cells.length, rng, ok(maxLevel), { minKeep });
  } else {
    // 试探代价高：先用二级规则删到不能再删，再对剩下的用试探删
    active = minimizeClues(cells.length, rng, ok(2));
    const rest = [];
    active.forEach((a, k) => a && rest.push(k));
    for (const k of rng.shuffle(rest)) {
      active[k] = 0;
      if (!ok(3)(active)) active[k] = 1;
    }
  }
  const pearls = pearlsOf(active);
  const result = logicSolve(buildModel(W, H, pearls), maxLevel);
  return result.solved ? { sol: base.sol, pearls, result } : null;
}

export function generatePuzzle({ width, height, difficulty, seed }) {
  assertParams({ difficulty, seed });
  const W = width;
  const H = height;
  if (!(W >= 3 && H >= 3 && W <= 30 && H <= 30)) throw new Error(`珍珠不支持 ${W}x${H}`);
  const rng = createRng(seed);
  const { minLevel, maxLevel } = DIFFICULTY_LEVELS[difficulty];
  // 修补时只用 1~2 级规则（试探太慢）；困难题在删珍珠时才用试探
  const budget = repairBudget(W, H);
  const build = (level) => {
    const R = growRegion(W, H, rng, 0.65 + rng.next() * 0.2);
    const base = repairLoop(R, rng, Math.min(level, 2), budget);
    return base && minimize(W, H, base, rng, difficulty, level);
  };

  let best = pickGraded({ minLevel, attempts: maxLevel < 3 ? 8 : 4, want: 1, make: () => build(maxLevel) });
  // 兜底：逐级放宽难度，最后用固定种子的回路
  for (let level = maxLevel + 1; !best && level <= 3; level++) {
    for (let i = 0; !best && i < 4; i++) best = build(level);
  }
  if (!best) {
    const base = fallbackBase(W, H);
    best = base && minimize(W, H, base, rng, difficulty, 3);
  }
  if (!best) throw new Error('生成失败');

  const { sol, pearls, result } = best;
  return {
    game: 'masyu',
    width: W,
    height: H,
    difficulty,
    seed,
    pearls,
    solution: sol,
    order: result.order.filter((e) => sol[e] === 1),
    grade: { level: result.level, steps: result.steps.slice(1) },
  };
}
