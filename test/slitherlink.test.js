import { test } from 'node:test';
import assert from 'node:assert/strict';
import rules, { generate, randomRegion, solutionCount, violations } from '../src/games/slitherlink/index.js';
import { boundaryEdges, buildModel, cluesFromEdges, geometry, isValidLoop } from '../src/games/slitherlink/model.js';
import { countSolutions, Domains, logicSolve } from '../src/engine/logic.js';
import { createRng } from '../src/engine/rng.js';

const none = (n) => new Array(n).fill(-1);

/** 用指定的二级规则在给定初始线段上跑一次。 */
function runRule(W, H, clues, lines, level, index) {
  const model = buildModel(W, H, clues);
  const D = new Domains(model.domains());
  for (const e of lines) D.set(e, 1);
  model.rules[level - 1][index](D);
  return D;
}

test('数回：随机区域的边界是一条单回路，区域约占 40%~60%', () => {
  const rng = createRng(3);
  for (let i = 0; i < 200; i++) {
    const W = rng.int(3, 20);
    const H = rng.int(3, 20);
    const G = geometry(W, H);
    const inside = randomRegion(W, H, rng);
    const lines = boundaryEdges(G, inside);
    assert.ok(isValidLoop(G, cluesFromEdges(G, lines), lines), `${W}x${H} 不是单回路`);
    const ratio = inside.reduce((a, b) => a + b, 0) / (W * H);
    assert.ok(ratio >= 0.3 && ratio <= 0.65, `${W}x${H} 区域比例 ${ratio}`);
  }
});

test('数回：角上的 3 两边有线，角上的 1 两边无线', () => {
  const clues = none(9);
  clues[0] = 3;
  clues[8] = 1;
  const G = geometry(3, 3);
  const D = runRule(3, 3, clues, [], 2, 1);
  assert.equal(D.value(G.hEdge(0, 0)), 1);
  assert.equal(D.value(G.vEdge(0, 0)), 1);
  assert.equal(D.value(G.hEdge(3, 2)), 0);
  assert.equal(D.value(G.vEdge(2, 3)), 0);
});

test('数回：相邻与对角的两个 3', () => {
  const G = geometry(4, 4);
  const clues = none(16);
  clues[5] = 3;
  clues[6] = 3;
  clues[15] = 2;
  const D = runRule(4, 4, clues, [], 2, 0);
  for (const e of [G.vEdge(1, 1), G.vEdge(1, 2), G.vEdge(1, 3)]) assert.equal(D.value(e), 1);
  for (const e of [G.vEdge(0, 2), G.vEdge(2, 2)]) assert.equal(D.value(e), 0);

  const diag = none(16);
  diag[5] = 3;
  diag[10] = 3;
  const D2 = runRule(4, 4, diag, [], 2, 0);
  for (const e of [G.hEdge(1, 1), G.vEdge(1, 1), G.hEdge(3, 2), G.vEdge(2, 3)]) assert.equal(D2.value(e), 1);
});

test('数回：不能提前闭合小回路（除非它就是完整答案）', () => {
  const G = geometry(3, 3);
  const u = [G.hEdge(0, 0), G.vEdge(0, 0), G.hEdge(1, 0)];
  const closing = G.vEdge(0, 1);
  const clues = none(9);
  clues[8] = 3;
  assert.equal(runRule(3, 3, clues, u, 2, 2).value(closing), 0);
  const ok = none(9);
  ok[1] = 1;
  assert.equal(runRule(3, 3, ok, u, 2, 2).value(closing), -1, '闭合后正好满足全部数字，不能排除');
  // 已闭合的回路之外还有线 → 矛盾
  const model = buildModel(3, 3, none(9));
  const D = new Domains(model.domains());
  for (const e of [...u, closing, G.hEdge(3, 2)]) D.set(e, 1);
  model.rules[0][1](D);
  assert.equal(D.bad, true);
});

test('数回：推理规则严格成立（与 4×4 全部回路的暴力枚举对照）', () => {
  const W = 4;
  const H = 4;
  const G = geometry(W, H);
  const loops = [];
  for (let m = 1; m < 1 << 16; m++) {
    const inside = Array.from({ length: 16 }, (_, i) => (m >> i) & 1);
    const lines = boundaryEdges(G, inside);
    if (isValidLoop(G, none(16), lines)) loops.push(lines);
  }
  const rng = createRng(17);
  let unique = 0;
  let multi = 0;
  for (let t = 0; t < 300; t++) {
    const answer = loops[rng.int(0, loops.length - 1)];
    const full = cluesFromEdges(G, answer);
    const keep = rng.next() * 0.7 + 0.1;
    const clues = full.map((v) => (rng.next() < keep ? v : -1));
    const sols = loops.filter((l) => isValidLoop(G, clues, l));
    const res = logicSolve(buildModel(W, H, clues), 3);
    assert.equal(res.contradiction, false);
    for (const l of sols) {
      for (let e = 0; e < G.E; e++) if (res.values[e] >= 0) assert.equal(res.values[e], l[e], `规则排除了真解 #${t}`);
    }
    if (sols.length > 1) {
      multi++;
      assert.equal(res.solved, false);
      assert.equal(countSolutions(buildModel(W, H, clues), { limit: 2 }).count, 2);
    } else {
      unique++;
      assert.equal(countSolutions(buildModel(W, H, clues), { limit: 2 }).count, 1);
    }
  }
  assert.ok(unique > 10 && multi > 10, `样本分布 ${unique}/${multi}`);
});

test('数回：难度分级符合要求，且唯一解', () => {
  for (const [d, level] of [['easy', 1], ['medium', 2], ['hard', 3]]) {
    for (let seed = 1; seed <= 4; seed++) {
      const p = generate({ width: 7, height: 7, difficulty: d, seed });
      assert.equal(p.grade.level, level, `${d} seed ${seed}`);
      assert.equal(solutionCount(p).count, 1);
      assert.ok(isValidLoop(geometry(7, 7), p.clues, p.solution));
    }
  }
});

test('数回：大尺寸能在合理时间内生成', () => {
  const t0 = performance.now();
  const p = generate({ width: 20, height: 20, difficulty: 'hard', seed: 99 });
  assert.ok(performance.now() - t0 < 10000);
  assert.ok(isValidLoop(geometry(20, 20), p.clues, p.solution));
});

test('数回：检查只看画错的线，提示会先去掉错线', () => {
  const p = generate({ width: 5, height: 5, difficulty: 'easy', seed: 2 });
  const wrongEdge = p.solution.findIndex((s) => !s);
  const rightEdge = p.solution.findIndex((s) => s);
  const e = new Array(p.solution.length).fill(0);
  e[wrongEdge] = 1;
  e[rightEdge] = 2;
  assert.deepEqual(rules.findWrong(p, { e }), [wrongEdge]);
  const h = rules.hint(p, { e });
  assert.deepEqual(rules.findWrong(p, h.state), []);
  assert.equal(h.state.e[wrongEdge], 2);
});

test('数回：违规标记（分岔、提前闭合、数字超出）', () => {
  const p = { width: 3, height: 3, clues: none(9) };
  p.clues[4] = 0;
  const G = geometry(3, 3);
  const e = new Array(G.E).fill(0);
  for (const x of [G.hEdge(0, 0), G.vEdge(0, 0), G.hEdge(1, 0), G.vEdge(0, 1)]) e[x] = 1;
  e[G.hEdge(0, 1)] = 1;
  e[G.hEdge(2, 1)] = 1;
  const v = violations(p, e);
  assert.ok(v.verts.has(G.vid(0, 1)), '度数为 3 的顶点');
  assert.ok(v.cells.has(4), '0 旁边有线');
  assert.ok(v.edges.has(G.vEdge(0, 0)), '闭合回路之外还有线');
});
