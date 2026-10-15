// 浏览器冒烟测试（需要本地 Chrome，并先运行 node server.js 8765）：
//   node scripts/smoke.js <游戏id> [题号]
// Chrome 不在默认位置时，用环境变量 CHROME 指定可执行文件路径。
// 依次：打开主页 → 打开游戏页 → 随机点击盘面 → 提示 ×5 → 检查 → 显示答案，
// 每步截图到系统临时目录下的 nikoli-smoke/，并输出页面上的状态文字与 JS 异常。
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const game = process.argv[2] || 'sudoku';
const code = process.argv[3] || '';
const port = Number(process.env.PORT || 8765);
const defaultChrome = {
  win32: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
}[process.platform] || 'google-chrome';
const chromePath = process.env.CHROME || defaultChrome;
const outDir = join(tmpdir(), 'nikoli-smoke');
mkdirSync(outDir, { recursive: true });
const debugPort = 9300 + Math.floor(Math.random() * 600);

const chrome = spawn(chromePath, [
  '--headless=new',
  `--remote-debugging-port=${debugPort}`,
  '--window-size=1000,1100',
  `--user-data-dir=${join(outDir, `profile-${debugPort}`)}`,
  'about:blank',
]);
chrome.on('error', (err) => {
  console.error(`无法启动 Chrome（${chromePath}）：${err.message}\n请用环境变量 CHROME 指定 Chrome 路径。`);
  process.exit(1);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets = [];
for (let i = 0; i < 60 && !targets.length; i++) {
  try {
    targets = (await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()).filter((t) => t.type === 'page');
  } catch {
    // 等待 Chrome 启动
  }
  if (!targets.length) await sleep(250);
}
const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let seq = 0;
const waiting = new Map();
const problems = [];
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && waiting.has(msg.id)) {
    waiting.get(msg.id)(msg);
    waiting.delete(msg.id);
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    problems.push(`异常: ${d.exception ? d.exception.description : d.text}`);
  }
  if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
    problems.push(`console.${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description).join(' ')}`);
  }
});
const send = (method, params = {}) =>
  new Promise((r) => {
    const id = ++seq;
    waiting.set(id, r);
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return r.result && r.result.result ? r.result.result.value : undefined;
};
const shot = async (name) => {
  const r = await send('Page.captureScreenshot');
  const file = join(outDir, `${game}-${name}.png`);
  writeFileSync(file, Buffer.from(r.result.data, 'base64'));
  console.log(`截图: ${file}`);
};
const text = (id) => evaluate(`document.getElementById('${id}') ? document.getElementById('${id}').textContent : ''`);
const click = (id) => evaluate(`document.getElementById('${id}').click()`);
const mouse = (type, x, y, button = 'left') =>
  send('Input.dispatchMouseEvent', {
    type,
    x,
    y,
    button,
    buttons: type === 'mouseReleased' ? 0 : button === 'left' ? 1 : 2,
    clickCount: 1,
  });
const waitReady = async () => {
  for (let i = 0; i < 100; i++) {
    const msg = await text('message');
    const status = await text('status');
    if (status && !msg.includes('正在生成')) return;
    await sleep(100);
  }
  problems.push('等待生成超时');
};

await send('Runtime.enable');
await send('Page.enable');
await evaluate(`localStorage.clear()`);

await send('Page.navigate', { url: `http://localhost:${port}/index.html` });
await sleep(800);
console.log('主页卡片数:', await evaluate(`document.querySelectorAll('.game-card').length`));
await shot('home');

const url = `http://localhost:${port}/play.html?game=${game}${code ? `&code=${encodeURIComponent(code)}` : ''}`;
await send('Page.navigate', { url });
await sleep(500);
await evaluate(`localStorage.removeItem('nikoli.save.${game}')`);
await waitReady();
console.log('状态:', await text('status'), '|', await evaluate(`document.getElementById('code').value`));
await shot('empty');

// 在盘面上随机点击/拖动，检查输入处理不会报错
const box = JSON.parse(await evaluate(`JSON.stringify(document.getElementById('board').getBoundingClientRect())`));
let r = 12345;
const rand = () => ((r = (r * 1103515245 + 12345) % 2147483648) / 2147483648);
for (let i = 0; i < 12; i++) {
  const x = box.left + 6 + rand() * (box.width - 12);
  const y = box.top + 6 + rand() * (box.height - 12);
  const button = i % 4 === 3 ? 'right' : 'left';
  await mouse('mousePressed', x, y, button);
  if (i % 3 === 1) await mouse('mouseMoved', x + 40, y + 5, button);
  await mouse('mouseReleased', i % 3 === 1 ? x + 40 : x, y + (i % 3 === 1 ? 5 : 0), button);
  if (i === 5) {
    for (const key of ['1', '2', 'ArrowRight', '3']) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: /\d/.test(key) ? `Digit${key}` : key, text: /\d/.test(key) ? key : undefined });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: /\d/.test(key) ? `Digit${key}` : key });
    }
  }
}
await sleep(100);
console.log('点击后:', await text('status'), '|', await text('message'));
await shot('clicks');
await click('btn-undo');
await click('btn-redo');

await click('btn-reset');
for (let i = 0; i < 5; i++) await click('btn-hint');
console.log('提示后:', await text('status'), '|', await text('message'));
await click('btn-check');
await sleep(50);
console.log('检查:', await text('message'));
await shot('hint');

await evaluate(`window.confirm = () => true`);
await click('btn-reveal');
await sleep(100);
console.log('显示答案:', await text('message'));
await shot('solved');

console.log(problems.length ? `发现问题:\n  ${problems.join('\n  ')}` : '没有 JS 异常');
ws.close();
chrome.kill();
process.exit(problems.length ? 1 : 0);
