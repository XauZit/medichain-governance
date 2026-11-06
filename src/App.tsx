import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, ArrowLeft, ArrowRight, Blocks, BookOpen, ChevronRight, ClipboardList, Clock3, Cross, Database, Fingerprint, GitBranch, HeartPulse, Hospital, Layers3, LayoutDashboard, Menu, Network, Play, RotateCcw, Shield, ShieldCheck, Stethoscope, UsersRound, X } from 'lucide-react';
import { Simulator } from './core/simulator';
import { SessionContext, type Page, type Session } from './context';
import type { HistoryFrame, SimulationState } from './core/types';
import { Theater } from './components/Theater';
import { GovernancePage } from './components/Governance';
import { NetworkPage } from './components/Network';
import { LedgerPage } from './components/Ledger';
import { ArchitecturePage, AuditPage, ConsentPage, Dashboard, RecordsPage, RequestsPage, ScenariosPage, SecurityPage } from './components/Pages';
import { Badge, Button, time } from './components/ui';

const navGroups=[{label:'WORKSPACE',items:[{id:'theater',label:'Simulation theater',icon:Play},{id:'dashboard',label:'Hospital dashboard',icon:LayoutDashboard},{id:'records',label:'Medical records',icon:Database},{id:'requests',label:'Request queue',icon:ClipboardList},{id:'consent',label:'Patient consent',icon:UsersRound},{id:'governance',label:'Governance console',icon:GitBranch}]},{label:'BLOCKCHAIN LAB',items:[{id:'network',label:'Validator network',icon:Network},{id:'ledger',label:'Ledger & integrity',icon:Blocks},{id:'security',label:'Security center',icon:ShieldCheck},{id:'audit',label:'Audit explorer',icon:Activity}]},{label:'LEARN & PRESENT',items:[{id:'scenarios',label:'Demo scenarios',icon:BookOpen},{id:'architecture',label:'Architecture & guide',icon:Layers3}]}];

export default function App(){
 const engineRef=useRef<Simulator|null>(null);const busyRef=useRef(false);
 const [live,setLive]=useState<SimulationState|null>(null);const [frames,setFrames]=useState<HistoryFrame[]>([]);
 const [cursor,setCursor]=useState<number|null>(null);const [busy,setBusy]=useState(false);const [auto,setAuto]=useState(false);const [speed,setSpeed]=useState(1300);
 const [portal,setPortal]=useState<'patient'|'hospital'>('patient');const [page,setPage]=useState<Page>('theater');const [classroom,setClassroom]=useState(false);const [menu,setMenu]=useState(false);const [toast,setToast]=useState('');const [fatal,setFatal]=useState('');
 useEffect(()=>{let active=true;Simulator.create().then(e=>{if(active){engineRef.current=e;setLive(structuredClone(e.state));setFrames([...e.frames]);}}).catch(e=>{if(active)setFatal(String(e));});return()=>{active=false;};},[]);
 useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(''),6000);return()=>clearTimeout(timer);},[toast]);
 const notify=useCallback((message:string)=>setToast(message),[]);
 const invoke=useCallback(async(action:(engine:Simulator)=>Promise<void>,message?:string)=>{
  if(!engineRef.current||busyRef.current)return;
  busyRef.current=true;setBusy(true);
  try{await action(engineRef.current);setLive(structuredClone(engineRef.current.state));setFrames([...engineRef.current.frames]);setCursor(null);if(message)setToast(message);}
  catch(error){setAuto(false);setToast(error instanceof Error?error.message:String(error));setLive(structuredClone(engineRef.current.state));setFrames([...engineRef.current.frames]);}
  finally{busyRef.current=false;setBusy(false);}
 },[]);
 const seek=useCallback((index:number|null)=>{setAuto(false);setCursor(index);},[]);
 const next=useCallback(async()=>{
  if(cursor!==null){setCursor(cursor>=frames.length-2?null:cursor+1);return;}
  const e=engineRef.current;const proposal=e?.state.proposals.find(p=>p.id===e.state.execution.inputs.proposalRef);
  if(proposal&&!['ACTIVATED','EXPIRED','REJECTED','STALE'].includes(proposal.status)){
   if(proposal.votes.filter(v=>v.decision==='APPROVE').length<2){setAuto(false);setToast('Two distinct committee approvals are required. Open Governance console to vote.');return;}
   await invoke(engine=>engine.advanceProposal(proposal.id));return;
  }
  if(proposal&&e?.state.activeRequestId){await invoke(engine=>engine.selectRequest(e.state.activeRequestId!));return;}
  await invoke(engine=>engine.next());
 },[cursor,frames.length,invoke]);
 const previous=useCallback(()=>{setAuto(false);setCursor(i=>Math.max(0,(i??frames.length-1)-1));},[frames.length]);
 useEffect(()=>{if(!auto||!live||busy)return;const proposal=live.proposals.find(p=>p.id===live.execution.inputs.proposalRef);const governanceActive=proposal&&!['ACTIVATED','EXPIRED','REJECTED','STALE'].includes(proposal.status);const needsVotes=governanceActive&&proposal.votes.filter(v=>v.decision==='APPROVE').length<2;if(cursor===null&&(needsVotes||proposal?.status==='PENDING_FINALITY'||(!governanceActive&&(live.finished||live.pending)))){setAuto(false);return;}const timer=setTimeout(()=>{void next();},speed);return()=>clearTimeout(timer);},[auto,busy,live,cursor,next,speed]);
 const state=cursor!==null&&frames[cursor]?frames[cursor].state:live;
 useEffect(()=>{if(state)setPortal(state.step>=5&&state.step<=18?'hospital':'patient');},[state?.step]);
 const navigate=useCallback((p:Page)=>{setAuto(false);setPage(p);setMenu(false);window.scrollTo({top:0,behavior:'smooth'});},[]);
 if(fatal)return <div className="boot-screen"><Shield size={38}/><h1>MediChain could not initialize</h1><p>{fatal}</p><p>Open this app using HTTPS or localhost so browser Web Crypto is available.</p><Button onClick={()=>window.location.reload()}>Try again</Button></div>;
 if(!state||!live||!engineRef.current)return <div className="boot-screen"><div className="boot-icon"><Cross size={32}/></div><h1>MediChain</h1><p>Preparing fictional records and SHA-256 integrity anchors…</p><div className="loading-track"><span/></div></div>;
 const session:Session={engine:engineRef.current,state,live,frames,cursor,busy,auto,speed,portal,page,classroom,invoke,navigate,setPortal,seek,next,previous,setAuto,setSpeed,setClassroom,notify};
 const activeNav=navGroups.flatMap(g=>g.items).find(n=>n.id===page);
 return <SessionContext.Provider value={session}><div className={`app ${classroom?'classroom':''}`}>
  {!classroom&&<><aside className={`sidebar ${menu?'open':''}`}><a className="brand" href="#" onClick={e=>{e.preventDefault();navigate('theater');}}><span className="brand-symbol"><Cross size={23} strokeWidth={3}/></span><span>Medi<span>Chain</span><small>HEALTHCARE GOVERNANCE</small></span></a><div className="workspace-switch"><div className="hospital-mark"><Hospital size={18}/></div><div><strong>Crescent General</strong><span>Teaching environment</span></div><ChevronRight size={14}/></div><nav aria-label="Main navigation">{navGroups.map(g=><div className="nav-group" key={g.label}><span className="nav-label">{g.label}</span>{g.items.map(item=>{const Icon=item.icon;return <button key={item.id} className={`nav-item ${page===item.id?'active':''}`} onClick={()=>navigate(item.id as Page)}><Icon size={17}/><span>{item.label}</span>{item.id==='requests'&&state.requests.length>0&&<em>{state.requests.length}</em>}{item.id==='scenarios'&&<em>15</em>}</button>})}</div>)}</nav><div className="sidebar-footer"><div className="environment-badge"><span/><strong>Educational simulation</strong></div><p>Fictional data. No real network.</p><div className="student-profile"><div className="student-avatar">BK</div><div><strong>Bilal Khan</strong><small>Blockchain & Applications</small></div><BookOpen size={16}/></div></div></aside>{menu&&<div className="sidebar-overlay" onClick={()=>setMenu(false)}/>}</>}
  <div className="main-shell"><header className="topbar"><div className="breadcrumb">{!classroom&&<button className="mobile-menu" aria-label="Toggle navigation" onClick={()=>setMenu(!menu)}><Menu size={21}/></button>}<span className="desktop-breadcrumb">MediChain</span><ChevronRight size={14}/><strong>{classroom?'Classroom Demonstration':activeNav?.label}</strong></div><div className="topbar-right"><span className="demo-clock"><Clock3 size={14}/>{time(state.clock)}<small>UTC · DEMO CLOCK</small></span><Badge tone="teal">Policy v{state.policy.version}</Badge><div className="topbar-avatar">BK</div></div></header>
   <div className="simulation-disclaimer"><span><ShieldCheck size={14}/>Educational Blockchain Simulation — No Real Network</span><span>Fictional data only</span></div>
   <main className="main-content">{cursor!==null&&<div className="replay-banner"><HistoryIcon/><div><strong>Recorded-state replay · frame {cursor+1} of {frames.length}</strong><span>These are historical visuals. Playback does not repeat votes, commits, token use, or other mutations.</span></div><Button small onClick={()=>seek(null)}>Return to live state<ArrowRight size={14}/></Button></div>}
    {page==='theater'&&<Theater/>}{page==='dashboard'&&<Dashboard/>}{page==='records'&&<RecordsPage/>}{page==='requests'&&<RequestsPage/>}{page==='governance'&&<GovernancePage/>}{page==='consent'&&<ConsentPage/>}{page==='network'&&<NetworkPage/>}{page==='ledger'&&<LedgerPage/>}{page==='security'&&<SecurityPage/>}{page==='audit'&&<AuditPage/>}{page==='scenarios'&&<ScenariosPage/>}{page==='architecture'&&<ArchitecturePage/>}
   </main><footer className="app-footer"><span><Cross size={13}/>MediChain <span>·</span> A healthcare governance teaching laboratory</span><button disabled={busy} onClick={()=>{setAuto(false);void invoke(e=>e.reset(),'Demo data reset to its fictional baseline');}}><RotateCcw size={13}/>Reset demo data</button></footer>
  </div>{toast&&<div className="toast" role="status"><ShieldCheck size={19}/><span>{toast}</span><button aria-label="Dismiss notification" onClick={()=>setToast('')}><X size={16}/></button></div>}{busy&&<div className="busy-indicator" role="status">Computing…</div>}
 </div></SessionContext.Provider>;
}
function HistoryIcon(){return <Clock3 size={21}/>}
