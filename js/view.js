// Отрисовка поля на Phaser 4 (глобальный Phaser из lib/phaser.min.js).
// Логика — в match3.js, сюда приходят снимки клеток; каждый метод анимации возвращает Promise.
import { W, H } from './match3.js';

const Phaser = window.Phaser;
const CELL = 100; // размер клетки во внутренних пикселях; на экран поле масштабируется (Scale FIT)
export const COLORS = ['#d9534f', '#3b7dd8', '#4caf50', '#f0b429', '#9b59b6'];

const cx = (i) => (i % W) * CELL + CELL / 2;
const cy = (i) => Math.floor(i / W) * CELL + CELL / 2;

export function texKey(t) {
  return t.s === 'color' ? 'tile-color' : `tile-${t.c}${t.s ? '-' + t.s : ''}`;
}

// --- Заглушки фишек: рисуются кодом. Потом заменятся картинками с теми же ключами. ---
function shapePath(ctx, c, s) {
  const m = 14;
  const a = m;
  const b = s - m;
  const mid = s / 2;
  ctx.beginPath();
  if (c === 0) ctx.arc(mid, mid, mid - m, 0, Math.PI * 2);
  if (c === 1) ctx.roundRect(a, a, b - a, b - a, 12);
  if (c === 2) { ctx.moveTo(mid, a - 4); ctx.lineTo(b + 4, mid); ctx.lineTo(mid, b + 4); ctx.lineTo(a - 4, mid); }
  if (c === 3) { ctx.moveTo(mid, a - 2); ctx.lineTo(b + 2, b); ctx.lineTo(a - 2, b); }
  if (c === 4) {
    for (let k = 0; k < 6; k++) {
      const ang = Math.PI / 3 * k;
      ctx.lineTo(mid + (mid - m + 2) * Math.cos(ang), mid + (mid - m + 2) * Math.sin(ang));
    }
  }
  ctx.closePath();
}

function drawTile(c, special) {
  const s = CELL;
  const cv = document.createElement('canvas');
  cv.width = s;
  cv.height = s;
  const ctx = cv.getContext('2d');
  if (special === 'color') {
    const g = ctx.createConicGradient ? ctx.createConicGradient(0, s / 2, s / 2) : null;
    if (g) COLORS.concat(COLORS[0]).forEach((col, k) => g.addColorStop(k / COLORS.length, col));
    ctx.fillStyle = g || '#fff';
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s / 2 - 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, 12, 0, Math.PI * 2);
    ctx.fill();
    return cv;
  }
  shapePath(ctx, c, s);
  const grad = ctx.createLinearGradient(0, 10, 0, s - 10);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.18, COLORS[c]);
  grad.addColorStop(1, COLORS[c]);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';
  if (special === 'h') ctx.fillRect(16, s / 2 - 7, s - 32, 14);
  if (special === 'v') ctx.fillRect(s / 2 - 7, 16, 14, s - 32);
  if (special === 'bomb') {
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, 17, 0, Math.PI * 2);
    ctx.stroke();
  }
  return cv;
}

function makeTextures(scene) {
  for (let c = 0; c < COLORS.length; c++) {
    for (const sp of [null, 'h', 'v', 'bomb']) scene.textures.addCanvas(texKey({ c, s: sp }), drawTile(c, sp));
  }
  scene.textures.addCanvas('tile-color', drawTile(-1, 'color'));

  const spark = document.createElement('canvas');
  spark.width = spark.height = 24;
  const sc = spark.getContext('2d');
  const rg = sc.createRadialGradient(12, 12, 0, 12, 12, 12);
  rg.addColorStop(0, 'rgba(255,255,255,1)');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  sc.fillStyle = rg;
  sc.fillRect(0, 0, 24, 24);
  scene.textures.addCanvas('spark', spark);

  const sel = document.createElement('canvas');
  sel.width = sel.height = CELL;
  const ss = sel.getContext('2d');
  ss.lineWidth = 6;
  ss.strokeStyle = '#fff';
  ss.beginPath();
  ss.roundRect(5, 5, CELL - 10, CELL - 10, 16);
  ss.stroke();
  scene.textures.addCanvas('sel', sel);
}

class BoardScene extends Phaser.Scene {
  constructor(onReady) {
    super('board');
    this.onReady = onReady;
    this.sprites = new Map(); // id фишки → Image
    this.press = null;
    this.onSwap = () => {};
    this.onTap = () => {};
  }

  create() {
    makeTextures(this);
    const g = this.add.graphics();
    for (let i = 0; i < W * H; i++) {
      const x = i % W;
      const y = Math.floor(i / W);
      g.fillStyle((x + y) % 2 ? 0xe0c79b : 0xe8d3ac);
      g.fillRoundedRect(x * CELL + 2, y * CELL + 2, CELL - 4, CELL - 4, 12);
    }
    this.sel = this.add.image(0, 0, 'sel').setVisible(false).setDepth(3);
    this.selTween = null;
    // Один излучатель частиц на цвет: вспышка при сборе фишки.
    this.bursts = COLORS.map((col) => this.add.particles(0, 0, 'spark', {
      speed: { min: 140, max: 380 },
      lifespan: { min: 300, max: 550 },
      scale: { start: 1.3, end: 0 },
      alpha: { start: 1, end: 0 },
      gravityY: 700,
      tint: Phaser.Display.Color.HexStringToColor(col).color,
      emitting: false,
    }).setDepth(5));
    this.setupInput();
    this.onReady(this);
  }

  setupInput() {
    this.input.on('pointerdown', (p) => {
      const i = this.cellAt(p.x, p.y);
      if (i >= 0) this.press = { i, x: p.x, y: p.y };
    });
    this.input.on('pointermove', (p) => {
      if (!this.press) return;
      const dx = p.x - this.press.x;
      const dy = p.y - this.press.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < CELL * 0.35) return;
      const { i } = this.press;
      this.press = null;
      const x = i % W;
      const y = Math.floor(i / W);
      let j;
      if (Math.abs(dx) > Math.abs(dy)) j = dx > 0 ? (x < W - 1 ? i + 1 : -1) : (x > 0 ? i - 1 : -1);
      else j = dy > 0 ? (y < H - 1 ? i + W : -1) : (y > 0 ? i - W : -1);
      if (j >= 0) this.onSwap(i, j);
    });
    this.input.on('pointerup', () => {
      if (!this.press) return;
      const { i } = this.press;
      this.press = null;
      this.onTap(i);
    });
    this.input.on('pointerupoutside', () => { this.press = null; });
  }

  cancelPress() {
    this.press = null;
  }

  cellAt(px, py) {
    const x = Math.floor(px / CELL);
    const y = Math.floor(py / CELL);
    return x >= 0 && x < W && y >= 0 && y < H ? y * W + x : -1;
  }

  wait(ms) {
    return new Promise((r) => this.time.delayedCall(ms, r));
  }

  select(i) {
    this.selTween?.remove();
    this.selTween = null;
    this.sel.setVisible(i >= 0).setScale(1);
    if (i < 0) return;
    this.sel.setPosition(cx(i), cy(i));
    this.selTween = this.tweens.add({ targets: this.sel, scale: 1.07, duration: 350, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }

  // Падение с лёгким «приземлением». Возвращает длительность.
  fallTo(sp, y, delay = 0) {
    const rows = Math.abs(y - sp.y) / CELL;
    const ms = Math.min(140 + 55 * rows, 520);
    this.tweens.killTweensOf(sp);
    sp.setScale(1);
    this.tweens.add({
      targets: sp,
      y,
      duration: ms,
      delay,
      ease: 'Quad.easeIn',
      onComplete: () => this.tweens.add({ targets: sp, scaleY: 0.86, scaleX: 1.08, duration: 70, yoyo: true, ease: 'Quad.easeOut' }),
    });
    return delay + ms + 140;
  }

  clear() {
    for (const sp of this.sprites.values()) sp.destroy();
    this.sprites.clear();
    this.select(-1);
  }

  // Приводит поле к снимку cells. kind: 'init' | 'swap' | 'clear' | 'fall' | 'shuffle'.
  render(cells, kind) {
    let dur = 0;
    const alive = new Set();
    const newInCol = new Array(W).fill(0);
    cells.forEach((t, i) => { if (t && !this.sprites.has(t.id)) newInCol[i % W]++; });

    cells.forEach((t, i) => {
      if (!t) return;
      alive.add(t.id);
      const x = cx(i);
      const y = cy(i);
      let sp = this.sprites.get(t.id);
      if (!sp) {
        if (kind === 'clear') {
          // Новый бонус появляется на месте собранной группы.
          sp = this.add.image(x, y, texKey(t)).setDepth(2).setScale(0);
          this.tweens.add({ targets: sp, scale: 1, duration: 280, ease: 'Back.easeOut' });
          dur = Math.max(dur, 280);
        } else {
          sp = this.add.image(x, y - newInCol[i % W] * CELL - (kind === 'init' ? CELL : 0), texKey(t)).setDepth(1);
          const delay = kind === 'init' ? (H - 1 - Math.floor(i / W)) * 25 + (i % W) * 12 : 0;
          dur = Math.max(dur, this.fallTo(sp, y, delay));
        }
        sp.tile = t;
        this.sprites.set(t.id, sp);
        return;
      }
      if (sp.tile.c !== t.c) {
        sp.setTexture(texKey(t)); // перемешивание меняет цвет
        sp.tile = t;
      }
      if (sp.x === x && sp.y === y) return;
      if (kind === 'fall') {
        dur = Math.max(dur, this.fallTo(sp, y));
      } else {
        this.tweens.killTweensOf(sp);
        this.tweens.add({ targets: sp, x, y, scale: 1, duration: 170, ease: 'Quad.easeOut' });
        dur = Math.max(dur, 170);
      }
    });

    let bonusFired = false;
    for (const [id, sp] of this.sprites) {
      if (alive.has(id)) continue;
      this.sprites.delete(id);
      if (sp.tile.s) bonusFired = true;
      if (sp.tile.c >= 0) this.bursts[sp.tile.c].explode(7, sp.x, sp.y);
      this.tweens.killTweensOf(sp);
      this.tweens.add({ targets: sp, scale: 1.25, alpha: 0, duration: 180, ease: 'Quad.easeOut', onComplete: () => sp.destroy() });
      dur = Math.max(dur, 180);
    }
    if (bonusFired) this.cameras.main.shake(160, 0.008);
    return this.wait(dur);
  }

  // Неудачный обмен: фишки съезжаются и возвращаются.
  bounce(cells, a, b) {
    for (const [i, j] of [[a, b], [b, a]]) {
      const sp = this.sprites.get(cells[i].id);
      this.tweens.add({ targets: sp, x: cx(j), y: cy(j), duration: 140, yoyo: true, ease: 'Quad.easeOut' });
    }
    return this.wait(300);
  }
}

export function createView(parent) {
  return new Promise((resolve) => {
    new Phaser.Game({
      type: Phaser.AUTO,
      parent,
      transparent: true,
      banner: false,
      audio: { noAudio: true }, // звук добавим отдельным шагом
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH, width: W * CELL, height: H * CELL },
      scene: new BoardScene(resolve),
    });
  });
}
