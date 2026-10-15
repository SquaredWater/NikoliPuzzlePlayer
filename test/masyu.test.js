import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../src/engine/rng.js';
import { Domains, countSolutions, logicSolve, propagate } from '../src/engine/logic.js';
import rules, { findViolations } from '../src/games/masyu/index.js';
import { BLACK, WHITE, buildModel, isValidLoop, layoutOf } from '../src/games/masyu/model.js';
import { fallbackBase, growRegion, pearlCandidates } from '../src/games/masyu/generator.js';

/** 由格子序列（首尾相接）得到边数组。 */
function loopOf(W, H, path) {
  const L = layoutOf(W, H);
  const sol = new Array(L.E).fill(0);
  for (let k = 0; k < path.length; k++) {
    const [r1, c1] = path[k];
    const [r2, c2] = path[(k + 1) % path.length];
    const a = Math.min(r1 * W + c1, r2 * W + c2);
    const b = Math.max(r1 * W + c1, r2 * W + c2);
    sol[b === a + 1 ? L.right[a] : L.down[a]] = 1;
  }
  return sol;
}

/** 沿 r0..r1 × c0..c1 矩形边框顺时针走一圈。 */
function rectPath(r0, c0, r1, c1) {
  const p = [];
  for (let c = c0; c < c1; c++) p.push([r0, c]);
  for (let r = r0; r < r1; r++) p.push([r, c1]);
  for (let c = c1; c > c0; c--) p.push([r1, c]);
  for (let r = r1; r > r0; r--) p.push([r, c0]);
  return p;
}

function pearlsAt(W, H, list) {
  const p = new Array(W * H).fill(0);
  for (const [r, c, t] of list) p[r * W + c] = t;
  return p;
}

const coverage = (W, H, sol) => {
  const L = layoutOf(W, H);
  const cells = new Set();
  sol.forEach((v, e) => v && (cells.add(L.ea[e]), cells.add(L.eb[e])));
  return cells.size / (W * H);
};

test('珍珠：白珠、黑珠条件与单一回路', () => {
  const L4 = layoutOf(4, 4);
  const border4 = loopOf(4, 4, rectPath(0, 0, 3, 3));
  const ok = (list, sol = border4, L = L4, W = 4) => isValidLoop(L, pearlsAt(W, W, list), sol);
  assert.ok(ok([]));
  assert.ok(ok([[0, 0, BLACK], [3, 3, BLACK]]), '角上黑珠两臂各两格');
  assert.ok(!ok([[0, 1, BLACK]]), '黑珠不能直行');
  assert.ok(ok([[0, 1, WHITE], [2, 0, WHITE]]), '白珠旁边转弯');
  assert.ok(!ok([[0, 0, WHITE]]), '白珠不能转弯');
  assert.ok(!ok([[1, 1, WHITE]]), '珍珠必须在回路上');

  const L5 = layoutOf(5, 5);
  const border5 = loopOf(5, 5, rectPath(0, 0, 4, 4));
  assert.ok(!ok([[0, 2, WHITE]], border5, L5, 5), '白珠前后都直行');
  // 2×2 小圈：角上的黑珠臂长只有 1
  const small = loopOf(5, 5, rectPath(1, 1, 2, 2));
  assert.ok(!ok([[1, 1, BLACK]], small, L5, 5));
  // 两个回路
  const two = loopOf(5, 5, rectPath(0, 0, 1, 1)).map((v, e) => v | loopOf(5, 5, rectPath(3, 3, 4, 4))[e]);
  assert.ok(!ok([], two, L5, 5));
  assert.ok(!ok([], new Array(L5.E).fill(0), L5, 5), '空盘不是回路');
});

test('珍珠：求解器能识别多解题', () => {
  // 4×4 只有一颗角上黑珠：边框和 3×3 小框都可以
  const model = buildModel(4, 4, pearlsAt(4, 4, [[0, 0, BLACK]]));
  assert.equal(countSolutions(model, { limit: 2 }).count, 2);
  assert.equal(logicSolve(model, 3).solved, false);
  // 四角黑珠：唯一
  const corners = buildModel(4, 4, pearlsAt(4, 4, [[0, 0, BLACK], [0, 3, BLACK], [3, 0, BLACK], [3, 3, BLACK]]));
  assert.equal(countSolutions(corners, { limit: 2 }).count, 1);
  assert.equal(logicSolve(corners, 1).solved, true);
});

test('珍珠：推理规则不会排除正解（随机部分赋值）', () => {
  const rng = createRng(11);
  for (let seed = 1; seed <= 6; seed++) {
    const p = rules.generate({ width: 8, height: 8, difficulty: 'hard', seed });
    const model = buildModel(8, 8, p.pearls);
    for (let k = 0; k < 15; k++) {
      const D = new Domains(model.domains());
      const ratio = rng.next() * 0.6;
      p.solution.forEach((v, e) => rng.next() < ratio && D.set(e, v));
      assert.ok(propagate(model, D, 2), `seed ${seed} 推出了矛盾`);
      D.values().forEach((v, e) => v >= 0 && assert.equal(v, p.solution[e], `seed ${seed} 边 ${e}`));
    }
  }
});

test('珍珠：生长的回路是单一回路，候选珍珠都满足条件', () => {
  const rng = createRng(3);
  for (let k = 0; k < 30; k++) {
    const W = rng.int(4, 16);
    const H = rng.int(4, 16);
    const sol = growRegion(W, H, rng, 0.7).edges();
    const pearls = pearlCandidates(W, H, sol);
    assert.ok(isValidLoop(layoutOf(W, H), pearls, sol), `${W}x${H}`);
    assert.ok(coverage(W, H, sol) >= 0.5, `${W}x${H} 覆盖率过低`);
  }
});

test('珍珠：难度分级与覆盖率', () => {
  for (const [d, level] of [['easy', 1], ['medium', 2], ['hard', 3]]) {
    for (let seed = 1; seed <= 5; seed++) {
      const p = rules.generate({ width: 10, height: 10, difficulty: d, seed });
      assert.equal(p.grade.level, level, `${d} seed ${seed}`);
      assert.ok(coverage(10, 10, p.solution) >= 0.5);
      assert.ok(isValidLoop(layoutOf(10, 10), p.pearls, p.solution));
    }
  }
});

test('珍珠：兜底回路在全部允许尺寸下都能生成', () => {
  for (let W = 4; W <= 16; W++) {
    for (let H = 4; H <= 16; H++) {
      const base = fallbackBase(W, H);
      assert.ok(base && base.result.solved, `${W}x${H}`);
      assert.ok(isValidLoop(layoutOf(W, H), base.pearls, base.sol));
    }
  }
});

test('珍珠：违规标记与提示', () => {
  const p = rules.generate({ width: 6, height: 6, difficulty: 'easy', seed: 5 });
  const L = layoutOf(6, 6);
  const black = p.pearls.indexOf(BLACK);
  let s = rules.initialState(p);
  if (black >= 0 && L.ce[black * 4 + 1] >= 0 && L.ce[black * 4 + 3] >= 0) {
    s.e[L.ce[black * 4 + 1]] = 1;
    s.e[L.ce[black * 4 + 3]] = 1;
    assert.ok(findViolations(p, s).cells.has(black), '黑珠直行应标红');
  }
  // 提前闭合的小圈
  s = rules.initialState(p);
  for (const [a, d] of [[0, 1], [0, 2], [1, 2], [6, 1]]) s.e[L.ce[a * 4 + d]] = 1;
  assert.equal(findViolations(p, s).edges.size, 4);
  // 提示会先擦掉错线
  const wrong = rules.findWrong(p, s);
  if (wrong.length) {
    const h = rules.hint(p, s);
    assert.deepEqual(rules.findWrong(p, h.state), []);
  }
  // × 不算错
  const x = { e: p.solution.map((v) => (v ? 0 : 2)) };
  assert.deepEqual(rules.findWrong(p, x), []);
});
