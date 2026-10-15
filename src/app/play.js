// 通用游戏页：play.html?game=<id>[&code=<题号>]
// 负责工具栏、生成（Web Worker）、存档、计时、画布尺寸与指针/键盘事件分发；
// 具体规则与绘制由 games/<id>/index.js 与 games/<id>/view.js 提供。
import { Session } from '../engine/session.js';
import { DIFFICULTIES, DIFFICULTY_LABELS } from '../engine/generate.js';
import { randomSeed } from '../engine/rng.js';
import { formatCode, getGame, parseCode } from '../games/registry.js';

const PAD = 4;
const PREFS_KEY = 'nikoli.prefs';

const $ = (id) => document.getElementById(id);
const els = {
  title: $('title'),
  size: $('size'),
  difficulty: $('difficulty'),
  code: $('code'),
  status: $('status'),
  message: $('message'),
  canvas: $('board'),
  wrap: $('board-wrap'),
  pad: $('pad'),
  showErrors: $('opt-errors'),
  undo: $('btn-undo'),
  redo: $('btn-redo'),
};
const ctx = els.canvas.getContext('2d');

const params = new URLSearchParams(location.search);
const meta = getGame(params.get('game'));
if (!meta) location.replace('index.html');
const saveKey = meta && `nikoli.save.${meta.id}`;

let rules = null;
let view = null;
let session = null;
let input = null;
let generating = false;
let flash = null; // { items, until }
let unit = 40;
let lastTick = performance.now();
let lastSolved = false;

// ---------------------------------------------------------------------------
// 题目生成
// ---------------------------------------------------------------------------

let worker = null;
let requestSeq = 0;
const pending = new Map();
try {
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const job = pending.get(e.data.id);
    if (!job) return;
    pending.delete(e.data.id);
    if (e.data.error) job.reject(new Error(e.data.error));
    else job.resolve(e.data.puzzle);
  };
  worker.onerror = () => {
    worker = null;
    for (const [, job] of pending) job.fallback();
    pending.clear();
  };
} catch {
  worker = null;
}

function requestPuzzle(p) {
  return new Promise((resolve, reject) => {
    const runLocal = () =>
      setTimeout(() => {
        try {
          resolve(rules.generate(p));
        } catch (err) {
          reject(err);
        }
      }, 0);
    if (!worker) return runLocal();
    const id = ++requestSeq;
    pending.set(id, { resolve, reject, fallback: runLocal });
    worker.postMessage({ id, game: meta.id, params: p });
  });
}

let latestRequest = 0;
async function startNew(p) {
  const ticket = ++latestRequest;
  generating = true;
  setMessage('正在生成题目…');
  updateUI();
  draw();
  const t0 = performance.now();
  try {
    const puzzle = await requestPuzzle(p);
    if (ticket !== latestRequest) return;
    puzzle.code = formatCode(meta.id, puzzle);
    setSession(new Session(rules, puzzle));
    setMessage(`已生成新题（${Math.round(performance.now() - t0)} ms）`);
  } catch (err) {
    if (ticket !== latestRequest) return;
    setMessage(`生成失败：${err.message}`, 'error');
  } finally {
    if (ticket === latestRequest) generating = false;
  }
  save();
  syncSelectors();
  layout();
  updateUI();
}

function setSession(s) {
  session = s;
  lastSolved = s.solved;
  flash = null;
  input = view.createInput(inputApi);
}

function confirmDiscard() {
  if (!session || session.solved || session.moves === 0) return true;
  return window.confirm('当前题目尚未完成，确定放弃吗？');
}

function newPuzzleFromSelectors() {
  const [width, height] = els.size.value.split('x').map(Number);
  startNew({ width, height, difficulty: els.difficulty.value, seed: randomSeed() });
}

// ---------------------------------------------------------------------------
// 存档
// ---------------------------------------------------------------------------

function save() {
  if (!session) return;
  try {
    localStorage.setItem(
      saveKey,
      JSON.stringify({ puzzle: session.puzzle, session: session.toJSON(), solved: session.solved, savedAt: Date.now() }),
    );
  } catch {
    // 存储不可用时静默忽略
  }
}

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(saveKey));
    if (!data || !data.puzzle || data.puzzle.game !== meta.id) return false;
    setSession(new Session(rules, data.puzzle, data.session));
    return true;
  } catch {
    return false;
  }
}

function loadPrefs() {
  try {
    const prefs = JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
    if (typeof prefs.showErrors === 'boolean') els.showErrors.checked = prefs.showErrors;
  } catch {
    // ignore
  }
}

function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ showErrors: els.showErrors.checked }));
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// 绘制
// ---------------------------------------------------------------------------

function layout() {
  if (!session) return;
  const { cols, rows } = view.size(session.puzzle);
  const availW = els.wrap.clientWidth - PAD * 2;
  const availH = Math.max(260, window.innerHeight - els.canvas.getBoundingClientRect().top - 24);
  unit = Math.max(16, Math.min(56, Math.floor(availW / cols), Math.floor(availH / rows)));
  const dpr = window.devicePixelRatio || 1;
  const cssW = Math.ceil(cols * unit) + PAD * 2;
  const cssH = Math.ceil(rows * unit) + PAD * 2;
  els.canvas.style.width = `${cssW}px`;
  els.canvas.style.height = `${cssH}px`;
  els.canvas.width = Math.round(cssW * dpr);
  els.canvas.height = Math.round(cssH * dpr);
  draw();
}

function draw() {
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
  els.canvas.classList.toggle('busy', generating);
  if (!session) return;
  ctx.setTransform(dpr, 0, 0, dpr, PAD * dpr, PAD * dpr);
  ctx.save();
  view.draw(ctx, {
    puzzle: session.puzzle,
    state: session.state,
    unit,
    showErrors: els.showErrors.checked,
    wrong: flash && performance.now() < flash.until ? flash.items : null,
    ui: input.ui,
    solved: session.solved,
  });
  ctx.restore();
}

// ---------------------------------------------------------------------------
// 界面状态
// ---------------------------------------------------------------------------

function formatTime(ms) {
  const total = Math.floor(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function setMessage(text, kind = '') {
  els.message.textContent = text;
  els.message.className = kind;
}

function updateStatus() {
  if (!session) {
    els.status.textContent = '';
    return;
  }
  const p = session.puzzle;
  const parts = [
    `${p.width}×${p.height}`,
    DIFFICULTY_LABELS[p.difficulty],
    `用时 ${formatTime(session.elapsedMs)}`,
    `步数 ${session.moves}`,
    `提示 ${session.hintsUsed}`,
  ];
  const progress = session.progress();
  if (progress) parts.push(progress);
  if (session.revealed) parts.push('已看答案');
  els.status.textContent = parts.join(' · ');
}

function renderPad() {
  els.pad.replaceChildren();
  if (!session || !view.pad) return;
  for (const item of view.pad(session.puzzle, input.ui)) {
    const btn = document.createElement('button');
    btn.textContent = item.label;
    if (item.title) btn.title = item.title;
    if (item.active) btn.classList.add('active');
    btn.disabled = generating || session.solved;
    btn.addEventListener('click', () => {
      if (inputLocked()) return;
      input.key({ key: item.key, fromPad: true, shiftKey: false, ctrlKey: false });
      renderPad();
    });
    els.pad.append(btn);
  }
}

function updateUI() {
  const busy = generating || !session;
  els.undo.disabled = busy || !session.canUndo;
  els.redo.disabled = busy || !session.canRedo;
  for (const id of ['btn-reset', 'btn-check', 'btn-hint', 'btn-reveal', 'btn-copy']) $(id).disabled = busy;
  if (session && document.activeElement !== els.code) els.code.value = session.puzzle.code;
  updateStatus();
  renderPad();
}

function syncSelectors() {
  if (!session) return;
  const { width, height, difficulty } = session.puzzle;
  const value = `${width}x${height}`;
  if (![...els.size.options].some((o) => o.value === value)) els.size.add(new Option(`${width}×${height}`, value));
  els.size.value = value;
  els.difficulty.value = difficulty;
}

function afterAction(message) {
  flash = null;
  if (message !== undefined) setMessage(message);
  if (session.solved && !lastSolved) {
    const extra = session.revealed
      ? '（已看答案）'
      : `用时 ${formatTime(session.elapsedMs)}，步数 ${session.moves}，提示 ${session.hintsUsed} 次`;
    setMessage(`完成！${extra}`, 'success');
  }
  lastSolved = session.solved;
  save();
  updateUI();
  draw();
}

// ---------------------------------------------------------------------------
// 输入
// ---------------------------------------------------------------------------

function inputLocked() {
  return !session || generating || session.solved;
}

const inputApi = {
  puzzle: () => session.puzzle,
  state: () => session.state,
  /** 提交新盘面；返回是否有变化。 */
  apply(next, message) {
    if (inputLocked()) return false;
    const changed = session.apply(next);
    if (changed || message !== undefined) afterAction(changed && message === undefined ? '' : message);
    return changed;
  },
  redraw: () => {
    draw();
    renderPad();
  },
  message: (text, kind) => setMessage(text, kind),
};

function boardPoint(e) {
  const rect = els.canvas.getBoundingClientRect();
  return { x: (e.clientX - rect.left - PAD) / unit, y: (e.clientY - rect.top - PAD) / unit };
}

function eventInfo(e) {
  return { button: e.button, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey || e.metaKey, pointerType: e.pointerType };
}

let pointerActive = false;

els.canvas.addEventListener('pointerdown', (e) => {
  if (!session || generating) return;
  if (session.solved) {
    setMessage('本题已完成，可以换题，或重置盘面后再玩。', 'success');
    return;
  }
  if (e.button !== 0 && e.button !== 2) return;
  e.preventDefault();
  els.canvas.focus();
  els.canvas.setPointerCapture(e.pointerId);
  pointerActive = true;
  input.down(boardPoint(e), eventInfo(e));
});

els.canvas.addEventListener('pointermove', (e) => {
  if (!pointerActive || inputLocked()) return;
  input.move && input.move(boardPoint(e), eventInfo(e));
});

els.canvas.addEventListener('pointerup', (e) => {
  if (!pointerActive) return;
  pointerActive = false;
  if (!inputLocked() && input.up) input.up(boardPoint(e), eventInfo(e));
});

els.canvas.addEventListener('pointercancel', () => {
  pointerActive = false;
  if (input && input.cancel) input.cancel();
});

els.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

function doUndo() {
  if (session && !generating && session.undo()) afterAction('');
}

function doRedo() {
  if (session && !generating && session.redo()) afterAction('');
}

document.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  const key = e.key.toLowerCase();
  if (e.ctrlKey || e.metaKey) {
    if (key === 'z' && !e.shiftKey) {
      e.preventDefault();
      doUndo();
    } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
      e.preventDefault();
      doRedo();
    }
    return;
  }
  if (inputLocked() || !input.key) return;
  if (input.key({ key: e.key, code: e.code, shiftKey: e.shiftKey, ctrlKey: false, fromPad: false })) {
    e.preventDefault();
    renderPad();
  }
});

els.undo.addEventListener('click', doUndo);
els.redo.addEventListener('click', doRedo);

$('btn-new').addEventListener('click', () => {
  if (confirmDiscard()) newPuzzleFromSelectors();
});

for (const sel of [els.size, els.difficulty]) {
  sel.addEventListener('change', () => {
    if (confirmDiscard()) newPuzzleFromSelectors();
    else syncSelectors();
  });
}

$('btn-reset').addEventListener('click', () => {
  if (!session || generating) return;
  afterAction(session.reset() ? '盘面已清空（可撤销）' : '盘面已经是空的');
});

$('btn-check').addEventListener('click', () => {
  if (!session || generating) return;
  const wrong = session.findWrong();
  if (wrong.length) {
    flash = { items: wrong, until: performance.now() + 2500 };
    setMessage(`有 ${wrong.length} 处与答案不符（红色标出）`, 'error');
    setTimeout(draw, 2550);
  } else {
    setMessage(session.solved ? '已经完成了！' : '目前没有发现错误');
  }
  draw();
});

$('btn-hint').addEventListener('click', () => {
  if (inputLocked()) {
    if (session && session.solved) setMessage('本题已经完成了');
    return;
  }
  const res = session.hint();
  afterAction(res ? `提示：${res.message || '已填入一步'}` : '没有可以提示的了');
});

$('btn-reveal').addEventListener('click', () => {
  if (!session || generating) return;
  if (!window.confirm('确定显示完整答案吗？')) return;
  session.reveal();
  afterAction('已显示答案（可撤销）');
});

function loadCode(text) {
  const parsed = parseCode(text, meta.id);
  if (parsed.error) {
    setMessage(parsed.error, 'error');
    return;
  }
  if (parsed.game !== meta.id) {
    location.href = `play.html?game=${parsed.game}&code=${encodeURIComponent(text.trim())}`;
    return;
  }
  if (!confirmDiscard()) return;
  const { width, height, difficulty, seed } = parsed;
  startNew({ width, height, difficulty, seed });
}

$('btn-load').addEventListener('click', () => loadCode(els.code.value));
els.code.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loadCode(els.code.value);
});

$('btn-copy').addEventListener('click', async () => {
  if (!session) return;
  try {
    await navigator.clipboard.writeText(session.puzzle.code);
    setMessage(`已复制题号 ${session.puzzle.code}`);
  } catch {
    els.code.select();
    setMessage('无法访问剪贴板，请手动复制题号');
  }
});

els.showErrors.addEventListener('change', () => {
  savePrefs();
  draw();
});

// ---------------------------------------------------------------------------
// 计时与启动
// ---------------------------------------------------------------------------

setInterval(() => {
  const now = performance.now();
  const delta = now - lastTick;
  lastTick = now;
  if (session && !generating && !session.solved && document.visibilityState === 'visible') {
    session.elapsedMs += delta;
    updateStatus();
  }
}, 500);

document.addEventListener('visibilitychange', () => {
  lastTick = performance.now();
  if (document.visibilityState === 'hidden') save();
});
window.addEventListener('pagehide', save);
window.addEventListener('resize', layout);

function fillList(el, lines) {
  el.replaceChildren(
    ...lines.map((line) => {
      const li = document.createElement('li');
      li.textContent = line;
      return li;
    }),
  );
}

async function init() {
  document.title = `${meta.name} ${meta.en}`;
  els.title.textContent = `${meta.name} ${meta.en}`;
  [rules, view] = await Promise.all([
    import(`../games/${meta.id}/index.js`).then((m) => m.default),
    import(`../games/${meta.id}/view.js`).then((m) => m.default),
  ]);
  fillList($('rules'), meta.rules);
  fillList($('controls'), view.controls || []);
  for (const [w, h] of meta.sizes) els.size.add(new Option(`${w}×${h}`, `${w}x${h}`));
  for (const d of DIFFICULTIES) els.difficulty.add(new Option(DIFFICULTY_LABELS[d], d));
  els.size.value = `${meta.defaultSize[0]}x${meta.defaultSize[1]}`;
  els.difficulty.value = 'medium';
  loadPrefs();

  const code = params.get('code');
  const hasSave = load();
  if (code) {
    history.replaceState(null, '', `play.html?game=${meta.id}`);
    const parsed = parseCode(code, meta.id);
    if (!parsed.error && parsed.game === meta.id && (!hasSave || code.trim() !== session.puzzle.code)) {
      if (confirmDiscard()) {
        const { width, height, difficulty, seed } = parsed;
        return startNew({ width, height, difficulty, seed });
      }
    }
  }
  if (hasSave) {
    syncSelectors();
    layout();
    updateUI();
    setMessage(session.solved ? '本题已完成，可以换题。' : '已恢复上次的进度');
  } else {
    const [width, height] = meta.defaultSize;
    startNew({ width, height, difficulty: 'medium', seed: randomSeed() });
  }
}

if (meta) init();
