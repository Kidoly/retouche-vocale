// Page d'accueil / autorisation du micro.
// Important : ne jamais fermer cet onglet automatiquement. Si l'utilisateur choisit
// « Autoriser cette fois », l'accès est retiré dès que l'onglet se ferme.
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

if (params.get('raison') === 'perdu') {
  $('askTitle').textContent = 'Le micro a été retiré';
  $('askText').textContent = 'Le navigateur a repris l’accès au micro (probablement « Autoriser cette fois » la dernière fois). Autorise-le de façon permanente pour ne plus être dérangé.';
}

function showDone() {
  $('ask').hidden = true;
  $('done').hidden = false;
  chrome.runtime.sendMessage({ type: 'micGranted' });
}

$('go').onclick = async () => {
  $('err').hidden = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    showDone();
  } catch (err) {
    $('err').hidden = false;
    $('err').textContent = err.name === 'NotAllowedError'
      ? 'Accès refusé. Clique sur l’icône à gauche de la barre d’adresse pour réinitialiser l’autorisation, puis réessaie.'
      : err.name === 'NotFoundError'
        ? 'Aucun micro détecté. Branche un micro puis réessaie.'
        : 'Erreur : ' + err.message;
  }
};

$('close').onclick = () => window.close();
$('manual').onclick = (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: 'chrome://settings/content/siteDetails?site=' + encodeURIComponent(location.origin) });
};

chrome.commands.getAll().then((cmds) => {
  const c = cmds.find((x) => x.name === 'toggle-session');
  if (c?.shortcut) $('shortcut').textContent = c.shortcut;
});

// déjà autorisé (ou autorisé depuis les réglages pendant que la page est ouverte)
navigator.permissions.query({ name: 'microphone' }).then((p) => {
  const check = () => { if (p.state === 'granted' && params.get('raison') !== 'perdu') showDone(); };
  p.onchange = () => { if (p.state === 'granted') showDone(); };
  check();
});
