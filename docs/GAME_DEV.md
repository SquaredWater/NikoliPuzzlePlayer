# 新增谜题类型开发指南

每种谜题放在 `src/games/<id>/` 下，至少包含两个文件：

- `index.js`：规则模块，**与平台无关**（Node 与浏览器 Worker 都会加载，不能访问 DOM）
- `view.js`：浏览器端的绘制与输入

游戏元数据（名称、规则说明、尺寸预设、题号前缀）登记在 `src/games/registry.js`。
参考实现：`src/games/sudoku/`（使用通用推理引擎）。

## 1. 规则模块 `index.js`

```js
export function generate({ width, height, difficulty, seed }) → puzzle
export function solutionCount(puzzle, opts) → { count, aborted }   // 测试用：回溯计数
export default {
  id, generate,
  initialState(puzzle) → state            // 空白盘面
  isSolved(puzzle, state) → boolean
  findWrong(puzzle, state) → item[]        // 玩家已填内容中与答案矛盾的条目；只看“实际作答”，忽略辅助标记（×、点）
  hint(puzzle, state) → { state, message } | null   // 按推理顺序给出下一步正确内容；已完成时返回 null
  solvedState(puzzle) → state              // 答案状态（isSolved 必须为真）
  progress(puzzle, state) → string         // 可选，状态栏进度文字
}
```

约定：

- `puzzle` 必须是可 JSON 序列化的普通对象（不要用 TypedArray/Map），包含
  `game`、`width`、`height`、`difficulty`、`seed`、答案，以及建议的 `order`（提示顺序）和 `grade: { level, steps }`。
  题号 `code` 由外壳添加，生成器不用管。
- `state` 也必须是可 JSON 序列化的普通对象，且**不可变**：任何修改都返回新对象。
- 随机性只能来自 `createRng(seed)`（`src/engine/rng.js`），相同参数必须生成完全相同的题。
- `hint` 不能引入错误：返回的状态里 `findWrong` 必须为空（应同时修正它所涉及的错误条目）。
  反复调用 `hint` 必须能从空盘走到 `isSolved`。
- 由于题目唯一解，`isSolved` 可以直接与答案比较（忽略辅助标记）。

### 难度与唯一解

推荐使用通用推理引擎 `src/engine/logic.js`：把谜题建模为变量 + 候选位掩码，提供两级规则，
引擎自动提供第 3 级“试探”（假设一个取值，用 1~2 级规则推出矛盾则排除）。
逻辑求解成功即意味着答案唯一。

```js
const model = {
  size,                       // 变量个数
  domains() → Uint32Array,    // 初始候选（第 k 位 = 可取值 k）
  rules: [[一级规则...], [二级规则...]],  // rule(D) → 是否有变化；只做严格成立的推理；矛盾时 D.bad = true
  check(D)?,                  // 可选：部分赋值的全局矛盾检查，返回 false 表示矛盾
  validate(values) → boolean, // 完整赋值的最终校验（连通、单回路等全局规则必须在这里检查）
};
logicSolve(model, maxLevel) → { solved, level, steps, values, order, ... }
countSolutions(model, { limit, nodeLimit }) → { count, aborted, solution }
```

`D`（Domains）常用方法：`D.dom[v]`、`D.isFixed(v)`、`D.value(v)`、`D.set(v, val)`、`D.remove(v, val)`、`D.restrict(v, mask)`。

难度约定（`src/engine/generate.js` 的 `DIFFICULTY_LEVELS`）：

| 难度 | 允许的最高推理等级 | 期望实际用到的等级 |
| --- | --- | --- |
| easy | 1 | 1 |
| medium | 2 | 2 |
| hard | 3（试探） | 3 |

常用生成套路（见数独）：

1. 随机生成一个合法的完整答案；
2. 由答案得出全部线索；
3. 用 `minimizeClues` 按随机顺序删线索，删后仍能在 `maxLevel` 内逻辑解出才保留删除；
   线索不能删的谜题（如数墙、数桥），则改为“生成 → 逻辑求解 → 局部修补/重试”；
4. 用 `pickGraded` 多次尝试，挑选达到 `minLevel` 且推理最复杂的一道。

性能目标：最大预设尺寸单题平均 < 1 秒、最坏 < 3 秒；小尺寸应在几十毫秒级。

## 2. 视图模块 `view.js`

```js
export default {
  controls: ['操作说明...'],
  size(puzzle) → { cols, rows },       // 盘面占多少“格”（可含小数，用于留边）
  draw(ctx, { puzzle, state, unit, showErrors, wrong, ui, solved }),
  createInput(api) → { ui, down(p, ev), move?(p, ev), up?(p, ev), cancel?(), key?(ev) → boolean },
  pad?(puzzle, ui) → [{ label, key, active?, title? }],   // 可选：盘面下方的按钮，点击时以 key(ev) 方式传入
};
```

- `draw` 时画布原点已平移到盘面左上角，1 格 = `unit` 像素。`wrong` 是“检查”时要闪烁标红的 `findWrong` 结果（否则为 null）。
  `showErrors` 为真时，应把明显违反规则的地方标红（如数字重复、灯泡互照）。
- `p = { x, y }` 是以“格”为单位的坐标；`ev = { button(0 左 / 2 右), shiftKey, ctrlKey, pointerType }`。
  键盘：`ev = { key, code, shiftKey, fromPad }`，处理了返回 `true`。
- `api`：`puzzle()`、`state()`、`apply(newState, message?)`（提交新状态，返回是否变化）、`redraw()`、`message(text, kind?)`。
- 交互的临时状态（选中格、拖动中等）放在 `ui` 里，由 `draw` 读取。
- 共用工具：`src/app/draw.js`（网格、文字、圆、叉、最近格线边等）、`src/app/digits.js`（数字键、笔记）。

## 3. 测试

- `node --test`：`test/games.test.js` 会自动对每个已实现的游戏检查：可复现、唯一解、答案判定、提示走完全程、撤销/重做等。
  只测一个游戏：PowerShell 下 `$env:GAME='sudoku'; node --test test/games.test.js`。
- `node scripts/bench.js <id> [数量]`：各尺寸/难度的生成耗时与难度分布。
- `node scripts/smoke.js <id>`：浏览器冒烟测试（需先 `node server.js 8765`），截图在 `%TEMP%/opencode/smoke/`。
