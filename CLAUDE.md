# NARA Lucky Epoch AI Context

Last updated: 2026-03-22.
This folder is the active Cloudflare Pages app for `/lotto`.

## Deploy Rule

Cloudflare deploys from this folder require `CLOUDFLARE_API_TOKEN` in the current shell.

Important:

- the token may already exist in `C:\Users\linas\Desktop\FIELD Token\nara-protocol-hardhat\.env`
- Wrangler will not read that `.env` file automatically
- if deploy commands fail with a missing-token error, load the token into the shell first

PowerShell helper:

```powershell
$tokenLine = Get-Content 'C:\Users\linas\Desktop\FIELD Token\nara-protocol-hardhat\.env' | Where-Object { $_ -match '^CLOUDFLARE_API_TOKEN=' } | Select-Object -First 1
$env:CLOUDFLARE_API_TOKEN = $tokenLine.Substring('CLOUDFLARE_API_TOKEN='.Length)
```

## Current Project Names

- Pages project: `nara-lotto`
- public route: `https://www.naraprotocol.io/lotto`

## Current Branding Rule

Use `NARA Lucky Epoch` in the visible app UI.
Keep the frontend static and production-safe unless a server-side feature is explicitly requested.
