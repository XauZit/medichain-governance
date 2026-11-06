# How to Present Assignment 1 for an Excellent Grade

## Prepare the demonstration

Open MediChain in a modern desktop browser, maximize the window, and enter **Classroom Demonstration** mode when projecting. Keep the simulation at a readable playback speed. Manual **Next Step** is useful when the instructor asks a question; **Auto Play** advances the same workflow.

Start with clean demo data. All names, hospitals, identifiers, and medical summaries are fictional. The patient is **Ayesha Ahmed**, her main provider is **Crescent General Hospital**, and the consortium contains four hospital validators. Point to the visible **Educational Blockchain Simulation — No Real Network** indicator before beginning.

Suggested timing: 12–15 minutes for the main presentation, followed by questions. Allow more time if the instructor wants to inspect every one of the 23 workflow stages.

## Chapter 1 — The healthcare problem

**Show:** Patient identity, the history summary, and the five-layer architecture.

**Say:**

> Ayesha needs a copy of her medical history. The hospital must establish who is asking, whether the records belong to the stated patient, and whether the current release rules have been satisfied. We also want an inspectable record of the decision. MediChain makes each of those checks visible.

Explain the five layers: application portals, governance rules, identity evidence, ledger and consensus, and the off-chain hospital vault. The ledger records evidence about authorization and integrity; the vault holds the fictional medical content.

**Why a consortium?** The teaching scenario involves several known hospitals that need shared evidence and agreed decision rules. Their membership is controlled. It does not need anonymous cryptocurrency miners or a market token. Whether a real project needs a distributed ledger would still depend on whether independent institutions actually need shared control; one hospital with a well-governed database may be enough for a simpler problem.

## Chapter 2 — A patient requests medical history

**Show:** Load the verified patient / own lab-report scenario. Select the lab report and start the workflow. Pause around request creation and request authentication.

**Say:**

> Ayesha selects a precise record scope. The application creates one request, binds it to her demo identity, and gives it a nonce. The patient and hospital see the same request object; these are two views of one state.

Switch to the Hospital portal to show that the request has arrived in its queue. Switch back to the Patient portal to show the matching request identifier and status.

Distinguish the real SHA-256 digest from the simulated signature evidence. A digest detects a content change; it does not prove the patient's identity by itself.

## Chapter 3 — Hospital verification

**Show:** Advance through DID, credential, ownership, RBAC, and ABAC checks. Select an individual check to inspect its input, condition, outcome, and explanation.

**Say:**

> Identity and authorization are different questions. DID verification models control of a registered identifier. The credential supplies demo claims from an issuer. Ownership checks that the requested records belong to the stated patient. RBAC checks whether this officer has the permitted role. ABAC checks contextual conditions such as record sensitivity, the clinician's relationship to the patient, and duty status.

In the self-access path, Ayesha does not create a consent grant to herself. In a third-party path, the clinician must satisfy the additional requirements that apply to the clinician's purpose and requested scope.

**Question to invite:** “If a hospital officer presses Approve after an ownership failure, what should happen?” Demonstrate that mandatory denial is preserved.

## Chapter 4 — Governance smart contracts

**Show:** The active policy version and rule-by-rule execution inspector. Pause at hospital review.

**Say:**

> These are executable TypeScript policy rules in a browser simulation. Each rule produces an input, an expected condition, a result, and a reason. Required failures use deny-overrides semantics. An ordinary release also needs the configured hospital review. That review completes an obligation; it cannot erase a failed mandatory check.

Approve the otherwise-eligible lab request using the Hospital Records Officer. Explain that the request is now eligible for a release authorization event, but the patient has not yet received the report. Consensus and the later retrieval checks remain.

For a sensitive record, show that the required distinct approvals leave it **Pending** until the threshold is met. A second click by the same actor is not a second approval.

## Chapter 5 — Permissioned consensus

**Show:** Four validator hospitals and the pre-prepare, prepare, commit, and finalization visualization.

**Say:**

> H1 proposes the authorization event. The other hospitals examine matching proposal evidence. Our simplified PBFT model uses four validators, a one-fault budget, and a three-validator commit threshold. The model distinguishes the proposal, preparation, commitment, and finality steps.

Explain the arithmetic: `n = 4`, `f = 1`, `3f + 1 = 4`, and `2f + 1 = 3`. The fault budget is a configured model assumption, not a quantity recalculated downward when nodes are offline.

Load the one-validator-offline experiment when ready: three available validators can satisfy the model. With two validators offline, two cannot satisfy three; the authorization remains **Pending Finality / Unavailable**, and the vault does not release the report.

State the protocol limit: real PBFT also depends on authenticated messages, per-replica prepared and commit certificates, view changes, network assumptions, and other machinery. The animated nodes are local objects in one browser, not independently running replicas.

## Chapter 6 — Integrity and release

**Show:** The committed block metadata, short-lived capability token, off-chain vault, record hash comparison, and approved record view.

**Say:**

> The ledger stores the authorization event and integrity evidence. Medical content stays in the hospital vault. A capability token restricts which record can be retrieved, by whom, and for how long. The retrieval path checks the current authorization conditions and token state, then compares the candidate record's SHA-256 digest with the anchored digest before presenting verified content.

Open the approved report and demonstrate its download. Show that its clinical content is absent from the ledger block. Explain that the authorization decision and the actual successful release are different events: later token expiry, revocation, or tampering can still stop release.

In the Merkle experiment, select one of four report hashes and inspect its sibling path. Verify the valid proof, then corrupt the proof or selected leaf and verify again. The computed root no longer matches the trusted root. Sibling hashes allow this integrity check without including the other reports' plaintext contents; this is not a claim that all metadata is anonymous.

## Chapter 7 — Demonstrate Dynamic Governance

This is the central assignment demonstration. Preserve the current policy and audit history between the three requests below. Do not use a full demo reset in the middle.

1. Complete a baseline request for Ayesha's ordinary lab report with verified assurance **Level 2** under minimum assurance **Level 2**. It is eligible after hospital review and the remaining release stages.
2. Open the Governance Console. Select **Minimum Identity Assurance** and propose changing the value from **2** to **3**. Enter a justification such as “Require stronger demo identity evidence for history release.”
3. Inspect the preview. The preview shows how the same inputs would be evaluated under the candidate policy; it does not activate the candidate.
4. Submit the proposal. Point to the captured base policy version and old-versus-new values.
5. Record the **first** committee approval. Pause. Show **1 of 2 required approvals** and that the active policy is still version 1.
6. Record approval from a **different** committee member. Explain that the threshold authorizes the change to proceed to consortium commitment; it is not yet permission to fabricate a committed block.
7. Advance the policy-change consensus and activation process. Confirm that the new active policy requires Level 3.
8. Submit a **new** ordinary lab request with Ayesha still at Level 2. The rule engine now denies it. Inspect the exact assurance rule: actual value 2; required value 3; result FAIL.
9. Upgrade the demo identity-assurance evidence to Level 3 and submit another new request. With all other conditions satisfied, it becomes eligible again.
10. Inspect the audit history. The earlier decision retains its original policy version; the later decisions identify the new version.

| Demonstration | Identity evidence | Active minimum | Expected rule outcome |
| --- | --- | --- | --- |
| Initial request | Level 2 | Level 2 | PASS |
| After approved and committed policy change | Level 2 | Level 3 | FAIL |
| After demo evidence upgrade | Level 3 | Level 3 | PASS |

**Say:**

> The labels did not cause the change. The same policy function read a different, committee-approved active configuration. Previous evidence is preserved. Pending access is checked again before release, so an old favorable preview is not an authorization bypass.

### Additional live configuration A — Sensitive-record approval

The default demonstration already requires two additional sensitive-record approvals. To demonstrate the precise ordinary-review-only → two-signature change requested in the brief:

1. Keep ordinary hospital manual review enabled. Through the same proposal, two-vote, and consensus process, first activate **Sensitive-record approval threshold = 0**. The zero means no *additional* committee approvals; all identity and ownership checks remain.
2. Submit a request for Ayesha's restricted specialist report. Ensure her identity assurance satisfies the current minimum. Complete the ordinary records-officer review and show that the request is eligible without extra committee signatures.
3. Propose **Sensitive-record approval threshold = 2**, gather two distinct governance approvals, and commit the change.
4. Submit a fresh request for the same sensitive report. Ordinary review alone now leaves it pending. One additional release approval is still insufficient; the second distinct eligible release approval satisfies the new threshold.
5. Continue through finality, token checks, and verified release. Point out that votes authorizing a policy change and approvals authorizing this particular sensitive release are separate records.

Do not load a clean scenario between the two comparison requests. Policy versions increase with each activated change; use the actual versions shown on screen rather than assuming they are always 1 and 2.

### Additional live configuration B — Ten-minute to two-minute capabilities

1. With the ten-minute policy active, advance an eligible request to capability issuance at step 19 and inspect its issued/expiry timestamps. Pause before redemption if you want to retain an unused comparison token.
2. Propose **Capability token lifetime = 2**, obtain the two committee approvals, and commit the new policy.
3. Submit a fresh otherwise-valid request and advance to its token issuance. The new token's expiry is two simulated minutes after issue. The older token keeps its own original ten-minute expiry.
4. In the Security center, press **+2 minutes** and then redeem the new token. The clock is now at or beyond its expiry, so the vault rejects it with `TOKEN-EXPIRY`.
5. Explain that an expiration-policy change controls new issuance. It neither rewrites an old token's timestamps nor bypasses the fresh policy, consent, and integrity checks performed during access.

This experiment should use a fresh request within the current session. Loading the clean expired-token scenario resets to the default ten-minute configuration and is a separate lesson.

## Chapter 8 — Security experiments

Select two or three experiments according to the time available.

| Experiment | What to demonstrate | Teaching point |
| --- | --- | --- |
| Another patient's record | Ownership FAIL and no released record | Authentication alone does not grant access to every record |
| Failed identity challenge | Authentication FAIL before release | A registered identifier alone is insufficient |
| Revoked/expired credential | Credential FAIL | Claims need validity and status checks |
| Officer with wrong role | RBAC FAIL | A hospital affiliation alone does not grant release authority |
| Dr. Khan and ECG consent | Appropriate clinician path succeeds | Consent is one necessary condition among several |
| MRI outside consent scope | Consent FAIL | Permission is scoped, not a global yes/no flag |
| Revoke clinician consent | Later clinician retrieval fails | Revocation affects future authorization checks |
| Sensitive report | Pending with too few distinct approvals | Threshold obligations must really control state |
| Tampered report copy | Different SHA-256 digest; no verified release | Integrity evidence detects change relative to an anchor |
| Two validators offline | Pending Finality; no vault release | Availability failure is not fabricated finality |
| Expired capability | Retrieval denied | Token lifetime is enforced by the simulation clock |
| Replayed capability | Second use denied | A consumed nonce remains consumed |

For the tamper experiment, emphasize that the original seeded record and committed block are preserved. The application modifies an isolated candidate copy, recomputes its hash, and rejects the mismatch.

For consent revocation, explain that the application can prevent later authorized retrieval. It cannot recall a report someone already downloaded.

## Chapter 9 — Final audit

**Show:** The audit explorer and JSON export. Select the successful access, denied access, policy proposal, distinct committee votes, policy activation, and integrity failure.

**Say:**

> Every decision has a cause that I can inspect: who acted, which request it concerned, which policy was active, and why it passed, failed, or remained pending. Audit entries and committed blocks are different layers of evidence. A local event is not labeled a consensus commitment until the consensus step succeeds.

Use **Previous Step** to inspect an earlier frame and then move forward again. Show that navigating recorded frames does not add new blocks, new committee approvals, or new token uses. Export the simulation trace for the submission.

End with the limitations: this is a deterministic educational model with real hash calculations. It is not a deployed blockchain, a protected hospital database, a cryptographic identity provider, or a certified healthcare system.

## The 23-step narration card

| Step | What to explain |
| --- | --- |
| 01 | Patient context and fictional history |
| 02 | Selected categories, records, and time range |
| 03 | One shared request is created |
| 04 | Demo request authentication, nonce, and real payload digest |
| 05 | The hospital queue receives that request |
| 06 | DID registry and controller evidence |
| 07 | Issuer, subject, validity, and credential status |
| 08 | Requested record belongs to the stated patient |
| 09 | Hospital operator's role |
| 10 | Contextual access attributes |
| 11 | Active policy version |
| 12 | Structured rule evaluation and deny-overrides |
| 13 | Self-access versus third-party consent |
| 14 | Review and any additional approval obligations |
| 15 | Metadata-only authorization proposal |
| 16 | Proposal delivery to the simulated validators |
| 17 | Simplified PBFT phases and threshold |
| 18 | Hash-linked block commitment |
| 19 | Scoped, short-lived capability |
| 20 | Authorized candidate retrieval from the off-chain vault |
| 21 | Digest comparison before verified disclosure |
| 22 | Approved records become visible to the requester |
| 23 | Final outcome and inspectable audit evidence |

Failure scenarios deliberately stop or branch before all 23 success-path stages are reached. Missing success checkmarks after a denial are correct behavior.

## Likely instructor questions and accurate answers

### Is this a real blockchain?

No. It is a local frontend simulator. Four visual hospitals are four records in application state. No Ethereum, Hyperledger, MultiChain, wallet extension, mining, or blockchain RPC is running. SHA-256 hashing is real; the distributed environment and identity/signature attestations are modeled.

### What makes this more than a slideshow?

The policy evaluator and workflow transitions calculate the outcomes. Changing the active assurance requirement changes eligibility. A second distinct vote changes proposal readiness. A lost quorum prevents finalization. Tampered content produces a different hash. The patient, hospital, inspector, and ledger read shared state.

### Why not store the medical records in the blocks?

Replicating medical content would multiply disclosure and retention problems. The model places clinical content in a simulated vault and records limited authorization and integrity metadata in the ledger. Hashes and pseudonymous references can still be sensitive or linkable, so this design alone does not prove anonymity or legal compliance.

### Is a SHA-256 hash a digital signature or encryption?

No. A hash is a digest of data. A digital signature needs a suitable signing key and verification method. Encryption needs keys and an encryption scheme. This project labels the latter mechanisms as simulation or architectural concepts rather than relabeling a hash as either one.

### Does a valid DID prove that someone is Ayesha?

DID control and real-world identity assurance are separate. MediChain's registry and credential fixtures model their relationship. A production system needs an actual DID method, trustworthy enrollment and issuers, cryptographic verification, revocation handling, and key recovery.

### Does valid consent guarantee access?

No. The clinician must still satisfy identity, credential, subject/record match, role, contextual policy, approval, token, finality, and integrity requirements. Ayesha's own access follows the separate self-access path.

### Are the committee's two approvals the PBFT quorum?

No. The three-person committee controls a policy-change business decision and normally needs two distinct approvals. The four-hospital network models commitment of the resulting event and uses a three-validator threshold. They solve different problems and have different members.

### Is PoA the same thing as PBFT?

No. Authority-based systems use identified, authorized validators, but concrete consensus algorithms differ. PBFT has its own message and certificate rules. A specific PoA design such as Clique has different production and signer-voting rules. The app explains the distinction; a policy committee is not itself either protocol.

### What if a validator goes offline?

With the modeled four-node membership and one-fault budget, three matching participants can meet the configured threshold. Two cannot. The app leaves the request pending; it does not reduce the threshold to force success.

### Does tamper evidence prove a diagnosis was correct?

No. A digest can show that a candidate record differs from the anchored content. It cannot establish the clinical truth or quality of the original content. The source of the original anchor and the real-world record creation process still matter.

### Can an administrator remove ownership checks?

No through the supported governance editor. Operational settings are editable through proposals; mandatory authentication, record-subject matching, audit obligations, and similar invariants are not policy toggles. A browser user who rewrites the program is outside the simulator's claimed boundary.

### What happens if the policy changes while a request is pending?

The application checks the active policy again before release. A request cannot rely indefinitely on an old favorable evaluation. Its historical events remain tied to the policy version used when they occurred.

### What would a real deployment replace?

Replace the demo registry and claims with verified identity systems; place authorization and vault enforcement on trusted servers; use independently operated authenticated validator nodes and a reviewed consensus implementation; protect keys and records; connect governed healthcare interfaces; and design incident response, retention, availability, and legal obligations. These are substantial system changes, not switching on an existing hidden backend.

## Submission checklist

Submit the complete source project and its README, the test output, architecture and policy documentation, this demonstration script, and an exported trace from the successful and dynamic-governance demonstrations. In the report, identify the actual 23-slide supplied governance deck and the mapping in `academic-references.md`. Do not attribute the unavailable 46-slide deck to this implementation.
