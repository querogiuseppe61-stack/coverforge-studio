#!/usr/bin/env bash
# CoverForge Studio — genera coverforge-studio.desktop con il percorso ATTUALE della cartella.
# Rilancialo dopo aver spostato o rinominato il progetto.
#
#   bash install-desktop.sh           riscrive il file nella cartella del progetto (doppio clic dal file manager)
#   bash install-desktop.sh --menu    in più lo copia in ~/.local/share/applications (menu delle applicazioni)
set -euo pipefail

APP_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
OUT="$APP_DIR/coverforge-studio.desktop"

# Nel file .desktop i percorsi con spazi vanno tra virgolette; i caratteri speciali non sono ammessi
case "$APP_DIR" in
  *[\"\`\$\\]*) echo "Il percorso contiene caratteri non supportati nel file .desktop: $APP_DIR" >&2; exit 1 ;;
esac

cat > "$OUT" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=CoverForge Studio
Comment=Crea copertine, loghi, icone e header via OpenRouter
Exec=bash "$APP_DIR/coverforge.sh"
Path=$APP_DIR
Icon=$APP_DIR/assets/icon.svg
Terminal=true
StartupNotify=true
Categories=Graphics;
Keywords=cover;logo;design;ai;image;generation;
Actions=Silent;Stop;

[Desktop Action Silent]
Name=Avvia senza terminale (nel browser)
Exec=bash "$APP_DIR/coverforge-silent.sh"

[Desktop Action Stop]
Name=Ferma il server
Exec=bash "$APP_DIR/coverforge.sh" --stop
EOF
chmod +x "$OUT"
echo "Scritto: $OUT"

if command -v desktop-file-validate &>/dev/null; then
  desktop-file-validate "$OUT" && echo "✓ File .desktop valido"
fi

if [ "${1:-}" = "--menu" ]; then
  DEST="$HOME/.local/share/applications"
  mkdir -p "$DEST"
  install -m 755 "$OUT" "$DEST/coverforge-studio.desktop"
  command -v update-desktop-database &>/dev/null && update-desktop-database "$DEST" 2>/dev/null || true
  echo "✓ Aggiunto al menu delle applicazioni: $DEST/coverforge-studio.desktop"
fi
