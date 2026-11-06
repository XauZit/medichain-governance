import { describe, expect, it } from 'vitest';
import { buildMerkleTree, canonical, createBlock, getMerkleProof, hashBlock, hashRecord, sha256, simulatedSignature, verifyChain, verifyMerkleProof } from '../src/core/crypto';
import { createInitialState, requestPayload } from '../src/core/fixtures';
import { castVote, checkMultisigThreshold, consensusStep, createProposal, emptyConsensus, verifyProposalVotes } from '../src/core/governance';
import { checkConsent, evaluateAccessRequest, evaluateGovernancePolicy, issueCapabilityToken, validateCapabilityToken, verifyCredential, verifyRecordOwnership } from '../src/core/policy';
import type { AccessRequest, SimulationState } from '../src/core/types';

async function fixture(overrides: Partial<AccessRequest> = {}): Promise<{ state: SimulationState; request: AccessRequest }> {
  const state = await createInitialState();
  const request: AccessRequest = {
    id: 'REQ-TEST-0001', patientId: 'P001', actorType: 'patient', actorId: 'P001', recordIds: ['R001'],
    purpose: 'SELF_ACCESS', hospitalId: 'H1', createdAt: state.clock, nonce: 'request:test:0001', signature: '',
    challengeValid: true, officerRole: 'RECORDS_OFFICER', onShift: true, relationship: true,
    status: 'SUBMITTED', policyVersion: 1, checks: [], approvals: [], review: 'PENDING', releasedRecordIds: [],
    ...overrides,
  };
  request.signature = await simulatedSignature(requestPayload(request), request.actorType === 'clinician' ? 'DEMO-PUB-DR-KHAN' : 'DEMO-PUB-P001');
  state.requests.push(request);
  state.activeRequestId = request.id;
  return { state, request };
}

async function authorizedToken(overrides: Partial<AccessRequest> = {}) {
  const { state, request } = await fixture({ review: 'APPROVED', ...overrides });
  const event = {
    id: 'TX-TEST-0001', eventType: 'MEDICAL_HISTORY_ACCESS_APPROVED', requestRef: request.id,
    recordHashes: request.recordIds.map((id) => state.records.find((record) => record.id === id)!.originalHash),
    policyVersion: state.policy.version, decision: 'PERMIT',
  };
  const block = await createBlock([event], state.ledger[0], state.clock, state.policy.version, 'H1', 'PBFT_COMMITTED');
  state.ledger.push(block);
  request.blockHash = block.hash;
  request.status = 'COMMITTED';
  const token = issueCapabilityToken(request, state);
  state.tokens.push(token);
  request.tokenId = token.id;
  request.status = 'TOKEN_ISSUED';
  return { state, request, token };
}

describe('Real SHA-256 and computed integrity evidence', () => {
  it('matches the standard SHA-256 known-answer vector', async () => {
    expect(await sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('canonicalizes nested object keys while preserving array order', async () => {
    const a = { z: [{ b: 2, a: 1 }], a: true };
    const b = { a: true, z: [{ a: 1, b: 2 }] };
    expect(canonical(a)).toBe(canonical(b));
    expect(await hashRecord(a)).toBe(await hashRecord(b));
    expect(canonical([1, 2])).not.toBe(canonical([2, 1]));
    expect(canonical(JSON.parse('{"__proto__":{"x":1},"a":2}'))).toBe('{"__proto__":{"x":1},"a":2}');
  });
  it('detects a changed synthetic lab value without mutating the original', async () => {
    const state = await createInitialState();
    const original = state.records[0];
    const altered = structuredClone(original.content);
    altered.unauthorizedChange = 'tamper experiment';
    expect(await hashRecord(altered)).not.toBe(original.originalHash);
    expect(await hashRecord(original.content)).toBe(original.originalHash);
  });
  it('verifies all four Merkle paths and rejects changed leaf and sibling hashes', async () => {
    const leaves = await Promise.all(['A', 'B', 'C', 'D'].map(sha256));
    const tree = await buildMerkleTree(leaves);
    expect(tree.levels.map((level) => level.length)).toEqual([4, 2, 1]);
    for (let index = 0; index < leaves.length; index += 1) {
      const proof = getMerkleProof(tree, index);
      expect(await verifyMerkleProof(leaves[index], proof, tree.root)).toBe(true);
      expect(await verifyMerkleProof(await sha256('tampered'), proof, tree.root)).toBe(false);
      proof[0].sibling = await sha256('bad sibling');
      expect(await verifyMerkleProof(leaves[index], proof, tree.root)).toBe(false);
    }
  });
  it('uses a deterministic odd-leaf rule and handles a single leaf', async () => {
    const leaves = await Promise.all(['A', 'B', 'C'].map(sha256));
    const tree = await buildMerkleTree(leaves);
    expect(await verifyMerkleProof(leaves[2], getMerkleProof(tree, 2), tree.root)).toBe(true);
    const single = await buildMerkleTree([leaves[0]]);
    expect(await verifyMerkleProof(leaves[0], [], single.root)).toBe(true);
  });
  it('detects a modified block copy and preserves the original ledger', async () => {
    const { state } = await authorizedToken();
    expect((await verifyChain(state.ledger)).valid).toBe(true);
    const copy = structuredClone(state.ledger);
    copy[1].transactions[0].decision = 'DENY';
    expect((await verifyChain(copy)).valid).toBe(false);
    expect((await verifyChain(state.ledger)).valid).toBe(true);
  });
  it('detects broken hash pointers even when an earlier copied block is rehashed', async () => {
    const { state } = await authorizedToken();
    const copy = structuredClone(state.ledger);
    copy[0].proposer = 'ALTERED_DEMO';
    copy[0].hash = await hashBlock(copy[0]);
    const result = await verifyChain(copy);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('preceding block hash');
  });
  it('labels public-key fingerprints as simulated rather than true signatures', async () => {
    const signature = await simulatedSignature({ message: 'demo' }, 'public-demo-label');
    expect(signature).toMatch(/^SIM-[a-f0-9]{64}$/);
    expect(signature).not.toBe(await simulatedSignature({ message: 'changed' }, 'public-demo-label'));
  });
});

describe('Mandatory access controls and consent', () => {
  it('requires ordinary hospital review before a valid self-access request is permitted', async () => {
    const { state, request } = await fixture();
    expect(evaluateAccessRequest(request, state).decision).toBe('PENDING');
    expect(evaluateAccessRequest(request, state, { requireApprovals: false }).decision).toBe('PERMIT');
    request.review = 'APPROVED';
    expect(evaluateAccessRequest(request, state).decision).toBe('PERMIT');
    expect(checkConsent(request, state).result).toBe('NOT_APPLICABLE');
  });
  it('denies another patient’s records even after the officer presses approve', async () => {
    const { state, request } = await fixture({ recordIds: ['R009'], review: 'APPROVED' });
    expect(verifyRecordOwnership(request, state).result).toBe('FAIL');
    expect(evaluateAccessRequest(request, state).decision).toBe('DENY');
  });
  it('denies authentication failure despite sufficient review and signatures', async () => {
    const { state, request } = await fixture({ challengeValid: false, review: 'APPROVED', approvals: ['CMIO', 'PRIVACY_OFFICER'] });
    const evaluation = evaluateAccessRequest(request, state);
    expect(evaluation.decision).toBe('DENY');
    expect(evaluation.explanation).toContain('AUTH-001');
  });
  it('denies revoked, expired, and untrusted credentials', async () => {
    const { state, request } = await fixture();
    state.patients[0].credential.revoked = true;
    expect(verifyCredential(request, state).result).toBe('FAIL');
    state.patients[0].credential.revoked = false;
    state.patients[0].credential.expiresAt = state.clock;
    expect(verifyCredential(request, state).result).toBe('FAIL');
    state.patients[0].credential.expiresAt += 60_000;
    state.patients[0].credential.issuer = 'UNTRUSTED';
    expect(verifyCredential(request, state).result).toBe('FAIL');
  });
  it('denies empty or unknown record scopes and unauthorized processing roles', async () => {
    const { state, request } = await fixture({ recordIds: [] });
    expect(evaluateAccessRequest(request, state).decision).toBe('DENY');
    request.recordIds = ['NONEXISTENT'];
    expect(evaluateAccessRequest(request, state).decision).toBe('DENY');
    request.recordIds = ['R001'];
    request.officerRole = 'RECEPTIONIST';
    expect(evaluateAccessRequest(request, state).explanation).toContain('RBAC-001');
  });
  it('permits a clinician ECG request only with matching scope, purpose, and context', async () => {
    const { state, request } = await fixture({ actorType: 'clinician', actorId: 'DR_KHAN', purpose: 'TREATMENT', recordIds: ['R002'], review: 'APPROVED' });
    expect(evaluateAccessRequest(request, state).decision).toBe('PERMIT');
    request.recordIds = ['R006'];
    expect(evaluateAccessRequest(request, state).explanation).toContain('CONSENT-001');
    request.recordIds = ['R002'];
    request.purpose = 'RESEARCH';
    expect(checkConsent(request, state).result).toBe('FAIL');
    request.purpose = 'TREATMENT';
    request.onShift = false;
    expect(evaluateAccessRequest(request, state).explanation).toContain('ABAC-001');
  });
  it('applies expiry and revocation to subsequent clinician access', async () => {
    const { state, request } = await fixture({ actorType: 'clinician', actorId: 'DR_KHAN', purpose: 'TREATMENT', recordIds: ['R002'], review: 'APPROVED' });
    state.consents[0].expiresAt = state.clock;
    expect(checkConsent(request, state).result).toBe('FAIL');
    state.consents[0].expiresAt = state.clock + 60_000;
    state.consents[0].revoked = true;
    expect(checkConsent(request, state).result).toBe('FAIL');
    state.policy.clinicianConsent = false;
    expect(checkConsent(request, state).result).toBe('FAIL');
  });
  it('enforces distinct sensitive-record approvals and reports pending obligations', async () => {
    const { state, request } = await fixture({ recordIds: ['R007'], review: 'APPROVED', approvals: ['CMIO', 'CMIO', 'UNAUTHORIZED'] });
    expect(evaluateAccessRequest(request, state).decision).toBe('PENDING');
    request.approvals.push('PRIVACY_OFFICER');
    expect(evaluateAccessRequest(request, state).decision).toBe('PERMIT');
    request.integrityValid = false;
    expect(evaluateAccessRequest(request, state).decision).toBe('DENY');
  });
  it('supports ordinary review alone before a governed extra-signature requirement', async () => {
    const { state, request } = await fixture({ recordIds: ['R007'] });
    state.policy = { ...state.policy, sensitiveApprovals: 0 };
    expect(evaluateAccessRequest(request, state).decision).toBe('PENDING');
    request.review = 'APPROVED';
    expect(evaluateAccessRequest(request, state).decision).toBe('PERMIT');
    state.policy = { ...state.policy, version: 2, sensitiveApprovals: 2 };
    expect(evaluateAccessRequest(request, state).decision).toBe('PENDING');
    request.approvals.push('CMIO', 'PRIVACY_OFFICER');
    expect(evaluateAccessRequest(request, state).decision).toBe('PERMIT');
  });
  it('re-evaluates unchanged assurance evidence against the actual active policy', async () => {
    const { state, request } = await fixture({ review: 'APPROVED' });
    expect(evaluateAccessRequest(request, state).decision).toBe('PERMIT');
    state.policy = { ...state.policy, version: 2, minAssurance: 3 };
    expect(evaluateGovernancePolicy(request, state).find((rule) => rule.ruleId === 'GOV-ASSURANCE')?.result).toBe('FAIL');
    expect(evaluateAccessRequest(request, state).decision).toBe('DENY');
    state.patients[0].credential.assurance = 3;
    expect(evaluateAccessRequest(request, state).decision).toBe('PERMIT');
  });
  it('denies replayed request nonces and stale authentication evidence', async () => {
    const { state, request } = await fixture({ review: 'APPROVED' });
    state.requests.push({ ...request, id: 'REQ-OTHER' });
    expect(evaluateAccessRequest(request, state).decision).toBe('DENY');
    state.requests.pop();
    state.clock += 31 * 60_000;
    expect(evaluateAccessRequest(request, state).decision).toBe('DENY');
  });
});

describe('Governance proposal safeguards', () => {
  it('keeps the active policy unchanged after proposal creation and one vote', async () => {
    const { state, request } = await fixture({ review: 'APPROVED' });
    const proposed = createProposal(state, 'minAssurance', 3, 'Raise identity assurance for this teaching scenario.');
    const oneVote = await castVote(proposed, 'CMIO', 'APPROVE', state.clock);
    expect(checkMultisigThreshold(oneVote.votes)).toBe(false);
    expect(oneVote.status).toBe('PENDING');
    expect(state.policy.minAssurance).toBe(2);
    expect(evaluateAccessRequest(request, state).decision).toBe('PERMIT');
  });
  it('allows two distinct votes to satisfy committee approval without activating policy', async () => {
    const { state } = await fixture();
    let proposal = createProposal(state, 'tokenMinutes', 2, 'Demonstrate a shorter capability lifetime.');
    proposal = await castVote(proposal, 'CMIO', 'APPROVE', state.clock);
    proposal = await castVote(proposal, 'PRIVACY_OFFICER', 'APPROVE', state.clock);
    expect(checkMultisigThreshold(proposal.votes)).toBe(true);
    expect(proposal.status).toBe('APPROVED');
    expect(state.policy.tokenMinutes).toBe(10);
    expect(await verifyProposalVotes(proposal)).toBe(true);
    const altered = structuredClone(proposal);
    altered.expiresAt += 60_000;
    expect(await verifyProposalVotes(altered)).toBe(false);
    altered.expiresAt = proposal.expiresAt;
    altered.newValue = 1;
    expect(await verifyProposalVotes(altered)).toBe(false);
  });
  it('rejects duplicate, unauthorized, and proposer votes', async () => {
    const { state } = await fixture();
    let proposal = createProposal(state, 'minAssurance', 3, 'Raise the identity threshold.');
    await expect(castVote(proposal, 'GOVERNANCE_OFFICER', 'APPROVE', state.clock)).rejects.toThrow();
    await expect(castVote(proposal, 'UNAUTHORIZED', 'APPROVE', state.clock)).rejects.toThrow();
    proposal = await castVote(proposal, 'CMIO', 'APPROVE', state.clock);
    await expect(castVote(proposal, 'CMIO', 'APPROVE', state.clock)).rejects.toThrow(/already voted/);
  });
  it('prevents rejected or expired proposals from becoming approved', async () => {
    const { state } = await fixture();
    const proposal = createProposal(state, 'minAssurance', 3, 'Raise the identity threshold.');
    const rejected = await castVote(proposal, 'CMIO', 'REJECT', state.clock);
    await expect(castVote(rejected, 'PRIVACY_OFFICER', 'APPROVE', state.clock)).rejects.toThrow();
    await expect(castVote(proposal, 'CMIO', 'APPROVE', proposal.expiresAt)).rejects.toThrow(/expired/);
  });
  it('rejects arbitrary JavaScript, security-invariant edits and out-of-range thresholds', async () => {
    const { state } = await fixture();
    expect(() => createProposal(state, 'minAssurance', 0, 'Invalid assurance policy.')).toThrow();
    expect(() => createProposal(state, 'sensitiveApprovals', 4, 'Invalid committee threshold.')).toThrow();
    expect(() => createProposal(state, 'tokenMinutes', 0, 'Invalid capability lifetime.')).toThrow();
    expect(() => createProposal(state, 'ownership' as never, false, 'Attempt to disable ownership.')).toThrow();
    expect(() => createProposal(state, 'manualReview', 'eval(alert(1))' as never, 'Attempt arbitrary code.')).toThrow();
  });
});

describe('Prepared and commit quorum in the simplified PBFT model', () => {
  it('progresses through four inspectable phases and finalizes with one offline validator', async () => {
    const state = await createInitialState();
    state.validators[2].online = false;
    const digest = await sha256('proposal');
    let consensus = emptyConsensus();
    const phases = [];
    for (let i = 0; i < 4; i += 1) {
      consensus = consensusStep(consensus, state.validators, digest);
      phases.push(consensus.phase);
    }
    expect(phases).toEqual(['PRE_PREPARE', 'PREPARE', 'COMMIT', 'FINALIZED']);
    expect(consensus.committed).toEqual(['H1', 'H2', 'H4']);
    expect(consensusStep(consensus, state.validators, digest)).toEqual(consensus);
  });
  it('cannot finalize when two validators are offline', async () => {
    const state = await createInitialState();
    state.validators[2].online = false;
    state.validators[3].online = false;
    const digest = await sha256('proposal');
    let consensus = emptyConsensus();
    for (let i = 0; i < 3; i += 1) consensus = consensusStep(consensus, state.validators, digest);
    expect(consensus.phase).toBe('UNAVAILABLE');
    expect(consensus.committed).toEqual([]);
  });
  it('excludes rejecting validators and never counts duplicate validator identities', async () => {
    const state = await createInitialState();
    state.validators[2].faulty = true;
    const digest = await sha256('proposal');
    let consensus = emptyConsensus();
    for (let i = 0; i < 4; i += 1) consensus = consensusStep(consensus, state.validators, digest);
    expect(consensus.phase).toBe('FINALIZED');
    expect(consensus.committed).not.toContain('H3');
    expect(consensus.messages.some((message) => !message.accepted)).toBe(true);
    state.validators[3].id = 'H2';
    expect(consensusStep(emptyConsensus(), state.validators, digest).phase).toBe('UNAVAILABLE');
  });
});

describe('Scoped single-use capabilities and fresh release authorization', () => {
  it('issues only after a matching committed permission event', async () => {
    const { state, request } = await fixture({ review: 'APPROVED', status: 'COMMITTED' });
    expect(() => issueCapabilityToken(request, state)).toThrow(/committed PERMIT/);
    const authorized = await authorizedToken();
    expect(validateCapabilityToken(authorized.token, authorized.request, authorized.state).decision).toBe('PERMIT');
    expect(() => issueCapabilityToken(authorized.request, authorized.state)).toThrow();
  });
  it('rejects expired and reused capabilities at the vault gate', async () => {
    const { state, request, token } = await authorizedToken();
    state.clock = token.expiresAt;
    expect(validateCapabilityToken(token, request, state).checks.find((rule) => rule.ruleId === 'TOKEN-EXPIRY')?.result).toBe('FAIL');
    state.clock = token.issuedAt;
    token.used = true;
    expect(validateCapabilityToken(token, request, state).checks.find((rule) => rule.ruleId === 'TOKEN-REPLAY')?.result).toBe('FAIL');
  });
  it('rejects a forged scope, unknown token, and wrong subject', async () => {
    const { state, request, token } = await authorizedToken();
    const altered = { ...token, recordIds: ['R009'] };
    expect(validateCapabilityToken(altered, request, state).decision).toBe('DENY');
    expect(validateCapabilityToken({ ...token, subject: 'P002' }, request, state).decision).toBe('DENY');
    state.tokens = [];
    expect(validateCapabilityToken(token, request, state).decision).toBe('DENY');
  });
  it('requires recorded request attributes and finalized ledger authority, not labels alone', async () => {
    const { state, request, token } = await authorizedToken();
    const alteredRequest = { ...request, purpose: 'UNRECORDED_PURPOSE' };
    expect(validateCapabilityToken(token, alteredRequest, state).decision).toBe('DENY');
    state.ledger[1].consensus = 'PENDING_FINALITY';
    expect(validateCapabilityToken(token, request, state).decision).toBe('DENY');
  });
  it('rechecks stricter active policy after a token was issued', async () => {
    const { state, request, token } = await authorizedToken();
    state.policy = { ...state.policy, version: 2, minAssurance: 3 };
    expect(validateCapabilityToken(token, request, state).decision).toBe('DENY');
  });
  it('rechecks clinician consent revocation after issuance but before retrieval', async () => {
    const { state, request, token } = await authorizedToken({ actorType: 'clinician', actorId: 'DR_KHAN', purpose: 'TREATMENT', recordIds: ['R002'] });
    expect(validateCapabilityToken(token, request, state).decision).toBe('PERMIT');
    state.consents[0].revoked = true;
    expect(validateCapabilityToken(token, request, state).decision).toBe('DENY');
  });
  it('applies a changed token lifetime to new issuance, not old objects', async () => {
    const { state, request } = await fixture({ review: 'APPROVED' });
    state.policy = { ...state.policy, version: 2, tokenMinutes: 2 };
    const recordHash = state.records[0].originalHash;
    const block = await createBlock([{ id: 'TX-TTL', eventType: 'MEDICAL_HISTORY_ACCESS_APPROVED', requestRef: request.id, policyVersion: 2, recordHashes: [recordHash], decision: 'PERMIT' }], state.ledger[0], state.clock, 2, 'H1', 'PBFT_COMMITTED');
    state.ledger.push(block);
    request.blockHash = block.hash;
    request.status = 'COMMITTED';
    const token = issueCapabilityToken(request, state);
    expect(token.expiresAt - token.issuedAt).toBe(2 * 60_000);
  });
});
