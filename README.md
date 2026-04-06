# NARA Lucky Epoch

Cloudflare Pages app for the live NARA no-loss lottery on Base.

## Local

```bash
npm install
npm test
npm run build
npm run dev
```

## Production

- Pages project: `nara-lotto`
- Production route: `https://www.naraprotocol.io/lotto`
- Preview route: `https://nara-lotto.pages.dev`
- `CLOUDFLARE_API_TOKEN` must be available in the current shell for remote Wrangler actions

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

Create `.env` from `.env.example` for a real RainbowKit project ID during local or CI builds.

```bash
VITE_RAINBOW_PROJECT_ID=your_project_id
VITE_WALLETCONNECT_PROJECT_ID=your_project_id
VITE_BASE_RPC_URL=https://base-mainnet.g.alchemy.com/v2/YOUR_KEY
```

If neither project ID variable is set, the app still builds, but WalletConnect-specific flows may be limited.

## Cloudflare commands

```bash
npm run cf:project:create
npm run deploy:cf:prod
```

## Live URLs

- Production: https://www.naraprotocol.io/lotto
- Preview: https://nara-lotto.pages.dev
