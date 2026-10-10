// Уровни-заглушки: сколько ходов, сколько цветов фишек, что собрать (цвет → количество).
// После последнего уровня повторяется последний.
export const LEVELS = [
  { moves: 20, colors: 4, goals: { 0: 12 } },
  { moves: 20, colors: 5, goals: { 1: 15, 2: 15 } },
  { moves: 22, colors: 5, goals: { 0: 15, 3: 15, 4: 15 } },
  { moves: 22, colors: 5, goals: { 1: 25, 2: 25 } },
  { moves: 20, colors: 5, goals: { 0: 20, 1: 20, 2: 20, 3: 20 } },
];

export function levelConfig(n) {
  return LEVELS[Math.min(n, LEVELS.length) - 1];
}
