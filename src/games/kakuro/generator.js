// 数和生成：随机黑白布局 → 回溯填数 → 逻辑求解；卡住时保留已推出的格子，
// 对未定格附近局部重新填数（偏向组合唯一的和），反复修补直到能在指定等级内解出；
// 解出后若推理太简单，再做局部扰动“加难”。
import { createRng } from '../../engine/rng.js';
import { DIFFICULTY_LEVELS, pickGraded } from '../../engine/generate.js';
import { logicSolve, popcount } from '../../engine/logic.js';
import { buildModel, buildStruct, runSums } from './model.js';

// maxLen：段长上限；density：白格占内部格子的比例；repairs / harden：修补、加难的扰动次数；
// weights：加难时填数各数字的权重（修补时统一用 REPAIR_WEIGHTS）。
const CONFIG = {
  easy: { maxLen: 5, density: [0.55, 0.62], repairs: 300, harden: 0, attempts: 12, weights: null },
  medium: { maxLen: 7, density: [0.6, 0.67], repairs: 300, harden: 40, attempts: 8, weights: [3, 2, 1.5, 1, 1, 1, 1.5, 2, 3] },
  hard: { maxLen: 9, density: [0.62, 0.69], repairs: 300, harden: 150, attempts: 8, weights: [1, 1, 1, 1, 1, 1, 1, 1, 1] },
};

// 偏向两端的数字，使和更容易只有唯一组合，修补收敛快得多
const REPAIR_WEIGHTS = [10, 6, 3, 1, 1, 1, 3, 6, 10];

// ---------------------------------------------------------------------------
// 布局
// ---------------------------------------------------------------------------

/**
 * 随机布局：第 0 行、第 0 列为黑格，其余从全白开始成对（180° 对称）涂黑，
 * 始终保持每个白格的横段、竖段长度 ≥2 且白格连通。
 * 先拆开超长的段（此时白格多，余地大），再随机涂黑到目标密度。
 * 失败或拆完长段后白格比例已低于 minDensity 时返回 null。
 */
export function makeLayout(width, height, rng, { maxLen, density, minDensity = density[0] - 0.05 }) {
  const N = width * height;
  const white = new Uint8Array(N);
  for (let r = 1; r < height; r++) for (let c = 1; c < width; c++) white[r * width + c] = 1;
  const interior = (width - 1) * (height - 1);
  let count = interior;
  const mirror = (i) => (height - Math.floor(i / width)) * width + (width - (i % width));
  const neighbors = (i) => {
    const c = i % width;
    return [c > 0 ? i - 1 : -1, c < width - 1 ? i + 1 : -1, i - width, i + width].filter((j) => j >= 0 && j < N);
  };
  const hLen = (i) => {
    const c = i % width;
    let n = 1;
    for (let k = c - 1; k >= 0 && white[i - c + k]; k--) n++;
    for (let k = c + 1; k < width && white[i - c + k]; k++) n++;
    return n;
  };
  const vLen = (i) => {
    let n = 1;
    for (let j = i - width; j >= 0 && white[j]; j -= width) n++;
    for (let j = i + width; j < N && white[j]; j += width) n++;
    return n;
  };

  const connected = () => {
    let start = -1;
    for (let i = 0; i < N && start < 0; i++) if (white[i]) start = i;
    if (start < 0) return false;
    const seen = new Uint8Array(N);
    const stack = [start];
    seen[start] = 1;
    let reached = 1;
    while (stack.length) {
      const i = stack.pop();
      for (const j of neighbors(i)) {
        if (white[j] && !seen[j]) {
          seen[j] = 1;
          reached++;
          stack.push(j);
        }
      }
    }
    return reached === count;
  };

  // 涂黑 i 及其对称格；因此变成单格段的白格也连同对称格一起涂黑（最多涂 limit 格）。
  // 结果不连通或超过 limit 则撤销。
  const tryBlack = (i, limit) => {
    if (!white[i]) return false;
    const changed = [];
    const queue = [i];
    while (queue.length && changed.length <= limit) {
      const x = queue.pop();
      for (const y of [x, mirror(x)]) {
        if (!white[y]) continue;
        white[y] = 0;
        changed.push(y);
        for (const z of neighbors(y)) if (white[z] && (hLen(z) < 2 || vLen(z) < 2)) queue.push(z);
      }
    }
    count -= changed.length;
    if (changed.length <= limit && count > 0 && connected()) return true;
    for (const x of changed) white[x] = 1;
    count += changed.length;
    return false;
  };

  for (let guard = 0; ; guard++) {
    const long = findLongRun(width, height, white, maxLen);
    if (!long) break;
    rng.shuffle(long);
    if (guard > N || !(long.some((i) => tryBlack(i, 2)) || long.some((i) => tryBlack(i, 6)))) return null;
  }
  if (count < interior * minDensity) return null;
  const target = Math.round(interior * (density[0] + rng.next() * (density[1] - density[0])));
  const order = [];
  for (let i = 0; i < N; i++) if (white[i]) order.push(i);
  for (const i of rng.shuffle(order)) {
    if (count <= target) break;
    tryBlack(i, 2);
  }
  return white;
}

function findLongRun(width, height, white, maxLen) {
  for (const dir of [0, 1]) {
    const outer = dir ? width : height;
    const inner = dir ? height : width;
    for (let a = 0; a < outer; a++) {
      let run = [];
      for (let b = 0; b <= inner; b++) {
        const i = dir ? b * width + a : a * width + b;
        if (b < inner && white[i]) run.push(i);
        else {
          if (run.length > maxLen) return run;
          run = [];
        }
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 填数
// ---------------------------------------------------------------------------

const FLAT = [1, 1, 1, 1, 1, 1, 1, 1, 1];

/**
 * 回溯填数（段内不重复）。keep[v] ≥ 0 的变量保持原值。
 * 每次选可选数字最少的格子；数字按权重随机排列。失败返回 null。
 */
export function fill(S, rng, keep = null, weights = FLAT) {
  const n = S.cells.length;
  const val = new Int32Array(n).fill(-1);
  const used = new Int32Array(S.runs.length);
  let left = n;
  if (keep) {
    for (let v = 0; v < n; v++) {
      if (keep[v] < 0) continue;
      const bit = 1 << keep[v];
      const [a, d] = S.runOf[v];
      if ((used[a] | used[d]) & bit) return null;
      val[v] = keep[v];
      used[a] |= bit;
      used[d] |= bit;
      left--;
    }
  }
  let budget = 20000;
  const order = (mask) => {
    const digits = [];
    const w = [];
    for (let m = mask; m; m &= m - 1) {
      const k = 31 - Math.clz32(m & -m);
      digits.push(k);
      w.push(weights[k]);
    }
    const out = [];
    while (digits.length) {
      const i = rng.weightedIndex(w);
      out.push(digits[i]);
      digits.splice(i, 1);
      w.splice(i, 1);
    }
    return out;
  };
  const search = () => {
    if (left === 0) return true;
    if (--budget < 0) return false;
    let best = -1;
    let bestMask = 0;
    let bestCount = 10;
    for (let v = 0; v < n; v++) {
      if (val[v] >= 0) continue;
      const [a, d] = S.runOf[v];
      const mask = 0x1ff & ~(used[a] | used[d]);
      const cnt = popcount(mask);
      if (cnt < bestCount) {
        best = v;
        bestMask = mask;
        bestCount = cnt;
        if (cnt <= 1) break;
      }
    }
    if (bestCount === 0) return false;
    const [a, d] = S.runOf[best];
    for (const k of order(bestMask)) {
      const bit = 1 << k;
      val[best] = k;
      used[a] |= bit;
      used[d] |= bit;
      left--;
      if (search()) return true;
      left++;
      used[a] &= ~bit;
      used[d] &= ~bit;
    }
    val[best] = -1;
    return false;
  };
  return search() ? val : null;
}

// ---------------------------------------------------------------------------
// 求解与修补
// ---------------------------------------------------------------------------

/**
 * 先用 ≤2 级规则求解；解不出且剩余未定格不超过 trialOpen 时再用试探。
 * （未定格很多时试探既慢又基本无望，直接交给修补。）
 */
export function solveGraded(S, sums, maxLevel, trialOpen = Infinity) {
  const model = buildModel(S, sums);
  const res = logicSolve(model, Math.min(2, maxLevel));
  if (res.solved || maxLevel < 3 || openCount(res) > trialOpen) return res;
  return logicSolve(model, 3);
}

const openCount = (result) => result.values.reduce((n, x) => n + (x < 0), 0);

// 未定格多时试探很慢且基本无望，只在剩余不超过这么多时使用
const TRIAL_OPEN = 20;

// 修补连续这么多次没有减少未定格就放弃该布局
const STALE = 120;

const score = (res) => res.level * 1e6 + res.steps[3] * 1000 + res.steps[2];

/**
 * 局部扰动：随机取一个格子（优先未定格），重填它所在两段的格子，
 * 以及这些格子所在段中的未定格；已定格各以一半概率保留。
 * 已推出的格子必与当前答案一致（推理严格成立），保留下来的都满足填数约束。
 */
function perturb(S, rng, values, result, weights) {
  const open = [];
  for (let v = 0; v < values.length; v++) if (result.values[v] < 0) open.push(v);
  const v0 = open.length ? rng.pick(open) : rng.int(0, values.length - 1);
  const free = new Set([v0]);
  for (const k of S.runOf[v0]) for (const u of S.runs[k].vars) free.add(u);
  for (const u of [...free]) for (const k of S.runOf[u]) for (const x of S.runs[k].vars) if (result.values[x] < 0) free.add(x);
  const keep = Int32Array.from(values);
  for (const u of free) if (u === v0 || result.values[u] < 0 || rng.next() < 0.5) keep[u] = -1;
  return fill(S, rng, keep, weights);
}

/**
 * 在给定布局上填数并修补，直到 maxLevel 内可解。失败返回 null。
 *   修补：反复局部扰动，只接受未定格不增加的结果（爬山）；
 *   加难：解出后若推理等级低于 minLevel，继续扰动，只接受仍可解且推理不更简单的结果。
 */
export function solveLayout(S, rng, { minLevel = 1, maxLevel, repairs, harden = 0, weights, budget = { left: Infinity } }) {
  const evaluate = (values) => {
    budget.left--;
    const sums = runSums(S, values);
    const result = solveGraded(S, sums, maxLevel, TRIAL_OPEN);
    return { values, sums, result, open: openCount(result) };
  };
  const first = budget.left > 0 && fill(S, rng);
  if (!first) return null;
  let cur = evaluate(first);
  let stale = 0;
  for (let it = 0; !cur.result.solved && it < repairs && stale < STALE && budget.left > 0; it++) {
    stale++;
    const next = perturb(S, rng, cur.values, cur.result, REPAIR_WEIGHTS);
    if (!next) continue;
    const cand = evaluate(next);
    if (cand.open < cur.open) stale = 0;
    if (cand.open <= cur.open) cur = cand;
  }
  if (!cur.result.solved) return null;
  // 小盘面每次求解很快，多给些次数
  const hardenTimes = Math.round(harden * Math.min(3, Math.max(1, 40 / S.cells.length)));
  for (let it = 0; cur.result.level < minLevel && it < hardenTimes && budget.left > 0; it++) {
    const next = perturb(S, rng, cur.values, cur.result, weights || FLAT);
    if (!next) continue;
    const cand = evaluate(next);
    if (cand.result.solved && score(cand.result) >= score(cur.result)) cur = cand;
  }
  return cur;
}

// 求解次数预算（确定性），限制最坏耗时
const BUDGET = 3000;

/** 生成一道题（不含外壳字段）。 */
export function generatePuzzle({ width, height, difficulty, seed }) {
  const rng = createRng(seed);
  const cfg = CONFIG[difficulty];
  const { minLevel, maxLevel } = DIFFICULTY_LEVELS[difficulty];
  const make = (opts) => {
    const white = makeLayout(width, height, rng, opts);
    if (!white) return null;
    const S = buildStruct(width, height, white);
    const found = solveLayout(S, rng, opts);
    return found && { S, ...found };
  };
  const budget = { left: BUDGET };
  let best = pickGraded({ minLevel, attempts: cfg.attempts, make: () => make({ ...cfg, minLevel, maxLevel, budget }) });
  // 兜底：放宽难度与布局限制，最终保证返回一道唯一解的题
  const relaxed = { ...CONFIG.easy, maxLevel: 3, density: [0.5, 0.7], minDensity: 0, budget: { left: BUDGET } };
  for (let i = 0; !best && i < 20; i++) best = make({ ...relaxed, maxLen: i % 2 ? 9 : 5 });
  if (!best) best = trivial(width, height);
  return best;
}

/** 最后的兜底：左上角一个 2×2 白块（逻辑上唯一）。 */
function trivial(width, height) {
  const white = new Uint8Array(width * height);
  for (const [r, c] of [[1, 1], [1, 2], [2, 1], [2, 2]]) white[r * width + c] = 1;
  const S = buildStruct(width, height, white);
  const values = Int32Array.from([0, 1, 2, 0]);
  const sums = runSums(S, values);
  return { S, values, sums, result: logicSolve(buildModel(S, sums), 3) };
}
