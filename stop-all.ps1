Get-Process -Name node -ErrorAction SilentlyContinue | Stop-Process -Force
Write-Host "Stopped all Node.js dev servers."
