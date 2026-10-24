import type { FlowTiming } from '../engine/types';
import type { Broker } from './BrokerPicker';
import type { InputFile } from './combine';

// Spec 10.12 as changed by the phase 2 decisions: the whole file set, broker and timing.
const KEY = 'honest-returns:ledger:v1';
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type SavedLedger = { files: InputFile[]; broker: Broker; timing: FlowTiming; exclude: string[]; savedAt: string };

// Storage errors (Safari private mode, storage disabled) mean "no storage": save and clear do nothing, load returns null.
export function saveLedger(storage: Store, { files, broker, timing, exclude }: Omit<SavedLedger, 'savedAt'>) {
  try {
    storage.setItem(KEY, JSON.stringify({ version: 1, files, broker, timing, exclude, savedAt: new Date().toISOString() }));
  } catch {}
}

export function loadLedger(storage: Store): SavedLedger | null {
  try {
    const v = JSON.parse(storage.getItem(KEY) ?? 'null');
    if (v?.version !== 1 || !Array.isArray(v.files) || !v.files.length) return null;
    if (!v.files.every((f: InputFile) => typeof f?.name === 'string' && typeof f.text === 'string')) return null;
    if (!['ibkr', 'canonical'].includes(v.broker) || !['start', 'end'].includes(v.timing) || typeof v.savedAt !== 'string') return null;
    const exclude = v.exclude === undefined ? [] : v.exclude; // spec 16.7: saves from before partial reports have none
    if (!Array.isArray(exclude) || !exclude.every((t) => typeof t === 'string')) return null;
    return { files: v.files, broker: v.broker, timing: v.timing, exclude, savedAt: v.savedAt };
  } catch {
    return null;
  }
}

export function clearLedger(storage: Store) {
  try {
    storage.removeItem(KEY);
  } catch {}
}
