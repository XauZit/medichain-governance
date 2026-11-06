import { simulatedSignature } from './crypto';
import { COMMITTEE } from './types';
import type { ConsensusState, GovernanceProposal, RuleKey, SimulationState, Validator, ValidatorMessage, Vote } from './types';

export interface RuleDefinition {
  key: RuleKey; id: string; name: string; description: string; category: string;
  type: 'number' | 'boolean'; min?: number; max?: number; priority: number;
}

export const RULE_DEFINITIONS: RuleDefinition[] = [
  { key: 'minAssurance', id: 'GOV-ASSURANCE', name: 'Minimum identity assurance', category: 'Identity', type: 'number', min: 1, max: 3, priority: 10, description: 'Required level of fictional hospital-issued identity evidence. DID and credential checks remain mandatory.' },
  { key: 'manualReview', id: 'REVIEW-001', name: 'Hospital manual review', category: 'Release', type: 'boolean', priority: 30, description: 'Require an authorized records officer to review ordinary history requests after mandatory checks pass.' },
  { key: 'sensitiveApprovals', id: 'MULTISIG-001', name: 'Sensitive-record approval threshold', category: 'Release', type: 'number', min: 0, max: 3, priority: 31, description: 'Extra distinct CMIO, Privacy Officer, or Compliance Officer approvals for specially classified records. Zero means ordinary hospital review alone is sufficient when manual review is enabled; default is two extra committee approvals.' },
  { key: 'clinicianConsent', id: 'CONSENT-001', name: 'Clinician consent required', category: 'Consent', type: 'boolean', priority: 20, description: 'Require a matching patient grant for clinician access. A governed demo exemption is possible, but never revives an explicitly revoked matching grant or bypasses ownership.' },
  { key: 'requireOnShift', id: 'ABAC-SHIFT', name: 'Clinician must be on shift', category: 'Context', type: 'boolean', priority: 21, description: 'Check the clinician duty-status attribute. This condition does not apply to patient self-access.' },
  { key: 'requireRelationship', id: 'ABAC-RELATIONSHIP', name: 'Treatment relationship required', category: 'Context', type: 'boolean', priority: 22, description: 'Require an established clinician–patient relationship in the fictional hospital roster.' },
  { key: 'crossHospital', id: 'GOV-CROSS-HOSPITAL', name: 'Cross-hospital access', category: 'Scope', type: 'boolean', priority: 23, description: 'Permit eligible requests for records held by the other demo hospital. Authentication, ownership, and consent checks still apply.' },
  { key: 'tokenMinutes', id: 'TOKEN-EXPIRY', name: 'Capability token lifetime', category: 'Capability', type: 'number', min: 1, max: 60, priority: 40, description: 'Expiry window for newly issued single-use capabilities, measured by the injected simulation clock.' },
];

export function emptyConsensus(): ConsensusState {
  return { phase: 'IDLE', digest: '', proposer: '', prepared: [], committed: [], quorum: 3, messages: [], explanation: 'No consensus round has started. Four known validators; f = 1; commit quorum = 3.' };
}

export function createProposal(state: SimulationState, key: RuleKey, value: number | boolean, justification: string): GovernanceProposal {
  const rule = RULE_DEFINITIONS.find((definition) => definition.key === key);
  if (!rule) throw new Error('This rule is a security invariant or is not an editable operational policy.');
  if (rule.type === 'boolean' && typeof value !== 'boolean') throw new Error(`${rule.name} requires an enabled/disabled value.`);
  if (rule.type === 'number' && (typeof value !== 'number' || !Number.isInteger(value) || value < (rule.min ?? 0) || value > (rule.max ?? Number.MAX_SAFE_INTEGER))) {
    throw new Error(`${rule.name} requires an integer from ${rule.min} to ${rule.max}.`);
  }
  if (value === state.policy[key]) throw new Error('Choose a proposed value different from the currently active rule.');
  if (typeof justification !== 'string' || justification.trim().length < 8) throw new Error('Add a clear justification of at least eight characters.');
  return {
    id: `GOV-${String(state.proposals.length + 1).padStart(4, '0')}`,
    ruleKey: key, oldValue: state.policy[key], newValue: value, justification: justification.trim(),
    proposerId: 'GOVERNANCE_OFFICER', baseVersion: state.policy.version,
    createdAt: state.clock, expiresAt: state.clock + 30 * 60_000,
    status: 'PENDING', votes: [], consensus: emptyConsensus(),
  };
}

const committeeIds = new Set(COMMITTEE.map((member) => member.id));

function votePayload(proposal: GovernanceProposal, actorId: string, decision: 'APPROVE' | 'REJECT', timestamp: number): Record<string, unknown> {
  return {
    proposalId: proposal.id, baseVersion: proposal.baseVersion, ruleKey: proposal.ruleKey,
    oldValue: proposal.oldValue, newValue: proposal.newValue, justification: proposal.justification,
    proposerId: proposal.proposerId, createdAt: proposal.createdAt, expiresAt: proposal.expiresAt,
    actorId, decision, clock: timestamp,
  };
}

export function checkMultisigThreshold(votes: Vote[], threshold = 2): boolean {
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > COMMITTEE.length) return false;
  // Unknown identities, rejection votes and malformed fingerprints never count.
  if (votes.some((vote) => !committeeIds.has(vote.actorId) || vote.decision !== 'APPROVE' || !/^SIM-[a-f0-9]{64}$/.test(vote.signature))) return false;
  const unique = new Set(votes.map((vote) => vote.actorId));
  if (unique.size !== votes.length) return false;
  return unique.size >= threshold;
}

/** Returns a new proposal; recording the vote and audit trail belongs to the state machine. */
export async function castVote(proposal: GovernanceProposal, actorId: string, decision: 'APPROVE' | 'REJECT', clock: number): Promise<GovernanceProposal> {
  if (!committeeIds.has(actorId) || actorId === proposal.proposerId) throw new Error('Only a distinct authorized committee member may cast this vote.');
  if (decision !== 'APPROVE' && decision !== 'REJECT') throw new Error('A committee vote must explicitly approve or reject.');
  if (!['PENDING', 'APPROVED'].includes(proposal.status)) throw new Error(`This ${proposal.status.toLowerCase()} proposal no longer accepts votes.`);
  if (!Number.isFinite(clock) || clock < proposal.createdAt || clock >= proposal.expiresAt) throw new Error('This proposal has expired or the vote time is invalid.');
  if (proposal.votes.some((vote) => vote.actorId === actorId)) throw new Error('This committee member has already voted. Duplicate votes are not counted.');
  const payload = votePayload(proposal, actorId, decision, clock);
  const vote: Vote = { actorId, decision, timestamp: clock, signature: await simulatedSignature(payload, `DEMO-PUB-${actorId}`) };
  const next = structuredClone(proposal);
  next.votes.push(vote);
  next.status = next.votes.some((item) => item.decision === 'REJECT') ? 'REJECTED'
    : checkMultisigThreshold(next.votes) ? 'APPROVED' : 'PENDING';
  return next;
}

/** Rechecks that the demo fingerprints still refer to the exact voted proposal. */
export async function verifyProposalVotes(proposal: GovernanceProposal): Promise<boolean> {
  if (!checkMultisigThreshold(proposal.votes)) return false;
  const rule = RULE_DEFINITIONS.find((definition) => definition.key === proposal.ruleKey);
  if (!rule || proposal.proposerId !== 'GOVERNANCE_OFFICER') return false;
  if (rule.type === 'boolean' && typeof proposal.newValue !== 'boolean') return false;
  if (rule.type === 'number' && (typeof proposal.newValue !== 'number' || !Number.isInteger(proposal.newValue) || proposal.newValue < (rule.min ?? 0) || proposal.newValue > (rule.max ?? Number.MAX_SAFE_INTEGER))) return false;
  const verified = await Promise.all(proposal.votes.map(async (vote) => {
    if (vote.actorId === proposal.proposerId || vote.timestamp < proposal.createdAt || vote.timestamp >= proposal.expiresAt) return false;
    return vote.signature === await simulatedSignature(votePayload(proposal, vote.actorId, vote.decision, vote.timestamp), `DEMO-PUB-${vote.actorId}`);
  }));
  return verified.every(Boolean);
}

function unavailable(previous: ConsensusState, explanation: string): ConsensusState {
  return { ...structuredClone(previous), phase: 'UNAVAILABLE', committed: [], quorum: 3, explanation };
}

function phaseMessages(phase: string, validators: Validator[], digest: string, senders: string[]): ValidatorMessage[] {
  return validators.filter((validator) => validator.online && senders.includes(validator.id)).flatMap((sender) =>
    validators.filter((receiver) => receiver.online && receiver.id !== sender.id).map((receiver) => ({
      phase, from: sender.id, to: receiver.id,
      digest: sender.faulty ? `${digest[0] === '0' ? '1' : '0'}${digest.slice(1)}` : digest,
      accepted: !sender.faulty && !receiver.faulty,
    })),
  );
}

/**
 * A local, deterministic PBFT teaching model. It checks a prepared certificate before
 * accepting 3 matching commit voters, but does not implement distributed PBFT, signed
 * transport, view-change certificates, Byzantine behavior or production liveness.
 */
export function consensusStep(previous: ConsensusState, validators: Validator[], digest: string): ConsensusState {
  if (!/^[a-f0-9]{64}$/.test(digest)) return unavailable(previous, 'A canonical transaction SHA-256 digest is required before consensus can begin.');
  if (validators.length !== 4 || new Set(validators.map((validator) => validator.id)).size !== 4) {
    return unavailable(previous, 'The classroom consortium must contain four distinct validators: n = 4, f = 1, quorum = 3.');
  }
  const eligible = validators.filter((validator) => validator.online && !validator.faulty).map((validator) => validator.id);
  const online = validators.filter((validator) => validator.online).map((validator) => validator.id);
  const reset = previous.digest !== digest || previous.phase === 'UNAVAILABLE';
  const current = reset ? emptyConsensus() : structuredClone(previous);
  if (current.phase === 'FINALIZED') return current; // Immutable finality: replay is idempotent.
  const proposer = eligible.includes(current.proposer) ? current.proposer : eligible[0];
  if (!proposer) return unavailable({ ...current, digest }, 'No honest, online validator is available to propose this event. No finality and no release.');
  if (current.phase !== 'IDLE' && current.proposer && current.proposer !== proposer) {
    // Restart certificates when the primary changes; never reuse votes from the old round.
    const restarted = { ...emptyConsensus(), digest, proposer, phase: 'PRE_PREPARE' as const };
    restarted.messages = validators.filter((validator) => validator.online && validator.id !== proposer).map((validator) => ({ phase: 'PRE_PREPARE', from: proposer, to: validator.id, digest, accepted: !validator.faulty }));
    restarted.explanation = `${current.proposer} became unavailable. The teaching model deterministically selects ${proposer} and restarts; this is not a full PBFT view-change protocol.`;
    return restarted;
  }
  if (current.phase === 'IDLE') {
    return {
      ...current, digest, proposer, quorum: 3, phase: 'PRE_PREPARE', prepared: [], committed: [],
      messages: validators.filter((validator) => validator.online && validator.id !== proposer).map((validator) => ({ phase: 'PRE_PREPARE', from: proposer, to: validator.id, digest, accepted: !validator.faulty })),
      explanation: `${proposer} proposes the canonical event digest. ${eligible.length} of 4 validators can return matching responses. Primary selection and transport are simulated.`,
    };
  }
  if (current.phase === 'PRE_PREPARE') {
    return {
      ...current, phase: 'PREPARE', prepared: [...eligible], committed: [],
      messages: [...current.messages, ...phaseMessages('PREPARE', validators, digest, online)],
      explanation: `${eligible.length}/3 matching prepare participants. The model requires a matching prepare certificate before any commit votes can finalize the event. Offline and rejecting validators do not count.`,
    };
  }
  const stillPrepared = [...new Set(current.prepared)].filter((id) => eligible.includes(id));
  if (current.phase === 'PREPARE') {
    if (stillPrepared.length < 3) return unavailable(current, `Only ${stillPrepared.length} matching, available prepare participants; quorum is 3. Pending finality: authorization cannot be committed and records cannot be released.`);
    return {
      ...current, phase: 'COMMIT', prepared: stillPrepared, committed: [...stillPrepared],
      messages: [...current.messages, ...phaseMessages('COMMIT', validators, digest, stillPrepared)],
      explanation: `A matching prepare certificate exists. ${stillPrepared.length}/3 prepared validators send matching commit messages for this exact digest.`,
    };
  }
  if (current.phase === 'COMMIT') {
    const commits = [...new Set(current.committed)].filter((id) => stillPrepared.includes(id));
    if (stillPrepared.length < 3 || commits.length < 3) return unavailable(current, `Only ${commits.length} matching commit participants remain available with valid prepare evidence; 3 are required. The transaction is still pending finality.`);
    return {
      ...current, phase: 'FINALIZED', prepared: stillPrepared, committed: commits,
      explanation: `${commits.length} distinct matching commits follow a prepared certificate: simplified PBFT finality is satisfied (n = 4, f = 1, 2f + 1 = 3). The state machine may now append one block.`,
    };
  }
  return unavailable(current, 'This consensus phase is invalid. Start a new explicitly triggered round.');
}
