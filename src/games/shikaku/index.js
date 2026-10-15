// 数方规则模块。盘面状态：{ rects: [{ r, c, h, w, hint? }] }
import { generatePuzzle } from './generator.js';
import { countSolutions } from './solver.js';
import { buildClueGrid, cluesInRect, rectArea, rectContains, rectsOverlap, sameRect } from './puzzle.js';

const plain = (rect) => ({ r: rect.r, c: rect.c, h: rect.h, w: rect.w });

const clueGrids = new WeakMap();
function clueGridOf(puzzle) {
  let g = clueGrids.get(puzzle);
  if (!g) clueGrids.set(puzzle, (g = buildClueGrid(puzzle)));
  return g;
}

/** 矩形是否“自洽”：恰好包含一个数字且面积相等（不代表一定是正解）。 */
export function rectStatus(puzzle, rect) {
  const inside = cluesInRect(puzzle, clueGridOf(puzzle), rect);
  if (inside.length !== 1) return { ok: false, clue: inside.length ? inside[0] : -1 };
  const clue = inside[0];
  return { ok: puzzle.clues[clue].value === rectArea(rect), clue };
}

/** 回溯计数（测试用）：确认题目唯一解。 */
export function solutionCount(puzzle, opts) {
  return countSolutions(puzzle, opts);
}

export function rectIndexAt(state, r, c) {
  return state.rects.findIndex((rect) => rectContains(rect, r, c));
}

/** 放置矩形：替换掉与之重叠的旧矩形。 */
export function placeRect(puzzle, state, rect, hint = false) {
  if (rect.r < 0 || rect.c < 0 || rect.r + rect.h > puzzle.height || rect.c + rect.w > puzzle.width) return state;
  if (state.rects.some((x) => sameRect(x, rect))) return state;
  const rects = state.rects.filter((x) => !rectsOverlap(x, rect));
  rects.push(hint ? { ...plain(rect), hint: true } : plain(rect));
  return { rects };
}

export function removeRectAt(state, r, c) {
  const i = rectIndexAt(state, r, c);
  if (i < 0) return state;
  return { rects: state.rects.filter((_, k) => k !== i) };
}

export default {
  id: 'shikaku',

  generate: generatePuzzle,

  initialState() {
    return { rects: [] };
  },

  isSolved(puzzle, state) {
    let covered = 0;
    for (const rect of state.rects) {
      if (!rectStatus(puzzle, rect).ok) return false;
      covered += rectArea(rect);
    }
    return covered === puzzle.width * puzzle.height;
  },

  /** 返回与答案不符的矩形下标。 */
  findWrong(puzzle, state) {
    return state.rects
      .map((rect, i) => (puzzle.solution.some((s) => sameRect(s, rect)) ? -1 : i))
      .filter((i) => i >= 0);
  },

  hint(puzzle, state) {
    const { solution, order } = puzzle;
    const sequence = order && order.length === solution.length ? order : solution.map((_, i) => i);
    for (const i of sequence) {
      const target = solution[i];
      if (state.rects.some((x) => sameRect(x, target))) continue;
      return {
        state: placeRect(puzzle, state, target, true),
        message: `放置了一个 ${target.h}×${target.w} 的矩形（虚线框）`,
      };
    }
    return null;
  },

  solvedState(puzzle) {
    return { rects: puzzle.solution.map(plain) };
  },

  progress(puzzle, state) {
    return `已画 ${state.rects.length} / ${puzzle.clues.length}`;
  },
};
