// Retouche Vocale — service worker : état de la session, captures, micro, export.
importScripts('db.js');

const EMPTY = () => ({ active: false, micOn: true, startedAt: null, events: [], shotCount: 0, audio: [], micError: '', recording: false, recLog: [] });

// ---------- état (sérialisé pour éviter les écritures concurrentes) ----------
let queue = Promise.resolve();
function update(fn) {
  const run = queue.then(async () => {
    const { state } = await chrome.storage.local.get('state');
    const s = { ...EMPTY(), ...(state || {}) };
    const result = await fn(s);
    await chrome.storage.local.set({ state: s });
    return result;
  });
  queue = run.catch(() => {});
  return run;
}
async function getState() {
  const { state } = await chrome.storage.local.get('state');
  return { ...EMPTY(), ...(state || {}) };
}

// ---------- messages ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target === 'offscreen') return; // pas pour nous
  handle(msg, sender).then(
    (r) => sendResponse(r ?? { ok: true }),
    (err) => sendResponse({ error: String(err?.message || err) })
  );
  return true;
});

chrome.commands.onCommand.addListener((cmd) => {
  if (cmd === 'toggle-session') handle({ type: 'toggle' }, {});
});
chrome.runtime.onStartup.addListener(() => { syncRecorder(); refreshBadge(); });
chrome.runtime.onInstalled.addListener(({ reason }) => {
  refreshBadge();
  if (reason === 'install') chrome.tabs.create({ url: 'permission.html' }); // accueil : autoriser le micro une fois
});

// icône grise quand la session est arrêtée, rouge + nombre de captures quand elle tourne
const iconSet = (name) => ({ 16: `icons/${name}-16.png`, 32: `icons/${name}-32.png`, 48: `icons/${name}-48.png` });
let badgeKey = '';
async function refreshBadge(s) {
  s = s || (await getState());
  const key = `${s.active}|${s.shotCount}|${!!s.micError}`;
  if (key === badgeKey) return;
  badgeKey = key;
  await chrome.action.setIcon({ path: iconSet(s.active ? 'icon' : 'icon-off') });
  await chrome.action.setBadgeBackgroundColor({ color: s.micError ? '#dc2626' : '#18181b' });
  await chrome.action.setBadgeText({ text: s.micError ? '!' : s.active && s.shotCount ? String(s.shotCount) : '' });
  await chrome.action.setTitle({ title: s.active ? `Retouche Vocale · session en cours (${s.shotCount || 0} capture(s))` : 'Retouche Vocale' });
}
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === 'local' && ch.state?.newValue) refreshBadge({ ...EMPTY(), ...ch.state.newValue });
});

async function handle(msg, sender) {
  switch (msg.type) {
    case 'getState':
      syncRecorder(); // relance l'enregistrement si le navigateur a redémarré
      return getState();
    case 'start':
      await injectIntoActiveTab();
      await update((s) => {
        s.active = true;
        if (!s.startedAt) s.startedAt = Date.now();
      });
      return syncRecorder();
    case 'stop':
      await update((s) => { s.active = false; });
      return syncRecorder();
    case 'toggle':
      return handle({ type: (await getState()).active ? 'stop' : 'start' }, sender);
    case 'setMic':
      await update((s) => { s.micOn = !!msg.on; });
      return syncRecorder();
    case 'micGranted':
      return syncRecorder();
    case 'openPermission':
      await chrome.tabs.create({ url: 'permission.html' + ((await getState()).audio.length ? '?raison=perdu' : '') });
      return { ok: true };
    case 'ensureRecording': // battement de cœur envoyé par l'onglet visible toutes les 5 s
      return syncRecorder();
    case 'recorderLog':
      await recLog(msg.reason);
      return { ok: true };
    case 'recorderDied':
      return syncRecorder();
    case 'recorderHeartbeat':
      if (!msg.recording) return syncRecorder();
      return { ok: true };
    case 'event':
      return update((s) => addEvent(s, msg.event));
    case 'captureShot':
      return captureShot(msg, sender);
    case 'export':
      return exportSession();
    case 'clear':
      return clearSession();
    default:
      return { error: 'message inconnu' };
  }
}

function addEvent(s, ev) {
  if (!s.active) return;
  ev = { ...ev, t: ev.t || Date.now() };
  if (ev.type === 'nav') {
    // ignore les rechargements de la même page
    for (let i = s.events.length - 1; i >= 0; i--) {
      if (s.events[i].url) {
        if (s.events[i].url === ev.url) return;
        break;
      }
    }
  }
  s.events.push(ev);
}

async function injectIntoActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id && /^(https?|file):/.test(tab.url || '')) {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    }
  } catch {}
}

// ---------- micro (document offscreen) ----------
let recQueue = Promise.resolve();
function syncRecorder() {
  const run = recQueue.then(doSyncRecorder);
  recQueue = run.catch(() => {});
  return run;
}
async function hasOffscreen() {
  const ctx = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  return ctx.length > 0;
}
// journal de diagnostic du micro (exporté dans session.json)
async function recLog(reason) {
  await update((st) => {
    st.recLog = [...(st.recLog || []), { t: Date.now(), reason }].slice(-300);
  });
}

let permissionTabOpenedAt = 0;
async function doSyncRecorder() {
  const s = await getState();
  const want = s.active && s.micOn;
  const exists = await hasOffscreen();
  if (!want && !exists) return { recording: false };
  if (!exists) {
    if (s.recording) await recLog('document d’enregistrement disparu, recréation');
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Enregistrer les remarques dictées au micro pendant la session',
    });
  }
  let res;
  try {
    res = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'sync', want });
  } catch (err) {
    res = null;
  }
  if (!res) {
    // document présent mais muet : on le recrée au prochain battement
    await recLog('document d’enregistrement ne répond plus, fermeture');
    await chrome.offscreen.closeDocument().catch(() => {});
    await setIfChanged({ recording: false });
    return { recording: false };
  }
  if (res.error) {
    const micError = res.errorName === 'NotAllowedError' ? 'Micro non autorisé' : res.error;
    if (micError !== s.micError) await recLog('erreur micro : ' + res.error);
    await setIfChanged({ micError, recording: false });
    if ((res.errorName === 'NotAllowedError' || res.errorName === 'NotFoundError') && Date.now() - permissionTabOpenedAt > 600000) {
      permissionTabOpenedAt = Date.now();
      chrome.tabs.create({ url: 'permission.html' + (s.audio.length ? '?raison=perdu' : '') });
    }
    return { recording: false, micError };
  }
  if (res.started && !s.audio.some((a) => a.id === res.started.id)) {
    await update((st) => { st.audio.push(res.started); });
  }
  await setIfChanged({ micError: '', recording: !!res.recording });
  if (!want) await chrome.offscreen.closeDocument().catch(() => {});
  return { recording: !!res.recording, lastChunkAt: res.lastChunkAt || 0 };
}

// n'écrit l'état que s'il change (évite de redessiner tous les onglets toutes les 5 s)
async function setIfChanged(patch) {
  const s = await getState();
  if (Object.entries(patch).every(([k, v]) => s[k] === v)) return;
  await update((st) => Object.assign(st, patch));
}

// ---------- captures ----------
async function captureShot(msg, sender) {
  if (!(await getState()).active) return { error: 'Session inactive' };
  const raw = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' });
  const dataUrl = await crop(raw, msg.meta.rect, msg.meta.viewport.w);
  return update(async (s) => {
    s.shotCount = (s.shotCount || 0) + 1;
    const id = s.shotCount;
    await chrome.storage.local.set({ ['shot:' + id]: dataUrl });
    s.events.push({ type: 'shot', id, t: msg.meta.t || Date.now(), ...msg.meta });
    return { id };
  });
}

async function crop(dataUrl, r, viewportW) {
  const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const k = bmp.width / viewportW; // gère le zoom et les écrans HiDPI
  const w = Math.max(1, Math.round(r.w * k));
  const h = Math.max(1, Math.round(r.h * k));
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext('2d').drawImage(bmp, Math.round(r.x * k), Math.round(r.y * k), w, h, 0, 0, w, h);
  return blobToDataUrl(await canvas.convertToBlob({ type: 'image/png' }));
}

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(bin)}`;
}

// ---------- export ----------
const pad = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}h${pad(d.getMinutes())}`;
const shotName = (id) => `capture-${pad(id)}.png`;

function download(url, filename) {
  return chrome.downloads.download({ url, filename, conflictAction: 'overwrite', saveAs: false });
}
function waitDownload(id) {
  return new Promise((resolve) => {
    const check = async () => {
      const [item] = await chrome.downloads.search({ id });
      if (!item || item.state !== 'in_progress') {
        chrome.downloads.onChanged.removeListener(listener);
        resolve(item);
      }
    };
    const listener = (delta) => { if (delta.id === id) check(); };
    chrome.downloads.onChanged.addListener(listener);
    check();
  });
}

async function exportSession() {
  if (await hasOffscreen()) {
    await chrome.runtime.sendMessage({ target: 'offscreen', type: 'flush' }).catch(() => {});
  }
  const s = await getState();
  if (!s.events.some((e) => e.type !== 'nav') && !s.audio.length) {
    return { error: 'Rien à exporter pour l’instant.' };
  }
  const dir = `retouches-visuelles/${stamp(new Date(s.startedAt || Date.now()))}`;

  for (const ev of s.events) {
    if (ev.type !== 'shot') continue;
    const key = 'shot:' + ev.id;
    const { [key]: data } = await chrome.storage.local.get(key);
    if (data) await download(data, `${dir}/${shotName(ev.id)}`);
  }
  const audio = [];
  for (const a of s.audio) {
    const blob = await RV_DB.getFile(a.id);
    if (!blob) continue;
    await download(await blobToDataUrl(blob), `${dir}/${a.id}.webm`);
    audio.push({ ...a, file: `${a.id}.webm` });
  }
  const script = await (await fetch(chrome.runtime.getURL('transcrire.py'))).text();
  await download('data:text/x-python;charset=utf-8,' + encodeURIComponent(script), `${dir}/transcrire.py`);

  const { settings } = await chrome.storage.sync.get('settings');
  const session = {
    version: 1,
    modele: settings?.modele || 'small',
    startedAt: s.startedAt,
    exportedAt: Date.now(),
    events: s.events.map((e) => (e.type === 'shot' ? { ...e, file: shotName(e.id) } : e)),
    audio,
    diagnostic_micro: (s.recLog || []).map((l) => ({ ...l, heure: new Date(l.t).toLocaleTimeString('fr-FR') })),
  };
  const id = await download(
    'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(session, null, 2)),
    `${dir}/session.json`
  );
  const item = await waitDownload(id);
  const path = item?.filename || '';
  const folder = path.replace(/[\\/][^\\/]*$/, ''); // / ou \\ (Windows)
  const result = { folder, at: Date.now(), shots: s.shotCount, audio: audio.length };
  await chrome.storage.local.set({ lastExport: result });
  try { chrome.downloads.show(id); } catch {}
  return result;
}

async function clearSession() {
  await update(async (s) => {
    const keys = [];
    for (let i = 1; i <= (s.shotCount || 0); i++) keys.push('shot:' + i);
    if (keys.length) await chrome.storage.local.remove(keys);
    const { active, micOn } = s;
    Object.assign(s, EMPTY(), { active, micOn, startedAt: active ? Date.now() : null });
  });
  // l'enregistrement en cours repart sur un nouveau fichier
  if (await hasOffscreen()) {
    await chrome.runtime.sendMessage({ target: 'offscreen', type: 'sync', want: false }).catch(() => {});
  }
  await RV_DB.clear();
  await chrome.storage.local.remove('lastExport');
  return syncRecorder();
}
