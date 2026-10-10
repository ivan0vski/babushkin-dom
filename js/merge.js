// Логика поля без DOM — проверяется тестами в tests/.
import { CHAINS, GENERATORS } from './items.js';

export const COLS = 7;
export const ROWS = 9;
export const SIZE = COLS * ROWS;
export const SAVE_VERSION = 1;

export const idx = (x, y) => y * COLS + x;

// Клетка: null | { c: цепочка, l: уровень } | { g: генератор }
export function newState() {
  const cells = Array(SIZE).fill(null);
  cells[idx(3, 4)] = { g: 'chest' };
  const junk = [[0, 0, 'tools', 1], [1, 0, 'tools', 1], [6, 0, 'dishes', 1], [5, 8, 'dishes', 1], [0, 8, 'tools', 2]];
  for (const [x, y, c, l] of junk) cells[idx(x, y)] = { c, l };
  return { v: SAVE_VERSION, cells };
}

export const maxLevel = (c) => CHAINS[c].items.length;

export function canMerge(a, b) {
  return !!a && !!b && !a.g && a.c === b.c && a.l === b.l && a.l < maxLevel(a.c);
}

// Перетаскивание from → to. Возвращает 'merge' | 'move' | 'swap' | 'none'.
export function moveItem(state, from, to) {
  const a = state.cells[from];
  const b = state.cells[to];
  if (from === to || !a) return 'none';
  if (canMerge(a, b)) {
    state.cells[to] = { c: a.c, l: a.l + 1 };
    state.cells[from] = null;
    return 'merge';
  }
  state.cells[to] = a;
  state.cells[from] = b;
  return b ? 'swap' : 'move';
}

// Ставит предмет 1-го уровня в ближайшую пустую клетку. Возвращает её индекс или -1.
export function spawn(state, genIndex, rng = Math.random) {
  const gen = state.cells[genIndex];
  if (!gen || !gen.g) return -1;
  const gx = genIndex % COLS;
  const gy = Math.floor(genIndex / COLS);
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < SIZE; i++) {
    if (state.cells[i]) continue;
    const d = Math.abs(i % COLS - gx) + Math.abs(Math.floor(i / COLS) - gy);
    if (d < bestDist) { best = i; bestDist = d; }
  }
  if (best < 0) return -1;
  const chains = GENERATORS[gen.g].chains;
  state.cells[best] = { c: chains[Math.floor(rng() * chains.length)], l: 1 };
  return best;
}

// Проверяет загруженное сохранение; битые клетки становятся пустыми.
export function sanitize(raw) {
  if (!raw || !Array.isArray(raw.cells) || raw.cells.length !== SIZE) return null;
  const cells = raw.cells.map((it) => {
    if (!it || typeof it !== 'object') return null;
    if (it.g) return GENERATORS[it.g] ? { g: it.g } : null;
    if (!CHAINS[it.c] || !Number.isInteger(it.l) || it.l < 1 || it.l > maxLevel(it.c)) return null;
    return { c: it.c, l: it.l };
  });
  return { v: SAVE_VERSION, cells };
}
