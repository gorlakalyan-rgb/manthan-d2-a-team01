# Starts ExpenseFlow with Docker and opens it in your browser.
# Usage (from the project folder):  powershell -ExecutionPolicy Bypass -File .\run-expenseflow.ps1
$ErrorActionPreference = 'Continue'
Set-Location -Path $PSScriptRoot

Write-Host "Checking Docker..." -ForegroundColor Cyan
docker info *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Docker is not running. Start Docker Desktop, wait until it says 'Engine running', then run this script again." -ForegroundColor Red
  exit 1
}

if (-not (Test-Path .env)) { Copy-Item .env.example .env }

Write-Host "Building and starting ExpenseFlow (first run takes 3-5 minutes)..." -ForegroundColor Cyan
docker compose up -d --build --wait
if ($LASTEXITCODE -ne 0) {
  Write-Host "Start-up failed. Recent app logs:" -ForegroundColor Red
  docker compose logs --tail 60 app
  exit 1
}

Write-Host ""
Write-Host "ExpenseFlow is running:" -ForegroundColor Green
Write-Host "  App         http://localhost:8080   (head@demo.expenseflow.test / demo123)"
Write-Host "  Grafana     http://localhost:3000"
Write-Host "  Prometheus  http://localhost:9090"
Write-Host "Stop it with:  docker compose down"
Start-Process "http://localhost:8080"
