# NARA Lucky Epoch AI Context

Last updated: 2026-04-06.
This folder is the active frontend app for `/lotto`.

## Current Ownership

- App folder: `apps/nara-lotto`
- GitHub repo: `https://github.com/NARAProtocol/lotto_nara.git`
- Vercel app: `https://lotto-nara.vercel.app/lotto`
- Main public route: `https://www.naraprotocol.io/lotto`

## Mandatory Epoch Sync Rule

Before redesigning UI or debugging wallet flow, inspect protocol timing first.

- Read both `currentEpoch` and `epochState`.
- Treat `currentEpoch` as the live clock and `epochState.epoch` as the settled on-chain state.
- Compute `backlog = max(0, currentEpoch - epochState.epoch)`.
- If backlog is above zero, the app must show a sync action before the main join CTA.
- Sync with `advanceEpoch()` for a backlog of 1 or `advanceEpochs(backlog)` for a larger backlog.
- Refetch reads after sync, then allow join.
- Never let deposit or lock actions fire while backlog exists.
- Map `epochstale`, `failed_would_revert`, and `would revert` to a friendly sync message.

## Timing Rule

- Use the live epoch for top-line display such as the hero epoch pill.
- Use the settled epoch for join, draw, warm-up, and withdrawal timing.
- If these drift apart, trust the settled epoch for action gating.

## Current Implementation Reference

- Main logic: `src/app.tsx`
- Historical notes: `../../docs/LOTTO_RUNBOOK.md`

## Deploy Rule

- The app is built for the `/lotto` path. Keep Vite base aligned with that path.
- The main-site rewrite from `naraprotocol.io/lotto` must point to `https://lotto-nara.vercel.app/lotto`.
- If Vercel Git deploys are blocked, use the documented owner-token deploy path instead of debugging app code first.

## Branding Rule

Use `NARA Lucky Epoch` in the visible UI.
Keep the frontend static and production-safe unless a server-side feature is explicitly requested.
