#!/bin/bash

# Zotero Extension Proxy Undo for macOS/Linux
EXT_ID="zotseek@zotero.org"

if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    PROFILES_DIR="$HOME/Library/Application Support/Zotero/Profiles"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux
    PROFILES_DIR="$HOME/.zotero/zotero"
    if [ ! -d "$PROFILES_DIR/Profiles" ] && [ -d "$HOME/snap/zotero-snap/common/.zotero/zotero/Profiles" ]; then
        PROFILES_DIR="$HOME/snap/zotero-snap/common/.zotero/zotero/Profiles"
    elif [ ! -d "$PROFILES_DIR/Profiles" ]; then
         PROFILES_DIR="$HOME/.zotero/zotero"
    fi
else
    echo "❌ Unsupported OS: $OSTYPE"
    exit 1
fi

# Find the profile directory (usually ends in .default or .default-release)
PROFILE=$(find "$PROFILES_DIR" -maxdepth 1 -name "*.default*" | head -n 1)

if [ -z "$PROFILE" ]; then
    echo "❌ No Zotero profile found in $PROFILES_DIR"
    exit 1
fi

EXT_DIR="$PROFILE/extensions"
PROXY_FILE="$EXT_DIR/$EXT_ID"

if [ -f "$PROXY_FILE" ]; then
    rm "$PROXY_FILE"
    echo "Extension proxy removed at: $PROXY_FILE"
else
    echo "Extension proxy not found at: $PROXY_FILE. Nothing to undo."
fi

# Force Zotero to re-scan extensions by removing version/build ID from prefs.js
PREFS_FILE="$PROFILE/prefs.js"
if [ -f "$PREFS_FILE" ]; then
    echo "Forcing Zotero to re-scan extensions folder..."
    # Create a backup just in case
    cp "$PREFS_FILE" "${PREFS_FILE}.bak"
    # Remove the lines
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS sed requires an empty string for the i flag
        sed -i "" "/extensions\.lastAppBuildId/d" "$PREFS_FILE"
        sed -i "" "/extensions\.lastAppVersion/d" "$PREFS_FILE"
    else
        # Linux sed
        sed -i "/extensions\.lastAppBuildId/d" "$PREFS_FILE"
        sed -i "/extensions\.lastAppVersion/d" "$PREFS_FILE"
    fi
    echo "Updated prefs.js (removed extension version markers)"
fi

echo "Note: Ensure Zotero is CLOSED for the re-scan to take effect."
echo "Restart Zotero to apply changes."
