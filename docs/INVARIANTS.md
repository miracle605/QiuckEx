Core Financial Invariants
INV-01: Conservation of Value

The sum of all balances (escrow + merchant + customer + fees) MUST equalthe total value deposited into the system. No value is created or destroyedoutside of explicit protocol actions.
INV-02: No Unauthorized Withdrawals

Only the designated recipient (merchant on fulfill, customer on refund,arbiter on dispute resolution) may claim payment funds. No third partycan withdraw funds from an escrow they are not a party to.
INV-03: No Overpayment

The total amount released from a payment MUST NOT exceed the originaldeposited amount plus any permitted fee adjustments. Each payment releasesat most its principal.
INV-04: No Double-Settlement

A payment can transition to a terminal state (Fulfilled, Refunded,DisputeResolved) exactly once. No payment can be fulfilled AND refunded,or settled twice.
State Machine Invariants
INV-05: Valid State Transitions Only

The payment state machine only permits:  Created → Funded → Fulfilled  Created → Funded → Disputed → DisputeResolved  Created → Funded → Refunded (after expiry)  Created → Expired (if never funded)

No backward or cross-branch transitions are valid.
INV-06: Expiry Monotonicity

A payment whose expiry timestamp has passed cannot be fulfilled. It canonly be refunded or disputed (if already in dispute).
INV-07: Nonce Uniqueness

No two payments can share the same (creator, nonce) pair. Replay of apreviously consumed nonce MUST be rejected.
INV-08: Authorization Consistency

The actor performing a transition MUST be authorized:

    Only creator can fund
    Only merchant can fulfill
    Only customer can request refund
    Only designated arbiter can resolve dispute

Edge-Case Invariants
INV-09: Zero-Amount Payment

Zero-amount payments follow the same state machine but MUST NOT resultin any token transfers.
INV-10: Fee Ceiling

Protocol fees collected per payment MUST NOT exceed the configuredmaximum fee percentage of the payment amount.
Security Review Invariants
INV-11: Security Review Authorization

Only an actor holding the security-review commissioner role may commissiona third-party smart-contract security review. Unauthorized commissionattempts MUST be rejected with a stable error and MUST NOT create ormutate any review record.
INV-12: Security Review Idempotency

Commissioning a security review MUST be idempotent per (contract, commit,reviewer) tuple. A duplicate commission request MUST return the existingreview record unchanged rather than creating a second review or resettingits status.
INV-13: Security Review Expiry

A commissioned security review MUST carry an explicit expiry. Once expired,a review MUST NOT be reported as valid or current; it MUST be surfaced asexpired and MUST NOT gate mainnet enablement.
INV-14: Security Review Feature Gating

Security-review commissioning and tracking MUST be feature-gated. Where thereview capability is not ready for mainnet, the gate MUST default todisabled and the capability MUST fail closed with a stable error ratherthan silently permitting unreviewed contracts.
INV-15: Security Review Dependency Failure

When the third-party review dependency is unavailable, commissioning MUSTfail closed with a stable error and MUST NOT record a partial or optimisticreview state. Retries MUST be safe and MUST NOT produce duplicate reviews.
Wallet Capability Invariants
INV-16: Wallet Capability Discovery

Wallet capabilities (supported networks, signing methods, and requiredfeatures) MUST be discovered from the wallet itself rather than assumed.A capability that cannot be discovered MUST be treated as unsupported.
INV-17: Unsupported-Wallet Fail-Closed

When a wallet does not advertise a capability required for an operation, theoperation MUST fail closed with a stable, user-facing error. The system MUSTNOT silently degrade, substitute a different signer, or proceed with apartially supported wallet.
INV-18: Self-Custody Preservation

Wallet capability discovery and unsupported-wallet handling MUST NOT requireor request private keys, seed phrases, or any secret material. Signing MUSTremain delegated to the wallet; the system only inspects advertisedcapabilities.
INV-19: Wallet Capability Feature Gating

Wallet capability discovery MUST be feature-gated. Where discovery is notready for mainnet, the gate MUST default to disabled and unsupported walletsMUST be rejected with a stable error rather than permitted through.
INV-20: Wallet Capability Dependency Failure

When the wallet capability discovery dependency is unavailable or returns amalformed response, the operation MUST fail closed with a stable error andMUST NOT cache or assume a capability. Retries MUST be safe and idempotent.
