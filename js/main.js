import { W, H, createBoard, trySwap, isAdjacent } from './match3.js';
import { levelConfig } from './levels.js';
import { createSaver, loadSave } from './save.js';

const $ = (id) => document.getElementById(id);
const gridEl = $('grid');
const tileEls = new Map(); // id фишки → элемент
let progress; // сохраняемое: { level, stars }
let board;
let moves;
let goals; // цвет → сколько осталось собрать
let busy = false;
let selected = -1;
let saver;
let ysdk = null;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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

export function sanitizeProgress(p) {
  const ok = (n, min) => Number.isInteger(n) && n >= min;
  return p && ok(p.level, 1) && ok(p.stars, 0) ? { level: p.level, stars: p.stars } : { level: 1, stars: 0 };
}

function gem(t) {
  const d = document.createElement('div');
  d.className = `gem c${t.c}` + (t.s ? ` s-${t.s}` : '');
  return d;
}

// --- Отрисовка: элементы привязаны к id фишки, сдвиг анимирует CSS transition ---
function place(el, i) {
  el.style.setProperty('--x', i % W);
  el.style.setProperty('--y', Math.floor(i / W));
}

function render(cells, kind = 'fall') {
  const alive = new Set();
  const newInCol = new Array(W).fill(0);
  cells.forEach((t, i) => { if (t && !tileEls.has(t.id)) newInCol[i % W]++; });
  const fresh = [];
  cells.forEach((t, i) => {
    if (!t) return;
    alive.add(t.id);
    let el = tileEls.get(t.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'tile';
      el.appendChild(gem(t));
      if (kind === 'fall') {
        el.style.setProperty('--x', i % W);
        el.style.setProperty('--y', Math.floor(i / W) - newInCol[i % W]);
        fresh.push([el, i]);
      } else {
        el.classList.add('pop');
        place(el, i);
      }
      gridEl.appendChild(el);
      tileEls.set(t.id, el);
    } else {
      el.firstChild.className = `gem c${t.c}` + (t.s ? ` s-${t.s}` : ''); // цвет меняется при перемешивании
      place(el, i);
    }
  });
  for (const [id, el] of tileEls) {
    if (alive.has(id)) continue;
    tileEls.delete(id);
    el.classList.add('gone');
    setTimeout(() => el.remove(), 200);
  }
  if (fresh.length) {
    gridEl.getBoundingClientRect(); // применить стартовую позицию над полем до сдвига
    fresh.forEach(([el, i]) => place(el, i));
  }
}

function renderHud() {
  $('title').textContent = 'Уровень ' + progress.level;
  $('stars').textContent = '★ ' + progress.stars;
  $('moves').firstChild.textContent = moves;
  const goalsEl = $('goals');
  goalsEl.replaceChildren();
  for (const [c, n] of Object.entries(goals)) {
    const g = document.createElement('div');
    g.className = 'goal' + (n === 0 ? ' done' : '');
    g.append(gem({ c }), n === 0 ? '✓' : String(n));
    goalsEl.appendChild(g);
  }
}

function info(text) {
  $('info').textContent = text;
}

function startLevel() {
  const cfg = levelConfig(progress.level);
  board = createBoard(cfg.colors);
  moves = cfg.moves;
  goals = { ...cfg.goals };
  selected = -1;
  for (const el of tileEls.values()) el.remove();
  tileEls.clear();
  render(board.cells, 'fall');
  renderHud();
  $('overlay').hidden = true;
  busy = false;
}

function showOverlay(text, btn, onClick) {
  $('overlay-text').textContent = text;
  $('overlay-btn').textContent = btn;
  $('overlay-btn').onclick = onClick;
  $('overlay').hidden = false;
}

// --- Ход ---
async function swap(a, b) {
  select(-1);
  if (busy || a < 0 || b < 0 || !isAdjacent(a, b)) return;
  busy = true;
  const res = trySwap(board, a, b);
  if (!res) {
    // Нет совпадения — фишки меняются и возвращаются.
    const ea = tileEls.get(board.cells[a].id);
    const eb = tileEls.get(board.cells[b].id);
    place(ea, b); place(eb, a);
    await wait(180);
    place(ea, a); place(eb, b);
    await wait(180);
    busy = false;
    return;
  }
  moves--;
  res.collected.forEach((n, c) => { if (c in goals) goals[c] = Math.max(0, goals[c] - n); });
  for (const st of res.steps) {
    render(st.cells, st.kind);
    if (st.kind === 'clear') renderHud();
    await wait(st.kind === 'fall' ? 260 : 200);
  }
  renderHud();
  if (Object.values(goals).every((n) => n === 0)) {
    progress.level++;
    progress.stars++;
    saver.save(progress);
    renderHud();
    showOverlay('Уровень пройден! +1 ★', 'Дальше', startLevel);
  } else if (moves === 0) {
    showOverlay('Ходы закончились', 'Ещё раз', startLevel);
  } else {
    busy = false;
  }
}

function select(i) {
  if (selected >= 0) tileEls.get(board.cells[selected]?.id)?.classList.remove('selected');
  selected = i;
  if (i >= 0) tileEls.get(board.cells[i].id)?.classList.add('selected');
}

// --- Ввод: свайп по фишке или тап-тап по соседним (мышь и палец через Pointer Events) ---
let press = null; // { i, x, y }

function cellAt(x, y) {
  const r = gridEl.getBoundingClientRect();
  const cx = Math.floor(((x - r.left) / r.width) * W);
  const cy = Math.floor(((y - r.top) / r.height) * H);
  return cx >= 0 && cx < W && cy >= 0 && cy < H ? cy * W + cx : -1;
}

gridEl.addEventListener('pointerdown', (e) => {
  if (busy || press || !e.isPrimary) return;
  const i = cellAt(e.clientX, e.clientY);
  if (i >= 0) press = { i, x: e.clientX, y: e.clientY };
});

window.addEventListener('pointermove', (e) => {
  if (!press || !e.isPrimary) return;
  const dx = e.clientX - press.x;
  const dy = e.clientY - press.y;
  const step = gridEl.getBoundingClientRect().width / W;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < step * 0.35) return;
  const { i } = press;
  press = null;
  const x = i % W;
  const y = Math.floor(i / W);
  let j = -1;
  if (Math.abs(dx) > Math.abs(dy)) j = dx > 0 ? (x < W - 1 ? i + 1 : -1) : (x > 0 ? i - 1 : -1);
  else j = dy > 0 ? (y < H - 1 ? i + W : -1) : (y > 0 ? i - W : -1);
  swap(i, j);
});

window.addEventListener('pointerup', (e) => {
  if (!press || !e.isPrimary) return;
  const { i } = press;
  press = null;
  if (selected >= 0 && isAdjacent(selected, i)) swap(selected, i);
  else select(selected === i ? -1 : i);
});

window.addEventListener('pointercancel', () => { press = null; });

$('restart').addEventListener('click', () => { if (!busy) startLevel(); });

// --- Жизненный цикл: сворачивание, потеря фокуса ---
function setupLifecycle() {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      press = null;
      saver.flush();
      ysdk?.features?.GameplayAPI?.stop();
    } else {
      ysdk?.features?.GameplayAPI?.start();
    }
  });
  window.addEventListener('pagehide', () => saver.flush());
  window.addEventListener('blur', () => { press = null; });
  document.addEventListener('contextmenu', (e) => e.preventDefault());
}

async function start() {
  const sdk = await initSdk();
  ysdk = sdk.ysdk;
  const storage = safeLocalStorage();
  progress = sanitizeProgress(await loadSave({ player: sdk.player, storage }));
  saver = createSaver({ player: sdk.player, storage });
  setupLifecycle();
  startLevel();
  info(ysdk ? 'Меняй соседние фишки местами: 3 в ряд' : 'Локальный режим (без SDK) · меняй соседние фишки');
  ysdk?.features?.LoadingAPI?.ready();
  ysdk?.features?.GameplayAPI?.start();
}

start();
