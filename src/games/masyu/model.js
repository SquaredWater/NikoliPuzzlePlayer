// 珍珠：盘面结构、推理模型、违规检测。
// 边编号：按格子行优先，每格依次登记其右边（(r,c)-(r,c+1)，若有）与下边（(r,c)-(r+1,c)，若有）。
// 方向：0 上、1 右、2 下、3 左。
export const WHITE = 1;
export const BLACK = 2;
export const DR = [-1, 0, 1, 0];
export const DC = [0, 1, 0, -1];

const layouts = new Map();

/**
 * 盘面结构（按尺寸缓存）：
 *   ea/eb[e]        边 e 两端的格子（ea 在左/上）
 *   right/down[i]   格子 i 的右边/下边编号（无则 -1）
 *   ce[i*4+d]       格子 i 在方向 d 上的边（无则 -1）
 *   nb[i*4+d]       格子 i 在方向 d 上的相邻格（无则 -1）
 */
export function layoutOf(W, H) {
  const key = `${W}x${H}`;
  if (layouts.has(key)) return layouts.get(key);
  const N = W * H;
  const right = new Int32Array(N).fill(-1);
  const down = new Int32Array(N).fill(-1);
  const ea = [];
  const eb = [];
  for (let i = 0; i < N; i++) {
    const r = Math.floor(i / W);
    const c = i % W;
    if (c < W - 1) {
      right[i] = ea.length;
      ea.push(i);
      eb.push(i + 1);
    }
    if (r < H - 1) {
      down[i] = ea.length;
      ea.push(i);
      eb.push(i + W);
    }
  }
  const ce = new Int32Array(N * 4).fill(-1);
  const nb = new Int32Array(N * 4).fill(-1);
  for (let i = 0; i < N; i++) {
    const r = Math.floor(i / W);
    const c = i % W;
    if (r > 0) [ce[i * 4], nb[i * 4]] = [down[i - W], i - W];
    if (c < W - 1) [ce[i * 4 + 1], nb[i * 4 + 1]] = [right[i], i + 1];
    if (r < H - 1) [ce[i * 4 + 2], nb[i * 4 + 2]] = [down[i], i + W];
    if (c > 0) [ce[i * 4 + 3], nb[i * 4 + 3]] = [right[i - 1], i - 1];
  }
  const layout = { W, H, N, E: ea.length, ea: Int32Array.from(ea), eb: Int32Array.from(eb), right, down, ce, nb };
  layouts.set(key, layout);
  return layout;
}

// ---------------------------------------------------------------------------
// 推理模型：变量 = 边，取值 0 无线 / 1 有线
// ---------------------------------------------------------------------------

export function buildModel(W, H, pearls) {
  const L = layoutOf(W, H);
  const { N, E, ea, eb, ce, nb } = L;
  const whites = [];
  const blacks = [];
  for (let i = 0; i < N; i++) {
    if (pearls[i] === WHITE) whites.push(i);
    else if (pearls[i] === BLACK) blacks.push(i);
  }
  const pearlTotal = whites.length + blacks.length;

  // 边状态：1 有线，0 无线（含不存在的边），-1 未定
  const st = (D, e) => {
    if (e < 0) return 0;
    const d = D.dom[e];
    return d === 3 ? -1 : d === 2 ? 1 : 0;
  };
  const fix = (D, e, v) => {
    if (e < 0) {
      if (!v) return false;
      D.bad = true;
      return true;
    }
    return D.set(e, v);
  };

  // 一级：每格度数 0 或 2，珍珠格度数为 2
  const degree = (D) => {
    let changed = false;
    for (let i = 0; i < N; i++) {
      let ones = 0;
      let unk = 0;
      for (let d = 0; d < 4; d++) {
        const s = st(D, ce[i * 4 + d]);
        if (s === 1) ones++;
        else if (s < 0) unk++;
      }
      if (ones > 2 || (!unk && (ones === 1 || (pearls[i] && ones !== 2)))) {
        D.bad = true;
        return true;
      }
      if (!unk) continue;
      let v = -1;
      if (ones === 2) v = 0;
      else if (ones === 1) v = unk === 1 ? 1 : -1;
      else if (pearls[i]) {
        if (unk < 2) {
          D.bad = true;
          return true;
        }
        if (unk === 2) v = 1;
      } else if (unk === 1) v = 0;
      if (v < 0) continue;
      for (let d = 0; d < 4; d++) {
        const e = ce[i * 4 + d];
        if (e >= 0 && D.dom[e] === 3) changed = D.set(e, v) || changed;
      }
    }
    return changed;
  };

  // 一级：白珠直行（某轴有线 → 该轴两边都有线、另一轴无线）
  const white = (D) => {
    let changed = false;
    for (const i of whites) {
      const b = i * 4;
      for (let a = 0; a < 2; a++) {
        const e1 = ce[b + a];
        const e2 = ce[b + a + 2];
        const p1 = ce[b + a + 1];
        const p2 = ce[b + ((a + 3) & 3)];
        const s1 = st(D, e1);
        const s2 = st(D, e2);
        let v = -1;
        if (s1 === 1 || s2 === 1) v = 1;
        else if (s1 === 0 || s2 === 0) v = 0;
        if (v < 0) continue;
        if (fix(D, e1, v)) changed = true;
        if (fix(D, e2, v)) changed = true;
        if (fix(D, p1, 1 - v)) changed = true;
        if (fix(D, p2, 1 - v)) changed = true;
        if (D.bad) return true;
      }
    }
    return changed;
  };

  // 一级：黑珠转弯（每轴恰一边有线），有线的一侧下一格必须同向直行；臂伸不出去的一侧无线
  const black = (D) => {
    let changed = false;
    for (const i of blacks) {
      const b = i * 4;
      for (let d = 0; d < 4; d++) {
        const e = ce[b + d];
        const s = st(D, e);
        if (s === 1) {
          if (fix(D, ce[b + ((d + 2) & 3)], 0)) changed = true;
          if (fix(D, ce[nb[b + d] * 4 + d], 1)) changed = true;
        } else if (s === 0) {
          if (fix(D, ce[b + ((d + 2) & 3)], 1)) changed = true;
        } else if (st(D, ce[nb[b + d] * 4 + d]) === 0) {
          if (fix(D, e, 0)) changed = true;
        }
        if (D.bad) return true;
      }
    }
    return changed;
  };

  // 一级：不能提前闭合回路（闭合后若还有别的线或珍珠没连上则矛盾）
  const parent = new Int32Array(N);
  const compEdges = new Int32Array(N);
  const compCells = new Int32Array(N);
  const compPearls = new Int32Array(N);
  const find = (x) => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]];
    return x;
  };
  const loop = (D) => {
    for (let i = 0; i < N; i++) parent[i] = i;
    let total = 0;
    for (let e = 0; e < E; e++) {
      if (D.dom[e] !== 2) continue;
      total++;
      const a = find(ea[e]);
      const b = find(eb[e]);
      if (a !== b) parent[a] = b;
    }
    if (!total) return false;
    compEdges.fill(0);
    compCells.fill(0);
    compPearls.fill(0);
    for (let i = 0; i < N; i++) {
      const r = find(i);
      compCells[r]++;
      if (pearls[i]) compPearls[r]++;
    }
    for (let e = 0; e < E; e++) if (D.dom[e] === 2) compEdges[find(ea[e])]++;
    for (let i = 0; i < N; i++) {
      if (parent[i] !== i || !compEdges[i] || compEdges[i] !== compCells[i]) continue;
      // 已有闭合回路：必须就是全部
      if (compEdges[i] < total || compPearls[i] < pearlTotal) {
        D.bad = true;
        return true;
      }
      let changed = false;
      for (let e = 0; e < E; e++) if (D.dom[e] === 3) changed = D.set(e, 0) || changed;
      return changed;
    }
    let changed = false;
    for (let e = 0; e < E; e++) {
      if (D.dom[e] !== 3) continue;
      const r = find(ea[e]);
      if (r !== find(eb[e])) continue;
      if (compEdges[r] < total || compPearls[r] < pearlTotal) changed = D.set(e, 0) || changed;
    }
    return changed;
  };

  // 二级：白珠前后两格不能都直行
  const white2 = (D) => {
    let changed = false;
    for (const i of whites) {
      const b = i * 4;
      for (let a = 0; a < 2; a++) {
        const n1 = nb[b + a];
        const n2 = nb[b + a + 2];
        if (n1 < 0 || n2 < 0) continue;
        const f1 = ce[n1 * 4 + a];
        const f2 = ce[n2 * 4 + a + 2];
        const o1 = st(D, f1);
        const o2 = st(D, f2);
        if (o1 === 1 && o2 === 1) {
          if (fix(D, ce[b + a], 0)) changed = true;
        } else if (st(D, ce[b + a]) === 1) {
          if (o1 === 1 && fix(D, f2, 0)) changed = true;
          if (o2 === 1 && fix(D, f1, 0)) changed = true;
        }
        if (D.bad) return true;
      }
    }
    return changed;
  };

  // 二级：黑珠的臂不能穿过黑珠，也不能经过已在别处转弯的格子
  const black2 = (D) => {
    let changed = false;
    for (const i of blacks) {
      const b = i * 4;
      for (let d = 0; d < 4; d++) {
        const e = ce[b + d];
        if (e < 0 || D.dom[e] !== 3) continue;
        const n = nb[b + d];
        if (pearls[n] === BLACK || st(D, ce[n * 4 + ((d + 1) & 3)]) === 1 || st(D, ce[n * 4 + ((d + 3) & 3)]) === 1) {
          if (fix(D, e, 0)) changed = true;
        }
      }
    }
    return changed;
  };

  return {
    size: E,
    domains() {
      return new Uint32Array(E).fill(3);
    },
    rules: [[degree, white, black, loop], [white2, black2]],
    validate(values) {
      return isValidLoop(L, pearls, values);
    },
  };
}

/** 完整赋值（每条边 0/1）是否为合法答案：单一回路、经过所有珍珠且满足珍珠条件。 */
export function isValidLoop(L, pearls, values) {
  const { N, E, ea, eb, ce, nb } = L;
  const line = (i, d) => {
    const e = ce[i * 4 + d];
    return e >= 0 && values[e] === 1;
  };
  const deg = new Uint8Array(N);
  let total = 0;
  for (let e = 0; e < E; e++) {
    if (values[e] !== 1) continue;
    total++;
    deg[ea[e]]++;
    deg[eb[e]]++;
  }
  if (!total) return false;
  let start = -1;
  for (let i = 0; i < N; i++) {
    if (deg[i] !== 0 && deg[i] !== 2) return false;
    if (pearls[i] && deg[i] !== 2) return false;
    if (deg[i] && start < 0) start = i;
  }
  // 沿回路走一圈，长度必须等于线段总数
  let prev = -1;
  let cur = start;
  let len = 0;
  do {
    let next = -1;
    for (let d = 0; d < 4; d++) {
      const n = nb[cur * 4 + d];
      if (line(cur, d) && n !== prev) {
        next = n;
        break;
      }
    }
    if (next < 0) return false;
    prev = cur;
    cur = next;
    len++;
  } while (cur !== start && len <= total);
  if (len !== total) return false;
  for (let i = 0; i < N; i++) {
    if (pearls[i] === WHITE) {
      const a = line(i, 0) ? 0 : 1;
      if (!line(i, a) || !line(i, a + 2)) return false;
      if (line(nb[i * 4 + a], a) && line(nb[i * 4 + a + 2], a + 2)) return false;
    } else if (pearls[i] === BLACK) {
      for (let d = 0; d < 4; d++) {
        if (!line(i, d)) continue;
        if (line(i, (d + 2) & 3) || !line(nb[i * 4 + d], d)) return false;
      }
    }
  }
  return true;
}

/**
 * 盘面上明显的违规（供“标出违规之处”）：
 *   cells：度数 > 2 的格子、违反条件的珍珠；edges：提前闭合的回路上的边。
 */
export function findViolations(puzzle, state) {
  const { width: W, height: H, pearls } = puzzle;
  const L = layoutOf(W, H);
  const { N, E, ea, eb, ce, nb } = L;
  const e = state.e;
  const line = (i, d) => {
    const k = ce[i * 4 + d];
    return k >= 0 && e[k] === 1;
  };
  const cells = new Set();
  const edges = new Set();
  const deg = new Uint8Array(N);
  let total = 0;
  for (let k = 0; k < E; k++) {
    if (e[k] !== 1) continue;
    total++;
    deg[ea[k]]++;
    deg[eb[k]]++;
  }
  for (let i = 0; i < N; i++) {
    if (deg[i] > 2) cells.add(i);
    if (pearls[i] === WHITE) {
      const h = line(i, 1) || line(i, 3);
      const v = line(i, 0) || line(i, 2);
      if (h && v) cells.add(i);
      for (let a = 0; a < 2; a++) {
        if (!line(i, a) || !line(i, a + 2)) continue;
        if (line(nb[i * 4 + a], a) && line(nb[i * 4 + a + 2], a + 2)) cells.add(i);
      }
    } else if (pearls[i] === BLACK) {
      if ((line(i, 0) && line(i, 2)) || (line(i, 1) && line(i, 3))) cells.add(i);
      for (let d = 0; d < 4; d++) {
        if (!line(i, d)) continue;
        const n = nb[i * 4 + d];
        if (line(n, (d + 1) & 3) || line(n, (d + 3) & 3)) cells.add(i);
      }
    }
  }
  // 闭合的回路：若还有别的线或没连上的珍珠，则整圈标红
  const seen = new Uint8Array(N);
  for (let s = 0; s < N; s++) {
    if (seen[s] || !deg[s]) continue;
    const comp = [];
    const stack = [s];
    seen[s] = 1;
    let closed = true;
    while (stack.length) {
      const i = stack.pop();
      comp.push(i);
      if (deg[i] !== 2) closed = false;
      for (let d = 0; d < 4; d++) {
        if (!line(i, d)) continue;
        const n = nb[i * 4 + d];
        if (!seen[n]) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    if (!closed) continue;
    const inComp = new Set(comp);
    const missing = comp.length < total || pearls.some((p, i) => p && !inComp.has(i));
    if (!missing) continue;
    for (const i of comp) {
      if (line(i, 1)) edges.add(ce[i * 4 + 1]);
      if (line(i, 2)) edges.add(ce[i * 4 + 2]);
    }
  }
  return { cells, edges };
}
