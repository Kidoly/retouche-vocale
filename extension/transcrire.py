#!/usr/bin/env python3
"""Retouche Vocale — transcrit l'audio de la session (Whisper, en local) et génère notes.md.

Usage :  python transcrire.py [dossier] [--modele small|medium|large-v3-turbo]
         (Linux/macOS : python3 ; Windows : python ou py)
Par défaut, le modèle est celui choisi dans les options de l'extension.
Par défaut, le dossier est celui du script. Au premier lancement, installe faster-whisper
dans ~/.cache/retouche-vocale/venv et télécharge le modèle (une seule fois).
"""
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

# console Windows : forcer l'UTF-8 pour les accents et symboles
for stream in (sys.stdout, sys.stderr):
    try:
        stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

VENV = Path.home() / ".cache" / "retouche-vocale" / "venv"
# phrases que Whisper invente sur les silences / bruits
HALLUCINATION = re.compile(
    r"amara\.org|sous-titr(es|age) (réalisés|par|fait)|merci d'avoir regardé|abonnez-vous|^\W*(musique|applaudissements)\W*$",
    re.I,
)


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def ensure_whisper():
    try:
        import faster_whisper  # noqa: F401
        return
    except ImportError:
        pass
    py = VENV / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    if Path(sys.prefix).resolve() == VENV.resolve():
        sys.exit("faster-whisper introuvable dans le venv, même après installation.")
    if not py.exists():
        log(f"Installation de faster-whisper dans {VENV} (une seule fois)…")
        subprocess.check_call([sys.executable, "-m", "venv", str(VENV)])
    try:
        subprocess.check_call([str(py), "-c", "import faster_whisper"], stderr=subprocess.DEVNULL)
    except subprocess.CalledProcessError:
        subprocess.check_call([str(py), "-m", "pip", "install", "-q", "faster-whisper"])
    # relance le script avec le Python du venv (subprocess plutôt qu'execv : fiable sous Windows)
    sys.exit(subprocess.call([str(py), os.path.abspath(__file__), *sys.argv[1:]]))


def parse_args():
    args = sys.argv[1:]
    model = os.environ.get("RV_MODELE")  # sinon : modèle choisi dans les options de l'extension
    if "--modele" in args:
        i = args.index("--modele")
        model = args[i + 1]
        del args[i : i + 2]
    folder = Path(args[0]) if args else Path(__file__).resolve().parent
    return folder, model


def load_audio(path: Path):
    """Décode en 16 kHz mono : ffmpeg s'il est installé, sinon PyAV (fourni avec faster-whisper)."""
    import numpy as np

    if shutil.which("ffmpeg"):
        raw = subprocess.run(
            ["ffmpeg", "-nostdin", "-v", "error", "-i", str(path), "-f", "s16le", "-ac", "1", "-ar", "16000", "-"],
            check=True, capture_output=True,
        ).stdout
        return np.frombuffer(raw, np.int16).astype(np.float32) / 32768.0

    import av

    out = []
    resampler = av.AudioResampler(format="s16", layout="mono", rate=16000)
    with av.open(str(path)) as container:
        for frame in container.decode(audio=0):
            for f in resampler.resample(frame):
                out.append(f.to_ndarray().reshape(-1))
        for f in resampler.resample(None):
            out.append(f.to_ndarray().reshape(-1))
    return np.concatenate(out).astype(np.float32) / 32768.0 if out else np.zeros(0, np.float32)


def transcribe(folder: Path, session: dict, model_name: str):
    """Renvoie des événements 'speech' horodatés ; met en cache dans transcription.json."""
    cache_file = folder / "transcription.json"
    cache = json.loads(cache_file.read_text(encoding="utf-8")) if cache_file.exists() else {}
    files = [a for a in session.get("audio", []) if (folder / a["file"]).exists()]
    todo = [a for a in files if cache.get(a["file"], {}).get("modele") != model_name
            or cache[a["file"]].get("taille") != (folder / a["file"]).stat().st_size]
    if todo:
        ensure_whisper()
        from faster_whisper import WhisperModel

        log(f"Chargement du modèle Whisper « {model_name} » (téléchargé au premier lancement)…")
        model = WhisperModel(model_name, device="auto", compute_type="int8")
        for a in todo:
            path = folder / a["file"]
            log(f"Transcription de {a['file']}…")
            segments, _ = model.transcribe(
                load_audio(path), language="fr", vad_filter=True, beam_size=5,
                condition_on_previous_text=False,
            )
            segs = []
            for s in segments:
                text = s.text.strip()
                if text and not HALLUCINATION.search(text):
                    segs.append({"start": s.start, "end": s.end, "text": text})
                    log(f"  [{s.start:6.1f}s] {text}")
            cache[a["file"]] = {"modele": model_name, "taille": path.stat().st_size, "segments": segs}
        cache_file.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")

    speech = []
    for a in files:
        for s in cache.get(a["file"], {}).get("segments", []):
            speech.append({
                "type": "speech",
                "t": a["startedAt"] + s["start"] * 1000,
                "end": a["startedAt"] + s["end"] * 1000,
                "text": s["text"],
            })
    return speech


def hms(t):
    return datetime.fromtimestamp(t / 1000).strftime("%H:%M:%S")


def fmt_el(el):
    if not el:
        return "?"
    return f"`{el.get('sel', '?')}`" + (f" « {el['text']} »" if el.get("text") else "")


def build_markdown(session, speech):
    events = sorted(session["events"] + speech, key=lambda e: e["t"])

    # fusionne les morceaux de parole consécutifs (pas d'autre événement entre eux, pause < 2,5 s)
    merged = []
    for ev in events:
        prev = merged[-1] if merged else None
        if (ev["type"] == "speech" and prev and prev["type"] == "speech"
                and ev["t"] - prev["end"] < 2500 and len(prev["text"]) < 500):
            prev["text"] += " " + ev["text"]
            prev["end"] = ev["end"]
        else:
            merged.append(dict(ev))

    # regroupe par page : la parole hérite de la page affichée à ce moment-là
    groups, cur, url = [], None, None
    for ev in merged:
        if ev.get("url"):
            url = ev["url"]
        if cur is None or (url and url != cur["url"]):
            cur = {"url": url, "title": ev.get("title"), "items": []}
            groups.append(cur)
        if not cur["title"] and ev.get("title"):
            cur["title"] = ev["title"]
        if ev["type"] != "nav":
            cur["items"].append(ev)

    started = datetime.fromtimestamp((session.get("startedAt") or events[0]["t"]) / 1000)
    L = [
        f"# Retouches visuelles — session du {started.strftime('%d/%m/%Y à %H:%M')}",
        "",
        "Remarques dictées à voix haute en naviguant sur le site, avec des captures de zones précises.",
        "",
        "**Pour Claude Code :**",
        "- Chaque section `##` correspond à une page du site (URL indiquée). Les remarques 🗣️ décrivent les retouches visuelles à faire.",
        "- Une remarque peut précéder ou suivre de quelques secondes la capture 📸 qu'elle concerne : fie-toi au sens et à l'ordre chronologique.",
        "- La transcription est automatique : elle peut contenir des erreurs de mots, interprète l'intention.",
        "- Ouvre les images `capture-XX.png` (dans ce dossier) pour voir les zones. Les sélecteurs CSS listés aident à retrouver les composants dans le code.",
        "- Les 🖱️ clics indiquent sur quoi j'ai cliqué pendant que je parlais (« ce bouton-là », etc.).",
        "",
    ]
    for g in groups:
        if not g["items"]:
            continue
        L += [f"## {g['title'] or 'Page sans titre'}", "", f"URL : <{g['url']}>", ""]
        for ev in g["items"]:
            t = hms(ev["t"])
            if ev["type"] == "speech":
                L.append(f"- `{t}` 🗣️ « {ev['text']} »")
            elif ev["type"] == "click":
                L.append(f"- `{t}` 🖱️ clic sur {fmt_el(ev.get('el'))}")
            elif ev["type"] == "shot":
                r, vp, sc = ev["rect"], ev["viewport"], ev.get("scroll", {"y": 0})
                L.append(
                    f"- `{t}` 📸 **Capture {ev['id']}** (`{ev['file']}`) — zone {r['w']}×{r['h']} px "
                    f"en ({r['x']}, {r['y']}), fenêtre {vp['w']}×{vp['h']}, défilement vertical {sc['y']} px"
                )
                if ev.get("elements"):
                    L.append("  - Éléments dans la zone : " + " ; ".join(fmt_el(e) for e in ev["elements"]))
                L += ["", f"  ![Capture {ev['id']}]({ev['file']})", ""]
        L.append("")
    return "\n".join(L)


def main():
    folder, model = parse_args()
    session_file = folder / "session.json"
    if not session_file.exists():
        sys.exit(f"Pas de session.json dans {folder}")
    session = json.loads(session_file.read_text(encoding="utf-8"))
    model = model or session.get("modele") or "small"
    speech = transcribe(folder, session, model)
    md = build_markdown(session, speech)
    out = folder / "notes.md"
    out.write_text(md, encoding="utf-8")
    shots = sum(1 for e in session["events"] if e["type"] == "shot")
    log(f"\n✅ {out} généré — {len(speech)} passage(s) dicté(s), {shots} capture(s).")
    print(out)


if __name__ == "__main__":
    main()
