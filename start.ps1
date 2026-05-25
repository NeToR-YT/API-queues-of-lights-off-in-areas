param(
    [switch]$Parse
)

$BACKEND  = Join-Path $PSScriptRoot "backend-js"
$FRONTEND = Join-Path $PSScriptRoot "frontend"
$CONFIG   = Join-Path $BACKEND "config.json"

# Зупиняємо старі процеси
Write-Host "Зупиняємо старi процеси..." -ForegroundColor DarkGray
foreach ($port in 5000, 5001) {
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($conns) {
        foreach ($c in $conns) {
            Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
        }
    }
}
Start-Sleep -Seconds 1

# Режим парсингу
if ($Parse) {
    Write-Host ""
    Write-Host "=== НАЛАШТУВАННЯ ПАРСИНГУ ===" -ForegroundColor Yellow

    $fromDate = ""
    $valid = $false
    while (-not $valid) {
        $fromDate = Read-Host "Дата початку парсингу (РРРР-ММ-ДД, напр. 2026-01-01)"
        if ($fromDate -match '^\d{4}-\d{2}-\d{2}$') {
            $valid = $true
        } else {
            Write-Host "Неправильний формат! Потрiбно РРРР-ММ-ДД" -ForegroundColor Red
        }
    }

    # Оновлюємо parse_from_date в config.json
    $raw = Get-Content $CONFIG -Raw -Encoding UTF8
    $cfg = $raw | ConvertFrom-Json
    $cfg.batch_parser.parse_from_date = $fromDate
    $cfg | ConvertTo-Json -Depth 10 | Set-Content $CONFIG -Encoding UTF8

    Write-Host "Конфiг оновлено: parse_from_date = $fromDate" -ForegroundColor Green
    Write-Host ""
}

# Запуск бекенду
Write-Host "Запускаємо бекенд  -> http://localhost:5001" -ForegroundColor Cyan
$backendCmd = "cd `"$BACKEND`"; `$env:PORT='5001'; npm start"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendCmd -WindowStyle Normal

Start-Sleep -Seconds 3

# Запуск фронтенду
Write-Host "Запускаємо фронтенд -> http://localhost:5000" -ForegroundColor Cyan
$frontendCmd = "cd `"$FRONTEND`"; npm run dev"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $frontendCmd -WindowStyle Normal

# Результат
Write-Host ""
Write-Host "=================================" -ForegroundColor Green
Write-Host "  ПРОЕКТ ЗАПУЩЕНО" -ForegroundColor Green
Write-Host "  Frontend : http://localhost:5000" -ForegroundColor Green
Write-Host "  Backend  : http://localhost:5001" -ForegroundColor Green
if ($Parse) {
    Write-Host "  Парсинг з: $fromDate" -ForegroundColor Yellow
}
Write-Host "=================================" -ForegroundColor Green
Write-Host ""
Write-Host "Використання:"
Write-Host "  .\start.ps1          # просто запустити"
Write-Host "  .\start.ps1 -Parse   # запустити + вказати дату парсингу"
