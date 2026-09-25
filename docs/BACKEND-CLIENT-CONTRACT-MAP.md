# Backend ↔ Client API Contract Map

This document maps the backend HTTP endpoints actually consumed by the **frontend** (`app/frontend`) and **mobile** (`app/mobile`) apps to their owning backend modules (`app/backend/src/*`), so route mismatches and payload drift are caught before contributor work diverges.

Scope: REST contracts between clients and the NestJS backend. On-chain/Soroban event schemas are covered separately in `app/backend/doc/EVENTS.md` and `app/contract/docs/events-schema.md`.

> **Important:** the backend registers **no global route prefix** (`app/backend/src/main.ts` never calls `setGlobalPrefix`). Controller prefixes are the full public paths. Anything a client prepends (like `/api`) is a bug — see [Known mismatches](#known-mismatches--payload-drift).

## Base URL configuration

| Client | Source | Default / production value |
|---|---|---|
| Frontend | `NEXT_PUBLIC_QUICKEX_API_URL` via `src/lib/api.ts` `getQuickexApiBase()` | `http://localhost:4000`; prod `https://api.quickex.to` (`vercel.json`) |
| Frontend (SSR OG metadata) | `QUICKEX_INTERNAL_API_URL` first, then `NEXT_PUBLIC_QUICKEX_API_URL` (`src/lib/og-metadata.ts`) | `http://localhost:4000` |
| Mobile | Expo `extra.apiUrl` (from `app.config.ts`) or `EXPO_PUBLIC_API_URL` | `http://localhost:4000` for local development; production uses `https://api.quickex.to` |
| Mobile (`payment-confirmation.tsx`) | `EXPO_PUBLIC_API_URL` | Falls back to `https://api.quickex.to` |

Auth conventions:

- **Public** (rate-throttled, no key): `health`/`ready`/`status`, `username/*`, `payment-links/status`, `v1/receipts/*`
- **Optional `X-API-Key`** (higher rate limits via `ApiKeyGuard`): `links/metadata`, `transactions`, `stellar/*`, `analytics/*`, `contracts/registry` reads
- **Admin-scoped API key** (`@RequireScopes('admin')`): all `admin/*` controllers, contract registry writes (`publish`, `PUT deployments/:name`, `rollback`)
- Errors follow the global envelope `{ code, message, fields? }` (global `ValidationPipe` in `main.ts`, e.g. `VALIDATION_ERROR`)

## Wallet capability discovery

Clients must discover what the connected wallet can actually do before offering a flow, and degrade gracefully when a capability is unsupported. The backend exposes a single discovery endpoint that both clients consume; the response is the source of truth for feature gating.

| Endpoint | Owning backend module | Request → response summary |
|---|---|---|
| `GET /stellar/wallet-capabilities?publicKey` | `stellar` (`stellar.controller.ts`) | Query param `publicKey` (G… StrKey, validated) → `WalletCapabilitiesDto` (see below). Public, rate-throttled; optional `X-API-Key` raises the limit. |

`WalletCapabilitiesDto` shape (stable contract — additive changes only):

```jsonc
{
  "publicKey": "G...",
  "network": "testnet",              // "testnet" | "mainnet"
  "networkPassphrase": "Test SDF Network ; September 2015",
  "capabilities": {
    "signTransaction": true,        // wallet can sign Soroban txs
    "signAuthEntry": true,          // wallet supports Soroban auth-entry signing
    "submitTransaction": true,      // wallet can submit to Horizon
    "soroban": true,                // Soroban RPC reachable + contract configured
    "pathPayments": true,           // Horizon strict-send/receive path-finding available
    "trustlines": true              // account can hold non-native assets
  },
  "unsupported": ["signAuthEntry"], // subset of capabilities that are false
  "degraded": false,                // true when a dependency probe failed (see below)
  "reasons": {                      // present only for unsupported/degraded entries
    "signAuthEntry": "WALLET_UNSUPPORTED"
  },
  "checkedAt": "2025-01-01T00:00:00.000Z"
}
```

Stable error codes (global envelope `{ code, message, fields? }`):

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | `publicKey` missing or not a valid StrKey |
| `WALLET_UNSUPPORTED` | 200 (in `reasons`) | Wallet lacks the capability; client must hide/disable the flow |
| `NETWORK_MISMATCH` | 409 | Wallet network ≠ backend `STELLAR_NETWORK`; client must prompt a network switch |
| `DEPENDENCY_UNAVAILABLE` | 503 | Horizon/Soroban probe failed; response is returned with `degraded: true` and conservative `false` capabilities |
| `CONTRACT_NOT_CONFIGURED` | 503 | `QUICKEX_CONTRACT_ID` unset; `soroban` capability is `false` |

Behavioral contract:

- **Self-custody preserved** — discovery is read-only. The backend never receives, stores, or logs secret keys; only the public `publicKey` is sent.
- **Feature gating** — clients MUST gate Soroban/escrow flows on `capabilities.soroban && capabilities.signAuthEntry`; when false, render the unsupported-wallet state instead of attempting a transaction.
- **Degraded mode** — on `DEPENDENCY_UNAVAILABLE` the endpoint still returns 200 with `degraded: true` and all unprobed capabilities set to `false`, so clients fail closed rather than optimistically enabling a flow.
- **Idempotent & cacheable** — the endpoint is a pure read; clients may cache for a short TTL (≤60s) and re-check before submitting a transaction.
- **Observability** — success/latency/failure are emitted as structured logs and metrics keyed by `network` and capability name; no secrets or PII beyond the public key are recorded.

## Frontend endpoint map

| Screen / feature | Endpoint | Owning backend module | Request → response summary |
|---|---|---|---|
| Public profile page (`app/[username]/page.tsx`) | `GET /username/:username` | `usernames` (`usernames.controller.ts`) | Path param → `{ id, username, publicKey, isPublic, lastActiveAt, createdAt }`; private profiles return only `{ username, isPublic: false }`; 404 if unknown |
| Pay page (`pay/PaymentPageClient.tsx`) + SSR OG previews (`lib/og-metadata.ts`) | `GET /payment-links/status?username&amount&asset&memo&acceptedAssets` | `links` (`payment-link.controller.ts`) | Query params → `PaymentLinkStatusDto` (active / expired / paid / refunded) |
| Link generator (`generator/page.tsx`) | `GET /stellar/verified-assets` | `stellar` (`stellar.controller.ts`) | → `AssetListResponseDto` (verified assets + TOML branding metadata) |
| Link generator — wallet capability discovery | `GET /stellar/wallet-capabilities?publicKey` | `stellar` | → `WalletCapabilitiesDto`; drives unsupported-wallet UI gating (see above) |
| Link generator — cross-asset preview | `POST /stellar/path-preview` | `stellar` | `{ destAsset, destAmount, sourceAccount... }` → candidate paths + estimated source amounts (strict-receive) |
| Link generator — contract preflight | `POST /stellar/soroban-preflight` | `stellar` | `{ sourceAccount }` → compose-pipeline `health_check` simulation. Gated: `NetworkSafetyGuard` + `TESTNET_CONTRACT_WRITES_FLAG`; 503 `CONTRACT_NOT_CONFIGURED` if `QUICKEX_CONTRACT_ID` unset |
| Link generator — create link | `POST /links/metadata` | `links` (`links.controller.ts`) | `LinkMetadataRequestDto` → `{ success, data: LinkMetadataResponseDto }`; optional `X-API-Key` raises rate limit 20→120 req/min |
| Link generator — CSV bulk | `POST /links/bulk/generate` | `links` (`bulk-payment-links.controller.ts`, prefix `links/bulk`) | `{ links: [...] }` → per-row results |
| Dashboard analytics (`hooks/analyticsApi.ts`) | `GET /analytics/report?publicKey&startDate&endDate&interval` | `analytics` (`analytics.controller.ts`) | → summary + asset distribution + time-series; client falls back to empty data on failure |
| Analytics export | `GET /analytics/export?...&format` | `analytics` | → CSV/PDF stream (tax/accounting report) |
| Marketplace (`hooks/marketplaceApi.ts`) | `GET /marketplace?limit&cursor`, `GET /marketplace/:listingId/detail?viewerPublicKey` | `marketplace` (`marketplace.controller.ts`) | Cursor-paginated listings; detail view is viewer-aware |
| Developer settings (`settings/developer/page.tsx`) | `GET/POST /api-keys`, `GET /api-keys/usage`, `DELETE /api-keys/:id`, `POST /api-keys/:id/rotate` | `api-keys` (`api-keys.controller.ts`) | Key CRUD; create/rotate responses include the plaintext `key` once |
| Webhook management (`webhooks/page.tsx`) | `POST/GET/DELETE /webhooks/:publicKey[/:id]` + `/logs`, `/stats`, `/redeliver`, `/replays`, `/regenerate-secret`, `POST /webhooks/verify-signature` | `notifications` (`webhooks.controller.ts`) | Full webhook family; UI passes an API key header via `apiFetch` |
| Admin — system health (`components/admin/SystemHealth.tsx`) | `GET /health` | `health` (`health.controller.ts`, root-level `@Controller()`) | → `HealthResponseDto` (shallow liveness); backend also serves `GET /ready` and `GET /status` (unused by clients) |
| Admin — feature flags (`components/admin/FeatureFlags.tsx`) | `GET /admin/feature-flags`, `PATCH /admin/feature-flags/:key` | `feature-flags` | Flag list + toggle. ⚠️ Called with **no auth header** — see mismatch #7 |
| Admin — audit logs (`components/admin/AuditLogs.tsx`) | `GET /admin/audit` | `audit` | Audit log rows. ⚠️ Same no-auth-header concern |

## Mobile endpoint map

| Screen / feature | Endpoint | Owning backend module | Request → response summary |
|---|---|---|---|
| Transaction history (`services/transactions.ts`) | `GET /transactions?accountId&limit&cursor&asset` | `transactions` (`transactions.controller.ts`) | → `TransactionResponseDto` (normalized payments via Horizon, cached ~60s); expect 429/502/503 semantics |
| Link creation (`services/link-metadata.ts`, `app/link-generator.tsx`) | `POST /links/metadata` | `links` | Same contract as frontend — paths **match** ✅ |
| Wallet capability discovery (`services/wallet-capabilities.ts`) | `GET /stellar/wallet-capabilities?publicKey` | `stellar` | Same contract as frontend ✅; drives unsupported-wallet gating on escrow confirmation |
| Asset picker (`app/link-generator.tsx`) | `GET /stellar/verified-assets` | `stellar` | Same as frontend ✅ |
| Notification center (`services/in-app-notifications.ts`) | `GET /notifications/in-app?publicKey`, `POST /notifications/in-app/:id/read`, `POST /notifications/in-app/read-all?publicKey` | `notifications` (`notifications.controller.ts`) | List + read-state; client tolerates both a plain array and a Supabase-style list envelope (defensive drift handling) |
| Escrow confirmation (`app/payment-confirmation.tsx` → `hooks/useContractRegistry.ts` → `services/contract-registry.ts`) | ⚠️ `GET /api/contracts/registry` | `contracts` (`contract-registry.controller.ts`) | **BROKEN** — backend serves `GET /contracts/registry` (with ETag/304 support). The `/api` prefix 404s. See mismatch #1 |
| Session bootstrap (`services/session-bootstrap.ts`) | ⚠️ `GET /session/bootstrap` (Bearer = publicKey) | — | **No backend route exists.** Planned/not wired |
| In-app feedback (`services/feedback.ts`) | ⚠️ `POST /feedback` | — | **No backend controller.** Client intentionally degrades to an exportable payload on failure |
| Share receipt (`src/screens/ReceiptScreen.tsx`, `hooks/useShareReceipt.ts`) | `${baseUrl}/tx/:receiptHash` | — | A **web** share URL, not an API call. Note the actual receipts API is `GET /v1/receipts/tx/:txHash` — don't confuse the two |

## Known mismatches & payload drift

Explicitly tracked so contributors don't re-discover them:

1. **Mobile contract registry path is wrong** — `app/mobile/services/contract-registry.ts` calls `/api/contracts/registry`; the backend route is `/contracts/registry` (no global `api` prefix exists). This breaks Escrow registry sync on the payment-confirmation screen. Fix: drop the `/api` prefix (and consider adopting `If-None-Match`/ETag, which the backend already supports).
2. **Mobile `GET /session/bootstrap`** — client is wired
