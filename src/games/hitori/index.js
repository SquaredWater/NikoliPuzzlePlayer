// 数壹（Hitori）规则模块。
// 题目：{ game, width: n, height: n, difficulty, seed, numbers: 数字[]（1~n）, solution: 0/1[]（1 = 涂黑）,
//        order: 推理顺序（格子下标）, grade }
// 盘面状态：{ c: 数组（0 = 未定，1 = 涂黑，2 = 画圈 · 确定为白）}
import { createRng } from '../../engine/rng.js';
import { assertParams, DIFFICULTY_LEVELS, pickGraded } from '../../engine/generate.js';
import { countSolutions, logicSolve, lowBit, popcount } from '../../engine/logic.js';
import { buildModel, isConnected, layoutOf, samePeers } from './model.js';

export { buildModel, isValidSolution } from './model.js';

// ---------------------------------------------------------------------------
// 生成
// ---------------------------------------------------------------------------

function randomLatin(n, rng) {
  const full = (1 << n) - 1;
  for (;;) {
    const grid = new Array(n * n).fill(0);
    const rowUsed = new Int32Array(n);
    const colUsed = new Int32Array(n);
    let nodes = 0;
    const fill = () => {
      if (++nodes > 20000) return false;
      let best = -1;
      let bestMask = 0;
      let bestCount = Infinity;
      for (let i = 0; i < n * n; i++) {
        if (grid[i]) continue;
        const r = Math.floor(i / n);
        const c = i % n;
        const mask = full & ~(rowUsed[r] | colUsed[c]);
        const count = popcount(mask);
        if (count < bestCount) {
          best = i;
          bestMask = mask;
          bestCount = count;
          if (count <= 1) break;
        }
      }
      if (best < 0) return true;
      const r = Math.floor(best / n);
      const c = best % n;
      const digits = [];
      for (let m = bestMask; m; m &= m - 1) digits.push(lowBit(m));
      for (const d of rng.shuffle(digits)) {
        grid[best] = d + 1;
        rowUsed[r] |= 1 << d;
        colUsed[c] |= 1 << d;
        if (fill()) return true;
        rowUsed[r] &= ~(1 << d);
        colUsed[c] &= ~(1 << d);
      }
      grid[best] = 0;
      return false;
    };
    if (fill()) return grid;
  }
}

/** 随机涂黑方案：黑格不相邻、白格连通，至多 target 格。 */
function randomBlacks(n, rng, target) {
  const { N, nb } = layoutOf(n);
  const black = new Uint8Array(N);
  let count = 0;
  for (const i of rng.shuffle(Array.from({ length: N }, (_, k) => k))) {
    if (count >= target) break;
    if (nb[i].some((p) => black[p])) continue;
    black[i] = 1;
    if (isConnected(n, (k) => !black[k])) count++;
    else black[i] = 0;
  }
  return black;
}

/** 黑格可用的数字：同行、同列白格上的数字（保证满足规则 4）。 */
function blackOptions(n, latin, black, cell) {
  const r = Math.floor(cell / n);
  const c = cell % n;
  const set = new Set();
  for (let k = 0; k < n; k++) {
    if (!black[r * n + k]) set.add(latin[r * n + k]);
    if (!black[k * n + c]) set.add(latin[k * n + c]);
  }
  return [...set];
}

function solve(n, numbers, level) {
  const res = logicSolve(buildModel(n, numbers), level);
  let open = 0;
  for (const v of res.values) if (v < 0) open++;
  res.open = open;
  return res;
}

const DENSITY = { easy: 0.3, medium: 0.32, hard: 0.34 };

/**
 * 生成一道在 maxLevel 内可解的题：随机拉丁方 + 随机涂黑 + 黑格改数字。
 * 随后随机改动黑格数字爬山：先让 maxLevel 能解出（唯一），再让低一级规则解不出的格子尽量多（难度达标）。
 * 失败返回 null；force 时把未定区域的黑格逐个还原为白，必然收敛到可解。
 */
export function makePuzzle(n, rng, difficulty, force) {
  const { minLevel, maxLevel } = DIFFICULTY_LEVELS[difficulty];
  const { N } = layoutOf(n);
  const latin = randomLatin(n, rng);
  const black = randomBlacks(n, rng, Math.round(N * DENSITY[difficulty]));
  const numbers = latin.slice();
  const options = [];
  for (let i = 0; i < N; i++) {
    if (!black[i]) continue;
    options[i] = blackOptions(n, latin, black, i);
    numbers[i] = rng.pick(options[i]);
  }

  const touching = (res) => {
    const rows = new Set();
    const cols = new Set();
    res.values.forEach((v, i) => {
      if (v < 0) {
        rows.add(Math.floor(i / n));
        cols.add(i % n);
      }
    });
    const list = [];
    for (let i = 0; i < N; i++) if (black[i] && (rows.has(Math.floor(i / n)) || cols.has(i % n))) list.push(i);
    return list;
  };

  const evaluate = () => {
    const low = minLevel > 1 ? solve(n, numbers, minLevel - 1) : null;
    const res = low && low.solved ? low : solve(n, numbers, maxLevel);
    return { res, low, cost: res.open * (N + 1) + (low ? N - low.open : 0) };
  };
  const qualified = ({ res, low }) => res.solved && (!low || low.open > 0);
  const mutable = [];
  for (let i = 0; i < N; i++) if (black[i] && options[i].length > 1) mutable.push(i);

  let cur = evaluate();
  for (let t = 0; t < n * 8 && mutable.length && !qualified(cur); t++) {
    const near = cur.res.solved ? [] : touching(cur.res).filter((i) => options[i].length > 1);
    const cell = rng.pick(near.length ? near : mutable);
    const old = numbers[cell];
    numbers[cell] = rng.pick(options[cell].filter((x) => x !== old));
    const next = evaluate();
    if (next.cost <= cur.cost) cur = next;
    else numbers[cell] = old;
  }
  let res = cur.res;
  if (!res.solved && !force) return null;
  while (!res.solved) {
    // 黑格还原为白（拉丁方数字）后答案仍合法；黑格全部还原时题目平凡可解
    const cands = touching(res);
    const cell = cands.length ? rng.pick(cands) : black.indexOf(1);
    black[cell] = 0;
    numbers[cell] = latin[cell];
    res = solve(n, numbers, maxLevel);
  }
  return { numbers, solution: Array.from(black), result: res };
}

export function generate({ width, height, difficulty, seed }) {
  assertParams({ difficulty, seed });
  const n = width;
  if (width !== height || n < 2 || n > 30) throw new Error(`数壹不支持 ${width}x${height}`);
  const rng = createRng(seed);
  const best =
    pickGraded({
      minLevel: DIFFICULTY_LEVELS[difficulty].minLevel,
      attempts: 20,
      want: difficulty === 'easy' ? 1 : 3,
      make: () => makePuzzle(n, rng, difficulty, false),
    }) || makePuzzle(n, rng, difficulty, true);
  const { numbers, solution, result } = best;
  return {
    game: 'hitori',
    width: n,
    height: n,
    difficulty,
    seed,
    numbers,
    solution,
    order: Array.from(result.order),
    grade: { level: result.level, steps: result.steps.slice(1) },
  };
}

/** 回溯计数（测试用）：确认题目唯一解。 */
export function solutionCount(puzzle, opts) {
  return countSolutions(buildModel(puzzle.width, puzzle.numbers), opts);
}

// ---------------------------------------------------------------------------
// 盘面
// ---------------------------------------------------------------------------

/** showErrors 用：返回 { black: 违规黑格, circle: 重复的圈, apart: 被隔开的非黑格 } 三个 Set。 */
export function violations(puzzle, c) {
  const n = puzzle.width;
  const { N, nb, lines } = layoutOf(n);
  const nums = puzzle.numbers;
  const same = samePeers(n, nums);
  const black = new Set();
  const circle = new Set();
  const apart = new Set();
  for (let i = 0; i < N; i++) {
    if (c[i] !== 1) continue;
    if (nb[i].some((p) => c[p] === 1)) black.add(i);
    if (same[i].every((p) => c[p] === 1)) black.add(i);
  }
  for (const line of lines) {
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        const x = line[a];
        const y = line[b];
        if (c[x] === 2 && c[y] === 2 && nums[x] === nums[y]) {
          circle.add(x);
          circle.add(y);
        }
      }
    }
  }
  // 非黑格的连通块，除最大的一块外都标出
  const comp = new Int32Array(N).fill(-1);
  const sizes = [];
  for (let s = 0; s < N; s++) {
    if (c[s] === 1 || comp[s] >= 0) continue;
    const id = sizes.length;
    const stack = [s];
    comp[s] = id;
    let size = 0;
    while (stack.length) {
      const u = stack.pop();
      size++;
      for (const v of nb[u]) {
        if (c[v] !== 1 && comp[v] < 0) {
          comp[v] = id;
          stack.push(v);
        }
      }
    }
    sizes.push(size);
  }
  if (sizes.length > 1) {
    const main = sizes.indexOf(Math.max(...sizes));
    for (let i = 0; i < N; i++) if (comp[i] >= 0 && comp[i] !== main) apart.add(i);
  }
  return { black, circle, apart };
}

const cellName = (puzzle, cell) => `第 ${Math.floor(cell / puzzle.width) + 1} 行第 ${(cell % puzzle.width) + 1} 列`;

function isSolved(puzzle, state) {
  return puzzle.solution.every((b, i) => (state.c[i] === 1) === (b === 1));
}

function findWrong(puzzle, state) {
  const wrong = [];
  state.c.forEach((v, i) => {
    if ((v === 1 && !puzzle.solution[i]) || (v === 2 && puzzle.solution[i])) wrong.push(i);
  });
  return wrong;
}

export default {
  id: 'hitori',

  generate,

  initialState(puzzle) {
    return { c: new Array(puzzle.width * puzzle.height).fill(0) };
  },

  isSolved,

  /** 返回涂错（白格涂黑、黑格画圈）的格子下标。 */
  findWrong,

  hint(puzzle, state) {
    if (isSolved(puzzle, state)) return null;
    const wrong = findWrong(puzzle, state);
    const c = state.c.slice();
    for (const i of wrong) c[i] = 0;
    const fixed = wrong.length ? `清除了 ${wrong.length} 处错误；` : '';
    for (const cell of puzzle.order) {
      const want = puzzle.solution[cell] ? 1 : 2;
      if (c[cell] === want) continue;
      c[cell] = want;
      return { state: { c }, message: `${fixed}${cellName(puzzle, cell)}${want === 1 ? '涂黑' : '不涂黑（画圈）'}`, cell };
    }
    return { state: { c }, message: fixed };
  },

  solvedState(puzzle) {
    return { c: puzzle.solution.map((b) => (b ? 1 : 0)) };
  },

  progress(puzzle, state) {
    const blacks = state.c.filter((v) => v === 1).length;
    const circles = state.c.filter((v) => v === 2).length;
    return `涂黑 ${blacks} · 画圈 ${circles}`;
  },
};
