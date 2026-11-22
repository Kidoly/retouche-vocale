const DEFAULTS = { longPressMs: 350, logClicks: true, barPosition: 'left', modele: 'small' };
const $ = (id) => document.getElementById(id);

async function load() {
  const { settings } = await chrome.storage.sync.get('settings');
  const s = { ...DEFAULTS, ...settings };
  $('longPressMs').value = s.longPressMs;
  $('logClicks').checked = s.logClicks;
  $('barPosition').value = s.barPosition;
  $('modele').value = s.modele;
}

let savedTimer;
async function save() {
  const ms = Math.min(1500, Math.max(150, Number($('longPressMs').value) || DEFAULTS.longPressMs));
  await chrome.storage.sync.set({
    settings: { longPressMs: ms, logClicks: $('logClicks').checked, barPosition: $('barPosition').value, modele: $('modele').value },
  });
  $('saved').classList.add('show');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => $('saved').classList.remove('show'), 1500);
}

for (const id of ['longPressMs', 'logClicks', 'barPosition', 'modele']) $(id).addEventListener('change', save);
$('mic').onclick = () => chrome.tabs.create({ url: 'permission.html' });
$('shortcuts').onclick = () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
chrome.commands.getAll().then((cmds) => {
  const c = cmds.find((x) => x.name === 'toggle-session');
  if (c?.shortcut) $('shortcut').textContent = c.shortcut;
});
$('version').textContent = 'Version ' + chrome.runtime.getManifest().version;
load();
