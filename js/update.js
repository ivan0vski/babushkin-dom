// Автообновление: сверяет версию загруженного кода (build.js) с версией на сервере (version.json).
// Если на сервере новее — скачивает все файлы мимо кэша браузера (это обновляет кэш) и перезагружает страницу.
// Версии ставит scripts/stamp-version.js при выкладке.
import { BUILD } from './build.js';

const KEY = 'babushkin_dom_update';
const RETRY_MS = 2 * 60 * 1000; // повтор не раньше чем через 2 минуты — защита от бесконечной перезагрузки

// Возвращает true, если началось обновление (страница сейчас перезагрузится).
export async function checkForUpdate({
  build = BUILD,
  fetchFn = globalThis.fetch,
  storage = safeSession(),
  reload = () => location.reload(),
  beforeReload = () => {},
  now = Date.now,
} = {}) {
  let info;
  try {
    const r = await fetchFn('version.json', { cache: 'no-store' });
    if (!r.ok) return false;
    info = await r.json();
  } catch {
    return false; // нет сети или файла — играем дальше
  }
  if (!info?.v || info.v === build) return false;
  try {
    const last = JSON.parse(storage?.getItem(KEY) || 'null');
    if (last && last.v === info.v && now() - last.t < RETRY_MS) return false;
    storage?.setItem(KEY, JSON.stringify({ v: info.v, t: now() }));
  } catch { /* без sessionStorage просто обновляемся */ }
  const files = ['./', ...(Array.isArray(info.files) ? info.files : [])];
  await Promise.all(files.map((f) => fetchFn(f, { cache: 'reload' }).catch(() => {})));
  beforeReload();
  reload();
  return true;
}

function safeSession() {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}
