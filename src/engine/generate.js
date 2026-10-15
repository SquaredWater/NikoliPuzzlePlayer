// 各游戏生成器共用的工具。

export const DIFFICULTIES = ['easy', 'medium', 'hard'];
export const DIFFICULTY_LABELS = { easy: '简单', medium: '中等', hard: '困难' };

/** 难度 → 逻辑求解所需推理等级区间（见 logic.js）。 */
export const DIFFICULTY_LEVELS = {
  easy: { minLevel: 1, maxLevel: 1 },
  medium: { minLevel: 2, maxLevel: 2 },
  hard: { minLevel: 3, maxLevel: 3 },
};

export function assertParams(params) {
  if (!DIFFICULTIES.includes(params.difficulty)) throw new Error(`未知难度：${params.difficulty}`);
  if (!Number.isSafeInteger(params.seed) || params.seed <= 0) throw new Error(`种子无效：${params.seed}`);
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
