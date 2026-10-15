// 数墙专项测试：推理规则的正确性（不会排除真解）、多解识别、答案合法性、盘面违规检测。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../src/engine/rng.js';
import { Domains, countSolutions, logicSolve, propagate } from '../src/engine/logic.js';
import rules, { generate, solutionCount, violations } from '../src/games/nurikabe/index.js';
import { buildModel, isValidAnswer } from '../src/games/nurikabe/model.js';
import { latticeAnswer, randomAnswer } from '../src/games/nurikabe/generator.js';

/** 文本盘面 → { W, H, clues, values }：数字为线索，# 为黑，其他为白。 */
function parse(rows) {
  const H = rows.length;
  const W = rows[0].length;
  const clues = [];
  const values = [];
  for (const row of rows) {
    for (const ch of row) {
      clues.push(/[1-9]/.test(ch) ? Number(ch) : 0);
      values.push(ch === '#' ? 1 : 0);
    }
  }
  return { W, H, clues, values };
}

/**
 * 按 rows 设定部分格子（# 黑、o 白、数字为线索、其他未定），
 * 然后只运行第 level 级的第 index 条规则（index 省略则按 level 完整传播）。返回各格状态文字。
 */
function deduce(rows, level, index = -1) {
  const { W, H, clues } = parse(rows);
  const model = buildModel(W, H, clues);
  const D = new Domains(model.domains());
  [...rows.join('')].forEach((ch, i) => {
    if (ch === '#') D.set(i, 1);
    else if (ch === 'o') D.set(i, 0);
  });
  if (index < 0) propagate(model, D, level);
  else model.rules[level - 1][index](D);
  assert.equal(D.bad, false);
  return Array.from({ length: H }, (_, r) =>
    Array.from({ length: W }, (_, c) => clues[r * W + c] || ['x', 'o', '#', '?'][D.dom[r * W + c]]).join(''),
  );
}

test('完整答案校验', () => {
  const ok = parse(['2.#', '###', '1#1']);
  assert.equal(isValidAnswer(ok.W, ok.H, ok.clues, ok.values), true);
  const pool = parse(['1#.', '##.', '##3']);
  assert.equal(isValidAnswer(pool.W, pool.H, pool.clues, pool.values), false, '2×2 黑块');
  const split = parse(['#2.', '1##', '#..']);
  assert.equal(isValidAnswer(split.W, split.H, split.clues, split.values), false, '黑格不连通 / 无数字岛');
  const twoClues = parse(['11#', '###', '#1#']);
  assert.equal(isValidAnswer(twoClues.W, twoClues.H, twoClues.clues, twoClues.values), false, '一岛两个数字');
  const size = parse(['3##', '.#1', '###']);
  assert.equal(isValidAnswer(size.W, size.H, size.clues, size.values), false, '岛大小不符');
});

test('一级规则：涂白会连通两个数字或超出大小的格为黑、唯一出口为白、2×2 补白、够不到为黑', () => {
  // 一级规则依次为 joins, exits, pools, wallExit, unreachable
  // 1 已完成，四周为黑；夹在 1 与 2 之间的格为黑
  assert.deepEqual(deduce(['1?2', '???'], 1, 0), ['1#2', '#??']);
  // 2 只剩右边一个出口
  assert.deepEqual(deduce(['2?', '#?'], 1, 1), ['2o', '#?']);
  assert.deepEqual(deduce(['##?', '#??', '??5'], 1, 2), ['##?', '#o?', '??5']);
  // 黑块只剩一个出口
  assert.deepEqual(deduce(['#?o', 'oo4'], 1, 3), ['##o', 'oo4']);
  // 2 只能再走 1 格
  assert.deepEqual(deduce(['2??', '???', '???'], 1, 4), ['2?#', '?##', '###']);
  // 完整的一级求解
  const p = parse(['1#2.#', '#####', '2.#1#']);
  const res = logicSolve(buildModel(p.W, p.H, p.clues), 1);
  assert.equal(res.solved, true);
  assert.deepEqual(Array.from(res.values), p.values);
});

test('二级规则：割点为黑、与黑格隔绝的格为白、小岛穷举', () => {
  // 二级规则依次为 wall, counting, shapes
  assert.deepEqual(deduce(['#?#', 'o3o'], 2, 0), ['###', 'o3o']);
  assert.deepEqual(deduce(['9oo', 'o?o', 'ooo', '###'], 2, 0), ['9oo', 'ooo', 'ooo', '###']);
  // 3 的形状只有“向右两格”或“向右一格再向下”两种：共同部分为白，共同邻格为黑
  assert.deepEqual(deduce(['#3??', '##??'], 2, 2), ['#3o?', '##?#']);
});

test('多解识别：逻辑求解失败且回溯计数为 2', () => {
  const { W, H, clues } = parse(['.2.']);
  const model = buildModel(W, H, clues);
  assert.equal(logicSolve(model, 3).solved, false);
  assert.equal(countSolutions(model, { limit: 5 }).count, 2);
});

// 规则必须严格成立：从与某个合法答案一致的随机部分状态出发传播，答案的取值永远不能被排除
test('推理规则不会排除真解（随机答案 + 随机部分状态）', () => {
  const rng = createRng(2024);
  const cfg = { sizes: [0, 1, 2, 3, 3, 3, 2, 2, 1, 1], cap: 12, fatten: 0.5 };
  let checked = 0;
  for (let t = 0; t < 60; t++) {
    const W = rng.int(4, 9);
    const H = rng.int(4, 9);
    const A = randomAnswer(W, H, cfg, rng);
    if (!A) continue;
    const clues = A.clues();
    const sol = A.values();
    assert.equal(isValidAnswer(W, H, clues, sol), true);
    const model = buildModel(W, H, clues);
    for (const ratio of [0, 0.2, 0.5]) {
      const D = new Domains(model.domains());
      for (let i = 0; i < W * H; i++) if (rng.next() < ratio) D.set(i, sol[i]);
      const level = rng.next() < 0.3 ? 3 : 2;
      propagate(model, D, level);
      assert.equal(D.bad, false, `出现矛盾 ${W}x${H} t=${t}`);
      for (let i = 0; i < W * H; i++) assert.ok((D.dom[i] >> sol[i]) & 1, `排除了真解 ${W}x${H} t=${t} 格 ${i}`);
      checked++;
    }
  }
  assert.ok(checked > 100);
});

test('生成的题目：答案合法、唯一、在对应等级内可解', () => {
  for (const [width, height] of [[5, 5], [7, 7], [10, 10], [8, 6]]) {
    for (const difficulty of ['easy', 'medium', 'hard']) {
      for (let seed = 11; seed <= 13; seed++) {
        const p = generate({ width, height, difficulty, seed });
        const tag = `${width}x${height} ${difficulty} ${seed}`;
        assert.equal(isValidAnswer(width, height, p.clues, p.solution), true, tag);
        assert.equal(solutionCount(p, { limit: 2 }).count, 1, tag);
        const level = { easy: 1, medium: 2, hard: 3 }[difficulty];
        assert.equal(logicSolve(buildModel(width, height, p.clues), level).solved, true, tag);
        assert.ok(p.grade.level <= level, tag);
      }
    }
  }
});

test('兜底的格点阵题目合法、唯一且一级可解', () => {
  for (const [W, H] of [[4, 4], [5, 4], [15, 15], [4, 15], [7, 6]]) {
    const A = latticeAnswer(W, H);
    const clues = A.clues();
    assert.equal(isValidAnswer(W, H, clues, A.values()), true);
    assert.equal(logicSolve(buildModel(W, H, clues), 1).solved, true);
  }
});

test('最大尺寸 15×15 能在时限内生成', () => {
  const t0 = performance.now();
  const p = generate({ width: 15, height: 15, difficulty: 'hard', seed: 77 });
  assert.ok(performance.now() - t0 < 10000);
  assert.equal(isValidAnswer(15, 15, p.clues, p.solution), true);
});

test('盘面操作：检查只看黑格、提示改正错误、违规检测', () => {
  const p = generate({ width: 5, height: 5, difficulty: 'easy', seed: 3 });
  const N = 25;
  const white = p.solution.findIndex((s, i) => !s && !p.clues[i]);
  const black = p.solution.indexOf(1);
  const state = { c: new Array(N).fill(0) };
  state.c[white] = 2;
  assert.deepEqual(rules.findWrong(p, state), [], '点不算错误');
  state.c[white] = 1;
  state.c[black] = 2;
  assert.deepEqual(rules.findWrong(p, state), [white]);
  const h = rules.hint(p, state);
  assert.deepEqual(rules.findWrong(p, h.state), []);

  // 违规：2×2 黑块、两个数字连在一起、黑格被隔断
  const puzzle = { width: 4, height: 3, clues: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2] };
  const c = [0, 2, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0];
  let v = violations(puzzle, c);
  assert.equal(v.pools.size, 4);
  assert.ok(v.regions.has(0) && v.regions.has(1), '1 的岛多了一格');
  const c2 = [0, 1, 2, 1, 1, 2, 2, 2, 0, 0, 0, 0];
  v = violations(puzzle, c2);
  assert.ok(v.cut.size > 0, '黑格被隔断');
});
