import { createBoard, trySwap, isAdjacent, placeBonuses } from './match3.js';
import { createView, TILE_FILES } from './view.js';
import { levelConfig } from './levels.js';
import { ROOMS, sanitizeProgress, availableTasks, doTask, roomPercent, roomComplete, currentRoom, nextRoom, enterNextRoom,
  winLevel, loseStreak, streakBonuses, BONUS_NAMES } from './house.js';
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
let levelStarted = false; // сделан хотя бы один ход — выход из уровня сжигает серию
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
  placeBonuses(board, streakBonuses(progress));
  levelStarted = false;
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
function showOverlay(text, buttons, kind = '') {
  $('overlay-text').textContent = text;
  $('overlay').querySelector('.panel').className = 'panel ' + kind;
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
      list.querySelectorAll('button').forEach((x) => { x.disabled = true; });
      flyStar(btn, $('room-' + currentRoom(progress).id)).then(() => renderHouse(roomComplete(progress) ? roomDoneNote() : 'Готово!'));
    };
    li.append(t.name, btn);
    list.appendChild(li);
  }
  const next = nextRoom(progress);
  $('next-room').hidden = !next;
  if (next) $('next-room').textContent = `Открыть: ${next.name} →`;
  $('house-note').textContent = note || (roomComplete(progress) ? roomDoneNote() : '');
  $('play').textContent = 'Играть · Уровень ' + progress.level;
  $('streak').textContent = streakText() || 'Выигрывай подряд — получишь бонусы на старте';
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

// Проигрыш или выход после первого хода — серия побед сгорает.
function burnStreak() {
  if (!levelStarted || progress.streak === 0) return;
  progress = loseStreak(progress);
  saver.save(progress);
  levelStarted = false;
}

function streakText() {
  const b = streakBonuses(progress);
  return b.length ? `🔥 Серия побед ${progress.streak} · на старте: ${b.map((k) => BONUS_NAMES[k]).join(', ')}` : '';
}

// --- Переходы ---
let wiping = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const centerOf = (el) => {
  const r = el.getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height / 2];
};

// Круг закрывает экран от точки from, (карточка уровня), middle() меняет экран, круг раскрывается.
async function wipe(from, middle, card = null) {
  if (wiping) return;
  wiping = true;
  busy = true;
  const w = $('wipe');
  const c = w.querySelector('.wipe-card');
  const [x, y] = from ? centerOf(from) : [innerWidth / 2, innerHeight / 2];
  w.style.setProperty('--x', x + 'px');
  w.style.setProperty('--y', y + 'px');
  w.className = '';
  w.hidden = false;
  void w.offsetWidth; // применить стартовый круг до анимации
  w.className = 'closed';
  await sleep(420);
  if (card) {
    card();
    c.hidden = false;
    await sleep(1100);
  }
  middle();
  w.style.setProperty('--x', innerWidth / 2 + 'px');
  w.style.setProperty('--y', innerHeight / 2 + 'px');
  w.className = 'opening';
  await sleep(450);
  w.hidden = true;
  c.hidden = true;
  wiping = false;
}

// Карточка перед уровнем: номер, что собрать, сколько ходов.
function levelCard() {
  const cfg = levelConfig(progress.level);
  $('wipe-title').textContent = 'Уровень ' + progress.level;
  const g = $('wipe-goals');
  g.replaceChildren();
  for (const [col, n] of Object.entries(cfg.goals)) {
    const d = document.createElement('div');
    d.append(tileIcon(col), String(n));
    g.appendChild(d);
  }
  $('wipe-moves').textContent = `Собери за ${cfg.moves} ходов`;
  $('wipe-streak').textContent = streakText();
}

function enterLevel(from) {
  wipe(from, () => {
    $('house').hidden = true;
    startLevel();
  }, levelCard);
}

function goHome() {
  burnStreak();
  wipe($('home'), showHouse);
}

function play() {
  sound.sfx.tap();
  enterLevel($('play'));
}

// Звезда летит от кнопки задачи в комнату.
function flyStar(from, to) {
  const [x0, y0] = centerOf(from);
  const [x1, y1] = centerOf(to);
  const s = document.createElement('span');
  s.className = 'fly-star';
  s.textContent = '★';
  s.style.left = x0 + 'px';
  s.style.top = y0 + 'px';
  document.body.appendChild(s);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const anim = s.animate([
    { transform: 'translate(-50%, -50%) scale(1)' },
    { transform: `translate(calc(-50% + ${dx / 2}px), calc(-50% + ${dy / 2 - 60}px)) scale(1.8)`, offset: 0.5 },
    { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.6)`, opacity: 0.2 },
  ], { duration: 550, easing: 'ease-in-out' });
  return anim.finished.then(() => s.remove(), () => s.remove());
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
  levelStarted = true;
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
    progress = winLevel(progress);
    saver.save(progress);
    renderHud();
    sound.sfx.win();
    await view.celebrate();
    showOverlay('Уровень пройден! +1 ★', [['Домой', goHome]], 'win');
  } else if (moves === 0) {
    sound.sfx.lose();
    const hadStreak = progress.streak > 0;
    burnStreak();
    showOverlay(hadStreak ? 'Ходы закончились. Серия побед сгорела' : 'Ходы закончились', [['Ещё раз', () => enterLevel($('overlay-btn'))], ['Домой', goHome]], 'lose');
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

$('restart').addEventListener('click', () => { if (!busy) { burnStreak(); startLevel(); } });
$('home').addEventListener('click', () => { if (!busy) { sound.sfx.tap(); goHome(); } });

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
