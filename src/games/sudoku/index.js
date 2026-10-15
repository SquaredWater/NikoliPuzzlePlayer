// 数独规则模块。
// 题目：{ game, width: n, height: n, difficulty, seed, box: [宫高, 宫宽], givens: 数字[]（0 为空）,
//        solution: 数字[], order: 推理顺序（格子下标）, grade }
// 盘面状态：{ v: 数字[]（0 为空，提示格不填）, notes: 位掩码[]（第 k 位 = 数字 k+1）}
import { createRng } from '../../engine/rng.js';
import { assertParams, DIFFICULTY_LEVELS, minimizeClues, pickGraded } from '../../engine/generate.js';
import { countSolutions, lowBit, logicSolve, popcount } from '../../engine/logic.js';

const BOXES = { 4: [2, 2], 6: [2, 3], 9: [3, 3] };

// ---------------------------------------------------------------------------
// 盘面结构（按边长缓存）
// ---------------------------------------------------------------------------

const layouts = new Map();

export function layoutOf(n) {
  if (layouts.has(n)) return layouts.get(n);
  const box = BOXES[n];
  if (!box) throw new Error(`数独不支持边长 ${n}`);
  const [br, bc] = box;
  const rows = [];
  const cols = [];
  const boxes = [];
  for (let i = 0; i < n; i++) {
    rows.push(Array.from({ length: n }, (_, k) => i * n + k));
    cols.push(Array.from({ length: n }, (_, k) => k * n + i));
  }
  for (let r0 = 0; r0 < n; r0 += br) {
    for (let c0 = 0; c0 < n; c0 += bc) {
      const cells = [];
      for (let r = r0; r < r0 + br; r++) for (let c = c0; c < c0 + bc; c++) cells.push(r * n + c);
      boxes.push(cells);
    }
  }
  const boxOf = (cell) => Math.floor(Math.floor(cell / n) / br) * (n / bc) + Math.floor((cell % n) / bc);
  const peers = Array.from({ length: n * n }, (_, cell) => {
    const set = new Set([...rows[Math.floor(cell / n)], ...cols[cell % n], ...boxes[boxOf(cell)]]);
    set.delete(cell);
    return [...set];
  });
  // 宫与行/列的交叉部分（区块排除用）
  const intersections = [];
  for (const boxCells of boxes) {
    for (const line of [...rows, ...cols]) {
      const shared = line.filter((c) => boxCells.includes(c));
      if (!shared.length) continue;
      intersections.push({
        shared,
        restLine: line.filter((c) => !shared.includes(c)),
        restBox: boxCells.filter((c) => !shared.includes(c)),
      });
    }
  }
  const layout = {
    n,
    box,
    rows,
    cols,
    boxes,
    units: [...rows, ...cols, ...boxes],
    peers,
    boxOf,
    intersections,
    full: (1 << n) - 1,
  };
  layouts.set(n, layout);
  return layout;
}

// ---------------------------------------------------------------------------
// 推理模型
// ---------------------------------------------------------------------------

/** givens：数字数组，0 为空。变量 = 格子，取值 k 表示数字 k+1。 */
export function buildModel(n, givens) {
  const L = layoutOf(n);
  const N = n * n;

  // 一级：已确定格子排除同行列宫；某数字在某单元只剩一个位置
  const nakedSingles = (D) => {
    let changed = false;
    for (let cell = 0; cell < N; cell++) {
      const d = D.dom[cell];
      if (d & (d - 1)) continue;
      for (const p of L.peers[cell]) if (D.restrict(p, ~d)) changed = true;
      if (D.bad) return true;
    }
    return changed;
  };

  const hiddenSingles = (D) => {
    let changed = false;
    for (const unit of L.units) {
      for (let k = 0; k < n; k++) {
        const bit = 1 << k;
        let where = -1;
        let count = 0;
        for (const cell of unit) {
          if (D.dom[cell] & bit) {
            where = cell;
            if (++count > 1) break;
          }
        }
        if (count === 0) {
          D.bad = true;
          return true;
        }
        if (count === 1 && D.dom[where] !== bit) {
          D.set(where, k);
          changed = true;
        }
      }
    }
    return changed;
  };

  // 二级：区块排除（宫与行列的交叉）
  const lockedCandidates = (D) => {
    let changed = false;
    const union = (cells) => {
      let m = 0;
      for (const c of cells) m |= D.dom[c];
      return m;
    };
    for (const { shared, restLine, restBox } of L.intersections) {
      const inShared = union(shared);
      const inLine = union(restLine);
      const inBox = union(restBox);
      // 某数字在宫内只出现在交叉部分 → 从该行/列其余格删除；反之亦然
      const lineOnly = inShared & inLine & ~inBox;
      const boxOnly = inShared & inBox & ~inLine;
      if (lineOnly) for (const c of restLine) if (D.restrict(c, ~lineOnly)) changed = true;
      if (boxOnly) for (const c of restBox) if (D.restrict(c, ~boxOnly)) changed = true;
      if (changed) return true;
    }
    return false;
  };

  // 二级：显性数对 / 三数组
  const nakedSubsets = (D) => {
    let changed = false;
    for (const unit of L.units) {
      const open = unit.filter((c) => popcount(D.dom[c]) > 1);
      for (let size = 2; size <= 3; size++) {
        const pool = open.filter((c) => popcount(D.dom[c]) <= size);
        const pick = (start, chosen, mask) => {
          if (popcount(mask) > size) return;
          if (chosen.length === size) {
            if (popcount(mask) !== size) return;
            for (const c of open) if (!chosen.includes(c) && D.restrict(c, ~mask)) changed = true;
            return;
          }
          for (let i = start; i < pool.length; i++) pick(i + 1, [...chosen, pool[i]], mask | D.dom[pool[i]]);
        };
        pick(0, [], 0);
        if (changed) return true;
      }
    }
    return changed;
  };

  return {
    size: N,
    domains() {
      return Uint32Array.from(givens, (g) => (g ? 1 << (g - 1) : L.full));
    },
    rules: [[nakedSingles, hiddenSingles], [lockedCandidates, nakedSubsets]],
    validate(values) {
      for (const unit of L.units) {
        let seen = 0;
        for (const c of unit) seen |= 1 << values[c];
        if (seen !== L.full) return false;
      }
      return true;
    },
  };
}

// ---------------------------------------------------------------------------
// 生成
// ---------------------------------------------------------------------------

function randomFullGrid(n, rng) {
  const L = layoutOf(n);
  const grid = new Array(n * n).fill(0);
  const fill = () => {
    let best = -1;
    let bestMask = 0;
    let bestCount = Infinity;
    for (let cell = 0; cell < n * n; cell++) {
      if (grid[cell]) continue;
      let used = 0;
      for (const p of L.peers[cell]) if (grid[p]) used |= 1 << (grid[p] - 1);
      const mask = L.full & ~used;
      const count = popcount(mask);
      if (count < bestCount) {
        best = cell;
        bestMask = mask;
        bestCount = count;
        if (count <= 1) break;
      }
    }
    if (best < 0) return true;
    const digits = [];
    for (let m = bestMask; m; m &= m - 1) digits.push(lowBit(m) + 1);
    for (const d of rng.shuffle(digits)) {
      grid[best] = d;
      if (fill()) return true;
    }
    grid[best] = 0;
    return false;
  };
  fill();
  return grid;
}

const KEEP_RATIO = { easy: 0.42, medium: 0, hard: 0 };

export function generate({ width, height, difficulty, seed }) {
  assertParams({ difficulty, seed });
  const n = width;
  if (width !== height || !BOXES[n]) throw new Error(`数独不支持 ${width}x${height}`);
  const rng = createRng(seed);
  const { minLevel, maxLevel } = DIFFICULTY_LEVELS[difficulty];
  const N = n * n;
  // 中心对称地成对删除
  const groups = [];
  for (let i = 0; i < N; i++) {
    const j = N - 1 - i;
    if (i < j) groups.push([i, j]);
    else if (i === j) groups.push([i]);
  }

  const best = pickGraded({
    minLevel,
    attempts: n === 9 ? 30 : 60,
    want: difficulty === 'easy' ? 1 : 2,
    make() {
      const solution = randomFullGrid(n, rng);
      const givensOf = (active) => solution.map((d, i) => (active[i] ? d : 0));
      const active = minimizeClues(N, rng, (act) => logicSolve(buildModel(n, givensOf(act)), maxLevel).solved, {
        groups,
        minKeep: Math.round(N * KEEP_RATIO[difficulty]),
      });
      const givens = givensOf(active);
      const result = logicSolve(buildModel(n, givens), maxLevel);
      return result.solved ? { solution, givens, result } : null;
    },
  });
  if (!best) throw new Error('生成失败');
  const { solution, givens, result } = best;
  return {
    game: 'sudoku',
    width: n,
    height: n,
    difficulty,
    seed,
    box: BOXES[n],
    givens,
    solution,
    order: result.order.filter((cell) => !givens[cell]),
    grade: { level: result.level, steps: result.steps.slice(1) },
  };
}

/** 回溯计数（测试用）：确认题目唯一解。 */
export function solutionCount(puzzle, opts) {
  return countSolutions(buildModel(puzzle.width, puzzle.givens), opts);
}

// ---------------------------------------------------------------------------
// 盘面操作（供 view 使用）
// ---------------------------------------------------------------------------

/** 在格子里填数字（d=0 为清除），并顺手从同行列宫的笔记中删掉该数字。 */
export function setDigit(puzzle, state, cell, d) {
  if (puzzle.givens[cell]) return state;
  const v = state.v.slice();
  const notes = state.notes.slice();
  v[cell] = d;
  notes[cell] = 0;
  if (d) {
    const bit = 1 << (d - 1);
    for (const p of layoutOf(puzzle.width).peers[cell]) notes[p] &= ~bit;
  }
  return { v, notes };
}

export function toggleNote(puzzle, state, cell, d) {
  if (puzzle.givens[cell] || state.v[cell]) return state;
  const notes = state.notes.slice();
  notes[cell] ^= 1 << (d - 1);
  return { v: state.v, notes };
}

export function digitAt(puzzle, state, cell) {
  return puzzle.givens[cell] || state.v[cell];
}

/** 与同行/列/宫中其他数字重复的格子。 */
export function conflicts(puzzle, state) {
  const L = layoutOf(puzzle.width);
  const bad = new Set();
  for (const unit of L.units) {
    const seen = new Map();
    for (const c of unit) {
      const d = digitAt(puzzle, state, c);
      if (!d) continue;
      if (seen.has(d)) {
        bad.add(c);
        bad.add(seen.get(d));
      } else seen.set(d, c);
    }
  }
  return bad;
}

const cellName = (puzzle, cell) => `第 ${Math.floor(cell / puzzle.width) + 1} 行第 ${(cell % puzzle.width) + 1} 列`;

export default {
  id: 'sudoku',

  generate,

  initialState(puzzle) {
    const N = puzzle.width * puzzle.height;
    return { v: new Array(N).fill(0), notes: new Array(N).fill(0) };
  },

  isSolved(puzzle, state) {
    return puzzle.solution.every((d, i) => digitAt(puzzle, state, i) === d);
  },

  /** 返回填错的格子下标。 */
  findWrong(puzzle, state) {
    const wrong = [];
    state.v.forEach((d, i) => {
      if (d && !puzzle.givens[i] && d !== puzzle.solution[i]) wrong.push(i);
    });
    return wrong;
  },

  hint(puzzle, state) {
    for (const cell of puzzle.order) {
      if (state.v[cell] === puzzle.solution[cell]) continue;
      return {
        state: setDigit(puzzle, state, cell, puzzle.solution[cell]),
        message: `${cellName(puzzle, cell)}填 ${puzzle.solution[cell]}`,
        cell,
      };
    }
    return null;
  },

  solvedState(puzzle) {
    return {
      v: puzzle.solution.map((d, i) => (puzzle.givens[i] ? 0 : d)),
      notes: new Array(puzzle.solution.length).fill(0),
    };
  },

  progress(puzzle, state) {
    const open = puzzle.givens.filter((g) => !g).length;
    const filled = state.v.filter((d, i) => d && !puzzle.givens[i]).length;
    return `已填 ${filled} / ${open}`;
  },
};
