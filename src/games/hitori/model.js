// 数壹推理模型。变量 = 格子，取值 0 = 白、1 = 黑（位掩码 1 = 可白，2 = 可黑）。
export const WHITE = 1;
export const BLACK = 2;

const layouts = new Map();

export function layoutOf(n) {
  if (layouts.has(n)) return layouts.get(n);
  const N = n * n;
  const lines = [];
  for (let i = 0; i < n; i++) {
    lines.push(Array.from({ length: n }, (_, k) => i * n + k));
    lines.push(Array.from({ length: n }, (_, k) => k * n + i));
  }
  const nb = Array.from({ length: N }, (_, i) => {
    const r = Math.floor(i / n);
    const c = i % n;
    const list = [];
    if (r > 0) list.push(i - n);
    if (r < n - 1) list.push(i + n);
    if (c > 0) list.push(i - 1);
    if (c < n - 1) list.push(i + 1);
    return list;
  });
  const layout = { n, N, lines, nb };
  layouts.set(n, layout);
  return layout;
}

/** 每格在同行、同列中数字相同的格子。 */
export function samePeers(n, numbers) {
  const { N, lines } = layoutOf(n);
  const same = Array.from({ length: N }, () => []);
  for (const line of lines) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = line[i];
        const b = line[j];
        if (numbers[a] === numbers[b]) {
          same[a].push(b);
          same[b].push(a);
        }
      }
    }
  }
  return same;
}

/** keep(i) 为真的格子是否连通（没有这样的格子也算连通）。 */
export function isConnected(n, keep) {
  const { N, nb } = layoutOf(n);
  let start = -1;
  let total = 0;
  for (let i = 0; i < N; i++) {
    if (keep(i)) {
      total++;
      if (start < 0) start = i;
    }
  }
  if (total === 0) return true;
  const seen = new Uint8Array(N);
  const stack = [start];
  seen[start] = 1;
  let count = 0;
  while (stack.length) {
    const u = stack.pop();
    count++;
    for (const v of nb[u]) {
      if (!seen[v] && keep(v)) {
        seen[v] = 1;
        stack.push(v);
      }
    }
  }
  return count === total;
}

/** 完整答案校验：black[i] 为真表示涂黑。 */
export function isValidSolution(n, numbers, black, same = samePeers(n, numbers)) {
  const { N, nb } = layoutOf(n);
  for (let i = 0; i < N; i++) {
    if (black[i]) {
      if (nb[i].some((p) => black[p])) return false;
      // 规则 4：同行或同列还有未涂黑的相同数字
      if (!same[i].some((p) => !black[p])) return false;
    } else if (same[i].some((p) => !black[p])) {
      return false;
    }
  }
  return isConnected(n, (i) => !black[i]);
}

export function buildModel(n, numbers) {
  const { N, lines, nb } = layoutOf(n);
  const same = samePeers(n, numbers);

  // 只依赖数字的固定模式：唯一数字 / X Y X 的中间为白；相邻 X X → 同行其它 X 为黑
  const forceWhite = [];
  const forceBlack = [];
  for (let i = 0; i < N; i++) if (!same[i].length) forceWhite.push(i);
  for (const line of lines) {
    for (let k = 1; k < n - 1; k++) if (numbers[line[k - 1]] === numbers[line[k + 1]]) forceWhite.push(line[k]);
    for (let k = 0; k < n - 1; k++) {
      const x = numbers[line[k]];
      if (x !== numbers[line[k + 1]]) continue;
      for (let j = 0; j < n; j++) if (j !== k && j !== k + 1 && numbers[line[j]] === x) forceBlack.push(line[j]);
    }
  }

  // 一级
  const patterns = (D) => {
    let changed = false;
    for (const i of forceWhite) if (D.restrict(i, WHITE)) changed = true;
    for (const i of forceBlack) if (D.restrict(i, BLACK)) changed = true;
    return changed;
  };

  const blackNeighbors = (D) => {
    let changed = false;
    for (let i = 0; i < N; i++) {
      if (D.dom[i] !== BLACK) continue;
      for (const p of nb[i]) if (D.restrict(p, WHITE)) changed = true;
    }
    return changed;
  };

  const whiteDuplicates = (D) => {
    let changed = false;
    for (let i = 0; i < N; i++) {
      if (D.dom[i] !== WHITE) continue;
      for (const p of same[i]) if (D.restrict(p, BLACK)) changed = true;
    }
    return changed;
  };

  // 一级：可白的格子只剩一个非黑邻格时，该邻格为白（否则它被孤立；白格至少两个）
  const isolation = (D) => {
    const dom = D.dom;
    let changed = false;
    for (let i = 0; i < N; i++) {
      if (!(dom[i] & WHITE)) continue;
      let only = -1;
      let count = 0;
      for (const p of nb[i]) {
        if (dom[p] & WHITE) {
          only = p;
          if (++count > 1) break;
        }
      }
      if (count === 1 && D.restrict(only, WHITE)) changed = true;
    }
    return changed;
  };

  // 二级：规则 4——可涂黑的格子必须还有可能为白的相同数字；黑格只剩一个候选时该候选为白
  const necessity = (D) => {
    const dom = D.dom;
    let changed = false;
    for (let i = 0; i < N; i++) {
      if (!(dom[i] & BLACK)) continue;
      let cand = -1;
      let count = 0;
      for (const p of same[i]) {
        if (dom[p] & WHITE) {
          cand = p;
          if (++count > 1) break;
        }
      }
      if (count === 0) {
        if (D.restrict(i, WHITE)) changed = true;
        if (D.bad) return true;
      } else if (count === 1 && dom[i] === BLACK) {
        if (D.restrict(cand, WHITE)) changed = true;
        if (D.bad) return true;
      }
    }
    return changed;
  };

  // 二级：连通。非黑格（白 + 未定）必须连通；其中的割点若涂黑，被分开的各部分都紧邻它、必含白格，
  // 白格将不连通，故割点为白。
  const disc = new Int32Array(N);
  const low = new Int32Array(N);
  const connectivity = (D) => {
    const dom = D.dom;
    disc.fill(0);
    let time = 0;
    const cut = [];
    const dfs = (u, parent) => {
      disc[u] = low[u] = ++time;
      let children = 0;
      let isCut = false;
      for (const v of nb[u]) {
        if (!(dom[v] & WHITE)) continue;
        if (!disc[v]) {
          children++;
          dfs(v, u);
          if (low[v] < low[u]) low[u] = low[v];
          if (parent >= 0 && low[v] >= disc[u]) isCut = true;
        } else if (v !== parent && disc[v] < low[u]) {
          low[u] = disc[v];
        }
      }
      if (parent < 0 && children > 1) isCut = true;
      if (isCut && dom[u] !== WHITE) cut.push(u);
    };
    let comps = 0;
    for (let s = 0; s < N; s++) {
      if (!(dom[s] & WHITE) || disc[s]) continue;
      if (++comps > 1) {
        D.bad = true;
        return true;
      }
      dfs(s, -1);
    }
    let changed = false;
    for (const u of cut) if (D.restrict(u, WHITE)) changed = true;
    return changed;
  };

  return {
    size: N,
    same,
    domains() {
      return new Uint32Array(N).fill(WHITE | BLACK);
    },
    rules: [
      [patterns, blackNeighbors, whiteDuplicates, isolation],
      [necessity, connectivity],
    ],
    validate(values) {
      return isValidSolution(n, numbers, values, same);
    },
  };
}
