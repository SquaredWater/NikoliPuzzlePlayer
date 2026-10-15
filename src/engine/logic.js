// 通用逻辑推理引擎：把谜题建模为“变量 + 候选值集合（位掩码）”，
// 由各游戏提供推理规则，引擎负责传播、试探、计数与难度统计。
//
// 模型（model）约定：
//   size        变量个数
//   domains()   返回 Uint32Array，每个变量的初始候选（第 k 位为 1 表示可取值 k）
//   rules       [[一级规则...], [二级规则...]]，规则签名 rule(D) => 是否有变化
//               规则只能做“严格成立”的推理；发现矛盾时设置 D.bad = true
//   check(D)?   可选：对部分赋值做全局矛盾检查，返回 false 表示矛盾
//   validate(values) 对完整赋值做最终校验（连通性、单一回路等全局规则）
//
// 难度等级：1、2 为规则等级；TRIAL_LEVEL(=3) 为“试探”：
//   假设某变量取某值，仅用 1~2 级规则推出矛盾，则排除该值。
// 只要逻辑求解成功（所有变量确定且通过 validate），答案必然唯一。

export const TRIAL_LEVEL = 3;

export function popcount(x) {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (Math.imul((x + (x >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24);
}

/** 最低位 1 的下标（x 不能为 0）。 */
export function lowBit(x) {
  return 31 - Math.clz32(x & -x);
}

export function isSingle(x) {
  return x !== 0 && (x & (x - 1)) === 0;
}

/** 候选集合状态。dom[v] 是变量 v 的候选位掩码。 */
export class Domains {
  constructor(dom, trackOrder = false) {
    this.dom = dom;
    this.bad = false;
    this.order = trackOrder ? [] : null;
  }

  clone() {
    const d = new Domains(this.dom.slice());
    d.bad = this.bad;
    return d;
  }

  has(v, val) {
    return ((this.dom[v] >>> val) & 1) === 1;
  }

  isFixed(v) {
    return isSingle(this.dom[v]);
  }

  /** 已确定则返回取值，否则返回 -1。 */
  value(v) {
    const d = this.dom[v];
    return isSingle(d) ? lowBit(d) : -1;
  }

  /** 把候选收窄到 mask 之内，返回是否有变化。 */
  restrict(v, mask) {
    const d = this.dom[v];
    const nd = (d & mask) >>> 0;
    if (nd === d) return false;
    this.dom[v] = nd;
    if (nd === 0) this.bad = true;
    else if (this.order && isSingle(nd)) this.order.push(v);
    return true;
  }

  remove(v, val) {
    return this.restrict(v, ~(1 << val));
  }

  set(v, val) {
    return this.restrict(v, 1 << val);
  }

  allFixed() {
    for (let v = 0; v < this.dom.length; v++) if (!isSingle(this.dom[v])) return false;
    return true;
  }

  values() {
    return Int32Array.from(this.dom, (d) => (isSingle(d) ? lowBit(d) : -1));
  }
}

function ruleLevels(model) {
  return model.rules.length;
}

/** 反复应用不超过 maxLevel 的规则直到无法推进。返回是否无矛盾。 */
export function propagate(model, D, maxLevel, stats = null) {
  const levels = Math.min(maxLevel, ruleLevels(model));
  outer: while (!D.bad) {
    for (let lv = 1; lv <= levels; lv++) {
      for (const rule of model.rules[lv - 1]) {
        const changed = rule(D);
        if (D.bad) break outer;
        if (changed) {
          if (stats) note(stats, lv);
          continue outer;
        }
      }
    }
    if (maxLevel >= TRIAL_LEVEL && trial(model, D)) {
      if (stats) note(stats, TRIAL_LEVEL);
      continue;
    }
    break;
  }
  if (!D.bad && model.check && !model.check(D)) D.bad = true;
  if (!D.bad && D.allFixed() && !model.validate(D.values())) D.bad = true;
  return !D.bad;
}

function note(stats, level) {
  stats.steps[level]++;
  if (level > stats.level) stats.level = level;
}

function trial(model, D) {
  const vars = [];
  for (let v = 0; v < model.size; v++) if (!D.isFixed(v)) vars.push(v);
  vars.sort((a, b) => popcount(D.dom[a]) - popcount(D.dom[b]));
  let changed = false;
  for (const v of vars) {
    let d = D.dom[v];
    while (d) {
      const val = lowBit(d);
      d &= d - 1;
      if (!D.has(v, val) || D.isFixed(v)) continue;
      const T = D.clone();
      T.set(v, val);
      propagate(model, T, TRIAL_LEVEL - 1);
      if (T.bad) {
        D.remove(v, val);
        changed = true;
        if (D.bad) return true;
      }
    }
  }
  return changed;
}

/**
 * 用不超过 maxLevel 的推理求解。
 * 返回 { solved, contradiction, level, steps, values, order, domains }
 *   level：实际用到的最高等级；steps[k]：k 级推理生效的次数；
 *   order：变量被确定的先后顺序（用于“提示”）；values：确定的变量取值，未确定为 -1。
 */
export function logicSolve(model, maxLevel = TRIAL_LEVEL) {
  const D = new Domains(model.domains(), true);
  for (let v = 0; v < model.size; v++) if (D.isFixed(v)) D.order.push(v);
  if (D.dom.some((d) => d === 0)) D.bad = true;
  const stats = { level: 0, steps: [0, 0, 0, 0] };
  const ok = !D.bad && propagate(model, D, maxLevel, stats);
  return {
    solved: ok && D.allFixed(),
    contradiction: !ok,
    level: stats.level,
    steps: stats.steps,
    values: D.values(),
    order: D.order,
    domains: D.dom,
  };
}

/**
 * 回溯计数（找到 limit 个解即停止），用于测试中确认唯一解。
 * 每个节点用 level 级规则传播，再对候选最少的变量分支。
 */
export function countSolutions(model, { limit = 2, nodeLimit = 200000, level = 2 } = {}) {
  const result = { count: 0, aborted: false, solution: null };
  let nodes = 0;
  const search = (D) => {
    if (result.aborted || result.count >= limit) return;
    if (++nodes > nodeLimit) {
      result.aborted = true;
      return;
    }
    if (!propagate(model, D, level)) return;
    let best = -1;
    let bestSize = Infinity;
    for (let v = 0; v < model.size; v++) {
      const n = popcount(D.dom[v]);
      if (n > 1 && n < bestSize) {
        best = v;
        bestSize = n;
        if (n === 2) break;
      }
    }
    if (best < 0) {
      result.count++;
      if (!result.solution) result.solution = Array.from(D.values());
      return;
    }
    let d = D.dom[best];
    while (d) {
      const val = lowBit(d);
      d &= d - 1;
      const T = D.clone();
      T.set(best, val);
      search(T);
      if (result.aborted || result.count >= limit) return;
    }
  };
  const D = new Domains(model.domains());
  if (!D.dom.some((d) => d === 0)) search(D);
  return result;
}
