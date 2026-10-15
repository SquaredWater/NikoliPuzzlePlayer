import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../src/engine/rng.js';
import { countSolutions, Domains, logicSolve, propagate } from '../src/engine/logic.js';
import { buildModel, buildStruct, combos, runSums, SUM } from '../src/games/kakuro/model.js';
import { fill, makeLayout } from '../src/games/kakuro/generator.js';
import rules, { conflicts, generate, setDigit } from '../src/games/kakuro/index.js';

/** 由字符串画出布局：'#' 黑格，'.' 白格。 */
function structFrom(rows) {
  const height = rows.length;
  const width = rows[0].length;
  const white = Uint8Array.from(rows.join(''), (ch) => (ch === '.' ? 1 : 0));
  return buildStruct(width, height, white);
}

const digitsOf = (mask) => [...Array(9).keys()].filter((k) => (mask >> k) & 1).map((k) => k + 1);

test('数和：组合表', () => {
  assert.deepEqual(combos(2, 3).map(digitsOf), [[1, 2]]);
  assert.deepEqual(combos(2, 17).map(digitsOf), [[8, 9]]);
  assert.deepEqual(combos(9, 45).map(digitsOf), [[1, 2, 3, 4, 5, 6, 7, 8, 9]]);
  assert.equal(combos(2, 10).length, 4);
  assert.equal(combos(3, 5).length, 0);
  for (const c of combos(4, 20)) assert.equal(SUM[c], 20);
});

test('数和：一级规则用组合交叉解出小题', () => {
  // 1 2
  // 3 1   横：3, 4；竖：4, 3
  const S = structFrom(['###', '#..', '#..']);
  const values = [0, 1, 2, 0];
  const res = logicSolve(buildModel(S, runSums(S, values)), 1);
  assert.equal(res.solved, true);
  assert.equal(res.level, 1);
  assert.deepEqual(Array.from(res.values), values);
});

test('数和：识别多解题', () => {
  // 1 2 / 2 1 与 2 1 / 1 2 的各段和相同
  const S = structFrom(['###', '#..', '#..']);
  const model = buildModel(S, runSums(S, [0, 1, 1, 0]));
  assert.equal(countSolutions(model, { limit: 5 }).count, 2);
  const res = logicSolve(model, 3);
  assert.equal(res.solved, false);
  assert.equal(res.contradiction, false);
});

test('数和：推理严格成立（随机布局与填数下不会删掉真实答案）', () => {
  const rng = createRng(2024);
  let checked = 0;
  for (let i = 0; i < 40; i++) {
    const w = rng.int(5, 9);
    const h = rng.int(5, 9);
    const white = makeLayout(w, h, rng, { maxLen: 9, density: [0.6, 0.75] });
    if (!white) continue;
    const S = buildStruct(w, h, white);
    const values = fill(S, rng);
    const model = buildModel(S, runSums(S, values));
    for (const level of [1, 2, 3]) {
      const res = logicSolve(model, level);
      assert.equal(res.contradiction, false);
      res.values.forEach((x, v) => x >= 0 && assert.equal(x, values[v], `level ${level}`));
    }
    // 部分随机赋值（与答案一致）后传播，答案仍在候选内
    const D = new Domains(model.domains());
    for (let v = 0; v < S.cells.length; v++) if (rng.next() < 0.3) D.set(v, values[v]);
    assert.equal(propagate(model, D, 2), true);
    values.forEach((x, v) => assert.ok(D.has(v, x)));
    checked++;
  }
  assert.ok(checked > 20);
});

test('数和：单段推理与穷举对照（二级完全一致，一级不删可行数字）', () => {
  const rng = createRng(7);
  for (let t = 0; t < 300; t++) {
    const L = rng.int(2, 6);
    // 只含一段的模型
    const S = { cells: new Array(L).fill(0), runs: [{ vars: [...Array(L).keys()] }] };
    const sum = rng.int(3, 35);
    const doms = Array.from({ length: L }, () => 1 + rng.int(0, 510));
    const model = buildModel(S, [sum]);
    const D = new Domains(Uint32Array.from(doms));
    model.rules[1][0](D);
    // 穷举
    const support = new Array(L).fill(0);
    const rec = (i, used, s, picked) => {
      if (i === L) {
        if (s === sum) picked.forEach((k, j) => (support[j] |= 1 << k));
        return;
      }
      for (let k = 0; k < 9; k++) if ((doms[i] >> k) & 1 && !((used >> k) & 1)) rec(i + 1, used | (1 << k), s + k + 1, [...picked, k]);
    };
    rec(0, 0, 0, []);
    const any = support.some((m) => m);
    if (!any) assert.equal(D.bad, true);
    else for (let i = 0; i < L; i++) assert.equal(D.dom[i], support[i], `t=${t}`);
    // 一级规则较弱，但不能删掉任何可行数字
    const D1 = new Domains(Uint32Array.from(doms));
    model.rules[0][0](D1);
    if (any) for (let i = 0; i < L; i++) assert.equal(D1.dom[i] & support[i], support[i], `t=${t} 一级`);
  }
});

test('数和：布局约束', () => {
  for (const [w, h] of [[6, 6], [8, 8], [10, 10], [12, 12], [7, 11]]) {
    for (const difficulty of ['easy', 'medium', 'hard']) {
      for (let seed = 1; seed <= 3; seed++) {
        const p = generate({ width: w, height: h, difficulty, seed });
        const white = (r, c) => r >= 0 && c >= 0 && r < h && c < w && p.solution[r * w + c] > 0;
        let count = 0;
        let start = -1;
        for (let r = 0; r < h; r++) {
          for (let c = 0; c < w; c++) {
            if (!white(r, c)) continue;
            assert.ok(r > 0 && c > 0, '第 0 行、第 0 列必须是黑格');
            count++;
            if (start < 0) start = r * w + c;
            let hl = 1;
            for (let k = c - 1; white(r, k); k--) hl++;
            for (let k = c + 1; white(r, k); k++) hl++;
            let vl = 1;
            for (let k = r - 1; white(k, c); k--) vl++;
            for (let k = r + 1; white(k, c); k++) vl++;
            assert.ok(hl >= 2 && vl >= 2 && hl <= 9 && vl <= 9, `段长 ${hl}/${vl}`);
            assert.ok(white(h - r, w - c), '180° 对称');
          }
        }
        // 白格连通
        const seen = new Set([start]);
        const stack = [start];
        while (stack.length) {
          const i = stack.pop();
          const r = Math.floor(i / w);
          const c = i % w;
          for (const [rr, cc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
            if (white(rr, cc) && !seen.has(rr * w + cc)) {
              seen.add(rr * w + cc);
              stack.push(rr * w + cc);
            }
          }
        }
        assert.equal(seen.size, count, '白格连通');
        const ratio = count / ((w - 1) * (h - 1));
        assert.ok(ratio >= 0.45 && ratio <= 0.85, `白格比例 ${ratio}`);
      }
    }
  }
});

test('数和：难度等级', () => {
  for (const [difficulty, level] of [['easy', 1], ['medium', 2], ['hard', 3]]) {
    for (let seed = 1; seed <= 5; seed++) {
      const p = generate({ width: 10, height: 10, difficulty, seed });
      assert.equal(p.grade.level, level, `${difficulty} seed ${seed}`);
    }
  }
});

test('数和：尺寸范围边界也能生成', () => {
  for (const [w, h] of [[4, 4], [16, 16], [16, 4], [4, 16]]) {
    const p = generate({ width: w, height: h, difficulty: 'hard', seed: 3 });
    assert.ok(p.solution.filter((d) => d).length >= 4);
    const S = buildStruct(w, h, p.solution.map((d) => (d ? 1 : 0)));
    const sums = S.runs.map((run) => (run.dir ? p.down : p.across)[run.clue]);
    assert.equal(countSolutions(buildModel(S, sums), { limit: 2 }).count, 1);
  }
});

test('数和：违规标记与提示清除错误', () => {
  const p = generate({ width: 6, height: 6, difficulty: 'easy', seed: 4 });
  const S = buildStruct(6, 6, p.solution.map((d) => (d ? 1 : 0)));
  const run = S.runs.find((r) => r.dir === 0);
  const [a, b] = run.vars.map((v) => S.cells[v]);
  let s = rules.initialState(p);
  s = setDigit(p, s, a, 9);
  s = setDigit(p, s, b, 9);
  const bad = conflicts(p, s);
  assert.ok(bad.cells.has(a) && bad.cells.has(b), '段内重复');
  // 黑格不能填
  assert.equal(setDigit(p, s, 0, 5), s);
  // 提示会清除填错的数字
  const wrong = rules.findWrong(p, s);
  assert.ok(wrong.length > 0);
  const h = rules.hint(p, s);
  assert.deepEqual(rules.findWrong(p, h.state), []);
});
