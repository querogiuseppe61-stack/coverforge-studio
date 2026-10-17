#!/usr/bin/env bash
# CoverForge Studio — avvio senza terminale: server in background + browser, poi esce.
# Per fermare il server:  bash coverforge.sh --stop
set -euo pipefail
exec bash "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/coverforge.sh" --silent
