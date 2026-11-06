import type { ComponentType, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { SessionContext, type Page, type Session } from '../src/context';
import { Simulator } from '../src/core/simulator';
import { canonical } from '../src/core/crypto';
import { GovernancePage } from '../src/components/Governance';
import { LedgerPage } from '../src/components/Ledger';
import { NetworkPage } from '../src/components/Network';
import { ArchitecturePage, AuditPage, ConsentPage, Dashboard, RecordsPage, RequestsPage, ScenariosPage, SecurityPage } from '../src/components/Pages';
import { HospitalWorkspace, PatientWorkspace, RecordReport } from '../src/components/Portals';
import { Theater, WorkflowDiagram } from '../src/components/Theater';

/**
 * Actual React server renders with real simulator states. These checks exercise render
 * code and state binding without claiming browser, animation, layout, or event testing.
 */
const pages: Array<{ page: Page; component: ComponentType; title: string }> = [
  { page: 'theater', component: Theater, title: 'Healthcare access, explained.' },
  { page: 'dashboard', component: Dashboard, title: 'Health Information Management' },
  { page: 'records', component: RecordsPage, title: 'Patient registry & medical records' },
  { page: 'requests', component: RequestsPage, title: 'Incoming request queue' },
  { page: 'governance', component: GovernancePage, title: 'Rules that change real decisions' },
  { page: 'consent', component: ConsentPage, title: 'Consent with a defined scope' },
  { page: 'network', component: NetworkPage, title: 'A consortium, reaching agreement' },
  { page: 'ledger', component: LedgerPage, title: 'Evidence you can inspect' },
  { page: 'security', component: SecurityPage, title: 'The reason behind every decision' },
  { page: 'audit', component: AuditPage, title: 'A complete decision trail' },
  { page: 'scenarios', component: ScenariosPage, title: 'Fifteen ways to test trust' },
  { page: 'architecture', component: ArchitecturePage, title: 'How the system fits together' },
];

function session(engine: Simulator, overrides: Partial<Session> = {}): Session {
  const noop = () => undefined;
  return {
    engine, state: engine.state, live: engine.state, frames: engine.frames,
    cursor: null, busy: false, auto: false, speed: 1300, portal: 'patient',
    page: 'theater', classroom: false,
    invoke: async () => undefined, navigate: noop, setPortal: noop, seek: noop,
    next: async () => undefined, previous: noop, setAuto: noop, setSpeed: noop,
    setClassroom: noop, notify: noop, ...overrides,
  };
}

function render(node: ReactNode, engine: Simulator, overrides: Partial<Session> = {}): string {
  return renderToStaticMarkup(<SessionContext.Provider value={session(engine, overrides)}>{node}</SessionContext.Provider>);
}

function textContent(markup: string): string {
  return markup.replace(/<[^>]*>/g, '').replaceAll('&amp;', '&').replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>').replaceAll('&#x27;', "'").replaceAll('&quot;', '"')
    .replace(/\s+/g, ' ').trim();
}

function buttons(markup: string): Array<{ label: string; disabled: boolean }> {
  return [...markup.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((match) => ({
    label: textContent(match[2]), disabled: /\bdisabled(?:=|\s|$)/.test(match[1]),
  }));
}

async function complete(engine: Simulator): Promise<void> {
  for (let attempt = 0; attempt < 100 && !engine.state.finished; attempt += 1) {
    const request = engine.activeRequest;
    if (request?.status === 'AWAITING_REVIEW') await engine.review(true);
    else if (request?.status === 'AWAITING_APPROVALS') {
      const member = ['CMIO', 'PRIVACY_OFFICER', 'COMPLIANCE_OFFICER'].find((id) => !request.approvals.includes(id));
      if (!member) throw new Error('No distinct authorized approval remains.');
      await engine.addApproval(member);
    } else await engine.next();
  }
  expect(engine.state.finished).toBe(true);
}

let initial: Simulator;
let delivered: Simulator;
let denied: Simulator;
let activated: Simulator;

beforeAll(async () => {
  initial = await Simulator.create();
  delivered = await Simulator.create();
  await complete(delivered);
  denied = await Simulator.create();
  await denied.loadScenario('wrong-owner');
  await complete(denied);
  activated = await Simulator.create();
  await activated.propose('minAssurance', 3, 'Require stronger evidence for the classroom governance comparison.');
  const id = activated.state.proposals[0].id;
  await activated.vote(id, 'CMIO', 'APPROVE');
  await activated.vote(id, 'PRIVACY_OFFICER', 'APPROVE');
  for (let phase = 0; phase < 5; phase += 1) await activated.advanceProposal(id);
  await activated.submitRequest({ recordIds: ['R001'] });
  await complete(activated);
});

describe('all page exports render against real initial application state', () => {
  it.each(pages)('$page renders its content without browser globals or missing data errors', ({ page, component: Component, title }) => {
    const markup = render(<Component />, initial, { page });
    expect(textContent(markup)).toContain(title);
    expect(markup).toContain('<h1>');
    expect(markup).not.toContain('NaN');
  });
});

describe('actual decision state is reflected in rendered controls and evidence', () => {
  it('initial governance preview shows a valid current request and the exact proposed assurance denial', () => {
    const before = canonical(initial.state);
    const content = textContent(render(<GovernancePage />, initial, { page: 'governance' }));
    expect(content).toContain('PERMIT');
    expect(content).toContain('DENY');
    expect(content).toContain('GOV-ASSURANCE');
    expect(content).toContain('Policy v2 requires identity assurance Level 3');
    expect(content).not.toContain('AUTH-001');
    expect(content).not.toContain('fingerprint is missing or malformed');
    expect(canonical(initial.state)).toBe(before);
  });

  it('exposes approved patient records only after an actual verified self-access delivery', () => {
    expect(delivered.activeRequest?.status).toBe('DELIVERED');
    const before = textContent(render(<PatientWorkspace />, initial));
    const after = textContent(render(<PatientWorkspace />, delivered));
    expect(before).not.toContain('Open approved medical history');
    expect(after).toContain('Open approved medical history (1)');
    expect(after).toContain(delivered.activeRequest!.id);
    expect(after).toContain('DELIVERED');
    const report = render(<RecordReport records={delivered.state.records.filter((record) => delivered.activeRequest!.releasedRecordIds.includes(record.id))} onClose={() => undefined} />, delivered);
    expect(textContent(report)).toContain('1 verified record(s) released');
    expect(textContent(report)).toContain('Complete blood count');
    expect(textContent(report)).not.toContain('MRI imaging report');
  });

  it('keeps clinician disclosures separate from the patient’s approved-record collection', async () => {
    const clinician = await Simulator.create();
    await clinician.loadScenario('clinician-ecg');
    await complete(clinician);
    expect(clinician.activeRequest?.status).toBe('DELIVERED');
    const content = textContent(render(<PatientWorkspace />, clinician));
    expect(content).toContain('Dr. Khan');
    expect(content).not.toContain('Open approved medical history');
  });

  it('disables hospital approval and hides record access after a mandatory ownership denial', () => {
    const hospital = render(<HospitalWorkspace />, denied, { portal: 'hospital' });
    const approve = buttons(hospital).find((button) => button.label === 'Approve');
    expect(approve).toEqual({ label: 'Approve', disabled: true });
    expect(textContent(hospital)).toContain('Mandatory verification failed');
    expect(textContent(hospital)).toContain('Release blocked');
    const patient = textContent(render(<PatientWorkspace />, denied));
    expect(patient).toContain('OWN-001');
    expect(patient).not.toContain('Open approved medical history');
  });

  it('shows a denial audit path without marking the skipped vault or delivery as complete', () => {
    const diagram = render(<WorkflowDiagram />, denied);
    const groups = diagram.split('<div class="workflow-group">').slice(1);
    const vault = groups.find((group) => group.includes('Off-chain hospital vault'));
    const delivery = groups.find((group) => group.includes('Decision audit'));
    expect(vault).toBeDefined();
    expect(delivery).toBeDefined();
    // The completion indicator is user-visible evidence, not merely a layout detail.
    expect(vault).not.toMatch(/class="workflow-node[^\"]*\bcomplete\b/);
    expect(delivery).not.toMatch(/class="workflow-node[^\"]*\bcomplete\b/);
    expect(vault).not.toContain('class="tiny-check"');
    expect(delivery).not.toContain('class="tiny-check"');
    expect(textContent(diagram)).toContain('Denied branch');
    expect(textContent(diagram)).toContain('No medical content released.');
  });

  it('shows policy v2 and its actual assurance failure after approved governance activation', () => {
    expect(activated.state.policy.version).toBe(2);
    expect(activated.activeRequest?.denialRule).toBe('GOV-ASSURANCE');
    const governance = textContent(render(<GovernancePage />, activated));
    expect(governance).toContain('Active policy v2');
    expect(governance).toContain('Policy v2 is active');
    expect(governance).toContain('GOV-ASSURANCE');
    const security = textContent(render(<SecurityPage />, activated));
    expect(security).toContain('Policy v2 requires identity assurance Level 3');
    expect(security).toContain('No capability issued');
    const audit = textContent(render(<AuditPage />, activated));
    expect(audit).toContain('POLICY_VERSION_ACTIVATED');
    expect(audit).toContain('ACCESS_DENIED');
  });

  it('renders one vote as insufficient and enables consensus only after two distinct real votes', async () => {
    const engine = await Simulator.create();
    await engine.propose('minAssurance', 3, 'Demonstrate the visible committee approval threshold.');
    const id = engine.state.proposals[0].id;
    await engine.vote(id, 'CMIO', 'APPROVE');
    let markup = render(<GovernancePage />, engine);
    expect(buttons(markup).find((button) => button.label === 'Begin policy consensus')?.disabled).toBe(true);
    expect(textContent(markup)).toContain('The active policy has not changed.');
    await engine.vote(id, 'PRIVACY_OFFICER', 'APPROVE');
    markup = render(<GovernancePage />, engine);
    expect(buttons(markup).find((button) => button.label === 'Begin policy consensus')?.disabled).toBe(false);
    expect(textContent(markup)).toContain('Committee threshold reached. Consensus must still commit.');
    expect(engine.state.policy.version).toBe(1);
  });

  it('renders a delivered token as already used and exposes only the replay experiment', () => {
    const markup = render(<SecurityPage />, delivered);
    const content = textContent(markup);
    expect(content).toContain(delivered.state.tokens[0].id);
    expect(content).toContain('Attempt token replay');
    expect(buttons(markup).some((button) => button.label === 'Redeem capability token')).toBe(false);
    expect(content).toContain('A used token cannot fetch another copy');
  });

  it('renders linked ledger evidence without medical contents or patient names', () => {
    const markup = render(<LedgerPage />, delivered);
    const content = textContent(markup);
    expect(content).toContain('Block 0');
    expect(content).toContain('Block 1');
    expect(content).toContain('SHA-256');
    expect(content).not.toContain('Ayesha Ahmed');
    expect(content).not.toContain('Hemoglobin');
    expect(content).not.toContain('Synthetic blood sample');
  });

  it('renders historical snapshots without changing live delivery, token consumption, or ledger history', () => {
    const frame = delivered.frames.find((item) => item.step === 3)!;
    const liveBefore = canonical(delivered.state);
    const markup = render(<Theater />, delivered, { state: frame.state, cursor: frame.id, portal: 'patient' });
    expect(textContent(markup)).toContain('Viewing recorded state');
    expect(textContent(markup)).toContain('SUBMITTED');
    expect(textContent(markup)).not.toContain('Open approved medical history');
    expect(buttons(markup).find((button) => button.label.includes('Submit new request'))?.disabled).toBe(true);
    expect(canonical(delivered.state)).toBe(liveBefore);
  });

  it.each(pages)('$page also renders against populated delivered state', ({ page, component: Component, title }) => {
    const markup = render(<Component />, delivered, { page });
    expect(textContent(markup)).toContain(title);
  });
});
