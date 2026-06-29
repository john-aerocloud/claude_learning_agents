<#
  setup-github-ssh.ps1
  Configures SSH so that:
    * github.com            -> NEW AeroCloudSystems key   (default on this machine)
    * personal.github.com   -> your EXISTING personal key (used when "personal" is in the host)

  Safe to re-run: it backs up your config and only rewrites the blocks it manages.
  Run in PowerShell (does NOT need admin, except the one-time ssh-agent service line).
#>

$ErrorActionPreference = "Stop"

# ---- settings -------------------------------------------------------------
$SshDir       = Join-Path $env:USERPROFILE ".ssh"
$NewKey       = Join-Path $SshDir "id_ed25519_aerocloud"
$KeyComment   = "john.nicholas@aerocloudsystems.com"
$ConfigPath   = Join-Path $SshDir "config"
# ---------------------------------------------------------------------------

if (-not (Test-Path $SshDir)) { New-Item -ItemType Directory -Path $SshDir | Out-Null }

# 1) Generate the new AeroCloud key (if it doesn't already exist) -----------
if (-not (Test-Path $NewKey)) {
    Write-Host "Generating new AeroCloudSystems key: $NewKey" -ForegroundColor Cyan
    ssh-keygen -t ed25519 -C $KeyComment -f $NewKey -N '""'
} else {
    Write-Host "AeroCloud key already exists, skipping generation." -ForegroundColor Yellow
}

# 2) Detect the EXISTING personal key --------------------------------------
$personalKey = $null
foreach ($name in @("id_ed25519","id_rsa","id_ecdsa")) {
    $candidate = Join-Path $SshDir $name
    if ((Test-Path $candidate) -and ($candidate -ne $NewKey)) { $personalKey = $candidate; break }
}
if (-not $personalKey) {
    Write-Warning "No existing personal key found in $SshDir (looked for id_ed25519/id_rsa/id_ecdsa)."
    Write-Warning "Edit `$personalKey in this script to point at your real personal key, then re-run."
} else {
    Write-Host "Using existing personal key: $personalKey" -ForegroundColor Cyan
}

# 3) ssh-agent: enable, start, load both keys ------------------------------
try {
    Set-Service ssh-agent -StartupType Automatic -ErrorAction Stop
    Start-Service ssh-agent -ErrorAction Stop
} catch {
    Write-Warning "Could not auto-configure ssh-agent service. If keys aren't remembered, run PowerShell as admin once and execute:"
    Write-Warning "  Set-Service ssh-agent -StartupType Automatic; Start-Service ssh-agent"
}
# ssh-add prints "Identity added" to stderr; don't let that abort the script
$ErrorActionPreference = "Continue"
ssh-add $NewKey 2>&1 | Out-Null
if ($personalKey) { ssh-add $personalKey 2>&1 | Out-Null }
$ErrorActionPreference = "Stop"

# 4) Write the SSH config blocks (idempotent) ------------------------------
$begin = "# >>> github-ssh-setup (managed) >>>"
$end   = "# <<< github-ssh-setup (managed) <<<"

$personalLine = if ($personalKey) {
    "    IdentityFile " + ($personalKey -replace '\\','/')
} else {
    "    # IdentityFile ~/.ssh/id_ed25519   # <-- set your personal key here"
}

$block = @"
$begin
# Default: AeroCloudSystems / work key
Host github.com
    HostName github.com
    User git
    IdentityFile $(( $NewKey -replace '\\','/'))
    IdentitiesOnly yes

# Personal: use 'personal.github.com' in the remote URL to pick the personal key
Host personal.github.com
    HostName github.com
    User git
$personalLine
    IdentitiesOnly yes
$end
"@

if (Test-Path $ConfigPath) {
    Copy-Item $ConfigPath "$ConfigPath.bak" -Force
    $existing = Get-Content $ConfigPath -Raw
    # strip any previous managed block
    $existing = [regex]::Replace($existing, "(?s)$([regex]::Escape($begin)).*?$([regex]::Escape($end))\r?\n?", "")
    $new = $block + "`r`n" + $existing.TrimStart()
} else {
    $new = $block + "`r`n"
}
Set-Content -Path $ConfigPath -Value $new -NoNewline -Encoding ascii
Write-Host "Wrote SSH config -> $ConfigPath (backup at $ConfigPath.bak if it existed)" -ForegroundColor Green

# 5) Register the new key with GitHub via gh CLI ---------------------------
# gh and ssh -T both write normal output to stderr, so stop treating that as fatal
$ErrorActionPreference = "Continue"
if (Get-Command gh -ErrorAction SilentlyContinue) {
    Write-Host "Registering new key with GitHub (gh)..." -ForegroundColor Cyan
    gh ssh-key add "$NewKey.pub" --title "AeroCloud - $env:COMPUTERNAME"
} else {
    Write-Warning "gh CLI not found. Install it (winget install GitHub.cli; gh auth login) then run:"
    Write-Warning "  gh ssh-key add `"$NewKey.pub`" --title `"AeroCloud - $env:COMPUTERNAME`""
    Write-Host  "`n--- Your new public key (paste at https://github.com/settings/ssh/new ) ---"
    Get-Content "$NewKey.pub"
}

# 6) Verify -----------------------------------------------------------------
Write-Host "`nVerifying connections..." -ForegroundColor Cyan
Write-Host "default (AeroCloud):" -ForegroundColor Cyan
ssh -T git@github.com
if ($personalKey) {
    Write-Host "personal:" -ForegroundColor Cyan
    ssh -T git@personal.github.com
}

Write-Host "`nDone." -ForegroundColor Green
Write-Host "Work/AeroCloud repos: git@github.com:AeroCloudSystems/<repo>.git   (default)"
Write-Host "Personal repos:       git@personal.github.com:<you>/<repo>.git"