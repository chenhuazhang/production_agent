Write-Host "--- server /health ---"
try {
    $h = Invoke-WebRequest -Uri 'http://localhost:8000/health' -UseBasicParsing -TimeoutSec 10
    Write-Host "STATUS: $($h.StatusCode)"
    Write-Host "BODY:   $($h.Content)"
} catch {
    Write-Host "ERROR: $($_.Exception.Message)"
}

Write-Host ""
Write-Host "--- web / ---"
try {
    $r = Invoke-WebRequest -Uri 'http://localhost:3000/' -UseBasicParsing -TimeoutSec 180
    Write-Host "STATUS: $($r.StatusCode)"
    Write-Host "LENGTH: $($r.Content.Length)"
    $title = if ($r.Content -match '<title>([^<]+)</title>') { $matches[1] } else { '(no title)' }
    Write-Host "TITLE:  $title"
} catch {
    Write-Host "ERROR: $($_.Exception.Message)"
}

Write-Host ""
Write-Host "--- web /api/dashboard ---"
try {
    $d = Invoke-WebRequest -Uri 'http://localhost:3000/api/dashboard' -UseBasicParsing -TimeoutSec 180
    Write-Host "STATUS: $($d.StatusCode)"
    Write-Host "BODY:   $($d.Content.Substring(0, [Math]::Min(500, $d.Content.Length)))"
} catch {
    Write-Host "ERROR: $($_.Exception.Message)"
    if ($_.Exception.Response) {
        Write-Host "STATUS: $($_.Exception.Response.StatusCode.value__)"
    }
}
