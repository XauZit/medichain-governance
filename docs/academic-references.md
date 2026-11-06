# Academic references and lecture alignment

## Which presentation was inspected

The assignment brief names **Blockchain Governance in Healthcare (Finanlize Chapter).pptx** and provides references extending to slide 46. That exact presentation was not available among the supplied project files.

The supplied **Blockchain for Governance Chapter 7.pptx**, by Shahbaz Siddiqui, was inspected. It contains **23 slides** and is the primary available course reference for this implementation. Its slide numbers are different from those in the brief. The simulator therefore uses the verified mapping below; it does not claim that unavailable slides were inspected.

| Available slide | Relevant content | MediChain teaching connection |
| --- | --- | --- |
| 3 | Governance as rules, roles, records, accountability, and decision rights | Policy rules, authorized actors, approval history, audit explorer |
| 4 | Tampering, silos, weak consent, and slow audits | Healthcare problem, tamper experiment, patient consent, shared audit evidence |
| 5 | Ledger, hashes, consensus, smart contracts, and signatures | Separately labeled simulation of each mechanism |
| 6 | Hash pointers and Merkle roots reveal alteration | Hash-chain verification and Merkle inclusion experiment |
| 7 | Blockchain properties and governance value | Teaching explanations of consistent rules and shared evidence |
| 8 | Public, private, and consortium networks | Four known hospital validators; no public mining |
| 10 | Governance by blockchain and governance of blockchain | Access decisions versus committee-approved policy changes |
| 11 | Applications, identity, policy, ledger, off-chain storage, and oversight | Clickable five-layer architecture explanation |
| 13 | Fragmented patient history, opaque access, and weak consent | Patient and hospital portals |
| 14 | Health-record integrity, consent, and credentialing | Record access, clinician grants, demo credential validation |
| 15 | Off-chain records and on-chain hashes, permissions, and access events | Hospital vault, authorization metadata, and integrity check |
| 16 | Consent grant, use, expiry, revocation, and emergency access concept | Scoped clinician consent with purpose and expiry; revocation experiments |
| 21 | Privacy and retention tensions in immutable systems | Minimal ledger metadata; explicit limits on confidentiality and erasure claims |
| 22 | Bad input, interoperability, key management, and institutional limits | Limitations page and instructor questions |
| 23 | Govern access and integrity while keeping clinical data off-chain | The central architecture decision |

The presentation's emergency “break-glass” idea is discussed as a future, separately governed mechanism. It is not an override button for a failed mandatory check in this assignment. This follows the brief's stronger requirement that a hospital operator cannot override a mandatory denial.

The detailed PBFT phase model, DID and credential checks, RBAC/ABAC distinction, 2-of-3 policy committee, capability tokens, and numbered 23-step workflow are **educational extensions requested in the assignment brief**. They are not attributed to nonexistent slide numbers in the available deck.

## Primary technical references

These references support the terminology and explain the boundaries between MediChain's local model and production protocols. Retrieved on 5 November 2026.

1. **Miguel Castro and Barbara Liskov, Practical Byzantine Fault Tolerance, OSDI 1999.** [Paper overview](https://www.usenix.org/conference/osdi-99/practical-byzantine-fault-tolerance) · [Algorithm section](https://static.usenix.org/publications/library/proceedings/osdi99/full_papers/castro/castro_html/node4.html). The original protocol describes primary/replica roles, pre-prepare, prepare, commit, and view changes. For `n = 3f + 1`, local commitment requires the protocol's prepared condition and `2f + 1` distinct, matching commit messages. MediChain visualizes a bounded local approximation; it does not implement production state-machine replication.
2. **W3C, Decentralized Identifiers (DIDs) v1.0.** [Recommendation](https://www.w3.org/TR/did-core/). DID documents associate identifiers with verification methods and other information. Demonstrating control of a DID is distinct from determining the controller's legal identity and distinct from permission to access a record. MediChain uses an in-memory demo registry rather than a deployed DID method or resolver.
3. **W3C, Verifiable Credentials Data Model v2.0.** [Recommendation](https://www.w3.org/TR/vc-data-model-2.0/). Credentials express issuer claims in an issuer–holder–verifier ecosystem. MediChain models issuer, subject, assurance, validity, and revocation attributes. Its fixture checks are not interoperable cryptographically secured verifiable credentials.
4. **NIST SP 800-162, Guide to Attribute Based Access Control (ABAC) Definition and Considerations.** [Publication](https://csrc.nist.gov/pubs/sp/800/162/upd2/final). ABAC evaluates subject, object, operation, and relevant environmental attributes against policy. MediChain uses this separation for requester identity, record classification, treatment purpose, duty status, and treatment relationship. These are teaching rules rather than a claim of NIST certification.
5. **W3C, Web Cryptography API.** [2017 Recommendation](https://www.w3.org/TR/2017/REC-WebCryptoAPI-20170126/). Browser `SubtleCrypto` supplies the SHA-256 primitive used for real content digests. Hashing alone neither encrypts the record nor proves who authored it. Simulated signatures and approval attestations are labeled separately from the real digest calculation.
6. **IETF RFC 9162, Certificate Transparency Version 2.0, §2.1.** [Merkle tree reference](https://www.rfc-editor.org/rfc/rfc9162.html#section-2.1). The document explains Merkle inclusion proofs and the distinction between leaf and internal-node hash inputs. It is background for the integrity lesson, not a claim that MediChain implements a Certificate Transparency log or its exact tree encoding.
7. **Péter Szilágyi, EIP-225, Clique proof-of-authority consensus protocol.** [Protocol specification](https://eips.ethereum.org/EIPS/eip-225). Clique is one concrete PoA design with authorized signers and signer-list voting. PoA is not a synonym for PBFT, and the hospital policy committee is not itself a consensus protocol. MediChain's committee voting governs application policy; its four-hospital consensus visualization illustrates the separate ledger-finality step.

## What the references do not establish

The code, tests, and simulated traces establish what this particular application does. The sources above do not certify its security, healthcare interoperability, legal compliance, or clinical correctness. The fictional identity-assurance levels are local assignment parameters, not an implementation of a national identity scheme or a complete external assurance standard. No medical advice or production deployment claim is made.
