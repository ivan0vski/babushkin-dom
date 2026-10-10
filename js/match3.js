// Логика «3 в ряд»: поле, совпадения, бонусы, падение, перемешивание.
// Без DOM — проверяется тестами (tests/match3.test.js).
// Фишка: { id, c, s } — c: цвет 0..colors-1, s: бонус null | 'h' | 'v' | 'bomb' | 'color'.
// Бонусы бесцветные (c = -1, как в жанре): в ряд не собираются, срабатывают от сдвига или от другого бонуса.
export const W = 8;
export const H = 8;

let nextId = 1;
export function tile(c, s = null) {
  return { id: nextId++, c, s };
}

const xy = (i) => [i % W, Math.floor(i / W)];
const colorOf = (t) => (t && t.c >= 0 ? t.c : -2);

export function isAdjacent(a, b) {
  const [ax, ay] = xy(a);
  const [bx, by] = xy(b);
  return Math.abs(ax - bx) + Math.abs(ay - by) === 1;
}

// Поле заполняется слева направо, сверху вниз: смотрим только уже заполненных соседей.
function makesMatch(cells, i, c) {
  const [x, y] = xy(i);
  const same = (j) => colorOf(cells[j]) === c;
  if (x >= 2 && same(i - 1) && same(i - 2)) return true;
  if (y >= 2 && same(i - W) && same(i - 2 * W)) return true;
  if (x >= 1 && y >= 1 && same(i - 1) && same(i - W) && same(i - W - 1)) return true;
  return false;
}

function fillColors(b, rng, keep = () => false) {
  for (let i = 0; i < W * H; i++) {
    if (keep(b.cells[i])) continue;
    let c;
    let tries = 0;
    do { c = Math.floor(rng() * b.colors); } while (makesMatch(b.cells, i, c) && ++tries < 50);
    if (b.cells[i]) b.cells[i].c = c;
    else b.cells[i] = tile(c);
  }
}

export function createBoard(colors, rng = Math.random) {
  const b = { colors, cells: new Array(W * H).fill(null) };
  do {
    b.cells.fill(null);
    fillColors(b, rng);
  } while (findMatches(b.cells).length || !hasMove(b));
  return b;
}

// Группы совпадений: ряды/столбцы от 3 и квадраты 2×2, склеенные по общим клеткам.
export function findMatches(cells) {
  const lines = []; // { cells, dir }
  for (let y = 0; y < H; y++) {
    let x = 0;
    while (x < W) {
      const c = colorOf(cells[y * W + x]);
      let e = x + 1;
      while (e < W && c >= 0 && colorOf(cells[y * W + e]) === c) e++;
      if (c >= 0 && e - x >= 3) lines.push({ dir: 'h', cells: range(x, e).map((k) => y * W + k) });
      x = e;
    }
  }
  for (let x = 0; x < W; x++) {
    let y = 0;
    while (y < H) {
      const c = colorOf(cells[y * W + x]);
      let e = y + 1;
      while (e < H && c >= 0 && colorOf(cells[e * W + x]) === c) e++;
      if (c >= 0 && e - y >= 3) lines.push({ dir: 'v', cells: range(y, e).map((k) => k * W + x) });
      y = e;
    }
  }
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const q = [y * W + x, y * W + x + 1, (y + 1) * W + x, (y + 1) * W + x + 1];
      const c = colorOf(cells[q[0]]);
      if (c >= 0 && q.every((j) => colorOf(cells[j]) === c)) lines.push({ dir: 'sq', cells: q });
    }
  }

  // Склейка по общим клеткам (система непересекающихся множеств).
  const parent = new Map();
  const find = (i) => { while (parent.get(i) !== i) i = parent.get(i); return i; };
  for (const l of lines) {
    for (const i of l.cells) if (!parent.has(i)) parent.set(i, i);
    for (const i of l.cells.slice(1)) parent.set(find(i), find(l.cells[0]));
  }
  const groups = new Map();
  for (const l of lines) {
    const root = find(l.cells[0]);
    if (!groups.has(root)) groups.set(root, { cells: new Set(), maxH: 0, maxV: 0, square: false });
    const g = groups.get(root);
    l.cells.forEach((i) => g.cells.add(i));
    if (l.dir === 'h') g.maxH = Math.max(g.maxH, l.cells.length);
    else if (l.dir === 'v') g.maxV = Math.max(g.maxV, l.cells.length);
    else g.square = true;
  }
  return [...groups.values()].map((g) => ({
    cells: [...g.cells],
    c: colorOf(cells[g.cells.values().next().value]),
    special: specialFor(g),
  }));
}

function specialFor(g) {
  if (g.maxH >= 5 || g.maxV >= 5) return 'color';
  if (g.maxH >= 3 && g.maxV >= 3) return 'bomb';
  if (g.maxH === 4) return 'h';
  if (g.maxV === 4) return 'v';
  if (g.square) return 'bomb';
  return null;
}

function range(a, b) {
  const r = [];
  for (let k = a; k < b; k++) r.push(k);
  return r;
}

export function hasMove(b) {
  if (b.cells.some((t) => t && t.s)) return true; // бонус можно сдвинуть куда угодно
  for (let i = 0; i < W * H; i++) {
    const [x, y] = xy(i);
    for (const j of [x < W - 1 ? i + 1 : -1, y < H - 1 ? i + W : -1]) {
      if (j < 0) continue;
      swapCells(b.cells, i, j);
      const ok = findMatches(b.cells).length > 0;
      swapCells(b.cells, i, j);
      if (ok) return true;
    }
  }
  return false;
}

function swapCells(cells, a, b) {
  const t = cells[a];
  cells[a] = cells[b];
  cells[b] = t;
}

function mostCommonColor(b) {
  const n = new Array(b.colors).fill(0);
  b.cells.forEach((t) => { if (t && t.c >= 0) n[t.c]++; });
  return n.indexOf(Math.max(...n));
}

// Клетки, которые задевает бонус.
function area(b, i, t, colorTarget) {
  const [x, y] = xy(i);
  const out = [];
  if (t.s === 'h') for (let k = 0; k < W; k++) out.push(y * W + k);
  if (t.s === 'v') for (let k = 0; k < H; k++) out.push(k * W + x);
  if (t.s === 'bomb') {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < W && ny >= 0 && ny < H) out.push(ny * W + nx);
      }
    }
  }
  if (t.s === 'color') {
    const c = colorTarget ?? mostCommonColor(b);
    b.cells.forEach((u, j) => { if (u && u.c === c) out.push(j); });
  }
  return out;
}

// Убирает клетки (с цепочкой бонусов) и ставит новые бонусы на месте групп.
function clearStep(b, toClear, groups, prefer, fired, collected, colorTarget = null) {
  const creations = [];
  for (const g of groups) {
    g.cells.forEach((i) => toClear.add(i));
    if (!g.special) continue;
    const pos = prefer.find((p) => g.cells.includes(p)) ?? g.cells[Math.floor(g.cells.length / 2)];
    creations.push({ pos, c: -1, s: g.special });
  }
  const queue = [...toClear];
  while (queue.length) {
    const i = queue.pop();
    const t = b.cells[i];
    if (!t || !t.s || fired.has(i)) continue;
    fired.add(i);
    for (const j of area(b, i, t, t.s === 'color' ? colorTarget : null)) {
      if (!toClear.has(j)) { toClear.add(j); queue.push(j); }
    }
  }
  for (const i of toClear) {
    const t = b.cells[i];
    if (t && t.c >= 0) collected[t.c]++;
    b.cells[i] = null;
  }
  for (const k of creations) b.cells[k.pos] = tile(k.c, k.s);
}

function gravity(b, rng) {
  for (let x = 0; x < W; x++) {
    let write = H - 1;
    for (let y = H - 1; y >= 0; y--) {
      const t = b.cells[y * W + x];
      if (t) {
        b.cells[y * W + x] = null;
        b.cells[write * W + x] = t;
        write--;
      }
    }
    for (let y = write; y >= 0; y--) b.cells[y * W + x] = tile(Math.floor(rng() * b.colors));
  }
}

export function shuffle(b, rng = Math.random) {
  for (let n = 0; n < 100; n++) {
    fillColors(b, rng, (t) => t && t.s);
    if (!findMatches(b.cells).length && hasMove(b)) return;
  }
}

const snap = (b, kind) => ({ kind, cells: b.cells.map((t) => (t ? { ...t } : null)) });

// Ход игрока. null — ход невозможен (не соседи или ничего не совпало), поле не меняется.
// Иначе { steps: [{ kind, cells }], collected: [кол-во по цветам] } — шаги для анимации.
export function trySwap(b, a, z, rng = Math.random) {
  if (!isAdjacent(a, z) || !b.cells[a] || !b.cells[z]) return null;
  swapCells(b.cells, a, z);
  const ta = b.cells[a];
  const tz = b.cells[z];
  const toClear = new Set();
  const fired = new Set();
  let colorTarget = null;

  if (ta.s === 'color' && tz.s === 'color') {
    b.cells.forEach((_, i) => { toClear.add(i); fired.add(i); });
  } else if (ta.s === 'color' || tz.s === 'color') {
    const [bombPos, other, otherPos] = ta.s === 'color' ? [a, tz, z] : [z, ta, a];
    // С обычной фишкой — убирает её цвет; с другим бонусом — самый частый цвет, и тот бонус тоже срабатывает.
    colorTarget = other.c >= 0 ? other.c : mostCommonColor(b);
    toClear.add(bombPos);
    toClear.add(otherPos);
    fired.add(bombPos);
    b.cells.forEach((t, i) => { if (t.c === colorTarget) toClear.add(i); });
  } else {
    if (ta.s) toClear.add(a);
    if (tz.s) toClear.add(z);
  }

  let groups = findMatches(b.cells);
  if (!toClear.size && !groups.length) {
    swapCells(b.cells, a, z);
    return null;
  }

  const collected = new Array(b.colors).fill(0);
  const steps = [snap(b, 'swap')];
  let prefer = [a, z];
  for (;;) {
    clearStep(b, toClear, groups, prefer, fired, collected, colorTarget);
    steps.push(snap(b, 'clear'));
    gravity(b, rng);
    steps.push(snap(b, 'fall'));
    groups = findMatches(b.cells);
    if (!groups.length) break;
    toClear.clear();
    fired.clear();
    prefer = [];
    colorTarget = null;
  }
  if (!hasMove(b)) {
    shuffle(b, rng);
    steps.push(snap(b, 'shuffle'));
  }
  return { steps, collected };
}
