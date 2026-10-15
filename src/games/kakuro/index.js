// 数和规则模块。
// 题目：{ game, width, height, difficulty, seed,
//        solution: 数字[]（按格子下标，0 为黑格）, across: 和[]（黑格向右的段之和，0 为无）,
//        down: 和[]（黑格向下的段之和）, order: 推理顺序（格子下标）, grade }
// 盘面状态：{ v: 数字[]（0 为空，黑格恒为 0）, notes: 位掩码[]（第 k 位 = 数字 k+1）}
import { assertParams } from '../../engine/generate.js';
import { countSolutions } from '../../engine/logic.js';
import { buildModel, buildStruct } from './model.js';
import { generatePuzzle } from './generator.js';

export function generate({ width, height, difficulty, seed }) {
  assertParams({ difficulty, seed });
  if (!(width >= 4 && height >= 4 && width <= 16 && height <= 16)) throw new Error(`数和不支持 ${width}x${height}`);
  const { S, values, sums, result } = generatePuzzle({ width, height, difficulty, seed });
  const N = width * height;
  const solution = new Array(N).fill(0);
  S.cells.forEach((cell, v) => (solution[cell] = values[v] + 1));
  const across = new Array(N).fill(0);
  const down = new Array(N).fill(0);
  S.runs.forEach((run, k) => ((run.dir ? down : across)[run.clue] = sums[k]));
  return {
    game: 'kakuro',
    width,
    height,
    difficulty,
    seed,
    solution,
    across,
    down,
    order: Array.from(result.order, (v) => S.cells[v]),
    grade: { level: result.level, steps: result.steps.slice(1) },
  };
}

// ---------------------------------------------------------------------------
// 结构（按题目缓存）
// ---------------------------------------------------------------------------

const structs = new WeakMap();

/** 题目的段结构：白格由 solution 判断（布局本身对玩家可见）。 */
export function structOf(puzzle) {
  let S = structs.get(puzzle);
  if (!S) {
    S = buildStruct(puzzle.width, puzzle.height, puzzle.solution.map((d) => (d ? 1 : 0)));
    S.sums = S.runs.map((run) => (run.dir ? puzzle.down : puzzle.across)[run.clue]);
    // 每个白格的同段格子（填数时清笔记、选中时高亮用）
    S.peers = S.cells.map((_, v) => {
      const set = new Set();
      for (const k of S.runOf[v]) for (const u of S.runs[k].vars) if (u !== v) set.add(S.cells[u]);
      return [...set];
    });
    structs.set(puzzle, S);
  }
  return S;
}

/** 回溯计数（测试用）：确认题目唯一解。 */
export function solutionCount(puzzle, opts) {
  const S = structOf(puzzle);
  return countSolutions(buildModel(S, S.sums), opts);
}

// ---------------------------------------------------------------------------
// 盘面操作（供 view 使用）
// ---------------------------------------------------------------------------

export const isWhite = (puzzle, cell) => puzzle.solution[cell] > 0;

/** 在格子里填数字（d=0 为清除），并顺手从同段笔记中删掉该数字。 */
export function setDigit(puzzle, state, cell, d) {
  if (!isWhite(puzzle, cell)) return state;
  const v = state.v.slice();
  const notes = state.notes.slice();
  v[cell] = d;
  notes[cell] = 0;
  if (d) {
    const S = structOf(puzzle);
    for (const p of S.peers[S.varOf[cell]]) notes[p] &= ~(1 << (d - 1));
  }
  return { v, notes };
}

export function toggleNote(puzzle, state, cell, d) {
  if (!isWhite(puzzle, cell) || state.v[cell]) return state;
  const notes = state.notes.slice();
  notes[cell] ^= 1 << (d - 1);
  return { v: state.v, notes };
}

/**
 * 明显违规之处：{ cells: 格子集合, clues: Set('格子:方向') }。
 * 段内数字重复；段已填满但和不符；已填数字之和已超过提示。
 */
export function conflicts(puzzle, state) {
  const S = structOf(puzzle);
  const cells = new Set();
  const clues = new Set();
  S.runs.forEach((run, k) => {
    const sum = S.sums[k];
    const seen = new Map();
    let total = 0;
    let filled = 0;
    for (const v of run.vars) {
      const cell = S.cells[v];
      const d = state.v[cell];
      if (!d) continue;
      total += d;
      filled++;
      if (seen.has(d)) {
        cells.add(cell);
        cells.add(seen.get(d));
      } else seen.set(d, cell);
    }
    if (total > sum || (filled === run.vars.length && total !== sum)) {
      clues.add(`${run.clue}:${run.dir}`);
      for (const v of run.vars) if (state.v[S.cells[v]]) cells.add(S.cells[v]);
    }
  });
  return { cells, clues };
}

const cellName = (puzzle, cell) => `第 ${Math.floor(cell / puzzle.width) + 1} 行第 ${(cell % puzzle.width) + 1} 列`;

function wrongCells(puzzle, state) {
  const wrong = [];
  state.v.forEach((d, i) => {
    if (d && d !== puzzle.solution[i]) wrong.push(i);
  });
  return wrong;
}

export default {
  id: 'kakuro',

  generate,

  initialState(puzzle) {
    const N = puzzle.width * puzzle.height;
    return { v: new Array(N).fill(0), notes: new Array(N).fill(0) };
  },

  isSolved(puzzle, state) {
    return puzzle.solution.every((d, i) => !d || state.v[i] === d);
  },

  /** 返回填错的格子下标。 */
  findWrong: wrongCells,

  /** 按推理顺序填入下一格；盘面上有填错的数字时一并清除。 */
  hint(puzzle, state) {
    for (const cell of puzzle.order) {
      if (state.v[cell] === puzzle.solution[cell]) continue;
      let next = state;
      const wrong = wrongCells(puzzle, state).filter((i) => i !== cell);
      for (const i of wrong) next = setDigit(puzzle, next, i, 0);
      next = setDigit(puzzle, next, cell, puzzle.solution[cell]);
      const extra = wrong.length ? `（并清除了 ${wrong.length} 个填错的数字）` : '';
      return { state: next, message: `${cellName(puzzle, cell)}填 ${puzzle.solution[cell]}${extra}`, cell };
    }
    return null;
  },

  solvedState(puzzle) {
    return { v: puzzle.solution.slice(), notes: new Array(puzzle.solution.length).fill(0) };
  },

  progress(puzzle, state) {
    const open = puzzle.solution.filter((d) => d).length;
    const filled = state.v.filter((d) => d).length;
    return `已填 ${filled} / ${open}`;
  },
};
