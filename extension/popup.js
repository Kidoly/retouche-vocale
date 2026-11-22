const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);

const promptFor = (folder) =>
  `Dans le dossier ${folder} il y a mes retouches visuelles pour ce site : lance d'abord \`python transcrire.py\` (ou python3) dans ce dossier (ça transcrit mes remarques dictées et génère notes.md), puis lis notes.md, ouvre les captures d'écran qu'il référence, et applique toutes les retouches demandées, page par page.`;

const fmtDuration = (ms) => {
  const m = Math.floor(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
};

let state = null;
async function refresh() {
  state = await send({ type: 'getState' });
  const s = state;
  const { lastExport } = await chrome.storage.local.get('lastExport');
  const live = s.active && s.micOn && s.recording && !s.micError;
  $('dot').classList.toggle('live', live);
  $('statusTitle').textContent = !s.active ? 'Session arrêtée' : live ? 'Enregistrement en cours' : s.micOn ? 'Session active, micro en attente' : 'Session active, micro coupé';
  $('statusSub').textContent = s.active ? 'Clic long + glisser sur la page pour capturer.' : s.events.length ? 'Reprends ou exporte la session.' : 'Démarre puis navigue en parlant.';
  $('toggle').textContent = s.active ? 'Arrêter la session' : s.events.length ? 'Reprendre la session' : 'Démarrer la session';
  $('toggle').classList.toggle('primary', !s.active);
  $('mic').textContent = s.micOn ? 'Micro activé' : 'Micro coupé';
  $('nShots').textContent = s.shotCount || 0;
  $('nPages').textContent = new Set(s.events.map((e) => e.url).filter(Boolean)).size;
  $('nTime').textContent = s.startedAt ? fmtDuration((s.active ? Date.now() : s.events.at(-1)?.t || s.startedAt) - s.startedAt) : '0:00';
  $('alert').hidden = !s.micError;
  if (s.micError) {
    $('alert').innerHTML = '';
    $('alert').append(s.micError + '. ');
    const a = Object.assign(document.createElement('a'), { href: '#', textContent: 'Autoriser le micro' });
    a.onclick = (e) => { e.preventDefault(); chrome.tabs.create({ url: 'permission.html' }); };
    $('alert').append(a);
  }
  $('exportBox').hidden = !lastExport;
  if (lastExport) $('exportPath').textContent = lastExport.folder;
}

$('toggle').onclick = async () => {
  const wasActive = state?.active;
  await send({ type: wasActive ? 'stop' : 'start' });
  if (!wasActive) window.close(); // rend la main à la page
  else refresh();
};
$('mic').onclick = async () => { await send({ type: 'setMic', on: !state.micOn }); refresh(); };
$('export').onclick = async () => {
  $('export').textContent = 'Export…';
  $('export').disabled = true;
  const r = await send({ type: 'export' });
  $('export').disabled = false;
  $('export').textContent = 'Exporter';
  await refresh();
  if (r?.error) {
    $('alert').hidden = false;
    $('alert').textContent = r.error;
  } else if (r?.folder) await copy(r.folder);
};
$('copy').onclick = async () => {
  const { lastExport } = await chrome.storage.local.get('lastExport');
  if (lastExport) await copy(lastExport.folder);
};
async function copy(folder) {
  await navigator.clipboard.writeText(promptFor(folder));
  $('copy').textContent = 'Copié, colle-le dans Claude Code ✓';
  setTimeout(() => ($('copy').textContent = 'Copier le prompt pour Claude Code'), 2500);
}
$('clear').onclick = async (e) => {
  e.preventDefault();
  if (!confirm('Effacer toutes les notes, captures et l’audio de la session ?')) return;
  await send({ type: 'clear' });
  refresh();
};
$('options').onclick = (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); };
$('help').onclick = (e) => { e.preventDefault(); chrome.tabs.create({ url: 'options.html#aide' }); };

chrome.commands.getAll().then((cmds) => {
  const c = cmds.find((x) => x.name === 'toggle-session');
  $('shortcut').textContent = c?.shortcut || '';
  $('shortcut').hidden = !c?.shortcut;
});

refresh();
chrome.storage.onChanged.addListener(refresh);
setInterval(() => state?.active && refresh(), 1000);
