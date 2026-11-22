// Retouche Vocale — script injecté dans les pages : barre flottante, clic long + glisser = capture, journal des clics.
(() => {
  if (window.top !== window || window.__retoucheVocale) return;
  window.__retoucheVocale = true;

  const MOVE_TOLERANCE = 6; // px de tremblement tolérés pendant le clic long
  const MIN_SIZE = 8; // px : en dessous, la capture est annulée
  const DEFAULTS = { longPressMs: 350, logClicks: true, barPosition: 'left' };

  let cfg = { ...DEFAULTS };
  let state = { active: false, micOn: true, events: [], shotCount: 0 };
  let lastChunkAt = 0; // dernier morceau audio reçu (pour détecter un micro muet)

  const send = (msg) => {
    try { return chrome.runtime.sendMessage(msg).catch(() => null); } catch { return Promise.resolve(null); }
  };
  const logEvent = (event) => send({ type: 'event', event: { url: location.href, title: document.title, t: Date.now(), ...event } });

  chrome.storage.sync.get('settings').then(({ settings }) => { cfg = { ...DEFAULTS, ...settings }; render(); }).catch(() => {});
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === 'sync' && ch.settings) { cfg = { ...DEFAULTS, ...ch.settings.newValue }; render(); }
  });

  // ---------- interface (shadow DOM pour ne pas être touchée par le CSS du site) ----------
  const ICONS = {
    mic: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
    micOff: '<svg viewBox="0 0 24 24"><path d="M15 9.3V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 5.1 2.1M5 11a7 7 0 0 0 11.6 5.3M19 11a7 7 0 0 1-.4 2.3M12 18v3M3 3l18 18"/></svg>',
    download: '<svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
    stop: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
    camera: '<svg viewBox="0 0 24 24"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/></svg>',
  };
  const host = document.createElement('retouche-vocale');
  host.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
  <style>
    :host{--brand:#f43f5e;--bg:rgba(24,24,27,.92);--line:rgba(255,255,255,.1);--muted:#a1a1aa}
    *{box-sizing:border-box}
    .bar{position:fixed;bottom:16px;left:16px;display:none;align-items:center;gap:2px;max-width:calc(100vw - 32px);height:40px;
      padding:0 4px 0 12px;border-radius:999px;background:var(--bg);color:#fafafa;border:1px solid var(--line);
      font:500 13px/1 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:.01em;
      box-shadow:0 10px 30px rgba(0,0,0,.35),0 1px 0 rgba(255,255,255,.06) inset;backdrop-filter:blur(12px);
      -webkit-backdrop-filter:blur(12px);user-select:none;transition:border-color .2s}
    .bar.right{left:auto;right:16px}
    .bar.on{display:flex}
    .bar.err{border-color:rgba(248,113,113,.7)}
    .dot{width:9px;height:9px;border-radius:50%;background:#71717a;flex:none;margin-right:8px}
    .dot.live{background:var(--brand);box-shadow:0 0 0 0 rgba(244,63,94,.6);animation:pulse 1.6s infinite}
    @keyframes pulse{70%{box-shadow:0 0 0 7px rgba(244,63,94,0)}100%{box-shadow:0 0 0 0 rgba(244,63,94,0)}}
    .time{font-variant-numeric:tabular-nums;color:#fafafa;margin-right:10px}
    .txt{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--muted);font-weight:400;margin-right:8px}
    .txt.err{color:#fca5a5}
    .chip{display:flex;align-items:center;gap:4px;flex:none;height:26px;padding:0 9px;margin-right:4px;border-radius:999px;
      background:rgba(255,255,255,.07);color:#e4e4e7;font-variant-numeric:tabular-nums}
    .sep{width:1px;height:20px;background:var(--line);margin:0 4px;flex:none}
    button{all:unset;cursor:pointer;flex:none;display:grid;place-items:center;width:32px;height:32px;border-radius:50%;color:#e4e4e7;transition:background .15s,color .15s}
    button:hover{background:rgba(255,255,255,.12);color:#fff}
    button:focus-visible{outline:2px solid var(--brand);outline-offset:1px}
    button.off{color:#fca5a5}
    button.allow{width:auto;padding:0 12px;border-radius:999px;background:var(--brand);color:#fff;font-weight:600;font-size:12px;height:28px;margin-right:4px}
    button.allow:hover{background:#e11d48}
    button.allow[hidden]{display:none}
    svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
    .chip svg{width:14px;height:14px}
    @media (max-width:560px){.txt{display:none}}
    .sel{position:fixed;display:none;border:1.5px solid var(--brand);background:rgba(244,63,94,.08);pointer-events:none;
      box-shadow:0 0 0 100vmax rgba(0,0,0,.18)}
    .sel.ok{display:block;border-color:#22c55e;background:rgba(34,197,94,.15);box-shadow:none;transition:opacity .6s}
    .size{position:absolute;right:-1px;top:calc(100% + 6px);padding:3px 7px;border-radius:6px;background:var(--brand);color:#fff;
      font:600 11px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap}
    .sel.ok .size{display:none}
    .ring{position:fixed;width:30px;height:30px;margin:-15px 0 0 -15px;border:2px solid var(--brand);border-radius:50%;
      pointer-events:none;display:none;animation:ring .3s ease-out}
    @keyframes ring{from{transform:scale(2);opacity:0}to{transform:scale(1);opacity:1}}
    .toast{position:fixed;left:50%;top:16px;transform:translate(-50%,-8px);opacity:0;max-width:min(560px,calc(100vw - 32px));
      padding:10px 16px;border-radius:12px;background:var(--bg);border:1px solid var(--line);color:#fafafa;
      font:13px/1.45 ui-sans-serif,system-ui,sans-serif;pointer-events:none;box-shadow:0 10px 30px rgba(0,0,0,.35);
      transition:opacity .2s,transform .2s;word-break:break-word}
    .toast.show{opacity:1;transform:translate(-50%,0)}
  </style>
  <div class="bar" role="toolbar" aria-label="Retouche Vocale">
    <span class="dot"></span><span class="time">00:00</span><span class="txt"></span>
    <span class="chip" title="Captures">${ICONS.camera}<span class="count">0</span></span>
    <span class="sep"></span>
    <button data-a="allow" class="allow" title="Autoriser le micro">Autoriser</button>
    <button data-a="mic" title="Couper / réactiver le micro"></button>
    <button data-a="export" title="Exporter (notes, captures, audio)">${ICONS.download}</button>
    <button data-a="stop" title="Arrêter la session">${ICONS.stop}</button>
  </div>
  <div class="sel"><span class="size"></span></div><div class="ring"></div><div class="toast" role="status"></div>`;
  const $ = (s) => root.querySelector(s);
  const bar = $('.bar'), dot = $('.dot'), txt = $('.txt'), count = $('.count'), micBtn = $('[data-a=mic]'), allowBtn = $('[data-a=allow]'), timeEl = $('.time');
  const selBox = $('.sel'), sizeEl = $('.size'), ring = $('.ring'), toastEl = $('.toast');

  const isOurs = (e) => e.composedPath().includes(host);

  bar.addEventListener('click', async (e) => {
    const a = e.target.closest('button')?.dataset.a;
    if (a === 'mic') send({ type: 'setMic', on: !state.micOn });
    if (a === 'allow') send({ type: 'openPermission' });
    if (a === 'stop') send({ type: 'stop' });
    if (a === 'export') {
      toast('Export en cours…', 15000);
      const r = await send({ type: 'export' });
      if (!r || r.error) return toast('Export impossible : ' + (r?.error || 'erreur inconnue'), 5000);
      let copied = false;
      try { await navigator.clipboard.writeText(promptFor(r.folder)); copied = true; } catch {}
      toast(`Exporté dans ${r.folder}` + (copied ? '\nLe prompt pour Claude Code est copié : colle-le.' : ''), 7000);
    }
  });

  let toastTimer;
  function toast(msg, ms = 2200) {
    toastEl.textContent = msg;
    toastEl.style.whiteSpace = 'pre-line';
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
  }

  const fmtTime = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    const mmss = `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    return h ? `${h}:${mmss}` : mmss;
  };

  function render() {
    if (!host.isConnected) document.documentElement.appendChild(host);
    bar.classList.toggle('on', !!state.active);
    bar.classList.toggle('right', cfg.barPosition === 'right');
    if (!state.active) return;
    const stale = state.micOn && lastChunkAt && Date.now() - lastChunkAt > 12000;
    const live = state.micOn && state.recording && !state.micError && !stale;
    const err = !!state.micError || stale;
    dot.classList.toggle('live', live);
    bar.classList.toggle('err', err);
    micBtn.innerHTML = state.micOn ? ICONS.mic : ICONS.micOff;
    allowBtn.hidden = !/autoris/i.test(state.micError || '');
    micBtn.classList.toggle('off', !state.micOn);
    timeEl.textContent = fmtTime(Date.now() - (state.startedAt || Date.now()));
    txt.classList.toggle('err', err);
    txt.textContent = state.micError
      ? state.micError
      : stale
        ? 'Le micro ne transmet plus rien, relance…'
        : !state.micOn
          ? 'Micro coupé'
          : live
            ? 'Clic long + glisser pour capturer'
            : 'Démarrage du micro…';
    count.textContent = state.shotCount || 0;
  }
  setInterval(() => { if (state.active) timeEl.textContent = fmtTime(Date.now() - (state.startedAt || Date.now())); }, 1000);

  // ---------- synchro avec l'état global ----------
  let lastHref = location.href;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.state) return;
    const was = state.active;
    state = changes.state.newValue || state;
    if (state.active && !was) { lastHref = location.href; logEvent({ type: 'nav' }); }
    if (!state.active) cancelAll();
    render();
  });
  send({ type: 'getState' }).then((s) => {
    if (!s || s.error) return;
    state = s;
    if (state.active) logEvent({ type: 'nav' });
    render();
  });
  // battement de cœur : l'onglet visible vérifie toutes les 5 s que le micro enregistre (et le relance sinon)

  setInterval(async () => {
    if (!state.active || !state.micOn || document.visibilityState !== 'visible') { lastChunkAt = 0; return; }
    const r = await send({ type: 'ensureRecording' });
    if (r && !r.error) lastChunkAt = r.recording ? r.lastChunkAt || Date.now() : lastChunkAt || Date.now();
    render();
  }, 5000);

  // navigation dans les applis monopage (SPA)
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      if (state.active) setTimeout(() => logEvent({ type: 'nav' }), 300);
    }
  }, 500);

  // ---------- description des éléments (pour que Claude Code retrouve le code) ----------
  const HASHY = /[:[\]\/!@]|^(css|sc|jsx|svelte|astro|emotion)-|^_?[a-zA-Z]{0,3}[0-9a-f]{5,}$|__[a-zA-Z0-9]{5}$/;
  function cssPath(el) {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && n !== document.documentElement && parts.length < 4; n = n.parentElement) {
      let p = n.localName;
      if (n.id && !/\d{3,}|:/.test(n.id)) { parts.unshift(`${p}#${CSS.escape(n.id)}`); break; }
      const tid = n.getAttribute('data-testid');
      if (tid) p += `[data-testid="${tid}"]`;
      else {
        const cls = [...n.classList].filter((c) => c.length < 32 && !HASHY.test(c)).slice(0, 2);
        if (cls.length) p += '.' + cls.map((c) => CSS.escape(c)).join('.');
      }
      parts.unshift(p);
    }
    return parts.join(' > ');
  }
  function snippet(el) {
    const raw = el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('placeholder') ||
      (el.localName === 'input' ? el.value : '') || el.innerText || '';
    const t = raw.replace(/\s+/g, ' ').trim();
    return t.length > 70 ? t.slice(0, 67) + '…' : t;
  }
  const describe = (el) => ({ sel: cssPath(el), text: snippet(el) });

  function elementsIn(r) {
    const found = [];
    for (const fx of [0.5, 0.17, 0.83]) {
      for (const fy of [0.5, 0.17, 0.83]) {
        const el = document.elementFromPoint(r.x + r.w * fx, r.y + r.h * fy);
        if (el && el !== host && el !== document.body && el !== document.documentElement && !found.includes(el)) found.push(el);
      }
    }
    // ancêtre commun, souvent le composant concerné
    let common = found[0];
    while (common && !found.every((el) => common.contains(el))) common = common.parentElement;
    const list = found.slice(0, 5);
    if (common && !list.includes(common) && common !== document.body && common !== document.documentElement) list.unshift(common);
    return list.map(describe);
  }

  // ---------- clics normaux : journalisés ----------
  let suppressClickUntil = 0;
  window.addEventListener('click', (e) => {
    if (Date.now() < suppressClickUntil) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (!state.active || !cfg.logClicks || isOurs(e) || !(e.target instanceof Element)) return;
    const el = e.target.closest('a,button,[role=button],input,select,textarea,label,summary') || e.target;
    logEvent({ type: 'click', el: describe(el) });
  }, true);

  // ---------- clic long + glisser = capture ----------
  let press = null; // clic en attente
  let sel = null; // sélection en cours
  const pageStyle = document.createElement('style');
  pageStyle.textContent = '*{cursor:crosshair !important;user-select:none !important}';

  window.addEventListener('mousedown', (e) => {
    if (!state.active || e.button !== 0 || isOurs(e) || sel) return;
    const p = { x: e.clientX, y: e.clientY };
    p.timer = setTimeout(() => { if (press === p) beginSelect(p.x, p.y); }, cfg.longPressMs);
    press = p;
  }, true);

  window.addEventListener('mousemove', (e) => {
    if (sel) {
      e.preventDefault(); e.stopPropagation();
      if (e.buttons === 0) return finishSelect(e.clientX, e.clientY); // bouton relâché hors de la page
      sel.x2 = e.clientX; sel.y2 = e.clientY;
      drawSel();
      return;
    }
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > MOVE_TOLERANCE) cancelPress();
  }, true);

  window.addEventListener('mouseup', (e) => {
    if (sel) {
      e.preventDefault(); e.stopPropagation();
      suppressClickUntil = Date.now() + 400; // le relâchement ne doit pas cliquer sur la page
      finishSelect(e.clientX, e.clientY);
      return;
    }
    cancelPress();
  }, true);

  window.addEventListener('dragstart', (e) => {
    if (sel) e.preventDefault();
    else if (press) cancelPress(); // glisser-déposer normal
  }, true);
  window.addEventListener('selectstart', (e) => { if (sel) e.preventDefault(); }, true);
  window.addEventListener('keydown', (e) => {
    if (sel && e.key === 'Escape') { e.preventDefault(); endSelect(); toast('Capture annulée'); }
  }, true);
  window.addEventListener('blur', () => { cancelPress(); });

  function cancelPress() {
    if (press) clearTimeout(press.timer);
    press = null;
  }
  function cancelAll() {
    cancelPress();
    if (sel) endSelect();
  }

  function beginSelect(x, y) {
    press = null;
    sel = { x1: x, y1: y, x2: x, y2: y };
    window.getSelection()?.removeAllRanges();
    (document.head || document.documentElement).appendChild(pageStyle);
    ring.style.left = x + 'px';
    ring.style.top = y + 'px';
    ring.style.display = 'block';
    selBox.className = 'sel';
    drawSel();
  }

  function rectOf(s) {
    const x1 = Math.max(0, Math.min(s.x1, s.x2)), y1 = Math.max(0, Math.min(s.y1, s.y2));
    const x2 = Math.min(innerWidth, Math.max(s.x1, s.x2)), y2 = Math.min(innerHeight, Math.max(s.y1, s.y2));
    return { x: Math.round(x1), y: Math.round(y1), w: Math.round(x2 - x1), h: Math.round(y2 - y1) };
  }

  function drawSel() {
    const r = rectOf(sel);
    sizeEl.textContent = `${r.w} × ${r.h}`;
    Object.assign(selBox.style, { display: 'block', left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px', opacity: '1' });
  }

  function endSelect() {
    sel = null;
    pageStyle.remove();
    ring.style.display = 'none';
    selBox.style.display = 'none';
  }

  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

  async function finishSelect(x, y) {
    sel.x2 = x; sel.y2 = y;
    const r = rectOf(sel);
    endSelect();
    if (r.w < MIN_SIZE || r.h < MIN_SIZE) return toast('Zone trop petite, capture annulée');
    const t = Date.now();
    const elements = elementsIn(r);
    window.getSelection()?.removeAllRanges();
    // on cache notre interface pour qu'elle n'apparaisse pas sur la capture
    host.style.setProperty('visibility', 'hidden');
    await nextFrame(); await nextFrame(); await nextFrame();
    const res = await send({
      type: 'captureShot',
      meta: {
        t, url: location.href, title: document.title, rect: r, elements,
        viewport: { w: innerWidth, h: innerHeight },
        scroll: { x: Math.round(scrollX), y: Math.round(scrollY) },
      },
    });
    host.style.removeProperty('visibility');
    if (!res || res.error) return toast('Capture impossible : ' + (res?.error || 'erreur inconnue'), 4000);
    Object.assign(selBox.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px', opacity: '1' });
    selBox.className = 'sel ok';
    requestAnimationFrame(() => (selBox.style.opacity = '0'));
    setTimeout(() => { selBox.className = 'sel'; selBox.style.display = 'none'; }, 700);
    toast(`Capture ${res.id} enregistrée`);
  }

  function promptFor(folder) {
    return `Dans le dossier ${folder} il y a mes retouches visuelles pour ce site : lance d'abord \`python transcrire.py\` (ou python3) dans ce dossier (ça transcrit mes remarques dictées et génère notes.md), puis lis notes.md, ouvre les captures d'écran qu'il référence, et applique toutes les retouches demandées, page par page.`;
  }

  render();
})();
