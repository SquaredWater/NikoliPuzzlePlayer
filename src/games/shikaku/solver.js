import { enumerateCandidates } from './puzzle.js';

function buildContext(puzzle) {
  const { width: W, height: H, clues } = puzzle;
  const N = W * H;
  const perClue = enumerateCandidates(puzzle);
  const C = [];
  const clueCands = perClue.map((list) =>
    list.map((cand) => {
      C.push(cand);
      return C.length - 1;
    }),
  );
  const cellCands = Array.from({ length: N }, () => []);
  C.forEach((cand, j) => {
    for (const x of cand.cells) cellCands[x].push(j);
  });
  const totalArea = clues.reduce((s, cl) => s + cl.value, 0);
  return { W, H, N, n: clues.length, C, clueCands, cellCands, areaOk: totalArea === N };
}

// ---------------------------------------------------------------------------
// 回溯计数：用于确认解的唯一性（找到 limit 个解即停止）。
// ---------------------------------------------------------------------------

export function countSolutions(puzzle, { limit = 2, nodeLimit = 200000 } = {}) {
  const ctx = buildContext(puzzle);
  const { N, n, C, clueCands, cellCands } = ctx;
  const result = { count: 0, aborted: false, solution: null };
  if (!ctx.areaOk) return result;

  const owner = new Int32Array(N).fill(-1);
  const chosen = new Int32Array(n).fill(-1);
  let nodes = 0;

  const fits = (j) => {
    for (const x of C[j].cells) if (owner[x] !== -1) return false;
    return true;
  };

  const rec = (remaining) => {
    if (result.aborted || result.count >= limit) return;
    if (++nodes > nodeLimit) {
      result.aborted = true;
      return;
    }
    if (remaining === 0) {
      result.count++;
      if (!result.solution) result.solution = Array.from(chosen, (j) => pickRect(C[j]));
      return;
    }
    // 选分支最少的线索或格子（格子必须被覆盖，所以按格子分支也是完备的）。
    let best = null;
    let bestSize = Infinity;
    for (let i = 0; i < n && bestSize > 1; i++) {
      if (chosen[i] >= 0) continue;
      const list = [];
      for (const j of clueCands[i]) if (fits(j)) list.push(j);
      if (list.length === 0) return;
      if (list.length < bestSize) {
        best = list;
        bestSize = list.length;
      }
    }
    if (bestSize > 1) {
      for (let x = 0; x < N && bestSize > 1; x++) {
        if (owner[x] !== -1) continue;
        const list = [];
        for (const j of cellCands[x]) {
          if (chosen[C[j].clue] < 0 && fits(j)) {
            list.push(j);
            if (list.length >= bestSize) break;
          }
        }
        if (list.length === 0) return;
        if (list.length < bestSize) {
          best = list;
          bestSize = list.length;
        }
      }
    }
    for (const j of best) {
      const cand = C[j];
      for (const x of cand.cells) owner[x] = cand.clue;
      chosen[cand.clue] = j;
      rec(remaining - 1);
      chosen[cand.clue] = -1;
      for (const x of cand.cells) owner[x] = -1;
      if (result.aborted || result.count >= limit) return;
    }
  };

  rec(n);
  return result;
}

function pickRect(cand) {
  return { r: cand.r, c: cand.c, h: cand.h, w: cand.w };
}

// ---------------------------------------------------------------------------
// 逻辑求解器：模拟人类推理，用于评定难度并给出提示顺序。
//   等级 1：线索只剩一个可选矩形 / 格子只能被一个矩形覆盖
//   等级 2：线索所有候选的公共区域必属于它 / 格子只可能属于某一条线索
//   等级 3：试探（假设某候选成立，用 1~2 级推理推出矛盾则排除）
// 只要求解成功，答案即唯一（每一步都是严格推理）。
// ---------------------------------------------------------------------------

function initState(ctx) {
  const st = {
    alive: new Uint8Array(ctx.C.length).fill(1),
    aliveCount: Int32Array.from(ctx.clueCands, (l) => l.length),
    cellCount: Int32Array.from(ctx.cellCands, (l) => l.length),
    done: new Uint8Array(ctx.n),
    order: [],
    bad: !ctx.areaOk,
  };
  if (st.aliveCount.some((v) => v === 0) || st.cellCount.some((v) => v === 0)) st.bad = true;
  return st;
}

function cloneState(st) {
  return {
    alive: st.alive.slice(),
    aliveCount: st.aliveCount.slice(),
    cellCount: st.cellCount.slice(),
    done: st.done.slice(),
    order: [],
    bad: st.bad,
  };
}

function kill(ctx, st, j) {
  if (!st.alive[j]) return false;
  st.alive[j] = 0;
  const cand = ctx.C[j];
  if (--st.aliveCount[cand.clue] === 0) st.bad = true;
  for (const x of cand.cells) if (--st.cellCount[x] === 0) st.bad = true;
  return true;
}

function killOthersAtCells(ctx, st, cells, clue) {
  let changed = false;
  for (const x of cells) {
    for (const j of ctx.cellCands[x]) {
      if (ctx.C[j].clue !== clue && kill(ctx, st, j)) changed = true;
    }
  }
  return changed;
}

// 等级 1a：线索只剩一个候选 → 确定，并排除与之重叠的其他候选。
function ruleNakedSingle(ctx, st) {
  let changed = false;
  for (let i = 0; i < ctx.n; i++) {
    if (st.done[i] || st.aliveCount[i] !== 1) continue;
    const j = ctx.clueCands[i].find((k) => st.alive[k]);
    st.done[i] = 1;
    st.order.push(i);
    changed = true;
    killOthersAtCells(ctx, st, ctx.C[j].cells, i);
    if (st.bad) return true;
  }
  return changed;
}

// 等级 1b：格子只被一个候选覆盖 → 该候选必选。
function ruleHiddenSingle(ctx, st) {
  let changed = false;
  for (let x = 0; x < ctx.N; x++) {
    if (st.cellCount[x] !== 1) continue;
    const j = ctx.cellCands[x].find((k) => st.alive[k]);
    const i = ctx.C[j].clue;
    if (st.aliveCount[i] <= 1) continue;
    for (const k of ctx.clueCands[i]) if (k !== j && kill(ctx, st, k)) changed = true;
    if (st.bad) return true;
  }
  return changed;
}

// 等级 2a：线索所有候选的交集一定属于它。
function ruleIntersection(ctx, st) {
  let changed = false;
  for (let i = 0; i < ctx.n; i++) {
    if (st.done[i] || st.aliveCount[i] < 2) continue;
    let r1 = -Infinity, c1 = -Infinity, r2 = Infinity, c2 = Infinity;
    for (const j of ctx.clueCands[i]) {
      if (!st.alive[j]) continue;
      const cand = ctx.C[j];
      r1 = Math.max(r1, cand.r);
      c1 = Math.max(c1, cand.c);
      r2 = Math.min(r2, cand.r + cand.h);
      c2 = Math.min(c2, cand.c + cand.w);
    }
    if ((r2 - r1) * (c2 - c1) <= 1) continue;
    const cells = [];
    for (let r = r1; r < r2; r++) for (let c = c1; c < c2; c++) cells.push(r * ctx.W + c);
    if (killOthersAtCells(ctx, st, cells, i)) changed = true;
    if (st.bad) return true;
  }
  return changed;
}

// 等级 2b：格子的所有候选都来自同一条线索 → 该线索必须覆盖此格。
function ruleCellOwner(ctx, st) {
  let changed = false;
  for (let x = 0; x < ctx.N; x++) {
    if (st.cellCount[x] < 2) continue;
    let owner = -1;
    let single = true;
    for (const j of ctx.cellCands[x]) {
      if (!st.alive[j]) continue;
      const i = ctx.C[j].clue;
      if (owner === -1) owner = i;
      else if (owner !== i) {
        single = false;
        break;
      }
    }
    if (!single || st.aliveCount[owner] <= st.cellCount[x]) continue;
    const r = Math.floor(x / ctx.W);
    const c = x % ctx.W;
    for (const k of ctx.clueCands[owner]) {
      const cand = ctx.C[k];
      const inside = r >= cand.r && r < cand.r + cand.h && c >= cand.c && c < cand.c + cand.w;
      if (!inside && kill(ctx, st, k)) changed = true;
    }
    if (st.bad) return true;
  }
  return changed;
}

// 等级 3：试探。候选越少的线索越先试。
function ruleTrial(ctx, st) {
  const pending = [];
  for (let i = 0; i < ctx.n; i++) if (!st.done[i] && st.aliveCount[i] > 1) pending.push(i);
  pending.sort((a, b) => st.aliveCount[a] - st.aliveCount[b]);
  for (const i of pending) {
    for (const j of ctx.clueCands[i]) {
      if (!st.alive[j]) continue;
      const trial = cloneState(st);
      for (const k of ctx.clueCands[i]) if (k !== j) kill(ctx, trial, k);
      propagate(ctx, trial, 2, null);
      if (trial.bad) {
        kill(ctx, st, j);
        return true;
      }
    }
  }
  return false;
}

function propagate(ctx, st, maxLevel, stats) {
  while (!st.bad) {
    let level = 0;
    if (ruleNakedSingle(ctx, st) || ruleHiddenSingle(ctx, st)) level = 1;
    else if (maxLevel >= 2 && (ruleIntersection(ctx, st) || ruleCellOwner(ctx, st))) level = 2;
    else if (maxLevel >= 3 && ruleTrial(ctx, st)) level = 3;
    else break;
    if (stats) {
      stats.steps[level]++;
      if (level > stats.level) stats.level = level;
    }
  }
  return !st.bad;
}

/**
 * 用不超过 maxLevel 的推理求解。
 * 返回 { solved, contradiction, level, steps, done, order, solution }
 *   level：实际用到的最高推理等级；order：线索被确定的先后顺序（用于提示）。
 */
export function logicSolve(puzzle, maxLevel = 3) {
  const ctx = buildContext(puzzle);
  const st = initState(ctx);
  const stats = { level: 0, steps: [0, 0, 0, 0] };
  const ok = propagate(ctx, st, maxLevel, stats);
  const solved = ok && st.done.every((d) => d === 1);
  let solution = null;
  if (solved) {
    solution = ctx.clueCands.map((list) => pickRect(ctx.C[list.find((j) => st.alive[j])]));
  }
  return {
    solved,
    contradiction: !ok,
    level: stats.level,
    steps: stats.steps,
    done: st.done,
    order: st.order,
    solution,
  };
}
