// 数回规则模块。
// 题目：{ game, width, height, difficulty, seed, clues: 数字[]（-1 为无数字）, solution: 边[]（1 有线）,
//        order: 推理顺序（边下标）, grade }
// 盘面状态：{ e: 边[]（0 空、1 线、2 ×）}；边编号见 model.js。
import { createRng } from '../../engine/rng.js';
import { assertParams, DIFFICULTY_LEVELS, minimizeClues, pickGraded } from '../../engine/generate.js';
import { countSolutions, logicSolve } from '../../engine/logic.js';
import { BUDGET_EXCEEDED, boundaryEdges, buildModel, cluesFromEdges, geometry } from './model.js';

export { geometry };

// ---------------------------------------------------------------------------
// 答案：随机生长一个连通、无洞的区域，其边界就是一条单回路
// ---------------------------------------------------------------------------

// 按已在区域内的邻格数加权：偏向只接触一个邻格的格子，使形状更曲折
const GROW_WEIGHT = [0, 6, 1.5, 0.4, 0.2];

export function randomRegion(W, H, rng) {
  const N = W * H;
  const inside = new Uint8Array(N);
  const target = Math.max(1, Math.round(N * (0.4 + 0.2 * rng.next())));
  const neighbors = (i) => {
    const r = Math.floor(i / W);
    const c = i % W;
    const out = [];
    if (r > 0) out.push(i - W);
    if (r < H - 1) out.push(i + W);
    if (c > 0) out.push(i - 1);
    if (c < W - 1) out.push(i + 1);
    return out;
  };
  const isIn = (r, c) => r >= 0 && r < H && c >= 0 && c < W && inside[r * W + c] === 1;
  // 加入 i 后，它四角的内部顶点不能出现对角棋盘形（否则该顶点度数为 4）
  const checkerboard = (i) => {
    const r0 = Math.floor(i / W);
    const c0 = i % W;
    for (const [r, c] of [[r0, c0], [r0, c0 + 1], [r0 + 1, c0], [r0 + 1, c0 + 1]]) {
      if (r <= 0 || r >= H || c <= 0 || c >= W) continue;
      const a = isIn(r - 1, c - 1);
      const b = isIn(r - 1, c);
      const d = isIn(r, c - 1);
      const e = isIn(r, c);
      if (a === e && b === d && a !== b) return true;
    }
    return false;
  };
  // 区域外的格子必须都能连到盘外（无洞，且补集连通）
  const seen = new Uint8Array(N);
  const stack = new Int32Array(N);
  const outsideConnected = () => {
    seen.fill(0);
    let top = 0;
    let total = 0;
    for (let i = 0; i < N; i++) {
      if (inside[i]) continue;
      total++;
      const r = Math.floor(i / W);
      const c = i % W;
      if (r === 0 || c === 0 || r === H - 1 || c === W - 1) {
        seen[i] = 1;
        stack[top++] = i;
      }
    }
    let reached = top;
    while (top > 0) {
      const i = stack[--top];
      for (const j of neighbors(i)) {
        if (inside[j] || seen[j]) continue;
        seen[j] = 1;
        reached++;
        stack[top++] = j;
      }
    }
    return reached === total;
  };

  inside[rng.int(0, N - 1)] = 1;
  let size = 1;
  const rejected = new Uint8Array(N);
  while (size < target) {
    rejected.fill(0);
    let added = false;
    for (;;) {
      const cand = [];
      const weights = [];
      for (let i = 0; i < N; i++) {
        if (inside[i] || rejected[i]) continue;
        let k = 0;
        for (const j of neighbors(i)) k += inside[j];
        if (k) {
          cand.push(i);
          weights.push(GROW_WEIGHT[k]);
        }
      }
      if (!cand.length) break;
      const i = cand[rng.weightedIndex(weights)];
      inside[i] = 1;
      if (!checkerboard(i) && outsideConnected()) {
        added = true;
        break;
      }
      inside[i] = 0;
      rejected[i] = 1;
    }
    if (!added) break;
    size++;
  }
  return inside;
}

// ---------------------------------------------------------------------------
// 生成
// ---------------------------------------------------------------------------

const KEEP_RATIO = { easy: 0.45, medium: 0, hard: 0 };
// 困难题在二级最简题的基础上，用试探继续删数字时的工作量预算（每格）
const TRIAL_BUDGET_PER_CELL = 40000;

function solves(W, H, clues, level, budget = null) {
  try {
    return logicSolve(buildModel(W, H, clues, budget), level).solved;
  } catch (err) {
    if (err === BUDGET_EXCEEDED) return false;
    throw err;
  }
}

export function generate({ width: W, height: H, difficulty, seed }) {
  assertParams({ difficulty, seed });
  if (!Number.isInteger(W) || !Number.isInteger(H) || W < 2 || H < 2 || W > 30 || H > 30) {
    throw new Error(`数回不支持 ${W}x${H}`);
  }
  const rng = createRng(seed);
  const G = geometry(W, H);
  const N = W * H;
  const { minLevel, maxLevel } = DIFFICULTY_LEVELS[difficulty];

  const make = (level) => {
    const solution = boundaryEdges(G, randomRegion(W, H, rng));
    const full = cluesFromEdges(G, solution);
    const cluesOf = (active) => full.map((v, i) => (active[i] ? v : -1));
    if (!solves(W, H, full, Math.min(level, 2))) return null;
    let active;
    if (level === 1) {
      active = minimizeClues(N, rng, (act) => solves(W, H, cluesOf(act), 1), {
        minKeep: Math.round(N * KEEP_RATIO[difficulty]),
      });
    } else {
      active = minimizeClues(N, rng, (act) => solves(W, H, cluesOf(act), 2));
    }
    if (level === 3) {
      // 已是二级下的最简题，再删的每个数字都需要试探才能解出；限制总工作量
      const budget = { left: N * TRIAL_BUDGET_PER_CELL };
      const base = active;
      const groups = [];
      for (let i = 0; i < N; i++) if (base[i]) groups.push([i]);
      const merge = (act) => base.map((b, i) => (b && act[i] ? 1 : 0));
      const extra = minimizeClues(N, rng, (act) => budget.left > 0 && solves(W, H, cluesOf(merge(act)), 3, budget), {
        groups,
      });
      active = merge(extra);
    }
    const clues = cluesOf(active);
    const result = logicSolve(buildModel(W, H, clues), level);
    return result.solved ? { solution, clues, result } : null;
  };

  let best = pickGraded({
    minLevel,
    attempts: difficulty === 'hard' ? (N > 150 ? 4 : N > 50 ? 6 : 12) : 6,
    make: () => make(maxLevel),
  });
  // 兜底：先按原难度多试几次，再放宽到试探等级，保证总能得到唯一解的题
  for (let i = 0; !best && i < 60; i++) best = make(i < 20 ? maxLevel : 3);
  if (!best) throw new Error('生成失败');
  const { solution, clues, result } = best;
  return {
    game: 'slitherlink',
    width: W,
    height: H,
    difficulty,
    seed,
    clues,
    solution,
    order: Array.from(result.order),
    grade: { level: result.level, steps: result.steps.slice(1) },
  };
}

/** 回溯计数（测试用）：确认题目唯一解。 */
export function solutionCount(puzzle, opts) {
  return countSolutions(buildModel(puzzle.width, puzzle.height, puzzle.clues), opts);
}

// ---------------------------------------------------------------------------
// 盘面操作（供 view 使用）
// ---------------------------------------------------------------------------

/** draw.js 的 nearestGridEdge 结果 → 边下标。 */
export function edgeIndex(puzzle, edge) {
  const G = geometry(puzzle.width, puzzle.height);
  return edge.dir === 'h' ? G.hEdge(edge.r, edge.c) : G.vEdge(edge.r, edge.c);
}

/** 盘面上明显违规之处：{ verts, cells, edges }（均为 Set）。 */
export function violations(puzzle, e) {
  const G = geometry(puzzle.width, puzzle.height);
  const verts = new Set();
  const cells = new Set();
  const edges = new Set();
  for (let v = 0; v < G.V; v++) {
    let lines = 0;
    let open = 0;
    for (let j = 0; j < 4; j++) {
      const x = G.vertEdges[v * 4 + j];
      if (x < 0) continue;
      if (e[x] === 1) lines++;
      else if (e[x] === 0) open++;
    }
    if (lines > 2) {
      verts.add(v);
      for (let j = 0; j < 4; j++) {
        const x = G.vertEdges[v * 4 + j];
        if (x >= 0 && e[x] === 1) edges.add(x);
      }
    } else if (lines === 1 && open === 0) {
      verts.add(v);
    }
  }
  for (let i = 0; i < G.N; i++) {
    const k = puzzle.clues[i];
    if (k < 0) continue;
    let lines = 0;
    let open = 0;
    for (let j = 0; j < 4; j++) {
      const x = e[G.cellEdges[i * 4 + j]];
      if (x === 1) lines++;
      else if (x === 0) open++;
    }
    if (lines > k || lines + open < k) cells.add(i);
  }
  // 已闭合的回路，而盘面上还有别的线
  const parent = Int32Array.from({ length: G.V }, (_, i) => i);
  const find = (x) => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]];
    return x;
  };
  const cyclic = new Set();
  const roots = new Set();
  for (let x = 0; x < G.E; x++) {
    if (e[x] !== 1) continue;
    const a = find(G.edgeVerts[x * 2]);
    const b = find(G.edgeVerts[x * 2 + 1]);
    if (a === b) cyclic.add(G.edgeVerts[x * 2]);
    else parent[a] = b;
  }
  for (let x = 0; x < G.E; x++) if (e[x] === 1) roots.add(find(G.edgeVerts[x * 2]));
  if (cyclic.size && roots.size > 1) {
    const bad = new Set([...cyclic].map(find));
    for (let x = 0; x < G.E; x++) if (e[x] === 1 && bad.has(find(G.edgeVerts[x * 2]))) edges.add(x);
  }
  return { verts, cells, edges };
}

function edgeName(puzzle, i) {
  const { width: W, height: H } = puzzle;
  const nH = (H + 1) * W;
  if (i < nH) {
    const r = Math.floor(i / W);
    const c = i % W;
    return r < H ? `第 ${r + 1} 行第 ${c + 1} 列格子的上边` : `第 ${r} 行第 ${c + 1} 列格子的下边`;
  }
  const k = i - nH;
  const r = Math.floor(k / (W + 1));
  const c = k % (W + 1);
  return c < W ? `第 ${r + 1} 行第 ${c + 1} 列格子的左边` : `第 ${r + 1} 行第 ${c} 列格子的右边`;
}

function findWrong(puzzle, state) {
  const wrong = [];
  state.e.forEach((v, i) => {
    if (v === 1 && !puzzle.solution[i]) wrong.push(i);
  });
  return wrong;
}

function isSolved(puzzle, state) {
  return puzzle.solution.every((s, i) => (state.e[i] === 1) === (s === 1));
}

export default {
  id: 'slitherlink',

  generate,

  initialState(puzzle) {
    return { e: new Array(puzzle.solution.length).fill(0) };
  },

  isSolved,

  /** 返回画错的线（边下标）；× 不算。 */
  findWrong,

  hint(puzzle, state) {
    if (isSolved(puzzle, state)) return null;
    const wrong = findWrong(puzzle, state);
    if (wrong.length) {
      const e = state.e.slice();
      for (const i of wrong) e[i] = 2;
      return { state: { e }, message: `去掉了 ${wrong.length} 条画错的线` };
    }
    for (const i of puzzle.order) {
      const want = puzzle.solution[i] ? 1 : 2;
      if (state.e[i] === want) continue;
      const e = state.e.slice();
      e[i] = want;
      return { state: { e }, message: `${edgeName(puzzle, i)}${want === 1 ? '画线' : '不能画线（×）'}`, edge: i };
    }
    return null;
  },

  solvedState(puzzle) {
    return { e: puzzle.solution.map((s) => (s ? 1 : 0)) };
  },

  progress(puzzle, state) {
    return `已画 ${state.e.filter((v) => v === 1).length} 条线`;
  },
};
