#!/usr/bin/env bash
# Fetches the CC0 asset packs used by the asset pipeline into ./vendor (sparse clones, no history).
# Only needed if you want to rebuild public/assets from source; the built assets are already committed.
set -euo pipefail
VENDOR="${VENDOR:-$(pwd)/vendor}"
mkdir -p "$VENDOR"
clone() { # repo dir patterns...
  local repo="$1" dir="$VENDOR/$2"; shift 2
  if [ ! -d "$dir/repo" ]; then
    mkdir -p "$dir" && git clone -q --depth 1 --filter=blob:none --no-checkout "https://github.com/$repo" "$dir/repo"
  fi
  (cd "$dir/repo" && git sparse-checkout init --no-cone && printf '%s\n' "$@" > .git/info/sparse-checkout && git checkout -q HEAD)
  echo "fetched $repo"
}
clone GeorgeQLe/assets-kaykit-3d-characters GeorgeQLe_assets-kaykit-3d-characters \
  /LICENSES/ /assets/kaykit/adventurers-2.0/Characters/gltf/ /assets/kaykit/adventurers-2.0/Assets/gltf/ \
  /assets/kaykit/character-animations-1.1/Animations/gltf/ /assets/kaykit/skeletons-1.1/characters/gltf/ /assets/kaykit/skeletons-1.1/assets/gltf/ \
  '/assets/kaykit/mystery-monthly-series-*/*/character*/**/*.glb' '/assets/kaykit/mystery-monthly-series-*/*/character/*.glb' '/assets/kaykit/mystery-monthly-series-*/*/assets/gltf/'
clone GeorgeQLe/assets-kaykit-3d-environments GeorgeQLe_assets-kaykit-3d-environments \
  /LICENSES/ /assets/kaykit/medieval-hexagon-pack-1.0.1/Assets/gltf/ /assets/kaykit/forest-nature-pack-1.0/Assets/gltf/ /assets/kaykit/dungeon-remastered-1.1/Assets/gltf/
clone KayKit-Game-Assets/KayKit-Halloween-Bits-1.0 KayKit_Halloween /LICENSE.txt '/addons/**/Assets/gltf/' /Assets/gltf/
clone ismetcabbar9-oss/kenney-audio-assets kenney_audio /LICENSE.md '/Audio (295 files)/RPG sounds (50 sounds)/' '/Audio (295 files)/Jingle sounds (85 sounds)/' '/Audio (295 files)/UI sounds (50 sounds)/'
echo "Done. Now run: npm run assets"
