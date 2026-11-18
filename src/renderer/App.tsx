import { AppToolbar } from './components/AppToolbar.tsx';
import { ExportDialog } from './components/ExportDialog.tsx';
import { BatchTextSection } from './components/BatchTextSection.tsx';
import { PreviewArea } from './components/PreviewArea.tsx';
import { ResourcePanel } from './components/ResourcePanel.tsx';
import { TextInspector } from './components/TextInspector.tsx';
import { VideoSidebar } from './components/VideoSidebar.tsx';
import { useDesktopStatus } from './useDesktopStatus.ts';
import { useEditor } from './useEditor.ts';
import { usePreview } from './usePreview.ts';
import { unsupportedText } from '../shared/editor.ts';
import './editor.css';

export function App() {
  const { status, refresh } = useDesktopStatus();
  const editor = useEditor(status.phase === 'ready');
  const busy =
    editor.operation === 'exporting' ||
    editor.showExport ||
    editor.mutating ||
    !editor.loaded ||
    editor.closing;
  const unavailable = !!editor.issue;
  const { element: videoRef, ...preview } = usePreview(
    editor.video,
    busy ||
      unavailable ||
      editor.operation === 'importing' ||
      status.phase !== 'ready',
    editor.historyRevision,
    editor.savedTime,
    editor.setTime,
  );
  const unsupported = unsupportedText(editor.box?.text ?? '');
  const exportWarnings =
    editor.exportQueue && editor.exportQueue.status !== 'preflight'
      ? [
          ...(editor.exportQueue.notice ? [editor.exportQueue.notice] : []),
          ...editor.exportQueue.jobs
            .filter(
              (job) =>
                (job.status === 'completed' && job.error) ||
                (job.temporaryPath &&
                  ['completed', 'failed', 'interrupted'].includes(job.status)),
            )
            .map(
              (job) =>
                `${job.name}: ${job.error ?? 'Temporary cleanup could not be verified.'}${job.temporaryPath && !job.error?.includes(job.temporaryPath) ? ` Tracked temporary folder: ${job.temporaryPath}` : ''}`,
            ),
        ]
      : [];
  return (
    <div
      className="editor-shell"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        if (
          event.target instanceof Element &&
          event.target.closest('.video-sidebar,.preview-stage,.preview-empty')
        ) {
          preview.pause();
          void editor.importVideos(Array.from(event.dataTransfer.files));
        }
      }}
      onPointerDownCapture={(event) => {
        if (
          event.target instanceof Element &&
          !event.target.closest(
            'button,input,textarea,select,a,.text-inspector,.app-toolbar,.video-positioner',
          )
        )
          editor.deselectBox();
      }}
    >
      <AppToolbar
        ready={status.phase === 'ready'}
        busy={busy}
        importing={editor.operation === 'importing'}
        canExport={!!editor.video}
        checkedCount={editor.entries.filter((entry) => entry.checked).length}
        totalCount={editor.entries.length}
        saveStatus={editor.saveStatus}
        canUndo={editor.canUndo}
        canRedo={editor.canRedo}
        undoGroup={editor.undoGroup}
        redoGroup={editor.redoGroup}
        onUndo={editor.undo}
        onRedo={editor.redo}
        onImport={(files) => {
          preview.pause();
          void editor.importVideos(files);
        }}
        onExport={(scope) => {
          preview.stop();
          void editor.exportVideo(scope);
        }}
      />
      <div className="editor-columns">
        <VideoSidebar
          entries={editor.entries}
          activeId={editor.activeId}
          disabled={busy}
          importing={editor.operation === 'importing'}
          hasDefault={editor.textDefault !== null}
          exportJobs={editor.exportQueue?.jobs ?? []}
          onActivate={(id) => {
            preview.pause();
            editor.activate(id);
          }}
          onCheck={editor.setChecked}
          onRemove={(id) => {
            preview.pause();
            void editor.removeVideo(id);
          }}
          onClear={() => {
            if (
              !window.confirm(
                'Clear this workspace and all its text? Source media and completed exports are not deleted.',
              )
            )
              return;
            preview.pause();
            void editor.clearWorkspace();
          }}
          onRelink={(id, file) => {
            void editor.relinkVideo(id, file);
          }}
        />
        <PreviewArea
          video={editor.video}
          box={editor.box}
          busy={busy || unavailable || status.phase !== 'ready'}
          playbackDisabled={editor.operation === 'importing'}
          preview={preview}
          videoRef={videoRef}
          onChange={(box, kind) => {
            preview.pause();
            editor.changeBox(box, kind);
          }}
          onCreate={editor.createBox}
          onDelete={editor.deleteBox}
          selection={editor.selection}
          historyRevision={editor.historyRevision}
          onSelect={editor.selectBox}
          onEditText={editor.editText}
          onDeselect={editor.deselectBox}
          onCommit={editor.endEdit}
        >
          <div className="editor-notices">
            {!editor.showExport &&
              exportWarnings.map((warning) => (
                <p className="notice warning" role="alert" key={warning}>
                  {warning}
                </p>
              ))}
            {editor.issue && (
              <p className="notice error" role="alert">
                {editor.issue} Use Locate File in the video list, or remove the
                workspace entry. Saved text is preserved.
              </p>
            )}
            {editor.restoreError && (
              <div className="notice error" role="alert">
                <p>{editor.restoreError}</p>
                <button className="button" onClick={editor.retryRestore}>
                  Retry restore
                </button>
                <button className="button" onClick={editor.recoverWorkspace}>
                  Recover previous save
                </button>
                <button className="button" onClick={editor.resetWorkspace}>
                  Archive and reset workspace
                </button>
              </div>
            )}
            {editor.saveError && (
              <div className="notice error" role="alert">
                <p>
                  Save Failed: {editor.saveError}. Changes are only in memory
                  and could be lost.
                </p>
                <button className="button" onClick={editor.retrySave}>
                  Retry Save
                </button>
              </div>
            )}
            {editor.error && (
              <div className="notice error" role="alert">
                <p>{editor.error}</p>
                <button className="button quiet" onClick={editor.clearError}>
                  Dismiss error
                </button>
              </div>
            )}
            {unsupported.length > 0 && (
              <p className="notice warning" role="alert">
                Unverified glyphs: {unsupported.join(' ')}. This proof targets
                Latin text and bundled emoji; these characters may use system
                fallback or be missing.
              </p>
            )}
            {editor.operation === 'importing' && (
              <div className="notice" role="status">
                <span>Reading video and making its poster...</span>
              </div>
            )}
            {editor.message && (
              <div className="notice" role="status">
                <p>{editor.message}</p>
                {editor.output && (
                  <button
                    className="button"
                    onClick={() => {
                      void editor.reveal();
                    }}
                  >
                    Show in Finder
                  </button>
                )}
              </div>
            )}
            {editor.exportQueue &&
              editor.exportQueue.status !== 'preflight' && (
                <button className="button" onClick={editor.reviewExport}>
                  Review export results
                </button>
              )}
          </div>
          <ResourcePanel status={status} onRefresh={refresh} />
        </PreviewArea>
        <TextInspector
          key={editor.video?.id ?? 'no-video'}
          video={editor.video}
          box={editor.box}
          busy={busy || unavailable || status.phase !== 'ready'}
          onChange={editor.changeBox}
          onDelete={editor.deleteBox}
          onError={editor.reportError}
          minimumHeight={editor.minimumHeight}
          onBeginEdit={() => {
            preview.pause();
            editor.selectBox();
          }}
          onAdd={editor.addText}
          onCommit={editor.endEdit}
          reuse={
            <BatchTextSection
              disabled={busy || status.phase !== 'ready'}
              canApply={!!editor.box?.text.trim()}
              textDefault={editor.textDefault}
              report={editor.copyReport}
              undoGroup={editor.undoGroup}
              redoGroup={editor.redoGroup}
              onApply={editor.applyToAll}
              onEnabled={editor.setAutoApply}
              onUndo={editor.undo}
              onRedo={editor.redo}
            />
          }
        />
      </div>
      <ExportDialog
        state={editor.exportQueue}
        open={editor.showExport}
        pending={editor.queuePending}
        error={editor.error}
        onAction={(command) => {
          void editor.exportAction(command);
        }}
        onClose={editor.closeExport}
        onRetry={() => {
          void editor.exportVideo('retry');
        }}
      />
      <footer className="status-bar">
        <span>
          <span className="local-indicator" />
          {editor.saveStatus} / {editor.entries.length} video(s) / Source media
          is never changed
        </span>
        <span>
          {status.data
            ? `v${status.data.appVersion} / macOS / Apple silicon`
            : 'Desktop startup checks'}
        </span>
      </footer>
    </div>
  );
}
