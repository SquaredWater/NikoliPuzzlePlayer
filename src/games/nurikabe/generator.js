// 数墙生成：随机生长若干互不相邻的岛（黑格始终连通）→ 消除 2×2 黑块 → 每岛随机放一个数字
// → 逻辑求解。卡住时只做局部修补后重试：
//   若能找到另一个解，就在两解不同的格子上改动答案（涂白成新岛 / 并入岛，或涂黑使岛缩小、拆分）
//   或把数字移过去，从而排除这个解；
//   否则（可能唯一但超出难度）在未确定的区域里随机改动一格。
// 修补轮数有总上限；实在不行就退回小岛配置，最后用必然可解的格点阵兜底。
import { createRng } from '../../engine/rng.js';
import { assertParams, DIFFICULTY_LEVELS, pickGraded } from '../../engine/generate.js';
import { Domains, logicSolve, propagate } from '../../engine/logic.js';
import { BUDGET_EXCEEDED, buildModel, geometry, isValidAnswer } from './model.js';

// sizes[k]：新岛目标大小为 k 的权重；cap：岛的大小上限；fatten：加厚时黑格并入岛的概率；
// grow：排除另解时优先涂白（而非涂黑）的概率
const CONFIG = {
  easy: { sizes: [0, 2, 4, 4, 3, 2], cap: 6, fatten: 0.3, grow: 0.5 },
  medium: { sizes: [0, 1, 2, 3, 4, 4, 3, 2], cap: 10, fatten: 0.5, grow: 0.5 },
  hard: { sizes: [0, 1, 1, 2, 3, 3, 3, 3, 3, 2, 2], cap: 16, fatten: 0.6, grow: 0.6 },
};
// 每个答案最多修补几轮；每次生成最多换几次答案；所有答案合计的修补轮数上限（正常 / 兜底）
const REPAIRS = 400;
const ATTEMPTS = 4;
const MAX_ROUNDS = 1200;
const FALLBACK_ROUNDS = 400;
// 找另一个解：每次换几个起点、每个起点的搜索节点上限；每多少个未定格多找一个
const OTHER_TRIES = 3;
const OTHER_NODES = 60;
const OPEN_PER_SEARCH = 30;
// 试探：未定格占比不超过 TRIAL_OPEN 时才尝试；工作量上限为每格 TRIAL_BUDGET 次规则调用
const TRIAL_OPEN = 0.3;
const TRIAL_BUDGET = 30;
// 改动过的格子在这么多轮内不再随机改动
const TABU = 8;

/** 答案：owner[i] 为岛编号（-1 为黑），islands[k] 为岛的格子列表，clue[k] 为放数字的格子。 */
class Answer {
  constructor(W, H) {
    this.G = geometry(W, H);
    this.W = W;
    this.H = H;
    this.N = W * H;
    this.owner = new Int32Array(this.N).fill(-1);
    this.islands = [];
    this.clue = [];
    this.blackCount = this.N;
    this.seen = new Uint8Array(this.N);
    this.queue = new Int32Array(this.N);
    // 修补轮次与各格最近一次改动的轮次
    this.time = 0;
    this.changed = new Int32Array(this.N).fill(-1000);
  }

  isBlack(r, c) {
    return r >= 0 && c >= 0 && c < this.W && r < this.H && this.owner[r * this.W + c] < 0;
  }

  /** 把黑格 x 涂白后其余黑格是否仍连通。 */
  canRemove(x) {
    if (this.blackCount <= 1) return false;
    const { W, owner, seen, queue } = this;
    const { nbr } = this.G;
    const r = Math.floor(x / W);
    const c = x % W;
    // 周围 8 格中的黑格若只构成一段，局部即可判定连通
    const on = RING.map(([dr, dc]) => this.isBlack(r + dr, c + dc));
    let runs = 0;
    let orth = 0;
    for (let k = 0; k < 8; k++) {
      if (on[k] && !on[(k + 7) % 8]) runs++;
      if (k % 2 === 0 && on[k]) orth++;
    }
    if (orth === 0) return false;
    if (runs === 1 || on.every(Boolean)) return true;
    seen.fill(0);
    seen[x] = 1;
    let start = -1;
    for (let j = 0; j < 4 && start < 0; j++) {
      const y = nbr[x * 4 + j];
      if (y >= 0 && owner[y] < 0) start = y;
    }
    let top = 0;
    queue[top++] = start;
    seen[start] = 1;
    for (let q = 0; q < top; q++) {
      const a = queue[q];
      for (let j = 0; j < 4; j++) {
        const b = nbr[a * 4 + j];
        if (b >= 0 && owner[b] < 0 && !seen[b]) {
          seen[b] = 1;
          queue[top++] = b;
        }
      }
    }
    return top === this.blackCount - 1;
  }

  /** x 涂白后会并入的岛：-1 表示新岛，-2 表示会连通两个岛。 */
  islandNear(x) {
    const { nbr } = this.G;
    let k = -1;
    for (let j = 0; j < 4; j++) {
      const y = nbr[x * 4 + j];
      if (y < 0 || this.owner[y] < 0) continue;
      if (k >= 0 && this.owner[y] !== k) return -2;
      k = this.owner[y];
    }
    return k;
  }

  whiten(x, k) {
    if (k < 0) {
      k = this.islands.length;
      this.islands.push([]);
      this.clue.push(x);
    }
    this.owner[x] = k;
    this.islands[k].push(x);
    this.blackCount--;
    this.changed[x] = this.time;
    return k;
  }

  /** 涂白黑格 x（并入唯一相邻的岛或成为新岛）；不合法返回 false。 */
  tryWhiten(x, cap) {
    if (this.owner[x] >= 0) return false;
    const k = this.islandNear(x);
    if (k === -2 || (k >= 0 && this.islands[k].length >= cap) || !this.canRemove(x)) return false;
    this.whiten(x, k);
    return true;
  }

  /** 涂黑白格 x（岛缩小，断开的部分成为新岛）；会出现 2×2 黑块或孤立黑格时返回 false。 */
  tryBlacken(x, rng) {
    const { W, owner } = this;
    const { nbr } = this.G;
    const k = owner[x];
    if (k < 0 || this.islands[k].length < 2) return false;
    const r = Math.floor(x / W);
    const c = x % W;
    for (const [dr, dc] of [[-1, -1], [-1, 0], [0, -1], [0, 0]]) {
      const r0 = r + dr;
      const c0 = c + dc;
      let blacks = 0;
      for (const [a, b] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
        const rr = r0 + a;
        const cc = c0 + b;
        if (rr === r && cc === c) continue;
        if (this.isBlack(rr, cc)) blacks++;
      }
      if (blacks === 3) return false;
    }
    let touches = false;
    for (let j = 0; j < 4; j++) {
      const y = nbr[x * 4 + j];
      if (y >= 0 && owner[y] < 0) touches = true;
    }
    if (!touches) return false;
    owner[x] = -1;
    this.blackCount++;
    this.changed[x] = this.time;
    // 重新划分原来的岛
    const rest = this.islands[k].filter((y) => y !== x);
    for (const y of rest) owner[y] = -2;
    const parts = [];
    for (const s of rest) {
      if (owner[s] !== -2) continue;
      const part = [s];
      owner[s] = -3;
      for (let q = 0; q < part.length; q++) {
        for (let j = 0; j < 4; j++) {
          const y = nbr[part[q] * 4 + j];
          if (y >= 0 && owner[y] === -2) {
            owner[y] = -3;
            part.push(y);
          }
        }
      }
      parts.push(part);
    }
    const keep = Math.max(0, parts.findIndex((p) => p.includes(this.clue[k])));
    parts.forEach((part, i) => {
      const id = i === keep ? k : this.islands.length;
      if (i === keep) {
        this.islands[k] = part;
        if (!part.includes(this.clue[k])) this.clue[k] = rng.pick(part);
      } else {
        this.islands.push(part);
        this.clue.push(rng.pick(part));
      }
      for (const y of part) owner[y] = id;
    });
    return true;
  }

  clues() {
    const clues = new Array(this.N).fill(0);
    this.islands.forEach((cells, k) => {
      clues[this.clue[k]] = cells.length;
    });
    return clues;
  }

  values() {
    return Array.from(this.owner, (k) => (k < 0 ? 1 : 0));
  }
}

const RING = [[-1, 0], [-1, 1], [0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1]];

/** 岛的大小上限（小盘面相应缩小）。 */
function capOf(cfg, N) {
  return Math.max(2, Math.min(cfg.cap, Math.floor(N / 5)));
}

/** 随机答案；失败返回 null。 */
export function randomAnswer(W, H, cfg, rng) {
  const A = new Answer(W, H);
  const { N, nbr, blocks } = A.G;
  const cap = capOf(cfg, N);
  const dead = new Uint8Array(N);

  for (;;) {
    const seeds = [];
    for (let x = 0; x < N; x++) if (!dead[x] && A.owner[x] < 0 && A.islandNear(x) === -1) seeds.push(x);
    if (!seeds.length) break;
    const x = rng.pick(seeds);
    if (!A.canRemove(x)) {
      dead[x] = 1;
      continue;
    }
    const k = A.whiten(x, -1);
    const size = Math.max(1, Math.min(cap, rng.weightedIndex(cfg.sizes)));
    const cells = A.islands[k];
    while (cells.length < size) {
      const options = [];
      for (const a of cells) {
        for (let j = 0; j < 4; j++) {
          const y = nbr[a * 4 + j];
          if (y >= 0 && A.owner[y] < 0 && A.islandNear(y) === k && !options.includes(y)) options.push(y);
        }
      }
      rng.shuffle(options);
      const y = options.find((c) => A.canRemove(c));
      if (y === undefined) break;
      A.whiten(y, k);
    }
  }

  // 加厚：部分黑格并入相邻的岛，使黑墙更细
  for (const x of rng.shuffle(Array.from({ length: N }, (_, i) => i))) {
    if (A.owner[x] < 0 && rng.next() < cfg.fatten) A.tryWhiten(x, cap);
  }

  // 消除 2×2 黑块：块中某格变白（并入相邻的岛或成为新的 1 格岛）
  const order = rng.shuffle(Array.from(blocks));
  for (let pass = 0; pass < 3; pass++) {
    let left = 0;
    for (const i of order) {
      const cells = [i, i + 1, i + W, i + W + 1];
      if (!cells.every((x) => A.owner[x] < 0)) continue;
      rng.shuffle(cells);
      if (!cells.some((x) => A.tryWhiten(x, cap))) left++;
    }
    if (!left) break;
    if (pass === 2) return null;
  }
  A.clue = A.islands.map((cells) => rng.pick(cells));
  return A;
}

/**
 * 从候选 dom 出发找一个与答案 sol 不同的解：随机选一个未定格（root）取与 sol 相反的值再搜索。
 * 换 OTHER_TRIES 个起点仍找不到（或超出预算）则返回 null。
 */
function otherSolution(model, dom, sol, W, rng) {
  let nodes = 0;
  let rootR = 0;
  let rootC = 0;
  const search = (D) => {
    if (++nodes > OTHER_NODES || !propagate(model, D, 2)) return null;
    // 在离 root 最近的未定格上分支，优先取答案的值，使另解尽量只在局部与答案不同
    let v = -1;
    let best = Infinity;
    for (let i = 0; i < model.size; i++) {
      if (D.isFixed(i)) continue;
      const d = Math.abs(Math.floor(i / W) - rootR) + Math.abs((i % W) - rootC);
      if (d < best) {
        best = d;
        v = i;
      }
    }
    if (v < 0) return D.values();
    for (const val of [sol[v], 1 - sol[v]]) {
      const T = D.clone();
      T.set(v, val);
      const found = search(T);
      if (found || nodes > OTHER_NODES) return found;
    }
    return null;
  };
  const open = [];
  for (let i = 0; i < model.size; i++) if (dom[i] === 3) open.push(i);
  rng.shuffle(open);
  for (let t = 0; t < Math.min(OTHER_TRIES, open.length); t++) {
    const root = open[t];
    nodes = 0;
    rootR = Math.floor(root / W);
    rootC = root % W;
    const D = new Domains(Uint32Array.from(dom));
    D.set(root, 1 - sol[root]);
    const res = search(D);
    if (res) return res;
  }
  return null;
}

/** 排除另一个解：在两解不同的格子上涂白（toWhite）/ 涂黑（toBlack）答案，或把数字移过去。 */
function exclude(A, toWhite, toBlack, cap, grow, rng) {
  rng.shuffle(toWhite);
  rng.shuffle(toBlack);
  const ops = [() => toWhite.some((x) => A.tryWhiten(x, cap)), () => toBlack.some((x) => A.tryBlacken(x, rng))];
  if (rng.next() >= grow) ops.reverse();
  if (ops[0]() || ops[1]()) return;
  // 数字放在另一解为黑的格子上，该解即不成立
  const x = toBlack[0];
  A.clue[A.owner[x]] = x;
}

/** 唯一但超出难度：在未确定的区域里改动一格（涂白、涂黑或移动数字）。 */
function perturb(A, values, cap, rng) {
  // 最近改动过的格子暂不再动，以免来回反复
  let open = [];
  for (let x = 0; x < A.N; x++) if (values[x] < 0 && A.time - A.changed[x] > TABU) open.push(x);
  if (!open.length) for (let x = 0; x < A.N; x++) if (values[x] < 0) open.push(x);
  open = rng.shuffle(open);
  // 新的 1 格岛信息量最大
  for (const x of open) if (A.owner[x] < 0 && A.islandNear(x) === -1 && A.tryWhiten(x, cap)) return;
  const whites = open.filter((x) => A.owner[x] >= 0);
  if (whites.length && rng.next() < 0.5) {
    A.clue[A.owner[whites[0]]] = whites[0];
    return;
  }
  for (const x of open) {
    if (A.owner[x] < 0 ? A.tryWhiten(x, cap) : A.tryBlacken(x, rng)) return;
  }
  if (whites.length) A.clue[A.owner[whites[0]]] = whites[0];
}

/** 兜底：奇数行奇数列放 1，其余全黑（必然唯一且只需一级推理）。 */
export function latticeAnswer(W, H) {
  const A = new Answer(W, H);
  for (let r = 1; r < H; r += 2) for (let c = 1; c < W; c += 2) A.whiten(r * W + c, -1);
  return A;
}

export function generatePuzzle({ width: W, height: H, difficulty, seed }) {
  assertParams({ difficulty, seed });
  if (!Number.isInteger(W) || !Number.isInteger(H) || W < 2 || H < 2 || W > 30 || H > 30) {
    throw new Error(`数墙不支持 ${W}x${H}`);
  }
  const rng = createRng(seed);
  const cfg = CONFIG[difficulty];
  const { minLevel, maxLevel } = DIFFICULTY_LEVELS[difficulty];

  // 所有尝试共用的修补轮数上限，保证最坏情况下的耗时
  let roundsLeft = MAX_ROUNDS;
  const make = (conf) => {
    let A = null;
    for (let i = 0; i < 10 && !A; i++) A = randomAnswer(W, H, conf, rng);
    if (!A) return null;
    const cap = capOf(conf, A.N);
    for (let round = 0; round <= REPAIRS && roundsLeft-- > 0; round++) {
      A.time = round;
      const clues = A.clues();
      let result = logicSolve(buildModel(W, H, clues), Math.min(maxLevel, 2));
      if (result.solved) return { clues, solution: A.values(), result };
      if (result.contradiction) throw new Error('数墙推理矛盾');
      // 一轮里可排除多个另解，只要它们与答案不同的区域互不相邻
      const solution = A.values();
      const lite = buildModel(W, H, clues, { shapes: false });
      let open = 0;
      for (const v of result.values) if (v < 0) open++;
      const used = new Uint8Array(A.N);
      let fixed = 0;
      for (let t = Math.ceil(open / OPEN_PER_SEARCH); t > 0; t--) {
        const other = otherSolution(lite, result.domains, solution, W, rng);
        if (!other) break;
        const toWhite = [];
        const toBlack = [];
        let clash = false;
        for (let x = 0; x < A.N; x++) {
          if (solution[x] === other[x]) continue;
          (solution[x] ? toWhite : toBlack).push(x);
          if (used[x]) clash = true;
        }
        if (clash) continue;
        for (const x of toWhite.concat(toBlack)) {
          used[x] = 1;
          for (let j = 0; j < 4; j++) {
            const y = A.G.nbr[x * 4 + j];
            if (y >= 0) used[y] = 1;
          }
        }
        exclude(A, toWhite, toBlack, cap, conf.grow, rng);
        fixed++;
      }
      if (fixed) continue;
      // 没找到另解：可能唯一但超出当前等级。困难题此时尝试试探（未定格太多时几乎不可能成功，跳过）
      if (maxLevel === 3 && open <= A.N * TRIAL_OPEN) {
        try {
          result = logicSolve(buildModel(W, H, clues, { budget: { left: TRIAL_BUDGET * A.N } }), 3);
        } catch (err) {
          if (err !== BUDGET_EXCEEDED) throw err;
        }
        if (result.solved) return { clues, solution: A.values(), result };
      }
      perturb(A, result.values, cap, rng);
    }
    return null;
  };

  // 小盘面生成很快，多试几次以达到期望的推理等级，并从两道合格题中挑较难的
  const small = W * H <= 64;
  const want = small && difficulty !== 'easy' ? 2 : 1;
  const attempts = small ? ATTEMPTS * 4 : ATTEMPTS;
  let best = pickGraded({ minLevel, attempts, want, make: () => make(cfg) });
  // 兜底：换成小岛再试，仍不行就用格点阵
  roundsLeft = FALLBACK_ROUNDS;
  for (let i = 0; !best && i < ATTEMPTS && roundsLeft > 0; i++) best = make(CONFIG.easy);
  if (!best) {
    const A = latticeAnswer(W, H);
    const clues = A.clues();
    best = { clues, solution: A.values(), result: logicSolve(buildModel(W, H, clues), 3) };
  }
  const { clues, solution, result } = best;
  if (!isValidAnswer(W, H, clues, solution)) throw new Error('数墙答案不合法');
  return {
    game: 'nurikabe',
    width: W,
    height: H,
    difficulty,
    seed,
    clues,
    solution,
    order: Array.from(result.order).filter((i) => !clues[i]),
    grade: { level: result.level, steps: result.steps.slice(1) },
  };
}
