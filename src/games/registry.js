// 游戏列表（纯数据，主页、游戏页、Worker 共用）。
//   sizes      尺寸预设 [宽, 高]
//   sizeRange  通过题号载入时允许的尺寸范围；fixed 表示只能用预设尺寸；square 表示必须是正方形
//   rules      规则说明（每条一句）

export const GAMES = [
  {
    id: 'sudoku',
    prefix: 'SD',
    name: '数独',
    en: 'Sudoku',
    intro: '每行、每列、每宫填入不重复的数字。',
    rules: ['在空格中填入 1~N 的数字（N 为盘面边长）。', '每行、每列、每个粗线宫内的数字都不能重复。'],
    sizes: [[4, 4], [6, 6], [9, 9]],
    defaultSize: [9, 9],
    sizeRange: { fixed: true },
  },
  {
    id: 'kakuro',
    prefix: 'KK',
    name: '数和',
    en: 'Kakuro',
    intro: '像填字游戏一样填数字，每段之和等于提示。',
    rules: [
      '在白格中填入 1~9 的数字。',
      '黑格斜线右上方的数字是其右侧连续白格之和，左下方的数字是其下方连续白格之和。',
      '同一段连续白格内数字不能重复。',
    ],
    sizes: [[6, 6], [8, 8], [10, 10], [12, 12]],
    defaultSize: [8, 8],
    sizeRange: { min: 4, max: 16 },
  },
  {
    id: 'shikaku',
    prefix: 'SK',
    name: '数方',
    en: 'Shikaku',
    intro: '把盘面切成矩形，每块恰含一个数字且面积相等。',
    rules: ['把盘面分割成若干矩形。', '每个矩形恰好包含一个数字，且面积等于该数字。'],
    sizes: [[5, 5], [7, 7], [10, 10], [12, 12], [15, 15], [20, 20], [15, 10]],
    defaultSize: [10, 10],
    sizeRange: { min: 3, max: 30 },
  },
  {
    id: 'slitherlink',
    prefix: 'SL',
    name: '数回',
    en: 'Slitherlink',
    intro: '沿点线画一个回路，数字表示四周有几条边。',
    rules: [
      '沿着格点之间的虚线画线，连成一个不交叉、不分岔的回路。',
      '格子中的数字表示该格四条边中有几条被画上线。',
    ],
    sizes: [[5, 5], [7, 7], [10, 10], [12, 12], [15, 15]],
    defaultSize: [7, 7],
    sizeRange: { min: 3, max: 20 },
  },
  {
    id: 'masyu',
    prefix: 'MY',
    name: '珍珠',
    en: 'Masyu',
    intro: '画一个穿过所有珍珠的回路，黑珠转弯、白珠直行。',
    rules: [
      '连接格子中心画一个不交叉、不分岔的回路，回路必须经过所有珍珠。',
      '白珍珠：回路直行穿过，且在前一格或后一格（至少一处）转弯。',
      '黑珍珠：回路在此转弯，且转弯前后都至少直行两格。',
    ],
    sizes: [[6, 6], [8, 8], [10, 10], [12, 12]],
    defaultSize: [8, 8],
    sizeRange: { min: 4, max: 16 },
  },
  {
    id: 'nurikabe',
    prefix: 'NK',
    name: '数墙',
    en: 'Nurikabe',
    intro: '涂黑格子形成连通的墙，留白的岛屿大小等于数字。',
    rules: [
      '把部分格子涂黑，黑格必须全部连通，且不能出现 2×2 的黑块。',
      '未涂黑的格子组成若干“岛”，每个岛恰好包含一个数字，且格数等于该数字。',
    ],
    sizes: [[5, 5], [7, 7], [10, 10], [12, 12]],
    defaultSize: [7, 7],
    sizeRange: { min: 4, max: 15 },
  },
  {
    id: 'akari',
    prefix: 'AK',
    name: '美术馆',
    en: 'Akari',
    intro: '放置灯泡照亮所有白格，灯泡不能互相照到。',
    rules: [
      '在白格中放置灯泡，灯光沿上下左右直线照射，直到被黑格或边界挡住。',
      '所有白格都必须被照亮，两个灯泡不能互相照到。',
      '黑格中的数字表示与它上下左右相邻的灯泡数。',
    ],
    sizes: [[7, 7], [10, 10], [14, 14]],
    defaultSize: [7, 7],
    sizeRange: { min: 4, max: 20 },
  },
  {
    id: 'hashi',
    prefix: 'HS',
    name: '数桥',
    en: 'Hashiwokakero',
    intro: '在岛屿之间架桥，桥数等于岛上数字，全部连通。',
    rules: [
      '在圆圈（岛）之间沿水平或竖直方向架桥，桥不能交叉，也不能穿过其他岛。',
      '两岛之间最多架两座桥；每个岛连出的桥数等于岛上的数字。',
      '所有岛必须连成一个整体。',
    ],
    sizes: [[7, 7], [10, 10], [13, 13]],
    defaultSize: [7, 7],
    sizeRange: { min: 5, max: 20 },
  },
  {
    id: 'hitori',
    prefix: 'HT',
    name: '数壹',
    en: 'Hitori',
    intro: '涂黑部分格子，使每行每列剩下的数字不重复。',
    rules: [
      '涂黑部分格子，使每行、每列中未涂黑的数字都不重复。',
      '涂黑的格子不能上下左右相邻。',
      '未涂黑的格子必须全部连通。',
      '只涂必要的格子：被涂黑的数字，在同行或同列中必须还有未涂黑的相同数字。',
    ],
    sizes: [[5, 5], [6, 6], [8, 8], [10, 10]],
    defaultSize: [6, 6],
    sizeRange: { min: 4, max: 12, square: true },
  },
];

export function getGame(id) {
  return GAMES.find((g) => g.id === id) || null;
}

export function isValidSize(game, width, height) {
  if (game.sizes.some(([w, h]) => w === width && h === height)) return true;
  const r = game.sizeRange;
  if (r.fixed) return false;
  if (r.square && width !== height) return false;
  return width >= r.min && width <= r.max && height >= r.min && height <= r.max;
}

const LETTERS = { easy: 'E', medium: 'M', hard: 'H' };

/** 题号：前缀-宽x高-难度-种子，例如 SD-9x9-M-123456 */
export function formatCode(gameId, { width, height, difficulty, seed }) {
  return `${getGame(gameId).prefix}-${width}x${height}-${LETTERS[difficulty]}-${seed}`;
}

/** 解析题号；省略前缀时视为 defaultGame。返回 { game, width, height, difficulty, seed } 或 { error }。 */
export function parseCode(text, defaultGame = null) {
  const m = /^\s*(?:([A-Za-z]{2})\s*-\s*)?(\d+)\s*[x×*]\s*(\d+)\s*-\s*([EMH])\s*-\s*(\d+)\s*$/i.exec(text || '');
  if (!m) return { error: '题号格式不正确，应类似 SD-9x9-M-123456' };
  const game = m[1] ? GAMES.find((g) => g.prefix === m[1].toUpperCase()) : getGame(defaultGame);
  if (!game) return { error: `未知的游戏前缀：${m[1]}` };
  const width = Number(m[2]);
  const height = Number(m[3]);
  const seed = Number(m[5]);
  if (!isValidSize(game, width, height)) return { error: `${game.name}不支持 ${width}×${height} 的尺寸` };
  if (!Number.isSafeInteger(seed) || seed <= 0) return { error: '种子无效' };
  const letter = m[4].toUpperCase();
  const difficulty = Object.keys(LETTERS).find((d) => LETTERS[d] === letter);
  return { game: game.id, width, height, difficulty, seed };
}
