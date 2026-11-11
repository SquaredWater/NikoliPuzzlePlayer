// 组装 GitHub Pages 站点：node scripts/build.js [输出目录] [版本号]
//
// 把 index.html、play.html、style.css、.nojekyll、src/ 拷进输出目录（默认 dist），
// 并给所有静态资源引用加上 ?v=<版本号>。GitHub Pages 对静态文件固定缓存 10 分钟，
// 加了版本号以后，新的页面一定会去取新的 CSS 和 JS，不会出现“HTML 是新的、脚本还是旧的”。
// 版本号默认取 GITHUB_SHA；本地构建时用当前时间，也可以用第二个参数指定。
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const OUT = process.argv[2] || join(ROOT, 'dist');
const VERSION = process.argv[3] || process.env.GITHUB_SHA?.slice(0, 12) || String(Date.now());
const FILES = ['index.html', 'play.html', 'style.css', '.nojekyll'];
const DIRS = ['src'];

/** 相对路径 + .js / .css → 追加 ?v=。跳过带模板插值的动态 import（如 load.js 里的 `${VERSION}`）。 */
function stamp(text) {
  return text.replace(/(['"`])((?!\.{0,2}\/\/)[^'"`$?#:]*\.(?:js|css))\1/g, (_m, q, url) => {
    if (url.includes('?v=') || url.includes('$')) return `${q}${url}${q}`;
    return `${q}${url}?v=${VERSION}${q}`;
  });
}

function walk(dir, onFile) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, onFile);
    else onFile(path);
  }
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

for (const name of FILES) {
  const from = join(ROOT, name);
  if (!existsSync(from)) throw new Error(`缺少 ${name}`);
  const to = join(OUT, name);
  if (/\.(html|css)$/.test(name)) writeFileSync(to, stamp(readFileSync(from, 'utf8')));
  else cpSync(from, to);
}

for (const name of DIRS) cpSync(join(ROOT, name), join(OUT, name), { recursive: true });

let stamped = 0;
walk(join(OUT, 'src'), (path) => {
  if (!path.endsWith('.js')) return;
  const text = readFileSync(path, 'utf8');
  const next = stamp(text);
  if (next !== text) {
    writeFileSync(path, next);
    stamped++;
  }
});

console.log(`已生成 ${OUT}（版本 ${VERSION}，改写 ${stamped} 个脚本）`);
