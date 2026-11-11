// 各游戏生成器共用的工具。
import { createRng } from './rng.js';

// 生成器自己实现的三档难度，分别对应一个推理等级（见 logic.js）。
export const BASE_DIFFICULTIES = ['easy', 'medium', 'hard'];
// “专家”不是新的推理等级：它从若干道困难题里挑推理最复杂的一道（见 generatePuzzle）。
export const DIFFICULTIES = [...BASE_DIFFICULTIES, 'expert'];
export const DIFFICULTY_LABELS = { easy: '简单', medium: '中等', hard: '困难', expert: '专家' };

/** 难度 → 逻辑求解所需推理等级区间（见 logic.js）。 */
export const DIFFICULTY_LEVELS = {
  easy: { minLevel: 1, maxLevel: 1 },
  medium: { minLevel: 2, maxLevel: 2 },
  hard: { minLevel: 3, maxLevel: 3 },
};

/** 专家题的候选数：第 1 道就是同种子的困难题，所以专家题不会比同题号的困难题简单。 */
export const EXPERT_CANDIDATES = 4;

export function assertParams(params) {
  if (!BASE_DIFFICULTIES.includes(params.difficulty)) throw new Error(`未知难度：${params.difficulty}`);
  if (!Number.isSafeInteger(params.seed) || params.seed <= 0) throw new Error(`种子无效：${params.seed}`);
}

/**
 * 题目实际用到的推理有多复杂。用于“专家”难度在候选题之间比较：
 *   等级 > 首次试探时的未定量（越大越难，人多半就是卡在这里）> 试探总数 > 试探被推翻数 > 二、一级推理次数。
 */
export function gradeScore(grade) {
  if (!grade) return 0;
  const steps = grade.steps || [];
  return (
    grade.level * 1e10 +
    Math.max(0, grade.stall || 0) * 1e7 +
    (grade.tried || 0) * 1e4 +
    (grade.refuted || 0) * 100 +
    (steps[2] || 0) * 10 +
    (steps[1] || 0)
  );
}

/**
 * 把 logicSolve 的结果转成题目里的 grade。
 * steps 去掉下标 0 的占位；stall 是第一次必须试探时还剩多少变量未定——它比“试探了几轮”更能区分困难题的深度，
 * 因为一轮试探常常就解完整盘（steps[3] 恒为 1）。shikaku 用自己的求解器，没有这几项。
 */
export function gradeOf(result) {
  return {
    level: result.level,
    steps: result.steps.slice(1),
    stall: result.stall === undefined ? -1 : result.stall,
    tried: result.tried || 0,
    refuted: result.refuted || 0,
  };
}

/**
 * 题目实际达到的难度。小盘面上高等级推理常常根本用不上，生成器这时会退而求其次，
 * 返回一道低于标称难度的题；这里把它如实报告出来。
 * 返回 'easy' / 'medium' / 'hard'；达到标称难度时返回 null。
 */
export function actualDifficulty(puzzle) {
  const level = puzzle && puzzle.grade ? puzzle.grade.level : 0;
  const nominal = puzzle.difficulty === 'expert' ? 'hard' : puzzle.difficulty;
  const want = DIFFICULTY_LEVELS[nominal];
  if (!want || !level || level >= want.minLevel) return null;
  return BASE_DIFFICULTIES.find((d) => DIFFICULTY_LEVELS[d].minLevel === level) || null;
}

/**
 * 生成题目的统一入口（Worker 与页面都走这里）。
 * easy / medium / hard 直接交给游戏自己的生成器；expert 生成 EXPERT_CANDIDATES 道困难题，
 * 取 gradeScore 最高的一道。候选种子由题号种子确定，所以同一题号仍然得到同一道题。
 */
export function generatePuzzle(rules, params) {
  if (params.difficulty !== 'expert') return rules.generate(params);
  if (!Number.isSafeInteger(params.seed) || params.seed <= 0) throw new Error(`种子无效：${params.seed}`);
  const rng = createRng(params.seed);
  let best = null;
  for (let i = 0; i < EXPERT_CANDIDATES; i++) {
    const seed = i === 0 ? params.seed : rng.int(1, 999999998);
    const puzzle = rules.generate({ ...params, difficulty: 'hard', seed });
    if (!best || gradeScore(puzzle.grade) > gradeScore(best.grade)) best = puzzle;
  }
  return { ...best, difficulty: 'expert', seed: params.seed };
}

function score(res) {
  return res.level * 1e6 + res.steps[3] * 1000 + res.steps[2];
}

/**
 * 反复调用 make() 生成候选题，返回最符合难度的一道。
 *   make() 返回 { result, ... } 或 null（失败），result 为 logicSolve 的结果且必须 solved。
 *   收集到 want 道等级 ≥ minLevel 的题后停止，返回其中推理最复杂的；
 *   如果一直达不到 minLevel，则返回最接近的一道。
 */
export function pickGraded({ make, minLevel, attempts = 100, want = 1 }) {
  let best = null;
  let qualified = 0;
  for (let i = 0; i < attempts && qualified < want; i++) {
    const found = make();
    if (!found) continue;
    const ok = found.result.level >= minLevel;
    if (ok) qualified++;
    const bestOk = best && best.result.level >= minLevel;
    if (!best || (ok && !bestOk) || (ok === bestOk && score(found.result) > score(best.result))) best = found;
  }
  return best;
}

/**
 * 贪心删除线索：按随机顺序逐组尝试删除，删除后若 isOk(active) 仍为真则保留删除。
 *   count   线索总数；active[i] = 1 表示第 i 条线索保留
 *   groups  可选，按组删除（如对称删除），默认每条线索单独成组
 *   minKeep 至少保留多少条（用于简单难度保留更多线索）
 */
export function minimizeClues(count, rng, isOk, { groups = null, minKeep = 0 } = {}) {
  const active = new Uint8Array(count).fill(1);
  const list = rng.shuffle(groups ? groups.slice() : Array.from({ length: count }, (_, i) => [i]));
  let kept = count;
  for (const group of list) {
    if (kept - group.length < minKeep) continue;
    for (const i of group) active[i] = 0;
    if (isOk(active)) kept -= group.length;
    else for (const i of group) active[i] = 1;
  }
  return active;
}
