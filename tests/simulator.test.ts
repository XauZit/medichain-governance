import { describe, expect, it } from 'vitest';
import { Simulator } from '../src/core/simulator';
import { canonical, hashRecord, verifyChain } from '../src/core/crypto';
import { evaluateAccessRequest } from '../src/core/policy';
import { SCENARIOS } from '../src/core/scenarios';
import { STEPS } from '../src/core/steps';
import type { RuleKey } from '../src/core/types';

async function until(engine: Simulator, predicate: () => boolean, autoApprove = true, limit = 100): Promise<void> {
  for (let i = 0; i < limit; i++) {
    if (predicate()) return;
    const request = engine.activeRequest;
    if (autoApprove && request?.status === 'AWAITING_REVIEW') await engine.review(true);
    else if (autoApprove && request?.status === 'AWAITING_APPROVALS') {
      const member = ['CMIO', 'PRIVACY_OFFICER', 'COMPLIANCE_OFFICER'].find(id => !request.approvals.includes(id));
      if (!member) throw new Error('No eligible test approval remains.');
      await engine.addApproval(member);
    } else await engine.next();
  }
  throw new Error(`Condition not reached; step=${engine.workflowStep}; status=${engine.activeRequest?.status}; ${engine.state.execution.explanation}`);
}

async function complete(engine: Simulator): Promise<void> { return until(engine, () => engine.state.finished); }

async function activate(engine: Simulator, key: RuleKey, value: number | boolean): Promise<string> {
  await engine.propose(key, value, 'A deliberate classroom policy change to verify real runtime behavior.');
  const proposal = engine.state.proposals.at(-1)!;
  await engine.vote(proposal.id, 'CMIO', 'APPROVE'); await engine.vote(proposal.id, 'PRIVACY_OFFICER', 'APPROVE');
  for (let i = 0; i < 6 && proposal.status !== 'ACTIVATED'; i++) await engine.advanceProposal(proposal.id);
  expect(engine.state.proposals.find(p => p.id === proposal.id)?.status).toBe('ACTIVATED');
  return proposal.id;
}

describe('guided healthcare request workflow', () => {
  it('has every required inspectable stage and all fifteen stable scenario IDs', () => {
    expect(STEPS.map(s => s.number)).toEqual(Array.from({ length: 23 }, (_, i) => i + 1));
    expect(new Set(SCENARIOS.map(s => s.id)).size).toBe(15);
    for (const scenario of SCENARIOS) { expect(scenario.guidance.length).toBeGreaterThanOrEqual(3); expect(scenario.expected).not.toBe(''); }
  });

  it('delivers an ordinary self-access request only after review, consensus, one-use token, and integrity', async () => {
    const engine = await Simulator.create();
    await until(engine, () => engine.activeRequest?.status === 'AWAITING_REVIEW', false);
    expect(engine.state.tokens).toHaveLength(0); expect(engine.state.ledger).toHaveLength(1);
    expect(engine.activeRequest?.releasedRecordIds).toEqual([]);
    await engine.review(true); await complete(engine);
    expect(engine.activeRequest?.status).toBe('DELIVERED'); expect(engine.activeRequest?.releasedRecordIds).toEqual(['R001']);
    expect(engine.activeRequest?.integrityValid).toBe(true); expect(engine.state.tokens[0].used).toBe(true);
    expect(engine.state.ledger.at(-1)?.transactions[0].decision).toBe('PERMIT');
    expect(new Set(engine.frames.map(f => f.step))).toEqual(new Set(Array.from({ length: 23 }, (_, i) => i + 1)));
    expect((await verifyChain(engine.state.ledger)).valid).toBe(true);
  });

  it('places a submitted request into the shared queue and resumes a second queued request independently', async () => {
    const engine = await Simulator.create(); await engine.submitRequest({ recordIds: ['R001'] }); const first = engine.activeRequest!.id;
    await engine.submitRequest({ recordIds: ['R002'] }); const second = engine.activeRequest!.id;
    expect(engine.state.requests).toHaveLength(2); expect(first).not.toBe(second);
    await engine.selectRequest(first); await complete(engine);
    expect(engine.state.requests.find(r => r.id === first)?.status).toBe('DELIVERED');
    expect(engine.state.requests.find(r => r.id === second)?.status).toBe('SUBMITTED');
    await engine.selectRequest(second); await complete(engine);
    expect(engine.activeRequest?.releasedRecordIds).toEqual(['R002']);
  });

  it.each([
    ['wrong-owner', 'OWN-001'], ['bad-identity', 'AUTH-001'], ['revoked-credential', 'CRED-001'], ['bad-role', 'RBAC-001'], ['consent-scope', 'CONSENT-001'], ['consent-revoked', 'CONSENT-001'],
  ])('denies %s and records a denial without releasing records', async (scenarioId, ruleId) => {
    const engine = await Simulator.create(); await engine.loadScenario(scenarioId); await complete(engine);
    expect(engine.activeRequest?.status).toBe('DENIED'); expect(engine.activeRequest?.denialRule).toBe(ruleId);
    expect(engine.activeRequest?.releasedRecordIds).toEqual([]); expect(engine.state.tokens).toHaveLength(0);
    expect(engine.state.audit.some(e => e.type === 'ACCESS_DENIED')).toBe(true);
    expect(engine.state.ledger.some(b => b.transactions.some(tx => tx.eventType === 'ACCESS_DENIED' && tx.ruleId === ruleId))).toBe(true);
    await expect(engine.review(true)).rejects.toThrow();
  });

  it('permits a clinician ECG request with exact valid consent and context', async () => {
    const engine = await Simulator.create(); await engine.loadScenario('clinician-ecg'); await complete(engine);
    expect(engine.activeRequest?.status).toBe('DELIVERED');
    expect(engine.activeRequest?.checks.find(c => c.ruleId === 'CONSENT-001')?.result).toBe('PASS');
    expect(engine.activeRequest?.releasedRecordIds).toEqual(['R002']);
  });

  it('does not require a patient to create a self-consent grant', async () => {
    const engine = await Simulator.create(); engine.state.consents = []; await complete(engine);
    expect(engine.activeRequest?.status).toBe('DELIVERED');
    expect(engine.activeRequest?.checks.find(c => c.ruleId === 'CONSENT-001')?.result).toBe('NOT_APPLICABLE');
  });

  it('rejects the wrong consent purpose and an expired grant', async () => {
    const engine = await Simulator.create(); await engine.submitRequest({ actorType: 'clinician', purpose: 'RESEARCH', recordIds: ['R002'] }); await complete(engine);
    expect(engine.activeRequest?.denialRule).toBe('CONSENT-001');
    await engine.reset(); engine.state.consents[0].expiresAt = engine.state.clock;
    await engine.submitRequest({ actorType: 'clinician', purpose: 'TREATMENT', recordIds: ['R002'] }); await complete(engine);
    expect(engine.activeRequest?.denialRule).toBe('CONSENT-001');
  });

  it('rechecks revoked consent after commitment and before retrieval', async () => {
    const engine = await Simulator.create(); await engine.loadScenario('clinician-ecg');
    await until(engine, () => engine.workflowStep === 19); const committed = canonical(engine.state.ledger);
    await engine.revokeConsent('CONSENT-0001'); await engine.next();
    expect(engine.activeRequest?.status).toBe('DENIED'); expect(engine.activeRequest?.denialRule).toBe('CONSENT-001');
    expect(engine.activeRequest?.releasedRecordIds).toEqual([]); expect(canonical(engine.state.ledger)).toBe(committed);
    await complete(engine); expect(engine.state.ledger.at(-1)?.transactions[0].decision).toBe('DENY');
  });

  it('revocation affects subsequent requests without erasing a prior downloaded copy', async () => {
    const engine = await Simulator.create(); await engine.loadScenario('clinician-ecg'); await complete(engine); const delivered = engine.activeRequest!;
    await engine.revokeConsent('CONSENT-0001'); await engine.submitRequest({ actorType: 'clinician', recordIds: ['R002'], purpose: 'TREATMENT' }); await complete(engine);
    expect(engine.activeRequest?.denialRule).toBe('CONSENT-001');
    expect(delivered.status).toBe('DELIVERED'); expect(delivered.releasedRecordIds).toEqual(['R002']);
  });

  it('holds sensitive release for two distinct committee approvals', async () => {
    const engine = await Simulator.create(); await engine.loadScenario('sensitive-approval'); await until(engine, () => engine.activeRequest?.status === 'AWAITING_REVIEW', false);
    await engine.review(true); await engine.addApproval('CMIO'); await engine.next();
    expect(engine.activeRequest?.status).toBe('AWAITING_APPROVALS'); expect(engine.state.tokens).toHaveLength(0);
    await expect(engine.addApproval('CMIO')).rejects.toThrow(/already/);
    await expect(engine.addApproval('RECORDS_OFFICER')).rejects.toThrow(/committee/);
    await engine.addApproval('PRIVACY_OFFICER'); await complete(engine);
    expect(engine.activeRequest?.status).toBe('DELIVERED'); expect(engine.activeRequest?.approvals).toEqual(['CMIO', 'PRIVACY_OFFICER']);
  });

  it('detects a changed request payload after authentication rather than trusting an earlier challenge flag', async () => {
    const engine = await Simulator.create(); await until(engine, () => engine.workflowStep === 13);
    engine.activeRequest!.recordIds = ['R002'];
    await expect(engine.review(true)).rejects.toThrow(/mandatory denial/);
    await complete(engine);
    expect(engine.activeRequest?.denialRule).toBe('AUTH-001'); expect(engine.state.tokens).toHaveLength(0);
  });
});

describe('governed policy changes', () => {
  it('a proposal and one vote have no effect; two distinct votes still need finalized commitment', async () => {
    const engine = await Simulator.create(); await engine.submitRequest({ recordIds: ['R001'] });
    await engine.propose('minAssurance', 3, 'Raise assurance for this classroom comparison.'); const proposal = engine.state.proposals[0];
    expect(engine.state.policy.version).toBe(1); expect(evaluateAccessRequest(engine.activeRequest!, engine.state, { requireApprovals: false }).decision).toBe('PERMIT');
    await engine.vote(proposal.id, 'CMIO', 'APPROVE');
    expect(engine.state.policy.minAssurance).toBe(2); await expect(engine.advanceProposal(proposal.id)).rejects.toThrow(/Two distinct/);
    await expect(engine.vote(proposal.id, 'CMIO', 'APPROVE')).rejects.toThrow(/already/);
    await engine.vote(proposal.id, 'PRIVACY_OFFICER', 'APPROVE'); expect(engine.state.policy.version).toBe(1);
    for (let i = 0; i < 4; i++) await engine.advanceProposal(proposal.id);
    expect(engine.state.proposals[0].consensus.phase).toBe('FINALIZED'); expect(engine.state.policy.version).toBe(1);
    await engine.advanceProposal(proposal.id); expect(engine.state.policy.version).toBe(2); expect(engine.state.policy.minAssurance).toBe(3);
  });

  it('activated assurance rule changes real decisions; Level 3 evidence restores eligibility for a new request', async () => {
    const engine = await Simulator.create(); await complete(engine);
    const previousAudit = cloneAudit(engine); const firstRequest = engine.activeRequest!;
    await activate(engine, 'minAssurance', 3); await engine.submitRequest({ recordIds: ['R001'] }); await complete(engine);
    expect(engine.activeRequest?.denialRule).toBe('GOV-ASSURANCE'); expect(engine.activeRequest?.policyVersion).toBe(2);
    expect(firstRequest.status).toBe('DELIVERED'); expect(firstRequest.policyVersion).toBe(1);
    expect(engine.state.audit.slice(0, previousAudit.length)).toEqual(previousAudit);
    await engine.setAssurance(3); await engine.submitRequest({ recordIds: ['R001'] }); await complete(engine);
    expect(engine.activeRequest?.status).toBe('DELIVERED'); expect(engine.activeRequest?.policyVersion).toBe(2);
  });

  it('rechecks a pending request against new rules even after its original consensus finalized', async () => {
    const engine = await Simulator.create(); await until(engine, () => engine.workflowStep === 17 && engine.state.consensus.phase === 'FINALIZED');
    await activate(engine, 'minAssurance', 3); await engine.next();
    expect(engine.activeRequest?.denialRule).toBe('GOV-ASSURANCE'); expect(engine.activeRequest?.policyVersion).toBe(2);
    await complete(engine);
    expect(engine.state.tokens).toHaveLength(0);
    expect(engine.state.ledger.at(-1)?.transactions[0]).toMatchObject({ decision: 'DENY', policyVersion: 2 });
  });

  it('preserves a previously committed authorization if a new policy denies token issuance', async () => {
    const engine = await Simulator.create(); await until(engine, () => engine.workflowStep === 18); const permissionBlock = clone(engine.state.ledger[1]);
    await activate(engine, 'minAssurance', 3); await engine.next(); await complete(engine);
    expect(engine.activeRequest?.status).toBe('DENIED'); expect(engine.state.tokens).toHaveLength(0);
    expect(engine.state.ledger[1]).toEqual(permissionBlock); expect(engine.state.ledger.at(-1)?.transactions[0].policyVersion).toBe(2);
  });

  it('uses the governed token lifetime for new tokens without rewriting older tokens', async () => {
    const engine = await Simulator.create(); await complete(engine); const original = clone(engine.state.tokens[0]);
    await activate(engine, 'tokenMinutes', 2); await engine.submitRequest({ recordIds: ['R001'] }); await until(engine, () => engine.workflowStep === 19);
    const latest = engine.state.tokens.at(-1)!;
    expect(latest.expiresAt - latest.issuedAt).toBe(120000); expect(engine.state.tokens[0]).toEqual(original);
  });

  it('resumes newly required manual review before retrieval with the same unused token', async () => {
    const engine = await Simulator.create(); await activate(engine, 'manualReview', false); await engine.submitRequest({ recordIds: ['R001'] }); await until(engine, () => engine.workflowStep === 19);
    const tokenId = engine.activeRequest!.tokenId; await activate(engine, 'manualReview', true); await engine.next();
    expect(engine.activeRequest?.status).toBe('AWAITING_REVIEW'); expect(engine.state.tokens[0].used).toBe(false);
    await engine.review(true); await complete(engine);
    expect(engine.activeRequest?.status).toBe('DELIVERED'); expect(engine.activeRequest?.tokenId).toBe(tokenId); expect(engine.state.tokens).toHaveLength(1);
  });

  it('holds a staged sensitive report when threshold increases, then resumes delivery without token replay', async () => {
    const engine = await Simulator.create(); await activate(engine, 'sensitiveApprovals', 1); await engine.submitRequest({ recordIds: ['R007'] }); await until(engine, () => engine.workflowStep === 21);
    expect(engine.activeRequest?.approvals).toEqual(['CMIO']); const tokenId = engine.activeRequest!.tokenId;
    await activate(engine, 'sensitiveApprovals', 2); await engine.next();
    expect(engine.state.finished).toBe(false); expect(engine.activeRequest?.status).toBe('AWAITING_APPROVALS'); expect(engine.activeRequest?.releasedRecordIds).toEqual([]);
    await engine.next(); expect(engine.state.finished).toBe(false);
    await engine.addApproval('PRIVACY_OFFICER'); await complete(engine);
    expect(engine.activeRequest?.status).toBe('DELIVERED'); expect(engine.activeRequest?.tokenId).toBe(tokenId); expect(engine.state.tokens).toHaveLength(1);
    expect(engine.state.audit.filter(e => e.type === 'CAPABILITY_TOKEN_CONSUMED')).toHaveLength(1);
  });

  it('does not activate rejected, expired, stale, or insufficient-quorum proposals', async () => {
    const engine = await Simulator.create(); await engine.propose('minAssurance', 3, 'Reject this example policy proposal.'); const rejected = engine.state.proposals[0].id;
    await engine.vote(rejected, 'CMIO', 'REJECT'); await expect(engine.advanceProposal(rejected)).rejects.toThrow(/rejected/);
    await engine.propose('tokenMinutes', 2, 'A proposal used for expiry testing.'); const expired = engine.state.proposals[1].id;
    await engine.advanceClock(31); await expect(engine.advanceProposal(expired)).rejects.toThrow(/expired/);
    await engine.reset(); await engine.propose('tokenMinutes', 2, 'An older proposal should become stale.'); const stale = engine.state.proposals[0].id;
    await activate(engine, 'minAssurance', 3); await engine.advanceProposal(stale); expect(engine.state.proposals[0].status).toBe('STALE');
    await engine.reset(); await engine.setValidator('H3', false); await engine.setValidator('H4', false);
    await engine.propose('minAssurance', 3, 'Requires committee and validator agreement.'); const pending = engine.state.proposals[0].id;
    await engine.vote(pending, 'CMIO', 'APPROVE'); await engine.vote(pending, 'PRIVACY_OFFICER', 'APPROVE');
    for (let i = 0; i < 3; i++) await engine.advanceProposal(pending);
    expect(engine.state.proposals[0].status).toBe('PENDING_FINALITY'); expect(engine.state.policy.version).toBe(1);
  });

  it('does not reuse committee approvals after the proposal terms are altered', async () => {
    const engine = await Simulator.create(); await engine.propose('tokenMinutes', 2, 'This exact two-minute proposal must be approved.'); const id = engine.state.proposals[0].id;
    await engine.vote(id, 'CMIO', 'APPROVE'); await engine.vote(id, 'PRIVACY_OFFICER', 'APPROVE');
    engine.state.proposals[0].newValue = 60;
    await expect(engine.advanceProposal(id)).rejects.toThrow(/exact proposal terms/);
    expect(engine.state.policy.tokenMinutes).toBe(10); expect(engine.state.policy.version).toBe(1); expect(engine.state.ledger).toHaveLength(1);
    expect(engine.state.audit.some(e => e.type === 'GOVERNANCE_APPROVAL_INVALID')).toBe(true);
  });

  it('cannot cross the proposal expiry boundary in the activation tick', async () => {
    const engine = await Simulator.create(); await engine.propose('minAssurance', 3, 'Check exact activation expiry boundary.'); const id = engine.state.proposals[0].id;
    await engine.vote(id, 'CMIO', 'APPROVE'); await engine.vote(id, 'PRIVACY_OFFICER', 'APPROVE');
    for (let i = 0; i < 4; i++) await engine.advanceProposal(id);
    engine.state.clock = engine.state.proposals[0].expiresAt - 500;
    await engine.advanceProposal(id); expect(engine.state.proposals[0].status).toBe('EXPIRED'); expect(engine.state.policy.version).toBe(1);
  });
});

describe('consensus, integrity, capabilities, and replay', () => {
  it('finalizes with one offline validator but cannot finalize with two; recovers after explicit restoration', async () => {
    const engine = await Simulator.create(); await engine.loadScenario('one-offline'); await complete(engine);
    expect(engine.activeRequest?.status).toBe('DELIVERED'); expect(engine.state.consensus.committed).toEqual(['H1', 'H2', 'H4']);
    await engine.loadScenario('two-offline'); await until(engine, () => engine.state.consensus.phase === 'UNAVAILABLE');
    expect(engine.activeRequest?.status).toBe('PENDING_FINALITY'); expect(engine.state.tokens).toHaveLength(0); expect(engine.state.ledger).toHaveLength(1);
    await engine.setValidator('H3', true); await complete(engine); expect(engine.activeRequest?.status).toBe('DELIVERED');
  });

  it('faulty validators do not contribute matching votes', async () => {
    const engine = await Simulator.create(); await engine.setValidator('H3', true, true); await engine.setValidator('H4', false);
    await until(engine, () => engine.state.consensus.phase === 'UNAVAILABLE');
    expect(engine.state.consensus.prepared).toHaveLength(2); expect(engine.state.tokens).toHaveLength(0);
  });

  it('tampered vault data fails real SHA-256 verification without modifying its earlier permission block', async () => {
    const engine = await Simulator.create(); await engine.loadScenario('tampered-record'); await until(engine, () => engine.workflowStep === 18);
    const permission = clone(engine.state.ledger[1]); const original = clone(engine.state.records[0]);
    await complete(engine); expect(engine.activeRequest?.status).toBe('DENIED'); expect(engine.activeRequest?.denialRule).toBe('INTEGRITY-001'); expect(engine.activeRequest?.releasedRecordIds).toEqual([]);
    expect(engine.state.ledger[1]).toEqual(permission); expect(engine.state.records[0]).toEqual(original);
    expect(await hashRecord(engine.state.records[0].content)).toBe(original.originalHash);
    expect(engine.state.audit.some(e => e.type === 'RECORD_INTEGRITY_FAILED')).toBe(true);
    expect(engine.state.ledger.at(-1)?.transactions[0].decision).toBe('DENY');
    expect((await verifyChain(engine.state.ledger)).valid).toBe(true);
  });

  it('blocks expired capabilities at the exact boundary and keeps the original authorization evidence', async () => {
    const engine = await Simulator.create(); await engine.loadScenario('expired-token'); await until(engine, () => engine.workflowStep === 19);
    expect(engine.state.pending).toBe(true); const token = engine.state.tokens[0]; engine.state.clock = token.expiresAt;
    await engine.redeemToken(token.id); expect(engine.activeRequest?.status).toBe('DENIED'); expect(engine.activeRequest?.denialRule).toBe('TOKEN-EXPIRY');
    expect(engine.activeRequest?.releasedRecordIds).toEqual([]); expect(token.used).toBe(false);
  });

  it('serializes simultaneous redemption calls so only one consumes a token or releases records', async () => {
    const engine = await Simulator.create(); await until(engine, () => engine.workflowStep === 19); const token = engine.state.tokens[0];
    await Promise.all([engine.redeemToken(token.id), engine.redeemToken(token.id)]);
    expect(engine.activeRequest?.status).toBe('DELIVERED'); expect(token.used).toBe(true);
    expect(engine.state.audit.filter(e => e.type === 'CAPABILITY_TOKEN_CONSUMED')).toHaveLength(1);
    expect(engine.state.audit.filter(e => e.type === 'RECORD_ACCESS_GRANTED')).toHaveLength(1);
    expect(engine.state.audit.some(e => e.type === 'TOKEN_REPLAY_DENIED')).toBe(true);
    expect(engine.state.execution.result).toBe('FAIL');
  });

  it('blocks late consent revocation after staging but before actual disclosure', async () => {
    const engine = await Simulator.create(); await engine.loadScenario('clinician-ecg'); await until(engine, () => engine.workflowStep === 21);
    await engine.revokeConsent('CONSENT-0001'); await engine.next();
    expect(engine.activeRequest?.status).toBe('DENIED'); expect(engine.activeRequest?.releasedRecordIds).toEqual([]);
    expect(engine.state.tokens[0].used).toBe(true); await complete(engine); expect(engine.state.ledger.at(-1)?.transactions[0].decision).toBe('DENY');
  });

  it('history inspection, visual replay, and repeated completed next actions never duplicate committed state', async () => {
    const engine = await Simulator.create(); await complete(engine); const ledger = canonical(engine.state.ledger); const audit = canonical(engine.state.audit); const token = canonical(engine.state.tokens);
    const snapshot = engine.frames.find(f => f.step === 3)!;
    snapshot.state.requests[0].recordIds.push('R009'); // presentation copy is not live state
    for (let i = 0; i < 10; i++) await engine.next();
    expect(canonical(engine.state.ledger)).toBe(ledger); expect(canonical(engine.state.audit)).toBe(audit); expect(canonical(engine.state.tokens)).toBe(token);
    expect(engine.activeRequest?.recordIds).toEqual(['R001']);
    await engine.loadScenario('own-lab'); expect(engine.state.ledger).toHaveLength(1); expect(engine.state.requests).toHaveLength(0);
  });

  it('stores only metadata on-chain and keeps all ledger hashes verifiable', async () => {
    const engine = await Simulator.create(); await complete(engine); await activate(engine, 'minAssurance', 3);
    const encoded = canonical(engine.state.ledger);
    for (const forbidden of ['Ayesha', 'Omar', 'Sara', 'Hemoglobin', 'clinicalNote', 'Synthetic normal sinus rhythm']) expect(encoded).not.toContain(forbidden);
    expect(engine.state.ledger[0].transactions.some(tx => tx.eventType === 'DEMO_REPORT_MERKLE_ANCHOR')).toBe(true);
    expect((await verifyChain(engine.state.ledger)).valid).toBe(true);
  });
});

function cloneAudit(engine: Simulator) { return structuredClone(engine.state.audit); }
function clone<T>(value: T): T { return structuredClone(value); }
