import {
  newTextHistory,
  textHistoryReducer,
  MAX_HISTORY_BYTES,
  MAX_HISTORY_STEPS,
  snapshotBytes,
  type TextState,
  type TextHistory,
  type HistoryAction,
} from './history.ts';
import {
  emptyWorkspace,
  type Workspace,
  type WorkspaceEntry,
} from './workspace.ts';
import type { VideoAsset } from './editor.ts';
import type { CopyPlan, CopyReport, TextDefault } from './text-copy.ts';

interface ApplyGroup {
  applied: boolean;
  beforeDefault: TextDefault | null;
  afterDefault: TextDefault;
  changes: { id: string; before: TextHistory; after: TextHistory }[];
}

export interface Collection extends Workspace {
  histories: Record<string, TextHistory>;
  group: ApplyGroup | null;
  copyReport: CopyReport | null;
}
export type CollectionAction =
  | { type: 'load'; workspace: Workspace }
  | { type: 'import'; entry: WorkspaceEntry }
  | { type: 'activate'; id: string }
  | { type: 'check'; id: string | null; checked: boolean }
  | { type: 'time'; id: string; time: number }
  | { type: 'remove'; id: string }
  | { type: 'relink'; asset: VideoAsset }
  | { type: 'apply'; plan: CopyPlan }
  | { type: 'auto-apply'; enabled: boolean }
  | { type: 'end-group' }
  | { type: 'history'; action: HistoryAction };
export const emptyCollection: Collection = {
  ...emptyWorkspace(),
  histories: {},
  group: null,
  copyReport: null,
};
export function activeHistory(state: Collection): TextHistory {
  return (
    (state.activeId && state.histories[state.activeId]) || {
      ...newTextHistory(),
      present:
        state.entries.find((entry) => entry.asset.id === state.activeId)
          ?.text ?? null,
    }
  );
}
function boundHistories(
  state: Collection,
  protectedIds = new Set<string>(),
): Collection {
  const cost = () => {
    const histories = [...Object.values(state.histories)];
    for (const change of state.group?.changes ?? [])
      histories.push(change.before, change.after);
    const stacks = new Set(
      histories.flatMap((history) => [history.past, history.future]),
    );
    const pending = new Set(
      histories
        .map((history) => history.pending)
        .filter((value) => value !== null),
    );
    const snapshots = [...stacks].flat();
    snapshots.push(...[...pending].map((value) => value.before));
    let bytes = snapshots.reduce((sum, text) => sum + snapshotBytes(text), 0);
    if (state.group) {
      const presents = new Set(
        state.group.changes.flatMap((change) => [
          change.before.present,
          change.after.present,
        ]),
      );
      bytes += [...presents].reduce(
        (sum, text) => sum + snapshotBytes(text),
        0,
      );
      for (const snapshot of [
        state.group.beforeDefault,
        state.group.afterDefault,
      ])
        if (snapshot) bytes += 256 + snapshot.box.text.length * 2;
    }
    return { bytes, steps: snapshots.length + (state.group ? 1 : 0) };
  };
  const clear = (id: string) => {
    const old = state.histories[id];
    if (old)
      state.histories[id] = {
        ...newTextHistory(),
        present: old.present,
        revision: old.revision,
      };
  };
  const groupIds = new Set(state.group?.changes.map((change) => change.id));
  const over = () =>
    total.bytes > MAX_HISTORY_BYTES || total.steps > MAX_HISTORY_STEPS;
  let total = cost();
  for (const id of Object.keys(state.histories)) {
    if (!over()) break;
    if (id === state.activeId || protectedIds.has(id) || groupIds.has(id))
      continue;
    clear(id);
    total = cost();
  }
  const activeId = state.activeId;
  if (activeId && !groupIds.has(activeId)) {
    let active = state.histories[activeId];
    while (over() && active && (active.past.length || active.future.length)) {
      active = {
        ...active,
        ...(active.past.length
          ? { past: active.past.slice(1) }
          : { future: active.future.slice(1) }),
      };
      state.histories[activeId] = active;
      total = cost();
    }
  }
  if (over() && state.group) {
    state = {
      ...state,
      group: null,
      copyReport: state.copyReport && {
        ...state.copyReport,
        undoLimited: true,
      },
    };
    total = cost();
  }
  for (const id of Object.keys(state.histories)) {
    if (!over()) break;
    if (id === activeId) continue;
    clear(id);
    total = cost();
  }
  return state;
}
function swapGroup(state: Collection, group: ApplyGroup): Collection {
  const applied = !group.applied;
  const histories = { ...state.histories };
  const texts = new Map<string, TextState | null>();
  for (const change of group.changes) {
    const history = applied ? change.after : change.before;
    histories[change.id] = {
      ...history,
      revision: (histories[change.id]?.revision ?? 0) + 1,
    };
    texts.set(change.id, history.present);
  }
  return {
    ...state,
    entries: state.entries.map((entry) =>
      texts.has(entry.asset.id)
        ? { ...entry, text: texts.get(entry.asset.id) ?? null }
        : entry,
    ),
    histories,
    textDefault: applied ? group.afterDefault : group.beforeDefault,
    group: { ...group, applied },
    copyReport: state.copyReport && { ...state.copyReport, undone: !applied },
  };
}
export function collectionReducer(
  state: Collection,
  action: CollectionAction,
): Collection {
  if (action.type === 'load')
    return {
      ...action.workspace,
      histories: {},
      group: null,
      copyReport: null,
    };
  if (action.type === 'end-group') return { ...state, group: null };
  if (action.type === 'auto-apply') {
    if (!state.textDefault)
      throw new Error('Apply to All before enabling new-import text.');
    if (state.textDefault.enabled === action.enabled) return state;
    return {
      ...state,
      group: null,
      textDefault: { ...state.textDefault, enabled: action.enabled },
    };
  }
  if (action.type === 'apply') {
    const histories = { ...state.histories };
    if (state.activeId)
      histories[state.activeId] = textHistoryReducer(activeHistory(state), {
        type: 'commit',
      });
    const copies = new Map(
      action.plan.copies.map((copy) => [copy.id, copy.text]),
    );
    const changes: ApplyGroup['changes'] = [];
    const entries = state.entries.map((entry) => {
      const text = copies.get(entry.asset.id);
      if (
        !text ||
        entry.asset.id === action.plan.sourceId ||
        entry.text?.box.text.trim()
      )
        return entry;
      const before = histories[entry.asset.id] ?? {
        ...newTextHistory(),
        present: entry.text,
      };
      const after = textHistoryReducer(before, {
        type: 'change',
        value: text,
        kind: 'discrete',
        time: 0,
      });
      histories[entry.asset.id] = after;
      changes.push({ id: entry.asset.id, before, after });
      return { ...entry, text };
    });
    return boundHistories({
      ...state,
      entries,
      histories,
      textDefault: action.plan.textDefault,
      group: {
        applied: true,
        beforeDefault: state.textDefault,
        afterDefault: action.plan.textDefault,
        changes,
      },
      copyReport: { ...action.plan.report, filled: changes.length },
    });
  }
  if (action.type === 'import') {
    const histories = { ...state.histories };
    if (action.entry.text)
      histories[action.entry.asset.id] = textHistoryReducer(newTextHistory(), {
        type: 'change',
        value: action.entry.text,
        kind: 'discrete',
        time: 0,
      });
    return boundHistories(
      {
        ...state,
        entries: [...state.entries, action.entry],
        activeId: state.activeId ?? action.entry.asset.id,
        histories,
        group: null,
      },
      new Set([action.entry.asset.id]),
    );
  }
  if (action.type === 'activate') {
    if (!state.entries.some((entry) => entry.asset.id === action.id))
      return state;
    const histories = { ...state.histories };
    if (state.activeId)
      histories[state.activeId] = textHistoryReducer(activeHistory(state), {
        type: 'commit',
      });
    return { ...state, activeId: action.id, histories };
  }
  if (action.type === 'check')
    return {
      ...state,
      entries: state.entries.map((entry) =>
        action.id === null || entry.asset.id === action.id
          ? { ...entry, checked: action.checked }
          : entry,
      ),
    };
  if (action.type === 'time') {
    const entry = state.entries.find((item) => item.asset.id === action.id);
    if (!entry || entry.time === action.time) return state;
    return {
      ...state,
      entries: state.entries.map((item) =>
        item === entry
          ? {
              ...entry,
              time: Math.max(0, Math.min(entry.asset.duration, action.time)),
            }
          : item,
      ),
    };
  }
  if (action.type === 'remove') {
    const index = state.entries.findIndex(
      (entry) => entry.asset.id === action.id,
    );
    const entries = state.entries.filter(
      (entry) => entry.asset.id !== action.id,
    );
    const histories = { ...state.histories };
    delete histories[action.id];
    return {
      ...state,
      entries,
      histories,
      group: null,
      activeId:
        state.activeId === action.id
          ? (entries[Math.min(index, entries.length - 1)]?.asset.id ?? null)
          : state.activeId,
    };
  }
  if (action.type === 'relink')
    return {
      ...state,
      group: null,
      entries: state.entries.map((entry) => {
        if (entry.asset.id !== action.asset.id) return entry;
        const { issue: _issue, ...current } = entry;
        return { ...current, asset: action.asset };
      }),
    };
  if (
    state.group &&
    ((action.action.type === 'undo' && state.group.applied) ||
      (action.action.type === 'redo' && !state.group.applied))
  )
    return swapGroup(state, state.group);
  if (!state.activeId) return state;
  const previous = activeHistory(state);
  const history = textHistoryReducer(previous, action.action);
  if (history === previous) return state;
  const mutated =
    history.present !== previous.present ||
    history.revision !== previous.revision;
  return boundHistories({
    ...state,
    group: mutated ? null : state.group,
    entries: state.entries.map((entry) =>
      entry.asset.id === state.activeId
        ? { ...entry, text: history.present }
        : entry,
    ),
    histories: { ...state.histories, [state.activeId]: history },
  });
}
