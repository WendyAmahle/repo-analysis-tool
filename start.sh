#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

for command_name in git node npm; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Error: $command_name is required but is not installed." >&2
    exit 1
  fi
done

if [[ ! -d node_modules ]]; then
  npm install
fi

if [[ ! -d backend/node_modules || ! -d frontend/node_modules ]]; then
  npm run install:all
fi

echo "Starting Repo Analysis Tool..."
echo "Open http://127.0.0.1:5173 in your browser."
npm run dev
