// 通用游戏页：play.html?game=<id>[&code=<题号>]
// 负责工具栏、生成（Web Worker）、存档、计时、画布尺寸与指针/键盘事件分发；
// 具体规则与绘制由 games/<id>/index.js 与 games/<id>/view.js 提供。
import { Session } from '../engine/session.js';
import { actualDifficulty, DIFFICULTIES, DIFFICULTY_LABELS, EXPERT_CANDIDATES, generatePuzzle } from '../engine/generate.js';
import { randomSeed } from '../engine/rng.js';
import { formatCode, getGame, parseCode } from '../games/registry.js';
import { askConfirm, icon, initUi } from './ui.js';
import { loadGame } from './load.js';

const PAD = 4;
const MIN_UNIT = 16;
const MAX_UNIT = 56;
// 横屏手机：盘面与按键左右并排（断点与 style.css 文末的响应式规则一致）
const sideBySide = window.matchMedia('(orientation: landscape) and (max-height: 560px)');
// 并排时右侧一栏至少留这么宽，放得下数字键盘和操作栏
const TOOLS_MIN_WIDTH = 280;
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
  rulesPanel: $('rules-panel'),
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

initUi();

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
          resolve(generatePuzzle(rules, p));
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
  setMessage(p.difficulty === 'expert' ? `正在生成 ${EXPERT_CANDIDATES} 道困难题，挑最难的一道…` : '正在生成题目…');
  updateUI();
  draw();
  const t0 = performance.now();
  try {
    const puzzle = await requestPuzzle(p);
    if (ticket !== latestRequest) return;
    puzzle.code = formatCode(meta.id, puzzle);
    setSession(new Session(rules, puzzle));
    const fallback = actualDifficulty(puzzle);
    if (fallback) {
      setMessage(`这道题在 ${p.width}×${p.height} 上推不出「${DIFFICULTY_LABELS[p.difficulty]}」级别的复杂度，实际接近${DIFFICULTY_LABELS[fallback]}，换个更大的尺寸会更难。`);
    } else {
      setMessage(`已生成新题（${Math.round(performance.now() - t0)} ms）`);
    }
  } catch (err) {
    if (ticket !== latestRequest) return;
    setMessage(`生成失败：${err.message}`, 'error');
  } finally {
    if (ticket === latestRequest) generating = false;
  }
  save();
  syncSelectors();
  updateUI();
  layout();
}

function setSession(s) {
  session = s;
  lastSolved = s.solved;
  flash = null;
  input = view.createInput(inputApi);
}

async function confirmDiscard() {
  if (!session || session.solved || session.moves === 0) return true;
  return askConfirm({ title: '放弃当前题目？', text: '当前题目尚未完成，离开后进度仍会保存在本机。', ok: '放弃' });
}

function newPuzzleFromSelectors() {
  const [width, height] = els.size.value.split('x').map(Number);
  startNew({ width, height, difficulty: difficultyValue(), seed: randomSeed() });
}

// ---------------------------------------------------------------------------
// 难度分段按钮（值同时反映到 UI 上）
// ---------------------------------------------------------------------------

function renderDifficulty(value) {
  els.difficulty.replaceChildren(
    ...DIFFICULTIES.map((d) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('role', 'radio');
      btn.dataset.value = d;
      btn.setAttribute('aria-checked', String(d === value));
      btn.tabIndex = d === value ? 0 : -1;
      const check = icon('check');
      btn.append(check, document.createTextNode(DIFFICULTY_LABELS[d]));
      btn.addEventListener('click', () => selectDifficulty(d));
      return btn;
    }),
  );
}

function difficultyValue() {
  return els.difficulty.querySelector('[aria-checked="true"]')?.dataset.value || 'medium';
}

async function selectDifficulty(d) {
  const prev = difficultyValue();
  if (d === prev) return;
  renderDifficulty(d);
  if (!(await confirmDiscard())) {
    renderDifficulty(prev);
    return;
  }
  newPuzzleFromSelectors();
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
  const styles = getComputedStyle(els.wrap);
  const padX = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
  const padTop = parseFloat(styles.paddingTop);
  const padBottom = parseFloat(styles.paddingBottom);
  // 盘面卡片会收缩贴合画布，所以可用宽度取外层面板
  const pane = els.wrap.parentElement;
  const wrapRect = els.wrap.getBoundingClientRect();
  const top = wrapRect.top + window.scrollY + padTop;
  let availW;
  let availH;
  if (sideBySide.matches) {
    // 按键在盘面右侧：宽度要给右栏留位置，高度只受视口限制（盘面必须整个看得见）
    const gap = parseFloat(getComputedStyle(pane).columnGap) || 0;
    availW = pane.clientWidth - TOOLS_MIN_WIDTH - gap - padX - PAD * 2;
    availH = window.innerHeight - top - padBottom - 8 - PAD * 2;
  } else {
    availW = pane.clientWidth - padX - PAD * 2;
    // 盘面下方还有消息条、数字键盘和操作栏，把它们的高度从视口里预留出来
    const below = pane.getBoundingClientRect().bottom - wrapRect.bottom + padBottom;
    availH = Math.max(240, window.innerHeight - top - below - 16 - PAD * 2);
  }
  unit = Math.max(MIN_UNIT, Math.min(MAX_UNIT, Math.floor(Math.max(160, availW) / cols), Math.floor(availH / rows)));
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
  els.wrap.classList.toggle('busy', generating);
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
  // 闪烁的标记消失后重画一次，清掉红色标记
  clearTimeout(flashTimer);
  if (flash) flashTimer = setTimeout(draw, Math.max(0, flash.until - performance.now()) + 60);
}
let flashTimer = 0;

// ---------------------------------------------------------------------------
// 界面状态
// ---------------------------------------------------------------------------

function formatTime(ms) {
  const total = Math.floor(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function setMessage(text, kind = '') {
  els.message.replaceChildren();
  els.message.className = kind || 'empty';
  if (!text) return;
  els.message.append(icon(kind === 'success' ? 'checkAll' : kind === 'error' ? 'error' : 'info'), document.createTextNode(text));
}

function statusChip(text, iconName, extra = '') {
  const chip = document.createElement('span');
  chip.className = `chip${extra ? ` ${extra}` : ''}`;
  if (iconName) chip.append(icon(iconName));
  chip.append(document.createTextNode(text));
  return chip;
}

function updateStatus() {
  if (!session) {
    els.status.replaceChildren();
    return;
  }
  const p = session.puzzle;
  const chips = [
    statusChip(`${p.width}×${p.height} · ${DIFFICULTY_LABELS[p.difficulty]}`, 'grid'),
    statusChip(formatTime(session.elapsedMs), 'timer', 'tonal'),
    statusChip(`步数 ${session.moves}`, null, 'minor'),
    statusChip(`提示 ${session.hintsUsed}`),
  ];
  const fallback = actualDifficulty(p);
  if (fallback) chips.splice(1, 0, statusChip(`实际约${DIFFICULTY_LABELS[fallback]}`, 'info'));
  const progress = session.progress();
  if (progress) chips.push(statusChip(progress));
  if (session.revealed) chips.push(statusChip('已看答案', 'eye', 'warn'));
  els.status.replaceChildren(...chips);
}

function renderPad() {
  els.pad.replaceChildren();
  if (!session || !view.pad) return;
  for (const item of view.pad(session.puzzle, input.ui)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pad-key';
    if (item.title) btn.title = item.title;
    if (item.active) btn.classList.add('active');
    if (item.icon) btn.append(icon(item.icon));
    btn.append(document.createTextNode(item.label));
    if (item.icon || item.label.length > 1) btn.classList.add('wide');
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
  renderDifficulty(difficulty);
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
  if (document.getElementById('app-dialog')?.open) return;
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

$('btn-new').addEventListener('click', async () => {
  if (await confirmDiscard()) newPuzzleFromSelectors();
});

els.size.addEventListener('change', async () => {
  if (await confirmDiscard()) newPuzzleFromSelectors();
  else syncSelectors();
});

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

$('btn-reveal').addEventListener('click', async () => {
  if (!session || generating) return;
  if (!(await askConfirm({ title: '显示完整答案？', text: '看答案后本题仍可撤销恢复，但会计入“已看答案”。', ok: '显示答案' }))) return;
  session.reveal();
  afterAction('已显示答案（可撤销）');
});

async function loadCode(text) {
  const parsed = parseCode(text, meta.id);
  if (parsed.error) {
    setMessage(parsed.error, 'error');
    return;
  }
  if (parsed.game !== meta.id) {
    location.href = `play.html?game=${parsed.game}&code=${encodeURIComponent(text.trim())}`;
    return;
  }
  if (!(await confirmDiscard())) return;
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

$('btn-rules').addEventListener('click', () => {
  const panel = els.rulesPanel;
  panel.open = true;
  panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  panel.querySelector('summary').focus({ preventScroll: true });
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

// 手机上滚动页面时地址栏收起、点输入框时键盘弹出，都会改变视口高度并触发 resize。
// 这两种情况下重新排版会让盘面忽大忽小，所以触屏设备上宽度没变、高度只是小幅变化（或正在输入）时不重排。
const coarsePointer = window.matchMedia('(pointer: coarse)');
let layoutW = window.innerWidth;
let layoutH = window.innerHeight;
function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const typing = document.activeElement instanceof HTMLInputElement;
  if (coarsePointer.matches && w === layoutW && (typing || Math.abs(h - layoutH) < 120)) return;
  layoutW = w;
  layoutH = h;
  layout();
}
window.addEventListener('resize', onResize);
sideBySide.addEventListener('change', layout);

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
  const en = document.createElement('span');
  en.className = 'app-bar-subtitle';
  en.textContent = meta.en;
  els.title.replaceChildren(meta.name, en);
  [rules, view] = await Promise.all([
    loadGame(meta.id, 'index').then((m) => m.default),
    loadGame(meta.id, 'view').then((m) => m.default),
  ]);
  fillList($('rules'), meta.rules);
  fillList($('controls'), view.controls || []);
  for (const [w, h] of meta.sizes) els.size.add(new Option(`${w}×${h}`, `${w}x${h}`));
  renderDifficulty('medium');
  els.size.value = `${meta.defaultSize[0]}x${meta.defaultSize[1]}`;
  loadPrefs();

  const code = params.get('code');
  const hasSave = load();
  if (code) {
    history.replaceState(null, '', `play.html?game=${meta.id}`);
    const parsed = parseCode(code, meta.id);
    if (!parsed.error && parsed.game === meta.id && (!hasSave || code.trim() !== session.puzzle.code)) {
      if (await confirmDiscard()) {
        const { width, height, difficulty, seed } = parsed;
        return startNew({ width, height, difficulty, seed });
      }
    }
  }
  if (hasSave) {
    syncSelectors();
    updateUI();
    layout();
    setMessage(session.solved ? '本题已完成，可以换题。' : '已恢复上次的进度');
  } else {
    const [width, height] = meta.defaultSize;
    startNew({ width, height, difficulty: 'medium', seed: randomSeed() });
  }
}

if (meta) init();
