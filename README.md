# NARA Lockboard

Cloudflare Pages + Functions + D1 app for the live NARA OG lockboard.

## Local

```bash
npm install
npm test
npm run build
npm run dev
```

## Required Cloudflare setup

- Pages project: `nara-lockboard`
- D1 database: `nara-lockboard`
- `wrangler.toml` contains the bound D1 `database_id`
- `CLOUDFLARE_API_TOKEN` must be available in the current shell for remote Wrangler actions
- optional Cloudflare Pages/Functions var: `EXCLUDED_WALLETS=0xWallet1,0xWallet2` for any extra wallets beyond the built-in treasury/owner/operator exclusions

Important deploy note:

- the token may already exist in `C:\Users\linas\Desktop\FIELD Token\nara-protocol-hardhat\.env`, but Wrangler does not read that file automatically
- before `npm run deploy:cf:prod`, load the token into the shell session first
- PowerShell example:

```powershell
$tokenLine = Get-Content 'C:\Users\linas\Desktop\FIELD Token\nara-protocol-hardhat\.env' | Where-Object { $_ -match '^CLOUDFLARE_API_TOKEN=' } | Select-Object -First 1
$env:CLOUDFLARE_API_TOKEN = $tokenLine.Substring('CLOUDFLARE_API_TOKEN='.Length)
```

If `wrangler` says `TOKEN_MISSING`, this is the first thing to check.

## Optional client env

Create `.env` from `.env.example` if you want a real RainbowKit/WalletConnect project ID during local or CI builds.

```bash
VITE_RAINBOW_PROJECT_ID=your_project_id
VITE_EXCLUDED_WALLETS=0xYourExtraExcludedWallet
```

Legacy fallback is also supported:

```bash
VITE_WALLETCONNECT_PROJECT_ID=your_project_id
```

If neither variable is set, the app still builds, but WalletConnect-specific flows may be limited.

## Cloudflare commands

```bash
npm run cf:project:create
npm run cf:db:apply
npm run cf:db:verify
npm run deploy:cf:prod
```

## Live URLs

- Production: https://www.naraprotocol.io/mine
- Board API: https://www.naraprotocol.io/mine/api/board
