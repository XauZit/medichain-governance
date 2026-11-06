import { useEffect, useState } from 'react';
import { Activity, ArrowRight, CalendarDays, Check, ClipboardCheck, Download, FileHeart, FileText, Fingerprint, Hospital, LockKeyhole, Send, ShieldCheck, Stethoscope, UserRound, X } from 'lucide-react';
import { useSession } from '../context';
import { COMMITTEE, type Category, type MedicalRecord } from '../core/types';
import { Badge, Button, CheckRow, Empty, KeyValue, Panel, Status, date, downloadText, shortHash } from './ui';

export function PatientWorkspace({compact=false}:{compact?:boolean}){
  const {state,invoke,busy,cursor,navigate}=useSession();
  const patient=state.patients.find(p=>p.id==='P001')||state.patients[0];
  const active=state.requests.find(r=>r.id===state.activeRequestId);
  const [selected,setSelected]=useState<string[]>(state.requestInput.recordIds||[]);
  const [category,setCategory]=useState('ALL');
  const [from,setFrom]=useState('2026-01-01');
  const [to,setTo]=useState('2026-12-31');
  const [report,setReport]=useState(false);
  useEffect(()=>setSelected(state.requestInput.recordIds||[]),[state.scenarioId,state.requestInput.recordIds?.join('|')]);
  const ownRecords=state.records.filter(r=>r.patientId===patient.id);
  const visible=ownRecords.filter(r=>(category==='ALL'||r.category===category)&&r.date>=from&&r.date<=to);
  const allowed=state.requests.filter(r=>r.patientId===patient.id&&r.actorType==='patient'&&r.status==='DELIVERED').flatMap(r=>r.releasedRecordIds);
  const allowedRecords=ownRecords.filter(r=>allowed.includes(r.id));
  const available=!busy&&cursor===null;
  return <div className={`actor-workspace ${compact?'compact':''}`}>
    <div className="identity-card"><div className="avatar">{patient.initials}</div><div><h3>{patient.name}</h3><p>Patient · {patient.id} <span className="fictional-tag">Fictional</span></p></div><ShieldCheck size={20} className="teal-text"/></div>
    <div className="identity-details"><div><span>DECENTRALIZED IDENTITY</span><code>{patient.did}</code></div><div className="identity-foot"><Badge tone="teal"><Fingerprint size={12}/> Assurance L{patient.credential.assurance}</Badge><Badge tone={patient.credential.revoked?'danger':'success'}>{patient.credential.revoked?'Credential revoked':'Demo credential'}</Badge></div></div>
    {active&&<div className="request-summary"><div className="row-between"><span className="eyebrow">{active.id}</span><Status value={active.status}/></div><p>{active.denialReason||`${active.recordIds.length} record${active.recordIds.length===1?'':'s'} · ${active.actorType==='clinician'?'Dr. Khan · '+active.purpose:'Patient self-access'} · Policy v${active.policyVersion}`}</p>{active.denialRule&&<code className="failure-text">{active.denialRule}</code>}</div>}
    <div className="section-label"><h3>Your medical history</h3><Badge>{ownRecords.length} records</Badge></div>
    <div className="filter-row"><label className="sr-only" htmlFor="record-category">Record category</label><select id="record-category" value={category} onChange={e=>setCategory(e.target.value)}><option value="ALL">All categories</option>{Array.from(new Set(ownRecords.map(r=>r.category))).map(c=><option key={c}>{c}</option>)}</select><CalendarDays size={15}/><span>2026</span></div>
    {!compact&&<div className="form-grid two"><label>From<input aria-label="Record start date" type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>Through<input aria-label="Record end date" type="date" value={to} onChange={e=>setTo(e.target.value)}/></label></div>}
    <div className="record-picker">{visible.map(record=><label className={`record-option ${selected.includes(record.id)?'selected':''}`} key={record.id}><input type="checkbox" checked={selected.includes(record.id)} disabled={!available} onChange={()=>setSelected(prev=>prev.includes(record.id)?prev.filter(id=>id!==record.id):[...prev,record.id])}/><span className={`record-icon ${record.sensitive?'amber':''}`}>{record.category==='ECG'?<Activity size={18}/>:<FileText size={18}/>}</span><span className="record-option-text"><strong>{record.title}</strong><small>{record.date} · {record.hospitalId==='H1'?'Crescent General':'City Care'}</small></span>{record.sensitive&&<LockKeyhole size={14}/>}</label>)}</div>
    <Button variant="primary" className="full-width" disabled={!available||!selected.length} onClick={()=>invoke(e=>e.submitRequest({patientId:patient.id,actorType:'patient',recordIds:selected,purpose:'SELF_ACCESS',hospitalId:'H1'}),'Request added to the hospital queue')}><Send size={15}/>{active?'Submit new request':'Request selected records'}<ArrowRight size={15}/></Button>
    <p className="field-note"><LockKeyhole size={12}/> Your own records do not require a consent grant.</p>
    {allowedRecords.length>0&&<Button className="full-width" onClick={()=>setReport(true)}><FileHeart size={16}/>Open approved medical history ({allowedRecords.length})</Button>}
    <div className="actor-links"><button onClick={()=>navigate('consent')}>Manage consent</button><button onClick={()=>navigate('audit')}>View access activity</button></div>
    {report&&<RecordReport records={allowedRecords} onClose={()=>setReport(false)}/>}
  </div>;
}

export function HospitalWorkspace({compact=false}:{compact?:boolean}){
 const {state,invoke,busy,cursor,navigate}=useSession();
 const request=state.requests.find(r=>r.id===state.activeRequestId);
 const failed=request?.checks.some(c=>c.result==='FAIL');
 const available=!busy&&cursor===null;
 const reviewReady=request&&state.step>=14&&!['DENIED','DELIVERED'].includes(request.status)&&!failed;
 return <div className={`actor-workspace ${compact?'compact':''}`}>
  <div className="identity-card hospital-identity"><div className="avatar hospital-avatar"><Hospital size={23}/></div><div><h3>Crescent General</h3><p>Health Information Management</p></div><Badge tone="teal">H1</Badge></div>
  <div className="operator-card"><span className="operator-dot"/><div><strong>Hospital Records Officer</strong><small>{request?.officerRole||'RECORDS_OFFICER'}</small></div><Badge tone="success">On duty</Badge></div>
  <div className="section-label"><h3>Incoming requests</h3><Badge>{state.requests.length}</Badge></div>
  {!request?<Empty title="The queue is ready">Submit a request from the patient portal, or start the guided simulation.</Empty>:<>
   <div className="queue-item active"><div className="row-between"><strong>{request.id}</strong><Status value={request.status}/></div><span>{request.actorType==='patient'?'Ayesha Ahmed':'Dr. Khan · treating physician'}</span><small>{request.recordIds.length} record(s) · {request.purpose} · {date(request.createdAt)} UTC</small></div>
   <div className="section-label"><h3>Verification workstation</h3><Fingerprint size={17}/></div>
   <div className="verification-list">{[
    ['DID-001','Registered DID'],['CRED-001','Credential validity'],['OWN-001','Record ownership'],['RBAC-001','Officer role'],['ABAC-001','Context & attributes'],['GOV-ASSURANCE','Identity assurance']
   ].map(([id,label])=>{const c=request.checks.find(c=>c.ruleId===id);return <CheckRow key={id} label={label} result={c?.result||'PENDING'} detail={c?c.actual:'Awaiting workflow step'}/>})}</div>
   <div className="review-box"><div className="row-between"><strong>Release review</strong><Badge>Policy v{state.policy.version}</Badge></div><p>{failed?'Mandatory verification failed. Hospital approval cannot override this result.':request.review==='APPROVED'?'Officer approval recorded. Remaining obligations and finality still apply.':'Complete the verification steps before reviewing the request.'}</p><div className="button-row"><Button variant="primary" small disabled={!available||!reviewReady||request.review==='APPROVED'} onClick={()=>invoke(e=>e.review(true),'Hospital review approved')}><Check size={15}/>Approve</Button><Button variant="danger" small disabled={!available||!request||state.step<12||['DENIED','DELIVERED','COMMITTED','TOKEN_ISSUED','RETRIEVING'].includes(request.status)} onClick={()=>invoke(e=>e.review(false),'Hospital review rejected')}><X size={15}/>Reject</Button></div></div>
   {request.recordIds.some(id=>state.records.find(r=>r.id===id)?.sensitive)&&<div className="review-box sensitive-review"><strong>Sensitive-record authorization</strong><p>{state.policy.sensitiveApprovals===0?'Ordinary hospital review only':`${request.approvals.length} of ${state.policy.sensitiveApprovals} distinct committee approvals`}</p>{state.policy.sensitiveApprovals>0&&COMMITTEE.map(m=><Button key={m.id} small className="full-width" disabled={!available||!reviewReady||request.review!=='APPROVED'||request.approvals.includes(m.id)} onClick={()=>invoke(e=>e.addApproval(m.id))}>{request.approvals.includes(m.id)?<Check size={14}/>:<ClipboardCheck size={14}/>} {m.short}</Button>)}</div>}
   {request.denialReason&&<div className="notice danger"><ShieldCheck size={17}/><div><strong>Release blocked</strong><p>{request.denialReason}</p></div></div>}
  </>}
  <div className="actor-links"><button onClick={()=>navigate('requests')}>Full request queue</button><button onClick={()=>navigate('governance')}>Governance console</button></div>
 </div>;
}

export function RecordReport({records,onClose}:{records:MedicalRecord[];onClose:()=>void}){
 const {state}=useSession(); const patient=state.patients[0];
 function download(){const esc=(v:unknown)=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));const html=`<!doctype html><html><head><meta charset="utf-8"><title>MediChain demo medical history</title><style>body{font:16px/1.6 system-ui;max-width:820px;margin:50px auto;color:#183139}h1{color:#087f80}article{padding:20px 0;border-bottom:1px solid #ddd}pre{white-space:pre-wrap;background:#f4f8f8;padding:16px}small{color:#647779;overflow-wrap:anywhere}.banner{padding:15px;background:#fff1cb}</style></head><body><h1>MediChain · Medical history</h1><p class="banner">FICTIONAL DEMONSTRATION DATA. Educational simulation — no real network. This is not a clinical document.</p><h2>${esc(patient.name)}</h2><p>Generated ${esc(date(state.clock))} UTC · Only records already released to the patient are included.</p>${records.map(r=>`<article><h2>${esc(r.title)}</h2><p>${esc(r.date)} · ${esc(r.department)}</p><p>${esc(r.summary)}</p><pre>${esc(JSON.stringify(r.content,null,2))}</pre><small>Verified record anchor: ${esc(r.originalHash)}</small></article>`).join('')}<p>Revoking consent prevents future retrieval; it cannot erase previously downloaded copies.</p></body></html>`;downloadText('MediChain-Demo-Medical-History.html',html,'text/html');}
 return <div className="modal-backdrop" role="presentation" onClick={onClose}><section className="modal report-modal" role="dialog" aria-modal="true" aria-label="Approved medical history" onClick={e=>e.stopPropagation()}><div className="modal-header"><div><span className="eyebrow">PATIENT COPY · FICTIONAL DATA</span><h2>Approved medical history</h2></div><Button small aria-label="Close report" onClick={onClose}><X size={18}/></Button></div><div className="notice info"><ShieldCheck size={20}/><div><strong>{records.length} verified record(s) released</strong><p>These records passed the access workflow and integrity check. Downloaded copies cannot be recalled by consent revocation.</p></div></div>{records.map(r=><article className="report-record" key={r.id}><div className="row-between"><h3>{r.title}</h3><Badge tone="success">Integrity verified at release</Badge></div><p className="muted">{r.date} · {r.department} · {r.clinician}</p><p>{r.summary}</p><pre>{JSON.stringify(r.content,null,2)}</pre><KeyValue label="SHA-256" mono>{r.originalHash}</KeyValue></article>)}<Button variant="primary" onClick={download}><Download size={16}/>Download demo report</Button></section></div>;
}

export function IdentityEvidence(){const {state,invoke,busy,cursor}=useSession();const p=state.patients[0];return <Panel title="Demonstration identity evidence" eyebrow="IDENTITY WORKSTATION"><div className="panel-body"><div className="identity-card"><div className="avatar">{p.initials}</div><div><h3>{p.name}</h3><p>Registered at Crescent General Hospital</p></div></div><KeyValue label="DID" mono>{p.did}</KeyValue><KeyValue label="Credential issuer">{p.credential.issuer}</KeyValue><KeyValue label="Credential expiry">{date(p.credential.expiresAt)} UTC</KeyValue><KeyValue label="Current assurance">Level {p.credential.assurance}</KeyValue><p className="field-note">This explicitly changes fictional evidence. It does not perform real identity proofing.</p><div className="button-row">{[1,2,3].map(n=><Button small key={n} variant={p.credential.assurance===n?'primary':'secondary'} disabled={busy||cursor!==null} onClick={()=>invoke(e=>e.setAssurance(n),`Demo assurance changed to Level ${n}`)}>Level {n}</Button>)}</div></div></Panel>}
