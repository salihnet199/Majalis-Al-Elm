# ─────────────────────────────────────────────────────────────────────────────
# scripts/test-integration-mobile.ps1
# End-to-End PowerShell Orchestrator for Majalis Al-Elm Integration Suite
# ─────────────────────────────────────────────────────────────────────────────
param (
    [switch]$ResetDb
)

$ErrorActionPreference = "Stop"
$rootDir = Resolve-Path "$PSScriptRoot\.."
Set-Location $rootDir

$containerName = "majalis-elm-postgres-test"
$imageName = "majalis-elm/postgres:dev"
$dbName = "majaliselm"
$dbUser = "majaliselm"
$dbPass = "majaliselm_test_pass_2026"
# Use 5433 to avoid conflict with the existing dev compose postgres on 5432
$dbPort = "5433"
$dbHostPort = "5433"

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "  Majalis Al-Elm — Mobile Integration & PostgreSQL Test Pipeline " -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan

# 1. Ensure JWT RS256 Keys
if (-not (Test-Path "secrets/jwt_private_key.pem") -or -not (Test-Path "secrets/jwt_public_key.pem")) {
    Write-Host ">>> [1/7] Generating RS256 JWT keys in secrets/..." -ForegroundColor Yellow
    node -e "const crypto = require('crypto'); const fs = require('fs'); fs.mkdirSync('secrets', { recursive: true }); const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 4096, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } }); fs.writeFileSync('secrets/jwt_private_key.pem', privateKey); fs.writeFileSync('secrets/jwt_public_key.pem', publicKey);"
} else {
    Write-Host ">>> [1/7] JWT RS256 keys found in secrets/." -ForegroundColor Green
}

# 2. Build custom Postgres image (pg_uuidv7) if not already present, then start container
$imageExists = docker images --format '{{.Repository}}:{{.Tag}}' | Where-Object { $_ -eq $imageName }
if (-not $imageExists) {
    Write-Host ">>> [2/7] Building custom PostgreSQL image ($imageName) — this takes ~2 minutes the first time..." -ForegroundColor Yellow
    docker build -t $imageName "$rootDir\infra\docker\postgres"
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to build custom PostgreSQL image. Check internet access (GitHub clone required)."
    }
} else {
    Write-Host ">>> [2/7] Custom PostgreSQL image ($imageName) already present." -ForegroundColor Green
}

if ($ResetDb) {
    Write-Host ">>> [2/7] Resetting PostgreSQL container (--reset-db)..." -ForegroundColor Yellow
    docker rm -f $containerName al-fajr-postgres majalis-elm-postgres 2>$null | Out-Null
}

$running = docker ps --format '{{.Names}}' | Where-Object { $_ -eq $containerName }
if (-not $running) {
    Write-Host ">>> [2/7] Starting PostgreSQL container ($containerName)..." -ForegroundColor Yellow
    docker rm -f $containerName 2>$null | Out-Null
    docker run -d --name $containerName `
        -e "POSTGRES_DB=$dbName" `
        -e "POSTGRES_USER=$dbUser" `
        -e "POSTGRES_PASSWORD=$dbPass" `
        -p "${dbHostPort}:5432" `
        $imageName | Out-Null
} else {
    Write-Host ">>> [2/7] PostgreSQL container ($containerName) already running." -ForegroundColor Green
}

# 3. Wait for PostgreSQL readiness
Write-Host ">>> [3/7] Waiting for PostgreSQL to be ready on port $dbPort..." -ForegroundColor Yellow
$ready = $false
for ($i = 1; $i -le 30; $i++) {
    docker exec $containerName pg_isready -U $dbUser -d $dbName -q 2>$null
    # Note: container exposes on 5433 externally but pg_isready uses the container's internal 5432
    if ($LASTEXITCODE -eq 0) {
        $ready = $true
        Write-Host "    PostgreSQL is ready." -ForegroundColor Green
        break
    }
    Start-Sleep -Seconds 1
}

if (-not $ready) {
    Write-Error "PostgreSQL failed to become ready within 30 seconds."
}

# 4. Apply Migrations and Seed Data
Write-Host ">>> [4/7] Applying SQL Migrations (000 to 042) & Seed Data..." -ForegroundColor Yellow
$migrationFiles = Get-ChildItem "apps\backend\migrations\*.sql" | Sort-Object Name
foreach ($file in $migrationFiles) {
    if ($file.Name -eq "seed_integration_test.sql") { continue }
    Write-Host "    Executing $($file.Name)..." -ForegroundColor Gray
    Get-Content $file.FullName -Raw | docker exec -i $containerName psql -U $dbUser -d $dbName 2>$null | Out-Null
}

Write-Host "    Executing seed_integration_test.sql..." -ForegroundColor Gray
Get-Content "apps\backend\migrations\seed_integration_test.sql" -Raw | docker exec -i $containerName psql -U $dbUser -d $dbName 2>$null | Out-Null

# 5. Start Backend Server
Write-Host ">>> [5/7] Starting NestJS Backend Server..." -ForegroundColor Yellow
$env:NODE_ENV = "development"
$env:PORT = "3000"
$env:DATABASE_HOST = "localhost"
$env:DATABASE_PORT = $dbHostPort
$env:DATABASE_NAME = $dbName
$env:DATABASE_USER = $dbUser
$env:DATABASE_PASSWORD = $dbPass
$env:DATABASE_SSL = "false"
$env:JWT_PRIVATE_KEY_PATH = "./secrets/jwt_private_key.pem"
$env:JWT_PUBLIC_KEY_PATH = "./secrets/jwt_public_key.pem"
$env:JWT_ACCESS_TOKEN_TTL = "900"
$env:JWT_REFRESH_TOKEN_TTL = "604800"
$env:CORS_ORIGIN = "http://localhost,http://127.0.0.1"
$env:LOG_LEVEL = "warn"

# Build backend bundle
Write-Host "    Building NestJS backend bundle..." -ForegroundColor Gray
npx nx build backend 2>$null | Out-Null

# Kill existing node backend if running on 3000
npx kill-port 3000 2>$null | Out-Null

# Start backend process
$backendProcess = Start-Process node -ArgumentList "dist/apps/backend/main.js" -PassThru -NoNewWindow

try {
    # Wait for backend health check
    Write-Host "    Waiting for Backend health check (http://localhost:3000/api/v1/health)..." -ForegroundColor Yellow
    $healthy = $false
    for ($i = 1; $i -le 45; $i++) {
        $raw = curl.exe -s http://localhost:3000/api/v1/health
        if ($raw -and $raw -match '"status":"ok"') {
            $healthy = $true
            Write-Host "    Backend is healthy and listening on port 3000!" -ForegroundColor Green
            break
        }
        Start-Sleep -Seconds 1
    }

    if (-not $healthy) {
        Write-Error "Backend failed to report healthy status within 45 seconds."
    }

    # 6. Run Flutter Integration Test Suite (8 Real Scenarios)
    Write-Host ">>> [6/7] Running Flutter Real Backend Integration Tests (8 Scenarios)..." -ForegroundColor Yellow
    Push-Location "apps\mobile"
    flutter test test/integration/real_backend_integration_test.dart
    if ($LASTEXITCODE -ne 0) {
        throw "Integration tests failed with exit code $LASTEXITCODE"
    }

    # 7. Run All Existing Flutter Tests (37 Tests)
    Write-Host ">>> [7/7] Verifying all existing Flutter Unit & Widget tests (37 tests)..." -ForegroundColor Yellow
    flutter test
    if ($LASTEXITCODE -ne 0) {
        throw "Unit/widget tests failed with exit code $LASTEXITCODE"
    }
    Pop-Location

    Write-Host ""
    Write-Host "=================================================================" -ForegroundColor Green
    Write-Host "  ✅ ALL INTEGRATION & REGRESSION TESTS PASSED SUCCESSFULLY!    " -ForegroundColor Green
    Write-Host "=================================================================" -ForegroundColor Green
} finally {
    Write-Host ">>> Cleaning up backend process..." -ForegroundColor Gray
    if ($backendProcess -and -not $backendProcess.HasExited) {
        Stop-Process -Id $backendProcess.Id -Force -ErrorAction SilentlyContinue
    }
    npx kill-port 3000 2>$null | Out-Null
}
