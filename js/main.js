import { createBoard, trySwap, isAdjacent } from './match3.js';
import { createView, TILE_FILES } from './view.js';
import { levelConfig } from './levels.js';
import { ROOMS, sanitizeProgress, availableTasks, doTask, roomPercent, roomComplete, currentRoom, nextRoom, enterNextRoom } from './house.js';
import { createSaver, loadSave } from './save.js';
import { checkForUpdate } from './update.js';
import * as sound from './sound.js';

const $ = (id) => document.getElementById(id);
let view; // сцена Phaser с полем
let progress; // сохраняемое: { level, stars, done } — см. house.js
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

function tileIcon(c) {
  const img = document.createElement('img');
  img.src = `assets/tiles/${TILE_FILES[c]}.png`;
  img.alt = '';
  return img;
}

let shownGoals = {}; // что было на счётчиках — чтобы «подпрыгнул» только изменившийся

function renderHud() {
  $('title').textContent = 'Уровень ' + progress.level;
  $('stars').textContent = '★ ' + progress.stars;
  $('moves').firstChild.textContent = moves;
  const goalsEl = $('goals');
  goalsEl.replaceChildren();
  for (const [c, n] of Object.entries(goals)) {
    const g = document.createElement('div');
    g.className = 'goal' + (n === 0 ? ' done' : '') + (shownGoals[c] !== undefined && n < shownGoals[c] ? ' bump' : '');
    g.append(tileIcon(c), n === 0 ? '✓' : String(n));
    goalsEl.appendChild(g);
  }
  shownGoals = { ...goals };
}

function info(text) {
  $('info').textContent = text;
}

function startLevel() {
  const cfg = levelConfig(progress.level);
  board = createBoard(cfg.colors);
  moves = cfg.moves;
  goals = { ...cfg.goals };
  shownGoals = {};
  selected = -1;
  view.clear();
  view.render(board.cells, 'init');
  renderHud();
  $('overlay').hidden = true;
  busy = false;
}

// Окно поверх поля: текст и одна-две кнопки [[надпись, действие], ...].
function showOverlay(text, buttons) {
  $('overlay-text').textContent = text;
  ['overlay-btn', 'overlay-btn2'].forEach((id, k) => {
    const b = $(id);
    b.hidden = !buttons[k];
    if (buttons[k]) [b.textContent, b.onclick] = buttons[k];
  });
  $('overlay').hidden = false;
}

// --- Дом ---
let prevDone = [];

function roomDoneNote() {
  const name = currentRoom(progress).name;
  return nextRoom(progress) ? `${name}: ремонт закончен!` : `${name}: ремонт закончен! Скоро откроются новые комнаты.`;
}

function renderHouse(note = '') {
  const cur = currentRoom(progress);
  $('room-name').textContent = cur.name;
  $('house-stars').textContent = '★ ' + progress.stars;
  const pct = roomPercent(progress);
  $('cozy-fill').style.width = pct + '%';
  $('cozy-text').textContent = `Уют ${pct}%`;
  for (const r of ROOMS) $('room-' + r.id).hidden = r !== cur;
  const room = $('room-' + cur.id);
  room.className = `room ${cur.id} ` + progress.done.map((id) => 'done-' + id).join(' ');
  for (const id of progress.done.filter((d) => !prevDone.includes(d))) {
    const el = room.querySelector('.r-' + id);
    el?.classList.remove('changed');
    void el?.offsetWidth; // перезапуск анимации
    el?.classList.add('changed');
  }
  prevDone = [...progress.done];

  const list = $('tasks');
  list.replaceChildren();
  for (const t of availableTasks(progress)) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = `${t.cost} ★`;
    btn.className = progress.stars < t.cost ? 'poor' : '';
    btn.onclick = () => {
      const next = doTask(progress, t.id);
      if (!next) { renderHouse(`Нужно ★ ${t.cost} — пройди уровень, чтобы заработать звёзды`); return; }
      progress = next;
      saver.save(progress);
      sound.sfx.task();
      renderHouse(roomComplete(progress) ? roomDoneNote() : 'Готово!');
    };
    li.append(t.name, btn);
    list.appendChild(li);
  }
  const next = nextRoom(progress);
  $('next-room').hidden = !next;
  if (next) $('next-room').textContent = `Открыть: ${next.name} →`;
  $('house-note').textContent = note || (roomComplete(progress) ? roomDoneNote() : '');
  $('play').textContent = 'Играть · Уровень ' + progress.level;
}

$('next-room').addEventListener('click', () => {
  const p = enterNextRoom(progress);
  if (!p) return;
  progress = p;
  saver.save(progress);
  sound.sfx.win();
  renderHouse(`Открыта новая комната: ${currentRoom(progress).name}!`);
});

// Новая версия на сайте — обновиться. Только на экране дома: уровень не прерываем.
function updateIfNeeded() {
  if (!$('house').hidden) checkForUpdate({ beforeReload: () => saver.flush() });
}

function showHouse() {
  $('overlay').hidden = true;
  busy = true; // поле не принимает ходы, пока открыт дом
  prevDone = [...progress.done]; // анимировать только то, что сделано сейчас
  renderHouse();
  $('house').hidden = false;
  updateIfNeeded();
}

function play() {
  sound.sfx.tap();
  $('house').hidden = true;
  startLevel();
}

// --- Ход ---
async function swap(a, b) {
  select(-1);
  if (busy || a < 0 || b < 0 || !isAdjacent(a, b)) return;
  busy = true;
  const res = trySwap(board, a, b);
  if (!res) {
    sound.sfx.bad();
    await view.bounce(board.cells, a, b); // нет совпадения — фишки съезжаются и возвращаются
    busy = false;
    return;
  }
  moves--;
  sound.sfx.swap();
  renderHud();
  let chain = 0;
  for (const st of res.steps) {
    const anim = view.render(st.cells, st.kind);
    if (st.got) {
      view.combo(++chain);
      sound.sfx.match(chain);
      // Счётчик цели уменьшается на каждом взрыве, в том числе на каскадах (фишки упали и собрались сами).
      st.got.forEach((n, c) => { if (c in goals) goals[c] = Math.max(0, goals[c] - n); });
      renderHud();
    }
    await anim;
  }
  renderHud();
  if (Object.values(goals).every((n) => n === 0)) {
    progress.level++;
    progress.stars++;
    saver.save(progress);
    renderHud();
    sound.sfx.win();
    await view.celebrate();
    showOverlay('Уровень пройден! +1 ★', [['Домой', showHouse]]);
  } else if (moves === 0) {
    sound.sfx.lose();
    showOverlay('Ходы закончились', [['Ещё раз', startLevel], ['Домой', showHouse]]);
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
$('home').addEventListener('click', () => { if (!busy) { sound.sfx.tap(); showHouse(); } });

// --- Звук: включается первым касанием (так требует браузер), кнопка 🔊/🔇 ---
function renderSoundButtons() {
  document.querySelectorAll('button.sound').forEach((b) => { b.textContent = sound.isEnabled() ? '🔊' : '🔇'; });
}
document.querySelectorAll('button.sound').forEach((b) => b.addEventListener('click', () => {
  sound.setEnabled(!sound.isEnabled());
  renderSoundButtons();
}));
document.addEventListener('pointerdown', () => sound.unlock(), { capture: true });
renderSoundButtons();
$('play').addEventListener('click', play);

// --- Жизненный цикл: сворачивание, потеря фокуса ---
function setupLifecycle() {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      view.cancelPress();
      sound.pause();
      saver.flush();
      ysdk?.features?.GameplayAPI?.stop();
    } else {
      ysdk?.features?.GameplayAPI?.start();
      sound.resume();
      updateIfNeeded();
    }
  });
  window.addEventListener('pagehide', () => saver.flush());
  window.addEventListener('blur', () => view.cancelPress());
  document.addEventListener('contextmenu', (e) => e.preventDefault());
}

async function start() {
  if (await checkForUpdate()) return; // старая версия из кэша — сразу обновиться
  const sdk = await initSdk();
  ysdk = sdk.ysdk;
  const storage = safeLocalStorage();
  progress = sanitizeProgress(await loadSave({ player: sdk.player, storage }));
  saver = createSaver({ player: sdk.player, storage });
  view = await createView($('stage'));
  view.onSwap = swap;
  view.onTap = tap;
  view.onBonus = (kind) => (kind === 'h' || kind === 'v' ? sound.sfx.line() : sound.sfx[kind]());
  setupLifecycle();
  showHouse();
  info(ysdk ? 'Меняй соседние фишки местами: 3 в ряд' : 'Локальный режим (без SDK) · меняй соседние фишки');
  // Для автопроверки в браузере: ?debug открывает доступ к полю и ходу.
  if (new URLSearchParams(location.search).has('debug')) window.debugGame = { board: () => board, swap, moves: () => moves, progress: () => progress };
  ysdk?.features?.LoadingAPI?.ready();
  ysdk?.features?.GameplayAPI?.start();
}

start();
