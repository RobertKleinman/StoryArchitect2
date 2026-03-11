#!/bin/bash
export TMPDIR=/sessions/busy-awesome-hopper/mnt/visnovgen/.tmp
export HOME=/sessions/busy-awesome-hopper/mnt/visnovgen/.tmp
mkdir -p "$TMPDIR"
exec "$@"
