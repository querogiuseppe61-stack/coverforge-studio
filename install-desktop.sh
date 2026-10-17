#!/usr/bin/env bash
# CoverForge Studio — genera coverforge-studio.desktop con il percorso ATTUALE della cartella.
# Rilancialo dopo aver spostato o rinominato il progetto.
#
#   bash install-desktop.sh           riscrive il file nella cartella del progetto (doppio clic dal file manager)
#   bash install-desktop.sh --menu    in più lo copia in ~/.local/share/applications (menu delle applicazioni)
#   bash install-desktop.sh --desktop in più mette il collegamento sulla scrivania (si possono dare entrambe)
set -euo pipefail

for arg in "$@"; do case "$arg" in
  --menu|--desktop) ;;
  *) echo "Opzione sconosciuta: $arg (usa --menu e/o --desktop)" >&2; exit 1 ;;
esac; done
has() { local want=$1; shift; for a in "$@"; do [ "$a" = "$want" ] && return 0; done; return 1; }

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
Icon=$APP_DIR/assets/linux/256x256.png
StartupWMClass=coverforge-studio
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

if has --menu "$@"; then
  DEST="$HOME/.local/share/applications"
  mkdir -p "$DEST"
  install -m 755 "$OUT" "$DEST/coverforge-studio.desktop"
  command -v update-desktop-database &>/dev/null && update-desktop-database "$DEST" 2>/dev/null || true
  echo "✓ Aggiunto al menu delle applicazioni: $DEST/coverforge-studio.desktop"
fi

if has --desktop "$@"; then
  # la cartella Scrivania/Desktop dipende dalla lingua: la chiede a xdg-user-dir se c'è
  DESK="$(xdg-user-dir DESKTOP 2>/dev/null || true)"
  [ -n "$DESK" ] && [ "$DESK" != "$HOME" ] || DESK="$HOME/Desktop"
  mkdir -p "$DESK"
  install -m 755 "$OUT" "$DESK/coverforge-studio.desktop"
  # GNOME (Ubuntu) avvia i collegamenti sulla scrivania solo se marcati come affidabili
  command -v gio &>/dev/null && gio set "$DESK/coverforge-studio.desktop" metadata::trusted true 2>/dev/null || true
  echo "✓ Collegamento sulla scrivania: $DESK/coverforge-studio.desktop"
  echo "  Se l'icona appare grigia: clic destro → «Consenti l'avvio»."
fi
