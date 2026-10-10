// Дом: задачи ремонта за звёзды и сохраняемый прогресс. Без DOM — проверяется тестами.
// Задачи открываются по порядку: доступны первые OPEN_AT_ONCE невыполненных.
export const ROOM = { id: 'attic', name: 'Чердак' };

export const TASKS = [
  { id: 'junk', name: 'Убрать старый хлам', cost: 1 },
  { id: 'window', name: 'Отмыть окно', cost: 1 },
  { id: 'floor', name: 'Починить пол', cost: 2 },
  { id: 'curtains', name: 'Повесить занавески', cost: 1 },
  { id: 'chest', name: 'Поставить бабушкин сундук', cost: 2 },
  { id: 'lamp', name: 'Зажечь лампу', cost: 2 },
];

export const OPEN_AT_ONCE = 2;

export function newProgress() {
  return { level: 1, stars: 0, done: [] };
}

// Проверка сохранения: всё неизвестное или испорченное — в значения по умолчанию.
export function sanitizeProgress(p) {
  const ok = (n, min) => Number.isInteger(n) && n >= min;
  if (!p || !ok(p.level, 1) || !ok(p.stars, 0)) return newProgress();
  const known = new Set(TASKS.map((t) => t.id));
  const done = Array.isArray(p.done) ? [...new Set(p.done.filter((id) => known.has(id)))] : [];
  return { level: p.level, stars: p.stars, done };
}

export function availableTasks(progress) {
  return TASKS.filter((t) => !progress.done.includes(t.id)).slice(0, OPEN_AT_ONCE);
}

// Выполнить задачу: возвращает новый прогресс или null (недоступна / не хватает звёзд).
export function doTask(progress, id) {
  const task = availableTasks(progress).find((t) => t.id === id);
  if (!task || progress.stars < task.cost) return null;
  return { ...progress, stars: progress.stars - task.cost, done: [...progress.done, id] };
}

export function roomPercent(progress) {
  return Math.round((progress.done.length / TASKS.length) * 100);
}
