# NARA Lucky Epoch

Lucky Epoch is the live NARA prize-pool app served at `https://www.naraprotocol.io/lotto`.

## Local

```bash
npm install
npm test
npm run build
npm run dev
```

## Live Deploy

Primary production setup:

- App repo: `https://github.com/NARAProtocol/lotto_nara.git`
- Vercel project: `lotto-nara`
- Vercel app URL: `https://lotto-nara.vercel.app/lotto`
- Main site route: `https://www.naraprotocol.io/lotto`

## Optional client env

Create `.env` from `.env.example` for a real RainbowKit project ID during local builds.

```bash
VITE_RAINBOW_PROJECT_ID=your_project_id
VITE_WALLETCONNECT_PROJECT_ID=your_project_id
VITE_BASE_RPC_URL=https://base-mainnet.g.alchemy.com/v2/YOUR_KEY
```

If neither project ID variable is set, the app still builds, but WalletConnect-specific flows may be limited.

## Permanent Vercel Deploy Path

Do not rely on Vercel's default Git auto-deploy for this repo while it is private and the Vercel workspace stays on Hobby.
That setup can block production deploys based on commit author.

The permanent deploy path is GitHub Actions using the Vercel project owner's token.

Workflow file:

- `.github/workflows/deploy-vercel-production.yml`

Required GitHub repository secrets in `NARAProtocol/lotto_nara`:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

One-time setup:

1. In the Vercel dashboard, open the `lotto-nara` project.
2. Copy the `Project ID` and `Team ID` or `Org ID` from project settings.
3. In GitHub `NARAProtocol/lotto_nara`, add the three secrets above.
4. Keep the Vercel project env vars set in Vercel as usual.
5. Push to `main` or run the `Deploy Lotto To Vercel` workflow manually.

Recommended Vercel setting:

- Disable automatic Git deployments for this project, or ignore blocked Git deployment entries and treat the GitHub Action deployment as the production source of truth.

## Legacy Cloudflare Notes

Cloudflare Pages commands remain in `package.json`, but Vercel is the active production path for lotto now.

```bash
npm run cf:project:create
npm run deploy:cf:prod
```