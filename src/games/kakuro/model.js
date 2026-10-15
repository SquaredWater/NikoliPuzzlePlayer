// 数和的盘面结构与推理模型。
// 变量 = 白格，取值 k 表示数字 k+1；约束 = 每一段（横段 / 竖段）数字不重复且和等于提示。
import { lowBit } from '../../engine/logic.js';

export const ALL = 0x1ff;

/** SUM[m]：掩码 m 中各数字之和。 */
export const SUM = new Uint8Array(512);
const COMBOS = [];
const EMPTY = [];
for (let m = 1; m < 512; m++) {
  let s = 0;
  let len = 0;
  for (let k = 0; k < 9; k++) {
    if ((m >> k) & 1) {
      s += k + 1;
      len++;
    }
  }
  SUM[m] = s;
  (COMBOS[len * 46 + s] ||= []).push(m);
}

/** 长度 len、和为 sum 的所有不重复数字组合（掩码列表）。 */
export function combos(len, sum) {
  return COMBOS[len * 46 + sum] || EMPTY;
}

// ---------------------------------------------------------------------------
// 盘面结构
// ---------------------------------------------------------------------------

/**
 * 由黑白布局（white[i] = 1 为白格）得到结构：
 *   cells   变量 → 格子下标；varOf 格子 → 变量（黑格 -1）
 *   runs    [{ clue: 提示所在黑格, dir: 0 横 / 1 竖, vars }]
 *   runOf   变量 → [横段, 竖段]
 */
export function buildStruct(width, height, white) {
  const N = width * height;
  const varOf = new Int32Array(N).fill(-1);
  const cells = [];
  for (let i = 0; i < N; i++) if (white[i]) varOf[i] = cells.push(i) - 1;
  const runs = [];
  const runOf = cells.map(() => [-1, -1]);
  for (let i = 0; i < N; i++) {
    if (white[i]) continue;
    const r = Math.floor(i / width);
    const c = i % width;
    for (const dir of [0, 1]) {
      const step = dir ? width : 1;
      const vars = [];
      for (let j = i + step, k = dir ? r + 1 : c + 1; k < (dir ? height : width) && white[j]; j += step, k++) {
        vars.push(varOf[j]);
      }
      if (!vars.length) continue;
      for (const v of vars) runOf[v][dir] = runs.length;
      runs.push({ clue: i, dir, vars });
    }
  }
  return { width, height, white, cells, varOf, runs, runOf };
}

/** 由答案（按变量的取值 0..8）计算各段的和。 */
export function runSums(S, values) {
  return S.runs.map((run) => run.vars.reduce((s, v) => s + values[v] + 1, 0));
}

// ---------------------------------------------------------------------------
// 推理模型
// ---------------------------------------------------------------------------

const tri = (k) => (k * (k + 1)) / 2; // 最小的 k 个数字之和
const top = (k) => (k * (19 - k)) / 2; // 最大的 k 个数字之和

// 二级规则的工作区（所有模型共用，单线程安全）
const seen = new Int32Array(10 * 512);
const good = new Int32Array(10 * 512);
let epoch = 0;
const layers = Array.from({ length: 10 }, () => []);

// 规则对一段的推理只取决于段内各格的候选：与上次处理同一个 D 时完全相同则跳过（纯加速）
function unchanged(memo, D, vars) {
  if (memo.owner === D) {
    let same = true;
    for (let i = 0; i < vars.length && same; i++) same = memo.snap[i] === D.dom[vars[i]];
    if (same) return true;
  }
  memo.owner = D;
  for (let i = 0; i < vars.length; i++) memo.snap[i] = D.dom[vars[i]];
  return false;
}

export function buildModel(S, sums) {
  const runs = S.runs.map((run, k) => ({
    vars: run.vars,
    sum: sums[k],
    combos: combos(run.vars.length, sums[k]),
    memo1: { owner: null, snap: new Uint32Array(run.vars.length) },
    memo2: { owner: null, snap: new Uint32Array(run.vars.length) },
  }));

  // 一级：段内已确定数字从其余格排除；只保留出现在可行组合中的数字；
  // 所有可行组合都含的数字若只剩一个位置，则填在那里。
  // 可行组合：包含全部已确定数字，每个数字都有格子可放，每个格子都有数字可取。
  const comboRule = (D) => {
    let changed = false;
    for (const { vars, combos: list, memo1 } of runs) {
      if (unchanged(memo1, D, vars)) continue;
      let fixed = 0;
      let union = 0;
      for (const v of vars) {
        const d = D.dom[v];
        union |= d;
        if ((d & (d - 1)) === 0) {
          if (fixed & d) {
            D.bad = true;
            return true;
          }
          fixed |= d;
        }
      }
      let allowed = 0;
      let required = ALL;
      for (const c of list) {
        if ((c & fixed) !== fixed || c & ~union) continue;
        let ok = true;
        for (const v of vars) {
          if (!(D.dom[v] & c)) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        allowed |= c;
        required &= c;
      }
      if (!allowed) {
        D.bad = true;
        return true;
      }
      for (const v of vars) {
        const d = D.dom[v];
        const mask = (d & (d - 1)) === 0 ? allowed : allowed & ~fixed;
        if (D.restrict(v, mask)) changed = true;
      }
      if (D.bad) return true;
      for (let need = required & ~fixed; need; need &= need - 1) {
        const bit = need & -need;
        let where = -1;
        let count = 0;
        for (const v of vars) {
          if (D.dom[v] & bit) {
            where = v;
            if (++count > 1) break;
          }
        }
        if (count === 0) {
          D.bad = true;
          return true;
        }
        if (count === 1 && D.dom[where] !== bit) {
          D.set(where, lowBit(bit));
          changed = true;
        }
      }
    }
    return changed;
  };

  // 二级：整段排列检验——某格的某数字，只有存在一种与各格候选相容、
  // 不重复且和正确的整段填法时才保留（按“已用数字集合”做前向/后向可达性）。
  const permRule = (D) => {
    for (const { vars, sum, memo2 } of runs) {
      if (unchanged(memo2, D, vars)) continue;
      const L = vars.length;
      let open = false;
      for (const v of vars) if (D.dom[v] & (D.dom[v] - 1)) open = true;
      if (!open) continue;
      const fwd = ++epoch;
      layers[0].length = 0;
      layers[0].push(0);
      for (let i = 0; i < L; i++) {
        const next = layers[i + 1];
        next.length = 0;
        const rest = L - i - 1;
        const dom = D.dom[vars[i]];
        for (const m of layers[i]) {
          for (let d = dom & ~m; d; d &= d - 1) {
            const nm = m | (d & -d);
            const s = SUM[nm];
            if (s + tri(rest) > sum || s + top(rest) < sum) continue;
            const key = (i + 1) * 512 + nm;
            if (seen[key] === fwd) continue;
            seen[key] = fwd;
            next.push(nm);
          }
        }
      }
      const back = ++epoch;
      for (const m of layers[L]) if (SUM[m] === sum) good[L * 512 + m] = back;
      const support = new Array(L).fill(0);
      for (let i = L - 1; i >= 0; i--) {
        const dom = D.dom[vars[i]];
        for (const m of layers[i]) {
          let ok = false;
          for (let d = dom & ~m; d; d &= d - 1) {
            const bit = d & -d;
            if (good[(i + 1) * 512 + (m | bit)] === back) {
              support[i] |= bit;
              ok = true;
            }
          }
          if (ok) good[i * 512 + m] = back;
        }
      }
      let changed = false;
      for (let i = 0; i < L; i++) if (D.restrict(vars[i], support[i])) changed = true;
      if (changed || D.bad) return true;
    }
    return false;
  };

  return {
    size: S.cells.length,
    domains() {
      return new Uint32Array(S.cells.length).fill(ALL);
    },
    rules: [[comboRule], [permRule]],
    validate(values) {
      for (const { vars, sum } of runs) {
        let seenMask = 0;
        let s = 0;
        for (const v of vars) {
          const bit = 1 << values[v];
          if (seenMask & bit) return false;
          seenMask |= bit;
          s += values[v] + 1;
        }
        if (s !== sum) return false;
      }
      return true;
    },
  };
}
