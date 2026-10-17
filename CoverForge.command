#!/bin/bash
# CoverForge Studio: doppio clic per avviarlo su macOS (dai sorgenti, serve Node.js 20.3 o successivo)
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo
  echo "Serve Node.js 20.3 o successivo: scaricalo da https://nodejs.org e poi riapri questo file."
  echo "In alternativa scarica il programma di installazione di CoverForge, che non richiede Node.js."
  echo
  read -r -p "Premi Invio per chiudere."
  exit 1
fi
exec node start.js
