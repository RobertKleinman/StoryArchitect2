#!/bin/bash
# Ensure a writable temp directory relative to the project root
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export TMPDIR="${TMPDIR:-$SCRIPT_DIR/.tmp}"
mkdir -p "$TMPDIR"
exec "$@"
