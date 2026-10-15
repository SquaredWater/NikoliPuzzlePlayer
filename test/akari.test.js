// 美术馆专项测试：推理规则、多解识别、与暴力枚举对照验证推理的严格正确性。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Domains, countSolutions, logicSolve } from '../src/engine/logic.js';
import { createRng } from '../src/engine/rng.js';
import rules, { buildModel, clueErrors, generate, lampConflicts, neighbors } from '../src/games/akari/index.js';

// '.' 白格，'#' 无数字黑格，'0'~'4' 数字黑格
const parse = (rows) => ({
  W: rows[0].length,
  H: rows.length,
  grid: rows.join('').split('').map((ch) => (ch === '.' ? -1 : ch === '#' ? 5 : Number(ch))),
});

function bruteForce(model) {
  const sols = [];
  const values = new Int32Array(model.size);
  for (let m = 0; m < 1 << model.size; m++) {
    for (let v = 0; v < model.size; v++) values[v] = (m >> v) & 1;
    if (model.validate(values)) sols.push(Array.from(values));
  }
  return sols;
}

test('validate：照亮、互照、数字', () => {
  const { W, H, grid } = parse(['..#', '.4.', '#..']);
  const model = buildModel(W, H, grid);
  const { varOf } = model.structure;
  const vals = (lamps) => {
    const v = new Int32Array(model.size);
    for (const i of lamps) v[varOf[i]] = 1;
    return v;
  };
  assert.equal(model.validate(vals([1, 3, 5, 7])), true);
  assert.equal(model.validate(vals([1, 3, 5])), false, '数字不满足');
  assert.equal(model.validate(vals([0, 1, 3, 5, 7])), false, '灯泡互照');
  assert.equal(model.validate(vals([])), false, '未照亮');
  assert.deepEqual(bruteForce(model), [Array.from(vals([1, 3, 5, 7]))]);
});

test('多解识别：2×2 全白有两解', () => {
  const { W, H, grid } = parse(['..', '..']);
  const model = buildModel(W, H, grid);
  assert.equal(countSolutions(model, { limit: 5 }).count, 2);
  const res = logicSolve(model, 3);
  assert.equal(res.solved, false);
  assert.equal(res.contradiction, false);
});

test('一级：数字满足 / 唯一光源', () => {
  const { W, H, grid } = parse(['.0.', '...', '.4.']);
  // 3×3 中 4 在边上只有 3 个邻格 → 无解
  assert.equal(logicSolve(buildModel(W, H, grid), 1).contradiction, true);
  // 1 只有一个白邻格 (1,1)：必须放灯，它照亮全部白格
  const p = parse(['#.#', '1..', '#.#']);
  const model = buildModel(p.W, p.H, p.grid);
  const res = logicSolve(model, 1);
  assert.equal(res.solved, true);
  assert.equal(res.level, 1);
  assert.deepEqual(model.structure.cells.filter((_, v) => res.values[v] === 1), [4]);
  assert.equal(bruteForce(model).length, 1);
});

test('二级：数字斜对角的格子必被照到 → 不能放灯', () => {
  const { W, H, grid } = parse(['1..', '...', '...']);
  const model = buildModel(W, H, grid);
  const D = new Domains(model.domains());
  const clueCombos = model.rules[1][0];
  assert.equal(clueCombos(D), true);
  assert.equal(D.value(model.structure.varOf[4]), 0, '(1,1) 不能放灯');
  assert.equal(D.bad, false);
});

test('二级：放灯会使某格失去所有光源 → 不能放灯', () => {
  const { W, H, grid } = parse(['..#', '...', '#..']);
  const model = buildModel(W, H, grid);
  const { varOf } = model.structure;
  const D = new Domains(model.domains());
  D.set(varOf[0], 0); // (0,0) 标点：只能由 (0,1) 或 (1,0) 照亮
  const lookahead = model.rules[1][1];
  assert.equal(lookahead(D), true);
  const fixed = [];
  for (let v = 0; v < model.size; v++) if (D.isFixed(v)) fixed.push(model.structure.cells[v]);
  assert.deepEqual(fixed, [0, 4], '只排除 (1,1)');
  assert.equal(D.value(varOf[4]), 0);
});

test('二级：数字所有组合都矛盾 → 判定无解', () => {
  const { W, H, grid } = parse(['1.', '..']);
  const model = buildModel(W, H, grid);
  const D = new Domains(model.domains());
  model.rules[1][0](D);
  assert.equal(D.bad, true);
});

test('随机小盘面：推理结论与暴力枚举一致（严格正确）', () => {
  const rng = createRng(2024);
  let solvedCount = 0;
  let multi = 0;
  let none = 0;
  for (let t = 0; t < 1500; t++) {
    const W = rng.int(2, 6);
    const H = rng.int(2, 4);
    const N = W * H;
    const grid = Array.from({ length: N }, () => (rng.next() < 0.25 ? 5 : -1));
    // 随机灯泡（不一定照亮全部）推出数字，再随机抹掉 / 篡改部分数字
    const lamps = new Array(N).fill(0);
    for (let i = 0; i < N; i++) if (grid[i] < 0 && rng.next() < 0.3) lamps[i] = 1;
    for (let i = 0; i < N; i++) {
      if (grid[i] < 0) continue;
      const n = neighbors(W, H, i).filter((j) => lamps[j]).length;
      const x = rng.next();
      grid[i] = x < 0.25 ? 5 : x < 0.35 ? rng.int(0, 4) : n;
    }
    const model = buildModel(W, H, grid);
    if (model.size > 14) continue;
    const sols = bruteForce(model);
    for (const level of [1, 2, 3]) {
      const res = logicSolve(model, level);
      if (!sols.length) continue;
      assert.equal(res.contradiction, false, `有解却推出矛盾 ${JSON.stringify(grid)} W=${W}`);
      for (let v = 0; v < model.size; v++) {
        if (res.values[v] < 0) continue;
        for (const s of sols) assert.equal(res.values[v], s[v], `推理结论错误 ${JSON.stringify(grid)} W=${W} 级别 ${level}`);
      }
      if (res.solved) assert.equal(sols.length, 1);
    }
    const res3 = logicSolve(model, 3);
    if (!sols.length) none++;
    else if (sols.length > 1) multi++;
    else if (res3.solved) solvedCount++;
    assert.equal(countSolutions(model, { limit: 2 }).count, Math.min(2, sols.length));
  }
  assert.ok(solvedCount > 50 && multi > 50 && none > 50, `${solvedCount} ${multi} ${none}`);
});

test('生成：难度等级不超过上限，答案与推理一致', () => {
  for (const difficulty of ['easy', 'medium', 'hard']) {
    for (let seed = 1; seed <= 4; seed++) {
      const p = generate({ width: 8, height: 6, difficulty, seed });
      const cap = { easy: 1, medium: 2, hard: 3 }[difficulty];
      assert.ok(p.grade.level <= cap, `${difficulty} ${seed}`);
      const model = buildModel(p.width, p.height, p.grid);
      const res = logicSolve(model, cap);
      assert.equal(res.solved, true);
      model.structure.cells.forEach((cell, v) => assert.equal(res.values[v], p.solution[cell]));
      assert.ok(rules.isSolved(p, rules.solvedState(p)));
    }
  }
});

test('违规检查：互照灯泡与数字', () => {
  const p = { width: 3, height: 3, grid: parse(['...', '.2#', '...']).grid };
  const b = new Array(9).fill(0);
  b[0] = 1;
  b[2] = 1; // 同一行互照
  assert.deepEqual([...lampConflicts(p, b)].sort(), [0, 2]);
  // 2 的邻格中 (0,1)、(1,0) 已被照亮，只剩 (2,1) 可放灯，不够
  assert.deepEqual([...clueErrors(p, b)], [4]);
  // (0,1) 与 (2,1) 同列但被数字黑格隔开，不互照；2 恰好满足
  const ok = new Array(9).fill(0);
  ok[1] = 1;
  ok[7] = 1;
  assert.deepEqual([...lampConflicts(p, ok)], []);
  assert.deepEqual([...clueErrors(p, ok)], []);
});

test('违规检查：数字周围灯泡过多或已无法满足', () => {
  const p = { width: 3, height: 3, grid: parse(['...', '.1#', '...']).grid };
  const b = new Array(9).fill(0);
  b[1] = 1;
  b[3] = 1;
  assert.deepEqual([...clueErrors(p, b)], [4]);
  const c = new Array(9).fill(0);
  c[1] = 2;
  c[3] = 2;
  c[7] = 2;
  assert.deepEqual([...clueErrors(p, c)], [4], '邻格全部标点');
});
