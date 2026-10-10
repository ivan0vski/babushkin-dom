// Дом: комнаты, задачи ремонта за звёзды и сохраняемый прогресс. Без DOM — проверяется тестами.
// Комнаты открываются по очереди; в комнате задачи открываются по порядку, по OPEN_AT_ONCE за раз.
export const ROOMS = [
  {
    id: 'attic',
    name: 'Чердак',
    tasks: [
      { id: 'junk', name: 'Убрать старый хлам', cost: 1 },
      { id: 'window', name: 'Отмыть окно', cost: 1 },
      { id: 'floor', name: 'Починить пол', cost: 2 },
      { id: 'curtains', name: 'Повесить занавески', cost: 1 },
      { id: 'chest', name: 'Поставить бабушкин сундук', cost: 2 },
      { id: 'lamp', name: 'Зажечь лампу', cost: 2 },
    ],
  },
  {
    id: 'kitchen',
    name: 'Кухня',
    tasks: [
      { id: 'dishes', name: 'Перемыть посуду', cost: 1 },
      { id: 'stove', name: 'Растопить печку', cost: 2 },
      { id: 'table', name: 'Починить стол', cost: 2 },
      { id: 'cloth', name: 'Постелить скатерть', cost: 1 },
      { id: 'samovar', name: 'Поставить самовар', cost: 2 },
      { id: 'pies', name: 'Испечь пироги', cost: 3 },
    ],
  },
];

export const TASKS = ROOMS.flatMap((r) => r.tasks);
export const OPEN_AT_ONCE = 2;

export function newProgress() {
  return { level: 1, stars: 0, done: [], room: 0 };
}

// Проверка сохранения: всё неизвестное или испорченное — в значения по умолчанию.
export function sanitizeProgress(p) {
  const ok = (n, min) => Number.isInteger(n) && n >= min;
  if (!p || !ok(p.level, 1) || !ok(p.stars, 0)) return newProgress();
  const known = new Set(TASKS.map((t) => t.id));
  const done = Array.isArray(p.done) ? [...new Set(p.done.filter((id) => known.has(id)))] : [];
  const room = ok(p.room, 0) ? Math.min(p.room, ROOMS.length - 1) : 0;
  return { level: p.level, stars: p.stars, done, room };
}

export function currentRoom(progress) {
  return ROOMS[progress.room];
}

export function availableTasks(progress) {
  return currentRoom(progress).tasks.filter((t) => !progress.done.includes(t.id)).slice(0, OPEN_AT_ONCE);
}

// Выполнить задачу: возвращает новый прогресс или null (недоступна / не хватает звёзд).
export function doTask(progress, id) {
  const task = availableTasks(progress).find((t) => t.id === id);
  if (!task || progress.stars < task.cost) return null;
  return { ...progress, stars: progress.stars - task.cost, done: [...progress.done, id] };
}

export function roomPercent(progress) {
  const tasks = currentRoom(progress).tasks;
  return Math.round((tasks.filter((t) => progress.done.includes(t.id)).length / tasks.length) * 100);
}

export function roomComplete(progress) {
  return roomPercent(progress) === 100;
}

// Следующая комната, если текущая готова и она есть; иначе null.
export function nextRoom(progress) {
  return roomComplete(progress) && progress.room < ROOMS.length - 1 ? ROOMS[progress.room + 1] : null;
}

export function enterNextRoom(progress) {
  return nextRoom(progress) ? { ...progress, room: progress.room + 1 } : null;
}
