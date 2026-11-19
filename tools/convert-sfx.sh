#!/usr/bin/env bash
# Converts the Kenney CC0 sound effects used by the game to mono mp3 (needs ffmpeg). Run after fetch-assets.sh.
set -euo pipefail
VENDOR="${VENDOR:-$(pwd)/vendor}"; A="$VENDOR/kenney_audio/repo/Audio (295 files)"; O="$(pwd)/public/assets/sfx"; mkdir -p "$O"
R="$A/RPG sounds (50 sounds)"; U="$A/UI sounds (50 sounds)"; J="$A/Jingle sounds (85 sounds)"
c(){ ffmpeg -v error -y -i "$1" -ac 1 -ar 44100 -b:a 96k "$O/$2.mp3"; }
c "$U/click1.ogg" ui_click; c "$U/rollover2.ogg" ui_hover; c "$U/switch3.ogg" ui_switch
c "$R/knifeSlice.ogg" slash1; c "$R/knifeSlice2.ogg" slash2; c "$R/chop.ogg" chop
for i in 1 2 3; do c "$R/metalPot$i.ogg" clang$i; done
c "$R/drawKnife1.ogg" draw1; c "$R/drawKnife2.ogg" draw2; c "$R/handleCoins.ogg" coins; c "$R/handleCoins2.ogg" coins2
c "$R/bookFlip1.ogg" page1; c "$R/bookFlip2.ogg" page2; c "$R/bookOpen.ogg" bookopen; c "$R/cloth1.ogg" cloth1; c "$R/cloth3.ogg" cloth2
c "$R/metalLatch.ogg" latch; c "$R/creak1.ogg" creak; c "$R/beltHandle1.ogg" belt
for i in 0 1 2 3 4; do c "$R/footstep0$i.ogg" step$i; done
c "$J/jingles_HIT/jingles_HIT15.ogg" sting_big; c "$J/jingles_HIT/jingles_HIT11.ogg" sting_hit
c "$J/jingles_PIZZA/jingles_PIZZA07.ogg" sting_levelup; c "$J/jingles_PIZZA/jingles_PIZZA03.ogg" sting_unlock
echo "sfx done"
