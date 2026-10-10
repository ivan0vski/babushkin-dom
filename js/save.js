// Сохранение: облако Яндекса (player.setData) + копия в localStorage.
// Лимит setData — 100 запросов за 5 минут, поэтому отправка не чаще раза в minInterval.
export const LS_KEY = 'babushkin_dom_save';

export function pickNewer(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return (b.t || 0) > (a.t || 0) ? b : a;
}

export async function loadSave({ player, storage }) {
  let local = null;
  try { local = JSON.parse(storage?.getItem(LS_KEY) || 'null'); } catch { local = null; }
  let cloud = null;
  if (player) {
    try { cloud = (await player.getData(['save'])).save || null; } catch (e) { console.warn('getData failed', e); }
  }
  return pickNewer(local, cloud);
}

export function createSaver({ player, storage, timers = globalThis, now = Date.now, delay = 1500, minInterval = 3500 }) {
  let pending = null;
  let timer = null;
  let lastSent = -Infinity;

  function send() {
    timer = null;
    if (!pending) return;
    const data = pending;
    pending = null;
    lastSent = now();
    player?.setData({ save: data }, true).catch((e) => console.warn('setData failed', e));
  }

  return {
    save(state) {
      const data = { ...state, t: now() };
      try { storage?.setItem(LS_KEY, JSON.stringify(data)); } catch { /* приватный режим и т. п. */ }
      pending = data;
      if (!timer) timer = timers.setTimeout(send, Math.max(delay, lastSent + minInterval - now()));
    },
    // Вызывается при сворачивании вкладки: отправить сразу, если лимит позволяет.
    flush() {
      if (!pending || now() - lastSent < minInterval) return;
      timers.clearTimeout(timer);
      send();
    },
  };
}
