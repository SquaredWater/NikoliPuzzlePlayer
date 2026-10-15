import { test } from 'node:test';
import assert from 'node:assert/strict';
import rules, {
  buildModel,
  cycleLink,
  findLinks,
  generate,
  isValidSolution,
  randomPuzzle,
  solutionCount,
  structureOf,
  violations,
} from '../src/games/hashi/index.js';
import { Domains, logicSolve } from '../src/engine/logic.js';
import { createRng } from '../src/engine/rng.js';

/** 由 [r, c, n] 列表构造题目（岛按行优先排序）。 */
function make(width, height, list) {
  const islands = list.map(([r, c, n]) => ({ r, c, n })).sort((x, y) => x.r - y.r || x.c - y.c);
  return { width, height, islands, links: findLinks(width, height, islands) };
}

const linkIndex = (p, [r1, c1], [r2, c2]) =>
  p.links.findIndex(
    ({ a, b }) => p.islands[a].r === r1 && p.islands[a].c === c1 && p.islands[b].r === r2 && p.islands[b].c === c2,
  );

test('数桥：可见岛对与交叉关系', () => {
  // 十字形：左右一对、上下一对，两条 link 交叉
  const p = make(3, 3, [[1, 0, 1], [1, 2, 1], [0, 1, 1], [2, 1, 1]]);
  assert.equal(p.links.length, 2);
  const h = linkIndex(p, [1, 0], [1, 2]);
  const v = linkIndex(p, [0, 1], [2, 1]);
  assert.deepEqual(structureOf(p).crosses[h], [v]);
  // 中间的岛挡住视线
  const q = make(5, 1, [[0, 0, 1], [0, 2, 2], [0, 4, 1]]);
  assert.deepEqual(q.links, [{ a: 0, b: 1 }, { a: 1, b: 2 }]);
});

test('数桥：一级规则（数字上下界）', () => {
  // 角上的 4 只有两个方向 → 两边都是双桥
  const p = make(5, 5, [[0, 0, 4], [0, 2, 2], [2, 0, 2]]);
  const res = logicSolve(buildModel(p), 1);
  assert.equal(res.solved, true);
  assert.deepEqual(Array.from(res.values), [2, 2]);
});

test('数桥：二级规则（1-1 不能相连、封闭分组排除）', () => {
  // 方形四岛 1 1 / 2 2：两个 1 相连会形成孤立的一组；下面两个 2 双桥同理
  const p = make(3, 3, [[0, 0, 1], [0, 2, 1], [2, 0, 2], [2, 2, 2]]);
  assert.equal(logicSolve(buildModel(p), 1).solved, false);
  const res = logicSolve(buildModel(p), 2);
  assert.equal(res.solved, true);
  assert.equal(res.level, 2);
  assert.equal(res.values[linkIndex(p, [0, 0], [0, 2])], 0);
  assert.equal(res.values[linkIndex(p, [2, 0], [2, 2])], 1);

  // 四个 2 围成方形：任何双桥都会形成封闭的两岛组 → 全为单桥
  const q = make(3, 3, [[0, 0, 2], [0, 2, 2], [2, 0, 2], [2, 2, 2]]);
  assert.equal(logicSolve(buildModel(q), 1).solved, false);
  assert.deepEqual(Array.from(logicSolve(buildModel(q), 2).values), [1, 1, 1, 1]);
});

test('数桥：二级规则（必经之桥）', () => {
  // 可能连线图中的割边必须有桥：一字排开的三个岛，两条 link 都是割边
  const line = make(5, 1, [[0, 0, 1], [0, 2, 2], [0, 4, 1]]);
  const bridges = buildModel(line).rules[1][1];
  const D = new Domains(buildModel(line).domains());
  assert.equal(bridges(D), true);
  assert.deepEqual(Array.from(D.dom), [0b110, 0b110]);
  // 方形四岛成环，没有割边
  const ring = make(3, 3, [[0, 0, 2], [0, 2, 2], [2, 0, 2], [2, 2, 2]]);
  const E = new Domains(buildModel(ring).domains());
  assert.equal(buildModel(ring).rules[1][1](E), false);

  // 1 / 3-2 / 2-2：3 与右侧 2 之间若无桥或双桥，都会分成两组 → 全为单桥
  const p = make(5, 3, [[0, 0, 1], [0, 2, 3], [0, 4, 2], [2, 2, 2], [2, 4, 2]]);
  const res = logicSolve(buildModel(p), 2);
  assert.equal(res.solved, true);
  assert.ok(isValidSolution(p, res.values));
  assert.equal(solutionCount(p).count, 1);
});

test('数桥：识别多解题', () => {
  // 四个 3 围成方形：(1,2,2,1) 与 (2,1,1,2) 两种
  const p = make(3, 3, [[0, 0, 3], [0, 2, 3], [2, 0, 3], [2, 2, 3]]);
  assert.equal(solutionCount(p).count, 2);
  assert.equal(logicSolve(buildModel(p)).solved, false);
});

test('数桥：交叉的桥不能同时存在', () => {
  // 十字中心两对岛都必须连（1-1），但会交叉 → 无解
  const p = make(3, 3, [[1, 0, 1], [1, 2, 1], [0, 1, 1], [2, 1, 1]]);
  assert.equal(solutionCount(p).count, 0);
  assert.equal(logicSolve(buildModel(p)).contradiction, true);
});

test('数桥：推理规则对随机（可能多解的）题目严格成立', () => {
  const rng = createRng(11);
  for (let i = 0; i < 150; i++) {
    const w = rng.int(5, 12);
    const h = rng.int(5, 12);
    const { puzzle, sol } = randomPuzzle(w, h, rng.pick(['easy', 'medium', 'hard']), rng);
    assert.ok(isValidSolution(puzzle, sol), '随机答案应合法');
    const res = logicSolve(buildModel(puzzle), 3);
    assert.equal(res.contradiction, false, `第 ${i} 题推出矛盾`);
    sol.forEach((v, l) => assert.ok((res.domains[l] >>> v) & 1, `第 ${i} 题错误排除了答案`));
  }
});

test('数桥：难度分级', () => {
  for (const [d, level] of [['easy', 1], ['medium', 2], ['hard', 3]]) {
    for (let seed = 1; seed <= 4; seed++) {
      const p = generate({ width: 10, height: 10, difficulty: d, seed });
      assert.equal(p.grade.level, level, `${d} seed ${seed}`);
      assert.ok(p.islands.every((s) => s.n >= 1 && s.n <= 8));
    }
  }
});

test('数桥：20×20 也能快速生成唯一解', () => {
  const t0 = performance.now();
  const p = generate({ width: 20, height: 20, difficulty: 'hard', seed: 3 });
  assert.ok(performance.now() - t0 < 10000);
  assert.equal(solutionCount(p, { limit: 2, nodeLimit: 200000 }).count, 1);
});

test('数桥：架桥循环、交叉拒绝、违规与提示纠错', () => {
  const p = make(3, 3, [[1, 0, 1], [1, 2, 1], [0, 1, 1], [2, 1, 1]]);
  let s = { b: [0, 0] };
  s = cycleLink(p, s, 0, 1);
  assert.deepEqual(s.b, [1, 0]);
  assert.equal(cycleLink(p, s, 1, 1), null, '交叉应被拒绝');
  assert.deepEqual(cycleLink(p, s, 0, -1).b, [0, 0]);
  assert.deepEqual(cycleLink(p, cycleLink(p, s, 0, 1), 0, 1).b, [0, 0], '2 之后回到 0');
  // 2 座桥超过数字 1
  const bad = violations(p, { b: [2, 0] });
  assert.ok(bad.islands.has(0) && bad.islands.has(1));

  const q = generate({ width: 7, height: 7, difficulty: 'medium', seed: 5 });
  const wrongLink = q.solution.findIndex((v) => v < 2);
  const state = { b: q.solution.map(() => 0) };
  state.b[wrongLink] = 2;
  assert.deepEqual(rules.findWrong(q, state), [wrongLink]);
  const h = rules.hint(q, state);
  assert.deepEqual(rules.findWrong(q, h.state), []);
  assert.equal(h.state.b[wrongLink], q.solution[wrongLink]);
});
