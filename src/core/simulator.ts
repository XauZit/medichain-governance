import type { AccessRequest, AuditEvent, Category, CapabilityToken, ConsensusState, HistoryFrame, LedgerEvent, Outcome, RequestInput, RuleKey, RuleResult, SimulationState, StepExecution } from './types';
import { COMMITTEE } from './types';
import { canonical, createBlock, hashRecord, sha256, simulatedSignature } from './crypto';
import { checkConsent, evaluateABAC, evaluateAccessRequest, evaluateGovernancePolicy, evaluateRBAC, issueCapabilityToken, validateCapabilityToken, verifyCredential, verifyDID, verifyRecordOwnership } from './policy';
import { castVote, checkMultisigThreshold, consensusStep, createProposal, verifyProposalVotes } from './governance';
import { createInitialState, DEFAULT_REQUEST, emptyConsensus, INITIAL_CLOCK, requestPayload } from './fixtures';
import { getScenario } from './scenarios';
import { STEPS } from './steps';

interface Redemption { tokenId: string; contents: Record<string, Record<string, unknown>>; verified: boolean }
interface Workflow { step: number; denied: boolean; event: LedgerEvent | null; consensus: ConsensusState; redemption: Redemption | null; lastExecution?: StepExecution; resumeGate?: 20 | 22 }

const clone = <T,>(value: T): T => structuredClone(value);
const committeeIds = new Set(COMMITTEE.map(m => m.id));

/**
 * An explicit, serialized, local state machine. It never runs in the background.
 * UI playback calls next(); navigating frames only reads immutable snapshots.
 */
export class Simulator {
  state: SimulationState;
  frames: HistoryFrame[] = [];
  private queue: Promise<void> = Promise.resolve();
  private workflows = new Map<string, Workflow>();
  private introStep = 1;
  private initialClock: number;

  private constructor(state: SimulationState, initialClock: number) { this.state = state; this.initialClock = initialClock; this.snapshot('Patient portal ready'); }

  static async create(clock = INITIAL_CLOCK): Promise<Simulator> { return new Simulator(await createInitialState(clock), clock); }

  get activeRequest(): AccessRequest | undefined { return this.state.requests.find(r => r.id === this.state.activeRequestId); }
  get workflowStep(): number { return this.activeRequest ? this.workflow().step : this.introStep; }

  private serialize(action: () => Promise<void>): Promise<void> {
    const operation = this.queue.then(action);
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  private tick(): void { this.state.clock += 1000; }
  private workflow(): Workflow {
    const current = this.state.activeRequestId && this.workflows.get(this.state.activeRequestId);
    if (!current) throw new Error('Start or select a request first.');
    return current;
  }

  private request(): AccessRequest { const request = this.activeRequest; if (!request) throw new Error('Create a request first.'); return request; }

  private snapshot(label: string): void {
    this.frames.push({ id: this.frames.length, step: this.state.step, label, state: clone(this.state) });
  }

  private show(step: number, result: Outcome, explanation: string, inputs: Record<string, unknown>, stateChange: string, updateWorkflow = true): void {
    this.state.step = step;
    this.state.execution = { step, result, explanation, inputs: clone(inputs), stateChange };
    if (updateWorkflow && this.activeRequest) { const flow = this.workflow(); flow.step = step; flow.lastExecution = clone(this.state.execution); }
    this.snapshot(`${String(step).padStart(2, '0')} · ${STEPS[step - 1]?.short ?? 'Simulation'} · ${result}`);
  }

  private audit(type: string, outcome: string, explanation: string, actor = 'HOSPITAL_SYSTEM', requestId?: string, location: AuditEvent['location'] = 'LOCAL_AUDIT', txRef?: string, policyVersion = this.state.policy.version): AuditEvent {
    const event: AuditEvent = { id: `EVT-${String(++this.state.eventSequence).padStart(5, '0')}`, timestamp: this.state.clock, actor, requestId, type, outcome, policyVersion, txRef, explanation, location };
    this.state.audit.push(event);
    return event;
  }

  private addChecks(request: AccessRequest, checks: RuleResult[]): void {
    for (const check of checks) { const index = request.checks.findIndex(c => c.ruleId === check.ruleId); if (index < 0) request.checks.push(clone(check)); else request.checks[index] = clone(check); }
  }

  private async deny(request: AccessRequest, check: RuleResult, step: number): Promise<void> {
    this.addChecks(request, [check]);
    request.policyVersion = check.policyVersion;
    request.status = 'DENIED'; request.denialReason = check.explanation; request.denialRule = check.ruleId;
    request.releasedRecordIds = [];
    const token = this.state.tokens.find(t => t.id === request.tokenId);
    if (token) token.revoked = true;
    const flow = this.workflow(); flow.denied = true; flow.event = null; flow.consensus = emptyConsensus(); flow.redemption = null; delete flow.resumeGate;
    this.state.consensus = clone(flow.consensus); this.state.pending = false; this.state.finished = false;
    this.audit('ACCESS_DENIED', 'DENY', `${check.ruleId}: ${check.explanation}`, 'POLICY_ENGINE', request.id);
    this.show(step, 'FAIL', check.explanation, check.inputs, 'Request denied. No content is released. Continue to record the denial decision on the simulated ledger.');
  }

  async reset(): Promise<void> { return this.loadScenario('own-lab'); }

  async loadScenario(id: string): Promise<void> {
    return this.serialize(async () => {
      const scenario = getScenario(id);
      this.state = await createInitialState(this.initialClock); this.workflows.clear(); this.frames = []; this.introStep = 1;
      this.state.scenarioId = id;
      const input = this.state.requestInput;
      if (id === 'wrong-owner') input.recordIds = ['R009'];
      if (id === 'bad-identity') input.challengeValid = false;
      if (id === 'revoked-credential') this.state.patients[0].credential.revoked = true;
      if (id === 'bad-role') input.officerRole = 'RECEPTIONIST';
      if (['clinician-ecg', 'consent-scope', 'consent-revoked'].includes(id)) { input.actorType = 'clinician'; input.purpose = 'TREATMENT'; input.recordIds = [id === 'consent-scope' ? 'R006' : 'R002']; }
      if (id === 'consent-revoked') { this.state.consents[0].revoked = true; this.audit('CONSENT_REVOKED', 'REVOKED', 'Seeded experiment: the patient revoked the prior clinician grant. Future retrieval must recheck consent.', 'P001'); }
      if (id === 'sensitive-approval') input.recordIds = ['R007'];
      if (id === 'tampered-record') { this.state.tamperedCopies.R001 = { ...clone(this.state.records[0].content), classroomAlteration: 'A synthetic value was changed in an isolated vault copy.' }; this.audit('TAMPER_EXPERIMENT_CREATED', 'EXPERIMENT', 'A separate record copy was changed. The original data, original hash anchor, and ledger are unchanged.', 'DEMO_OPERATOR'); }
      if (['one-offline', 'two-offline'].includes(id)) this.state.validators[2].online = false;
      if (id === 'two-offline') this.state.validators[3].online = false;
      this.state.execution = { step: 1, result: 'PASS', explanation: scenario.description, inputs: { scenario: scenario.id, initialConditions: scenario.initialConditions, expected: scenario.expected }, stateChange: 'A fresh isolated demonstration dataset is ready. Earlier scenarios are intentionally reset; visual history within this run remains read-only.' };
      this.snapshot(`Scenario · ${scenario.name}`);
    });
  }

  async submitRequest(input: RequestInput = {}): Promise<void> { return this.serialize(() => this.createRequest(input)); }

  private async createRequest(input: RequestInput): Promise<void> {
    const configuration: RequestInput = { ...DEFAULT_REQUEST, ...this.state.requestInput, ...clone(input) };
    if (input.actorType && !input.purpose) configuration.purpose = input.actorType === 'clinician' ? 'TREATMENT' : 'SELF_ACCESS';
    if (!configuration.recordIds?.length) throw new Error('Select at least one medical-history record.');
    const patient = this.state.patients.find(p => p.id === configuration.patientId);
    if (!patient) throw new Error('Select an existing fictional patient.');
    this.tick();
    const id = `REQ-${String(++this.state.requestSequence).padStart(4, '0')}`;
    const request: AccessRequest = {
      id, patientId: patient.id, actorType: configuration.actorType ?? 'patient', actorId: configuration.actorType === 'clinician' ? 'DR_KHAN' : patient.id,
      recordIds: [...configuration.recordIds], purpose: configuration.purpose ?? 'SELF_ACCESS', hospitalId: configuration.hospitalId ?? 'H1',
      createdAt: this.state.clock, nonce: `request:${id}:${this.state.clock}`, signature: '', challengeValid: configuration.challengeValid ?? true,
      officerRole: configuration.officerRole ?? 'RECORDS_OFFICER', onShift: configuration.onShift ?? true, relationship: configuration.relationship ?? true,
      status: 'SUBMITTED', policyVersion: this.state.policy.version, checks: [], approvals: [], review: 'PENDING', releasedRecordIds: [],
    };
    request.signature = await simulatedSignature(requestPayload(request), request.actorType === 'clinician' ? 'DEMO-PUB-DR-KHAN' : patient.publicKey);
    this.state.requests.push(request); this.state.activeRequestId = request.id; this.state.requestInput = clone(configuration);
    this.workflows.set(request.id, { step: 3, denied: false, event: null, consensus: emptyConsensus(), redemption: null });
    this.state.consensus = emptyConsensus(); this.state.finished = false; this.state.pending = false;
    this.audit('PATIENT_REQUEST_CREATED', 'SUBMITTED', 'A scoped request with a unique nonce was added to the shared hospital queue; medical contents remain in the vault.', request.actorId, request.id);
    this.show(3, 'PASS', 'The same request is now visible in both portals. The queued payload contains record references and a clearly simulated authentication fingerprint.', { requestRef: id, actorType: request.actorType, recordRefs: request.recordIds, purpose: request.purpose, nonce: request.nonce, fingerprint: request.signature }, 'Shared request state: SUBMITTED.');
  }

  async selectRequest(id: string): Promise<void> {
    return this.serialize(async () => {
      const request = this.state.requests.find(r => r.id === id); const flow = this.workflows.get(id);
      if (!request || !flow) throw new Error('This request is not present in the current scenario.');
      this.state.activeRequestId = id; this.state.step = flow.step; this.state.consensus = clone(flow.consensus);
      this.state.execution = clone(flow.lastExecution ?? { step: flow.step, result: 'PENDING' as Outcome, explanation: 'Selected request restored for inspection.', inputs: { requestRef: id }, stateChange: 'Presentation focus changed; no approvals or ledger events were repeated.' });
      this.state.finished = flow.step === 23;
      this.state.pending = ['AWAITING_REVIEW', 'AWAITING_APPROVALS', 'PENDING_FINALITY'].includes(request.status);
      this.snapshot(`Inspect ${id}`);
    });
  }

  async next(): Promise<void> { return this.serialize(() => this.advance()); }

  private async advance(): Promise<void> {
    if (!this.activeRequest) {
      if (this.introStep === 1) { this.introStep = 2; this.tick(); this.show(2, 'PASS', 'The requested scope is selected. These are references to reports, not the contents of the reports.', { recordRefs: this.state.requestInput.recordIds ?? [], purpose: this.state.requestInput.purpose ?? 'SELF_ACCESS' }, 'Request draft is ready; submitting will create a hospital queue item.'); return; }
      await this.createRequest(this.state.requestInput); return;
    }
    const request = this.request(); const flow = this.workflow();
    if (flow.step === 23) return;
    if (flow.denied) {
      if (!flow.event) return this.prepareDecision(request, true);
      if (flow.step < 15 || flow.step > 18) return this.prepareDecision(request, true);
      if (flow.step === 15) return this.broadcastDecision(request);
      if (flow.step === 16 || (flow.step === 17 && flow.consensus.phase !== 'FINALIZED')) return this.advanceConsensus(request);
      if (flow.step === 17) return this.commitDecision(request);
      return this.finish(request);
    }
    switch (flow.step + 1) {
      case 4: return this.authenticate(request);
      case 5:
        this.tick(); request.status = 'VERIFYING'; this.audit('HOSPITAL_REQUEST_RECEIVED', 'VERIFYING', 'The hospital accepted the scoped request into its verification workstation.', 'RECORDS_OFFICER', request.id);
        this.show(5, 'PASS', 'The hospital is processing the same request that the patient submitted.', { requestRef: request.id, queueStatus: request.status, hospitalRef: request.hospitalId }, 'Shared request state: VERIFYING.'); return;
      case 6: return this.runCheck(request, 6, verifyDID(request, this.state), 'DID_VERIFIED');
      case 7: return this.runCheck(request, 7, verifyCredential(request, this.state), 'CREDENTIAL_VALIDATED');
      case 8: return this.runCheck(request, 8, verifyRecordOwnership(request, this.state), 'OWNERSHIP_VERIFIED');
      case 9: return this.runCheck(request, 9, evaluateRBAC(request, this.state), 'RBAC_EVALUATED');
      case 10: return this.runCheck(request, 10, evaluateABAC(request, this.state), 'ABAC_EVALUATED');
      case 11:
        this.tick(); request.policyVersion = this.state.policy.version;
        this.show(11, 'PASS', `Policy v${this.state.policy.version} is the active committed configuration. Draft proposals do not change this request.`, { activeVersion: this.state.policy.version, minAssurance: this.state.policy.minAssurance, tokenMinutes: this.state.policy.tokenMinutes, sensitiveApprovals: this.state.policy.sensitiveApprovals }, `Evaluation is bound to active policy v${this.state.policy.version}.`); return;
      case 12: {
        this.tick(); const checks = evaluateGovernancePolicy(request, this.state); this.addChecks(request, checks); request.policyVersion = this.state.policy.version;
        const failure = checks.find(c => c.result === 'FAIL'); if (failure) return this.deny(request, failure, 12);
        this.audit('GOVERNANCE_POLICY_EVALUATED', 'ELIGIBLE', 'Active assurance, hospital scope, and applicable context rules passed. Approval and consent obligations are evaluated separately.', 'POLICY_ENGINE', request.id);
        this.show(12, 'PASS', 'The executable governance rules permit the request to continue. This is eligibility, not a release of medical data.', { activeVersion: this.state.policy.version, rules: checks.map(c => ({ rule: c.ruleId, result: c.result, actual: c.actual })) }, 'Operational rule checks recorded with the active policy version.'); return;
      }
      case 13: {
        this.tick(); const check = checkConsent(request, this.state); this.addChecks(request, [check]);
        const evaluation = evaluateAccessRequest(request, this.state, { requireApprovals: false }); this.addChecks(request, evaluation.checks);
        const failure = evaluation.checks.find(c => c.result === 'FAIL'); if (failure) return this.deny(request, failure, 13);
        this.audit('CONSENT_EVALUATED', check.result, check.explanation, 'CONSENT_POLICY', request.id);
        this.show(13, check.result, check.explanation, check.inputs, 'Consent applicability recorded. No self-consent grant is required for patient self-access.'); return;
      }
      case 14: return this.waitForReview(request);
      case 15: {
        const evaluation = evaluateAccessRequest(request, this.state, { requireApprovals: true }); this.addChecks(request, evaluation.checks);
        const failure = evaluation.checks.find(c => c.result === 'FAIL'); if (failure) return this.deny(request, failure, 14);
        if (evaluation.decision === 'PENDING') return this.waitForReview(request);
        if (flow.resumeGate) {
          const gate = flow.resumeGate; delete flow.resumeGate;
          if (gate === 22) { request.status = 'RETRIEVING'; return this.deliver(request); }
          const token = this.state.tokens.find(t => t.id === request.tokenId);
          if (!token) throw new Error('No capability exists for this resumed retrieval.');
          request.status = 'TOKEN_ISSUED';
          return this.beginRedemption(request, token);
        }
        return this.prepareDecision(request, false);
      }
      case 16: return this.broadcastDecision(request);
      case 17: return this.advanceConsensus(request);
      case 18:
        if (flow.consensus.phase !== 'FINALIZED') return this.advanceConsensus(request);
        return this.commitDecision(request);
      case 19: return this.issueToken(request);
      case 20: {
        const token = this.state.tokens.find(t => t.id === request.tokenId);
        if (this.state.scenarioId === 'expired-token' && token && this.state.clock < token.expiresAt) {
          this.state.pending = true;
          this.show(19, 'PENDING', 'Expiry experiment paused: advance the simulation clock by 11 minutes, then redeem the token. You can also redeem a valid token immediately from the token console.', { expiresAt: token.expiresAt, now: this.state.clock, remainingSeconds: Math.ceil((token.expiresAt - this.state.clock) / 1000) }, 'No vault retrieval has happened.'); return;
        }
        if (!token) throw new Error('No issued capability exists for this request.');
        return this.beginRedemption(request, token);
      }
      case 21: return this.verifyIntegrity(request);
      case 22: return this.deliver(request);
      case 23: return this.finish(request);
      default: throw new Error('The selected workflow has an unsupported step.');
    }
  }

  private async recheckPayloadBinding(request: AccessRequest): Promise<void> {
    const patient = this.state.patients.find(p => p.id === request.patientId);
    const expected = await simulatedSignature(requestPayload(request), request.actorType === 'clinician' ? 'DEMO-PUB-DR-KHAN' : patient?.publicKey ?? 'UNKNOWN');
    if (expected !== request.signature) request.challengeValid = false;
  }

  private async authenticate(request: AccessRequest): Promise<void> {
    this.tick();
    const patient = this.state.patients.find(p => p.id === request.patientId);
    const fingerprint = await simulatedSignature(requestPayload(request), request.actorType === 'clinician' ? 'DEMO-PUB-DR-KHAN' : patient?.publicKey ?? 'UNKNOWN');
    if (fingerprint !== request.signature) request.challengeValid = false;
    const check = evaluateAccessRequest(request, this.state, { requireApprovals: false }).checks.find(c => c.ruleId === 'AUTH-001')!;
    check.inputs = { ...check.inputs, payloadHash: await sha256(canonical(requestPayload(request))), fingerprintMatches: fingerprint === request.signature };
    await this.runCheck(request, 4, check, 'REQUEST_AUTHENTICATED', false);
  }

  private async runCheck(request: AccessRequest, step: number, check: RuleResult, event: string, tick = true): Promise<void> {
    if (tick) this.tick();
    this.addChecks(request, [check]);
    if (check.result === 'FAIL') return this.deny(request, check, step);
    this.audit(event, check.result, check.explanation, 'HOSPITAL_VERIFIER', request.id);
    this.show(step, check.result, check.explanation, check.inputs, `${check.ruleId} recorded as ${check.result}.`);
  }

  private async waitForReview(request: AccessRequest): Promise<void> {
    const evaluation = evaluateAccessRequest(request, this.state, { requireApprovals: true }); this.addChecks(request, evaluation.checks);
    const failure = evaluation.checks.find(c => c.result === 'FAIL'); if (failure) return this.deny(request, failure, 14);
    if (evaluation.decision === 'PENDING') {
      request.status = this.state.policy.manualReview && request.review !== 'APPROVED' ? 'AWAITING_REVIEW' : 'AWAITING_APPROVALS';
      this.state.pending = true;
      this.show(14, 'PENDING', evaluation.explanation, { review: request.review, sensitiveApprovals: request.approvals, required: this.state.policy.sensitiveApprovals }, 'Waiting for an explicit authorized hospital action. Playback pauses here.'); return;
    }
    this.state.pending = false; request.status = 'APPROVED';
    const resumeGate = this.workflow().resumeGate;
    this.show(14, 'PASS', resumeGate ? `New review obligations are satisfied. Resume the existing ${resumeGate === 20 ? 'retrieval' : 'final disclosure'} gate; the earlier authorization and capability are preserved.` : 'All applicable review and distinct-approval obligations are satisfied. Validators must still finalize the decision.', { review: request.review, approvals: request.approvals, ...(resumeGate ? { resumeGate, capabilityRef: request.tokenId } : {}) }, resumeGate ? 'Approval obligations fulfilled; resume using the existing capability without issuing or consuming a duplicate.' : 'Shared request state: APPROVED; no token issued yet.');
  }

  async review(approve: boolean, actorId = 'RECORDS_OFFICER'): Promise<void> {
    return this.serialize(async () => {
      const request = this.request();
      if (actorId !== 'RECORDS_OFFICER' || request.officerRole !== 'RECORDS_OFFICER') throw new Error('Only the authorized Hospital Records Officer can review a release.');
      if (['DENIED', 'DELIVERED', 'COMMITTED', 'TOKEN_ISSUED', 'RETRIEVING'].includes(request.status) || this.workflow().denied) throw new Error('This request is no longer eligible for a new hospital review.');
      if (this.workflow().step < 12) throw new Error('Complete mandatory verification and policy evaluation before hospital review.');
      if (request.review !== 'PENDING') throw new Error('This review has already been recorded.');
      await this.recheckPayloadBinding(request);
      const evaluation = evaluateAccessRequest(request, this.state, { requireApprovals: false });
      if (approve && evaluation.decision === 'DENY') throw new Error(`Approval cannot override a mandatory denial: ${evaluation.explanation}`);
      this.tick(); request.review = approve ? 'APPROVED' : 'REJECTED';
      this.audit(approve ? 'HOSPITAL_REVIEW_APPROVED' : 'HOSPITAL_REVIEW_REJECTED', approve ? 'APPROVED' : 'REJECTED', approve ? 'The authorized records officer approved the otherwise eligible request. Finality and integrity are still required.' : 'The authorized records officer rejected this release request.', actorId, request.id);
      await this.waitForReview(request);
    });
  }

  async addApproval(actorId: string): Promise<void> {
    return this.serialize(async () => {
      const request = this.request();
      if (!committeeIds.has(actorId) || actorId === request.actorId) throw new Error('Sensitive-record approval requires an independent authorized committee member.');
      if (this.workflow().denied || ['COMMITTED', 'TOKEN_ISSUED', 'RETRIEVING', 'DELIVERED'].includes(request.status)) throw new Error('This request cannot accept a new release approval.');
      if (this.workflow().step < 12) throw new Error('Complete the policy checks before requesting committee approvals.');
      if (request.approvals.includes(actorId)) throw new Error('This committee member already approved. Duplicate approvals never count.');
      if (!request.recordIds.some(id => this.state.records.find(r => r.id === id)?.sensitive)) throw new Error('This ordinary request has no sensitive-record approval obligation.');
      const evaluation = evaluateAccessRequest(request, this.state, { requireApprovals: false });
      if (evaluation.decision === 'DENY') throw new Error(`Approval cannot override a mandatory denial: ${evaluation.explanation}`);
      this.tick(); request.approvals.push(actorId);
      this.audit('SENSITIVE_APPROVAL_RECORDED', 'APPROVED', `A distinct authorized committee member approved the sensitive release; ${request.approvals.length} recorded, ${this.state.policy.sensitiveApprovals} required.`, actorId, request.id);
      await this.waitForReview(request);
    });
  }

  private async prepareDecision(request: AccessRequest, denied: boolean): Promise<void> {
    this.tick();
    await this.recheckPayloadBinding(request);
    if (!denied) {
      const evaluation = evaluateAccessRequest(request, this.state, { requireApprovals: true }); this.addChecks(request, evaluation.checks);
      const failure = evaluation.checks.find(c => c.result === 'FAIL'); if (failure) return this.deny(request, failure, 15);
      if (evaluation.decision === 'PENDING') return this.waitForReview(request);
      request.policyVersion = this.state.policy.version; request.status = 'PROPOSED';
    }
    const event: LedgerEvent = {
      id: `TX-${request.id}-${denied ? 'DENY' : 'PERMIT'}-v${request.policyVersion}`,
      eventType: denied ? 'ACCESS_DENIED' : 'MEDICAL_HISTORY_ACCESS_APPROVED', requestRef: request.id,
      recordHashes: denied ? [] : request.recordIds.map(id => this.state.records.find(r => r.id === id)!.originalHash),
      policyVersion: request.policyVersion, decision: denied ? 'DENY' : 'PERMIT',
      subjectHash: await sha256(`subject:${request.actorId}`), payloadHash: await sha256(canonical(requestPayload(request))),
      ...(denied && request.denialRule ? { ruleId: request.denialRule } : {}),
    };
    const flow = this.workflow(); flow.event = event; flow.consensus = emptyConsensus(); this.state.consensus = clone(flow.consensus); this.state.pending = false;
    this.show(15, denied ? 'FAIL' : 'PASS', denied ? 'The denial is enforced immediately. A metadata-only denial event is now proposed for audit commitment.' : 'A metadata-only authorization event is ready for validator agreement. It contains no patient name, diagnosis, or report contents.', { transactionRef: event.id, decision: event.decision, policyVersion: event.policyVersion, hashCount: event.recordHashes?.length ?? 0, subjectHash: event.subjectHash }, 'Decision proposal created; it is not yet committed.');
  }

  private async broadcastDecision(request: AccessRequest): Promise<void> {
    const flow = this.workflow(); if (!flow.event) throw new Error('Construct a decision transaction before broadcast.');
    this.tick(); flow.consensus = emptyConsensus(); flow.consensus.digest = await sha256(canonical(flow.event)); this.state.consensus = clone(flow.consensus);
    this.audit('TRANSACTION_BROADCAST', 'PROPOSED', 'The same metadata-only decision digest was presented to the registered hospital consortium.', 'H1', request.id);
    this.show(16, 'PASS', 'The proposed decision digest is ready for the consortium. Available validators must independently match this exact value.', { digest: flow.consensus.digest, validators: this.state.validators.map(v => ({ id: v.id, online: v.online, faulty: v.faulty })) }, 'Proposal broadcast; no authorization finality yet.');
  }

  private async advanceConsensus(request: AccessRequest): Promise<void> {
    const flow = this.workflow(); if (!flow.event) throw new Error('No decision event is available for consensus.');
    this.tick();
    if (flow.consensus.phase === 'UNAVAILABLE') flow.consensus = emptyConsensus();
    flow.consensus = consensusStep(flow.consensus, this.state.validators, await sha256(canonical(flow.event)));
    this.state.consensus = clone(flow.consensus);
    const unavailable = flow.consensus.phase === 'UNAVAILABLE'; const finalized = flow.consensus.phase === 'FINALIZED';
    this.state.pending = unavailable;
    if (!flow.denied) request.status = unavailable ? 'PENDING_FINALITY' : 'PROPOSED';
    if (unavailable) this.audit('CONSENSUS_UNAVAILABLE', 'PENDING_FINALITY', 'Matching available validators cannot satisfy the prepare/commit quorum. No authorization block or capability is created.', 'CONSORTIUM', request.id);
    this.show(17, unavailable ? 'PENDING' : finalized ? 'PASS' : 'PENDING', flow.consensus.explanation, { phase: flow.consensus.phase, prepared: flow.consensus.prepared, committed: flow.consensus.committed, quorum: flow.consensus.quorum, digest: flow.consensus.digest }, unavailable ? 'Pending finality. Restore sufficient validators and retry; no medical data can be released.' : finalized ? 'A matching quorum certificate is ready. The ledger append occurs next.' : `Consensus phase: ${flow.consensus.phase}. Advance to show the next protocol phase.`);
  }

  private async commitDecision(request: AccessRequest): Promise<void> {
    const flow = this.workflow();
    if (!flow.event || flow.consensus.phase !== 'FINALIZED' || flow.consensus.committed.length < 3 || flow.consensus.prepared.length < 3) throw new Error('A matching prepared-and-committed quorum is required before appending a decision.');
    if (flow.consensus.digest !== await sha256(canonical(flow.event))) throw new Error('The finalized consensus digest does not match the proposed decision.');
    if (!flow.denied) {
      await this.recheckPayloadBinding(request);
      const evaluation = evaluateAccessRequest(request, this.state, { requireApprovals: true }); this.addChecks(request, evaluation.checks);
      const failure = evaluation.checks.find(c => c.result === 'FAIL'); if (failure) return this.deny(request, failure, 18);
      if (evaluation.decision === 'PENDING') { flow.event = null; flow.consensus = emptyConsensus(); return this.waitForReview(request); }
      if (flow.event.policyVersion !== this.state.policy.version) {
        this.audit('POLICY_RECHECK_REQUIRED', 'PENDING', 'The active policy changed during consensus; the prior certificate cannot authorize a new policy version.', 'POLICY_ENGINE', request.id);
        return this.prepareDecision(request, false);
      }
    }
    const existing = this.state.ledger.find(b => b.transactions.some(tx => tx.id === flow.event!.id));
    if (existing) { request.blockHash = existing.hash; this.show(18, flow.denied ? 'FAIL' : 'PASS', 'This exact transaction is already committed; the existing block is reused without appending a duplicate.', { blockIndex: existing.index, blockHash: existing.hash }, 'No duplicate ledger mutation.'); return; }
    this.tick();
    const block = await createBlock([flow.event], this.state.ledger.at(-1), this.state.clock, flow.event.policyVersion, flow.consensus.proposer, 'PBFT_COMMITTED');
    this.state.ledger.push(block); request.blockHash = block.hash;
    request.status = flow.denied ? 'DENIED' : 'COMMITTED'; this.state.pending = false;
    this.audit('CONSENSUS_COMMITTED', flow.event.decision, 'A metadata-only decision event was appended after three distinct matching prepare and commit votes.', 'CONSORTIUM', request.id, 'SIMULATED_LEDGER', block.hash, flow.event.policyVersion);
    this.show(18, flow.denied ? 'FAIL' : 'PASS', flow.denied ? 'The denial decision is committed. No token or release stages will execute.' : 'Authorization is now committed, but medical bytes are still in the vault. Token validation and integrity remain mandatory.', { blockIndex: block.index, blockHash: block.hash, previousHash: block.previousHash, merkleRoot: block.merkleRoot, decision: flow.event.decision }, `Block ${block.index} appended; earlier blocks remain unchanged.`);
  }

  private async issueToken(request: AccessRequest): Promise<void> {
    await this.recheckPayloadBinding(request);
    const evaluation = evaluateAccessRequest(request, this.state, { requireApprovals: true }); this.addChecks(request, evaluation.checks);
    const failure = evaluation.checks.find(c => c.result === 'FAIL'); if (failure) return this.deny(request, failure, 19);
    if (evaluation.decision === 'PENDING') return this.waitForReview(request);
    if (request.policyVersion !== this.state.policy.version) {
      this.audit('POLICY_RECHECK_REQUIRED', 'PENDING', 'A new active policy requires a fresh authorization event before a capability can be issued.', 'POLICY_ENGINE', request.id);
      return this.prepareDecision(request, false);
    }
    this.tick(); const token = issueCapabilityToken(request, this.state); this.state.tokens.push(token); request.tokenId = token.id; request.status = 'TOKEN_ISSUED';
    this.state.pending = this.state.scenarioId === 'expired-token';
    this.audit('CAPABILITY_TOKEN_ISSUED', 'ISSUED', `A scoped one-use capability expires after ${this.state.policy.tokenMinutes} simulated minutes. It contains no medical contents.`, 'HOSPITAL_RELEASE_SERVICE', request.id);
    this.show(19, 'PASS', this.state.scenarioId === 'expired-token' ? 'A valid capability was issued. This expiry experiment now pauses: advance the clock 11 minutes, then redeem it.' : 'The finalized permission produced a scoped, one-use capability. Its original expiry is fixed at issuance.', { tokenRef: token.id, subjectRef: token.subject, scope: token.recordIds, expiresAt: token.expiresAt, policyVersion: token.policyVersion, nonce: token.nonce }, 'Token issued. No record contents have been delivered.');
  }

  private async beginRedemption(request: AccessRequest, token: CapabilityToken): Promise<void> {
    this.tick(); await this.recheckPayloadBinding(request); const evaluation = validateCapabilityToken(token, request, this.state); this.addChecks(request, evaluation.checks);
    const failure = evaluation.checks.find(c => c.result === 'FAIL');
    if (failure) {
      if (request.status === 'DELIVERED') {
        this.audit(failure.ruleId === 'TOKEN-REPLAY' ? 'TOKEN_REPLAY_DENIED' : 'TOKEN_REDEMPTION_DENIED', 'DENY', `${failure.ruleId}: ${failure.explanation} Previously delivered copies are unaffected.`, request.actorId, request.id);
        this.state.pending = false; this.state.finished = true;
        this.show(20, 'FAIL', `${failure.explanation} The earlier successful release remains in history; no new retrieval occurs.`, failure.inputs, 'Replay or subsequent retrieval denied; previously delivered data is not erased.', false);
        return;
      }
      this.audit(failure.ruleId === 'TOKEN-EXPIRY' ? 'TOKEN_EXPIRED' : 'TOKEN_REDEMPTION_DENIED', 'DENY', failure.explanation, 'HOSPITAL_VAULT', request.id);
      return this.deny(request, failure, 20);
    }
    if (evaluation.decision === 'PENDING') { this.workflow().resumeGate = 20; await this.waitForReview(request); return; }
    token.used = true;
    const contents: Record<string, Record<string, unknown>> = {};
    for (const id of token.recordIds) { const record = this.state.records.find(r => r.id === id); if (!record) throw new Error('Authorized vault record is unavailable.'); contents[id] = clone(this.state.tamperedCopies[id] ?? record.content); }
    this.workflow().redemption = { tokenId: token.id, contents, verified: false };
    request.status = 'RETRIEVING'; this.state.pending = false;
    this.audit('CAPABILITY_TOKEN_CONSUMED', 'CONSUMED', 'The unique token nonce was consumed and only the authorized scope was staged for integrity verification. No content has been disclosed yet.', 'HOSPITAL_VAULT', request.id);
    this.show(20, 'PASS', 'The capability is valid and has now been consumed. The vault staged only its authorized scope; integrity must pass before disclosure.', { tokenRef: token.id, scope: token.recordIds, used: token.used, contentsStored: 'OFF_CHAIN_STAGING' }, 'Shared request state: RETRIEVING. Token cannot be used again.');
  }

  private async verifyIntegrity(request: AccessRequest): Promise<void> {
    const ticket = this.workflow().redemption; if (!ticket) throw new Error('A valid capability must be redeemed before integrity verification.');
    this.tick();
    const comparisons = await Promise.all(request.recordIds.map(async id => { const record = this.state.records.find(r => r.id === id)!; const actualHash = await hashRecord(ticket.contents[id]); const genesisAnchored = this.state.ledger[0].transactions.some(tx => tx.recordHashes?.includes(record.originalHash)); const authorizationAnchored = this.state.ledger.find(b => b.hash === request.blockHash)?.transactions.some(tx => tx.requestRef === request.id && tx.recordHashes?.includes(record.originalHash)); return { recordRef: id, expectedHash: record.originalHash, actualHash, matches: actualHash === record.originalHash && genesisAnchored && Boolean(authorizationAnchored) }; }));
    const verified = comparisons.every(c => c.matches); request.integrityValid = verified; ticket.verified = verified;
    const check: RuleResult = { ruleId: 'INTEGRITY-001', name: 'SHA-256 content integrity', policyVersion: this.state.policy.version, inputs: { comparisons }, expected: 'Every retrieved content digest equals its original and authorized hash anchor', actual: verified ? 'ALL_HASHES_MATCH' : 'HASH_MISMATCH', result: verified ? 'PASS' : 'FAIL', explanation: verified ? 'Every staged report matches its immutable original SHA-256 anchor and the committed authorization scope.' : 'A retrieved record differs from its anchored SHA-256 digest. The altered copy is untrusted and cannot be delivered.', contribution: verified ? 'PERMIT' : 'DENY' };
    this.addChecks(request, [check]);
    this.audit(verified ? 'RECORD_INTEGRITY_VERIFIED' : 'RECORD_INTEGRITY_FAILED', verified ? 'PASS' : 'FAIL', check.explanation, 'INTEGRITY_VERIFIER', request.id);
    if (!verified) return this.deny(request, check, 21);
    this.show(21, 'PASS', check.explanation, { comparisons }, 'Integrity is verified. The final release gate still checks current policy and token timing.');
  }

  private async deliver(request: AccessRequest): Promise<void> {
    const ticket = this.workflow().redemption; const token = this.state.tokens.find(t => t.id === ticket?.tokenId);
    if (!ticket?.verified || request.integrityValid !== true || !token?.used) throw new Error('Verified staged contents and a consumed authorized token are required before delivery.');
    this.tick(); await this.recheckPayloadBinding(request);
    const evaluation = evaluateAccessRequest(request, this.state, { requireApprovals: true }); this.addChecks(request, evaluation.checks);
    let failure = evaluation.checks.find(c => c.result === 'FAIL');
    if (!failure && (token.revoked || token.expiresAt <= this.state.clock)) failure = { ruleId: token.revoked ? 'TOKEN-REVOCATION' : 'TOKEN-EXPIRY', name: 'Final capability validity', policyVersion: this.state.policy.version, inputs: { expiresAt: token.expiresAt, now: this.state.clock, revoked: token.revoked }, expected: 'Capability remains unrevoked and unexpired at actual disclosure', actual: 'INVALID_AT_DELIVERY', result: 'FAIL', explanation: 'The capability expired or was revoked after retrieval began. Staged content cannot be disclosed.', contribution: 'DENY' };
    if (failure) return this.deny(request, failure, 22);
    if (evaluation.decision === 'PENDING') { this.workflow().resumeGate = 22; await this.waitForReview(request); return; }
    request.releasedRecordIds = [...token.recordIds]; request.status = 'DELIVERED'; this.state.pending = false;
    this.audit('RECORD_ACCESS_GRANTED', 'DELIVERED', 'Only the authorized, hash-verified scope was disclosed after current policy, consent, and timing checks. Medical contents remain off-chain.', request.actorId, request.id, 'LOCAL_AUDIT', request.blockHash);
    this.show(22, 'PASS', 'The authorized requester can now open the verified medical-history view. Both portals reflect this same successful release.', { recordRefs: request.releasedRecordIds, authorizationPolicyVersion: token.policyVersion, releasePolicyVersion: this.state.policy.version, hospitalRef: request.hospitalId }, 'Shared request state: DELIVERED. Verified record content is available off-chain.');
  }

  private async finish(request: AccessRequest): Promise<void> {
    if (!this.workflow().denied && request.status !== 'DELIVERED') throw new Error('A request cannot complete successfully before verified records are actually delivered.');
    this.tick(); this.state.finished = true; this.state.pending = false;
    const denied = this.workflow().denied;
    this.audit('WORKFLOW_COMPLETED', denied ? 'DENIED' : request.status, denied ? 'The request was denied and release stages were skipped. Inspect the failed rule and available commitment evidence.' : 'The completed workflow records authorization, finality, token use, integrity, and disclosure as separate evidence.', 'AUDITOR', request.id);
    this.show(23, denied ? 'FAIL' : 'PASS', denied ? `Denied: ${request.denialReason}` : 'The verified release is complete. Replaying a prior visualization reads snapshots and never repeats approvals, token use, or ledger writes.', { requestRef: request.id, decision: denied ? 'DENY' : 'PERMIT', policyVersion: request.policyVersion, blockHash: request.blockHash, auditEventCount: this.state.audit.filter(e => e.requestId === request.id).length }, 'Workflow complete. The original policy versions and ledger history remain intact.');
  }

  async redeemToken(id: string): Promise<void> {
    return this.serialize(async () => {
      const token = this.state.tokens.find(t => t.id === id); if (!token) throw new Error('Select an issued capability token.');
      const request = this.state.requests.find(r => r.id === token.requestId); if (!request) throw new Error('The token has no matching request.');
      this.state.activeRequestId = request.id;
      await this.beginRedemption(request, token);
      if (request.status !== 'RETRIEVING' || this.workflow().denied) return;
      await this.verifyIntegrity(request);
      if (this.workflow().denied) return;
      await this.deliver(request);
      if (this.state.requests.find(r => r.id === request.id)?.status === 'DELIVERED') await this.finish(request);
    });
  }

  async propose(key: RuleKey, value: number | boolean, justification: string): Promise<void> {
    return this.serialize(async () => {
      this.tick(); const proposal = createProposal(this.state, key, value, justification); this.state.proposals.push(proposal);
      this.audit('POLICY_CHANGE_PROPOSED', 'PENDING', `Proposal ${proposal.id} changes ${key} from ${String(proposal.oldValue)} to ${String(value)}. Active policy v${this.state.policy.version} is unchanged.`, 'GOVERNANCE_OFFICER');
      this.show(11, 'PENDING', 'A governance proposal has been created. It needs two distinct eligible committee approvals, then validator finality, before it can change any access decision.', { proposalRef: proposal.id, rule: key, oldValue: proposal.oldValue, proposedValue: value, baseVersion: proposal.baseVersion, expiresAt: proposal.expiresAt }, 'Proposal pending. The active policy is unchanged.', false);
    });
  }

  async vote(proposalId: string, actorId: string, decision: 'APPROVE' | 'REJECT'): Promise<void> {
    return this.serialize(async () => {
      const index = this.state.proposals.findIndex(p => p.id === proposalId); if (index < 0) throw new Error('Select an existing governance proposal.');
      if (this.state.proposals[index].baseVersion !== this.state.policy.version) { this.state.proposals[index].status = 'STALE'; throw new Error('The active policy changed. Create a new proposal against the current version.'); }
      this.tick(); this.state.proposals[index] = await castVote(this.state.proposals[index], actorId, decision, this.state.clock);
      const proposal = this.state.proposals[index];
      this.audit('GOVERNANCE_VOTE_RECORDED', decision, `A distinct ${actorId} vote was recorded for ${proposal.id}. ${proposal.votes.filter(v => v.decision === 'APPROVE').length} of 2 committee approvals; active policy remains v${this.state.policy.version}.`, actorId);
      this.show(14, proposal.status === 'REJECTED' ? 'FAIL' : 'PENDING', proposal.status === 'REJECTED' ? 'The proposal was rejected and cannot activate.' : checkMultisigThreshold(proposal.votes) ? 'Two distinct committee approvals are recorded. The policy still cannot activate until its change event reaches validator consensus and is committed.' : 'One committee approval is insufficient. The active policy and access decisions have not changed.', { proposalRef: proposal.id, votes: proposal.votes.map(v => ({ actor: v.actorId, decision: v.decision })), required: 2, activeVersion: this.state.policy.version }, `Proposal status: ${proposal.status}. Active policy unchanged.`, false);
    });
  }

  async advanceProposal(proposalId: string): Promise<void> {
    return this.serialize(async () => {
      const proposal = this.state.proposals.find(p => p.id === proposalId); if (!proposal) throw new Error('Select an existing governance proposal.');
      if (proposal.status === 'ACTIVATED') return;
      if (['REJECTED', 'EXPIRED', 'STALE'].includes(proposal.status)) throw new Error(`A ${proposal.status.toLowerCase()} proposal cannot activate.`);
      this.tick();
      if (proposal.expiresAt <= this.state.clock) { proposal.status = 'EXPIRED'; this.audit('GOVERNANCE_PROPOSAL_EXPIRED', 'EXPIRED', `Proposal ${proposal.id} expired before activation.`, 'GOVERNANCE_SERVICE'); this.show(14, 'FAIL', 'This proposal has expired. It cannot activate, even with earlier votes.', { proposalRef: proposal.id, expiresAt: proposal.expiresAt }, 'Expired proposal; active policy unchanged.', false); return; }
      if (proposal.baseVersion !== this.state.policy.version) { proposal.status = 'STALE'; this.audit('GOVERNANCE_PROPOSAL_STALE', 'STALE', `Proposal ${proposal.id} was based on an older policy version.`, 'GOVERNANCE_SERVICE'); this.show(11, 'FAIL', 'A newer policy is already active. This proposal must be recreated against that version.', { baseVersion: proposal.baseVersion, activeVersion: this.state.policy.version }, 'Stale proposal cannot overwrite the active policy.', false); return; }
      if (!checkMultisigThreshold(proposal.votes)) throw new Error('Two distinct eligible committee approvals are required before policy consensus.');
      if (!await verifyProposalVotes(proposal)) {
        this.audit('GOVERNANCE_APPROVAL_INVALID', 'DENY', `Committee approval fingerprints no longer bind the exact terms of ${proposal.id}; activation is blocked.`, 'GOVERNANCE_SERVICE');
        throw new Error('Committee approval fingerprints do not match the exact proposal terms. Submit a new proposal and obtain fresh approvals.');
      }
      const event: LedgerEvent = { id: `TX-${proposal.id}`, eventType: 'POLICY_VERSION_ACTIVATED', proposalRef: proposal.id, policyVersion: proposal.baseVersion + 1, decision: 'ACTIVATE', payloadHash: await sha256(canonical({ proposalRef: proposal.id, ruleKey: proposal.ruleKey, oldValue: proposal.oldValue, newValue: proposal.newValue, baseVersion: proposal.baseVersion, votes: proposal.votes.map(v => ({ actorId: v.actorId, decision: v.decision, signature: v.signature })) })) };
      const digest = await sha256(canonical(event));
      if (proposal.consensus.phase === 'FINALIZED') {
        if (proposal.consensus.digest !== digest || proposal.consensus.prepared.length < 3 || proposal.consensus.committed.length < 3) throw new Error('Policy activation needs a matching prepared-and-committed certificate.');
        const nextPolicy = { ...clone(this.state.policy), [proposal.ruleKey]: proposal.newValue, version: this.state.policy.version + 1, activatedAt: this.state.clock };
        const block = await createBlock([event], this.state.ledger.at(-1), this.state.clock, nextPolicy.version, proposal.consensus.proposer, 'PBFT_COMMITTED');
        this.state.ledger.push(block); this.state.policy = nextPolicy; this.state.policies.push(clone(nextPolicy)); proposal.status = 'ACTIVATED'; proposal.activatedVersion = nextPolicy.version;
        this.audit('POLICY_VERSION_ACTIVATED', 'ACTIVATED', `Proposal ${proposal.id} activated policy v${nextPolicy.version} after committee approval and validator commitment. Earlier audit versions remain unchanged.`, 'CONSORTIUM', undefined, 'SIMULATED_LEDGER', block.hash, nextPolicy.version);
        this.show(18, 'PASS', `Policy v${nextPolicy.version} is now active. New evaluations and pending release gates will read the approved ${proposal.ruleKey} value.`, { proposalRef: proposal.id, rule: proposal.ruleKey, newValue: proposal.newValue, activeVersion: nextPolicy.version, blockHash: block.hash }, 'New policy appended and activated; historical policy and audit versions retained.', false); return;
      }
      if (proposal.consensus.phase === 'UNAVAILABLE') proposal.consensus = emptyConsensus();
      proposal.consensus = consensusStep(proposal.consensus, this.state.validators, digest); this.state.consensus = clone(proposal.consensus);
      proposal.status = proposal.consensus.phase === 'UNAVAILABLE' ? 'PENDING_FINALITY' : 'APPROVED';
      this.show(17, proposal.consensus.phase === 'FINALIZED' ? 'PASS' : 'PENDING', proposal.consensus.explanation, { proposalRef: proposal.id, phase: proposal.consensus.phase, prepared: proposal.consensus.prepared, committed: proposal.consensus.committed, required: 3, activeVersion: this.state.policy.version }, proposal.consensus.phase === 'FINALIZED' ? 'Policy consensus complete. Advance once more to commit and activate.' : 'Policy consensus in progress; active policy unchanged.', false);
    });
  }

  async setValidator(id: string, online: boolean, faulty?: boolean): Promise<void> {
    return this.serialize(async () => {
      const validator = this.state.validators.find(v => v.id === id); if (!validator) throw new Error('Choose one of the four registered hospital validators.');
      this.tick(); validator.online = online; if (faulty !== undefined) validator.faulty = faulty;
      this.audit('VALIDATOR_STATUS_CHANGED', online ? (validator.faulty ? 'FAULTY' : 'ONLINE') : 'OFFLINE', `Validator ${id} is ${online ? (validator.faulty ? 'available but rejecting' : 'available and matching') : 'offline'}. Committee membership is unchanged.`, 'DEMO_OPERATOR');
      this.show(17, 'PENDING', 'The validator roster has changed. Only available matching validators can contribute to the next consensus phase.', { validators: this.state.validators.map(v => ({ id: v.id, online: v.online, faulty: v.faulty })), quorum: 3 }, 'Local validator status updated; no votes or blocks fabricated.', false);
    });
  }

  async setAssurance(level: number): Promise<void> {
    return this.serialize(async () => {
      if (!Number.isInteger(level) || level < 1 || level > 3) throw new Error('Demo identity assurance must be Level 1, 2, or 3.');
      this.tick(); const patient = this.state.patients.find(p => p.id === 'P001')!; patient.credential.assurance = level;
      this.audit('DEMO_ASSURANCE_UPDATED', 'UPDATED', `The fictional patient's demo assurance evidence is now Level ${level}. This is a teaching control, not an identity-proofing service.`, 'DEMO_IDENTITY_ISSUER');
      this.show(7, 'PASS', `The fictional identity credential now supplies Level ${level}. Submit a new request to compare it with the active policy; a denied request is never silently reopened.`, { assurance: level, required: this.state.policy.minAssurance, activeVersion: this.state.policy.version }, 'Demo evidence updated; historical decisions remain unchanged.', false);
    });
  }

  async grantConsent(scopes: Category[], purpose: string, minutes: number): Promise<void> {
    return this.serialize(async () => {
      const allowed: Category[] = ['LAB', 'ECG', 'CONSULTATION', 'PRESCRIPTION', 'DISCHARGE', 'IMAGING', 'SENSITIVE'];
      if (!scopes.length || scopes.some(s => !allowed.includes(s)) || new Set(scopes).size !== scopes.length) throw new Error('Choose one or more unique supported record categories.');
      if (!['TREATMENT', 'RESEARCH'].includes(purpose)) throw new Error('Choose TREATMENT or RESEARCH as the consent purpose.');
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 525600) throw new Error('Consent expiry must be 1 to 525600 simulated minutes from now.');
      this.tick(); const id = `CONSENT-${String(this.state.consents.length + 1).padStart(4, '0')}`;
      this.state.consents.push({ id, patientId: 'P001', doctorId: 'DR_KHAN', scopes: [...scopes], purpose, expiresAt: this.state.clock + minutes * 60000, revoked: false });
      this.audit('CONSENT_GRANTED', 'GRANTED', `A scoped clinician grant was created for ${scopes.join(', ')} and purpose ${purpose}. It will be rechecked on every subsequent access.`, 'P001');
      this.show(13, 'PASS', 'Ayesha granted Dr. Khan a specific category and purpose scope until the selected expiry. This does not bypass identity, relationship, review, or finality checks.', { consentRef: id, scopes, purpose, expiresAt: this.state.clock + minutes * 60000 }, 'Local consent registry updated and audit evidence recorded.', false);
    });
  }

  async revokeConsent(id: string): Promise<void> {
    return this.serialize(async () => {
      const consent = this.state.consents.find(c => c.id === id); if (!consent) throw new Error('Select an existing consent grant.');
      if (consent.revoked) throw new Error('This consent grant is already revoked.');
      this.tick(); consent.revoked = true;
      this.audit('CONSENT_REVOKED', 'REVOKED', 'The specified clinician consent was revoked. Future access is rechecked; downloaded copies cannot be erased.', 'P001');
      this.show(13, 'FAIL', 'This grant no longer authorizes future retrieval. Other independently valid grants are evaluated separately. Previously downloaded copies are not erased.', { consentRef: id, grantee: consent.doctorId, scopes: consent.scopes, revoked: true }, 'Consent revoked; the next release gate reads this updated state.', false);
    });
  }

  async advanceClock(minutes: number): Promise<void> {
    return this.serialize(async () => {
      if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 525600) throw new Error('Advance the clock by a positive number of minutes, at most one year.');
      this.state.clock += minutes * 60000;
      for (const proposal of this.state.proposals) {
        if (['PENDING', 'APPROVED', 'PENDING_FINALITY'].includes(proposal.status) && proposal.expiresAt <= this.state.clock) { proposal.status = 'EXPIRED'; this.audit('GOVERNANCE_PROPOSAL_EXPIRED', 'EXPIRED', `Proposal ${proposal.id} expired before activation.`, 'SIMULATION_CLOCK'); }
      }
      this.audit('SIMULATION_CLOCK_ADVANCED', 'ADVANCED', `The controlled simulation clock advanced ${minutes} minute(s). Expiry checks now use the new time.`, 'DEMO_OPERATOR');
      this.show(19, 'PASS', 'The simulation clock changed immediately. Token, consent, credential, and proposal expiry use this same clock; no real waiting is required.', { advancedMinutes: minutes, now: this.state.clock }, 'Controlled clock updated; no background process was started.', false);
    });
  }

  async tamperRecord(id: string): Promise<void> {
    return this.serialize(async () => {
      const record = this.state.records.find(r => r.id === id); if (!record) throw new Error('Choose an existing fictional report.');
      this.tick(); this.state.tamperedCopies[id] = { ...clone(record.content), classroomAlteration: 'A synthetic value was changed in an isolated vault copy.' };
      const alteredHash = await hashRecord(this.state.tamperedCopies[id]);
      this.audit('TAMPER_EXPERIMENT_CREATED', 'EXPERIMENT', 'An isolated report copy was modified; its original content, hash anchor, and every committed block were preserved.', 'DEMO_OPERATOR');
      this.show(21, 'FAIL', 'The altered copy has a different SHA-256 digest. A future retrieval of this copy must fail integrity verification. The original committed anchor is unchanged.', { recordRef: id, originalHash: record.originalHash, alteredHash, matches: alteredHash === record.originalHash }, 'Only an isolated vault copy was changed.', false);
    });
  }

  async resetTamper(id?: string): Promise<void> {
    return this.serialize(async () => {
      if (id) delete this.state.tamperedCopies[id]; else this.state.tamperedCopies = {};
      this.tick(); this.audit('TAMPER_EXPERIMENT_RESET', 'RESET', 'The isolated tampered copy was discarded. Original committed records and previous denial evidence remain unchanged.', 'DEMO_OPERATOR');
      this.show(21, 'PASS', 'The isolated tamper experiment is reset. Submit a new request to retrieve the unchanged original; prior denied requests remain denied.', { recordRef: id ?? 'ALL_EXPERIMENT_COPIES' }, 'Original vault data restored for future requests; historical evidence preserved.', false);
    });
  }
}
