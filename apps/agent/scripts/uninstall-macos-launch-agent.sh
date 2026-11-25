#!/usr/bin/env bash
set -euo pipefail

label="app.changedetective.agent"
plist_file="$HOME/Library/LaunchAgents/$label.plist"
uid="$(id -u)"

if [[ ! -f "$plist_file" ]]; then
  printf 'The Change Detective macOS LaunchAgent is not installed.\n'
  exit 0
fi

if launchctl print "gui/$uid/$label" >/dev/null 2>&1; then
  launchctl bootout "gui/$uid" "$plist_file"
fi
rm -- "$plist_file"
printf 'Removed the Change Detective macOS LaunchAgent.\n'
