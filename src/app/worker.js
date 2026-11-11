import { getGame } from '../games/registry.js';
import { generatePuzzle } from '../engine/generate.js';
import { loadGame } from './load.js';

const modules = new Map();

async function load(gameId) {
  if (!getGame(gameId)) throw new Error(`未知游戏：${gameId}`);
  if (!modules.has(gameId)) modules.set(gameId, (await loadGame(gameId, 'index')).default);
  return modules.get(gameId);
}

self.onmessage = async (event) => {
  const { id, game, params } = event.data;
  try {
    const rules = await load(game);
    self.postMessage({ id, puzzle: generatePuzzle(rules, params) });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message ? err.message : err) });
  }
};
