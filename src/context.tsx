import { createContext, useContext } from 'react';
import type { Simulator } from './core/simulator';
import type { HistoryFrame, SimulationState } from './core/types';
export type Page = 'theater' | 'dashboard' | 'records' | 'requests' | 'governance' | 'consent' | 'network' | 'ledger' | 'security' | 'audit' | 'scenarios' | 'architecture';
export interface Session {
  engine: Simulator; state: SimulationState; live: SimulationState; frames: HistoryFrame[];
  cursor: number | null; busy: boolean; auto: boolean; speed: number; portal: 'patient'|'hospital';
  page: Page; classroom: boolean;
  invoke: (action: (engine: Simulator)=>Promise<void>, message?:string)=>Promise<void>;
  navigate:(page:Page)=>void; setPortal:(portal:'patient'|'hospital')=>void;
  seek:(index:number|null)=>void; next:()=>Promise<void>; previous:()=>void;
  setAuto:(value:boolean)=>void; setSpeed:(value:number)=>void; setClassroom:(value:boolean)=>void;
  notify:(message:string)=>void;
}
export const SessionContext = createContext<Session|null>(null);
export function useSession(){ const s=useContext(SessionContext); if(!s) throw new Error('Simulator not initialized'); return s; }
