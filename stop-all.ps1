$root = Split-Path -Parent $MyInvocation.MyCommand.Path

$targets = Get-CimInstance Win32_Process |
	Where-Object {
		$_.Name -eq "node.exe" -and
		$_.CommandLine -and
		(
			$_.CommandLine -like "*$root\\backend*" -or
			$_.CommandLine -like "*$root\\frontend*"
		)
	}

if (-not $targets) {
	Write-Host "No Vidyut Setu Node.js dev servers were found."
	exit 0
}

$targets | ForEach-Object {
	Stop-Process -Id $_.ProcessId -Force
	Write-Host "Stopped process $($_.ProcessId)"
}

Write-Host "Stopped Vidyut Setu Node.js dev servers."
