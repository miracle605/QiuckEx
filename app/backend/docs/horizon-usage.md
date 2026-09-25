# Horizon Usage Guidelines

This document outlines how to fetch Stellar transaction data via Horizon in the QuickEx backend.

## Overview

The `HorizonService` provides a centralized way to interact with the Stellar Horizon API. It uses the `stellar-sdk` and implements in-memory caching to reduce latency and avoid rate limits.

## Fetching Payments

To get reliable amount and asset data, we fetch **operations** of type `payment`, `path_payment_strict_receive`, and `path_payment_strict_send` rather than raw transactions.

### Endpoint

`GET /transactions`

### Query Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `accountId` | string | Yes | Stellar public key (G...) |
| `asset` | string | No | Filter by asset (`XLM` or `CODE:ISSUER`) |
| `limit` | number | No | Max items to return (1-200, default 20) |
| `cursor` | string | No | Pagination token (`paging_token`) |

## Caching

Results are cached for **60 seconds** in memory using an LRU cache. The cache key includes the network, account ID, asset filter, limit, and cursor.

## Rate Limiting

If Horizon returns a `429 Too Many Requests` error, the backend will return a `503 Service Unavailable` response. Clients should implement their own backoff strategy and avoid aggressive polling.

## Quote Preflight: Path Finding and Liquidity Checks

Quote preflight feasibility is resolved against Horizon rather than local stubs. The preflight
answers two questions for a requested `source -> destination` asset pair: does a path exist, and
is there enough liquidity to fill the requested amount.

### Endpoints

| Purpose | Endpoint | Notes |
| :--- | :--- | :--- |
| Path discovery | `GET /paths/strict-send` | Used when the source amount is fixed. |
| Path discovery | `GET /paths/strict-receive` | Used when the destination amount is fixed. |
| Liquidity / order book | `GET /order_book` | Depth check for the resolved path's first hop. |

### Query Parameters (`/paths/*`)

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `source_asset_type` | string | Yes | `native`, `credit_alphanum4`, or `credit_alphanum12`. |
| `source_asset_code` | string | Conditional | Required for non-native source assets. |
| `source_asset_issuer` | string | Conditional | Required for non-native source assets. |
| `source_amount` | string | Conditional | Required for `strict-send`. |
| `destination_asset_type` | string | Yes | `native`, `credit_alphanum4`, or `credit_alphanum12`. |
| `destination_asset_code` | string | Conditional | Required for non-native destination assets. |
| `destination_asset_issuer` | string | Conditional | Required for non-native destination assets. |
| `destination_amount` | string | Conditional | Required for `strict-receive`. |
| `destination_account` | string | No | Restricts paths to those deliverable to the account. |

### Feasibility Result

Preflight returns a stable, discriminated result so callers never branch on raw Horizon payloads:

- `feasible` — at least one path was returned and the best path's depth covers the requested amount.
- `no_path` — Horizon returned an empty path set for the pair.
- `insufficient_liquidity` — a path exists but the order book depth is below the requested amount.
- `dependency_unavailable` — Horizon timed out, returned `429`, or returned `5xx`.

Each result carries the resolved path (asset hops and amounts) when available, plus the Horizon
`paging_token` used so the outcome can be correlated with logs.

### Caching and Idempotency

Preflight results are cached for **15 seconds** keyed by network, asset pair, amount, and direction.
The cache is advisory only: a cached `feasible` result is re-validated before a quote is committed,
and callers must treat preflight as idempotent — repeating the same request within the TTL returns
the same result without additional Horizon calls.

### Failure Handling

| Condition | Behavior |
| :--- | :--- |
| Malformed asset or amount | Reject before calling Horizon with a validation error. |
| Expired quote | Re-run preflight; do not reuse a stale feasibility result. |
| Duplicate request | Served from cache within the TTL; no duplicate Horizon calls. |
| Horizon `429` / `5xx` / timeout | Return `dependency_unavailable`; do not fail the quote silently. |

### Feature Gating

Path-based preflight is enabled per network. It is **on for testnet** and **off for mainnet** until
the liquidity thresholds and path selection are validated in production-like conditions. When the
flag is off, preflight returns `dependency_unavailable` rather than falling back to a stub, so
callers cannot mistake an unvalidated result for a real one.

### Observability

Each preflight emits a structured log with the network, asset pair, amount, direction, outcome,
Horizon latency, and cache hit/miss. Metrics track preflight count by outcome and a latency
histogram. Logs never include account secrets or full account IDs — only the asset pair and the
Horizon `paging_token`.

## Example Usage

```typescript
// In a controller or service
const transactions = await this.horizonService.getPayments(
  'GD...',
  'USDC:GA...',
  20,
  '123456789'
);
```

## Best Practices

1.  **Always use the operations endpoint** for payment data.
2.  **Use pagination** instead of high limits to avoid long response times.
3.  **Validate account IDs** using `StrKey.isValidEd25519PublicKey`.
4.  **Resolve quote feasibility via `/paths/*` and `/order_book`**, never via local stubs.
5.  **Treat preflight as advisory** — re-validate before committing a quote.
