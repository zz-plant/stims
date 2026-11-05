#!/bin/zsh
# Launches a shell through LaunchServices, so macOS treats the app itself as the
# one asking for permissions. Without focus; same content size and place for both.
#
#   tools/launch.sh electron|tauri <url> <log-prefix> [ENV=value ...]
which=$1 url=$2 logs=$3
shift 3
here=${0:A:h}
extra=()
for pair in "$@"; do extra+=(--env "$pair"); done
common=(
  --env "STIMS_URL=$url"
  --env STIMS_SPIKE_COLLECTOR=http://127.0.0.1:5998
  --env STIMS_SPIKE_ON_TOP=1
  --env STIMS_SPIKE_X=900
  --env STIMS_SPIKE_Y=560
)
case $which in
  electron)
    open -g -n "$here/../electron/node_modules/electron/dist/Electron.app" \
      --stdout "$logs.out" --stderr "$logs.err" \
      "${common[@]}" --env STIMS_SPIKE_CONTROL=5997 "${extra[@]}" \
      --args "$here/../electron"
    ;;
  tauri)
    open -g -n "$here/../tauri/target/release/bundle/macos/Stims Tauri Spike.app" \
      --stdout "$logs.out" --stderr "$logs.err" \
      "${common[@]}" --env STIMS_SPIKE_CONTROL=5996 \
      --env "STIMS_SPIKE_PROBE=$here/../shared/probe.js" "${extra[@]}"
    ;;
esac
