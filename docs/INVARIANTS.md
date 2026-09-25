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
WalletConnect Session Invariants
INV-11: Session Custody Preservation

A WalletConnect session MUST NOT hold, derive, or transmit private keymaterial. Session state is limited to the pairing topic, the peer publickey, and the negotiated chain/account identifiers. Disconnecting orrecovering a session MUST NOT alter custody: the user's keys remain intheir wallet at all times.
INV-12: Session-Bound Authorization

Every state transition that requires a wallet signature (fund, fulfill,refund, dispute resolution) MUST be authorized by a currently activeWalletConnect session whose peer public key matches the account thatsigns the transaction. A signature produced under a session that hasbeen disconnected or expired MUST be rejected.
INV-13: Session Idempotency

Reconnecting or recovering a WalletConnect session MUST NOT replay orduplicate any previously submitted operation. Each operation carries aunique request id; a repeated request id within the same session MUSTreturn the original result rather than re-executing the transition.
INV-14: Session Expiry Monotonicity

Once a WalletConnect session has expired or been disconnected, it MUSTNOT be treated as active again without a fresh pairing handshake. A stalerecovery attempt against an expired session MUST fail with a stableerror and MUST NOT silently re-establish trust.
INV-15: Disconnected-Session Recovery Safety

Recovery of a disconnected session MUST be explicit and user-initiated.It MUST NOT auto-submit pending operations on the user's behalf, and itMUST surface the pending-operation set so the user can re-confirm eachaction. Recovery MUST preserve INV-04 (no double-settlement) byreconciling against on-chain state before any resubmission.
