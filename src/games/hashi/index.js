// 数桥规则模块。
// 题目：{ game, width, height, difficulty, seed, islands: [{ r, c, n }]（按行优先排序）,
//        links: [{ a, b }]（所有互相可见的相邻岛对，a < b）, solution: 每条 link 的桥数, order, grade }
// 盘面状态：{ b: 每条 link 的桥数（0/1/2）}
import { createRng } from '../../engine/rng.js';
import { assertParams, DIFFICULTY_LEVELS, pickGraded } from '../../engine/generate.js';
import { countSolutions, logicSolve, TRIAL_LEVEL } from '../../engine/logic.js';

// 方向：上、右、下、左
export const DIRS = [[-1, 0], [0, 1], [1, 0], [0, -1]];

// 候选掩码（第 k 位 = 可取 k 座桥）的最小值 / 最大值
const MIN = [-1, 0, 1, 0, 2, 0, 1, 0];
const MAX = [-1, 0, 1, 1, 2, 2, 2, 2];
const ALL = 0b111;

// ---------------------------------------------------------------------------
// 盘面结构
// ---------------------------------------------------------------------------

/** 由岛的位置求出所有互相可见的岛对（岛须按行优先排序）：每个岛先向右、再向下找最近的岛。 */
export function findLinks(width, height, islands) {
  const at = new Int32Array(width * height).fill(-1);
  islands.forEach((s, i) => (at[s.r * width + s.c] = i));
  const links = [];
  islands.forEach((s, i) => {
    for (let c = s.c + 1; c < width; c++) {
      const j = at[s.r * width + c];
      if (j >= 0) {
        links.push({ a: i, b: j });
        break;
      }
    }
    for (let r = s.r + 1; r < height; r++) {
      const j = at[r * width + s.c];
      if (j >= 0) {
        links.push({ a: i, b: j });
        break;
      }
    }
  });
  return links;
}

function analyze({ islands, links }) {
  const islandLinks = islands.map(() => []);
  const dirLink = islands.map(() => [-1, -1, -1, -1]);
  const horiz = links.map(({ a, b }) => islands[a].r === islands[b].r);
  links.forEach(({ a, b }, l) => {
    islandLinks[a].push(l);
    islandLinks[b].push(l);
    dirLink[a][horiz[l] ? 1 : 2] = l;
    dirLink[b][horiz[l] ? 3 : 0] = l;
  });
  const crosses = links.map(() => []);
  links.forEach((h, i) => {
    if (!horiz[i]) return;
    const r = islands[h.a].r;
    const c1 = islands[h.a].c;
    const c2 = islands[h.b].c;
    links.forEach((v, j) => {
      if (horiz[j]) return;
      const c = islands[v.a].c;
      if (c1 < c && c < c2 && islands[v.a].r < r && r < islands[v.b].r) {
        crosses[i].push(j);
        crosses[j].push(i);
      }
    });
  });
  return { N: islands.length, L: links.length, islandLinks, dirLink, horiz, crosses };
}

const structures = new WeakMap();
/** 岛与 link 的邻接、方向、交叉关系（按题目对象缓存）。 */
export function structureOf(puzzle) {
  let s = structures.get(puzzle);
  if (!s) structures.set(puzzle, (s = analyze(puzzle)));
  return s;
}

/** 按 b>0 的 link 划分连通分量，返回每个岛的分量编号。 */
function components(N, links, b) {
  const parent = Array.from({ length: N }, (_, i) => i);
  const find = (x) => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]];
    return x;
  };
  links.forEach(({ a, b: bb }, l) => {
    if (b[l] > 0) parent[find(a)] = find(bb);
  });
  return Array.from({ length: N }, (_, i) => find(i));
}

// ---------------------------------------------------------------------------
// 推理模型：变量 = link，取值 0/1/2
// ---------------------------------------------------------------------------

export function buildModel(puzzle) {
  const { islands, links } = puzzle;
  const { N, L, islandLinks, crosses } = structureOf(puzzle);
  const need = islands.map((s) => s.n);

  // 一级：一条 link 必有桥 → 与它交叉的 link 都为 0
  const crossing = (D) => {
    let changed = false;
    for (let l = 0; l < L; l++) {
      if (D.dom[l] & 1) continue;
      for (const x of crosses[l]) if (D.restrict(x, 1)) changed = true;
      if (D.bad) return true;
    }
    return changed;
  };

  // 一级：岛的数字 = 各方向桥数之和，由其余方向的上下界夹出本方向的范围
  const sums = (D) => {
    let changed = false;
    for (let i = 0; i < N; i++) {
      const ls = islandLinks[i];
      let lo = 0;
      let hi = 0;
      for (const l of ls) {
        lo += MIN[D.dom[l]];
        hi += MAX[D.dom[l]];
      }
      const n = need[i];
      if (lo > n || hi < n) {
        D.bad = true;
        return true;
      }
      if (lo === hi) continue;
      for (const l of ls) {
        const d = D.dom[l];
        // lo/hi 可能因本轮收窄而偏宽，推出的范围只会更松，仍然成立
        const from = Math.max(0, n - (hi - MAX[d]));
        const to = Math.min(2, n - (lo - MIN[d]));
        const mask = from > to ? 0 : ((1 << (to + 1)) - 1) & ~((1 << from) - 1);
        if (D.restrict(l, mask)) changed = true;
        if (D.bad) return true;
      }
    }
    return changed;
  };

  // 二级：孤立排除。按“必有桥”的 link 合并岛；若某 link 取某值后所在分量的数字全部满足
  // 且不含全部岛，则该分量与外界隔绝，排除此值（含“1-1 不能相连”“2=2 不能双桥”）
  const parent = new Int32Array(N);
  const find = (x) => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]];
    return x;
  };
  const deficit = new Int32Array(N);
  const compDef = new Int32Array(N);
  const compSize = new Int32Array(N);
  const isolation = (D) => {
    for (let i = 0; i < N; i++) {
      parent[i] = i;
      let s = 0;
      for (const l of islandLinks[i]) s += MIN[D.dom[l]];
      deficit[i] = need[i] - s;
      compDef[i] = 0;
      compSize[i] = 0;
    }
    for (let l = 0; l < L; l++) if (!(D.dom[l] & 1)) parent[find(links[l].a)] = find(links[l].b);
    for (let i = 0; i < N; i++) {
      const root = find(i);
      compDef[root] += deficit[i];
      compSize[root]++;
    }
    for (let i = 0; i < N; i++) {
      if (parent[i] === i && compDef[i] === 0 && compSize[i] < N) {
        D.bad = true;
        return true;
      }
    }
    let changed = false;
    for (let l = 0; l < L; l++) {
      const d = D.dom[l];
      const m = MIN[d];
      const { a, b } = links[l];
      for (let v = m + 1; v <= 2; v++) {
        if (!((d >>> v) & 1)) continue;
        const inc = v - m;
        if (deficit[a] < inc || deficit[b] < inc) continue;
        const ra = find(a);
        const rb = find(b);
        const total = (ra === rb ? compDef[ra] : compDef[ra] + compDef[rb]) - 2 * inc;
        const size = ra === rb ? compSize[ra] : compSize[ra] + compSize[rb];
        if (total === 0 && size < N) {
          D.remove(l, v);
          changed = true;
        }
      }
    }
    return changed;
  };

  // 二级：必经之桥。在“可能有桥”的 link 构成的图中，割边必须有桥；图不连通则矛盾
  const disc = new Int32Array(N);
  const low = new Int32Array(N);
  const bridges = (D) => {
    disc.fill(0);
    let time = 0;
    const cut = [];
    const dfs = (u, via) => {
      disc[u] = low[u] = ++time;
      for (const l of islandLinks[u]) {
        if (l === via || !(D.dom[l] & 6)) continue;
        const w = links[l].a === u ? links[l].b : links[l].a;
        if (!disc[w]) {
          dfs(w, l);
          if (low[w] < low[u]) low[u] = low[w];
          if (low[w] > disc[u]) cut.push(l);
        } else if (disc[w] < low[u]) {
          low[u] = disc[w];
        }
      }
    };
    dfs(0, -1);
    if (time < N) {
      D.bad = true;
      return true;
    }
    let changed = false;
    for (const l of cut) if (D.restrict(l, 6)) changed = true;
    return changed;
  };

  return {
    size: L,
    domains() {
      return new Uint32Array(L).fill(ALL);
    },
    rules: [[crossing, sums], [isolation, bridges]],
    validate(values) {
      return isValidSolution(puzzle, values);
    },
  };
}

/** 完整赋值是否满足全部规则：数字、无交叉、全部连通。 */
export function isValidSolution(puzzle, values) {
  const { N, L, islandLinks, crosses } = structureOf(puzzle);
  for (let i = 0; i < N; i++) {
    let s = 0;
    for (const l of islandLinks[i]) s += values[l];
    if (s !== puzzle.islands[i].n) return false;
  }
  for (let l = 0; l < L; l++) {
    if (values[l] > 0 && crosses[l].some((x) => values[x] > 0)) return false;
  }
  const comp = components(N, puzzle.links, values);
  return comp.every((x) => x === comp[0]);
}

// ---------------------------------------------------------------------------
// 生成
// ---------------------------------------------------------------------------

// density：岛占格子比例；double：双桥概率；extra：在可见且不交叉的岛对之间加桥（成环）的概率
const CONFIG = {
  easy: { density: 0.22, double: 0.45, extra: 0.2 },
  medium: { density: 0.23, double: 0.3, extra: 0.35 },
  hard: { density: 0.24, double: 0.25, extra: 0.45 },
};

/** 随机长出一棵桥的树，再加一些额外的桥成环。返回 { islands: [{ r, c }], links, sol }。 */
function randomLayout(W, H, cfg, rng) {
  const occ = new Uint8Array(W * H); // 0 空，1 岛，2 横桥，3 竖桥
  const cells = [];
  const bridgeOf = new Map();
  const key = (x, y) => (x < y ? x * W * H + y : y * W * H + x);
  const inside = (r, c) => r >= 0 && c >= 0 && r < H && c < W;
  const nearIsland = (r, c) =>
    DIRS.some(([dr, dc]) => inside(r + dr, c + dc) && occ[(r + dr) * W + c + dc] === 1);
  const count = () => (rng.next() < cfg.double ? 2 : 1);
  const maxLen = Math.max(4, Math.ceil(Math.max(W, H) / 3));
  const target = Math.max(2, Math.round(W * H * cfg.density));

  const first = rng.int(0, W * H - 1);
  occ[first] = 1;
  cells.push(first);
  for (let tries = 0; cells.length < target && tries < target * 40; tries++) {
    const from = rng.pick(cells);
    const [dr, dc] = rng.pick(DIRS);
    const r0 = Math.floor(from / W);
    const c0 = from % W;
    const options = [];
    for (let d = 1; d <= maxLen; d++) {
      const r = r0 + dr * d;
      const c = c0 + dc * d;
      if (!inside(r, c) || occ[r * W + c]) break;
      if (d >= 2 && !nearIsland(r, c)) options.push(d);
    }
    if (!options.length) continue;
    const d = rng.pick(options);
    for (let k = 1; k < d; k++) occ[(r0 + dr * k) * W + c0 + dc * k] = dr ? 3 : 2;
    const cell = (r0 + dr * d) * W + c0 + dc * d;
    occ[cell] = 1;
    cells.push(cell);
    bridgeOf.set(key(from, cell), count());
  }

  cells.sort((x, y) => x - y);
  const islands = cells.map((cell) => ({ r: Math.floor(cell / W), c: cell % W }));
  const links = findLinks(W, H, islands);
  for (const l of rng.shuffle(links.map((_, i) => i))) {
    const A = islands[links[l].a];
    const B = islands[links[l].b];
    const k = key(A.r * W + A.c, B.r * W + B.c);
    if (bridgeOf.has(k) || rng.next() >= cfg.extra) continue;
    const path = [];
    if (A.r === B.r) for (let c = A.c + 1; c < B.c; c++) path.push(A.r * W + c);
    else for (let r = A.r + 1; r < B.r; r++) path.push(r * W + A.c);
    if (path.some((x) => occ[x])) continue;
    for (const x of path) occ[x] = A.r === B.r ? 2 : 3;
    bridgeOf.set(k, count());
  }
  const sol = links.map(({ a, b }) => {
    const A = islands[a];
    const B = islands[b];
    return bridgeOf.get(key(A.r * W + A.c, B.r * W + B.c)) || 0;
  });
  return { islands, links, sol };
}

function withNumbers(base, sol) {
  const { islandLinks } = structureOf(base);
  const islands = base.islands.map((s, i) => ({
    r: s.r,
    c: s.c,
    n: islandLinks[i].reduce((sum, l) => sum + sol[l], 0),
  }));
  return { islands, links: base.links };
}

/** 随机布局及其答案（未必唯一解，测试用）。 */
export function randomPuzzle(width, height, difficulty, rng) {
  const base = randomLayout(width, height, CONFIG[difficulty], rng);
  return { puzzle: { width, height, ...withNumbers(base, base.sol) }, sol: base.sol };
}

const unresolved = (res) => res.values.reduce((k, v) => k + (v < 0 ? 1 : 0), 0);

/** 修改一条 link 的桥数后是否仍是合法答案（不交叉、连通）。 */
function canChange(base, sol, l, v) {
  const S = structureOf(base);
  if (v > 0) return !S.crosses[l].some((x) => sol[x] > 0);
  const next = sol.slice();
  next[l] = 0;
  const comp = components(S.N, base.links, next);
  return comp.every((x) => x === comp[0]);
}

const REPAIR_STEPS = 40;

/** 生成一道题：随机布局 → 逻辑求解 → 对未定的 link 局部修改桥数（爬山），直到在 maxLevel 内可解。 */
function makeOne(W, H, cfg, maxLevel, rng) {
  const base = randomLayout(W, H, cfg, rng);
  if (base.islands.length < 2) return null;
  let sol = base.sol;
  let puzzle = withNumbers(base, sol);
  let result = logicSolve(buildModel(puzzle), maxLevel);
  let open = unresolved(result);
  for (let step = 0; step < REPAIR_STEPS && !result.solved; step++) {
    if (result.contradiction) return null;
    const vague = [];
    result.values.forEach((v, l) => v < 0 && vague.push(l));
    const l = rng.pick(vague);
    const choices = [sol[l] - 1, sol[l] + 1].filter((v) => v >= 0 && v <= 2 && canChange(base, sol, l, v));
    if (!choices.length) continue;
    const next = sol.slice();
    next[l] = rng.pick(choices);
    const p = withNumbers(base, next);
    const res = logicSolve(buildModel(p), maxLevel);
    const k = unresolved(res);
    if (!res.contradiction && k <= open) {
      sol = next;
      puzzle = p;
      result = res;
      open = k;
    }
  }
  return result.solved ? { puzzle, sol, result } : null;
}

/** 兜底：第一行一串双桥相连的岛，必然唯一解。 */
function fallback(W) {
  const islands = [];
  for (let c = 0; c < W; c += 2) islands.push({ r: 0, c });
  const links = findLinks(W, 1, islands);
  const sol = links.map(() => 2);
  const puzzle = withNumbers({ islands, links }, sol);
  return { puzzle, sol, result: logicSolve(buildModel(puzzle), TRIAL_LEVEL) };
}

// 小盘面较难达到试探级，困难多试几次；中等/困难在达标的题里挑推理最复杂的
const ATTEMPTS = { easy: 40, medium: 60, hard: 150 };
const WANT = { easy: 1, medium: 3, hard: 3 };

export function generate({ width, height, difficulty, seed }) {
  assertParams({ difficulty, seed });
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 3 || height < 3 || width * height > 900) {
    throw new Error(`数桥不支持 ${width}x${height}`);
  }
  const rng = createRng(seed);
  const { minLevel, maxLevel } = DIFFICULTY_LEVELS[difficulty];
  const cfg = CONFIG[difficulty];
  const best =
    pickGraded({
      minLevel,
      attempts: ATTEMPTS[difficulty],
      want: WANT[difficulty],
      make: () => makeOne(width, height, cfg, maxLevel, rng),
    }) ||
    // 放宽难度
    pickGraded({ minLevel: 1, attempts: 10, make: () => makeOne(width, height, cfg, TRIAL_LEVEL, rng) }) ||
    fallback(width);
  const { puzzle, sol, result } = best;
  return {
    game: 'hashi',
    width,
    height,
    difficulty,
    seed,
    islands: puzzle.islands,
    links: puzzle.links,
    solution: sol,
    order: Array.from(result.order),
    grade: { level: result.level, steps: result.steps.slice(1) },
  };
}

/** 回溯计数（测试用）：确认题目唯一解。 */
export function solutionCount(puzzle, opts) {
  return countSolutions(buildModel(puzzle), opts);
}

// ---------------------------------------------------------------------------
// 盘面操作（供 view 使用）
// ---------------------------------------------------------------------------

/** 每个岛当前已连出的桥数。 */
export function islandSums(puzzle, state) {
  const { islandLinks } = structureOf(puzzle);
  return islandLinks.map((ls) => ls.reduce((s, l) => s + state.b[l], 0));
}

/** 与 link l 交叉且已有桥的 link，没有则为 -1。 */
export function blockerOf(puzzle, state, l) {
  return structureOf(puzzle).crosses[l].find((x) => state.b[x] > 0) ?? -1;
}

/** 循环切换桥数（delta=1：0→1→2→0；delta=-1 反向）。会与已有桥交叉时返回 null。 */
export function cycleLink(puzzle, state, l, delta = 1) {
  const v = (state.b[l] + delta + 3) % 3;
  if (v > 0 && blockerOf(puzzle, state, l) >= 0) return null;
  const b = state.b.slice();
  b[l] = v;
  return { b };
}

/** 明显违规之处：桥数超出的岛、无法再补足的岛、已封闭却未连通全部岛的分组、交叉的桥。 */
export function violations(puzzle, state) {
  const { N, L, islandLinks, crosses } = structureOf(puzzle);
  const { islands, links } = puzzle;
  const sums = islandSums(puzzle, state);
  const badIslands = new Set();
  const badLinks = new Set();
  for (let i = 0; i < N; i++) {
    const n = islands[i].n;
    if (sums[i] > n) badIslands.add(i);
    if (sums[i] >= n) continue;
    let room = 0;
    for (const l of islandLinks[i]) {
      if (crosses[l].some((x) => state.b[x] > 0)) continue;
      const j = links[l].a === i ? links[l].b : links[l].a;
      room += Math.min(2 - state.b[l], Math.max(0, islands[j].n - sums[j]));
    }
    if (sums[i] + room < n) badIslands.add(i);
  }
  const comp = components(N, links, state.b);
  const size = new Map();
  const open = new Set();
  for (let i = 0; i < N; i++) {
    size.set(comp[i], (size.get(comp[i]) || 0) + 1);
    if (sums[i] !== islands[i].n) open.add(comp[i]);
  }
  for (let i = 0; i < N; i++) if (!open.has(comp[i]) && size.get(comp[i]) < N) badIslands.add(i);
  for (let l = 0; l < L; l++) {
    if (state.b[l] > 0 && crosses[l].some((x) => state.b[x] > 0)) badLinks.add(l);
  }
  return { islands: badIslands, links: badLinks };
}

const islandName = (s) => `第 ${s.r + 1} 行第 ${s.c + 1} 列`;

export function linkName(puzzle, l) {
  const { a, b } = puzzle.links[l];
  return `${islandName(puzzle.islands[a])}与${islandName(puzzle.islands[b])}的岛之间`;
}

/** 把 link l 设为答案值，并清掉与之交叉的桥。 */
function fixLink(puzzle, state, l) {
  const b = state.b.slice();
  b[l] = puzzle.solution[l];
  if (b[l] > 0) for (const x of structureOf(puzzle).crosses[l]) b[x] = 0;
  return { b };
}

/** 桥数多于答案的 link 下标（少于答案只是还没画完）。 */
function findWrong(puzzle, state) {
  const wrong = [];
  state.b.forEach((v, l) => {
    if (v > puzzle.solution[l]) wrong.push(l);
  });
  return wrong;
}

export default {
  id: 'hashi',

  generate,

  initialState(puzzle) {
    return { b: new Array(puzzle.links.length).fill(0) };
  },

  isSolved(puzzle, state) {
    return puzzle.solution.every((v, l) => state.b[l] === v);
  },

  findWrong,

  hint(puzzle, state) {
    const wrong = findWrong(puzzle, state);
    if (wrong.length) {
      const l = wrong[0];
      const v = puzzle.solution[l];
      return {
        state: fixLink(puzzle, state, l),
        message: `${linkName(puzzle, l)}${v ? `应只有 ${v} 座桥` : '不应架桥'}`,
      };
    }
    const order = puzzle.order && puzzle.order.length ? puzzle.order : puzzle.solution.map((_, l) => l);
    for (const l of [...order, ...puzzle.solution.keys()]) {
      if (state.b[l] === puzzle.solution[l]) continue;
      return {
        state: fixLink(puzzle, state, l),
        message: `${linkName(puzzle, l)}架 ${puzzle.solution[l]} 座桥`,
      };
    }
    return null;
  },

  solvedState(puzzle) {
    return { b: puzzle.solution.slice() };
  },

  progress(puzzle, state) {
    const sums = islandSums(puzzle, state);
    const done = sums.filter((s, i) => s === puzzle.islands[i].n).length;
    return `已满足 ${done} / ${puzzle.islands.length} 个岛`;
  },
};
