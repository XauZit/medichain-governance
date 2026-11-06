import { canonical } from './crypto';
import { COMMITTEE } from './types';
import type { AccessEvaluation, AccessRequest, CapabilityToken, Outcome, RuleResult, SimulationState } from './types';

const REQUEST_FRESHNESS_MS = 30 * 60_000;
const VALID_RELEASE_APPROVERS = new Set(COMMITTEE.map((member) => member.id));
const PATIENT_ACCESS_PURPOSE = 'SELF_ACCESS';

function result(
  state: SimulationState, ruleId: string, name: string,
  inputs: Record<string, unknown>, expected: string, actual: string,
  outcome: Outcome, explanation: string,
  contribution?: RuleResult['contribution'],
): RuleResult {
  return {
    ruleId, name, policyVersion: state.policy.version, inputs, expected, actual,
    result: outcome, explanation,
    contribution: contribution ?? (outcome === 'FAIL' ? 'DENY' : outcome === 'PENDING' ? 'OBLIGATION' : outcome === 'PASS' ? 'PERMIT' : 'NONE'),
  };
}

function summarize(checks: RuleResult[]): AccessEvaluation {
  const failed = checks.find((check) => check.contribution === 'DENY');
  if (failed) return { decision: 'DENY', checks, explanation: `${failed.ruleId}: ${failed.explanation}` };
  const pending = checks.find((check) => check.result === 'PENDING');
  if (pending) return { decision: 'PENDING', checks, explanation: `${pending.ruleId}: ${pending.explanation}` };
  return { decision: 'PERMIT', checks, explanation: 'All applicable mandatory checks pass and all evaluated approval obligations are satisfied.' };
}

function authentication(request: AccessRequest, state: SimulationState): RuleResult {
  const age = state.clock - request.createdAt;
  const signaturePresent = /^SIM-[a-f0-9]{64}$/.test(request.signature);
  const uniqueNonce = Boolean(request.nonce) && !state.requests.some((other) => other.id !== request.id && other.nonce === request.nonce);
  const fresh = Number.isFinite(age) && age >= 0 && age <= REQUEST_FRESHNESS_MS;
  const ok = request.challengeValid && signaturePresent && uniqueNonce && fresh;
  let explanation = 'The simulated challenge succeeded, its labeled fingerprint is present, and the request nonce is unique and fresh. This is demonstration evidence, not a real cryptographic identity proof.';
  if (!request.challengeValid) explanation = 'The simulated identity challenge or payload fingerprint check failed. Hospital approval cannot override authentication failure.';
  else if (!signaturePresent) explanation = 'The labeled simulated authentication fingerprint is missing or malformed.';
  else if (!uniqueNonce) explanation = 'The request nonce is empty or has already been attached to another request.';
  else if (!fresh) explanation = 'The request is future-dated or its simulated authentication evidence is older than 30 minutes. Submit a fresh request.';
  return result(state, 'AUTH-001', 'Request authentication and freshness', {
    challengeValid: request.challengeValid, signatureScheme: 'SIMULATED fingerprint', signaturePresent,
    uniqueNonce, ageSeconds: Math.floor(age / 1000), freshnessSeconds: REQUEST_FRESHNESS_MS / 1000,
  }, 'Valid simulated challenge + labeled fingerprint + unique nonce + age ≤ 30 min', String(ok), ok ? 'PASS' : 'FAIL', explanation);
}

export function verifyDID(request: AccessRequest, state: SimulationState): RuleResult {
  const patient = state.patients.find((item) => item.id === request.patientId);
  const requesterRegistered = request.actorType === 'patient' ? request.actorId === request.patientId : request.actorId === 'DR_KHAN';
  const registered = Boolean(patient?.didActive && patient.did.startsWith('did:') && patient.publicKey);
  const ok = registered && requesterRegistered;
  return result(state, 'DID-001', 'DID registration', {
    patientRef: request.patientId, did: patient?.did ?? 'NOT_FOUND', registrationActive: patient?.didActive ?? false,
    publicKeyLabelPresent: Boolean(patient?.publicKey), requesterRegistered,
  }, 'Active demo DID registry entry and recognized requester', String(ok), ok ? 'PASS' : 'FAIL',
  ok ? 'The subject DID resolves in the local demo registry. Patient self-access uses that patient identity; clinician access also requires the registered Dr. Khan actor.'
    : 'The DID does not resolve to an active demo registry entry, or the requester does not match a registered actor.');
}

export function verifyCredential(request: AccessRequest, state: SimulationState): RuleResult {
  const credential = state.patients.find((patient) => patient.id === request.patientId)?.credential;
  const issuer = credential?.issuer ?? '';
  const issuerKnown = state.hospitals.some((hospital) => issuer === hospital.id || issuer === `did:medichain:hospital:${hospital.id}`);
  const current = Boolean(credential && Number.isFinite(credential.expiresAt) && credential.expiresAt > state.clock);
  const assuranceWellFormed = Boolean(credential && Number.isInteger(credential.assurance) && credential.assurance >= 1 && credential.assurance <= 3);
  const ok = Boolean(credential && issuerKnown && current && !credential.revoked && assuranceWellFormed);
  let explanation = 'The fictional credential has a recognized hospital issuer, has not expired or been revoked, and contains a valid assurance level. Credential signatures are not production cryptography in this model.';
  if (!credential) explanation = 'The required demo identity credential is missing.';
  else if (!issuerKnown) explanation = 'The credential issuer is not in the simulated trusted hospital roster.';
  else if (credential.revoked) explanation = 'The credential is revoked. An earlier successful verification cannot authorize a new release.';
  else if (!current) explanation = 'The credential has expired according to the injected simulation clock.';
  else if (!assuranceWellFormed) explanation = 'The assurance evidence is outside the supported Level 1–3 demo range.';
  return result(state, 'CRED-001', 'Credential validity', {
    credentialRef: credential?.id ?? 'MISSING', issuer, issuerKnown,
    expiresAt: credential?.expiresAt ?? null, revoked: credential?.revoked ?? null, now: state.clock,
  }, 'Trusted demo issuer + current credential + not revoked', String(ok), ok ? 'PASS' : 'FAIL', explanation);
}

export function verifyRecordOwnership(request: AccessRequest, state: SimulationState): RuleResult {
  const records = request.recordIds.map((id) => state.records.find((record) => record.id === id));
  const scopeExists = records.length > 0 && records.every(Boolean) && new Set(request.recordIds).size === request.recordIds.length;
  const ownerMatches = scopeExists && records.every((record) => record?.patientId === request.patientId);
  const selfIdentityMatches = request.actorType !== 'patient' || request.actorId === request.patientId;
  const ok = ownerMatches && selfIdentityMatches;
  return result(state, 'OWN-001', 'Patient–record ownership', {
    patientRef: request.patientId, requesterRef: request.actorId, selectedRecordRefs: request.recordIds,
    scopeExists, ownerMatches, selfIdentityMatches,
  }, 'Nonempty known scope; every record belongs to the represented patient', String(ok), ok ? 'PASS' : 'FAIL',
  ok ? 'Every requested record is bound to the represented patient. A clinician must still pass the separate consent and context checks.'
    : 'At least one selected record is unknown, duplicated, or belongs to a different patient. No record in this request can be released.');
}

export function evaluateRBAC(request: AccessRequest, state: SimulationState): RuleResult {
  const officerPermitted = request.officerRole === 'RECORDS_OFFICER';
  const requesterPermitted = request.actorType === 'patient' ? request.actorId === request.patientId : request.actorId === 'DR_KHAN';
  const ok = officerPermitted && requesterPermitted;
  return result(state, 'RBAC-001', 'Role-based access control', {
    officerRole: request.officerRole, requiredOfficerRole: 'RECORDS_OFFICER', actorType: request.actorType,
    requesterPermitted,
  }, 'Processing officer has RECORDS_OFFICER role; requester is recognized', String(ok), ok ? 'PASS' : 'FAIL',
  ok ? 'The officer may process access requests. This role permits review, but never overrides a mandatory denial.'
    : 'This hospital role may not process record-release requests, or the requesting actor is not authorized for that role.');
}

export function evaluateABAC(request: AccessRequest, state: SimulationState): RuleResult {
  if (request.actorType === 'patient') {
    return result(state, 'ABAC-001', 'Clinical context', { actorType: request.actorType },
      'Clinical shift and treatment relationship apply only to clinician requests', 'SELF_ACCESS', 'NOT_APPLICABLE',
      'A verified patient requesting their own history does not need to be on a hospital shift or have a treatment relationship with themselves.');
  }
  const shiftOk = !state.policy.requireOnShift || request.onShift;
  const relationshipOk = !state.policy.requireRelationship || request.relationship;
  const purposeOk = request.purpose === 'TREATMENT' || request.purpose === 'RESEARCH';
  const ok = shiftOk && relationshipOk && purposeOk;
  const explanation = !shiftOk ? 'The active policy requires an on-shift clinician, but this request has off-shift context.'
    : !relationshipOk ? 'The active policy requires a treatment relationship, but this clinician has no verified relationship to the patient.'
    : !purposeOk ? 'The clinician request has an unsupported purpose. The demonstration supports TREATMENT and RESEARCH with separately scoped consent.'
    : 'The clinician context meets the active shift and treatment-relationship rules. Purpose and scope must also match an applicable consent grant.';
  return result(state, 'ABAC-001', 'Attribute-based clinical context', {
    onShift: request.onShift, requireOnShift: state.policy.requireOnShift,
    relationship: request.relationship, requireRelationship: state.policy.requireRelationship, purpose: request.purpose,
  }, 'Required duty status + treatment relationship + supported purpose', String(ok), ok ? 'PASS' : 'FAIL', explanation);
}

export function checkConsent(request: AccessRequest, state: SimulationState): RuleResult {
  if (request.actorType === 'patient') {
    return result(state, 'CONSENT-001', 'Patient consent', { actorType: request.actorType },
      'Self-access uses verified identity and ownership; no self-consent grant required', 'SELF_ACCESS', 'NOT_APPLICABLE',
      'The patient is accessing their own verified history. Creating a consent grant to themselves is unnecessary.');
  }
  const categories = request.recordIds.map((id) => state.records.find((record) => record.id === id)?.category);
  const candidates = state.consents.filter((consent) => consent.patientId === request.patientId && consent.doctorId === request.actorId);
  const matching = candidates.filter((consent) => consent.purpose === request.purpose && categories.every((category) => category !== undefined && consent.scopes.includes(category)));
  const usable = matching.find((consent) => !consent.revoked && consent.expiresAt > state.clock);
  const latest = matching[matching.length - 1];
  // A policy exemption never resurrects an explicitly revoked matching grant.
  const explicitRevocation = !usable && Boolean(latest?.revoked);
  if (!state.policy.clinicianConsent && !explicitRevocation) {
    return result(state, 'CONSENT-001', 'Patient consent', {
      requiredByPolicy: false, categories, purpose: request.purpose, matchingGrant: usable?.id ?? null,
    }, 'Consent requirement follows active operational policy; explicit revocation still blocks', 'POLICY_EXCEPTION', 'NOT_APPLICABLE',
    'The committee-approved demo policy currently waives the consent obligation. Authentication, ownership, clinician context, and all other checks still apply; this does not claim a lawful production exception.');
  }
  let explanation = 'A current, unrevoked consent grant matches this clinician, every requested category, and the exact purpose.';
  if (!usable) {
    if (explicitRevocation) explanation = 'The matching consent grant was revoked. Future retrieval is denied; a revocation cannot erase copies already downloaded.';
    else if (matching.some((consent) => !consent.revoked && consent.expiresAt <= state.clock)) explanation = 'The matching consent grant has expired according to the simulation clock.';
    else if (candidates.some((consent) => consent.purpose !== request.purpose)) explanation = 'No current grant covers this exact purpose and record scope. Consent for treatment does not authorize research.';
    else if (candidates.length) explanation = 'The requested record category is outside the available consent scope, or no complete matching grant is active.';
    else explanation = 'The patient has not granted this clinician the required permission.';
  }
  return result(state, 'CONSENT-001', 'Patient consent', {
    grantee: request.actorId, categories, purpose: request.purpose,
    matchingGrant: usable?.id ?? null, requiredByPolicy: state.policy.clinicianConsent, explicitRevocation,
  }, 'Current, unrevoked grant matches owner, grantee, all categories, and purpose', String(Boolean(usable)), usable ? 'PASS' : 'FAIL', explanation);
}

export function evaluateGovernancePolicy(request: AccessRequest, state: SimulationState): RuleResult[] {
  const credential = state.patients.find((patient) => patient.id === request.patientId)?.credential;
  const assurance = credential?.assurance ?? 0;
  const assuranceOk = assurance >= state.policy.minAssurance;
  const requestedHospitals = request.recordIds.map((id) => state.records.find((record) => record.id === id)?.hospitalId);
  const processingHospitalKnown = state.hospitals.some((hospital) => hospital.id === request.hospitalId);
  const crossHospital = requestedHospitals.some((id) => id !== request.hospitalId);
  const hospitalOk = processingHospitalKnown && requestedHospitals.every((id) => Boolean(id)) && (!crossHospital || state.policy.crossHospital);
  return [
    result(state, 'GOV-ASSURANCE', 'Minimum identity assurance', {
      suppliedLevel: assurance, requiredLevel: state.policy.minAssurance, activeVersion: state.policy.version,
    }, `Identity assurance ≥ Level ${state.policy.minAssurance}`, `Level ${assurance}`, assuranceOk ? 'PASS' : 'FAIL',
    assuranceOk ? `The identity supplies Level ${assurance}, meeting policy v${state.policy.version}'s Level ${state.policy.minAssurance} requirement.`
      : `Policy v${state.policy.version} requires identity assurance Level ${state.policy.minAssurance}, but the patient supplies Level ${assurance}.`),
    result(state, 'GOV-CROSS-HOSPITAL', 'Cross-hospital release', {
      processingHospital: request.hospitalId, recordHospitals: requestedHospitals, crossHospital, allowed: state.policy.crossHospital,
    }, 'Known processing hospital; same-hospital scope unless active policy permits cross-hospital access', String(hospitalOk), hospitalOk ? 'PASS' : 'FAIL',
    hospitalOk ? (crossHospital ? 'The active governance policy permits this cross-hospital request; all other access controls remain mandatory.' : 'All requested records are held by the processing hospital.')
      : 'The request targets a record held by another hospital while cross-hospital access is disabled, or the hospital reference is unknown.'),
    evaluateABAC(request, state),
  ];
}

export function evaluateAccessRequest(
  request: AccessRequest, state: SimulationState, options: { requireApprovals?: boolean } = {},
): AccessEvaluation {
  const checks = [authentication(request, state), verifyDID(request, state), verifyCredential(request, state), verifyRecordOwnership(request, state), evaluateRBAC(request, state), ...evaluateGovernancePolicy(request, state), checkConsent(request, state)];
  const mandatoryDenied = checks.some((check) => check.result === 'FAIL');
  const reviewRequired = state.policy.manualReview;
  const reviewResult: Outcome = request.review === 'REJECTED' ? 'FAIL'
    : !reviewRequired ? 'NOT_APPLICABLE'
    : request.review === 'APPROVED' ? 'PASS'
    : mandatoryDenied || options.requireApprovals === false ? 'NOT_APPLICABLE' : 'PENDING';
  checks.push(result(state, 'REVIEW-001', 'Hospital review', { reviewRequired, review: request.review },
    reviewRequired ? 'Officer approval after mandatory policy checks' : 'Manual review not required by the active policy', request.review, reviewResult,
    request.review === 'REJECTED' ? 'The hospital officer rejected the request. Approval cannot be inferred from other passing rules.'
      : mandatoryDenied ? 'Not reached: a mandatory denial prevents hospital approval.'
      : !reviewRequired ? 'The active policy does not require an ordinary manual review.'
      : request.review === 'APPROVED' ? 'The authorized records officer approved this request; mandatory rules are still rechecked before release.'
      : options.requireApprovals === false ? 'Eligible for review if all other checks pass. Approval will be required at the release gate.'
      : 'Waiting for the authorized hospital records officer to approve or reject the request.'));

  const sensitive = request.recordIds.some((id) => state.records.find((record) => record.id === id)?.sensitive);
  const eligibleApprovals = [...new Set(request.approvals.filter((actor) => VALID_RELEASE_APPROVERS.has(actor)))];
  const required = state.policy.sensitiveApprovals;
  const committeeRequired = sensitive && required > 0;
  const enough = eligibleApprovals.length >= required;
  const approvalResult: Outcome = !committeeRequired ? 'NOT_APPLICABLE' : enough ? 'PASS'
    : mandatoryDenied || options.requireApprovals === false ? 'NOT_APPLICABLE' : 'PENDING';
  checks.push(result(state, 'MULTISIG-001', 'Sensitive-record approvals', {
    sensitive, required, distinctAuthorizedApprovals: eligibleApprovals,
  }, committeeRequired ? `${required} distinct authorized sensitive-record approval(s)` : 'No extra committee approvals required', `${eligibleApprovals.length}/${required}`, approvalResult,
  !sensitive ? 'The selected scope contains no specially classified sensitive record.'
    : required === 0 ? 'The active policy requires no extra committee approvals. The independent hospital manual-review rule still applies; mandatory security checks are unchanged.'
    : mandatoryDenied ? 'Not reached: an earlier mandatory denial prevents release.'
    : enough ? `${eligibleApprovals.length} distinct authorized committee members approved the sensitive release; the active threshold is ${required}.`
    : options.requireApprovals === false ? `This request carries an obligation for ${required} distinct sensitive-record approvals before release.`
    : `Sensitive release remains pending: ${eligibleApprovals.length} of ${required} distinct authorized approvals are recorded. Duplicate votes never count.`));

  checks.push(result(state, 'INTEGRITY-001', 'Vault content integrity', {
    integrityVerified: request.integrityValid ?? null,
  }, 'Retrieved record content must match its committed SHA-256 anchor before delivery',
  request.integrityValid === undefined ? 'NOT_YET_RETRIEVED' : String(request.integrityValid),
  request.integrityValid === undefined ? 'NOT_APPLICABLE' : request.integrityValid ? 'PASS' : 'FAIL',
  request.integrityValid === undefined ? 'Integrity is checked after authorized vault retrieval. Eligibility and a capability token do not yet mean medical bytes have been released.'
    : request.integrityValid ? 'The retrieved content hashes match the committed anchors.'
    : 'Retrieved content differs from its committed SHA-256 anchor. The original authorization remains in history, but delivery must be blocked.'));

  return summarize(checks);
}

function sameScope(left: string[], right: string[]): boolean {
  return left.length > 0 && left.length === right.length && new Set(left).size === left.length
    && canonical([...left].sort()) === canonical([...right].sort());
}

function hasCommittedAuthority(request: AccessRequest, state: SimulationState, policyVersion: number, blockHash: string): boolean {
  const block = state.ledger.find((candidate) => candidate.hash === blockHash);
  if (!block || block.index === 0 || request.blockHash !== blockHash || block.consensus !== 'PBFT_COMMITTED') return false;
  const hashes = request.recordIds.map((id) => state.records.find((record) => record.id === id)?.originalHash);
  if (hashes.some((hash) => !hash)) return false;
  return block.transactions.some((event) => event.eventType === 'MEDICAL_HISTORY_ACCESS_APPROVED'
    && event.requestRef === request.id && event.decision === 'PERMIT'
    && event.policyVersion === policyVersion && Boolean(event.recordHashes?.length)
    && canonical([...(event.recordHashes ?? [])].sort()) === canonical([...(hashes as string[])].sort()));
}

/** Produces a local single-use capability only after commitment and a fresh policy check. */
export function issueCapabilityToken(request: AccessRequest, state: SimulationState): CapabilityToken {
  const evaluation = evaluateAccessRequest(request, state, { requireApprovals: true });
  if (evaluation.decision !== 'PERMIT') throw new Error(`Capability blocked: ${evaluation.explanation}`);
  const recordedRequest = state.requests.find((candidate) => candidate.id === request.id);
  if (!recordedRequest || canonical(recordedRequest) !== canonical(request)) {
    throw new Error('Capability issuance requires the actual recorded request, without altered attributes.');
  }
  if (request.status !== 'COMMITTED' || request.tokenId || state.tokens.some((token) => token.requestId === request.id)) {
    throw new Error('Capability issuance requires one committed, not-yet-tokenized request.');
  }
  if (!request.blockHash || !hasCommittedAuthority(request, state, state.policy.version, request.blockHash)) {
    throw new Error('Capability issuance requires a matching committed PERMIT event under the active policy and exact record hashes.');
  }
  if (!Number.isInteger(state.policy.tokenMinutes) || state.policy.tokenMinutes < 1 || state.policy.tokenMinutes > 60) {
    throw new Error('Capability lifetime is outside the governed 1–60 minute range.');
  }
  return {
    id: `CAP-${request.id}`, requestId: request.id, subject: request.actorId, recordIds: [...request.recordIds],
    policyVersion: state.policy.version, issuedAt: state.clock,
    expiresAt: state.clock + state.policy.tokenMinutes * 60_000,
    nonce: `cap:${request.nonce}:${request.blockHash.slice(0, 16)}`,
    used: false, revoked: false, blockHash: request.blockHash,
  };
}

/** Does not consume the token: the serialized state machine must atomically consume on retrieval. */
export function validateCapabilityToken(token: CapabilityToken, request: AccessRequest, state: SimulationState): AccessEvaluation {
  const stored = state.tokens.find((candidate) => candidate.id === token.id);
  const sameIssuedToken = Boolean(stored && canonical(stored) === canonical(token));
  const recordedRequest = state.requests.find((candidate) => candidate.id === request.id);
  const sameRecordedRequest = Boolean(recordedRequest && canonical(recordedRequest) === canonical(request));
  const bound = token.requestId === request.id && token.subject === request.actorId && token.id === request.tokenId
    && sameScope(token.recordIds, request.recordIds) && sameRecordedRequest;
  const fresh = Number.isFinite(token.expiresAt) && Number.isFinite(token.issuedAt)
    && token.issuedAt <= state.clock && token.expiresAt > state.clock && token.expiresAt > token.issuedAt;
  const uniqueNonce = Boolean(token.nonce) && !state.tokens.some((other) => other.id !== token.id && other.nonce === token.nonce);
  const authority = Boolean(token.blockHash && hasCommittedAuthority(request, state, token.policyVersion, token.blockHash));
  const eligibleStatus = ['TOKEN_ISSUED', 'RETRIEVING', 'COMMITTED'].includes(request.status);
  const checks: RuleResult[] = [
    result(state, 'TOKEN-BINDING', 'Capability authenticity and scope', {
      registered: Boolean(stored), sameIssuedToken, subjectMatches: token.subject === request.actorId,
      requestMatches: token.requestId === request.id, sameRecordedRequest, exactScope: sameScope(token.recordIds, request.recordIds),
    }, 'Unmodified issued token bound to this requester, request, and exact record scope', String(sameIssuedToken && bound),
    sameIssuedToken && bound ? 'PASS' : 'FAIL',
    sameIssuedToken && bound ? 'The local capability matches the issued object and its complete authorization scope.' : 'The token is unknown, modified, or bound to a different request, requester, or record scope.'),
    result(state, 'TOKEN-EXPIRY', 'Capability lifetime', { issuedAt: token.issuedAt, expiresAt: token.expiresAt, now: state.clock },
      'issuedAt ≤ now < expiresAt', String(fresh), fresh ? 'PASS' : 'FAIL',
      fresh ? 'The token is inside its original issuance window. Policy lifetime changes apply to newly issued tokens.' : 'The capability has expired or has invalid timing. The vault will not retrieve data.'),
    result(state, 'TOKEN-REPLAY', 'One-time nonce', { used: token.used, uniqueNonce }, 'Unused, nonempty, unique capability nonce', String(!token.used && uniqueNonce),
      !token.used && uniqueNonce ? 'PASS' : 'FAIL', token.used ? 'This capability has already been redeemed. Replaying it cannot retrieve records again.'
        : uniqueNonce ? 'The capability nonce is unused; the retrieval operation must consume it atomically.' : 'The capability nonce is empty or duplicated.'),
    result(state, 'TOKEN-REVOCATION', 'Capability revocation', { revoked: token.revoked }, 'Capability has not been revoked', String(!token.revoked),
      token.revoked ? 'FAIL' : 'PASS', token.revoked ? 'The local capability was revoked and cannot authorize retrieval.' : 'The local capability has not been revoked.'),
    result(state, 'TOKEN-AUTHORITY', 'Committed authorization', {
      blockHash: token.blockHash, issuancePolicyVersion: token.policyVersion, activePolicyVersion: state.policy.version, authority, requestStatus: request.status,
    }, 'Matching committed PERMIT event and an eligible unreleased request', String(authority && eligibleStatus), authority && eligibleStatus ? 'PASS' : 'FAIL',
    authority && eligibleStatus ? 'The capability points to a committed permission event for these exact record hashes. Current policy is checked again below.'
      : 'No matching committed permission event exists, or the request is not eligible for retrieval.'),
    ...evaluateAccessRequest(request, state, { requireApprovals: true }).checks,
  ];
  return summarize(checks);
}

/** Exposed for educational policy pseudocode and future adapters. */
export const POLICY_PSEUDOCODE = `evaluate(request, activePolicy):
  deny if authentication, DID, credential, ownership, or role fails
  deny if assurance or allowed hospital scope fails
  if clinician: check duty context, relationship, purpose, and consent
  deny if any mandatory rule fails              // deny overrides
  wait for required hospital / sensitive-record approvals
  propose permission event; require matching validator quorum
  issue one-time capability with scoped hashes and expiry
  on retrieval: recheck capability AND current policy
  consume capability; compare retrieved SHA-256 hashes to anchors
  release only verified records; append audit evidence`;

export { PATIENT_ACCESS_PURPOSE };
