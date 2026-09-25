# Backend Error Codes

Stable, machine-readable error codes returned by the QuickEx backend. Clients
should branch on `code` (never on the human-readable `message`), which is
considered part of the public API contract.

## Envelope

All error responses share the same shape:

```json
{
  "error": {
    "code": "WALLETCONNECT_SESSION_EXPIRED",
    "message": "WalletConnect session has expired.",
    "details": { "sessionId": "..." },
    "requestId": "..."
  }
}
```

- `code` — stable identifier (see tables below).
- `message` — human-readable, safe to display; never contains secrets or PII.
- `details` — optional structured context (ids, retry hints).
- `requestId` — correlation id, also emitted in structured logs.

## General

| Code | HTTP | Meaning |
| --- | --- | --- |
| `UNAUTHORIZED` | 401 | Missing or invalid credentials. |
| `FORBIDDEN` | 403 | Authenticated but not permitted for this resource. |
| `NOT_FOUND` | 404 | Resource does not exist. |
| `VALIDATION_ERROR` | 400 | Request failed schema/semantic validation. |
| `CONFLICT` | 409 | Duplicate or conflicting operation. |
| `RATE_LIMITED` | 429 | Too many requests; retry after backoff. |
| `DEPENDENCY_UNAVAILABLE` | 503 | Upstream dependency failed; safe to retry. |
| `INTERNAL_ERROR` | 500 | Unexpected server error. |

## WalletConnect session lifecycle

WalletConnect sessions are tracked per user and per chain. Session state
transitions are `pending -> active -> (expired | disconnected)`. Recovery of a
disconnected session must be idempotent: replaying the same recovery request
must not create a second session or duplicate any on-chain operation.

| Code | HTTP | Meaning |
| --- | --- | --- |
| `WALLETCONNECT_SESSION_NOT_FOUND` | 404 | No session exists for the given `sessionId`. |
| `WALLETCONNECT_SESSION_EXPIRED` | 410 | Session existed but has passed its expiry; a new session is required. |
| `WALLETCONNECT_SESSION_DISCONNECTED` | 409 | Session was disconnected; use the recovery endpoint to resume. |
| `WALLETCONNECT_SESSION_ALREADY_ACTIVE` | 409 | A live session already exists for this user/chain; reuse it instead of creating another. |
| `WALLETCONNECT_SESSION_MALFORMED` | 400 | Session payload failed validation (bad topic, chain, or signature). |
| `WALLETCONNECT_SESSION_UNAUTHORIZED` | 403 | Caller does not own the referenced session. |
| `WALLETCONNECT_RECOVERY_DUPLICATE` | 409 | Recovery already applied for this session; the original result is returned. |
| `WALLETCONNECT_RECOVERY_FAILED` | 502 | Relay/bridge dependency failed during recovery; safe to retry with backoff. |
| `WALLETCONNECT_CHAIN_UNSUPPORTED` | 400 | Requested chain is not enabled for WalletConnect. |
| `WALLETCONNECT_FEATURE_DISABLED` | 403 | WalletConnect is feature-gated off for this environment (e.g. mainnet). |

### Recovery semantics

- Recovery requests carry an idempotency key. A repeated key returns the
  original outcome and `WALLETCONNECT_RECOVERY_DUPLICATE` is only surfaced when
  the caller explicitly asks for strict mode.
- Expired sessions are never silently revived; the client must establish a new
  session and re-authorize.
- `WALLETCONNECT_FEATURE_DISABLED` is returned when the environment gate
  (`WALLETCONNECT_ENABLED`) is off, so non-mainnet rollouts fail closed.

### Observability

Every lifecycle transition emits a structured log with `requestId`, `userId`,
`sessionId`, `chain`, `fromState`, `toState`, and `latencyMs`. Metrics:
`walletconnect_session_transitions_total{toState}`,
`walletconnect_recovery_total{outcome}`, and
`walletconnect_recovery_latency_seconds`. No session secrets or wallet
addresses are logged.

## Payments (native and issued assets)

Payment submission is idempotent per `(userId, idempotencyKey)`. Native (XLM)
and issued-asset payments share the same envelope; the asset is identified by
`asset` (`native` or `CODE:ISSUER`). Testnet-only coverage is gated by
`PAYMENTS_TESTNET_ENABLED`; when the gate is off the endpoint fails closed with
`PAYMENTS_FEATURE_DISABLED`.

| Code | HTTP | Meaning |
| --- | --- | --- |
| `PAYMENT_NOT_FOUND` | 404 | No payment exists for the given `paymentId`. |
| `PAYMENT_UNAUTHORIZED` | 403 | Caller does not own the source account or the referenced payment. |
| `PAYMENT_DUPLICATE` | 409 | Idempotency key already applied; the original result is returned. |
| `PAYMENT_EXPIRED` | 410 | Payment intent passed its expiry before submission; re-create the intent. |
| `PAYMENT_MALFORMED` | 400 | Payload failed validation (bad amount, asset, memo, or destination). |
| `PAYMENT_ASSET_UNSUPPORTED` | 400 | Asset is not enabled for payments (unknown code/issuer or not allow-listed). |
| `PAYMENT_INSUFFICIENT_BALANCE` | 422 | Source account cannot cover amount plus fee. |
| `PAYMENT_DEPENDENCY_UNAVAILABLE` | 503 | Horizon/relay dependency failed; safe to retry with backoff. |
| `PAYMENT_SUBMISSION_FAILED` | 502 | Transaction was rejected on-chain; no funds moved, safe to retry. |
| `PAYMENT_FEATURE_DISABLED` | 403 | Payments are feature-gated off for this environment (e.g. mainnet). |

### Payment semantics

- Native and issued-asset payments follow the same state machine:
  `created -> submitted -> (confirmed | failed)`. A `failed` submission never
  moves funds and is safe to retry with the same idempotency key.
- Duplicate submissions with the same idempotency key return the original
  outcome; `PAYMENT_DUPLICATE` is only surfaced in strict mode.
- Expired intents are never silently revived; the client must create a new
  intent and re-authorize.
- `PAYMENT_FEATURE_DISABLED` is returned when `PAYMENTS_TESTNET_ENABLED` is off,
  so mainnet rollouts fail closed until coverage is promoted.

### Observability

Every payment transition emits a structured log with `requestId`, `userId`,
`paymentId`, `asset`, `fromState`, `toState`, and `latencyMs`. Metrics:
`payments_total{asset,outcome}` and `payments_latency_seconds{asset}`. No
secrets, signing keys, or full wallet addresses are logged.
