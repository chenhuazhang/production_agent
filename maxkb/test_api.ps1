$body = '{"model":"production-agent","messages":[{"role":"user","content":"你好"}]}'
$headers = @{
    'Authorization' = 'Bearer sk-prod-agent-maxkb-2026'
    'Content-Type'   = 'application/json'
}
try {
    $r = Invoke-WebRequest -Uri 'http://172.19.154.172:8000/v1/chat/completions' -Method POST -Headers $headers -Body $body -TimeoutSec 60
    Write-Host "STATUS: $($r.StatusCode)"
    Write-Host "BODY:   $($r.Content.Substring(0, [Math]::Min(800, $r.Content.Length)))"
} catch {
    Write-Host "ERROR: $($_.Exception.Message)"
    if ($_.Exception.Response) {
        Write-Host "STATUS: $($_.Exception.Response.StatusCode.value__)"
    }
}
