import { z } from 'zod';
import { TextBoxSchema, type TextBox } from './editor.ts';

export type EditKind =
  | 'discrete'
  | 'typing'
  | 'composition'
  | 'gesture'
  | 'inspector';
export type TextSelection = 'none' | 'object' | 'text';
export interface TextState {
  box: TextBox;
  minimumHeight: number;
}
type Snapshot = TextState | null;
export const MAX_HISTORY_STEPS = 100;
export const MAX_HISTORY_BYTES = 16 * 1024 * 1024;

export function snapshotBytes(value: Snapshot): number {
  return value ? 256 + value.box.text.length * 2 : 8;
}

function bounded(state: TextHistory): TextHistory {
  let bytes =
    state.past.reduce((sum, value) => sum + snapshotBytes(value), 0) +
    state.future.reduce((sum, value) => sum + snapshotBytes(value), 0) +
    (state.pending ? snapshotBytes(state.pending.before) : 0);
  let count = state.past.length + state.future.length + (state.pending ? 1 : 0);
  const past = [...state.past];
  const future = [...state.future];
  while (count > MAX_HISTORY_STEPS || bytes > MAX_HISTORY_BYTES) {
    if (!past.length && !future.length)
      return { ...state, past, future, pending: null };
    const removed = past.length ? past.shift() : future.shift();
    bytes -= snapshotBytes(removed ?? null);
    count--;
  }
  return { ...state, past, future };
}
export interface TextHistory {
  past: Snapshot[];
  present: Snapshot;
  future: Snapshot[];
  pending: { before: Snapshot; kind: EditKind; time: number } | null;
  revision: number;
}
export type HistoryAction =
  | { type: 'change'; value: Snapshot; kind: EditKind; time: number }
  | { type: 'commit' | 'undo' | 'redo' | 'reset' };

export const HistoryCommandSchema = z.enum(['undo', 'redo']);
export type HistoryCommand = z.infer<typeof HistoryCommandSchema>;
export const HistoryMenuStateSchema = z.strictObject({
  canUndo: z.boolean(),
  canRedo: z.boolean(),
  fieldEditing: z.boolean(),
});
export type HistoryMenuState = z.infer<typeof HistoryMenuStateSchema>;
export const HISTORY_CHANNELS = {
  state: 'editor:history-state',
  command: 'editor:history-command',
} as const;

export function newTextHistory(): TextHistory {
  return { past: [], present: null, future: [], pending: null, revision: 0 };
}
function same(left: Snapshot, right: Snapshot): boolean {
  if (!left || !right) return left === right;
  return (
    left.minimumHeight === right.minimumHeight &&
    TextBoxSchema.keyof().options.every(
      (key) => left.box[key] === right.box[key],
    )
  );
}
function pendingChange(state: TextHistory): boolean {
  return !!state.pending && !same(state.pending.before, state.present);
}
export function canUndo(state: TextHistory): boolean {
  return pendingChange(state) || state.past.length > 0;
}
export function canRedo(state: TextHistory): boolean {
  return !pendingChange(state) && state.future.length > 0;
}
function commit(state: TextHistory): TextHistory {
  if (!state.pending) return state;
  return bounded({
    ...state,
    past: pendingChange(state)
      ? [...state.past, state.pending.before]
      : state.past,
    future: pendingChange(state) ? [] : state.future,
    pending: null,
  });
}
export function textHistoryReducer(
  state: TextHistory,
  action: HistoryAction,
): TextHistory {
  if (action.type === 'reset')
    return { ...newTextHistory(), revision: state.revision + 1 };
  if (action.type === 'commit') return commit(state);
  if (action.type === 'change') {
    if (same(action.value, state.present)) return state;
    const continuing =
      action.kind !== 'discrete' &&
      state.pending?.kind === action.kind &&
      (action.kind !== 'typing' || action.time - state.pending.time <= 750);
    const base = continuing ? state : commit(state);
    const next = {
      ...base,
      present: action.value,
      pending: {
        before: continuing && base.pending ? base.pending.before : base.present,
        kind: action.kind,
        time: action.time,
      },
    };
    if (snapshotBytes(next.pending.before) > MAX_HISTORY_BYTES)
      return { ...next, past: [], future: [], pending: null };
    return bounded(action.kind === 'discrete' ? commit(next) : next);
  }
  const base = commit(state);
  if (action.type === 'undo') {
    if (!base.past.length) return base;
    return bounded({
      ...base,
      past: base.past.slice(0, -1),
      present: base.past[base.past.length - 1] ?? null,
      future: [...base.future, base.present],
      revision: base.revision + 1,
    });
  }
  if (!base.future.length) return base;
  return bounded({
    ...base,
    past: [...base.past, base.present],
    present: base.future[base.future.length - 1] ?? null,
    future: base.future.slice(0, -1),
    revision: base.revision + 1,
  });
}
