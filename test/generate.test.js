// 生成入口与难度：专家难度走通用包装；题目与题号一致；小盘面时如实报告实际难度。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GAMES, formatCode, parseCode } from '../src/games/registry.js';
import { actualDifficulty, DIFFICULTIES, EXPERT_CANDIDATES, generatePuzzle, gradeScore } from '../src/engine/generate.js';

const meta = GAMES.find((g) => g.id === 'sudoku');
const rules = (await import('../src/games/sudoku/index.js')).default;

test('难度列表含专家，题号用 X 表示', () => {
  assert.deepEqual(DIFFICULTIES, ['easy', 'medium', 'hard', 'expert']);
  const code = formatCode('sudoku', { width: 9, height: 9, difficulty: 'expert', seed: 42 });
  assert.equal(code, 'SD-9x9-X-42');
  assert.deepEqual(parseCode(code), { game: 'sudoku', width: 9, height: 9, difficulty: 'expert', seed: 42 });
});

test('专家题：可复现，且不弱于同题号的困难题', () => {
  const params = { width: 9, height: 9, difficulty: 'expert', seed: 2024 };
  const a = generatePuzzle(rules, params);
  const b = generatePuzzle(rules, params);
  assert.deepEqual(a, b);
  assert.equal(a.difficulty, 'expert');
  assert.equal(a.seed, 2024);
  const hard = generatePuzzle(rules, { ...params, difficulty: 'hard' });
  assert.ok(gradeScore(a.grade) >= gradeScore(hard.grade), '专家题不应比同种子的困难题简单');
});

test('专家题：唯一解', async () => {
  const mod = await import('../src/games/sudoku/index.js');
  const p = generatePuzzle(rules, { width: 6, height: 6, difficulty: 'expert', seed: 7 });
  const res = mod.solutionCount(p, { limit: 2, nodeLimit: 200000 });
  assert.equal(res.aborted, false);
  assert.equal(res.count, 1);
});

test('专家候选数：第 1 道就是同种子的困难题', () => {
  assert.equal(EXPERT_CANDIDATES, 4);
});

test('实际难度：小盘面高等级推理用不上时如实报告', () => {
  // 4×4 数独无论标称什么难度，最多只能用到 1 级推理
  for (const difficulty of ['medium', 'hard', 'expert']) {
    const p = generatePuzzle(rules, { width: 4, height: 4, difficulty, seed: 3 });
    assert.equal(p.grade.level, 1, difficulty);
    assert.equal(actualDifficulty(p), 'easy', difficulty);
  }
  // 9×9 困难题确实需要试探，没有回落
  const hard = generatePuzzle(rules, { width: 9, height: 9, difficulty: 'hard', seed: 11 });
  assert.equal(hard.grade.level, 3);
  assert.equal(actualDifficulty(hard), null);
  // 简单题不会被误判
  const easy = generatePuzzle(rules, { width: 9, height: 9, difficulty: 'easy', seed: 5 });
  assert.equal(actualDifficulty(easy), null);
  assert.equal(actualDifficulty({ difficulty: 'hard', grade: null }), null);
});

test('gradeScore：等级优先，其次首次试探时的未定量', () => {
  assert.ok(gradeScore({ level: 3, stall: 5, steps: [0, 0, 0] }) > gradeScore({ level: 2, stall: 99, steps: [0, 0, 0] }));
  assert.ok(gradeScore({ level: 3, stall: 40 }) > gradeScore({ level: 3, stall: 39 }));
  assert.equal(gradeScore(null), 0);
});

test('Domains.aux 随克隆复制，各副本互不影响', async () => {
  const { Domains } = await import('../src/engine/logic.js');
  const D = new Domains(new Uint32Array([3, 7]));
  D.aux = new Uint8Array([0, 0]);
  D.restrict(0, 1);
  D.aux[0] = 1;
  const T = D.clone();
  T.restrict(1, 1);
  T.aux[1] = 1;
  assert.deepEqual([...D.aux], [1, 0], '原副本的 aux 不应被改动');
  assert.deepEqual([...T.aux], [1, 1]);
  assert.equal(D.dom[1], 7, '原副本的候选不应被改动');
  assert.equal(T.dom[1], 1);
});
