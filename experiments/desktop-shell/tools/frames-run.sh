#!/bin/zsh
# Starts Stims's Microphone source (the mock track when the URL says so), lets it
# settle, then labels a window of probe lines for hidden-summary.ts to read.
#
#   tools/frames-run.sh <shell> <control-port> <label> [settle-seconds] [seconds]
shell=$1 control=$2 name=$3 settle=${4:-12} seconds=${5:-30}
collector=http://127.0.0.1:5998
# A cold dev server takes a while to serve the app, so wait for the agent API.
for attempt in {1..40}; do
  ready=$(curl -s -m 3 -X POST "$collector/run?shell=$shell" --data-binary "return !!window.__stims_agent && window.__stims_agent.getState().engineState !== 'booting'")
  [[ $ready == *'"value":true'* ]] && break
  sleep 1
done
curl -s -m 10 -X POST "http://127.0.0.1:$control/gesture-eval" --data-binary "window.__stims_agent.run('audio-microphone').then(()=>'started')" >/dev/null
sleep "$settle"
curl -s -X POST "$collector/label?shell=$shell&name=$name" >/dev/null
sleep "$seconds"
curl -s -X POST "$collector/label?shell=$shell&name=" >/dev/null
uptime | sed 's/.*load/load/'
