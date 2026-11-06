# Executable governance and access rules

## Decision model

The policy engine in `src/core/policy.ts` evaluates the active `Policy` object. It returns an `AccessEvaluation` containing the overall `PERMIT`, `DENY`, or `PENDING` decision, individual `RuleResult` values, and a readable explanation.

Each result includes a stable rule ID, evaluated policy version, input attributes, expected condition, actual value, result, explanation, and decision contribution. This is the same data that the execution inspector displays; the interface does not invent an independent success state.

The combination rule is **deny overrides**:

1. Any applicable result contributing `DENY` makes the evaluation `DENY`.
2. If nothing denies but a required obligation is pending, the evaluation is `PENDING`.
3. Otherwise the evaluated checks yield `PERMIT`.

`PERMIT` at an early preview means eligible under the conditions evaluated at that point. It does not mean the medical content has been delivered. Manual approvals, finality, capability checks, and content integrity still have their own gates.

## Mandatory checks

These checks cannot be switched off through an ordinary governance proposal.

| Rule | Inputs and condition | Failure behavior |
| --- | --- | --- |
| `AUTH-001` | Successful modeled challenge, correctly labeled fingerprint, nonempty unique request nonce, simulation age from 0 through 30 minutes | Deny; hospital approval cannot override it |
| `DID-001` | Active subject-patient DID entry, known public key label, and recognized requester bound to the correct actor type | Deny |
| `CRED-001` | Required subject-patient credential exists, issuer is a known hospital, expiry is later than the simulation clock, not revoked, assurance value is well formed | Deny |
| `OWN-001` | Nonempty, known, nonduplicated record scope; every record belongs to the represented patient; patient self-access uses that patient actor | Deny the entire request scope |
| `RBAC-001` | Processing role is `RECORDS_OFFICER`; requesting patient or clinician actor is recognized | Deny |
| `INTEGRITY-001` | Retrieved candidate content matches the retained record hash before delivery | Deny release on mismatch; earlier evidence remains intact |

Before retrieval, `INTEGRITY-001` is explicitly not yet evaluated. The absence of a failing hash check at request creation is not a claim that the record bytes were already verified.

The local identity mechanism is an educational model. `AUTH-001` does not turn its public-label SHA-256 fingerprint into a cryptographic signature. `CRED-001` checks the subject-patient fixture credential. Dr. Khan is a recognized simulated clinician actor, not a fully verified live professional-license credential.

Other security properties are enforced structurally by the workflow rather than exposed as editable policy flags: every significant decision is audited, duplicate eligible votes do not count twice, an unapproved or stale proposal cannot activate, missing finality does not authorize release, and a used capability cannot be redeemed again.

## Operational governance settings

The following fields are configurable through a proposal and approval process. Saving an editor value does not immediately change the active rules.

| Setting | Policy field | Runtime rule | Intended effect |
| --- | --- | --- | --- |
| Minimum identity assurance | `minAssurance` | `GOV-ASSURANCE` | Compares the subject patient's supplied Level 1–3 evidence with the active minimum |
| Hospital manual review | `manualReview` | `REVIEW-001` | Requires records-officer approval before release when enabled |
| Sensitive-record approval threshold | `sensitiveApprovals` | `MULTISIG-001` | Requires 0–3 additional distinct committee approvals for a sensitive scope; 0 leaves the active ordinary-review requirement in place |
| Clinician consent requirement | `clinicianConsent` | `CONSENT-001` | Requires a current scoped grant in the normal clinician path |
| Clinician active shift | `requireOnShift` | `ABAC-001` | Requires the clinician to be on shift when enabled |
| Treatment relationship | `requireRelationship` | `ABAC-001` | Requires a modeled relationship with the patient when enabled |
| Cross-hospital release | `crossHospital` | `GOV-CROSS-HOSPITAL` | Controls requests for records held by another hospital |
| Capability lifetime | `tokenMinutes` | Token issue and `TOKEN-EXPIRY` | Sets the lifetime of newly issued capabilities; allowed range is 1–60 minutes |

The initial assurance minimum is Level 2, ordinary review is required, the sensitive threshold is two distinct approvals, and capability lifetime is ten minutes. Refer to the live Policy Console for all current values and the active version.

An approved setting that waives clinician consent is a **demo policy exception**, not a claim of a lawful healthcare exception. The model preserves an explicit matching revocation as a denial when no usable re-grant exists. The consent console and runtime explanation expose this behavior rather than hiding it.

An explicit hospital rejection remains a denial even if manual review is otherwise optional. Configurable review requirements do not transform a recorded rejection into approval.

## Patient self-access and clinician access

### Patient self-access

Ayesha's own-record request uses identity, credential, ownership, role, assurance, hospital-scope, and applicable approval checks. Clinician shift, treatment relationship, and third-party consent are `NOT_APPLICABLE` for this path. There is no self-consent grant to create.

### Clinician access

Dr. Khan's request identifies both the clinician and the represented patient. Every requested record must belong to that patient. The clinician is subject to the active duty-status and treatment-relationship rules. The demo recognizes `TREATMENT` and `RESEARCH` as distinct purposes.

When consent is required, one current unrevoked grant must match the patient, clinician, exact purpose, and all requested record categories. An ECG grant does not authorize imaging. Treatment consent does not authorize research. Expired or revoked permission cannot satisfy the check.

Granting consent does not bypass identity, context, approval, finality, or integrity conditions. Revocation affects future retrieval through the simulator. It cannot erase copies that were previously downloaded.

## Review and sensitive approvals

`REVIEW-001` belongs to the hospital records-officer workflow. It is a pending obligation only after mandatory rules are otherwise satisfied. Following a mandatory failure, the inspector explains that review cannot rescue the request.

`MULTISIG-001` is an additional obligation for specially classified sensitive records. Eligible release approvers are the CMIO, Hospital Privacy Officer, and Hospital Compliance Officer. Distinct actor IDs determine the count. The ordinary records-officer review is separate and does not substitute for a committee signature.

The configurable range is **0–3**, with a default of **2**. A committee-approved value of 0 means no additional sensitive-record committee signatures; with `manualReview=true`, an ordinary hospital review is then sufficient once the other checks pass. Changing that value from 0 to 2 implements the brief's additional sensitive-record example. It does not disable authentication, ownership, auditing, or any other mandatory control.

These approval attestations are simulated actor actions. The model enforces distinctness and eligibility; it does not claim that clicking a button is a real private-key signature or that three independent people have authenticated.

## Policy-change governance

The governance committee has three members: CMIO, Privacy Officer, and Compliance Officer. A proposal requires two distinct valid approvals by default.

The state machine captures the proposed rule, old value, new value, justification, proposer, base policy version, and expiry. Justifications must have at least eight characters; proposals expire after 30 simulated minutes. A first vote leaves the active policy unchanged. Once the approval threshold is reached, the policy-change event still requires simulated validator commitment before activation.

The demo uses a conservative veto rule: any recorded committee **REJECT** closes the proposal as rejected. The two-of-three approval rule applies when no member has rejected. Rejection, expiry, or an invalid/stale base version blocks activation. An unauthorized actor cannot make a valid committee vote; repeated votes are not counted as additional people. A successful activation creates the next policy version and appends its evidence rather than changing old audit entries.

Committee approval and network finality have different purposes:

| Mechanism | Participants | Condition | What it authorizes |
| --- | --- | --- | --- |
| Policy committee | Three named governance roles | Two distinct eligible approvals | The proposed policy change may proceed toward commitment |
| Sensitive-record approval | Eligible governance roles | Active sensitive-record threshold | An additional release obligation is satisfied |
| Consortium consensus | Four hospital validators | Model's phase conditions and three matching commits | The event can be marked committed |

## Dynamic assurance experiment

With Ayesha at Level 2 and the active minimum at Level 2, `GOV-ASSURANCE` passes. Proposing Level 3 or recording only one committee vote does not change that result.

After the approved change is committed and the next policy becomes active, a fresh Level 2 request fails `GOV-ASSURANCE`. The failure records the supplied and required values. Upgrading the demo evidence to Level 3 makes a fresh otherwise-valid request eligible again. This change comes from evaluating configuration, not switching a prewritten success message.

Old audit events keep the version used at their event time. Pending access is evaluated again before release against the current policy, so an earlier preview cannot bypass a newly active requirement.

## Capability issue and redemption

`issueCapabilityToken()` requires an otherwise eligible, committed request that has no previously issued token. It verifies a matching committed `MEDICAL_HISTORY_ACCESS_APPROVED` event with the exact request, record hashes, and current policy. A draft, denied, pending-finality, or already-tokenized request cannot mint another token.

`validateCapabilityToken()` performs these checks:

| Rule | Condition |
| --- | --- |
| `TOKEN-BINDING` | The presented local token matches the issued object and its request, requester, and exact record scope |
| `TOKEN-EXPIRY` | `issuedAt ≤ simulationClock < expiresAt`, with a sensible issuance window |
| `TOKEN-REPLAY` | Nonempty unique nonce; token has not already been used |
| `TOKEN-REVOCATION` | Token has not been revoked |
| `TOKEN-AUTHORITY` | A matching committed permission event exists and the request is in an eligible unreleased status |
| Current access evaluation | All current identity, policy, consent, and approval conditions still pass |

Validation does not itself consume the token. The workflow serializes redemption and consumes it as part of retrieval, so two presentation actions cannot create two successful uses of one capability. Candidate bytes still have to pass integrity verification before delivery.

An issued token keeps its original expiry. A later lifetime-policy change affects new issuance; it does not rewrite the old token timestamp. A previously issued capability is still subject to current policy and the fixed request-authentication freshness requirement. Thus an unexpired token is necessary but not sufficient for access.

## Readable pseudocode

```text
evaluate(request, activePolicy):
    deny if authentication, DID, credential, ownership, or role fails
    deny if assurance or hospital-scope rules fail
    if clinician:
        evaluate shift, relationship, purpose, and applicable consent
    deny if any mandatory rule fails
    wait for required review and sensitive-record approvals
    propose authorization; require modeled validator commitment
    issue one scoped, expiring capability
    at retrieval:
        verify capability and re-evaluate current access policy
        consume the one-time capability
        compare candidate record digests with the retained anchors
        deliver only after all required checks pass
    preserve decision and policy-version evidence
```

The pseudocode summarizes the tested TypeScript functions; arbitrary JavaScript typed into the policy editor is never evaluated.
