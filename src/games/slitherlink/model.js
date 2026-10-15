// 数回的盘面几何与推理模型（与平台无关）。
// 边编号：横边 (H+1)*W 条，第 r 条横线第 c 段为 r*W+c；
//         竖边 H*(W+1) 条接在其后，第 r 行第 c 条竖线为 nH + r*(W+1)+c。
// 顶点 (r, c) 编号 r*(W+1)+c。推理变量 = 边，取值 0 无线、1 有线。

const NONE = 1;
const LINE = 2;
const BOTH = 3;

// ---------------------------------------------------------------------------
// 几何（按尺寸缓存）
// ---------------------------------------------------------------------------

const geoms = new Map();

export function geometry(W, H) {
  const key = `${W}x${H}`;
  if (geoms.has(key)) return geoms.get(key);
  const N = W * H;
  const nH = (H + 1) * W;
  const E = nH + H * (W + 1);
  const V = (H + 1) * (W + 1);
  const hEdge = (r, c) => (r >= 0 && r <= H && c >= 0 && c < W ? r * W + c : -1);
  const vEdge = (r, c) => (r >= 0 && r < H && c >= 0 && c <= W ? nH + r * (W + 1) + c : -1);
  const vid = (r, c) => r * (W + 1) + c;

  // 格子四边：上 下 左 右
  const cellEdges = new Int32Array(N * 4);
  // 格子四角（左上、右上、左下、右下）各自的两条“外侧”边（不属于该格），不存在为 -1
  const cornerExt = new Int32Array(N * 8);
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const i = r * W + c;
      cellEdges.set([hEdge(r, c), hEdge(r + 1, c), vEdge(r, c), vEdge(r, c + 1)], i * 4);
      cornerExt.set(
        [
          vEdge(r - 1, c), hEdge(r, c - 1),
          vEdge(r - 1, c + 1), hEdge(r, c + 1),
          vEdge(r + 1, c), hEdge(r + 1, c - 1),
          vEdge(r + 1, c + 1), hEdge(r + 1, c + 1),
        ],
        i * 8,
      );
    }
  }
  // 顶点四边：上 下 左 右，不存在为 -1
  const vertEdges = new Int32Array(V * 4);
  for (let r = 0; r <= H; r++) {
    for (let c = 0; c <= W; c++) {
      vertEdges.set([vEdge(r - 1, c), vEdge(r, c), hEdge(r, c - 1), hEdge(r, c)], vid(r, c) * 4);
    }
  }
  const edgeVerts = new Int32Array(E * 2);
  const edgeCells = new Int32Array(E * 2).fill(-1);
  for (let r = 0; r <= H; r++) {
    for (let c = 0; c < W; c++) {
      const e = hEdge(r, c);
      edgeVerts[e * 2] = vid(r, c);
      edgeVerts[e * 2 + 1] = vid(r, c + 1);
      if (r > 0) edgeCells[e * 2] = (r - 1) * W + c;
      if (r < H) edgeCells[e * 2 + 1] = r * W + c;
    }
  }
  for (let r = 0; r < H; r++) {
    for (let c = 0; c <= W; c++) {
      const e = vEdge(r, c);
      edgeVerts[e * 2] = vid(r, c);
      edgeVerts[e * 2 + 1] = vid(r + 1, c);
      if (c > 0) edgeCells[e * 2] = r * W + c - 1;
      if (c < W) edgeCells[e * 2 + 1] = r * W + c;
    }
  }
  const g = { W, H, N, E, V, nH, hEdge, vEdge, vid, cellEdges, cornerExt, vertEdges, edgeVerts, edgeCells };
  geoms.set(key, g);
  return g;
}

/** 由区域（inside[cell] = 1）得到边界上的边：恰好一侧在区域内的边有线。 */
export function boundaryEdges(G, inside) {
  const sol = new Array(G.E).fill(0);
  for (let e = 0; e < G.E; e++) {
    const a = G.edgeCells[e * 2];
    const b = G.edgeCells[e * 2 + 1];
    const ia = a >= 0 ? inside[a] : 0;
    const ib = b >= 0 ? inside[b] : 0;
    sol[e] = ia !== ib ? 1 : 0;
  }
  return sol;
}

export function cluesFromEdges(G, lines) {
  const clues = new Array(G.N);
  for (let i = 0; i < G.N; i++) {
    let n = 0;
    for (let k = 0; k < 4; k++) n += lines[G.cellEdges[i * 4 + k]] ? 1 : 0;
    clues[i] = n;
  }
  return clues;
}

// ---------------------------------------------------------------------------
// 线段连通性（并查集）
// ---------------------------------------------------------------------------

function makeUF(V) {
  return { parent: new Int32Array(V), deg: new Int32Array(V), comp: new Int32Array(V), total: 0, cycle: -1 };
}

function find(parent, x) {
  while (parent[x] !== x) {
    parent[x] = parent[parent[x]];
    x = parent[x];
  }
  return x;
}

/** 按 isLine(e) 把有线的边并起来；记录顶点度数、每个分量的边数、是否已出现闭合回路。 */
function buildUF(G, uf, isLine) {
  const { parent, deg, comp } = uf;
  for (let v = 0; v < G.V; v++) {
    parent[v] = v;
    deg[v] = 0;
    comp[v] = 0;
  }
  uf.total = 0;
  uf.cycle = -1;
  for (let e = 0; e < G.E; e++) {
    if (!isLine(e)) continue;
    const a = G.edgeVerts[e * 2];
    const b = G.edgeVerts[e * 2 + 1];
    deg[a]++;
    deg[b]++;
    uf.total++;
    const ra = find(parent, a);
    const rb = find(parent, b);
    if (ra === rb) uf.cycle = a;
    else parent[ra] = rb;
  }
  for (let e = 0; e < G.E; e++) if (isLine(e)) comp[find(parent, G.edgeVerts[e * 2])]++;
  if (uf.cycle >= 0) uf.cycle = find(parent, uf.cycle);
  return uf;
}

/** 完整赋值是否合法：数字满足、顶点度数为 0 或 2、所有线连成一个回路。 */
export function isValidLoop(G, clues, lines) {
  for (let i = 0; i < G.N; i++) {
    if (clues[i] < 0) continue;
    let n = 0;
    for (let k = 0; k < 4; k++) n += lines[G.cellEdges[i * 4 + k]] === 1 ? 1 : 0;
    if (n !== clues[i]) return false;
  }
  const uf = buildUF(G, makeUF(G.V), (e) => lines[e] === 1);
  if (uf.total === 0) return false;
  for (let v = 0; v < G.V; v++) if (uf.deg[v] !== 0 && uf.deg[v] !== 2) return false;
  let comps = 0;
  for (let v = 0; v < G.V; v++) if (uf.comp[v] > 0) comps++;
  return comps === 1;
}

// ---------------------------------------------------------------------------
// 推理模型
// ---------------------------------------------------------------------------

/** 推理超出工作量预算时抛出（生成器用来限制单次求解耗时）。 */
export const BUDGET_EXCEEDED = new Error('budget exceeded');

const MASKS = [[], [], [], [], []];
for (let m = 0; m < 16; m++) MASKS[(m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1)].push(m);
// 格子四角各自用到的两条本格边（下标对应 上 下 左 右）
const CORNER_IN = [0, 2, 0, 3, 1, 2, 1, 3];

/**
 * clues：长度 W*H，-1 为无数字。budget 可选：{ left }，每次调用规则扣减，耗尽时抛出 BUDGET_EXCEEDED。
 */
export function buildModel(W, H, clues, budget = null) {
  const G = geometry(W, H);
  const { N, E, V, cellEdges, cornerExt, vertEdges, edgeVerts, edgeCells } = G;
  const clued = [];
  for (let i = 0; i < N; i++) if (clues[i] >= 0) clued.push(i);
  const uf = makeUF(V);

  const spend = (cost) => {
    if (budget && (budget.left -= cost) < 0) throw BUDGET_EXCEEDED;
  };

  // 一级：格子数字计数、顶点度数（只能为 0 或 2），用工作队列传播到不动点
  const QN = N + V;
  const queue = new Int32Array(QN);
  const queued = new Uint8Array(QN);
  let head = 0;
  let count = 0;
  const push = (item) => {
    if (queued[item]) return;
    queued[item] = 1;
    queue[(head + count++) % QN] = item;
  };
  const fix = (D, e, val) => {
    if (!D.set(e, val)) return false;
    for (let k = 0; k < 2; k++) {
      const c = edgeCells[e * 2 + k];
      if (c >= 0 && clues[c] >= 0) push(c);
      push(N + edgeVerts[e * 2 + k]);
    }
    return true;
  };
  const counting = (D) => {
    spend(QN);
    const dom = D.dom;
    head = 0;
    count = 0;
    for (const c of clued) push(c);
    for (let v = 0; v < V; v++) push(N + v);
    let changed = false;
    while (count > 0 && !D.bad) {
      const item = queue[head];
      head = (head + 1) % QN;
      count--;
      queued[item] = 0;
      let lines = 0;
      let open = 0;
      if (item < N) {
        const k = clues[item];
        for (let j = 0; j < 4; j++) {
          const d = dom[cellEdges[item * 4 + j]];
          if (d === LINE) lines++;
          else if (d === BOTH) open++;
        }
        if (lines > k || lines + open < k) {
          D.bad = true;
          break;
        }
        if (!open || (lines !== k && lines + open !== k)) continue;
        const val = lines === k ? 0 : 1;
        for (let j = 0; j < 4; j++) {
          const e = cellEdges[item * 4 + j];
          if (dom[e] === BOTH) changed = fix(D, e, val) || changed;
        }
      } else {
        const v = item - N;
        for (let j = 0; j < 4; j++) {
          const e = vertEdges[v * 4 + j];
          if (e < 0) continue;
          const d = dom[e];
          if (d === LINE) lines++;
          else if (d === BOTH) open++;
        }
        if (lines > 2 || (lines === 1 && open === 0)) {
          D.bad = true;
          break;
        }
        let val = -1;
        if (lines === 2 && open) val = 0;
        else if (open === 1) val = lines;
        if (val < 0) continue;
        for (let j = 0; j < 4; j++) {
          const e = vertEdges[v * 4 + j];
          if (e >= 0 && dom[e] === BOTH) changed = fix(D, e, val) || changed;
        }
      }
    }
    while (count > 0) {
      queued[queue[head]] = 0;
      head = (head + 1) % QN;
      count--;
    }
    return changed;
  };

  // 一级：已经闭合出回路 → 它就是唯一的回路，其余边全部无线（别处还有线则矛盾）
  const closedLoop = (D) => {
    spend(E);
    const dom = D.dom;
    buildUF(G, uf, (e) => dom[e] === LINE);
    if (uf.cycle < 0) return false;
    if (uf.comp[uf.cycle] !== uf.total) {
      D.bad = true;
      return true;
    }
    let changed = false;
    for (let e = 0; e < E; e++) if (dom[e] === BOTH && D.set(e, 0)) changed = true;
    return changed;
  };

  // 二级：格子与四角顶点的局部枚举（本格 4 边 + 四角外侧 8 边），对每条边取所有可行方案的并集
  const extU = new Int32Array(8);
  const extT = new Int32Array(8);
  const cellCorners = (D) => {
    spend(clued.length * 8);
    const dom = D.dom;
    let changed = false;
    for (const cell of clued) {
      const base = cell * 4;
      const d0 = dom[cellEdges[base]];
      const d1 = dom[cellEdges[base + 1]];
      const d2 = dom[cellEdges[base + 2]];
      const d3 = dom[cellEdges[base + 3]];
      if (d0 !== BOTH && d1 !== BOTH && d2 !== BOTH && d3 !== BOTH) continue;
      const din = [d0, d1, d2, d3];
      let inU = 0; // 第 j 条本格边：位 2j = 可无线，位 2j+1 = 可有线
      extU.fill(0);
      for (const m of MASKS[clues[cell]]) {
        let ok = true;
        for (let j = 0; j < 4 && ok; j++) if (!(din[j] & (1 << ((m >> j) & 1)))) ok = false;
        if (!ok) continue;
        for (let q = 0; q < 4 && ok; q++) {
          const s = ((m >> CORNER_IN[q * 2]) & 1) + ((m >> CORNER_IN[q * 2 + 1]) & 1);
          const x1 = cornerExt[cell * 8 + q * 2];
          const x2 = cornerExt[cell * 8 + q * 2 + 1];
          const dx1 = x1 < 0 ? NONE : dom[x1];
          const dx2 = x2 < 0 ? NONE : dom[x2];
          let u1 = 0;
          let u2 = 0;
          for (let a = 0; a < 2; a++) {
            if (!(dx1 & (1 << a))) continue;
            for (let b = 0; b < 2; b++) {
              if (!(dx2 & (1 << b))) continue;
              const t = s + a + b;
              if (t === 0 || t === 2) {
                u1 |= 1 << a;
                u2 |= 1 << b;
              }
            }
          }
          if (!u1) ok = false;
          extT[q * 2] = u1;
          extT[q * 2 + 1] = u2;
        }
        if (!ok) continue;
        for (let j = 0; j < 4; j++) inU |= 1 << (j * 2 + ((m >> j) & 1));
        for (let k = 0; k < 8; k++) extU[k] |= extT[k];
      }
      if (!inU) {
        D.bad = true;
        return true;
      }
      for (let j = 0; j < 4; j++) if (D.restrict(cellEdges[base + j], (inU >> (j * 2)) & 3)) changed = true;
      for (let k = 0; k < 8; k++) {
        const x = cornerExt[cell * 8 + k];
        if (x >= 0 && D.restrict(x, extU[k])) changed = true;
      }
      if (D.bad) return true;
    }
    return changed;
  };

  // 二级：相邻 / 对角的两个 3（固定模式，见 patternsOf）
  const patterns = patternsOf(G, clues);
  const threes = (D) => {
    let changed = false;
    for (const { ones, zeros } of patterns) {
      for (const e of ones) if (D.set(e, 1)) changed = true;
      for (const e of zeros) if (D.set(e, 0)) changed = true;
    }
    return changed;
  };

  // 二级：不能提前闭合回路。连接同一线段两端的边若画上就成了闭合回路，
  // 除非这个回路恰好就是完整答案（没有别的线，且所有数字都满足），否则该边无线。
  const noSmallLoop = (D) => {
    spend(E);
    const dom = D.dom;
    buildUF(G, uf, (e) => dom[e] === LINE);
    if (uf.cycle >= 0) return false;
    let changed = false;
    for (let e = 0; e < E; e++) {
      if (dom[e] !== BOTH) continue;
      const a = edgeVerts[e * 2];
      const b = edgeVerts[e * 2 + 1];
      if (uf.deg[a] !== 1 || uf.deg[b] !== 1) continue;
      const root = find(uf.parent, a);
      if (root !== find(uf.parent, b)) continue;
      if (uf.comp[root] === uf.total && closesAll(e)) continue;
      D.set(e, 0);
      changed = true;
    }
    return changed;

    function closesAll(e) {
      for (const c of clued) {
        let n = 0;
        for (let j = 0; j < 4; j++) {
          const x = cellEdges[c * 4 + j];
          if (x === e || dom[x] === LINE) n++;
        }
        if (n !== clues[c]) return false;
      }
      return true;
    }
  };

  return {
    size: E,
    geometry: G,
    domains() {
      return new Uint32Array(E).fill(BOTH);
    },
    rules: [[counting, closedLoop], [threes, cellCorners, noSmallLoop]],
    validate(values) {
      return isValidLoop(G, clues, values);
    },
  };
}

/**
 * 两个 3 的固定模式：
 *   相邻：公共边、两格各自的对边有线，公共边两端的延长线无线（前提：两格外围的 2×1 矩形本身不是答案）；
 *   对角：两格远离公共顶点的两条边都有线。
 */
function patternsOf(G, clues) {
  const { W, H, hEdge, vEdge } = G;
  const at = (r, c) => (r >= 0 && r < H && c >= 0 && c < W ? clues[r * W + c] : -1);
  const out = [];
  const rectIsAnswer = (edges) => {
    const set = new Set(edges);
    for (let i = 0; i < G.N; i++) {
      if (clues[i] < 0) continue;
      let n = 0;
      for (let k = 0; k < 4; k++) n += set.has(G.cellEdges[i * 4 + k]) ? 1 : 0;
      if (n !== clues[i]) return false;
    }
    return true;
  };
  const valid = (list) => list.filter((e) => e >= 0);
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      if (at(r, c) !== 3) continue;
      if (at(r, c + 1) === 3) {
        const rect = [hEdge(r, c), hEdge(r, c + 1), hEdge(r + 1, c), hEdge(r + 1, c + 1), vEdge(r, c), vEdge(r, c + 2)];
        if (!rectIsAnswer(rect)) {
          out.push({ ones: [vEdge(r, c), vEdge(r, c + 1), vEdge(r, c + 2)], zeros: valid([vEdge(r - 1, c + 1), vEdge(r + 1, c + 1)]) });
        }
      }
      if (at(r + 1, c) === 3) {
        const rect = [vEdge(r, c), vEdge(r + 1, c), vEdge(r, c + 1), vEdge(r + 1, c + 1), hEdge(r, c), hEdge(r + 2, c)];
        if (!rectIsAnswer(rect)) {
          out.push({ ones: [hEdge(r, c), hEdge(r + 1, c), hEdge(r + 2, c)], zeros: valid([hEdge(r + 1, c - 1), hEdge(r + 1, c + 1)]) });
        }
      }
      if (at(r + 1, c + 1) === 3) {
        out.push({ ones: [hEdge(r, c), vEdge(r, c), hEdge(r + 2, c + 1), vEdge(r + 1, c + 2)], zeros: [] });
      }
      if (at(r + 1, c - 1) === 3) {
        out.push({ ones: [hEdge(r, c), vEdge(r, c + 1), hEdge(r + 2, c - 1), vEdge(r + 1, c - 1)], zeros: [] });
      }
    }
  }
  return out;
}
