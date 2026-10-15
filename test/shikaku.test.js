import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePuzzle, randomPartition } from '../src/games/shikaku/generator.js';
import { countSolutions, logicSolve } from '../src/games/shikaku/solver.js';
import rules, { placeRect, removeRectAt } from '../src/games/shikaku/index.js';
import { createRng } from '../src/engine/rng.js';
import { rectsOverlap } from '../src/games/shikaku/puzzle.js';

function assertPartition(width, height, rects) {
  const seen = new Uint8Array(width * height);
  for (const rect of rects) {
    for (let r = rect.r; r < rect.r + rect.h; r++) {
      for (let c = rect.c; c < rect.c + rect.w; c++) {
        assert.ok(r >= 0 && r < height && c >= 0 && c < width, '矩形越界');
        assert.equal(seen[r * width + c], 0, '矩形重叠');
        seen[r * width + c] = 1;
      }
    }
  }
  assert.ok(seen.every((v) => v === 1), '没有覆盖全部格子');
}

test('数方：随机切分覆盖整个盘面且不重叠', () => {
  const rng = createRng(7);
  const cfg = { minArea: 2, maxArea: 10, peak: 5, spread: 2 };
  for (let i = 0; i < 50; i++) {
    const w = rng.int(3, 20);
    const h = rng.int(3, 20);
    assertPartition(w, h, randomPartition(w, h, cfg, rng));
  }
});

test('数方：难度分级符合要求', () => {
  for (const [d, level] of [['easy', 1], ['medium', 2], ['hard', 3]]) {
    for (let seed = 1; seed <= 5; seed++) {
      const p = generatePuzzle({ width: 10, height: 10, difficulty: d, seed });
      assert.equal(p.grade.level, level, `${d} seed ${seed}`);
      assertPartition(10, 10, p.solution);
    }
  }
});

test('数方：求解器能识别多解题', () => {
  const puzzle = { width: 2, height: 2, clues: [{ r: 0, c: 0, value: 2 }, { r: 1, c: 1, value: 2 }] };
  assert.equal(countSolutions(puzzle).count, 2);
  assert.equal(logicSolve(puzzle).solved, false);
});

test('数方：放置会替换重叠矩形，单击删除', () => {
  const p = generatePuzzle({ width: 6, height: 6, difficulty: 'easy', seed: 5 });
  let s = rules.initialState(p);
  s = placeRect(p, s, { r: 0, c: 0, h: 2, w: 2 });
  assert.equal(placeRect(p, s, { r: 0, c: 0, h: 2, w: 2 }), s, '重复放置无变化');
  s = placeRect(p, s, { r: 1, c: 1, h: 1, w: 3 });
  assert.deepEqual(s.rects, [{ r: 1, c: 1, h: 1, w: 3 }]);
  s = placeRect(p, s, { r: 3, c: 3, h: 1, w: 1 });
  assert.ok(!s.rects.some((a, i) => s.rects.some((b, j) => i !== j && rectsOverlap(a, b))));
  s = removeRectAt(s, 3, 3);
  assert.equal(s.rects.length, 1);
  s = placeRect(p, s, { r: 0, c: 0, h: 6, w: 6 });
  assert.deepEqual(rules.findWrong(p, s), [0]);
});
