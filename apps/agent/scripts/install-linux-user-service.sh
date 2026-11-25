#!/usr/bin/env bash
set -euo pipefail

agent_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
entrypoint="$agent_root/dist/index.js"
node_binary="$(command -v node)"
unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
unit_file="$unit_dir/change-detective-agent.service"

if [[ ! -f "$entrypoint" ]]; then
  printf 'Build the agent first: npm run build --workspace @change-detective/agent\n' >&2
  exit 1
fi
if ! command -v systemctl >/dev/null 2>&1; then
  printf 'systemctl is required to install the Linux user service.\n' >&2
  exit 1
fi

systemd_quote() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//%/%%}"
  printf '"%s"' "$value"
}

mkdir -p -- "$unit_dir"
chmod 700 "$unit_dir"
{
  printf '[Unit]\nDescription=Change Detective Agent\nAfter=network.target\n\n'
  printf '[Service]\nType=simple\n'
  printf 'WorkingDirectory=%s\n' "$(systemd_quote "$agent_root")"
  printf 'ExecStart=%s %s\n' \
    "$(systemd_quote "$node_binary")" \
    "$(systemd_quote "$entrypoint")"
  if [[ -n "${XDG_CONFIG_HOME:-}" ]]; then
    printf 'Environment=%s\n' \
      "$(systemd_quote "XDG_CONFIG_HOME=$XDG_CONFIG_HOME")"
  fi
  printf 'Restart=on-failure\nRestartSec=10\n\n'
  printf '[Install]\nWantedBy=default.target\n'
} > "$unit_file"
chmod 600 "$unit_file"

systemctl --user daemon-reload
systemctl --user enable --now change-detective-agent.service
printf 'Installed and started the Change Detective Linux user service.\n'
