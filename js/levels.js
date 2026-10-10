// Уровни: сколько ходов, сколько видов фишек, что собрать (вид → количество).
// Первые уровни заданы руками, дальше генерируются: каждый номер — всегда один и тот же уровень.
export const LEVELS = [
  { moves: 20, colors: 4, goals: { 0: 12 } },
  { moves: 20, colors: 5, goals: { 1: 15, 2: 15 } },
  { moves: 22, colors: 5, goals: { 0: 15, 3: 15, 4: 15 } },
  { moves: 22, colors: 5, goals: { 1: 25, 2: 25 } },
  { moves: 20, colors: 5, goals: { 0: 20, 1: 20, 2: 20, 3: 20 } },
];

// Простой генератор случайных чисел от номера уровня — уровень не меняется при перезапуске.
function seeded(seed) {
  let s = seed * 9301 + 49297;
  return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
}

function generate(n) {
  const rng = seeded(n);
  const kinds = 2 + Math.floor(rng() * 2); // 2–3 цели
  const pool = [0, 1, 2, 3, 4];
  const goals = {};
  // сложность растёт медленно и упирается в потолок: ~ +1 фишка на цель за уровень
  const each = Math.min(18 + Math.floor((n - LEVELS.length) * 0.8), 34) - (kinds === 3 ? 4 : 0);
  for (let k = 0; k < kinds; k++) {
    const c = pool.splice(Math.floor(rng() * pool.length), 1)[0];
    goals[c] = each;
  }
  return { moves: 20 + Math.floor(rng() * 4), colors: 5, goals };
}

export function levelConfig(n) {
  return n <= LEVELS.length ? LEVELS[n - 1] : generate(n);
}
