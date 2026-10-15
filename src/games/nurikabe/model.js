// 数墙推理模型：变量 = 格子，取值 0 = 白、1 = 黑（候选位掩码 1 = 白、2 = 黑）。
// 题目只有数字 clues（长度 W*H，0 为无数字），全部白格数 = 数字之和，黑格数随之确定。
//
// 一级：涂白会连通两个数字或使岛超出大小的格子为黑（含已完成岛的四周）；
//       白区只剩一个可扩展格时该格为白；2×2 中三黑则第四格白；
//       黑块只剩一个出口时出口为黑；任何岛都够不到的格子为黑。
// 二级：黑格连通（割点为黑、与黑格隔绝的格子为白、可用空间不足）；黑白总数计数；
//       小岛穷举所有可能形状，取其共同部分与共同邻格，不在任何形状里的格子为黑。
// 三级：引擎自带试探。

export const WHITE = 1;
export const BLACK = 2;
const ANY = 3;

const geometries = new Map();

/** 盘面结构：nbr[i*4+j] 为相邻格（-1 表示出界），blocks 为各 2×2 块的左上格。 */
export function geometry(W, H) {
  const key = `${W}x${H}`;
  if (geometries.has(key)) return geometries.get(key);
  const N = W * H;
  const nbr = new Int32Array(N * 4).fill(-1);
  for (let i = 0; i < N; i++) {
    const r = Math.floor(i / W);
    const c = i % W;
    if (r > 0) nbr[i * 4] = i - W;
    if (c < W - 1) nbr[i * 4 + 1] = i + 1;
    if (r < H - 1) nbr[i * 4 + 2] = i + W;
    if (c > 0) nbr[i * 4 + 3] = i - 1;
  }
  const blocks = [];
  for (let r = 0; r < H - 1; r++) for (let c = 0; c < W - 1; c++) blocks.push(r * W + c);
  const G = { W, H, N, nbr, blocks: Int32Array.from(blocks) };
  geometries.set(key, G);
  return G;
}

/** 完整答案校验：values[i] 为 1 表示黑。 */
export function isValidAnswer(W, H, clues, values) {
  const { N, nbr, blocks } = geometry(W, H);
  for (const i of blocks) {
    if (values[i] && values[i + 1] && values[i + W] && values[i + W + 1]) return false;
  }
  const seen = new Uint8Array(N);
  const queue = new Int32Array(N);
  let blacks = 0;
  let first = -1;
  for (let i = 0; i < N; i++) {
    if (values[i]) {
      blacks++;
      if (first < 0) first = i;
    }
  }
  if (first >= 0) {
    let top = 0;
    queue[top++] = first;
    seen[first] = 1;
    for (let q = 0; q < top; q++) {
      const x = queue[q];
      for (let j = 0; j < 4; j++) {
        const y = nbr[x * 4 + j];
        if (y >= 0 && values[y] && !seen[y]) {
          seen[y] = 1;
          queue[top++] = y;
        }
      }
    }
    if (top !== blacks) return false;
  }
  for (let s = 0; s < N; s++) {
    if (values[s] || seen[s]) continue;
    let top = 0;
    queue[top++] = s;
    seen[s] = 1;
    let clue = 0;
    for (let q = 0; q < top; q++) {
      const x = queue[q];
      if (clues[x]) {
        if (clue) return false;
        clue = clues[x];
      }
      for (let j = 0; j < 4; j++) {
        const y = nbr[x * 4 + j];
        if (y >= 0 && !values[y] && !seen[y]) {
          seen[y] = 1;
          queue[top++] = y;
        }
      }
    }
    if (clue !== top) return false;
  }
  return true;
}

// 小岛穷举的上限：剩余格数、形状个数与搜索步数
const ENUM_MAX_LEFT = 6;
const ENUM_MAX_SHAPES = 32;
const ENUM_MAX_STEPS = 800;

export const BUDGET_EXCEEDED = new Error('推理工作量超出预算');

function withBudget(rule, budget) {
  return (D) => {
    if (--budget.left < 0) throw BUDGET_EXCEEDED;
    return rule(D);
  };
}

/**
 * 选项（生成器用）：shapes 为 false 时省去小岛穷举（更快）；
 * budget = { left } 限制规则调用次数，超出时抛出 BUDGET_EXCEEDED。
 */
export function buildModel(W, H, clues, { shapes = true, budget = null } = {}) {
  const G = geometry(W, H);
  const { N, nbr, blocks } = G;
  let whiteTotal = 0;
  for (let i = 0; i < N; i++) whiteTotal += clues[i];
  const blackTotal = N - whiteTotal;

  // 白格连通分量（白区）：compCells[compStart[k] .. compStart[k+1]) 为第 k 个白区的格子
  const comp = new Int32Array(N);
  const compStart = new Int32Array(N + 1);
  const compCells = new Int32Array(N);
  const compSize = new Int32Array(N);
  const compClue = new Int32Array(N); // 白区内的数字，0 为无数字
  let nComp = 0;

  function label(D) {
    const dom = D.dom;
    comp.fill(-1);
    nComp = 0;
    let top = 0;
    for (let s = 0; s < N; s++) {
      if (dom[s] !== WHITE || comp[s] >= 0) continue;
      const k = nComp++;
      const start = top;
      compStart[k] = start;
      comp[s] = k;
      compCells[top++] = s;
      let clue = 0;
      for (let q = start; q < top; q++) {
        const x = compCells[q];
        if (clues[x]) {
          if (clue) {
            D.bad = true;
            return false;
          }
          clue = clues[x];
        }
        for (let j = 0; j < 4; j++) {
          const y = nbr[x * 4 + j];
          if (y >= 0 && dom[y] === WHITE && comp[y] < 0) {
            comp[y] = k;
            compCells[top++] = y;
          }
        }
      }
      compSize[k] = top - start;
      compClue[k] = clue;
      if (clue && top - start > clue) {
        D.bad = true;
        return false;
      }
    }
    compStart[nComp] = top;
    return true;
  }

  // 未定格 x 涂白后与相邻白区合并：合法则返回合并后的数字（0 为无数字），否则 -1
  function joinCheck(dom, x) {
    let size = 1;
    let clue = 0;
    let k0 = -1;
    let k1 = -1;
    let k2 = -1;
    for (let j = 0; j < 4; j++) {
      const y = nbr[x * 4 + j];
      if (y < 0 || dom[y] !== WHITE) continue;
      const k = comp[y];
      if (k === k0 || k === k1 || k === k2) continue;
      if (k0 < 0) k0 = k;
      else if (k1 < 0) k1 = k;
      else k2 = k;
      size += compSize[k];
      if (compClue[k]) {
        if (clue) return -1;
        clue = compClue[k];
      }
    }
    return clue && size > clue ? -1 : clue;
  }

  // 未定格 y 是否与 k 以外的有数字白区相邻
  function touchesOther(dom, y, k) {
    for (let j = 0; j < 4; j++) {
      const z = nbr[y * 4 + j];
      if (z >= 0 && dom[z] === WHITE && comp[z] !== k && compClue[comp[z]]) return true;
    }
    return false;
  }

  // ---- 一级 ----

  const joins = (D) => {
    if (!label(D)) return true;
    const dom = D.dom;
    let changed = false;
    for (let x = 0; x < N; x++) {
      if (dom[x] === ANY && joinCheck(dom, x) < 0) changed = D.set(x, 1) || changed;
    }
    return changed;
  };

  const mark = new Int32Array(N);
  let markNow = 0;

  // 未完成的白区必须向外扩展：可扩展格为 0 则矛盾，只有 1 个则为白
  const exits = (D) => {
    if (!label(D)) return true;
    const dom = D.dom;
    const found = [];
    for (let k = 0; k < nComp; k++) {
      if (compClue[k] && compSize[k] === compClue[k]) continue;
      markNow++;
      let only = -1;
      let count = 0;
      for (let q = compStart[k]; q < compStart[k + 1] && count < 2; q++) {
        const x = compCells[q];
        for (let j = 0; j < 4; j++) {
          const y = nbr[x * 4 + j];
          if (y < 0 || dom[y] !== ANY || mark[y] === markNow) continue;
          mark[y] = markNow;
          if (joinCheck(dom, y) < 0) continue;
          only = y;
          if (++count > 1) break;
        }
      }
      if (count === 0) {
        D.bad = true;
        return true;
      }
      if (count === 1) found.push(only);
    }
    // 统一在最后修改，以免后面的白区用到过时的标号
    let changed = false;
    for (const y of found) changed = D.set(y, 0) || changed;
    return changed;
  };

  // 黑块只剩一个出口（且黑格总数还没够）时出口为黑
  const blackComp = new Int32Array(N);
  const stack = new Int32Array(N);
  const wallExit = (D) => {
    const dom = D.dom;
    blackComp.fill(-1);
    const found = [];
    let id = 0;
    for (let s = 0; s < N; s++) {
      if (dom[s] !== BLACK || blackComp[s] >= 0) continue;
      const k = id++;
      let top = 0;
      let size = 0;
      let exit = -1;
      let exits = 0;
      stack[top++] = s;
      blackComp[s] = k;
      while (top) {
        const x = stack[--top];
        size++;
        for (let j = 0; j < 4; j++) {
          const y = nbr[x * 4 + j];
          if (y < 0) continue;
          if (dom[y] === BLACK) {
            if (blackComp[y] < 0) {
              blackComp[y] = k;
              stack[top++] = y;
            }
          } else if (dom[y] === ANY && blackComp[y] !== -2 - k) {
            blackComp[y] = -2 - k;
            exits++;
            exit = y;
          }
        }
      }
      if (size >= blackTotal) continue;
      if (exits === 0) {
        D.bad = true;
        return true;
      }
      if (exits === 1) found.push(exit);
    }
    let changed = false;
    for (const y of found) changed = D.set(y, 1) || changed;
    return changed;
  };

  const pools = (D) => {
    const dom = D.dom;
    let changed = false;
    for (const i of blocks) {
      const cells = [i, i + 1, i + W, i + W + 1];
      let blacks = 0;
      let open = -1;
      for (const x of cells) {
        if (dom[x] === BLACK) blacks++;
        else if (dom[x] === ANY) open = open < 0 ? x : -2;
      }
      if (blacks === 4) {
        D.bad = true;
        return true;
      }
      if (blacks === 3 && open >= 0) changed = D.set(open, 0) || changed;
    }
    return changed;
  };

  // 从各个未完成的岛出发，按剩余格数估算能到达的范围（经过无数字白区时整块计入）
  const dist = new Int32Array(N);
  const distStamp = new Int32Array(N); // dist[x] 仅在 distStamp[x] === distNow 时有效
  let distNow = 0;
  const reach = new Uint8Array(N);
  const compReach = new Uint8Array(N);
  const buckets = Array.from({ length: N + 1 }, () => []);

  function spread(dom, k, left, onCell) {
    distNow++;
    const far = (x, d) => distStamp[x] !== distNow || dist[x] > d;
    for (let d = 0; d <= left; d++) buckets[d].length = 0;
    for (let q = compStart[k]; q < compStart[k + 1]; q++) {
      dist[compCells[q]] = 0;
      distStamp[compCells[q]] = distNow;
      buckets[0].push(compCells[q]);
    }
    for (let d = 0; d < left; d++) {
      const list = buckets[d];
      for (let b = 0; b < list.length; b++) {
        const x = list[b];
        if (dist[x] !== d) continue;
        for (let j = 0; j < 4; j++) {
          const y = nbr[x * 4 + j];
          if (y < 0 || dom[y] === BLACK) continue;
          if (dom[y] === WHITE) {
            const kk = comp[y];
            if (kk === k || compClue[kk]) continue;
            const nd = d + compSize[kk];
            if (nd > left || !far(y, nd)) continue;
            for (let q = compStart[kk]; q < compStart[kk + 1]; q++) {
              dist[compCells[q]] = nd;
              distStamp[compCells[q]] = distNow;
              buckets[nd].push(compCells[q]);
            }
            onCell(-1, kk);
          } else {
            const nd = d + 1;
            if (!far(y, nd) || touchesOther(dom, y, k)) continue;
            dist[y] = nd;
            distStamp[y] = distNow;
            buckets[nd].push(y);
            onCell(y, -1);
          }
        }
      }
    }
  }

  const markReach = (y, kk) => {
    if (y >= 0) reach[y] = 1;
    else compReach[kk] = 1;
  };

  const unreachable = (D) => {
    if (!label(D)) return true;
    const dom = D.dom;
    reach.fill(0);
    compReach.fill(0);
    for (let k = 0; k < nComp; k++) {
      if (compClue[k] && compSize[k] < compClue[k]) spread(dom, k, compClue[k] - compSize[k], markReach);
    }
    for (let k = 0; k < nComp; k++) {
      if (!compClue[k] && !compReach[k]) {
        D.bad = true;
        return true;
      }
    }
    let changed = false;
    for (let x = 0; x < N; x++) if (dom[x] === ANY && !reach[x]) changed = D.set(x, 1) || changed;
    return changed;
  };

  // ---- 二级 ----

  const disc = new Int32Array(N);
  const low = new Int32Array(N);
  const sub = new Int32Array(N); // DFS 子树中的黑格数
  const sz = new Int32Array(N); // DFS 子树大小
  const sepSize = new Int32Array(N); // 去掉该格后与根分离的格数
  const sepBlack = new Uint8Array(N); // 分离部分中是否有黑格

  // 黑格必须连通：在“非白格”构成的图上找割点
  const wall = (D) => {
    const dom = D.dom;
    let blacks = 0;
    let root = -1;
    for (let i = 0; i < N; i++) {
      if (dom[i] === BLACK) {
        blacks++;
        if (root < 0) root = i;
      }
    }
    if (!blacks) return false;
    disc.fill(0);
    let time = 0;
    const dfs = (u, parent) => {
      disc[u] = low[u] = ++time;
      sub[u] = dom[u] === BLACK ? 1 : 0;
      sz[u] = 1;
      sepSize[u] = 0;
      sepBlack[u] = 0;
      for (let j = 0; j < 4; j++) {
        const v = nbr[u * 4 + j];
        if (v < 0 || dom[v] === WHITE) continue;
        if (!disc[v]) {
          dfs(v, u);
          sub[u] += sub[v];
          sz[u] += sz[v];
          if (low[v] < low[u]) low[u] = low[v];
          if (low[v] >= disc[u]) {
            sepSize[u] += sz[v];
            if (sub[v]) sepBlack[u] = 1;
          }
        } else if (v !== parent && disc[v] < low[u]) {
          low[u] = disc[v];
        }
      }
    };
    dfs(root, -1);
    if (sub[root] < blacks || sz[root] < blackTotal) {
      D.bad = true;
      return true;
    }
    let changed = false;
    for (let u = 0; u < N; u++) {
      if (dom[u] !== ANY) continue;
      if (!disc[u]) changed = D.set(u, 0) || changed;
      else if (sepBlack[u] || sz[root] - 1 - sepSize[u] < blackTotal) changed = D.set(u, 1) || changed;
    }
    return changed;
  };

  const counting = (D) => {
    const dom = D.dom;
    let blacks = 0;
    let whites = 0;
    for (let i = 0; i < N; i++) {
      if (dom[i] === BLACK) blacks++;
      else if (dom[i] === WHITE) whites++;
    }
    if (blacks > blackTotal || whites > whiteTotal) {
      D.bad = true;
      return true;
    }
    if (blacks + whites === N) return false;
    let val = -1;
    if (blacks === blackTotal) val = 0;
    else if (whites === whiteTotal) val = 1;
    if (val < 0) return false;
    for (let i = 0; i < N; i++) if (dom[i] === ANY) D.set(i, val);
    return true;
  };

  // 小岛穷举：列出岛所有可能的最终形状（连通、大小恰好、不碰其他岛、吸收相邻白区），
  // 所有形状都含的格为白，所有形状都相邻的格为黑；够不到的格为黑。
  const inShape = new Uint8Array(N);
  const banned = new Uint8Array(N);
  const owners = new Uint8Array(N); // 未定格是否可能属于某个岛
  const compOwners = new Uint8Array(N); // 无数字白区是否可能并入某个岛
  const common = new Int32Array(N); // 当前岛：某格在多少个形状中出现
  const commonNb = new Int32Array(N); // 当前岛：某格在多少个形状的邻格中出现
  const nbStamp = new Int32Array(N);
  let nbNow = 0;
  const touched = []; // common / commonNb 中非零的格子

  // 返回形状个数；超出上限返回 -1
  function enumerate(dom, k, target) {
    const cells = [];
    for (let q = compStart[k]; q < compStart[k + 1]; q++) {
      cells.push(compCells[q]);
      inShape[compCells[q]] = 1;
    }
    let shapes = 0;
    let steps = 0;
    let over = false;
    const record = () => {
      shapes++;
      nbNow++;
      for (const x of cells) {
        if (!common[x] && !commonNb[x]) touched.push(x);
        common[x]++;
        for (let j = 0; j < 4; j++) {
          const y = nbr[x * 4 + j];
          if (y < 0 || inShape[y] || nbStamp[y] === nbNow) continue;
          nbStamp[y] = nbNow;
          if (!common[y] && !commonNb[y]) touched.push(y);
          commonNb[y]++;
        }
      }
    };
    const bannedList = [];
    // 新的候选：cells[from..] 相邻、尚未进入过候选池、不与其他岛相邻的未定格
    const candidates = (from) => {
      const out = [];
      for (let q = from; q < cells.length; q++) {
        const x = cells[q];
        for (let j = 0; j < 4; j++) {
          const y = nbr[x * 4 + j];
          if (y < 0 || dom[y] !== ANY || inShape[y] || banned[y]) continue;
          banned[y] = 1;
          if (touchesOther(dom, y, k)) bannedList.push(y);
          else out.push(y);
        }
      }
      return out;
    };
    // 把 y 加入形状，连带吸收相邻的白区；失败（超大小或碰到其他岛）返回 false
    const add = (y) => {
      cells.push(y);
      inShape[y] = 1;
      for (let q = cells.length - 1; q < cells.length; q++) {
        const x = cells[q];
        for (let j = 0; j < 4; j++) {
          const z = nbr[x * 4 + j];
          if (z < 0 || dom[z] !== WHITE || inShape[z]) continue;
          if (compClue[comp[z]]) return false;
          const kk = comp[z];
          for (let p = compStart[kk]; p < compStart[kk + 1]; p++) {
            cells.push(compCells[p]);
            inShape[compCells[p]] = 1;
          }
        }
      }
      return cells.length <= target;
    };
    const undo = (len) => {
      while (cells.length > len) inShape[cells.pop()] = 0;
    };
    // Redelmeier 式枚举：pool[start..] 为待定候选，依次决定“加入”或“排除”，每个形状恰好得到一次
    const search = (pool, start) => {
      if (++steps > ENUM_MAX_STEPS) {
        over = true;
        return;
      }
      if (cells.length === target) {
        record();
        if (shapes > ENUM_MAX_SHAPES) over = true;
        return;
      }
      for (let i = start; i < pool.length && !over; i++) {
        const len = cells.length;
        if (add(pool[i])) {
          const extra = candidates(len);
          search(extra.length ? pool.concat(extra) : pool, i + 1);
          for (const y of extra) banned[y] = 0;
        }
        undo(len);
      }
    };
    const first = candidates(0);
    search(first, 0);
    for (const y of first) banned[y] = 0;
    for (const y of bannedList) banned[y] = 0;
    undo(0);
    return over ? -1 : shapes;
  }

  const shapesRule = (D) => {
    if (!label(D)) return true;
    const dom = D.dom;
    owners.fill(0);
    compOwners.fill(0);
    const deduce = [];
    for (let k = 0; k < nComp; k++) {
      if (!compClue[k] || compSize[k] === compClue[k]) continue;
      const left = compClue[k] - compSize[k];
      const n = left <= ENUM_MAX_LEFT ? enumerate(dom, k, compClue[k]) : -1;
      if (n === 0) {
        D.bad = true;
        return true;
      }
      if (n > 0) {
        for (const x of touched) {
          if (common[x]) {
            if (dom[x] === ANY) owners[x] = 1;
            else if (!compClue[comp[x]]) compOwners[comp[x]] = 1;
          }
          if (dom[x] === ANY && common[x] === n) deduce.push(x, 0);
          if (dom[x] === ANY && commonNb[x] === n) deduce.push(x, 1);
        }
      } else {
        // 形状太多：退回按距离估算
        spread(dom, k, left, (y, kk) => {
          if (y >= 0) owners[y] = 1;
          else compOwners[kk] = 1;
        });
      }
      for (const x of touched) common[x] = commonNb[x] = 0;
      touched.length = 0;
    }
    for (let k = 0; k < nComp; k++) {
      if (!compClue[k] && !compOwners[k]) {
        D.bad = true;
        return true;
      }
    }
    let changed = false;
    for (let i = 0; i < deduce.length; i += 2) {
      changed = D.set(deduce[i], deduce[i + 1]) || changed;
      if (D.bad) return true;
    }
    for (let x = 0; x < N; x++) if (dom[x] === ANY && !owners[x]) changed = D.set(x, 1) || changed;
    return changed;
  };

  return {
    size: N,
    whiteTotal,
    blackTotal,
    domains() {
      return Uint32Array.from(clues, (v) => (v ? WHITE : ANY));
    },
    rules: [
      [joins, exits, pools, wallExit, unreachable],
      shapes ? [wall, counting, shapesRule] : [wall, counting],
    ].map((list) => (budget ? list.map((rule) => withBudget(rule, budget)) : list)),
    validate(values) {
      return isValidAnswer(W, H, clues, values);
    },
  };
}
