// Отрисовка поля на Phaser 4 (глобальный Phaser из lib/phaser.min.js).
// Логика — в match3.js, сюда приходят снимки клеток; каждый метод анимации возвращает Promise.
import { W, H } from './match3.js';

const Phaser = window.Phaser;
const CELL = 100; // размер клетки во внутренних пикселях; на экран поле масштабируется (Scale FIT)
export const COLORS = ['#d9534f', '#3b7dd8', '#4caf50', '#f0b429', '#9b59b6'];

const cx = (i) => (i % W) * CELL + CELL / 2;
const cy = (i) => Math.floor(i / W) * CELL + CELL / 2;

// Картинки фишек (game/assets/tiles, делает scripts/prep_art.py): цвет → предмет.
export const TILE_FILES = ['apple', 'cup', 'mitten', 'pie', 'lilac'];
const BONUS_FILES = { h: 'rolling_pin', v: 'rolling_pin', bomb: 'jam', color: 'samovar' };
const BASE = (CELL * 0.92) / 256; // картинки 256×256 → размер в клетке

export function texKey(t) {
  return t.s ? BONUS_FILES[t.s] : TILE_FILES[t.c];
}

function makeTextures(scene) {
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
    this.onBonus = () => {};
  }

  preload() {
    for (const name of new Set([...TILE_FILES, ...Object.values(BONUS_FILES)])) {
      this.load.image(name, `assets/tiles/${name}.png`);
    }
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
    sp.setScale(BASE);
    this.tweens.add({
      targets: sp,
      y,
      duration: ms,
      delay,
      ease: 'Quad.easeIn',
      onComplete: () => this.tweens.add({ targets: sp, scaleY: 0.86 * BASE, scaleX: 1.08 * BASE, duration: 70, yoyo: true, ease: 'Quad.easeOut' }),
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
          sp = this.add.image(x, y, texKey(t)).setDepth(2).setScale(0).setAngle(t.s === 'v' ? 90 : 0);
          this.tweens.add({ targets: sp, scale: BASE, duration: 280, ease: 'Back.easeOut' });
          dur = Math.max(dur, 280);
        } else {
          sp = this.add.image(x, y - newInCol[i % W] * CELL - (kind === 'init' ? CELL : 0), texKey(t))
            .setDepth(1).setScale(BASE).setAngle(t.s === 'v' ? 90 : 0);
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
        this.tweens.add({ targets: sp, x, y, scale: BASE, duration: 170, ease: 'Quad.easeOut' });
        dur = Math.max(dur, 170);
      }
    });

    let bonusFired = false;
    const fired = [];
    for (const [id, sp] of this.sprites) {
      if (alive.has(id)) continue;
      this.sprites.delete(id);
      if (sp.tile.s) { bonusFired = true; fired.push(sp); }
      if (sp.tile.c >= 0) this.bursts[sp.tile.c].explode(7, sp.x, sp.y);
      this.tweens.killTweensOf(sp);
      this.tweens.add({ targets: sp, scale: 1.25 * BASE, alpha: 0, duration: 180, ease: 'Quad.easeOut', onComplete: () => sp.destroy() });
      dur = Math.max(dur, 180);
    }
    if (bonusFired) this.cameras.main.shake(160, 0.008);
    fired.forEach((sp) => this.bonusEffect(sp.tile.s, sp.x, sp.y));
    return this.wait(dur);
  }

  // Вспышка бонуса: скалка — луч по ряду/столбцу, варенье — кольцо, самовар — вспышка поля.
  bonusEffect(kind, x, y) {
    this.onBonus(kind);
    const fade = (obj, extra = {}) => this.tweens.add({ targets: obj, alpha: 0, duration: 380, ease: 'Quad.easeOut', ...extra, onComplete: () => obj.destroy() });
    if (kind === 'h' || kind === 'v') {
      const beam = kind === 'h'
        ? this.add.rectangle(W * CELL / 2, y, W * CELL, CELL * 0.55, 0xfff3c4)
        : this.add.rectangle(x, H * CELL / 2, CELL * 0.55, H * CELL, 0xfff3c4);
      beam.setDepth(4).setAlpha(0.9);
      fade(beam, kind === 'h' ? { scaleY: 0.1 } : { scaleX: 0.1 });
    } else if (kind === 'bomb') {
      const ring = this.add.circle(x, y, CELL * 0.5).setStrokeStyle(14, 0xffe08a).setDepth(4);
      fade(ring, { scale: 3.2 });
    } else if (kind === 'color') {
      const flash = this.add.rectangle(W * CELL / 2, H * CELL / 2, W * CELL, H * CELL, 0xffffff).setDepth(4).setAlpha(0.6);
      fade(flash, { duration: 500 });
    }
  }

  // Надпись на каскаде: чем длиннее цепочка, тем громче.
  combo(chain) {
    const words = ['', '', 'Отлично!', 'Супер!', 'Невероятно!'];
    const word = words[Math.min(chain, words.length - 1)];
    if (!word) return;
    const t = this.add.text(W * CELL / 2, H * CELL / 2, word, {
      fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      fontSize: `${64 + Math.min(chain, 5) * 8}px`,
      fontStyle: 'bold',
      color: '#fff6d8',
      stroke: '#7a3e22',
      strokeThickness: 12,
    }).setOrigin(0.5).setDepth(10).setScale(0.3).setAngle(-6);
    this.tweens.add({ targets: t, scale: 1, angle: 0, duration: 260, ease: 'Back.easeOut' });
    this.tweens.add({ targets: t, y: t.y - 80, alpha: 0, delay: 600, duration: 450, ease: 'Quad.easeIn', onComplete: () => t.destroy() });
  }

  // Победа: конфетти из искр всех цветов.
  celebrate() {
    this.bursts.forEach((em, k) => {
      for (let n = 0; n < 3; n++) {
        this.time.delayedCall(n * 180 + k * 40, () => em.explode(14, 100 + Math.random() * (W * CELL - 200), 150 + Math.random() * 300));
      }
    });
    return this.wait(700);
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
