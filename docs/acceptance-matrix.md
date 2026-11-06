# Functional acceptance and automated coverage

This matrix maps the implemented scenario fixtures and test assertions to the assignment. It describes **automated logic coverage**. It does not by itself claim that a browser walkthrough, screenshot inspection, fullscreen interaction, or download was verified.

The source of truth for scenario names, initial conditions, and guidance is [`src/core/scenarios.ts`](../src/core/scenarios.ts). The tests are [`tests/simulator.test.ts`](../tests/simulator.test.ts) and [`tests/domain.test.ts`](../tests/domain.test.ts).

## Run the checks

From the project root after installing dependencies with `npm ci`:

```bash
npm test
npm run typecheck
npm run build
```

Vitest prints the actual current PASS/FAIL result and test totals. These totals can change as regression cases are added; the named tests below make the coverage traceable without relying on a stale count. `npm run build` also performs TypeScript compilation before bundling the static application.

## The fifteen scenario fixtures

In the table, **S** means `tests/simulator.test.ts`; **D** means `tests/domain.test.ts`. Parameterized test names include the scenario ID passed to the fixture loader.

| # | Scenario ID | Required observable result | Automated evidence in source |
| --- | --- | --- | --- |
| 1 | `own-lab` | Own lab report reaches `DELIVERED` only after ordinary review, matching finality, single-use token redemption, and SHA-256 verification | S: `delivers an ordinary self-access request only after review, consensus, one-use token, and integrity` checks the 23 stages, delivered scope, used token, committed decision, and verified chain |
| 2 | `wrong-owner` | `DENIED` by `OWN-001`; no token or record disclosure; an officer cannot override it | S parameter: `denies wrong-owner and records a denial without releasing records`; D: `denies another patient’s records even after the officer presses approve` |
| 3 | `bad-identity` | `DENIED` by `AUTH-001`; no release after failed challenge | S parameter: `denies bad-identity and records a denial without releasing records`; D: `denies authentication failure despite sufficient review and signatures` |
| 4 | `revoked-credential` | `DENIED` by `CRED-001`; an active DID does not rescue a revoked required credential | S parameter: `denies revoked-credential and records a denial without releasing records`; D: `denies revoked, expired, and untrusted credentials` also covers expiry and issuer trust |
| 5 | `bad-role` | `DENIED` by `RBAC-001` when the processing officer is a receptionist | S parameter: `denies bad-role and records a denial without releasing records`; D: `denies empty or unknown record scopes and unauthorized processing roles` |
| 6 | `clinician-ecg` | Dr. Khan receives the exact ECG scope when consent, purpose, context, review, and later gates pass | S: `permits a clinician ECG request with exact valid consent and context`; D: `permits a clinician ECG request only with matching scope, purpose, and context` |
| 7 | `consent-scope` | MRI/`IMAGING` outside the LAB/ECG grant is denied by `CONSENT-001` | S parameter: `denies consent-scope and records a denial without releasing records`; S: `rejects the wrong consent purpose and an expired grant` covers related attribute mismatches |
| 8 | `consent-revoked` | Subsequent clinician access is denied; previously delivered copies remain represented as delivered | S parameter: `denies consent-revoked and records a denial without releasing records`; S: `revocation affects subsequent requests without erasing a prior downloaded copy` |
| 9 | `dynamic-governance` | A proposal and one vote leave the active policy unchanged; two votes still need commitment; activated Level 3 minimum denies Level 2, and new Level 3 evidence restores eligibility | S: `a proposal and one vote have no effect; two distinct votes still need finalized commitment`; S: `activated assurance rule changes real decisions; Level 3 evidence restores eligibility for a new request` also asserts historical audit/version preservation |
| 10 | `sensitive-approval` | Ordinary review plus one committee approval remains pending; two distinct eligible additional approvals allow continuation | S: `holds sensitive release for two distinct committee approvals` rejects duplicate and unauthorized approvals; D: `enforces distinct sensitive-record approvals and reports pending obligations` |
| 11 | `tampered-record` | The isolated modified copy fails `INTEGRITY-001`; original record and earlier permission block are unchanged; a denial can be appended | S: `tampered vault data fails real SHA-256 verification without modifying its earlier permission block`; D: `detects a changed synthetic lab value without mutating the original` |
| 12 | `one-offline` | H1, H2, and H4 can satisfy the fixed quorum while H3 is offline; valid access can complete | S: `finalizes with one offline validator but cannot finalize with two; recovers after explicit restoration`; D: `progresses through four inspectable phases and finalizes with one offline validator` |
| 13 | `two-offline` | Fewer than three matching validators leaves `PENDING_FINALITY`; no authorization block or token; explicit node restoration allows retry | Same combined S test as scenario 12; D: `cannot finalize when two validators are offline` |
| 14 | `expired-token` | At or after token expiry, redemption fails `TOKEN-EXPIRY`; no medical content is disclosed | S: `blocks expired capabilities at the exact boundary and keeps the original authorization evidence`; D: `rejects expired and reused capabilities at the vault gate` |
| 15 | `replay-token` | First redemption may succeed; another use of the consumed nonce is denied without erasing the first release | S: `serializes simultaneous redemption calls so only one consumes a token or releases records` asserts one token-consumption event, one release, and a replay-denial event; D: `rejects expired and reused capabilities at the vault gate` |

The fixture test `has every required inspectable stage and all fifteen stable scenario IDs` also asserts exactly the 23 numbered stage definitions and fifteen unique scenario identifiers, with guidance and expected outcomes.

## Acceptance obligations beyond the scenario names

| Requirement | Evidence |
| --- | --- |
| Patient and hospital share one queue; separate requests retain independent progress | S: `places a submitted request into the shared queue and resumes a second queued request independently` |
| Self-access does not need a patient consent grant to themselves | S: `does not require a patient to create a self-consent grant` |
| Nonce replay and stale authentication fail | D: `denies replayed request nonces and stale authentication evidence` |
| Changing authenticated request contents cannot retain the earlier favorable result | S: `detects a changed request payload after authentication rather than trusting an earlier challenge flag` |
| Unapproved proposals and one committee vote do not activate policy | D: `keeps the active policy unchanged after proposal creation and one vote`; S governance activation sequence |
| Two approvals need distinct authorized members and are bound to approved terms | D: `rejects duplicate, unauthorized, and proposer votes`; S: `does not reuse committee approvals after the proposal terms are altered` |
| Rejected, expired, stale, or insufficient-quorum policy changes do not activate | S: `does not activate rejected, expired, stale, or insufficient-quorum proposals`; S: `cannot cross the proposal expiry boundary in the activation tick` |
| The editor cannot disable invariants or execute arbitrary code | D: `rejects arbitrary JavaScript, security-invariant edits and out-of-range thresholds` |
| Ordinary-review-only sensitive baseline and added signatures are both real configurations | D: `supports ordinary review alone before a governed extra-signature requirement`; default threshold remains 2, editable range is 0–3 |
| A ten-to-two-minute policy change affects new token issuance only | S: `uses the governed token lifetime for new tokens without rewriting older tokens`; D: `applies a changed token lifetime to new issuance, not old objects` |
| Pending access is rechecked after a new policy becomes active | S: `rechecks a pending request against new rules even after its original consensus finalized`; S: `preserves a previously committed authorization if a new policy denies token issuance` |
| Newly required late approvals resume the existing request without inventing finality or replaying a token | S: `resumes newly required manual review before retrieval with the same unused token`; S: `holds a staged sensitive report when threshold increases, then resumes delivery without token replay` |
| Consent is checked after commitment and again before actual disclosure | S: `rechecks revoked consent after commitment and before retrieval`; S: `blocks late consent revocation after staging but before actual disclosure` |
| Faulty nodes and duplicate validator identities do not create quorum | S: `faulty validators do not contribute matching votes`; D: `excludes rejecting validators and never counts duplicate validator identities` |
| SHA-256 is the real digest primitive | D: `matches the standard SHA-256 known-answer vector`; D canonicalization and simulated-signature-label tests |
| Valid Merkle proofs pass and altered leaves/siblings fail | D: `verifies all four Merkle paths and rejects changed leaf and sibling hashes`; odd/single-leaf cases are tested separately |
| Altered blocks and broken pointers fail verification | D: `detects a modified block copy and preserves the original ledger`; D: `detects broken hash pointers even when an earlier copied block is rehashed` |
| History inspection does not duplicate committed state | S: `history inspection, visual replay, and repeated completed next actions never duplicate committed state` also checks a clean scenario reload |
| Ledger excludes seeded names and clinical contents, and the report-tree anchor exists | S: `stores only metadata on-chain and keeps all ledger hashes verifiable` |

## Interpreting test scope

These tests exercise the domain and state machine. They do not prove production security, full PBFT correctness, clinical accuracy, regulatory compliance, or protection from a person controlling the browser. Those boundaries are explained in `simulation-limitations.md`.

Browser validation is a separate activity: open the running app, follow the Patient/Hospital workflow, inspect the three-region theater, test governance controls, verify readable projection and responsive layout, and exercise exports. Record observed browser results separately rather than inferring them from Vitest success.
