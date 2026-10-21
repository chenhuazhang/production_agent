$ErrorActionPreference = "Stop"
$url = "https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-windows-amd64.zip"
$out = "ngrok.zip"
Write-Output "downloading ngrok..."
Invoke-WebRequest -Uri $url -OutFile $out -TimeoutSec 180
Write-Output "downloaded, extracting..."
Expand-Archive -Path $out -DestinationPath "ngrok_bin" -Force
Remove-Item $out
Write-Output "version:"
& "ngrok_bin/ngrok.exe" --version
Write-Output "DONE"
