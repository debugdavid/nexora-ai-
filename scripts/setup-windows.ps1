<#
PowerShell setup script for Windows to configure and run Nexora AI (feature/auth-db).
This script helps you populate backend/.env and root .env with your secrets, and optionally runs Docker Compose or local setup.

Usage: Open PowerShell as Administrator (or with script execution allowed) and run:
  .\scripts\setup-windows.ps1

Notes:
- This script writes plaintext secrets to backend/.env for local development. Do NOT commit the .env file.
- You will be prompted for secrets (OPENAI_API_KEY, JWT_SECRET, optional SMTP creds).
- Requires: PowerShell 7+ (recommended), Git, Node & npm (if running local), Docker Desktop (if using Docker flow), docker-compose plugin.
#>

function Read-SecureInput($prompt) {
    $secure = Read-Host -Prompt $prompt -AsSecureString
    $ptr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

Write-Host "=== Nexora AI — Windows setup helper ===" -ForegroundColor Cyan

# Check prerequisites
$errors = @()
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { $errors += 'git not found' }
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Write-Host 'Warning: docker not found in PATH. Docker flow will not be available.' -ForegroundColor Yellow }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Host 'Warning: node not found in PATH. Local dev flow will not be available.' -ForegroundColor Yellow }

if ($errors.Count -gt 0) {
  Write-Host "Prerequisite errors:" -ForegroundColor Red
  $errors | ForEach-Object { Write-Host " - $_" }
  Write-Host "Please install required tools and re-run the script." -ForegroundColor Red
  exit 1
}

# Ask which flow
$useDockerInput = Read-Host "Use Docker Compose flow? (Y/n) [default: Y]"
if ([string]::IsNullOrWhiteSpace($useDockerInput) -or $useDockerInput -match '^[Yy]') { $useDocker = $true } else { $useDocker = $false }

# Prompt for secrets
$openai = Read-SecureInput 'Enter OPENAI_API_KEY (input hidden)'
$jwt = Read-SecureInput 'Enter JWT_SECRET (input hidden)'
$frontendUrl = Read-Host 'Frontend URL (default http://localhost:5173)'
if ([string]::IsNullOrWhiteSpace($frontendUrl)) { $frontendUrl = 'http://localhost:5173' }
$backendUrl = Read-Host 'Backend URL (default http://localhost:3000)'
if ([string]::IsNullOrWhiteSpace($backendUrl)) { $backendUrl = 'http://localhost:3000' }

# SMTP optional
$useSmtp = Read-Host 'Configure SMTP for emails? (y/N) [default: N]'
if ($useSmtp -match '^[Yy]') {
  $smtpHost = Read-Host 'SMTP_HOST'
  $smtpPort = Read-Host 'SMTP_PORT (default 587)'
  if ([string]::IsNullOrWhiteSpace($smtpPort)) { $smtpPort = '587' }
  $smtpSecureInput = Read-Host 'SMTP_SECURE? (true/false) [default: false]'
  if ([string]::IsNullOrWhiteSpace($smtpSecureInput)) { $smtpSecure = 'false' } else { $smtpSecure = $smtpSecureInput }
  $smtpUser = Read-Host 'SMTP_USER (leave blank for unauthenticated)'
  if (-not [string]::IsNullOrWhiteSpace($smtpUser)) {
    $smtpPass = Read-SecureInput 'SMTP_PASS (hidden)'
  } else { $smtpPass = '' }
  $senderEmail = Read-Host 'SENDER_EMAIL (default noreply@nexora.ai)'
  if ([string]::IsNullOrWhiteSpace($senderEmail)) { $senderEmail = 'noreply@nexora.ai' }
} else {
  $smtpHost = '' ; $smtpPort = '' ; $smtpSecure = 'false' ; $smtpUser = '' ; $smtpPass = '' ; $senderEmail = ''
}

# Prepare .env contents
$backendEnv = @"
OPENAI_API_KEY=$openai
OPENAI_API_BASE=https://api.openai.com
OPENAI_MODEL=gpt-4
PORT=3000
FRONTEND_PORT=5173

# Postgres (example local or docker-compose)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/nexora?schema=public
JWT_SECRET=$jwt

# SMTP for sending verification/reset emails
SMTP_HOST=$smtpHost
SMTP_PORT=$smtpPort
SMTP_SECURE=$smtpSecure
SMTP_USER=$smtpUser
SMTP_PASS=$smtpPass
SENDER_EMAIL=$senderEmail

FRONTEND_URL=$frontendUrl
BACKEND_URL=$backendUrl
"@

$rootEnv = @"
# Example environment variables
OPENAI_API_KEY=$openai
OPENAI_API_BASE=https://api.openai.com
OPENAI_MODEL=gpt-4
PORT=3000
FRONTEND_PORT=5173

# Postgres (example local)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/nexora?schema=public
JWT_SECRET=$jwt

# SMTP for sending verification/reset emails
SMTP_HOST=$smtpHost
SMTP_PORT=$smtpPort
SMTP_SECURE=$smtpSecure
SMTP_USER=$smtpUser
SMTP_PASS=$smtpPass
SENDER_EMAIL=$senderEmail
"@

# Write files
Write-Host "Writing backend/.env and .env (root) — do not commit these files." -ForegroundColor Green
$backendPath = Join-Path -Path (Get-Location) -ChildPath 'backend\.env'
$rootPath = Join-Path -Path (Get-Location) -ChildPath '.env'
Set-Content -Path $backendPath -Value $backendEnv -Force -Encoding UTF8
Set-Content -Path $rootPath -Value $rootEnv -Force -Encoding UTF8

# Confirm
Write-Host "Wrote $backendPath and $rootPath" -ForegroundColor Cyan

if ($useDocker) {
  Write-Host "Starting Docker Compose..." -ForegroundColor Cyan
  # Use docker compose (modern) or fallback to docker-compose
  if (Get-Command 'docker' -ErrorAction SilentlyContinue) {
    # Start containers detached
    & docker compose up --build -d
    if ($LASTEXITCODE -ne 0) {
      Write-Host "docker compose up failed. Try running 'docker compose up --build' manually." -ForegroundColor Red
      exit 1
    }
    Write-Host "Containers started. Running Prisma generate/migrate inside backend container..." -ForegroundColor Cyan
    Start-Sleep -Seconds 5
    & docker compose exec backend npx prisma generate
    & docker compose exec backend npx prisma migrate deploy
    Write-Host "Migrations deployed. Backend should be available at $backendUrl and frontend at $frontendUrl" -ForegroundColor Green
    Write-Host "To view logs: docker compose logs -f backend" -ForegroundColor Yellow
  } else {
    Write-Host "docker command not found. Install Docker Desktop and re-run this script." -ForegroundColor Red
    exit 1
  }
} else {
  Write-Host "Running local dev setup (backend + frontend)" -ForegroundColor Cyan
  # Backend setup
  Push-Location .\backend
  if (-not (Test-Path .\node_modules)) { npm install }
  npx prisma generate
  npx prisma migrate dev --name init
  Write-Host "Starting backend (npm run dev) — it will run in this PowerShell window. Open a new window to start the frontend." -ForegroundColor Green
  npm run dev
  Pop-Location
}

Write-Host "Setup script finished." -ForegroundColor Cyan
Write-Host "If the backend is running, open the frontend at $frontendUrl and register a new user to test the chat flow." -ForegroundColor Green
