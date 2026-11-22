// Document invisible qui enregistre le micro pendant toute la session (survit aux changements de page).
// Si l'enregistrement meurt (micro débranché, piste coupée, erreur…), il prévient le service worker,
// qui le relance aussitôt.
let rec = null; // { recorder, stream, id, startedAt, lastChunkAt, stopping }
let pendingWrites = Promise.resolve();

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== 'offscreen') return;
  const job = msg.type === 'sync' ? sync(msg.want) : msg.type === 'flush' ? flush() : Promise.resolve(status());
  job.then(sendResponse, (err) => sendResponse({ error: String(err?.message || err), errorName: err?.name, ...status() }));
  return true;
});

function status() {
  return { recording: alive(), current: rec && { id: rec.id, startedAt: rec.startedAt }, lastChunkAt: rec?.lastChunkAt || 0 };
}

function alive() {
  return !!rec && rec.recorder.state === 'recording' && rec.stream.getAudioTracks().some((t) => t.readyState === 'live');
}

function report(reason) {
  chrome.runtime.sendMessage({ type: 'recorderLog', reason, id: rec?.id }).catch(() => {});
}

async function sync(want) {
  if (want) {
    if (rec && !alive()) {
      report(`enregistrement trouvé mort (état ${rec.recorder.state}), relance`);
      await stop();
    }
    if (!rec) return { ...(await start()), ...status() };
  } else if (rec) {
    await stop();
  }
  return status();
}

async function start() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
  const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 48000 });
  const startedAt = Date.now();
  const me = { recorder, stream, id: `audio-${startedAt}`, startedAt, lastChunkAt: startedAt, stopping: false };

  recorder.ondataavailable = (e) => {
    if (!e.data || !e.data.size) return;
    me.lastChunkAt = Date.now();
    pendingWrites = pendingWrites.then(() => RV_DB.put(me.id, e.data)).catch((err) => report('écriture audio impossible : ' + err));
  };
  // arrêts NON demandés : on prévient pour relancer
  const died = (why) => {
    if (me.stopping || rec !== me) return;
    report(why);
    cleanup(me);
    if (rec === me) rec = null;
    chrome.runtime.sendMessage({ type: 'recorderDied', reason: why }).catch(() => {});
  };
  recorder.onerror = (e) => died('erreur MediaRecorder : ' + (e.error?.name || e.error || '?'));
  recorder.onstop = () => died('MediaRecorder arrêté tout seul');
  for (const track of stream.getAudioTracks()) {
    track.onended = () => died(`piste micro terminée (${track.label || 'micro'})`);
    track.onmute = () => report(`piste micro muette (${track.label || 'micro'})`);
    track.onunmute = () => report('piste micro de nouveau active');
  }

  recorder.start(4000); // un morceau toutes les 4 s, sauvegardé au fur et à mesure
  rec = me;
  report(`enregistrement démarré (${stream.getAudioTracks()[0]?.label || 'micro'})`);
  return { started: { id: me.id, startedAt } };
}

function cleanup(me) {
  try { if (me.recorder.state !== 'inactive') me.recorder.stop(); } catch {}
  me.stream.getTracks().forEach((t) => t.stop());
}

function stop() {
  const me = rec;
  rec = null;
  if (!me) return Promise.resolve();
  me.stopping = true;
  return new Promise((resolve) => {
    const done = async () => { await pendingWrites; resolve(); };
    if (me.recorder.state === 'inactive') { cleanup(me); return done(); }
    me.recorder.addEventListener('stop', done, { once: true });
    cleanup(me);
  });
}

async function flush() {
  if (alive()) {
    await new Promise((resolve) => {
      rec.recorder.addEventListener('dataavailable', () => setTimeout(resolve, 0), { once: true });
      rec.recorder.requestData();
    });
  }
  await pendingWrites;
  return status();
}

// battement de cœur : garde le service worker éveillé et détecte un enregistrement mort
setInterval(() => {
  chrome.runtime.sendMessage({ type: 'recorderHeartbeat', ...status() }).catch(() => {});
}, 10000);
