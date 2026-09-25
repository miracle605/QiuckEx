# Capability Map: Live vs Mocked vs Partial vs Experimental

This document is the single place to check **what is actually built versus scaffolded** across all four product surfaces (`app/frontend`, `app/backend`, `app/mobile`, `app/contract`). Use it before picking an issue or building on top of an existing flow, so you don't depend on something that only *looks* implemented.

Companion docs:

- [BACKEND-CLIENT-CONTRACT-MAP.md](./BACKEND-CLIENT-CONTRACT-MAP.md) — endpoint-level wiring between clients and backend (mismatch numbers referenced below, e.g. "mismatch #1", come from that doc).
- [MVP-CONTRACT-SCOPE.md](./MVP-CONTRACT-SCOPE.md) — what is deliberately on-chain vs deferred.
- [RUNTIME-CONFIG-MATRIX.md](./RUNTIME-CONFIG-MATRIX.md) — environment/config drift that affects whether "Live" flows actually work in your environment.

## Status legend

Exactly four status terms are used in this document. If you update a row, use only these:

| Status | Meaning |
|---|---|
| **Live** | Wired end-to-end against real services (NestJS backend, Supabase, Horizon, Soroban RPC). Safe to build on. |
| **Partial** | Some segments are real, others are stubbed, missing, or broken. Read the notes column before relying on it. |
| **Mocked** | Returns hardcoded/simulated data. The UI or API shape exists, but nothing real happens behind it. |
| **Experimental** | Gated behind feature flags, testnet-only, or still at spec/requirements stage. Behavior may change or be disabled at any time. |

> "Planned but not fully wired" items from the contract map (client exists, backend route missing) are classified **Partial** here. Known-broken wiring is also **Partial**, with the breakage called out in the notes.

---

## Frontend (`app/frontend`)

Next.js 15 app. Base URL via `NEXT_PUBLIC_QUICKEX_API_URL` (`src/lib/api.ts`), default `http://localhost:4000`.

| Flow | Owning module | Status | Notes |
|---|---|---|---|
| Public profile page | `src/app/[username]` → backend `usernames` | **Live** | Real `GET /username/:username`; private profiles degrade correctly. |
| Pay page + SSR OG previews | `src/app/pay`, `src/lib/og-metadata.ts` → backend `links` | **Live** | Real `GET /payment-links/status`. |
| Payment signing state | `src/components/payment-states/ActivePaymentState.tsx` | **Mocked** | Fabricates a fake signed XDR string (L148–151); no real wallet signature is produced. |
| Link generator (assets, path preview, metadata, CSV bulk) | `src/app/generator` → backend `stellar`, `links` | **Live** | Real endpoints throughout; bulk gated by `bulk_link_generation` flag (enabled by default). |
| Link generator — Soroban contract preflight | `src/app/generator` → backend `stellar` | **Experimental** | `POST /stellar/soroban-preflight` requires `testnet.contract_writes` flag + `NetworkSafetyGuard`; 503 if `QUICKEX_CONTRACT_ID` unset. |
| Dashboard analytics | `src/app/dashboard`, `src/hooks/analyticsApi.ts` → backend `analytics` | **Live** | Real report/export; silently falls back to empty data on API failure. |
| Marketplace listings + detail | `src/app/marketplace` → backend `marketplace` | **Partial** | Listing fetch/detail hit real `GET /marketplace` routes, but see next two rows. |
| Marketplace — user bids & user listings | `src/hooks/marketplaceApi.ts` | **Mocked** | `MOCK_USER_BIDS` / `MOCK_USER_LISTINGS` returned behind fake delays. |
| Marketplace — real-time bid updates | `src/hooks/useRealtimeUpdates.ts` | **Mocked** | `MockWebSocket` class generates random bids on a timer; no server connection exists. |
| Marketplace — extend/cleanup contract actions | `src/hooks/mockApi.ts` | **Mocked** | `mockContractCall()` resolves `true` after a timeout. |
| Discovery page | `src/app/discovery` | **Mocked** | Renders `MOCK_USERS` from `src/lib/mockData.ts`. The backend already serves real `GET /username/search|trending|recently-active|featured` — wiring them up is an open opportunity. |
| Notification center | `src/app/notifications`, `src/components/NotificationCenterProvider.tsx` | **Partial** | UI is real but state is localStorage-only; not fed by the backend `notifications` module. |
| Webhook management | `src/app/webhooks` → backend `notifications` | **Live** | Full webhook CRUD/logs/redeliver/signature-verify family. |
| Developer settings (API keys) | `src/app/settings/developer` → backend `api-keys` | **Live** | Key CRUD, usage, rotate. |
| Profile settings | `src/app/settings` | **Mocked** | Save is a `// TODO: Call API to save profile`; nothing persists to the backend. |
| Team management | `src/app/settings/teams` | **Mocked** | In-memory member list and a hardcoded "admin" role; no backend module exists for teams. |
| Admin — system health | `src/components/admin/SystemHealth.tsx` → backend `health` | **Live** | `GET /health`. |
| Admin — feature flags & audit logs | `src/components/admin/*` → backend `feature-flags`, `audit` | **Partial** | Endpoints are real but called with **no auth header**, and the backend controllers are unguarded (mismatch #7 — known security gap). |
| WalletConnect session lifecycle | `src/lib/walletconnect/session.ts`, `src/hooks/useWalletConnectSession.ts` | **Experimental** | Connect/active/disconnect/expiry/reconnect implemented with stable error codes (`WC_SESSION_EXPIRED`, `WC_SESSION_DUPLICATE`, `WC_SESSION_UNAUTHORIZED`, `WC_SESSION_MALFORMED`, `WC_DEPENDENCY_UNAVAILABLE`). Gated by `walletconnect.sessions` flag; disabled on mainnet until audited. Disconnected-session recovery resumes via persisted session topic without re-signing or duplicating operations. |
| Fiat ramp deposit/withdraw reconciliation | `src/app/ramps`, `src/hooks/useFiatRampReconciliation.ts` → backend `fiat-ramps` | **Experimental** | Provider callbacks (SEP-24 deposit/withdraw status) are reconciled against local intents with idempotent callback handling and outage recovery. Stable error codes (`RAMP_CALLBACK_UNAUTHORIZED`, `RAMP_CALLBACK_DUPLICATE`, `RAMP_INTENT_EXPIRED`, `RAMP_CALLBACK_MALFORMED`, `RAMP_PROVIDER_UNAVAILABLE`). Gated by `fiat_ramps.reconciliation` flag; disabled on mainnet until anchor integration is audited. Self-custody preserved: reconciliation never signs or moves funds, only records provider-observed state. |

## Backend (`app/backend`)

NestJS app, ~38 modules wired in `src/app.module.ts`. Supabase (40 migrations) and Horizon integrations are real. `ReconciliationModule`, `NotificationsModule`, and `DeveloperModule` are skipped when `SUPABASE_URL` points at local Supabase.

| Flow / module | Owning path | Status | Notes |
|---|---|---|---|
| Usernames & public profiles | `src/usernames` | **Live** | Includes search/trending/featured endpoints that no client consumes yet. |
| Payment links (metadata, status, bulk, recurring, scam alerts) | `src/links` | **Live** | Recurring endpoints have no client consumer yet. |
| Transactions (Horizon-backed, compose/build/simulate) | `src/transactions` | **Live** | Compose/simulate writes are **Experimental** (flag-gated, see below). `build` is a compatibility alias of `compose`. |
| Recent payments | `src/payments` | **Live** | Thin controller over `HorizonService.getPayments`; no client consumer yet. |
| Stellar (verified assets, path payments, quotes) | `src/stellar` | **Partial** | Assets and path previews are Live; the quote **preflight is a stub that always reports feasible** (`quote.service.ts` L141). |
| Analytics (report, export, time-series) | `src/analytics` | **Live** | — |
| API keys | `src/api-keys` | **Live** | — |
| Notifications & webhooks | `src/notifications` | **Live** | Disabled in local dev (local Supabase check in `app.module.ts`). |
| Marketplace | `src/marketplace` | **Live** | Listings/detail only — no bids or real-time endpoints exist (frontend mocks those, see above). |
| Receipts | `src/receipts` | **Partial** | `receipts.service.ts` L206: `// TODO: replace with actual Supabase/database call`. |
| Reconciliation | `src/reconciliation` | **Partial** | Horizon-observed counts are placeholders that mirror expected values (`reconciliation.service.ts` L403–404) — it cannot detect real divergence yet. Disabled in local dev. |
| Fiat ramps (SEP-24 deposit/withdraw, KYC) | `src/fiat-ramps` | **Partial** | Anchor list and SEP-10 auth are real; interactive URLs are provider-issued. Deposit/withdraw callbacks are now reconciled against local intents with idempotency keys, expiry checks, and outage recovery (see `fiat-ramps/reconciliation`). Gated by `fiat_ramps.reconciliation` flag; disabled on mainnet until audited. |
| Contract registry | `src/contracts` | **Live** | ETag/304 support; admin-scoped writes/rollback. |
| Feature flags | `src/feature-flags` | **Live** | Supabase-backed with kill-switch semantics; controller is **unguarded** (mismatch #7). |
| Audit logs | `src/audit`

/* … truncated 600 chars — edit only what you need near the top … */
