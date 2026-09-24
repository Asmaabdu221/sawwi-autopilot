# سوّي — التأكد من أن Docker وحاوية n8n يعملان قبل التشغيل المجدول
# يخرج بـ 0 إذا كان n8n جاهزًا، وبـ 1 إذا تعذّر ذلك.

$ErrorActionPreference = 'SilentlyContinue'
$DockerExe = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
$Health    = 'http://127.0.0.1:5678/healthz'

function Test-Engine {
  $j = Start-Job { docker version --format '{{.Server.Version}}' 2>$null }
  $v = if (Wait-Job $j -Timeout 8) { Receive-Job $j } else { Stop-Job $j; $null }
  Remove-Job $j -Force
  return [bool]$v
}

function Test-N8n {
  try { (Invoke-WebRequest -Uri $Health -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200 } catch { $false }
}

if (Test-N8n) { Write-Output 'n8n جاهز'; exit 0 }

if (-not (Test-Engine)) {
  Write-Output 'محرك Docker متوقف — تشغيل Docker Desktop'
  # الانهيار السابق قد يترك sockets عالقة تمنع الإقلاع؛ تُنقل جانبًا إن وُجدت
  foreach ($d in @("$env:LOCALAPPDATA\Docker\run", "$env:LOCALAPPDATA\docker-secrets-engine")) {
    $stuck = Get-ChildItem $d -Force -File -ErrorAction SilentlyContinue | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }
    if ($stuck -and -not (Get-Process 'Docker Desktop' -ErrorAction SilentlyContinue)) {
      Rename-Item -LiteralPath $d -NewName ((Split-Path $d -Leaf) + '.stale-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
      New-Item -ItemType Directory -Path $d -Force | Out-Null
      Write-Output "نُقلت sockets عالقة من $d"
    }
  }
  Start-Process -FilePath $DockerExe
  for ($i = 0; $i -lt 24; $i++) { Start-Sleep -Seconds 10; if (Test-Engine) { break } }
  if (-not (Test-Engine)) { Write-Output 'فشل إقلاع Docker خلال 4 دقائق'; exit 1 }
  Write-Output 'Docker يعمل'
}

docker start sawwi-n8n 2>$null | Out-Null
for ($i = 0; $i -lt 30; $i++) { Start-Sleep -Seconds 3; if (Test-N8n) { Write-Output 'n8n جاهز'; exit 0 } }
Write-Output 'n8n لم يستجب خلال 90 ثانية'
exit 1
