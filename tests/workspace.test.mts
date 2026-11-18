import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  WorkspaceStore,
  type SavedWorkspace,
} from '../src/main/workspace/store.ts';
import { WorkspaceService } from '../src/main/workspace/service.ts';
import {
  collectionReducer,
  emptyCollection,
  activeHistory,
} from '../src/shared/collection.ts';
import { newTextBox, type VideoAsset } from '../src/shared/editor.ts';
import { canUndo } from '../src/shared/history.ts';
import { emptyWorkspace } from '../src/shared/workspace.ts';

const asset: VideoAsset = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'a.mp4',
  width: 320,
  height: 180,
  duration: 10,
  rotation: 0,
  sampleAspectRatio: 1,
  audioChannels: [],
  colour: { dynamicRange: 'sdr', bitDepth: 8 },
};
const empty = (): SavedWorkspace => ({
  version: 2,
  workspace: emptyWorkspace(),
  sources: {},
  outputFolder: null,
});
const withText = (): SavedWorkspace => ({
  ...empty(),
  workspace: {
    textDefault: null,
    activeId: asset.id,
    entries: [
      {
        asset,
        text: {
          box: { ...newTextBox(asset, 1, 2), text: 'Keep my saved text' },
          minimumHeight: 10,
        },
        checked: true,
        time: 3.25,
      },
    ],
  },
  sources: {
    [asset.id]: {
      path: '/source.mp4',
      identity: 'test-stat',
      hash: '0'.repeat(64),
    },
  },
});
test('workspace writes serialize, retain a usable backup, preserve corrupt data and explicitly recover/reset', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'video-editor-store-'));
  const path = join(dir, 'workspace.json');
  try {
    const store = new WorkspaceStore(path);
    assert.equal((await store.load()).data, null);
    await Promise.all([
      store.save(empty()),
      store.save({ ...empty(), outputFolder: '/output' }),
    ]);
    assert.equal((await store.load()).data?.outputFolder, '/output');
    await writeFile(path, 'broken data');
    const damaged = new WorkspaceStore(path);
    await assert.rejects(damaged.load(), /could not be restored/);
    await assert.rejects(damaged.save(empty()), /Restoration failed/);
    assert.equal(await readFile(path, 'utf8'), 'broken data');
    await damaged.recover();
    assert.equal((await damaged.load()).data?.outputFolder, null);
    assert.ok((await readdir(dir)).some((name) => name.includes('.damaged-')));
    await damaged.reset();
    await damaged.save(empty());
    assert.ok((await readdir(dir)).some((name) => name.includes('.archived-')));
  } finally {
    await rm(dir, { recursive: true });
  }
});
test('write failure rejects without replacing the last valid workspace; retry succeeds', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'video-editor-store-fail-'));
  const path = join(dir, 'workspace.json');
  try {
    const store = new WorkspaceStore(path);
    await store.save(empty());
    const original = await readFile(path, 'utf8');
    await mkdir(`${path}.pending`);
    await assert.rejects(store.save({ ...empty(), outputFolder: '/unsaved' }));
    assert.equal(await readFile(path, 'utf8'), original);
    await rm(`${path}.pending`, { recursive: true });
    await store.save({ ...empty(), outputFolder: '/retry' });
    assert.equal((await store.load()).data?.outputFolder, '/retry');
  } finally {
    await rm(dir, { recursive: true });
  }
});
test('retrying a corrected workspace clears the previous restoration write block', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'video-editor-restore-retry-'));
  const path = join(dir, 'workspace.json');
  try {
    const saved = withText();
    const store = new WorkspaceStore(path);
    await store.save(saved);
    await writeFile(path, 'corrupt');
    await assert.rejects(store.load(), /could not be restored/);
    await writeFile(path, JSON.stringify(saved));
    assert.deepEqual((await store.load()).data, saved);
    await store.save({ ...saved, outputFolder: '/after-retry' });
    assert.equal((await store.load()).data?.outputFolder, '/after-retry');
  } finally {
    await rm(dir, { recursive: true });
  }
});
test('version-1 workspaces migrate without losing text and version-2 defaults persist independently of source entries', async () => {
  const dir = await mkdtemp(
    join(tmpdir(), 'video-editor-workspace-migration-'),
  );
  const path = join(dir, 'workspace.json');
  try {
    const saved = withText();
    const { textDefault: _default, ...legacyWorkspace } = saved.workspace;
    await writeFile(
      path,
      JSON.stringify({ ...saved, version: 1, workspace: legacyWorkspace }),
    );
    const store = new WorkspaceStore(path);
    const loaded = (await store.load()).data;
    assert.ok(loaded);
    assert.equal(loaded.version, 2);
    assert.deepEqual(loaded.workspace, saved.workspace);
    const textDefault = {
      sourceName: asset.name,
      width: asset.width,
      height: asset.height,
      sampleAspectRatio: 1,
      box: { ...saved.workspace.entries[0]!.text!.box },
      enabled: false,
    };
    await store.save({
      ...loaded,
      workspace: { entries: [], activeId: null, textDefault },
      sources: {},
    });
    assert.deepEqual(
      (await new WorkspaceStore(path).load()).data?.workspace.textDefault,
      textDefault,
    );
    assert.equal(JSON.parse(await readFile(path, 'utf8')).version, 2);
  } finally {
    await rm(dir, { recursive: true });
  }
});
for (const action of ['remove', 'clear'] as const) {
  test(`${action} stays committed and reports cached-media cleanup failure without retaining stale saved entries`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'video-editor-remove-cleanup-'));
    const path = join(dir, 'workspace.json');
    try {
      const saved = withText();
      saved.workspace.textDefault = {
        sourceName: asset.name,
        width: asset.width,
        height: asset.height,
        sampleAspectRatio: 1,
        box: { ...saved.workspace.entries[0]!.text!.box },
        enabled: true,
      };
      await new WorkspaceStore(path).save(saved);
      const media: ConstructorParameters<typeof WorkspaceService>[1] = {
        outputFolder: null,
        onOutputFolderChanged: undefined,
        importVideo: async () => asset,
        reference: () => saved.sources[asset.id]!,
        isBusy: () => false,
        removeSource: async () => {
          throw new Error('Poster could not be removed.');
        },
      };
      const service = new WorkspaceService(path, media);
      await service.load();
      const warning =
        action === 'remove'
          ? await service.remove(asset.id)
          : await service.clear();
      assert.match(warning ?? '', /Workspace change saved/);
      assert.match(warning ?? '', /Poster could not be removed/);
      assert.deepEqual((await service.load()).workspace.entries, []);
      await service.flush();
      const result = (await new WorkspaceStore(path).load()).data;
      assert.deepEqual(result?.workspace.entries, []);
      assert.deepEqual(result?.sources, {});
      assert.deepEqual(
        result?.workspace.textDefault,
        action === 'remove' ? saved.workspace.textDefault : null,
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });
}
test('failed removal save preserves the cached workspace and never starts media cleanup', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'video-editor-remove-save-fail-'));
  const path = join(dir, 'workspace.json');
  try {
    const saved = withText();
    await new WorkspaceStore(path).save(saved);
    let cleaned = false;
    const media: ConstructorParameters<typeof WorkspaceService>[1] = {
      outputFolder: null,
      onOutputFolderChanged: undefined,
      importVideo: async () => asset,
      reference: () => saved.sources[asset.id]!,
      isBusy: () => false,
      removeSource: async () => {
        cleaned = true;
      },
    };
    const service = new WorkspaceService(path, media);
    await service.load();
    await mkdir(`${path}.pending`);
    await assert.rejects(service.remove(asset.id));
    assert.equal(cleaned, false);
    assert.deepEqual((await service.load()).workspace, saved.workspace);
    assert.deepEqual((await new WorkspaceStore(path).load()).data, saved);
  } finally {
    await rm(dir, { recursive: true });
  }
});
test('failed recovery preserves both files and remains retryable, including a missing primary from an interrupted older recovery', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'video-editor-recovery-fail-'));
  const path = join(dir, 'workspace.json');
  try {
    const saved = withText();
    const store = new WorkspaceStore(path);
    await store.save(saved);
    await store.save(saved);
    const backup = await readFile(`${path}.backup`, 'utf8');
    await writeFile(path, 'corrupt');
    await assert.rejects(store.load(), /could not be restored/);
    await mkdir(`${path}.pending`);
    await assert.rejects(store.recover());
    assert.equal(await readFile(path, 'utf8'), 'corrupt');
    assert.equal(await readFile(`${path}.backup`, 'utf8'), backup);
    await assert.rejects(store.save(empty()), /Restoration failed/);
    await rm(`${path}.pending`, { recursive: true });
    await store.recover();
    assert.deepEqual((await store.load()).data, saved);
    assert.equal(await readFile(`${path}.backup`, 'utf8'), backup);
    assert.ok(
      (await readdir(dir)).some((name) =>
        name.startsWith('workspace.json.damaged-'),
      ),
    );

    await rm(path);
    const interrupted = new WorkspaceStore(path);
    await assert.rejects(interrupted.load(), /previous save exists/);
    await assert.rejects(interrupted.save(empty()), /Restoration failed/);
    assert.equal(await readFile(`${path}.backup`, 'utf8'), backup);
    await interrupted.recover();
    assert.deepEqual((await interrupted.load()).data, saved);
  } finally {
    await rm(dir, { recursive: true });
  }
});
for (const outcome of ['cancelled', 'completed']) {
  test(`closing during the final source restore retries on immediate reopen (${outcome} probe)`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'video-editor-restore-close-'));
    const path = join(dir, 'workspace.json');
    try {
      const saved = withText();
      await new WorkspaceStore(path).save(saved);
      const entered = Promise.withResolvers<void>();
      const importing = Promise.withResolvers<VideoAsset>();
      let calls = 0;
      const media: ConstructorParameters<typeof WorkspaceService>[1] = {
        outputFolder: null,
        onOutputFolderChanged: undefined,
        importVideo: async () => {
          calls++;
          if (calls === 1) {
            entered.resolve();
            return importing.promise;
          }
          return asset;
        },
        reference: () => saved.sources[asset.id]!,
        isBusy: () => false,
        removeSource: async () => {},
      };
      const service = new WorkspaceService(path, media);
      const loading = service.load();
      await entered.promise;
      service.pauseRestore();
      const reopening = service.load();
      const rejected = assert.rejects(loading, /restoration was interrupted/);
      if (outcome === 'cancelled')
        importing.reject(new Error('Import cancelled.'));
      else importing.resolve(asset);
      const [, restored] = await Promise.all([rejected, reopening]);
      assert.equal(calls, 2);
      assert.deepEqual(restored.workspace, saved.workspace);
      await service.flush();
      assert.deepEqual((await new WorkspaceStore(path).load()).data, saved);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
}
test('relink merges only source metadata, preserving concurrent edits, checks, time and history', () => {
  const initial = withText().workspace;
  const changedText = {
    box: { ...newTextBox(asset, 20, 30), text: 'Typed while locating' },
    minimumHeight: 20,
  };
  let state = collectionReducer(emptyCollection, {
    type: 'load',
    workspace: initial,
  });
  state = collectionReducer(state, {
    type: 'history',
    action: { type: 'change', value: changedText, kind: 'discrete', time: 0 },
  });
  state = collectionReducer(state, {
    type: 'check',
    id: asset.id,
    checked: false,
  });
  state = collectionReducer(state, { type: 'time', id: asset.id, time: 4.5 });
  const history = activeHistory(state);
  const relinked = { ...asset, name: 'relocated.mp4' };
  state = collectionReducer(state, { type: 'relink', asset: relinked });
  assert.deepEqual(state.entries[0], {
    asset: relinked,
    text: changedText,
    checked: false,
    time: 4.5,
  });
  assert.equal(activeHistory(state), history);
  state = collectionReducer(state, {
    type: 'history',
    action: { type: 'undo' },
  });
  assert.deepEqual(state.entries[0]?.text, initial.entries[0]?.text);
  assert.equal(state.entries[0]?.asset.name, 'relocated.mp4');
});
test('collection navigation preserves independent text/history/checks/time and globally bounds retained history', () => {
  let state = emptyCollection;
  for (let index = 1; index <= 30; index++)
    state = collectionReducer(state, {
      type: 'import',
      entry: {
        asset: {
          ...asset,
          id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        },
        text: null,
        checked: false,
        time: 0,
      },
    });
  for (const entry of state.entries) {
    state = collectionReducer(state, { type: 'activate', id: entry.asset.id });
    for (let index = 0; index < 6; index++)
      state = collectionReducer(state, {
        type: 'history',
        action: {
          type: 'change',
          value: {
            box: {
              ...newTextBox(asset, 1, 2),
              text: `${entry.asset.id}:${index}`,
            },
            minimumHeight: 10,
          },
          kind: 'discrete',
          time: index,
        },
      });
    state = collectionReducer(state, {
      type: 'check',
      id: entry.asset.id,
      checked: true,
    });
    state = collectionReducer(state, {
      type: 'time',
      id: entry.asset.id,
      time: 3.25,
    });
  }
  assert.equal(state.entries.length, 30);
  assert.ok(
    state.entries.every(
      (entry) =>
        entry.text?.box.text.endsWith(':5') &&
        entry.checked &&
        entry.time === 3.25,
    ),
  );
  assert.ok(canUndo(activeHistory(state)));
  const count = Object.values(state.histories).reduce(
    (sum, item) =>
      sum + item.past.length + item.future.length + (item.pending ? 1 : 0),
    0,
  );
  assert.ok(count <= 100);
  state = collectionReducer(state, { type: 'activate', id: asset.id });
  assert.equal(activeHistory(state).present?.box.text, `${asset.id}:5`);
  state = collectionReducer(state, { type: 'check', id: null, checked: false });
  assert.ok(state.entries.every((entry) => !entry.checked));
});
