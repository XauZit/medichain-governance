import type { AccessRequest, ConsensusState, MedicalRecord, RequestInput, SimulationState } from './types';
import { buildMerkleTree, createBlock, hashRecord, sha256 } from './crypto';

export const INITIAL_CLOCK = Date.UTC(2026, 10, 5, 9, 0, 0);
export const DEFAULT_REQUEST: RequestInput = { patientId: 'P001', actorType: 'patient', recordIds: ['R001'], purpose: 'SELF_ACCESS', hospitalId: 'H1', challengeValid: true, officerRole: 'RECORDS_OFFICER', onShift: true, relationship: true };

export function emptyConsensus(): ConsensusState {
  return { phase: 'IDLE', digest: '', proposer: 'H1', prepared: [], committed: [], quorum: 3, messages: [], explanation: 'Four registered hospital validators. Three matching prepared and commit votes are required in this simplified PBFT illustration.' };
}

export function requestPayload(request: AccessRequest): Record<string, unknown> {
  return { id: request.id, patientId: request.patientId, actorType: request.actorType, actorId: request.actorId, recordIds: request.recordIds, purpose: request.purpose, hospitalId: request.hospitalId, createdAt: request.createdAt, nonce: request.nonce };
}

type RecordSeed = Omit<MedicalRecord, 'originalHash' | 'storageRef' | 'status'>;
const recordSeeds: RecordSeed[] = [
  { id: 'R001', patientId: 'P001', hospitalId: 'H1', clinician: 'Dr. Khan', department: 'Clinical laboratory', category: 'LAB', date: '2026-10-25', title: 'Complete blood count', summary: 'Synthetic laboratory panel from the October outpatient visit.', sensitive: false, content: { resourceType: 'DiagnosticReport', identifier: 'DEMO-LAB-001', encounterDate: '2026-10-25', specimen: 'Synthetic blood sample', results: [{ name: 'Hemoglobin', value: 13.4, unit: 'g/dL' }, { name: 'White cell count', value: 6.8, unit: '10^9/L' }], note: 'Fictional demonstration data. Not a clinical report.' } },
  { id: 'R002', patientId: 'P001', hospitalId: 'H1', clinician: 'Dr. Khan', department: 'Cardiology', category: 'ECG', date: '2026-10-25', title: 'Resting ECG report', summary: 'Fictional resting electrocardiogram reviewed by the cardiology department.', sensitive: false, content: { resourceType: 'DiagnosticReport', identifier: 'DEMO-ECG-002', encounterDate: '2026-10-25', test: '12-lead ECG', rateBpm: 72, interpretation: 'Synthetic normal sinus rhythm example.', note: 'Fictional demonstration data.' } },
  { id: 'R003', patientId: 'P001', hospitalId: 'H1', clinician: 'Dr. Khan', department: 'Family medicine', category: 'CONSULTATION', date: '2026-10-20', title: 'Outpatient consultation', summary: 'Routine follow-up encounter with a fictional care-plan summary.', sensitive: false, content: { resourceType: 'Encounter', identifier: 'DEMO-ENC-003', encounterDate: '2026-10-20', visitType: 'Routine outpatient follow-up', clinicalNote: 'Synthetic visit recorded for a teaching exercise only.', plan: 'Demo follow-up entry; not medical advice.' } },
  { id: 'R004', patientId: 'P001', hospitalId: 'H1', clinician: 'Dr. Khan', department: 'Pharmacy', category: 'PRESCRIPTION', date: '2026-10-20', title: 'Medication prescription', summary: 'Demonstration medication order without a real treatment instruction.', sensitive: false, content: { resourceType: 'MedicationRequest', identifier: 'DEMO-RX-004', encounterDate: '2026-10-20', medication: 'Demo medication A', instructions: 'Not for dispensing. Fictional classroom prescription.', status: 'Demo completed' } },
  { id: 'R005', patientId: 'P001', hospitalId: 'H1', clinician: 'Dr. Sana Ali', department: 'General medicine', category: 'DISCHARGE', date: '2026-09-12', title: 'Discharge summary', summary: 'Synthetic summary of a completed observation encounter.', sensitive: false, content: { resourceType: 'DocumentReference', identifier: 'DEMO-DIS-005', encounterDate: '2026-09-12', documentType: 'Discharge summary', note: 'Fictional short observation stay; discharged for teaching demonstration.', status: 'Final demo document' } },
  { id: 'R006', patientId: 'P001', hospitalId: 'H1', clinician: 'Dr. Sana Ali', department: 'Radiology', category: 'IMAGING', date: '2026-09-10', title: 'MRI imaging report', summary: 'Fictional radiology report used to demonstrate consent scope restrictions.', sensitive: false, content: { resourceType: 'DiagnosticReport', identifier: 'DEMO-MRI-006', encounterDate: '2026-09-10', modality: 'MRI', finding: 'Synthetic imaging description for access-control demonstration.', note: 'No real scan or diagnosis.' } },
  { id: 'R007', patientId: 'P001', hospitalId: 'H1', clinician: 'Dr. Sana Ali', department: 'Specialist services', category: 'SENSITIVE', date: '2026-08-28', title: 'Restricted specialist report', summary: 'Specially classified fictional record; additional committee approvals apply.', sensitive: true, content: { resourceType: 'DocumentReference', identifier: 'DEMO-SEN-007', encounterDate: '2026-08-28', securityLabel: 'RESTRICTED_DEMO', note: 'Synthetic specialist note. Content is deliberately generic.', classification: 'Requires the active sensitive-record approval threshold.' } },
  { id: 'R008', patientId: 'P001', hospitalId: 'H2', clinician: 'Dr. Nida Shah', department: 'Clinical laboratory', category: 'LAB', date: '2026-07-14', title: 'Cross-hospital laboratory report', summary: 'Fictional lab report held at City Care Medical Center.', sensitive: false, content: { resourceType: 'Observation', identifier: 'DEMO-LAB-008', encounterDate: '2026-07-14', hospital: 'H2', test: 'Synthetic chemistry panel', value: 4.2, unit: 'demo units', note: 'Fictional demonstration data.' } },
  { id: 'R009', patientId: 'P002', hospitalId: 'H1', clinician: 'Dr. Khan', department: 'Clinical laboratory', category: 'LAB', date: '2026-10-22', title: 'Laboratory report · P002', summary: 'A different fictional patient owns this record.', sensitive: false, content: { resourceType: 'DiagnosticReport', identifier: 'DEMO-LAB-009', encounterDate: '2026-10-22', results: [{ name: 'Demo marker', value: 9.1, unit: 'demo units' }], note: 'Fictional demonstration data for ownership mismatch testing.' } },
  { id: 'R010', patientId: 'P003', hospitalId: 'H2', clinician: 'Dr. Nida Shah', department: 'Cardiology', category: 'ECG', date: '2026-10-18', title: 'ECG report · P003', summary: 'A different fictional patient and hospital own this record.', sensitive: false, content: { resourceType: 'DiagnosticReport', identifier: 'DEMO-ECG-010', encounterDate: '2026-10-18', test: 'Synthetic ECG', rateBpm: 68, note: 'Fictional demonstration data.' } },
];

export async function createInitialState(clock = INITIAL_CLOCK): Promise<SimulationState> {
  const records: MedicalRecord[] = await Promise.all(recordSeeds.map(async r => ({ ...structuredClone(r), originalHash: await hashRecord(r.content), storageRef: `vault://${r.hospitalId.toLowerCase()}/${r.id.toLowerCase()}`, status: 'ARCHIVED' })));
  const policy = { version: 1, minAssurance: 2, manualReview: true, sensitiveApprovals: 2, clinicianConsent: true, requireOnShift: true, requireRelationship: true, crossHospital: false, tokenMinutes: 10, activatedAt: clock };
  const reportTree = await buildMerkleTree(records.slice(0, 4).map(r => r.originalHash));
  const genesis = await createBlock([{ id: 'TX-GENESIS', eventType: 'DEMO_RECORD_HASH_ANCHORS', recordHashes: records.map(r => r.originalHash), policyVersion: 1, decision: 'ANCHOR', payloadHash: await sha256('MediChain synthetic teaching dataset version 1') }, { id: 'TX-GENESIS-REPORT-TREE', eventType: 'DEMO_REPORT_MERKLE_ANCHOR', recordHashes: records.slice(0, 4).map(r => r.originalHash), policyVersion: 1, decision: 'ANCHOR', payloadHash: reportTree.root }], undefined, clock, 1, 'DEMO_GENESIS', 'Seeded demonstration trust anchor; no network agreement claimed');
  return {
    clock,
    patients: [
      { id: 'P001', name: 'Ayesha Ahmed', initials: 'AA', age: 29, did: 'did:medichain:patient:P001', publicKey: 'DEMO-PUB-P001', didActive: true, credential: { id: 'VC-P001', issuer: 'H1', expiresAt: clock + 365 * 86400000, revoked: false, assurance: 2 } },
      { id: 'P002', name: 'Omar Malik', initials: 'OM', age: 42, did: 'did:medichain:patient:P002', publicKey: 'DEMO-PUB-P002', didActive: true, credential: { id: 'VC-P002', issuer: 'H1', expiresAt: clock + 365 * 86400000, revoked: false, assurance: 2 } },
      { id: 'P003', name: 'Sara Hassan', initials: 'SH', age: 35, did: 'did:medichain:patient:P003', publicKey: 'DEMO-PUB-P003', didActive: true, credential: { id: 'VC-P003', issuer: 'H2', expiresAt: clock + 365 * 86400000, revoked: false, assurance: 3 } },
    ],
    hospitals: [{ id: 'H1', name: 'Crescent General Hospital', city: 'Karachi · fictional' }, { id: 'H2', name: 'City Care Medical Center', city: 'Lahore · fictional' }],
    records, policies: [structuredClone(policy)], policy,
    consents: [{ id: 'CONSENT-0001', patientId: 'P001', doctorId: 'DR_KHAN', scopes: ['LAB', 'ECG'], purpose: 'TREATMENT', expiresAt: clock + 86400000, revoked: false }],
    requests: [], activeRequestId: null, tokens: [],
    validators: [{ id: 'H1', name: 'Crescent General Hospital', online: true, faulty: false }, { id: 'H2', name: 'City Care Medical Center', online: true, faulty: false }, { id: 'H3', name: 'National Medical Institute', online: true, faulty: false }, { id: 'H4', name: 'Valley Health Hospital', online: true, faulty: false }],
    consensus: emptyConsensus(), ledger: [genesis], audit: [], proposals: [], scenarioId: 'own-lab', step: 1,
    execution: { step: 1, result: 'PASS', explanation: 'Ayesha’s fictional patient portal is ready. Select records, then follow each verification stage.', inputs: { patientRef: 'P001', assurance: 2, recordCount: 8 }, stateChange: 'Seeded demonstration data loaded; no access request has been created.' },
    finished: false, pending: false, tamperedCopies: {}, requestSequence: 0, eventSequence: 0, requestInput: structuredClone(DEFAULT_REQUEST),
  };
}
