// 对注册表中每个已实现的游戏做通用检查：
//   生成可复现、答案唯一、答案状态判定为完成、提示能一步步走到完成、检查功能、会话撤销/重做。
// 只测一个游戏：GAME=sudoku node --test test/games.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { GAMES, formatCode, parseCode } from '../src/games/registry.js';
import { Session } from '../src/engine/session.js';

const only = process.env.GAME;
const games = GAMES.filter(
  (g) => existsSync(new URL(`../src/games/${g.id}/index.js`, import.meta.url)) && (!only || only === g.id),
);

for (const meta of games) {
  const mod = await import(`../src/games/${meta.id}/index.js`);
  const rules = mod.default;
  const sizes = meta.sizes.slice(0, 2);

  for (const difficulty of ['easy', 'medium', 'hard']) {
    test(`${meta.name}（${meta.id}）${difficulty}：唯一解、提示、检查`, () => {
      for (const [width, height] of sizes) {
        for (let seed = 1; seed <= 3; seed++) {
          const params = { width, height, difficulty, seed };
          const puzzle = rules.generate(params);
          const tag = formatCode(meta.id, params);
          assert.equal(puzzle.game, meta.id, tag);
          assert.equal(puzzle.width, width, tag);
          assert.equal(puzzle.height, height, tag);
          assert.equal(puzzle.difficulty, difficulty, tag);
          assert.equal(puzzle.seed, seed, tag);
          JSON.parse(JSON.stringify(puzzle));

          if (mod.solutionCount) {
            const res = mod.solutionCount(puzzle, { limit: 2, nodeLimit: 200000 });
            assert.equal(res.aborted, false, `${tag} 唯一性校验超时`);
            assert.equal(res.count, 1, `${tag} 解不唯一（${res.count}）`);
          }

          const empty = rules.initialState(puzzle);
          assert.equal(rules.isSolved(puzzle, empty), false, `${tag} 空盘不应判定为完成`);
          assert.deepEqual(rules.findWrong(puzzle, empty), [], `${tag} 空盘不应有错误`);

          const solved = rules.solvedState(puzzle);
          assert.equal(rules.isSolved(puzzle, solved), true, `${tag} 答案状态应判定为完成`);
          assert.deepEqual(rules.findWrong(puzzle, solved), [], `${tag} 答案状态不应有错误`);

          let state = empty;
          let steps = 0;
          while (!rules.isSolved(puzzle, state)) {
            const h = rules.hint(puzzle, state);
            assert.ok(h, `${tag} 未完成时提示不应为空（第 ${steps} 步）`);
            assert.notDeepEqual(h.state, state, `${tag} 提示应改变盘面`);
            assert.deepEqual(rules.findWrong(puzzle, h.state), [], `${tag} 提示不应引入错误`);
            state = JSON.parse(JSON.stringify(h.state));
            assert.ok(++steps < 5000, `${tag} 提示步数过多`);
          }
          assert.equal(rules.hint(puzzle, state), null, `${tag} 完成后不应再有提示`);
        }
      }
    });
  }

  test(`${meta.name}：相同参数生成相同题目`, () => {
    const [width, height] = meta.defaultSize;
    const a = rules.generate({ width, height, difficulty: 'hard', seed: 4242 });
    const b = rules.generate({ width, height, difficulty: 'hard', seed: 4242 });
    assert.deepEqual(a, b);
  });

  test(`${meta.name}：会话撤销 / 重做 / 重置 / 显示答案`, () => {
    const [width, height] = meta.sizes[0];
    const puzzle = rules.generate({ width, height, difficulty: 'easy', seed: 9 });
    const s = new Session(rules, puzzle);
    assert.ok(s.hint());
    const afterOne = JSON.stringify(s.state);
    assert.ok(s.hint());
    assert.equal(s.hintsUsed, 2);
    assert.ok(s.undo());
    assert.equal(JSON.stringify(s.state), afterOne);
    assert.ok(s.redo());
    assert.ok(s.reset());
    assert.deepEqual(s.state, rules.initialState(puzzle));
    assert.ok(s.undo(), '重置可撤销');
    s.reveal();
    assert.equal(s.solved, true);
    assert.equal(s.revealed, true);
    const restored = new Session(rules, JSON.parse(JSON.stringify(puzzle)), JSON.parse(JSON.stringify(s.toJSON())));
    assert.equal(restored.solved, true);
    assert.ok(restored.undo());
    assert.equal(restored.solved, false);
  });
}

test('题号编码与解析', () => {
  assert.equal(formatCode('sudoku', { width: 9, height: 9, difficulty: 'medium', seed: 77 }), 'SD-9x9-M-77');
  assert.deepEqual(parseCode(' sd-9x9-h-77 '), { game: 'sudoku', width: 9, height: 9, difficulty: 'hard', seed: 77 });
  assert.deepEqual(parseCode('10x10-E-5', 'shikaku'), { game: 'shikaku', width: 10, height: 10, difficulty: 'easy', seed: 5 });
  assert.ok(parseCode('SD-8x8-M-1').error, '数独只允许预设尺寸');
  assert.ok(parseCode('HT-6x7-M-1').error, '数壹必须是正方形');
  assert.ok(parseCode('XX-5x5-M-1').error);
  assert.ok(parseCode('10x10-M-1').error, '缺少前缀且无默认游戏');
});
