#Requires -RunAsAdministrator
<#
  NAT-mode WSL2: forward DevHub (1337), OpenChamber (1336), and OpenCode (1338) from Windows to your
  default WSL distro so phones on Wi-Fi can use http://<Windows-LAN-IP>:1337.

  Prefer mirrored networking (README) — then you usually skip this script.

  Re-run after WSL restart if forwarding breaks (WSL eth IP can change).
#>
$ErrorActionPreference = "Stop"

$ports = @(1337, 1336, 1338)
$listen = "0.0.0.0"

$raw = (& wsl.exe -e sh -c "hostname -I").Trim()
if (-not $raw) {
  Write-Error "wsl.exe hostname -I returned nothing — start WSL first."
  exit 1
}

$wslIp = ($raw -split "\s+" | Where-Object { $_ -match "^\d{1,3}(\.\d{1,3}){3}$" } | Select-Object -First 1)
if (-not $wslIp) {
  Write-Error "Could not parse WSL IPv4 from: $raw"
  exit 1
}

Write-Host "WSL IPv4: $wslIp"

foreach ($p in $ports) {
  netsh interface portproxy delete v4tov4 listenport=$p listenaddress=$listen 2>$null | Out-Null
  netsh interface portproxy add v4tov4 listenport=$p listenaddress=$listen connectport=$p connectaddress=$wslIp | Out-Null
  Write-Host "portproxy $listen`:$p -> ${wslIp}:$p"
}

$ruleName = "DevHub WSL TCP 1337 1336 1338"
if (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue) {
  Remove-NetFirewallRule -DisplayName $ruleName
}

New-NetFirewallRule `
  -DisplayName $ruleName `
  -Direction Inbound `
  -Action Allow `
  -Protocol TCP `
  -LocalPort 1337,1336,1338 `
  -Profile Private, Domain `
  | Out-Null

Write-Host ""
Write-Host "Done. From other devices: http://<Windows-LAN-IPv4>:1337"
Write-Host "Find that IP on Windows: ipconfig (Wi-Fi or Ethernet adapter)."
Write-Host "If still blocked, set your Wi-Fi profile to Private or add Public to the firewall rule."
