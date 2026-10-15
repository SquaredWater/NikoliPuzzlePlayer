# Nikoli 谜题合集

[![Test](https://github.com/SquaredWater/NikoliPuzzlePlayer/actions/workflows/test.yml/badge.svg)](https://github.com/SquaredWater/NikoliPuzzlePlayer/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

在浏览器中游玩程序生成的经典 Nikoli 纸笔谜题。每道题都保证唯一解，并且只靠逻辑就能解出。项目没有任何依赖，也不需要构建。

**在线试玩：<https://squaredwater.github.io/NikoliPuzzlePlayer/>**

## 收录的谜题

| 谜题 | 前缀 | 玩法 |
| --- | --- | --- |
| 数独 Sudoku | SD | 每行、列、宫填入不重复的数字 |
| 数和 Kakuro | KK | 填数字，使每段之和等于提示，段内不重复 |
| 数方 Shikaku | SK | 把盘面切成矩形，每块恰含一个数字且面积相等 |
| 数回 Slitherlink | SL | 沿点线画单一回路，数字表示四周的边数 |
| 珍珠 Masyu | MY | 画经过所有珍珠的回路，黑珠转弯、白珠直行 |
| 数墙 Nurikabe | NK | 涂黑形成连通的墙，留白岛屿大小等于数字 |
| 美术馆 Akari | AK | 放灯泡照亮所有白格，灯泡互不照到 |
| 数桥 Hashiwokakero | HS | 在岛之间架桥，桥数等于数字且全部连通 |
| 数壹 Hitori | HT | 涂黑格子使每行每列剩余数字不重复 |

每种谜题都支持：

- 选择尺寸和难度，随时换题
- 撤销 / 重做（Ctrl+Z / Ctrl+Y）、重置盘面
- 检查、提示、显示答案，违规处标红
- 用题号分享题目
- 进度自动保存在本机浏览器

## 本地运行

需要 [Node.js](https://nodejs.org/) 18 或更高版本。

```bash
git clone https://github.com/SquaredWater/NikoliPuzzlePlayer.git
cd NikoliPuzzlePlayer
npm start        # 打开 http://localhost:8080
```

也可以指定端口：`node server.js 3000`。页面用到了 ES 模块和 Web Worker，不能直接双击 HTML 文件打开，需要通过本地服务器访问。任何静态文件服务器都可以。

## 难度与题号

生成器用模拟人工推理的逻辑求解器验证每道题，并按解题时用到的最高推理等级分级：

| 难度 | 推理等级 |
| --- | --- |
| 简单 | 只用最直接的规则（如唯一候选） |
| 中等 | 需要组合推理（如区块排除、连通性、局部枚举） |
| 困难 | 需要试探：假设某一步成立，推出矛盾后排除 |

题号格式为 `前缀-宽x高-难度-种子`，例如 `SD-9x9-M-123456`。同一个题号总是生成同一道题，可以发给别人一起玩。

## 开发

```bash
npm test                          # 运行全部单元测试
npm run bench                     # 统计生成速度与难度分布
node scripts/bench.js sudoku 10   # 只测某种谜题，生成 10 道
```

浏览器冒烟测试需要本机装有 Chrome 和 Node.js 22 以上版本。先运行 `node server.js 8765`，再运行：

```bash
npm run smoke -- sudoku           # 或 node scripts/smoke.js <游戏id> [题号]
```

Chrome 不在默认位置时，用环境变量 `CHROME` 指定路径。截图保存在系统临时目录下的 `nikoli-smoke/` 中。

### 目录结构

```
index.html            主页（选择谜题）
play.html             通用游戏页：play.html?game=<id>
server.js             零依赖静态服务器
src/engine/           与平台无关的公共部分：逻辑推理引擎、生成工具、对局会话、随机数
src/games/<id>/       各谜题：index.js 规则与生成（可在 Node 中运行），view.js 绘制与输入
src/games/registry.js 谜题列表与题号编码
src/app/              浏览器外壳：主页、游戏页、Web Worker、绘制工具
test/                 单元测试（node:test）
scripts/              性能统计与浏览器冒烟测试
docs/GAME_DEV.md      新增谜题的开发指南
```

想新增一种谜题，请先阅读 [docs/GAME_DEV.md](docs/GAME_DEV.md)。欢迎提交 Issue 和 Pull Request。

## 许可证

[MIT](LICENSE)
