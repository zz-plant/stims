#!/bin/zsh
# Physical footprint of a shell's whole process tree, in MB. WebKit's helpers
# are launchd children, not the app's, so they are matched by start time.
#
#   tools/memory.sh electron|tauri|chrome
which=$1
case $which in
  electron) pids=($(pgrep -f 'Electron.app/Contents')) ;;
  chrome) pids=($(pgrep -f 'user-data-dir=.*spike-chrome-') $(pgrep -f 'spike-chrome-')) ;;
  tauri)
    app=$(pgrep -f 'Stims Tauri Spike.app/Contents/MacOS' | head -1)
    started=$(date -j -f '%a %b %e %T %Y' "$(ps -o lstart= -p "$app" | xargs)" +%s 2>/dev/null)
    pids=($app)
    for pid in $(pgrep -f 'com.apple.WebKit.(WebContent|GPU|Networking)'); do
      when=$(date -j -f '%a %b %e %T %Y' "$(ps -o lstart= -p "$pid" | xargs)" +%s 2>/dev/null)
      (( when >= started && when <= started + 20 )) && pids+=($pid)
    done
    ;;
esac
pids=(${(u)pids})
total=0
for pid in $pids; do
  name=$(ps -o comm= -p "$pid" | sed 's#.*/##' | cut -c1-34)
  mb=$(footprint -p "$pid" -f bytes 2>/dev/null | awk '/phys_footprint:/ {print $2/1048576; exit}')
  [[ -z $mb ]] && mb=$(footprint "$pid" 2>/dev/null | awk '/Footprint:/ {print; exit}')
  printf '%8s  %-34s %s\n' "$mb" "$name" "$pid"
done
