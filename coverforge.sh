#!/usr/bin/env bash
# ═══════════════════════════════════════════════
#  CoverForge Studio — Launcher
#
#    bash coverforge.sh              Electron se installato, altrimenti browser
#    bash coverforge.sh --web        server + browser; Ctrl+C ferma tutto
#    bash coverforge.sh --electron   solo la finestra Electron
#    bash coverforge.sh --silent     server in background + browser, poi esce
#                                    (non serve un terminale)
#    bash coverforge.sh --stop       ferma il server avviato con --silent o --web
# ═══════════════════════════════════════════════

set -euo pipefail

APP_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
cd "$APP_DIR"

LOG_FILE="$APP_DIR/coverforge.log"
PID_FILE="$APP_DIR/coverforge.pid"
MODE="auto"
SERVER_PID=""
TAIL_PID=""
REUSED=0

case "${1:-}" in
  ""|--auto)         MODE="auto" ;;
  --web|-w)          MODE="web" ;;
  --electron|-e)     MODE="electron" ;;
  --silent|-s)       MODE="silent" ;;
  --stop)            MODE="stop" ;;
  -h|--help)         sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) echo "Opzione sconosciuta: $1 (usa --help)" >&2; exit 2 ;;
esac

# ── Colori (solo se l'output è un terminale) ──
if [ -t 1 ]; then
  R='\033[0;31m'; G='\033[0;32m'; C='\033[0;36m'; Y='\033[1;33m'; B='\033[1;34m'; N='\033[0m'
else
  R=''; G=''; C=''; Y=''; B=''; N=''
fi

# ── Porta: variabile d'ambiente, altrimenti la riga PORT= di .env (letta senza caricare il resto), altrimenti 3000 ──
read_port() {
  local p="${PORT:-}"
  if [ -z "$p" ] && [ -f "$APP_DIR/.env" ]; then
    p="$(grep -E '^[[:space:]]*PORT=' "$APP_DIR/.env" | tail -n1 | cut -d= -f2- | tr -d " \r\"'" || true)"
  fi
  p="${p:-3000}"
  if ! [[ "$p" =~ ^[0-9]+$ ]] || [ "$p" -lt 1 ] || [ "$p" -gt 65535 ]; then
    echo -e "${R}PORT non valida: \"$p\" (deve essere un numero tra 1 e 65535).${N}" >&2
    exit 1
  fi
  echo "$p"
}
PORT="$(read_port)"
export PORT

banner() {
  echo -e "${B}CoverForge Studio${N}"
  echo -e "${Y}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"
  echo -e "  Directory: ${C}$APP_DIR${N}"
  echo -e "  Porta:     ${C}$PORT${N}"
  echo -e "${Y}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"
  echo
}

# ── Utilità ──
node_ok() {
  # global fetch + AbortSignal.any: Node 20.3 o superiore
  node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>20||(a===20&&b>=3)?0:1)'
}

check_node() {
  if ! command -v node &>/dev/null; then
    echo -e "${R}Node.js non trovato.${N}  Installalo da https://nodejs.org/" >&2
    return 1
  fi
  if ! node_ok; then
    echo -e "${R}Node.js $(node --version) è troppo vecchio: serve la versione 20.3 o successiva.${N}" >&2
    return 1
  fi
  echo -e "  Node.js: ${C}$(node --version)${N}"
}

check_deps() {
  if [ ! -d "$APP_DIR/node_modules" ]; then
    echo -e "${Y}npm install in corso…${N}"
    npm install
    echo -e "${G}✓ Dipendenze installate${N}"
  fi
}

# risponde 0 se sulla porta c'è un server CoverForge funzionante (usa solo Node: niente curl)
health_ok() {
  node -e '
    require("http").get({ host: "127.0.0.1", port: Number(process.argv[1]), path: "/api/health", timeout: 800 }, (r) => {
      let b = ""; r.on("data", (d) => b += d);
      r.on("end", () => process.exit(r.statusCode === 200 && b.includes("\"ok\":true") ? 0 : 1));
    }).on("error", () => process.exit(1)).on("timeout", function () { this.destroy(); process.exit(1); });
  ' "$PORT" 2>/dev/null
}

# risponde 0 se qualcosa accetta connessioni sulla porta (solo bash, nessuna dipendenza)
port_in_use() { (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; }

# è davvero un nostro "node server.js"? (evita di uccidere un processo qualunque che ha riusato il PID)
is_our_server() {
  local pid="${1:-}"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null || return 1
  case "$(ps -p "$pid" -o args= 2>/dev/null)" in *server.js*) return 0 ;; esac
  return 1
}

stop_server() {
  local pid="${1:-}"
  [ -z "$pid" ] && [ -f "$PID_FILE" ] && pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if is_our_server "$pid"; then
    echo -e "${Y}Arresto il server (PID $pid)…${N}"
    kill "$pid" 2>/dev/null || true           # SIGTERM: il server chiude DB e connessioni
    local i
    for i in $(seq 1 25); do kill -0 "$pid" 2>/dev/null || break; sleep 0.2; done
    kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
}

cleanup() {
  [ -n "$TAIL_PID" ] && kill "$TAIL_PID" 2>/dev/null || true
  [ -n "$SERVER_PID" ] && stop_server "$SERVER_PID"
}

rotate_log() {
  if [ -f "$LOG_FILE" ] && [ "$(stat -c %s "$LOG_FILE" 2>/dev/null || echo 0)" -gt 1048576 ]; then
    mv -f "$LOG_FILE" "$LOG_FILE.1"
  fi
}

# detach=1: il server sopravvive alla chiusura del terminale (modalità --silent)
start_server() {
  local detach="${1:-0}"
  if port_in_use; then
    if health_ok; then
      echo -e "${G}CoverForge è già in esecuzione sulla porta $PORT: lo riutilizzo.${N}"
      REUSED=1
      return 0
    fi
    echo -e "${R}La porta $PORT è occupata da un altro programma.${N}" >&2
    echo "Chiudilo oppure imposta un'altra PORT in .env." >&2
    return 1
  fi

  rotate_log
  echo "── $(date '+%F %T') avvio ──" >> "$LOG_FILE"
  echo -e "${Y}Avvio server…${N}"
  if [ "$detach" = 1 ]; then
    nohup node server.js >> "$LOG_FILE" 2>&1 < /dev/null &
  else
    node server.js >> "$LOG_FILE" 2>&1 &
  fi
  SERVER_PID=$!
  echo "$SERVER_PID" > "$PID_FILE"
  [ "$detach" = 1 ] && disown "$SERVER_PID" 2>/dev/null || true

  # Attende che risponda (max ~20 s), ma si ferma subito se il processo muore (es. errore all'avvio)
  local waited=0
  until health_ok; do
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
      echo -e "${R}Il server si è chiuso subito.${N} Ultime righe di $LOG_FILE:" >&2
      tail -n 15 "$LOG_FILE" >&2
      rm -f "$PID_FILE"; SERVER_PID=""
      return 1
    fi
    waited=$((waited + 1))
    if [ "$waited" -gt 65 ]; then
      echo -e "${R}Il server non risponde dopo 20 secondi.${N} Log: $LOG_FILE" >&2
      tail -n 15 "$LOG_FILE" >&2
      stop_server "$SERVER_PID"; SERVER_PID=""
      return 1
    fi
    sleep 0.3
  done
  echo -e "${G}✓ Server pronto${N} su http://localhost:$PORT"
}

open_browser() {
  local url="http://localhost:$PORT"
  if command -v xdg-open &>/dev/null; then
    xdg-open "$url" >/dev/null 2>&1 &
  elif command -v sensible-browser &>/dev/null; then
    sensible-browser "$url" >/dev/null 2>&1 &
  else
    echo -e "  Apri manualmente: ${C}$url${N}"
    return 0
  fi
  echo -e "${G}✓ Browser aperto${N}"
}

launch_electron() {
  if [ ! -f "$APP_DIR/node_modules/electron/dist/electron" ]; then
    echo -e "${Y}Electron non è installato (esegui \"npm install\"): passo alla modalità web.${N}"
    launch_web
    return
  fi
  echo -e "${C}Avvio Electron…${N}"
  npm run electron
}

launch_web() {
  check_deps
  trap cleanup EXIT                    # prima di avviare: Ctrl+C durante l'attesa non lascia processi orfani
  trap 'exit 130' INT
  trap 'exit 143' TERM
  start_server 0
  open_browser
  if [ "$REUSED" = 1 ]; then return 0; fi   # il server non è nostro: non va fermato in uscita

  echo -e "${Y}──────────────────────────────────────────${N}"
  echo -e "  Premere ${B}Ctrl+C${N} per fermare server e uscire."
  echo -e "${Y}──────────────────────────────────────────${N}"
  echo
  tail -n 0 -f "$LOG_FILE" 2>/dev/null &
  TAIL_PID=$!
  wait "$SERVER_PID" || true
  echo -e "${Y}Il server si è fermato.${N}"
  SERVER_PID=""
}

launch_silent() {
  check_deps
  start_server 1                       # nessun trap: il server deve restare attivo dopo l'uscita dello script
  open_browser
  if [ "$REUSED" = 0 ]; then
    echo "Server in background (PID $SERVER_PID). Per fermarlo: bash coverforge.sh --stop"
  fi
}

# ── Entry point ──
if [ "$MODE" = "stop" ]; then
  if [ -f "$PID_FILE" ] && is_our_server "$(cat "$PID_FILE" 2>/dev/null || true)"; then
    stop_server
    echo -e "${G}✓ Server fermato.${N}"
  elif port_in_use && health_ok; then
    echo "Un server CoverForge è attivo sulla porta $PORT ma non è stato avviato da questo script: chiudilo dal programma che l'ha avviato."
  else
    rm -f "$PID_FILE"
    echo "Nessun server da fermare."
  fi
  exit 0
fi

if [ "$MODE" != "silent" ] && [ -t 1 ]; then
  clear
  banner
fi
check_node || exit 1

case "$MODE" in
  web)      launch_web ;;
  silent)   launch_silent ;;
  electron) launch_electron ;;
  auto)
    if [ -f "$APP_DIR/node_modules/electron/dist/electron" ]; then launch_electron; else launch_web; fi
    ;;
esac
