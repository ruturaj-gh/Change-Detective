#!/usr/bin/env bash
set -euo pipefail

agent_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
entrypoint="$agent_root/dist/index.js"
node_binary="$(command -v node)"
label="app.changedetective.agent"
launch_agents="$HOME/Library/LaunchAgents"
logs_dir="$HOME/Library/Logs"
plist_file="$launch_agents/$label.plist"
uid="$(id -u)"

if [[ ! -f "$entrypoint" ]]; then
  printf 'Build the agent first: npm run build --workspace @change-detective/agent\n' >&2
  exit 1
fi

xml_escape() {
  printf '%s' "$1" |
    sed -e 's/&/\&amp;/g' \
        -e 's/</\&lt;/g' \
        -e 's/>/\&gt;/g' \
        -e 's/"/\&quot;/g' \
        -e "s/'/\&apos;/g"
}

environment_xml=""
if [[ -n "${XDG_CONFIG_HOME:-}" ]]; then
  environment_xml="  <key>EnvironmentVariables</key>
  <dict>
    <key>XDG_CONFIG_HOME</key>
    <string>$(xml_escape "$XDG_CONFIG_HOME")</string>
  </dict>"
fi

mkdir -p -- "$launch_agents" "$logs_dir"
chmod 700 "$launch_agents"
cat > "$plist_file" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml_escape "$node_binary")</string>
    <string>$(xml_escape "$entrypoint")</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$(xml_escape "$agent_root")</string>
$environment_xml
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$(xml_escape "$logs_dir/change-detective-agent.log")</string>
  <key>StandardErrorPath</key>
  <string>$(xml_escape "$logs_dir/change-detective-agent-error.log")</string>
</dict>
</plist>
EOF
chmod 600 "$plist_file"

if launchctl print "gui/$uid/$label" >/dev/null 2>&1; then
  launchctl bootout "gui/$uid" "$plist_file"
fi
launchctl bootstrap "gui/$uid" "$plist_file"
launchctl kickstart -k "gui/$uid/$label"
printf 'Installed and started the Change Detective macOS LaunchAgent.\n'
