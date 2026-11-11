// 生成速度与难度分布统计：node scripts/bench.js [游戏id] [每组数量]
// 例：node scripts/bench.js sudoku 10；省略游戏 id 则测试全部已实现的游戏。
// low 列：实际推理等级低于标称难度的题数（小盘面上高等级推理用不上时会出现）。
import { existsSync } from 'node:fs';
import { GAMES } from '../src/games/registry.js';
import { actualDifficulty, DIFFICULTIES, generatePuzzle } from '../src/engine/generate.js';

const arg = process.argv[2];
const onlyGame = arg && !/^\d+$/.test(arg) ? arg : null;
const count = Number((onlyGame ? process.argv[3] : arg) || 5);

for (const meta of GAMES) {
  if (onlyGame && meta.id !== onlyGame) continue;
  if (!existsSync(new URL(`../src/games/${meta.id}/index.js`, import.meta.url))) continue;
  const mod = await import(`../src/games/${meta.id}/index.js`);
  for (const [width, height] of meta.sizes) {
    for (const difficulty of DIFFICULTIES) {
      let total = 0;
      let worst = 0;
      const levels = [0, 0, 0, 0];
      let notUnique = 0;
      let low = 0;
      let stall = 0;
      for (let seed = 1; seed <= count; seed++) {
        const t0 = performance.now();
        const p = generatePuzzle(mod.default, { width, height, difficulty, seed });
        const dt = performance.now() - t0;
        total += dt;
        worst = Math.max(worst, dt);
        levels[p.grade ? p.grade.level : 0]++;
        if (actualDifficulty(p)) low++;
        stall += Math.max(0, (p.grade && p.grade.stall) || 0);
        if (mod.solutionCount) {
          const check = mod.solutionCount(p, { limit: 2, nodeLimit: 50000 });
          if (check.count !== 1) notUnique++;
        }
      }
      console.log(
        `${meta.id.padEnd(12)} ${`${width}x${height}`.padEnd(6)} ${difficulty.padEnd(6)} ` +
          `avg ${(total / count).toFixed(0).padStart(5)}ms max ${worst.toFixed(0).padStart(5)}ms ` +
          `levels L1:${levels[1]} L2:${levels[2]} L3:${levels[3]} low:${low} ` +
          `stall ${(stall / count).toFixed(1).padStart(5)} notUnique:${notUnique}`,
      );
    }
  }
}
