#!/bin/zsh
# Puts a shell's window through each hidden state, labelling the probe's lines.
# `bun tools/hidden-summary.ts <shell>.jsonl` then gives raw rAF, frames drawn,
# timers and document.hidden for each state.
#
#   tools/hidden-run.sh <shell> <control-port> <x> <y> <width> <height> [seconds] [prefix]
# The rectangle is the window's, in points from the screen's top left, so the
# occluder covers it and nothing else.
shell=$1 control=$2 x=$3 y=$4 width=$5 height=$6 seconds=${7:-12} prefix=${8:-}
collector=http://127.0.0.1:5998
bin=${0:A:h}/bin

label() { curl -s -X POST "$collector/label?shell=$shell&name=$1" >/dev/null; }
hold() {
  label "$prefix$1"
  sleep "$seconds"
  label ''
}

sleep 2
hold visible
"$bin/cover" "$x" "$y" "$width" "$height" $((seconds + 3)) &
sleep 2
hold covered
wait
curl -s "http://127.0.0.1:$control/hide" >/dev/null
sleep 2
hold hidden
curl -s "http://127.0.0.1:$control/show" >/dev/null
sleep 2
curl -s "http://127.0.0.1:$control/minimize" >/dev/null
sleep 2
hold minimized
curl -s "http://127.0.0.1:$control/restore" >/dev/null
sleep 2
curl -s "http://127.0.0.1:$control/app-hide" >/dev/null
sleep 2
hold app-hidden
curl -s "http://127.0.0.1:$control/app-show" >/dev/null
curl -s "http://127.0.0.1:$control/show" >/dev/null
sleep 3
hold visible-again
