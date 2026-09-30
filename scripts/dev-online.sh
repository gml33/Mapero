#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_URL="${SERVER_URL:-http://127.0.0.1:8080}"
SERVER_USER="${SERVER_USER:-dev}"
SERVER_PASS="${SERVER_PASS:-dev123456}"
STREAMING="${STREAMING:-true}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Falta el comando requerido: $1" >&2
    exit 1
  fi
}

require_cmd adb
require_cmd docker

echo "[1/4] Levantando backend web + PostgreSQL..."
(cd "$ROOT_DIR" && docker compose up -d --build)

echo "[2/4] Esperando dispositivo ADB..."
adb wait-for-device

echo "[3/4] Abriendo túnel adb reverse tcp:8080 -> host:8080..."
adb reverse tcp:8080 tcp:8080

echo "[4/4] Instalando APK debug y lanzando la app..."
(cd "$ROOT_DIR/android" && ./gradlew :app:installDebug)

adb shell am start \
  -n app.mapero.wifi/.MainActivity \
  --es server_url "$SERVER_URL" \
  --es server_user "$SERVER_USER" \
  --es server_pass "$SERVER_PASS" \
  --ez streaming "$STREAMING" \
  --ez auto_connect true

echo
echo "Listo."
echo "Servidor web: $SERVER_URL"
echo "Usuario dev:   $SERVER_USER"
