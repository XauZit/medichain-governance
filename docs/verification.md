# Delivery verification

Verified on 5 November 2026.

## Automated results

- **102 tests passed; 0 failed; 0 skipped.**
- 34 domain tests cover SHA-256, canonicalization, Merkle proofs, chain verification, identity and access rules, governance controls, consent, and capability checks.
- 34 simulator tests cover complete workflows and adversarial transitions, including late policy/consent changes, unavailable quorum, immutable audit versions, changed signed payloads, tampering, concurrent redemption, and replay.
- 34 React server-render tests cover all 12 pages in initial and delivered states plus computed governance previews, committee thresholds, denial bindings, released-record visibility, skipped stages, token replay controls, ledger privacy, and historical snapshots.
- TypeScript and the Vite production build pass.

The exact machine-readable test output is in [test-results.json](test-results.json). Run `npm test` to reproduce the checks.

## What was and was not browser-verified

The deployment service confirmed successful private HTTPS publication. The private site correctly presents its ChatGPT sign-in gate to an unauthenticated browser.

A full browser walkthrough, visual layout review, animation review, and click-based end-to-end verification were **not completed** in the delivery environment:

1. The managed development preview is served at an HTTP hostname that is not a browser secure context. Web Crypto is unavailable there. The application correctly refuses to initialize without its required real SHA-256 API.
2. The private HTTPS site requires the owner's ChatGPT sign-in. The test browser had no signed-in account. No credentials were requested or access controls weakened for an optional verification step.

The React render tests establish rendering and state binding under the test runtime; they do **not** substitute for actual browser layout, animation, download, fullscreen, or interaction checks.

## Running your own browser demonstration

Use `npm ci` followed by `npm run dev -- --port 5173` and open `http://localhost:5173/`, or open the private HTTPS site with your existing ChatGPT account. Both are appropriate origins for Web Crypto. Do not open the HTML file directly or use an ordinary HTTP LAN IP/hostname.

For a short acceptance walkthrough, complete own-lab, dynamic-governance, sensitive-approval, tampered-record, and two-offline scenarios, then test the Merkle proof and export a trace. Follow [instructor-demo.md](instructor-demo.md) for the exact sequence and expected decisions.
