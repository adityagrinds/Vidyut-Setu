$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host "Vidyut Setu root: $root"

# Ensure env files exist
if (-not (Test-Path "$root\backend\.env")) {
  Copy-Item "$root\backend\.env.example" "$root\backend\.env"
  Write-Host "Created backend .env from template"
}
if (-not (Test-Path "$root\frontend\.env")) {
  Copy-Item "$root\frontend\.env.example" "$root\frontend\.env"
  Write-Host "Created frontend .env from template"
}

# Install deps if missing
if (-not (Test-Path "$root\backend\node_modules")) {
  Set-Location "$root\backend"
  npm install
}
if (-not (Test-Path "$root\frontend\node_modules")) {
  Set-Location "$root\frontend"
  npm install
}

# Start MongoDB if docker compose exists
Set-Location "$root\database"
try {
  docker compose up -d | Out-Null
  Write-Host "MongoDB started (docker compose)."
} catch {
  Write-Host "Docker not available. Start MongoDB manually on localhost:27017"
}

# Seed latest demo data
Set-Location "$root\backend"
npm run seed

# Launch backend and frontend in separate PowerShell windows
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$root\backend'; npm run dev"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$root\frontend'; npm run dev"

Write-Host "Done. Open http://localhost:5188"
