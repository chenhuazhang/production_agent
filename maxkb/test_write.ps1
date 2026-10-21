$f = 'C:\Users\K027932\.pi\agent\sessions\--D--AIAgent-production_agent-server--\test-write.txt'
try {
    Set-Content -Path $f -Value 'test' -ErrorAction Stop
    Write-Host "WRITE OK"
    Remove-Item $f
} catch {
    Write-Host "WRITE FAIL: $($_.Exception.Message)"
}

# 也测试一下新目录
$newDir = 'd:\AIAgent\production_agent\.agent-workspace'
if (-not (Test-Path $newDir)) { New-Item -ItemType Directory -Path $newDir | Out-Null }
$g = Join-Path $newDir 'test-write.txt'
try {
    Set-Content -Path $g -Value 'test' -ErrorAction Stop
    Write-Host "NEW DIR WRITE OK"
    Remove-Item $g
} catch {
    Write-Host "NEW DIR WRITE FAIL: $($_.Exception.Message)"
}
