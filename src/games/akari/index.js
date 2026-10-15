// 美术馆（Akari / Light Up）规则模块。
// 题目：{ game, width, height, difficulty, seed,
//        grid: 每格 -1 = 白格，0~4 = 带数字黑格，5 = 无数字黑格,
//        solution: 每格 1 = 灯泡、0 = 无灯（黑格为 0）, order: 灯泡格按推理先后排列, grade }
// 盘面状态：{ b: 每格 0 = 空，1 = 灯泡，2 = 点（此处无灯）；黑格恒为 0 }
// 推理变量：每个白格一个，取值 0 = 无灯，1 = 灯泡。
import { createRng } from '../../engine/rng.js';
import { assertParams, DIFFICULTY_LEVELS, minimizeClues, pickGraded } from '../../engine/generate.js';
import { countSolutions, logicSolve, popcount } from '../../engine/logic.js';

export const WHITE = -1;
export const BLACK = 5;

// 候选位掩码
const NO = 1;
const LAMP = 2;
const BOTH = 3;

const isClue = (g) => g >= 0 && g <= 4;

export function neighbors(W, H, i) {
  const r = Math.floor(i / W);
  const c = i % W;
  const out = [];
  if (r > 0) out.push(i - W);
  if (r < H - 1) out.push(i + W);
  if (c > 0) out.push(i - 1);
  if (c < W - 1) out.push(i + 1);
  return out;
}

// ---------------------------------------------------------------------------
// 盘面结构
// ---------------------------------------------------------------------------

/**
 * 白格变量、横竖线段与数字邻格。
 * 线段 = 一行（列）中被黑格隔开的连续白格；同一线段内的格子互相照到，
 * 一个白格被照亮 ⇔ 它所在的横段或竖段中有灯泡。
 */
export function structureOf(W, H, grid) {
  const N = W * H;
  const varOf = new Int32Array(N).fill(-1);
  const cells = [];
  for (let i = 0; i < N; i++) {
    if (grid[i] < 0) {
      varOf[i] = cells.length;
      cells.push(i);
    }
  }
  const M = cells.length;
  const hseg = new Int32Array(M);
  const vseg = new Int32Array(M);
  const segs = [];
  const scan = (outer, inner, at, segOf) => {
    for (let a = 0; a < outer; a++) {
      let cur = null;
      for (let b = 0; b < inner; b++) {
        const v = varOf[at(a, b)];
        if (v < 0) {
          cur = null;
          continue;
        }
        if (!cur) segs.push((cur = []));
        cur.push(v);
        segOf[v] = segs.length - 1;
      }
    }
  };
  scan(H, W, (r, c) => r * W + c, hseg);
  scan(W, H, (c, r) => r * W + c, vseg);
  const clues = [];
  const clueAdj = Array.from({ length: M }, () => []);
  for (let i = 0; i < N; i++) {
    if (!isClue(grid[i])) continue;
    const nb = neighbors(W, H, i)
      .map((j) => varOf[j])
      .filter((v) => v >= 0);
    for (const v of nb) clueAdj[v].push(clues.length);
    clues.push({ cell: i, n: grid[i], nb });
  }
  return { W, H, N, M, cells, varOf, hseg, vseg, segs, clues, clueAdj };
}

// ---------------------------------------------------------------------------
// 推理模型
// ---------------------------------------------------------------------------

export function buildModel(W, H, grid) {
  const S = structureOf(W, H, grid);
  const { M, hseg, vseg, segs, clues, clueAdj } = S;
  const nSeg = segs.length;
  const segLamp = new Int32Array(nSeg);
  const segOpen = new Int32Array(nSeg); // 仍可放灯的格数（含已确定的灯泡）

  const count = (dom) => {
    segLamp.fill(0);
    segOpen.fill(0);
    for (let v = 0; v < M; v++) {
      const d = dom[v];
      if (!(d & LAMP)) continue;
      segOpen[hseg[v]]++;
      segOpen[vseg[v]]++;
      if (d === LAMP) {
        segLamp[hseg[v]]++;
        segLamp[vseg[v]]++;
      }
    }
  };

  // 一级：灯泡所在横竖段的其余格不能放灯
  const seenByLamp = (D) => {
    let changed = false;
    for (const seg of segs) {
      let lamp = -1;
      for (const v of seg) {
        if (D.dom[v] !== LAMP) continue;
        if (lamp >= 0) {
          D.bad = true;
          return true;
        }
        lamp = v;
      }
      if (lamp < 0) continue;
      for (const v of seg) if (v !== lamp && D.restrict(v, NO)) changed = true;
    }
    return changed;
  };

  // 一级：数字已满足 → 其余邻格无灯；剩余可放位置数恰好等于所需 → 全放灯
  const clueCount = (D) => {
    let changed = false;
    for (const c of clues) {
      let lamps = 0;
      let open = 0;
      for (const v of c.nb) {
        if (D.dom[v] === LAMP) lamps++;
        else if (D.dom[v] === BOTH) open++;
      }
      if (lamps > c.n || lamps + open < c.n) {
        D.bad = true;
        return true;
      }
      if (!open) continue;
      if (lamps === c.n) {
        for (const v of c.nb) if (D.dom[v] === BOTH && D.restrict(v, NO)) changed = true;
      } else if (lamps + open === c.n) {
        for (const v of c.nb) if (D.dom[v] === BOTH && D.restrict(v, LAMP)) changed = true;
      }
    }
    return changed;
  };

  // 一级：未照亮的格子只剩唯一可能的光源 → 该处放灯
  const onlySource = (D) => {
    const dom = D.dom;
    count(dom);
    const found = [];
    for (let v = 0; v < M; v++) {
      const h = hseg[v];
      const u = vseg[v];
      if (segLamp[h] || segLamp[u]) continue;
      const n = segOpen[h] + segOpen[u] - (dom[v] & LAMP ? 1 : 0);
      if (n === 0) {
        D.bad = true;
        return true;
      }
      if (n !== 1) continue;
      if (dom[v] & LAMP) found.push(v);
      else for (const w of segOpen[h] ? segs[h] : segs[u]) if (dom[w] & LAMP) found.push(w);
    }
    let changed = false;
    for (const v of found) if (D.restrict(v, LAMP)) changed = true;
    return changed;
  };

  // 二级规则共用：假设若干格放灯、若干格不放，只推一步直接后果，检查是否立即矛盾。
  // 依赖 count() 统计的快照，调用者应在全部 probe 结束后再修改 D。
  let stamp = 0;
  const zMark = new Int32Array(M);
  const lMark = new Int32Array(M);
  const decSt = new Int32Array(nSeg);
  const dec = new Int32Array(nSeg);
  const addSt = new Int32Array(nSeg);
  const seenSt = new Int32Array(nSeg);
  const clueSt = new Int32Array(clues.length);

  /** 不矛盾时返回因此不能放灯的格子（本来可放），矛盾时返回 null。 */
  const probe = (dom, lamps, zeros) => {
    const st = ++stamp;
    const zeroed = [];
    for (const v of lamps) {
      if (!(dom[v] & LAMP)) return null;
      lMark[v] = st;
    }
    const kill = (w) => {
      if (lMark[w] === st || dom[w] === LAMP) return false;
      if ((dom[w] & LAMP) && zMark[w] !== st) {
        zMark[w] = st;
        zeroed.push(w);
      }
      return true;
    };
    for (const v of lamps) {
      addSt[hseg[v]] = st;
      addSt[vseg[v]] = st;
      for (const w of segs[hseg[v]]) if (w !== v && !kill(w)) return null;
      for (const w of segs[vseg[v]]) if (w !== v && !kill(w)) return null;
    }
    for (const w of zeros) if (!kill(w)) return null;

    const bump = (s) => {
      if (decSt[s] !== st) {
        decSt[s] = st;
        dec[s] = 0;
      }
      dec[s]++;
    };
    for (const z of zeroed) {
      bump(hseg[z]);
      bump(vseg[z]);
    }
    const decOf = (s) => (decSt[s] === st ? dec[s] : 0);
    const lit = (s) => segLamp[s] > 0 || addSt[s] === st;
    // 可放灯的格子减少后，与之同段的未照亮格子是否还有光源
    const sourcesOk = (s) => {
      if (seenSt[s] === st) return true;
      seenSt[s] = st;
      for (const w of segs[s]) {
        const h = hseg[w];
        const u = vseg[w];
        if (lit(h) || lit(u)) continue;
        const self = (dom[w] & LAMP) && zMark[w] !== st ? 1 : 0;
        if (segOpen[h] - decOf(h) + segOpen[u] - decOf(u) - self <= 0) return false;
      }
      return true;
    };
    for (const z of zeroed) if (!sourcesOk(hseg[z]) || !sourcesOk(vseg[z])) return null;

    const cluesOk = (x) => {
      for (const k of clueAdj[x]) {
        if (clueSt[k] === st) continue;
        clueSt[k] = st;
        const c = clues[k];
        let on = 0;
        let open = 0;
        for (const v of c.nb) {
          if (lMark[v] === st || dom[v] === LAMP) on++;
          else if (dom[v] === BOTH && zMark[v] !== st) open++;
        }
        if (on > c.n || on + open < c.n) return false;
      }
      return true;
    };
    for (const v of lamps) if (!cluesOk(v)) return null;
    for (const z of zeroed) if (!cluesOk(z)) return null;
    return zeroed;
  };

  // 二级：对每个数字枚举邻格放灯组合，排除立即矛盾的组合后取交集
  // （所有组合都放灯/都不放灯的邻格；所有组合下都会被照到的格子不能放灯，如数字斜对角的格子）
  const clueCombos = (D) => {
    const dom = D.dom;
    count(dom);
    const setLamp = [];
    const setNo = [];
    const hits = new Map();
    for (const c of clues) {
      let lamps = 0;
      const open = [];
      for (const v of c.nb) {
        if (dom[v] === LAMP) lamps++;
        else if (dom[v] === BOTH) open.push(v);
      }
      const need = c.n - lamps;
      if (need <= 0 || need >= open.length) continue;
      hits.clear();
      let valid = 0;
      let always = (1 << open.length) - 1;
      for (let m = 1; m < 1 << open.length; m++) {
        if (popcount(m) !== need) continue;
        const on = [];
        const off = [];
        open.forEach((v, k) => ((m >> k) & 1 ? on : off).push(v));
        const zeroed = probe(dom, on, off);
        if (!zeroed) continue;
        valid++;
        always &= m;
        for (const w of zeroed) hits.set(w, (hits.get(w) || 0) + 1);
      }
      if (!valid) {
        D.bad = true;
        return true;
      }
      open.forEach((v, k) => {
        if ((always >> k) & 1) setLamp.push(v);
      });
      for (const [w, n] of hits) if (n === valid) setNo.push(w);
    }
    let changed = false;
    for (const v of setLamp) if (D.restrict(v, LAMP)) changed = true;
    for (const v of setNo) if (D.restrict(v, NO)) changed = true;
    return changed;
  };

  // 二级：在某格放灯会立即导致某数字无法满足或某白格再无光源 → 该格不能放灯
  const lampLookahead = (D) => {
    const dom = D.dom;
    count(dom);
    const out = [];
    for (let v = 0; v < M; v++) if (dom[v] === BOTH && !probe(dom, [v], [])) out.push(v);
    for (const v of out) D.restrict(v, NO);
    return out.length > 0;
  };

  return {
    size: M,
    structure: S,
    domains() {
      return new Uint32Array(M).fill(BOTH);
    },
    rules: [
      [seenByLamp, clueCount, onlySource],
      [clueCombos, lampLookahead],
    ],
    validate(values) {
      const lamps = new Int32Array(nSeg);
      for (let v = 0; v < M; v++) {
        if (values[v] !== 1) continue;
        lamps[hseg[v]]++;
        lamps[vseg[v]]++;
      }
      for (let s = 0; s < nSeg; s++) if (lamps[s] > 1) return false;
      for (let v = 0; v < M; v++) if (!lamps[hseg[v]] && !lamps[vseg[v]]) return false;
      for (const c of clues) {
        let n = 0;
        for (const v of c.nb) n += values[v] === 1 ? 1 : 0;
        if (n !== c.n) return false;
      }
      return true;
    },
  };
}

// ---------------------------------------------------------------------------
// 生成
// ---------------------------------------------------------------------------

/** 从格子 i 向四个方向照射，标记被照亮的格子。 */
function castLight(W, H, grid, i, lit) {
  lit[i] = 1;
  const r = Math.floor(i / W);
  const c = i % W;
  for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    for (let y = r + dr, x = c + dc; y >= 0 && y < H && x >= 0 && x < W; y += dr, x += dc) {
      if (grid[y * W + x] >= 0) break;
      lit[y * W + x] = 1;
    }
  }
}

/** 保留已有灯泡，在未照亮的白格中随机贪心补灯（未照亮的格子放灯必然合法）。 */
function fillLamps(W, H, grid, lamps, rng) {
  const N = W * H;
  const lit = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (lamps[i]) castLight(W, H, grid, i, lit);
  const open = [];
  for (let i = 0; i < N; i++) if (grid[i] < 0 && !lit[i]) open.push(i);
  for (const i of rng.shuffle(open)) {
    if (lit[i]) continue;
    lamps[i] = 1;
    castLight(W, H, grid, i, lit);
  }
}

function numberClues(W, H, grid, lamps) {
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] < 0) continue;
    grid[i] = neighbors(W, H, i).filter((j) => lamps[j]).length;
  }
}

/** 中心对称的随机黑格布局，密度 15%~22%。 */
function randomLayout(W, H, rng) {
  const N = W * H;
  const grid = new Array(N).fill(WHITE);
  const target = Math.round(N * (0.15 + rng.next() * 0.07));
  let black = 0;
  for (const i of rng.shuffle(Array.from({ length: N }, (_, k) => k))) {
    if (black >= target) break;
    if (grid[i] !== WHITE) continue;
    const j = N - 1 - i;
    grid[i] = BLACK;
    grid[j] = BLACK;
    black += i === j ? 1 : 2;
  }
  return grid;
}

/**
 * 生成一道候选题：随机布局 + 贪心放灯 + 全部数字；
 * 若全数字仍无法在 maxLevel 内解出，就把一个未确定的格子（及其对称格）涂黑、补灯后重试。
 * 每次修补至少涂黑一个白格，所以 repairs 足够大时必然成功。
 */
function makeCandidate(W, H, rng, maxLevel, keepRatio, repairs) {
  const N = W * H;
  const grid = randomLayout(W, H, rng);
  const lamps = new Array(N).fill(0);
  fillLamps(W, H, grid, lamps, rng);
  numberClues(W, H, grid, lamps);
  let model = buildModel(W, H, grid);
  let res = logicSolve(model, maxLevel);
  for (let k = 0; !res.solved && k < repairs; k++) {
    const { cells } = model.structure;
    const open = [];
    for (let v = 0; v < cells.length; v++) if (res.values[v] < 0) open.push(cells[v]);
    if (!open.length) return null;
    const x = rng.pick(open);
    for (const i of [x, N - 1 - x]) {
      if (grid[i] !== WHITE) continue;
      grid[i] = BLACK;
      lamps[i] = 0;
    }
    fillLamps(W, H, grid, lamps, rng);
    numberClues(W, H, grid, lamps);
    model = buildModel(W, H, grid);
    res = logicSolve(model, maxLevel);
  }
  if (!res.solved) return null;

  const clueCells = [];
  for (let i = 0; i < N; i++) if (grid[i] >= 0) clueCells.push(i);
  const index = new Map(clueCells.map((cell, k) => [cell, k]));
  const groups = [];
  for (const [cell, k] of index) {
    const j = index.get(N - 1 - cell);
    if (j === undefined) groups.push([k]);
    else if (k <= j) groups.push(k === j ? [k] : [k, j]);
  }
  const gridOf = (active) => {
    const g = grid.slice();
    clueCells.forEach((cell, k) => {
      if (!active[k]) g[cell] = BLACK;
    });
    return g;
  };
  const active = minimizeClues(clueCells.length, rng, (act) => logicSolve(buildModel(W, H, gridOf(act)), maxLevel).solved, {
    groups,
    minKeep: Math.round(clueCells.length * keepRatio),
  });
  const finalGrid = gridOf(active);
  model = buildModel(W, H, finalGrid);
  const result = logicSolve(model, maxLevel);
  if (!result.solved) return null;
  return { grid: finalGrid, solution: lamps, result, cells: model.structure.cells };
}

const KEEP_RATIO = { easy: 0.5, medium: 0, hard: 0 };

export function generate({ width, height, difficulty, seed }) {
  assertParams({ difficulty, seed });
  const W = width;
  const H = height;
  if (!Number.isInteger(W) || !Number.isInteger(H) || W < 2 || H < 2 || W > 30 || H > 30) {
    throw new Error(`美术馆不支持 ${width}x${height}`);
  }
  const rng = createRng(seed);
  const { minLevel, maxLevel } = DIFFICULTY_LEVELS[difficulty];
  const area = W * H;
  const keep = KEEP_RATIO[difficulty];
  let best = pickGraded({
    minLevel,
    attempts: area > 150 ? 3 : area > 64 ? 8 : 20,
    want: difficulty === 'hard' && area <= 200 ? 2 : 1,
    make: () => makeCandidate(W, H, rng, maxLevel, keep, Math.ceil(Math.sqrt(area))),
  });
  // 兜底：不限修补次数（必然成功）
  if (!best) best = makeCandidate(W, H, rng, maxLevel, keep, Infinity);
  if (!best) throw new Error('生成失败');
  const { grid, solution, result, cells } = best;
  return {
    game: 'akari',
    width: W,
    height: H,
    difficulty,
    seed,
    grid,
    solution,
    order: Array.from(result.order, (v) => cells[v]).filter((cell) => solution[cell]),
    grade: { level: result.level, steps: result.steps.slice(1) },
  };
}

/** 回溯计数（测试用）：确认题目唯一解。 */
export function solutionCount(puzzle, opts) {
  return countSolutions(buildModel(puzzle.width, puzzle.height, puzzle.grid), opts);
}

// ---------------------------------------------------------------------------
// 盘面操作与检查（供 view 使用）
// ---------------------------------------------------------------------------

/** 被灯泡照亮的格子（Uint8Array）。 */
export function lightMap(puzzle, b) {
  const { width: W, height: H, grid } = puzzle;
  const lit = new Uint8Array(W * H);
  for (let i = 0; i < b.length; i++) if (b[i] === 1 && grid[i] < 0) castLight(W, H, grid, i, lit);
  return lit;
}

/** 互相照到的灯泡。 */
export function lampConflicts(puzzle, b) {
  const { width: W, height: H, grid } = puzzle;
  const bad = new Set();
  for (let i = 0; i < b.length; i++) {
    if (b[i] !== 1) continue;
    const r = Math.floor(i / W);
    const c = i % W;
    // 只需向右、向下找
    for (const [dr, dc] of [[1, 0], [0, 1]]) {
      for (let y = r + dr, x = c + dc; y < H && x < W; y += dr, x += dc) {
        const j = y * W + x;
        if (grid[j] >= 0) break;
        if (b[j] === 1) {
          bad.add(i);
          bad.add(j);
          break;
        }
      }
    }
  }
  return bad;
}

/** 无法满足的数字：周围灯泡过多，或剩余可放灯的邻格已不够。 */
export function clueErrors(puzzle, b, lit = lightMap(puzzle, b)) {
  const { width: W, height: H, grid } = puzzle;
  const bad = new Set();
  for (let i = 0; i < grid.length; i++) {
    if (!isClue(grid[i])) continue;
    let on = 0;
    let open = 0;
    for (const j of neighbors(W, H, i)) {
      if (grid[j] >= 0) continue;
      if (b[j] === 1) on++;
      else if (b[j] === 0 && !lit[j]) open++;
    }
    if (on > grid[i] || on + open < grid[i]) bad.add(i);
  }
  return bad;
}

/** 把若干白格设为 value（0 空 / 1 灯泡 / 2 点）。 */
export function setCells(puzzle, state, cells, value) {
  const b = state.b.slice();
  for (const i of cells) if (puzzle.grid[i] < 0) b[i] = value;
  return { b };
}

const cellName = (puzzle, cell) => `第 ${Math.floor(cell / puzzle.width) + 1} 行第 ${(cell % puzzle.width) + 1} 列`;

function findWrong(puzzle, state) {
  const wrong = [];
  state.b.forEach((x, i) => {
    if (x === 1 && !puzzle.solution[i]) wrong.push(i);
  });
  return wrong;
}

export default {
  id: 'akari',

  generate,

  initialState(puzzle) {
    return { b: new Array(puzzle.width * puzzle.height).fill(0) };
  },

  isSolved(puzzle, state) {
    return puzzle.solution.every((s, i) => (state.b[i] === 1) === (s === 1));
  },

  /** 放错的灯泡（格子下标）；点只是辅助标记，不检查。 */
  findWrong,

  hint(puzzle, state) {
    const wrong = findWrong(puzzle, state);
    if (wrong.length) {
      return { state: setCells(puzzle, state, wrong, 0), message: `移除 ${wrong.length} 个放错的灯泡`, cell: wrong[0] };
    }
    for (const cell of puzzle.order) {
      if (state.b[cell] === 1) continue;
      return { state: setCells(puzzle, state, [cell], 1), message: `${cellName(puzzle, cell)}放灯泡`, cell };
    }
    return null;
  },

  solvedState(puzzle) {
    return { b: puzzle.solution.map((s) => (s ? 1 : 0)) };
  },

  progress(puzzle, state) {
    const lit = lightMap(puzzle, state.b);
    let open = 0;
    let done = 0;
    puzzle.grid.forEach((g, i) => {
      if (g >= 0) return;
      open++;
      done += lit[i];
    });
    return `已照亮 ${done} / ${open}`;
  },
};
