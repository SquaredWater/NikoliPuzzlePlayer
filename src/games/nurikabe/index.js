// 数墙规则模块。
// 题目：{ game, width, height, difficulty, seed, clues: 数字[]（0 为无数字）, solution: 格[]（1 黑、0 白）,
//        order: 推理顺序（格子下标）, grade }
// 盘面状态：{ c: 格[]（0 未定、1 黑、2 点·确定为白）}；数字格始终视为白，状态里保持 0。
import { countSolutions } from '../../engine/logic.js';
import { generatePuzzle } from './generator.js';
import { buildModel, geometry } from './model.js';

export { geometry };

export const generate = generatePuzzle;

/** 回溯计数（测试用）：确认题目唯一解。 */
export function solutionCount(puzzle, opts) {
  return countSolutions(buildModel(puzzle.width, puzzle.height, puzzle.clues), opts);
}

/** 把若干格设为同一状态（数字格不变）。 */
export function setCells(puzzle, state, cells, value) {
  let c = null;
  for (const i of cells) {
    if (puzzle.clues[i] || state.c[i] === value) continue;
    if (!c) c = state.c.slice();
    c[i] = value;
  }
  return c ? { c } : state;
}

/**
 * 盘面上明显违规之处（每项为格子下标的 Set）：
 *   pools   2×2 黑块
 *   cut     与其他黑格完全隔断的黑格（不在最大的那部分里）
 *   regions 有问题的白区：确定白区含两个数字或超过数字；
 *           被黑格围住的区域（未定格视为可白）没有数字却有点、或小于数字
 */
export function violations(puzzle, c) {
  const { width: W, height: H, clues } = puzzle;
  const { N, nbr, blocks } = geometry(W, H);
  const black = (i) => c[i] === 1 && !clues[i];
  const white = (i) => c[i] === 2 || clues[i] > 0;
  const pools = new Set();
  for (const i of blocks) {
    const cells = [i, i + 1, i + W, i + W + 1];
    if (cells.every(black)) for (const x of cells) pools.add(x);
  }

  // 连通分量：inside(i) 决定哪些格参与
  const seen = new Int32Array(N).fill(-1);
  const components = (inside) => {
    seen.fill(-1);
    const list = [];
    for (let s = 0; s < N; s++) {
      if (!inside(s) || seen[s] >= 0) continue;
      const cells = [s];
      seen[s] = list.length;
      for (let q = 0; q < cells.length; q++) {
        for (let j = 0; j < 4; j++) {
          const y = nbr[cells[q] * 4 + j];
          if (y >= 0 && inside(y) && seen[y] < 0) {
            seen[y] = list.length;
            cells.push(y);
          }
        }
      }
      list.push(cells);
    }
    return list;
  };
  const clueSum = (cells) => {
    let count = 0;
    let value = 0;
    for (const x of cells) {
      if (clues[x]) {
        count++;
        value = clues[x];
      }
    }
    return { count, value };
  };

  const regions = new Set();
  for (const cells of components(white)) {
    const { count, value } = clueSum(cells);
    if (count > 1 || (count === 1 && cells.length > value)) for (const x of cells) regions.add(x);
  }
  for (const cells of components((i) => !black(i))) {
    const { count, value } = clueSum(cells);
    const dotted = cells.some((x) => c[x] === 2);
    if ((count === 0 && dotted) || (count === 1 && cells.length < value)) for (const x of cells) regions.add(x);
  }

  // 黑格隔断：在“非白格”上分块，含黑格的块多于一个时，除最大的一块外都标红
  const cut = new Set();
  const parts = components((i) => !white(i)).filter((cells) => cells.some(black));
  if (parts.length > 1) {
    const counts = parts.map((cells) => cells.filter(black).length);
    const keep = counts.indexOf(Math.max(...counts));
    parts.forEach((cells, k) => {
      if (k !== keep) for (const x of cells) if (black(x)) cut.add(x);
    });
  }
  return { pools, cut, regions };
}

const cellName = (puzzle, i) => `第 ${Math.floor(i / puzzle.width) + 1} 行第 ${(i % puzzle.width) + 1} 列`;

function isSolved(puzzle, state) {
  return puzzle.solution.every((s, i) => (state.c[i] === 1) === (s === 1));
}

function findWrong(puzzle, state) {
  const wrong = [];
  state.c.forEach((v, i) => {
    if (v === 1 && !puzzle.solution[i]) wrong.push(i);
  });
  return wrong;
}

export default {
  id: 'nurikabe',

  generate,

  initialState(puzzle) {
    return { c: new Array(puzzle.width * puzzle.height).fill(0) };
  },

  isSolved,

  /** 返回涂错的黑格；点不算。 */
  findWrong,

  hint(puzzle, state) {
    if (isSolved(puzzle, state)) return null;
    const wrong = findWrong(puzzle, state);
    if (wrong.length) {
      return { state: setCells(puzzle, state, wrong, 2), message: `擦掉了 ${wrong.length} 个涂错的黑格（改为点）` };
    }
    const order = puzzle.order.concat(puzzle.solution.map((_, i) => i));
    for (const i of order) {
      if (puzzle.clues[i]) continue;
      const want = puzzle.solution[i] ? 1 : 2;
      if (state.c[i] === want) continue;
      return {
        state: setCells(puzzle, state, [i], want),
        message: `${cellName(puzzle, i)}${want === 1 ? '涂黑' : '是白格（打点）'}`,
        cell: i,
      };
    }
    return null;
  },

  solvedState(puzzle) {
    return { c: puzzle.solution.map((s, i) => (s ? 1 : puzzle.clues[i] ? 0 : 2)) };
  },

  progress(puzzle, state) {
    const total = puzzle.solution.reduce((a, s) => a + s, 0);
    return `已涂黑 ${state.c.filter((v) => v === 1).length} / ${total}`;
  },
};
