#!/usr/bin/env bash
# Construit les paquets de Retouche Vocale dans dist/ :
#   - retouche-vocale-<version>.zip  → pour le Chrome Web Store (sans le champ "key")
#   - retouche-vocale-<version>.crx  → paquet signé avec keys/retouche-vocale.pem
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(python3 -c "import json;print(json.load(open('extension/manifest.json'))['version'])")
KEY=keys/retouche-vocale.pem
OUT=dist
NAME="retouche-vocale-$VERSION"
BROWSER=${BROWSER:-$(command -v brave || command -v chromium || command -v google-chrome-stable || command -v google-chrome || true)}

rm -rf "$OUT" && mkdir -p "$OUT"
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

# 1. copie propre (sans fichiers parasites)
rsync -a --exclude '__pycache__' --exclude '.DS_Store' --exclude '*.map' extension/ "$STAGE/$NAME/"

# 2. vérifications rapides
python3 -m json.tool "$STAGE/$NAME/manifest.json" > /dev/null
for f in "$STAGE/$NAME"/*.js; do node --check "$f"; done
python3 -c "import ast,sys;ast.parse(open(sys.argv[1]).read())" "$STAGE/$NAME/transcrire.py"
if find "$STAGE/$NAME" -name '_*' | grep -q .; then echo "Fichier commençant par _ interdit" >&2; exit 1; fi

# 3. zip pour le Web Store (le store refuse le champ "key")
mkdir -p "$STAGE/store"
cp -r "$STAGE/$NAME" "$STAGE/store/"
python3 - "$STAGE/store/$NAME/manifest.json" <<'PY'
import json, sys
p = sys.argv[1]; m = json.load(open(p)); m.pop("key", None)
json.dump(m, open(p, "w"), ensure_ascii=False, indent=2)
PY
(cd "$STAGE/store/$NAME" && zip -qr -X "$OLDPWD/$OUT/$NAME.zip" .)

# 4. crx signé
if [[ -n "$BROWSER" && -f "$KEY" ]]; then
  "$BROWSER" --headless=new --user-data-dir="$STAGE/profile" --no-first-run \
    --pack-extension="$STAGE/$NAME" --pack-extension-key="$KEY" > /dev/null 2>&1 || true
  [[ -f "$STAGE/$NAME.crx" ]] && mv "$STAGE/$NAME.crx" "$OUT/$NAME.crx" || echo "⚠ crx non généré" >&2
else
  echo "⚠ crx ignoré (navigateur ou clé introuvable)" >&2
fi

echo "Version $VERSION · ID $(cat keys/id.txt 2>/dev/null || echo '?')"
ls -lh "$OUT"
