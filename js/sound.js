// Звуки и музыка, синтезируются в браузере (Web Audio), без файлов.
// «Гитара» — алгоритм Karplus–Strong (щипок струны): шум, который гаснет в петле задержки.
// Браузер разрешает звук только после первого касания — поэтому unlock() вызывается на первом нажатии.
const KEY = 'babushkin_dom_sound';
let ctx = null;
let master = null;
let musicGain = null;
let enabled = readPref();
let musicTimer = null;
let nextBar = 0;
let bar = 0;
const plucks = new Map(); // частота → готовый звук щипка

function readPref() {
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
}

export function isEnabled() {
  return enabled;
}

export function setEnabled(on) {
  enabled = on;
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* приватный режим */ }
  if (!ctx) { if (on) unlock(); return; } // включение — это касание, звук можно создать
  if (on) { ctx.resume(); startMusic(); } else { stopMusic(); ctx.suspend(); }
}

// Первое касание игрока: создать звук и включить музыку.
export function unlock() {
  if (ctx || !enabled) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.8;
  master.connect(ctx.destination);
  musicGain = ctx.createGain();
  musicGain.gain.value = 0.22;
  musicGain.connect(master);
  startMusic();
}

// Сворачивание вкладки / реклама — тишина; возврат — звук обратно.
export function pause() {
  if (ctx && ctx.state === 'running') ctx.suspend();
  stopMusic();
}

export function resume() {
  if (!ctx || !enabled) return;
  ctx.resume();
  startMusic();
}

const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

function pluckBuffer(freq, seconds = 1.6, brightness = 0.5) {
  const key = `${freq.toFixed(2)}|${seconds}|${brightness}`;
  if (plucks.has(key)) return plucks.get(key);
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  const n = Math.max(2, Math.round(sr / freq));
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  for (let i = n; i < len; i++) {
    // усреднение соседних отсчётов — струна гаснет и теряет «звон»
    d[i] = (d[i - n] * brightness + d[i - n + 1] * (1 - brightness)) * 0.996;
  }
  plucks.set(key, buf);
  return buf;
}

function pluck(midi, when = 0, volume = 0.5, out = master, seconds = 1.6) {
  if (!ctx) return;
  const src = ctx.createBufferSource();
  src.buffer = pluckBuffer(hz(midi), seconds);
  const g = ctx.createGain();
  g.gain.value = volume;
  src.connect(g).connect(out);
  src.start(ctx.currentTime + when);
}

function tone(type, from, to, dur, volume = 0.3, when = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + when;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(volume, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur, fromHz, toHz, volume = 0.3) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = 1.2;
  f.frequency.setValueAtTime(fromHz, t);
  f.frequency.exponentialRampToValueAtTime(toHz, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(volume, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t);
}

// Пентатоника до мажор — любые ноты подряд звучат дружно.
const PENTA = [72, 74, 76, 79, 81, 84, 86, 88, 91];

export const sfx = {
  tap: () => tone('sine', 900, 700, 0.05, 0.12),
  swap: () => tone('sine', 320, 520, 0.09, 0.15),
  bad: () => { tone('triangle', 260, 200, 0.12, 0.2); tone('triangle', 200, 150, 0.14, 0.2, 0.1); },
  // Сбор фишек: щипок, на каждом следующем взрыве каскада — выше.
  match: (chain) => {
    const k = Math.min(chain - 1, PENTA.length - 2);
    pluck(PENTA[k], 0, 0.55, master, 0.8);
    pluck(PENTA[k + 1], 0.06, 0.35, master, 0.8);
  },
  line: () => noise(0.35, 600, 4000, 0.35),
  bomb: () => { tone('sine', 160, 45, 0.4, 0.5); noise(0.3, 1200, 200, 0.3); },
  color: () => [0, 2, 4, 5, 7].forEach((k, i) => pluck(PENTA[k] + 12, i * 0.05, 0.3, master, 0.6)),
  win: () => [60, 64, 67, 72, 76].forEach((m, i) => pluck(m + 12, i * 0.11, 0.5)),
  lose: () => [67, 64, 60].forEach((m, i) => pluck(m, i * 0.18, 0.45)),
  task: () => [72, 76, 79, 84].forEach((m, i) => pluck(m, i * 0.07, 0.45)),
};

// --- Музыка: тихий перебор на аккордах C – Am – F – G, 76 ударов в минуту ---
const CHORDS = [
  [48, 55, 60, 64, 67], // C
  [45, 52, 57, 60, 64], // Am
  [41, 48, 53, 57, 60], // F
  [43, 50, 55, 59, 62], // G
];
const PATTERN = [0, 2, 3, 4, 3, 2, 1, 2]; // какую струну аккорда щипать на каждую восьмую
const MELODY = [[76, 74, 72, null], [72, null, 69, 67], [65, 69, 72, null], [71, null, 74, null]];
const EIGHTH = 60 / 76 / 2;

function scheduleBar() {
  const chord = CHORDS[bar % CHORDS.length];
  const start = nextBar - ctx.currentTime;
  PATTERN.forEach((s, i) => pluck(chord[s], start + i * EIGHTH, i === 0 ? 0.55 : 0.35, musicGain, 2));
  // мелодия — через раз, чтобы не надоедала
  if (Math.floor(bar / 4) % 2 === 1) {
    MELODY[bar % 4].forEach((m, i) => { if (m) pluck(m, start + i * EIGHTH * 2, 0.3, musicGain, 1.4); });
  }
  bar++;
  nextBar += EIGHTH * PATTERN.length;
}

function startMusic() {
  if (!ctx || musicTimer || !enabled) return;
  nextBar = ctx.currentTime + 0.1;
  // планируем такты чуть вперёд, проверка раз в 200 мс
  musicTimer = setInterval(() => {
    while (nextBar < ctx.currentTime + 0.8) scheduleBar();
  }, 200);
}

function stopMusic() {
  clearInterval(musicTimer);
  musicTimer = null;
}
