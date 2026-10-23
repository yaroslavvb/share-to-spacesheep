#!/usr/bin/env bash
# Future-proof iOS App Store archive & export script for SheepIt.
# Automatically computes a monotonically increasing CFBundleVersion from git commit count
# (matching Android's build.gradle formula) so App Store Connect never rejects a duplicate build number.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

FLOOR_BUILD=10
GIT_COUNT="$(git rev-list --count HEAD 2>/dev/null || echo 40)"
COMPUTED_BUILD=$((GIT_COUNT - 30))
if [ "$COMPUTED_BUILD" -lt "$FLOOR_BUILD" ]; then
  BUILD_NUM="$FLOOR_BUILD"
else
  BUILD_NUM="$COMPUTED_BUILD"
fi

MARKETING_VER="$(grep -m1 'MARKETING_VERSION =' ios/ShareToSpacesheep.xcodeproj/project.pbxproj | sed -E 's/.*= *([^;]+);/\1/' | tr -d ' ')"
ARCHIVE_PATH="$ROOT_DIR/app-store/SheepIt-v${MARKETING_VER}-b${BUILD_NUM}.xcarchive"
EXPORT_DIR="$ROOT_DIR/app-store/export"

echo "Building SheepIt iOS v${MARKETING_VER} (CFBundleVersion ${BUILD_NUM})..."

TEAM_ARGS=()
if [ -n "${DEVELOPMENT_TEAM:-}" ]; then
  TEAM_ARGS+=("DEVELOPMENT_TEAM=${DEVELOPMENT_TEAM}" "-allowProvisioningUpdates")
fi

xcodebuild archive \
  -project ios/ShareToSpacesheep.xcodeproj \
  -scheme ShareToSpacesheep \
  -configuration Release \
  -destination "generic/platform=iOS" \
  -archivePath "$ARCHIVE_PATH" \
  CURRENT_PROJECT_VERSION="$BUILD_NUM" \
  MARKETING_VERSION="$MARKETING_VER" \
  "${TEAM_ARGS[@]}"

echo "Archive created at: $ARCHIVE_PATH"

if [ -n "${DEVELOPMENT_TEAM:-}" ]; then
  # Apple's rsync starts a peer through PATH. A Homebrew rsync peer rejects
  # Apple's --extended-attributes flag and makes IPA export fail with "Copy failed".
  PATH=/usr/bin:/bin:/usr/sbin:/sbin xcodebuild -exportArchive \
    -archivePath "$ARCHIVE_PATH" \
    -exportOptionsPlist "$ROOT_DIR/app-store/ExportOptions.plist" \
    -exportPath "$EXPORT_DIR" \
    -allowProvisioningUpdates
  echo "Signed App Store .ipa exported to: $EXPORT_DIR"
else
  echo ""
  echo "To open this archive directly in Xcode Organizer and click 'Distribute App':"
  echo "  open \"$ARCHIVE_PATH\""
fi
