// 珍珠（Masyu）规则模块。
// 题目：{ game, width, height, difficulty, seed, pearls: 每格 0 无 / 1 白珠 / 2 黑珠,
//        solution: 每条边 0/1（编号见 model.js）, order: 推理顺序（有线的边）, grade }
// 盘面状态：{ e: 每条边 0 空 / 1 线 / 2 × }
import { countSolutions } from '../../engine/logic.js';
import { generatePuzzle } from './generator.js';
import { buildModel, layoutOf } from './model.js';

export { findViolations, layoutOf } from './model.js';
export const generate = generatePuzzle;

/** 回溯计数（测试用）：确认题目唯一解。 */
export function solutionCount(puzzle, opts) {
  return countSolutions(buildModel(puzzle.width, puzzle.height, puzzle.pearls), opts);
}

/** 把边 e 设为 v（0 空 / 1 线 / 2 ×），返回新状态。 */
export function setEdge(state, e, v) {
  if (e < 0 || state.e[e] === v) return state;
  const next = state.e.slice();
  next[e] = v;
  return { e: next };
}

/** 边的文字描述，如“第 2 行第 3、4 列之间”。 */
export function edgeName(puzzle, e) {
  const L = layoutOf(puzzle.width, puzzle.height);
  const a = L.ea[e];
  const r = Math.floor(a / puzzle.width) + 1;
  const c = (a % puzzle.width) + 1;
  return L.eb[e] === a + 1 ? `第 ${r} 行第 ${c}、${c + 1} 列之间` : `第 ${c} 列第 ${r}、${r + 1} 行之间`;
}

/** 画错的线（边下标），× 不算。 */
function findWrong(puzzle, state) {
  const wrong = [];
  state.e.forEach((v, e) => {
    if (v === 1 && puzzle.solution[e] !== 1) wrong.push(e);
  });
  return wrong;
}

export default {
  id: 'masyu',

  generate,

  initialState(puzzle) {
    return { e: new Array(puzzle.solution.length).fill(0) };
  },

  isSolved(puzzle, state) {
    return puzzle.solution.every((s, e) => (state.e[e] === 1) === (s === 1));
  },

  findWrong,

  hint(puzzle, state) {
    const wrong = findWrong(puzzle, state);
    if (wrong.length) {
      const e = state.e.slice();
      for (const k of wrong) e[k] = 0;
      return { state: { e }, message: `擦掉了 ${wrong.length} 段画错的线` };
    }
    for (const e of [...(puzzle.order || []), ...puzzle.solution.keys()]) {
      if (puzzle.solution[e] !== 1 || state.e[e] === 1) continue;
      return { state: setEdge(state, e, 1), message: `${edgeName(puzzle, e)}连线` };
    }
    return null;
  },

  solvedState(puzzle) {
    return { e: puzzle.solution.map((s) => (s === 1 ? 1 : 0)) };
  },

  progress(puzzle, state) {
    return `已画 ${state.e.filter((v) => v === 1).length} 段`;
  },
};
