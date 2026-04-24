#!/bin/zsh

set -euo pipefail

if [[ $# -lt 3 ]]; then
  echo "usage: $0 <app_path> <output_dmg> <volume_name>" >&2
  exit 1
fi

APP_PATH="$1"
OUTPUT_DMG="$2"
VOLUME_NAME="$3"
APP_NAME="$(basename "$APP_PATH")"

if [[ ! -d "$APP_PATH" ]]; then
  echo "[create-drag-dmg] app not found: $APP_PATH" >&2
  exit 1
fi

WORK_DIR="$(mktemp -d /tmp/laonianren-dmg.XXXXXX)"
RW_IMAGE="$WORK_DIR/temp.sparseimage"
MOUNT_POINT="/Volumes/$VOLUME_NAME"
DEVICE=""

detach_volume() {
  if [[ -n "$DEVICE" ]]; then
    hdiutil detach "$DEVICE" -quiet || hdiutil detach "$DEVICE" -force -quiet
    DEVICE=""
    return 0
  fi

  if mount | grep -q "on $MOUNT_POINT "; then
    hdiutil detach "$MOUNT_POINT" -quiet || hdiutil detach "$MOUNT_POINT" -force -quiet
  fi
}

cleanup() {
  detach_volume || true
  rm -rf "$WORK_DIR"
}

trap cleanup EXIT

hdiutil create \
  -fs HFS+ \
  -type SPARSE \
  -volname "$VOLUME_NAME" \
  -size 1600m \
  -ov \
  "$RW_IMAGE" >/dev/null

ATTACH_OUTPUT="$(hdiutil attach "$RW_IMAGE" -readwrite -noverify -noautoopen -mountpoint "$MOUNT_POINT")"
DEVICE="$(printf '%s\n' "$ATTACH_OUTPUT" | awk 'END { print $1 }')"

if [[ -z "$DEVICE" ]]; then
  echo "[create-drag-dmg] failed to determine mounted device" >&2
  exit 1
fi

ditto "$APP_PATH" "$MOUNT_POINT/$APP_NAME"
ln -s /Applications "$MOUNT_POINT/Applications"

sync
detach_volume

TARGET_BASE="${OUTPUT_DMG%.dmg}"
rm -f "$TARGET_BASE.dmg"
hdiutil convert "$RW_IMAGE" -format UDZO -ov -o "$TARGET_BASE" >/dev/null

echo "[create-drag-dmg] created $OUTPUT_DMG"
