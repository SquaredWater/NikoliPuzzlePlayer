import { GAMES, parseCode } from '../games/registry.js';
import { DIFFICULTY_LABELS } from '../engine/generate.js';

function savedInfo(id) {
  try {
    const data = JSON.parse(localStorage.getItem(`nikoli.save.${id}`));
    if (!data || !data.puzzle) return '';
    const p = data.puzzle;
    const what = `${p.width}×${p.height} ${DIFFICULTY_LABELS[p.difficulty] || ''}`;
    return data.solved ? `上次：${what}（已完成）` : `进行中：${what}`;
  } catch {
    return '';
  }
}

const list = document.getElementById('games');
for (const game of GAMES) {
  const card = document.createElement('a');
  card.className = 'game-card';
  card.href = `play.html?game=${game.id}`;

  const title = document.createElement('div');
  title.className = 'game-title';
  title.textContent = game.name;
  const en = document.createElement('span');
  en.className = 'game-en';
  en.textContent = game.en;
  title.append(' ', en);

  const intro = document.createElement('div');
  intro.className = 'game-intro';
  intro.textContent = game.intro;

  const sizes = document.createElement('div');
  sizes.className = 'game-meta';
  sizes.textContent = `尺寸：${game.sizes.map(([w, h]) => `${w}×${h}`).join(' / ')}`;

  card.append(title, intro, sizes);
  const info = savedInfo(game.id);
  if (info) {
    const saved = document.createElement('div');
    saved.className = 'game-saved';
    saved.textContent = info;
    card.append(saved);
  }
  list.append(card);
}

const codeInput = document.getElementById('code');
const codeError = document.getElementById('code-error');
function go() {
  const parsed = parseCode(codeInput.value);
  if (parsed.error) {
    codeError.textContent = parsed.error;
    return;
  }
  location.href = `play.html?game=${parsed.game}&code=${encodeURIComponent(codeInput.value.trim())}`;
}
document.getElementById('btn-go').addEventListener('click', go);
codeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') go();
});
