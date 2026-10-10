import { createBoard, trySwap, isAdjacent } from './match3.js';
import { createView, TILE_FILES } from './view.js';
import { levelConfig } from './levels.js';
import { createSaver, loadSave } from './save.js';

const $ = (id) => document.getElementById(id);
let view; // сцена Phaser с полем
let progress; // сохраняемое: { level, stars }
let board;
let moves;
let goals; // цвет → сколько осталось собрать
let busy = false;
let selected = -1;
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

export function sanitizeProgress(p) {
  const ok = (n, min) => Number.isInteger(n) && n >= min;
  return p && ok(p.level, 1) && ok(p.stars, 0) ? { level: p.level, stars: p.stars } : { level: 1, stars: 0 };
}

function tileIcon(c) {
  const img = document.createElement('img');
  img.src = `assets/tiles/${TILE_FILES[c]}.png`;
  img.alt = '';
  return img;
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
    g.append(tileIcon(c), n === 0 ? '✓' : String(n));
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
  view.clear();
  view.render(board.cells, 'init');
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
    await view.bounce(board.cells, a, b); // нет совпадения — фишки съезжаются и возвращаются
    busy = false;
    return;
  }
  moves--;
  res.collected.forEach((n, c) => { if (c in goals) goals[c] = Math.max(0, goals[c] - n); });
  for (const st of res.steps) {
    const anim = view.render(st.cells, st.kind);
    if (st.kind === 'clear') renderHud();
    await anim;
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
  selected = i;
  view.select(i);
}

function tap(i) {
  if (busy) return;
  if (selected >= 0 && isAdjacent(selected, i)) swap(selected, i);
  else select(selected === i ? -1 : i);
}

$('restart').addEventListener('click', () => { if (!busy) startLevel(); });

// --- Жизненный цикл: сворачивание, потеря фокуса ---
function setupLifecycle() {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      view.cancelPress();
      saver.flush();
      ysdk?.features?.GameplayAPI?.stop();
    } else {
      ysdk?.features?.GameplayAPI?.start();
    }
  });
  window.addEventListener('pagehide', () => saver.flush());
  window.addEventListener('blur', () => view.cancelPress());
  document.addEventListener('contextmenu', (e) => e.preventDefault());
}

async function start() {
  const sdk = await initSdk();
  ysdk = sdk.ysdk;
  const storage = safeLocalStorage();
  progress = sanitizeProgress(await loadSave({ player: sdk.player, storage }));
  saver = createSaver({ player: sdk.player, storage });
  view = await createView($('stage'));
  view.onSwap = swap;
  view.onTap = tap;
  setupLifecycle();
  startLevel();
  info(ysdk ? 'Меняй соседние фишки местами: 3 в ряд' : 'Локальный режим (без SDK) · меняй соседние фишки');
  // Для автопроверки в браузере: ?debug открывает доступ к полю и ходу.
  if (new URLSearchParams(location.search).has('debug')) window.debugGame = { board: () => board, swap, moves: () => moves };
  ysdk?.features?.LoadingAPI?.ready();
  ysdk?.features?.GameplayAPI?.start();
}

start();
