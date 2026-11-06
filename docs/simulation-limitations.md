# Simulation boundaries and technical accuracy

MediChain is an educational prototype for Assignment 1. Its central claim is that the visible decisions are calculated from the local workflow and policy state. It does not claim a deployed blockchain or production medical-record security.

## What is real and what is modeled

| Mechanism | What the application actually does | What it does not establish |
| --- | --- | --- |
| Patient and hospital portals | Share typed application state and calculated request outcomes | Independent hospital systems, authenticated sessions, or protected clinical records |
| Governance rules | Execute structured TypeScript conditions against the active policy version | Deployed chaincode, Solidity contracts, or independently executed replicas |
| DID verification | Checks the demo registry, active identity state, and modeled request evidence | A deployed DID method, secure key possession, or legal identity verification |
| Credential validation | Evaluates fixture issuer/status/expiry and assurance attributes | W3C credential-proof interoperability, real issuer trust, or a live revocation service |
| Request/approval signature evidence | Computes a clearly marked educational fingerprint from known demo inputs | A digital signature or proof that a private key was used |
| SHA-256 | Uses browser Web Crypto to compute actual digests from canonical data | Confidentiality, clinical truth, or the identity of the data's author |
| Merkle inclusion | Recomputes a root from a selected digest and sibling path | Trust in a root that has not itself been obtained from a trusted source |
| Hash-linked ledger | Calculates block hashes, transaction roots, and previous-hash pointers | Resistance to a person rewriting all browser state and recalculating the entire chain |
| PBFT visualization | Models phase progression and a fixed three-of-four finalization threshold | Complete PBFT, real networking, independent machines, or a formal safety/liveness proof |
| Committee approvals | Counts distinct eligible demo actors and gates policy activation | Hardware-protected signing, independent humans, or real separation of duties |
| Capability token | Enforces modeled subject, request, scope, expiry, used/revoked state, and finality checks | A production token format, server-enforced authorization, or cryptographic bearer-token security |
| Hospital vault | Holds fictional clinical objects outside the simulated ledger | Encrypted storage, access protection from the browser owner, or a real hospital integration |
| Audit export | Exports local evidence and recorded policy versions | A trusted external timestamp or signed, independently retained forensic log |

## Browser trust boundary

All actors and validators live inside one application. Anyone who controls the browser can inspect the bundled fictional data and modify the code or state. The UI's actor switch intentionally lets a presenter demonstrate multiple roles without logging in again. It is not an authentication system.

The release path enforces the assignment's logic when used through the application. It is not designed to hide records from a user who opens developer tools. There are no real private keys or real patient records to protect.

## Consensus qualifications

The four-hospital model uses `n = 4`, `f = 1`, and a required quorum of `2f + 1 = 3`. Offline or rejecting validators do not lower the required threshold. A missing threshold results in pending finality rather than a fabricated authorization block.

The phases explain proposal, preparation, commitment, and finalization. They do not implement all parts of the original PBFT protocol, including production authenticated transport, independently maintained replica logs, rigorous per-replica certificates, recovery, checkpoint management, and complete view-change behavior. Network messages shown on screen are local simulation events.

The committee's two-of-three authorization is an application-governance rule. It is different from the validator quorum. Likewise, PoA is a family of authority-based designs, not another name for this PBFT demonstration. The project's PoA teaching explanation does not implement Clique or another production PoA network.

## Identity and assurance qualifications

The model uses DID-like identifiers and fixture credentials to explain authentication and authorization. A successful demo check means the configured model conditions passed. It does not prove a real person's identity.

Assurance Levels 1–3 are local teaching parameters. They make the dynamic-governance experiment easy to observe. They are not a complete implementation of a government or industry identity-assurance framework.

The signature helper deliberately includes a simulation prefix and uses a public-label fingerprint. Because its inputs are known, anyone could reproduce that fingerprint. It must never be described as an asymmetric digital signature.

## Integrity qualifications

The content hash answers: “Does this candidate have the same canonical content as the retained anchor?” It does not answer: “Was the original clinical statement accurate?” A wrongly entered value can have a perfectly matching hash.

The simulator retains the original anchor and modifies an isolated candidate for the tamper lesson. A detected mismatch prevents verified release through the workflow. Previously committed evidence is preserved, including an earlier authorization if the tampering is detected at the retrieval stage.

A Merkle proof provides evidence of inclusion under a particular root. The proof is useful only when the verifier trusts that root and the tree's encoding. MediChain documents its custom tagged parent encoding and odd-node duplication rather than claiming it is the exact Bitcoin or RFC 9162 format.

## Privacy and consent qualifications

The simulated ledger excludes names and plaintext clinical content. Pseudonymous references, timestamps, and hashes can nevertheless reveal relationships or permit linking and guessing. Moving clinical content off-chain does not by itself establish anonymity.

Patient self-access is a separate path from clinician access. Ayesha does not need a grant to herself. A grant to Dr. Khan is bound to categories, purpose, and expiry, and remains subject to other applicable checks.

Revocation prevents subsequent authorized retrieval through the model. It cannot erase knowledge, screenshots, exported files, or reports already downloaded. Similarly, changing a governance rule does not rewrite the meaning or policy version of a past decision.

The interface's encrypted-storage description is architectural context. The demo's vault objects are not encrypted at rest. FHIR-inspired resource names, where used, are teaching structures and do not constitute full HL7 FHIR conformance.

## Clock and replay qualifications

Token expiry, consent expiry, credential validity, and proposal expiry use the simulation clock. This supports repeatable demonstrations. It is separate from a trusted production clock and from the viewer's operating-system time.

Backward navigation replays recorded states for explanation. It must not restore a consumed token or count a vote twice. Reset Demo Data begins a new fictional session and intentionally discards that session's local state. It is not a claim that committed production records can be silently erased.

## Legal and operational boundary

The project makes no claim of HIPAA/GDPR compliance, legal certification, clinical suitability, or medical advice. It does not implement real consent-law analysis, emergency access adjudication, patient identity proofing, retention procedures, breach response, or cross-border healthcare processing.

The available course deck discusses privacy-law tensions and emergency “break-glass” access. The simulator does not turn those concepts into an operator bypass for a mandatory failed check. A production emergency process would require separate authority, safeguards, auditing, and review.

## A future production system

A production implementation would need trusted server-side enforcement, professionally reviewed identity and credential systems, protected keys, encrypted healthcare storage, independently administered consortium nodes, a reviewed consensus implementation, tested recovery and availability procedures, and appropriate clinical and legal governance. Those components would replace the simulation's trust boundary; the frontend alone cannot supply them.

See `academic-references.md` for the available lecture mapping and primary technical sources, and `architecture.md` for the actual local model.
