// 动态加载某个游戏的规则模块（index）或视图模块（view）。
//
// 部署时 scripts/build.js 会给所有静态的模块路径加上 ?v=<版本号>，但它改不了运行时才拼出来的路径。
// 这里从本模块自己的地址上取出同一个 ?v=，接到动态路径后面，保证换版本时所有模块都来自同一个版本。
// 本地开发时没有版本号，VERSION 为空串。
const VERSION = new URL(import.meta.url).search;

export function loadGame(gameId, part) {
  return import(new URL(`../games/${gameId}/${part}.js${VERSION}`, import.meta.url).href);
}
