# NARA Lockboard AI Context

Last updated: 2026-03-22.
This folder is the active Cloudflare Pages app for `/mine`.

## Deploy Rule

Cloudflare deploys from this folder require `CLOUDFLARE_API_TOKEN` in the current shell.

Important:

- the token may already exist in `C:\Users\linas\Desktop\FIELD Token\nara-protocol-hardhat\.env`
- Wrangler will not read that `.env` file automatically
- if deploy or D1 commands fail with a missing-token error, load the token into the shell first

PowerShell helper:

```powershell
$tokenLine = Get-Content 'C:\Users\linas\Desktop\FIELD Token\nara-protocol-hardhat\.env' | Where-Object { $_ -match '^CLOUDFLARE_API_TOKEN=' } | Select-Object -First 1
$env:CLOUDFLARE_API_TOKEN = $tokenLine.Substring('CLOUDFLARE_API_TOKEN='.Length)
```

## Current Project Names

- Pages project: `nara-lockboard`
- D1 database: `nara-lockboard`
- public route: `https://www.naraprotocol.io/mine`

## Current Branding Rule

Use `NARA Degen Board` in the visible app UI.
Do not rename the underlying Cloudflare project or D1 binding unless explicitly requested.
