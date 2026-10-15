import { test } from 'node:test';
import assert from 'node:assert/strict';
import rules, { buildModel, generate, isValidSolution, makePuzzle, solutionCount, violations } from '../src/games/hitori/index.js';
import { countSolutions, logicSolve } from '../src/engine/logic.js';
import { createRng } from '../src/engine/rng.js';

/** 与推理规则无关的暴力搜索：返回全部合法涂黑方案。 */
function bruteForce(n, numbers) {
  const N = n * n;
  const black = new Array(N).fill(0);
  const found = [];
  const search = (i) => {
    if (i === N) {
      if (isValidSolution(n, numbers, black)) found.push(black.slice());
      return;
    }
    const r = Math.floor(i / n);
    const c = i % n;
    // 白
    let ok = true;
    for (let k = 0; k < c && ok; k++) if (!black[r * n + k] && numbers[r * n + k] === numbers[i]) ok = false;
    for (let k = 0; k < r && ok; k++) if (!black[k * n + c] && numbers[k * n + c] === numbers[i]) ok = false;
    if (ok) {
      black[i] = 0;
      search(i + 1);
    }
    // 黑
    if ((c === 0 || !black[i - 1]) && (r === 0 || !black[i - n])) {
      black[i] = 1;
      search(i + 1);
      black[i] = 0;
    }
  };
  search(0);
  return found;
}

const grid = (rows) => rows.join('').split('').map(Number);

/** 类似真题的随机盘面：打乱的拉丁方，随机挑一些不相邻的格子换成随机数字（常有多解或无解）。 */
function roughGrid(n, rng) {
  const rows = rng.shuffle(Array.from({ length: n }, (_, i) => i));
  const cols = rng.shuffle(Array.from({ length: n }, (_, i) => i));
  const numbers = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) numbers.push(((rows[r] + cols[c]) % n) + 1);
  for (let k = 0; k < n * n * 0.3; k++) numbers[rng.int(0, n * n - 1)] = rng.int(1, n);
  return numbers;
}

test('数壹：推理严格成立（与暴力搜索对照）', () => {
  const rng = createRng(2024);
  let multi = 0;
  let unique = 0;
  for (let t = 0; t < 600; t++) {
    const n = rng.int(4, 6);
    const numbers = t % 2 ? roughGrid(n, rng) : Array.from({ length: n * n }, () => rng.int(1, n));
    const sols = bruteForce(n, numbers);
    const res = logicSolve(buildModel(n, numbers), 3);
    if (sols.length === 0) continue;
    assert.equal(res.contradiction, false, `有解却推出矛盾：${numbers}`);
    for (let i = 0; i < n * n; i++) {
      if (res.values[i] < 0) continue;
      for (const s of sols) assert.equal(res.values[i], s[i], `推理与解 ${s} 不符：${numbers}`);
    }
    if (res.solved) assert.equal(sols.length, 1);
    if (sols.length > 1) multi++;
    else unique++;
    const cnt = countSolutions(buildModel(n, numbers), { limit: 3 });
    assert.equal(cnt.count, Math.min(3, sols.length), `计数不符：${numbers}`);
  }
  assert.ok(multi > 20 && unique > 20, `样本应同时含足够的多解与唯一解（${multi} / ${unique}）`);
});

test('数壹：生成的题与暴力搜索一致，唯一解', () => {
  for (const difficulty of ['easy', 'medium', 'hard']) {
    for (let seed = 1; seed <= 4; seed++) {
      const p = generate({ width: 5, height: 5, difficulty, seed });
      const sols = bruteForce(5, p.numbers);
      assert.equal(sols.length, 1, `${difficulty} ${seed}`);
      assert.deepEqual(sols[0], p.solution);
    }
  }
});

test('数壹：难度分级符合要求', () => {
  for (const [d, level] of [['easy', 1], ['medium', 2], ['hard', 3]]) {
    for (let seed = 1; seed <= 4; seed++) {
      for (const n of [6, 8]) {
        const p = generate({ width: n, height: n, difficulty: d, seed });
        assert.equal(p.grade.level, level, `${d} ${n} ${seed}`);
        assert.ok(isValidSolution(n, p.numbers, p.solution));
      }
    }
  }
});

/** 只用固定模式规则（唯一数字、夹心、相邻成对）推一遍。 */
function patternsOnly(numbers) {
  const model = buildModel(4, numbers);
  return logicSolve({ ...model, rules: [model.rules[0].slice(0, 1)] }, 1).values;
}

test('数壹：一级规则（唯一数字、夹心、相邻成对）', () => {
  const v = patternsOnly(grid(['1213', '2341', '3124', '4432']));
  assert.equal(v[1], 0, '1 2 1 的中间为白');
  assert.equal(v[3], 0, '行列中都唯一的 3 为白');
  const p = patternsOnly(grid(['1121', '2314', '3243', '4432']));
  assert.equal(p[3], 1, '1 1 2 1：成对之外的 1 为黑');
});

test('数壹：多解识别', () => {
  // 随机寻找一个多解题，求解器不能“解出”，计数能发现第二个解
  const rng = createRng(77);
  for (;;) {
    const nums = Array.from({ length: 16 }, () => rng.int(1, 4));
    if (bruteForce(4, nums).length < 2) continue;
    assert.equal(logicSolve(buildModel(4, nums), 3).solved, false);
    assert.equal(solutionCount({ width: 4, numbers: nums }, { limit: 2 }).count, 2);
    break;
  }
});

test('数壹：规则 4 与其它规则的校验', () => {
  const blacks = (...cells) => {
    const b = new Array(16).fill(0);
    for (const i of cells) b[i] = 1;
    return b;
  };
  // 拉丁方：没有任何重复，涂黑任一格都违反规则 4（其余规则都满足）
  const latin = grid(['1234', '2341', '3412', '4123']);
  assert.equal(isValidSolution(4, latin, blacks()), true);
  assert.equal(isValidSolution(4, latin, blacks(0)), false, '多余的黑格');
  // 1 3 3 4 / 3 1 4 2 / 3 4 2 1 / 4 2 1 3
  const g = grid(['1334', '3142', '3421', '4213']);
  assert.equal(isValidSolution(4, g, blacks(2, 8)), true);
  assert.equal(isValidSolution(4, g, blacks(1, 4)), false, '左上角被隔开');
  assert.equal(isValidSolution(4, g, blacks(2)), false, '第一列两个 3 都未涂黑');
  assert.equal(isValidSolution(4, g, blacks(1, 2, 8)), false, '黑格相邻');
});

test('数壹：兜底生成必然得到唯一解', () => {
  const rng = createRng(5);
  for (let t = 0; t < 5; t++) {
    const { numbers, solution, result } = makePuzzle(12, rng, 'easy', true);
    assert.ok(result.solved);
    assert.ok(isValidSolution(12, numbers, solution));
  }
});

test('数壹：提示会清除错误，违规标记', () => {
  const p = generate({ width: 6, height: 6, difficulty: 'medium', seed: 3 });
  const c = new Array(36).fill(0);
  const white = p.solution.indexOf(0);
  c[white] = 1;
  const h = rules.hint(p, { c });
  assert.deepEqual(rules.findWrong(p, h.state), []);
  assert.notEqual(h.state.c[white], 1);

  const v = violations(p, p.solution.map((b) => (b ? 1 : 2)));
  assert.equal(v.black.size + v.circle.size + v.apart.size, 0, '答案不应有违规');
  const bad = new Array(36).fill(0);
  bad[0] = bad[1] = 1;
  assert.ok(violations(p, bad).black.has(0), '相邻黑格');
  const ring = new Array(36).fill(0);
  ring[1] = ring[6] = 1;
  assert.ok(violations(p, ring).apart.has(0), '角落被隔开');
});
