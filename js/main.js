import { SIZE, COLS, ROWS, newState, moveItem, spawn, sanitize, maxLevel } from './merge.js';
import { CHAINS, GENERATORS } from './items.js';
import { createSaver, loadSave } from './save.js';

const boardEl = document.getElementById('board');
const infoEl = document.getElementById('info');
const resetEl = document.getElementById('reset');
const cellEls = [];
let state;
let saver;
let ysdk = null;

async function initSdk() {
  if (!window.YaGames) return { ysdk: null, player: null };
  try {
    const sdk = await window.YaGames.init();
    let player = null;
    try { player = await sdk.getPlayer(); } catch (e) { console.warn('getPlayer failed', e); }
    return { ysdk: sdk, player };
  } catch (e) {
    console.warn('YaGames.init failed', e);
    return { ysdk: null, player: null };
  }
}

function safeLocalStorage() {
  try {
    const s = window.localStorage;
    s.getItem(''); // в некоторых браузерах доступ бросает исключение
    return s;
  } catch {
    return null;
  }
}

function itemName(it) {
  return it.g ? GENERATORS[it.g].name : CHAINS[it.c].items[it.l - 1];
}

function buildBoard() {
  boardEl.style.setProperty('--cols', COLS);
  boardEl.style.setProperty('--rows', ROWS);
  for (let i = 0; i < SIZE; i++) {
    const el = document.createElement('div');
    el.className = 'cell';
    el.dataset.i = i;
    boardEl.appendChild(el);
    cellEls.push(el);
  }
}

function renderCell(i, pop = false) {
  const it = state.cells[i];
  const el = cellEls[i];
  el.replaceChildren();
  if (!it) return;
  const d = document.createElement('div');
  d.className = 'item' + (it.g ? ' gen' : '') + (pop ? ' pop' : '');
  d.style.background = it.g ? GENERATORS[it.g].color : CHAINS[it.c].color;
  if (!it.g) {
    const lvl = document.createElement('span');
    lvl.className = 'lvl';
    lvl.textContent = it.l;
    d.appendChild(lvl);
  }
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = itemName(it);
  d.appendChild(name);
  el.appendChild(d);
}

function renderAll() {
  for (let i = 0; i < SIZE; i++) renderCell(i);
}

function info(text) {
  infoEl.textContent = text;
}

// --- Ввод: перетаскивание и тап (мышь и палец через Pointer Events) ---
let press = null; // { i, x, y, ghost, itemEl }

function cellIndexAt(x, y) {
  const el = document.elementFromPoint(x, y)?.closest('.cell');
  return el ? Number(el.dataset.i) : -1;
}

boardEl.addEventListener('pointerdown', (e) => {
  if (press || !e.isPrimary) return;
  const cell = e.target.closest('.cell');
  if (!cell) return;
  const i = Number(cell.dataset.i);
  if (!state.cells[i]) return;
  press = { i, x: e.clientX, y: e.clientY, ghost: null, itemEl: cell.firstChild };
});

window.addEventListener('pointermove', (e) => {
  if (!press || !e.isPrimary) return;
  if (!press.ghost && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 6) {
    const r = press.itemEl.getBoundingClientRect();
    const g = press.itemEl.cloneNode(true);
    g.classList.add('ghost');
    g.style.width = r.width + 'px';
    g.style.height = r.height + 'px';
    document.body.appendChild(g);
    press.itemEl.classList.add('dragging');
    press.ghost = g;
  }
  if (press.ghost) {
    press.ghost.style.left = e.clientX + 'px';
    press.ghost.style.top = e.clientY + 'px';
  }
});

window.addEventListener('pointerup', (e) => {
  if (!press || !e.isPrimary) return;
  const p = press;
  endPress();
  if (p.ghost) drop(p.i, cellIndexAt(e.clientX, e.clientY));
  else tap(p.i);
});

window.addEventListener('pointercancel', endPress);

function endPress() {
  if (!press) return;
  press.ghost?.remove();
  press.itemEl?.classList.remove('dragging');
  press = null;
}

function drop(from, to) {
  if (to < 0) return;
  const result = moveItem(state, from, to);
  if (result === 'none') return;
  renderCell(from);
  renderCell(to, result === 'merge');
  if (result === 'merge') info('Получено: ' + itemName(state.cells[to]));
  saver.save(state);
}

function tap(i) {
  const it = state.cells[i];
  if (it.g) {
    const placed = spawn(state, i);
    if (placed < 0) { info('Нет свободного места — объедини предметы'); return; }
    renderCell(placed, true);
    info('Из сундука: ' + itemName(state.cells[placed]));
    saver.save(state);
  } else {
    info(`${itemName(it)} · уровень ${it.l} из ${maxLevel(it.c)}`);
  }
}

resetEl.addEventListener('click', () => {
  if (!window.confirm('Начать поле заново?')) return;
  state = newState();
  renderAll();
  saver.save(state);
  info('Новое поле');
});

// --- Жизненный цикл: сворачивание, потеря фокуса ---
function setupLifecycle() {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      endPress();
      saver.flush();
      ysdk?.features?.GameplayAPI?.stop();
    } else {
      ysdk?.features?.GameplayAPI?.start();
    }
  });
  window.addEventListener('pagehide', () => saver.flush());
  window.addEventListener('blur', endPress);
  document.addEventListener('contextmenu', (e) => e.preventDefault());
}

async function start() {
  const sdk = await initSdk();
  ysdk = sdk.ysdk;
  const storage = safeLocalStorage();
  state = sanitize(await loadSave({ player: sdk.player, storage })) || newState();
  saver = createSaver({ player: sdk.player, storage });
  buildBoard();
  renderAll();
  setupLifecycle();
  info(ysdk ? 'Тапни сундук, перетащи одинаковые предметы друг на друга' : 'Локальный режим (без SDK) · тапни сундук');
  ysdk?.features?.LoadingAPI?.ready();
  ysdk?.features?.GameplayAPI?.start();
}

start();
