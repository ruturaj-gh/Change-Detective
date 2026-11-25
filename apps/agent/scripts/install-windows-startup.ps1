$ErrorActionPreference = "Stop"

$agentRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$entrypoint = Join-Path $agentRoot "dist\index.js"
if (-not (Test-Path $entrypoint -PathType Leaf)) {
  throw "Build the agent first with: npm run build --workspace @change-detective/agent"
}

$node = Get-Command node.exe -ErrorAction Stop
$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$userSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$taskName = "Change Detective Agent - $userSid"
$action = New-ScheduledTaskAction `
  -Execute $node.Source `
  -Argument ('"{0}"' -f $entrypoint) `
  -WorkingDirectory $agentRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$principal = New-ScheduledTaskPrincipal `
  -UserId $userId `
  -LogonType Interactive `
  -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -MultipleInstances IgnoreNew

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Description "Starts the enrolled Change Detective local agent at user logon." `
  -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Output "Installed and started the Change Detective Agent logon task."
