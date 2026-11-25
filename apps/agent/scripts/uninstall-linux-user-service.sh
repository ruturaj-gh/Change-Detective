#!/usr/bin/env bash
set -euo pipefail

unit_file="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/change-detective-agent.service"
if ! command -v systemctl >/dev/null 2>&1; then
  printf 'systemctl is required to remove the Linux user service.\n' >&2
  exit 1
fi

if [[ -f "$unit_file" ]]; then
  systemctl --user disable --now change-detective-agent.service
  rm -- "$unit_file"
  systemctl --user daemon-reload
  printf 'Removed the Change Detective Linux user service.\n'
else
  printf 'The Change Detective Linux user service is not installed.\n'
fi
