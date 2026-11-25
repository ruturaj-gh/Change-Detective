$ErrorActionPreference = "Stop"

$userSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$taskName = "Change Detective Agent - $userSid"
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($null -ne $task) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  Write-Output "Removed the Change Detective Agent logon task."
} else {
  Write-Output "The Change Detective Agent logon task is not installed."
}
