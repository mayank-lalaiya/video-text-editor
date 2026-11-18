import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import {
  activeHistory,
  collectionReducer,
  emptyCollection,
} from '../shared/collection.ts';
import {
  emptyWorkspace,
  type Workspace,
  type WorkspaceEntry,
} from '../shared/workspace.ts';
import {
  copyText,
  createCopyPlan,
  mixedTextRatio,
} from '../shared/text-copy.ts';
import {
  canRedo,
  canUndo,
  type EditKind,
  type HistoryCommand,
  type TextSelection,
} from '../shared/history.ts';
import { newTextBox, type TextBox } from '../shared/editor.ts';
import {
  queueRunning,
  type ExportQueue,
  type ExportScope,
  type QueueCommand,
} from '../shared/export-queue.ts';
import { measureTextBox } from './text/TextLayer.tsx';
import { getDesktopApi } from './desktop.ts';

function nativeField(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.matches(
      'input:not([type="range"],[type="checkbox"],[type="file"]),textarea',
    ) ||
      target.isContentEditable) &&
    !target.classList.contains('video-text')
  );
}

export function useEditor(resourcesReady: boolean) {
  const [collection, update] = useReducer(collectionReducer, emptyCollection);
  const active = collection.entries.find(
    (entry) => entry.asset.id === collection.activeId,
  );
  const video = active?.asset ?? null;
  const history = activeHistory(collection);
  const dispatch = (action: import('../shared/history.ts').HistoryAction) =>
    update({ type: 'history', action });
  const [loaded, setLoaded] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedDocument, setSavedDocument] = useState<Workspace | null>(null);
  const [mutating, setMutating] = useState(false);
  const workspace = useMemo<Workspace>(
    () => ({
      entries: collection.entries,
      activeId: collection.activeId,
      textDefault: collection.textDefault,
    }),
    [collection.entries, collection.activeId, collection.textDefault],
  );
  const saveStatus = restoreError
    ? 'Restore Failed'
    : !loaded
      ? 'Restoring workspace...'
      : mutating
        ? 'Updating workspace...'
        : saveError
          ? 'Save Failed'
          : savedDocument === workspace
            ? 'Saved Locally'
            : 'Saving';
  const latest = useRef({ document: workspace, loaded });
  useLayoutEffect(() => {
    latest.current = { document: workspace, loaded };
  }, [workspace, loaded]);
  const saveRevision = useRef(0);
  const importDone = useRef<Promise<void>>(Promise.resolve());
  const mutationDone = useRef<Promise<void> | null>(null);
  const stopImports = useRef(false);
  const closingRequested = useRef(false);
  const closeRevision = useRef(0);
  const [closing, setClosing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const locked = useCallback(
    () => closingRequested.current || mutationDone.current !== null,
    [],
  );
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const flush = useCallback(async () => {
    clearTimeout(autosaveTimer.current);
    if (!latest.current.loaded) return;
    const revision = ++saveRevision.current;
    const snapshot = latest.current.document;
    try {
      const result = await getDesktopApi().saveWorkspace(snapshot);
      if (!result.ok) throw new Error(result.error);
      if (revision === saveRevision.current) {
        setSavedDocument(snapshot);
        setSaveError(null);
      }
    } catch (reason) {
      if (revision === saveRevision.current) {
        setSaveError(reason instanceof Error ? reason.message : String(reason));
      }
      throw reason;
    }
  }, [setSaveError, setSavedDocument]);
  const restore = useCallback(
    async (mode: 'load' | 'recover' | 'reset' = 'load') => {
      try {
        const result = await (mode === 'reset'
          ? getDesktopApi().resetWorkspace()
          : mode === 'recover'
            ? getDesktopApi().recoverWorkspace()
            : getDesktopApi().loadWorkspace());
        if (!result.ok) throw new Error(result.error);
        update({ type: 'load', workspace: result.workspace });
        setMessage(result.warning);
        setRestoreError(null);
        setLoaded(true);
      } catch (reason) {
        console.error('Workspace restoration failed.', reason);
        setRestoreError(
          reason instanceof Error ? reason.message : String(reason),
        );
      }
    },
    [setMessage, setRestoreError, setLoaded, update],
  );
  useEffect(() => {
    if (resourcesReady && !latest.current.loaded) void restore();
  }, [resourcesReady, restore]);
  useEffect(
    () =>
      getDesktopApi().onWorkspaceFlush(
        async () => {
          const revision = ++closeRevision.current;
          stopImports.current = true;
          closingRequested.current = true;
          clearTimeout(autosaveTimer.current);
          flushSync(() => setClosing(true));
          try {
            await importDone.current;
            await mutationDone.current;
            if (revision !== closeRevision.current) return;
            await flush();
          } catch (error) {
            if (revision === closeRevision.current) {
              closingRequested.current = false;
              setClosing(false);
            }
            throw error;
          }
        },
        () => {
          closeRevision.current++;
          closingRequested.current = false;
          setClosing(false);
        },
      ),
    [flush],
  );
  useEffect(() => {
    if (!loaded || mutating || closing) return;
    saveRevision.current++;
    autosaveTimer.current = setTimeout(() => {
      void flush().catch((reason: unknown) =>
        console.error('Autosave failed.', reason),
      );
    }, 200);
    return () => clearTimeout(autosaveTimer.current);
  }, [workspace, loaded, mutating, closing, flush]);
  const beginMutation = () => {
    const finished = Promise.withResolvers<void>();
    mutationDone.current = finished.promise;
    clearTimeout(autosaveTimer.current);
    flushSync(() => setMutating(true));
    return () => {
      flushSync(() => setMutating(false));
      mutationDone.current = null;
      finished.resolve();
    };
  };
  const textLayer = history.present;
  const [selection, setSelection] = useState<TextSelection>('none');
  const box = textLayer?.box ?? null;
  const [operation, setOperation] = useState<'importing' | 'exporting' | null>(
    null,
  );
  const [exportQueue, setExportQueue] = useState<ExportQueue | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [queuePending, setQueuePending] = useState(false);
  const queuePendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<{ id: string; path: string } | null>(
    null,
  );

  const reportError = useCallback(
    (reason: unknown) => {
      console.error('Editor operation failed.', reason);
      setError(reason instanceof Error ? reason.message : String(reason));
    },
    [setError],
  );
  const changeBox = (next: TextBox, kind: EditKind = 'discrete') => {
    if (operation === 'exporting' || !loaded || active?.issue || locked())
      return;
    let minimum: { width: number; height: number };
    try {
      minimum = measureTextBox(next);
    } catch (reason) {
      reportError(reason);
      return;
    }
    dispatch({
      type: 'change',
      value: {
        box: {
          ...next,
          width: minimum.width,
          height: Math.max(next.height, minimum.height),
        },
        minimumHeight: minimum.height,
      },
      kind,
      time: performance.now(),
    });
    setError(null);
  };
  const endEdit = () => dispatch({ type: 'commit' });
  const undoGroup = collection.group?.applied === true;
  const redoGroup = collection.group?.applied === false;
  const performHistory = useCallback(
    (command: HistoryCommand) => {
      const group = command === 'undo' ? undoGroup : redoGroup;
      if (
        operation === 'exporting' ||
        showExport ||
        !loaded ||
        locked() ||
        (active?.issue && !group)
      )
        return;
      update({ type: 'history', action: { type: command } });
      setError(null);
      if (selection !== 'text') setSelection('object');
    },
    [
      operation,
      showExport,
      selection,
      loaded,
      active?.issue,
      undoGroup,
      redoGroup,
      locked,
      setError,
      setSelection,
    ],
  );
  const undoAvailable = undoGroup || (!active?.issue && canUndo(history));
  const redoAvailable = redoGroup || (!active?.issue && canRedo(history));
  useEffect(() => {
    let subscribed = true;
    const publish = () => {
      if (!subscribed) return;
      const fieldEditing = nativeField(document.activeElement);
      void getDesktopApi()
        .setHistoryMenuState({
          canUndo:
            operation !== 'exporting' &&
            !showExport &&
            !mutating &&
            !closing &&
            loaded &&
            undoAvailable,
          canRedo:
            operation !== 'exporting' &&
            !showExport &&
            !mutating &&
            !closing &&
            loaded &&
            redoAvailable,
          fieldEditing:
            operation !== 'exporting' &&
            !showExport &&
            !mutating &&
            !closing &&
            fieldEditing,
        })
        .then((result) => {
          if (!result.ok) throw new Error(result.error);
        })
        .catch(reportError);
    };
    const afterFocus = () => queueMicrotask(publish);
    publish();
    window.addEventListener('focusin', publish);
    window.addEventListener('focusout', afterFocus);
    return () => {
      subscribed = false;
      window.removeEventListener('focusin', publish);
      window.removeEventListener('focusout', afterFocus);
    };
  }, [
    undoAvailable,
    redoAvailable,
    operation,
    showExport,
    reportError,
    loaded,
    active?.issue,
    mutating,
    closing,
  ]);
  useEffect(() => {
    const unsubscribe = getDesktopApi().onHistoryCommand(performHistory);
    const shortcut = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.altKey ||
        !(event.metaKey || event.ctrlKey)
      )
        return;
      const key = event.key.toLowerCase();
      if (key !== 'z' && !(event.ctrlKey && key === 'y')) return;
      if (nativeField(event.target)) return;
      event.preventDefault();
      performHistory(key === 'y' || event.shiftKey ? 'redo' : 'undo');
    };
    window.addEventListener('keydown', shortcut);
    return () => {
      unsubscribe();
      window.removeEventListener('keydown', shortcut);
    };
  }, [performHistory]);
  const importVideos = async (files: File[]) => {
    if (operation || !loaded || locked()) {
      setError(
        'Wait for the current import/export or workspace restoration before importing more videos.',
      );
      return;
    }
    const finished = Promise.withResolvers<void>();
    importDone.current = finished.promise;
    update({ type: 'end-group' });
    stopImports.current = false;
    setOutput(null);
    setOperation('importing');
    setError(null);
    setMessage(null);
    try {
      const failures: string[] = [];
      const reviews: string[] = [];
      let imported = 0;
      for (const file of files) {
        if (stopImports.current) break;
        const result = await getDesktopApi().importVideo(file);
        if (!result.ok) {
          failures.push(`${file.name}: ${result.error}`);
          continue;
        }
        let text: WorkspaceEntry['text'] = null;
        const snapshot = latest.current.document.textDefault;
        if (snapshot?.enabled) {
          try {
            text = copyText(snapshot, result.asset, measureTextBox);
            if (mixedTextRatio(snapshot, result.asset)) reviews.push(file.name);
          } catch (reason) {
            failures.push(
              `${file.name}: Imported, but text inheritance failed: ${reason instanceof Error ? reason.message : String(reason)}`,
            );
          }
        }
        update({
          type: 'import',
          entry: { asset: result.asset, text, checked: false, time: 0 },
        });
        imported++;
      }
      setMessage(
        `${imported} video(s) imported.${reviews.length ? ` Review inherited text wrapping for aspect/pixel-ratio differences: ${reviews.join(', ')}.` : ''}`,
      );
      if (failures.length) setError(failures.join('\n'));
    } catch (reason) {
      reportError(reason);
    } finally {
      flushSync(() => setOperation(null));
      finished.resolve();
    }
  };
  const queueCommand = async (command: QueueCommand) => {
    const result = await getDesktopApi().exportQueue(command);
    if (!result.ok) throw new Error(result.error);
    setExportQueue(result.state);
    return result.state;
  };
  const openExport = async (scope: ExportScope = 'current') => {
    if (operation || !loaded || locked() || queuePendingRef.current) return;
    queuePendingRef.current = true;
    setQueuePending(true);
    setOperation('exporting');
    setError(null);
    setMessage(null);
    setOutput(null);
    endEdit();
    try {
      await flush();
      await queueCommand({ type: 'prepare', scope });
      setShowExport(true);
    } catch (reason) {
      reportError(reason);
      setOperation(null);
    } finally {
      queuePendingRef.current = false;
      setQueuePending(false);
    }
  };
  const exportAction = async (command: QueueCommand) => {
    if (queuePendingRef.current) return;
    queuePendingRef.current = true;
    setQueuePending(true);
    setError(null);
    try {
      if (command.type === 'start') {
        await flush();
        if (closingRequested.current) return;
      }
      const state = await queueCommand(command);
      if (command.type === 'dismiss') {
        setShowExport(false);
        setOperation(null);
      } else if (queueRunning(state)) setOperation('exporting');
      else if (command.type === 'start') setOperation(null);
    } catch (reason) {
      reportError(reason);
    } finally {
      queuePendingRef.current = false;
      setQueuePending(false);
    }
  };
  useEffect(() => {
    if (!loaded) return;
    let active = true;
    void getDesktopApi()
      .exportQueue({ type: 'status' })
      .then((result) => {
        if (!active) return;
        if (!result.ok) throw new Error(result.error);
        setExportQueue(result.state);
        if (result.state?.status === 'interrupted') setShowExport(true);
        if (
          queueRunning(result.state) ||
          result.state?.status === 'preflight'
        ) {
          setOperation('exporting');
          setShowExport(true);
        }
      })
      .catch(reportError);
    return () => {
      active = false;
    };
  }, [loaded, reportError]);
  const runningQueueId = queueRunning(exportQueue) ? exportQueue?.id : null;
  useEffect(() => {
    if (!runningQueueId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await getDesktopApi().exportQueue({ type: 'status' });
        if (!result.ok) throw new Error(result.error);
        if (active) {
          setExportQueue(result.state);
          if (!queueRunning(result.state)) {
            setOperation(null);
            const completed =
              result.state?.jobs.filter((job) => job.status === 'completed') ??
              [];
            const failed =
              result.state?.jobs.filter((job) => job.status === 'failed') ?? [];
            const cancelled =
              result.state?.jobs.filter((job) => job.status === 'cancelled') ??
              [];
            const path = completed[0]?.path;
            setOutput(
              path && result.state ? { id: result.state.id, path } : null,
            );
            setMessage(
              completed.length === 1 && !failed.length && !cancelled.length
                ? 'Edited video exported and validated.'
                : cancelled.length
                  ? completed.length
                    ? 'Export cancelled. Completed outputs were kept; no unfinished output was published.'
                    : 'Export cancelled. No unfinished output was published.'
                  : `${completed.length} exported and validated; ${failed.length} failed.`,
            );
            if (failed.length)
              setError(
                failed.map((job) => `${job.name}: ${job.error}`).join('\n'),
              );
            return;
          }
          timer = setTimeout(() => {
            void poll();
          }, 250);
        }
      } catch (reason) {
        if (active) {
          reportError(reason);
          timer = setTimeout(() => {
            void poll();
          }, 1000);
        }
      }
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [runningQueueId, reportError]);
  return {
    video,
    entries: collection.entries,
    activeId: collection.activeId,
    loaded,
    closing,
    mutating,
    issue: active?.issue,
    savedTime: active?.time ?? 0,
    saveStatus,
    saveError,
    restoreError,
    retrySave: () => {
      if (locked()) return;
      void flush().catch(reportError);
    },
    retryRestore: () => {
      void restore();
    },
    recoverWorkspace: () => {
      void restore('recover');
    },
    resetWorkspace: () => {
      if (
        window.confirm(
          'Archive the unreadable workspace and start an empty workspace? The archived file, source videos and completed exports will not be deleted.',
        )
      )
        void restore('reset');
    },
    activate: (id: string) => {
      if (operation === 'exporting' || locked()) return;
      update({ type: 'activate', id });
      setSelection('none');
      setError(null);
      setMessage(null);
      setOutput(null);
    },
    setChecked: (id: string | null, checked: boolean) => {
      if (!locked() && operation !== 'exporting')
        update({ type: 'check', id, checked });
    },
    clearWorkspace: async () => {
      if (operation || !loaded || locked()) return;
      const finish = beginMutation();
      try {
        await flush();
        const result = await getDesktopApi().clearWorkspace();
        if (!result.ok) throw new Error(result.error);
        update({ type: 'load', workspace: emptyWorkspace() });
        setSelection('none');
        setError(null);
        setOutput(null);
        setMessage(result.warning ?? null);
      } catch (reason) {
        setSaveError(reason instanceof Error ? reason.message : String(reason));
        reportError(reason);
      } finally {
        finish();
      }
    },
    setTime: useCallback(
      (id: string, time: number) => {
        if (!locked()) update({ type: 'time', id, time });
      },
      [locked],
    ),
    removeVideo: async (id: string, confirmed = false) => {
      if (operation || !loaded || locked()) return;
      const entry = collection.entries.find((item) => item.asset.id === id);
      if (
        !entry ||
        (!confirmed &&
          entry.text?.box.text.trim() &&
          !window.confirm(
            'Remove this video and its text from the workspace? Source media and completed exports are not deleted.',
          ))
      )
        return;
      const finish = beginMutation();
      try {
        await flush();
        const result = await getDesktopApi().removeVideo(id);
        if (!result.ok) throw new Error(result.error);
        update({ type: 'remove', id });
        setSelection('none');
        setError(null);
        setOutput(null);
        setMessage(result.warning ?? null);
      } catch (reason) {
        setSaveError(reason instanceof Error ? reason.message : String(reason));
        reportError(reason);
      } finally {
        finish();
      }
    },
    relinkVideo: async (id: string, file: File) => {
      if (operation || locked()) return;
      const finished = Promise.withResolvers<void>();
      importDone.current = finished.promise;
      setOperation('importing');
      setOutput(null);
      setMessage(null);
      setError(null);
      try {
        const result = await getDesktopApi().relinkVideo(id, file);
        if (!result.ok) throw new Error(result.error);
        update({ type: 'relink', asset: result.asset });
      } catch (reason) {
        reportError(reason);
      } finally {
        flushSync(() => setOperation(null));
        finished.resolve();
      }
    },
    box,
    selection,
    historyRevision: history.revision,
    canUndo: undoAvailable,
    canRedo: redoAvailable,
    undoGroup,
    redoGroup,
    textDefault: collection.textDefault,
    copyReport: collection.copyReport,
    applyToAll: () => {
      if (operation === 'exporting' || !loaded || locked()) return;
      try {
        const plan = createCopyPlan(workspace, measureTextBox);
        endEdit();
        update({ type: 'apply', plan });
        setError(null);
      } catch (reason) {
        reportError(reason);
      }
    },
    setAutoApply: (enabled: boolean) => {
      if (
        operation === 'exporting' ||
        !loaded ||
        locked() ||
        !collection.textDefault
      )
        return;
      update({ type: 'auto-apply', enabled });
    },
    undo: () => performHistory('undo'),
    redo: () => performHistory('redo'),
    endEdit,
    selectBox: () => {
      endEdit();
      if (box) setSelection('object');
    },
    editText: () => {
      endEdit();
      if (box) setSelection('text');
    },
    deselectBox: () => {
      endEdit();
      setSelection('none');
    },
    operation,
    exportQueue,
    showExport,
    queuePending,
    exportAction,
    closeExport: () => {
      setShowExport(false);
    },
    reviewExport: () => {
      setShowExport(true);
    },
    error,
    message,
    output,
    changeBox,
    importVideos,
    exportVideo: openExport,
    reportError,
    clearError: () => setError(null),
    createBox: (x: number, y: number) => {
      if (
        video &&
        !box &&
        operation !== 'exporting' &&
        !locked() &&
        loaded &&
        !active?.issue
      ) {
        changeBox(newTextBox(video, x, y));
        setSelection('text');
      }
    },
    addText: () => {
      if (
        !video ||
        box ||
        operation === 'exporting' ||
        locked() ||
        !loaded ||
        active?.issue
      )
        return;
      const next = newTextBox(video, 0, 0);
      const minimum = measureTextBox(next);
      next.width = minimum.width;
      next.height = Math.max(next.height, minimum.height);
      changeBox({
        ...next,
        x: (video.width - next.width) / 2,
        y: (video.height - next.height) / 2,
      });
      setSelection('text');
    },
    deleteBox: () => {
      if (
        !box ||
        operation === 'exporting' ||
        !loaded ||
        active?.issue ||
        locked()
      )
        return;
      dispatch({
        type: 'change',
        value: null,
        kind: 'discrete',
        time: performance.now(),
      });
      setSelection('none');
      setError(null);
    },
    minimumHeight: textLayer?.minimumHeight ?? 1,
    cancel: async () => {
      await exportAction({ type: 'cancel' });
    },
    reveal: async () => {
      if (!output) return;
      try {
        const result = await getDesktopApi().exportQueue({
          type: 'show-folder',
        });
        if (!result.ok) throw new Error(result.error);
      } catch (reason) {
        reportError(reason);
      }
    },
  };
}
