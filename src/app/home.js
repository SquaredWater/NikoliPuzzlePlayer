import { GAMES, parseCode } from '../games/registry.js';
import { DIFFICULTY_LABELS } from '../engine/generate.js';
import { icon, initUi } from './ui.js';

initUi();

function savedInfo(id) {
  try {
    const data = JSON.parse(localStorage.getItem(`nikoli.save.${id}`));
    if (!data || !data.puzzle) return null;
    const p = data.puzzle;
    const what = `${p.width}×${p.height} ${DIFFICULTY_LABELS[p.difficulty] || ''}`.trim();
    return data.solved ? { done: true, text: `已完成 ${what}` } : { done: false, text: `继续 ${what}` };
  } catch {
    return null;
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const list = document.getElementById('games');
GAMES.forEach((game, index) => {
  const card = el('a', 'game-card');
  card.href = `play.html?game=${game.id}`;

  const avatar = el('span', 'game-avatar', game.prefix);
  avatar.style.setProperty('--hue', String(Math.round(220 + (index * 360) / GAMES.length) % 360));
  avatar.setAttribute('aria-hidden', 'true');
  const names = el('div');
  names.append(el('div', 'game-title', game.name), el('div', 'game-en', game.en));
  const head = el('div', 'game-head');
  head.append(avatar, names);

  const foot = el('div', 'game-foot');
  foot.append(el('span', 'game-meta', game.sizes.map(([w, h]) => `${w}×${h}`).join(' · ')));
  const info = savedInfo(game.id);
  if (info) {
    const saved = el('span', `game-saved${info.done ? ' done' : ''}`);
    saved.append(icon(info.done ? 'check' : 'bookmark'), info.text);
    foot.append(saved);
  }

  card.append(head, el('p', 'game-intro', game.intro), foot);
  list.append(card);
});

const form = document.getElementById('code-form');
const codeInput = document.getElementById('code');
const codeError = document.getElementById('code-error');
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const parsed = parseCode(codeInput.value);
  if (parsed.error) {
    codeError.textContent = parsed.error;
    codeInput.setAttribute('aria-invalid', 'true');
    return;
  }
  location.href = `play.html?game=${parsed.game}&code=${encodeURIComponent(codeInput.value.trim())}`;
});
codeInput.addEventListener('input', () => {
  codeError.textContent = '';
  codeInput.removeAttribute('aria-invalid');
});
