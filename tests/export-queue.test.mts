import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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
import { ExportQueueService } from '../src/main/media/export-queue.ts';
import { publishOutput } from '../src/main/media/publish.ts';
import { ExportQueueSchema } from '../src/shared/export-queue.ts';
import {
  newTextBox,
  type VideoAsset,
  type ExportRequest,
  type ExportResult,
} from '../src/shared/editor.ts';
import type { Workspace, WorkspaceEntry } from '../src/shared/workspace.ts';

function entry(name = 'clip.mp4', checked = true): WorkspaceEntry {
  const asset: VideoAsset = {
    id: randomUUID(),
    name,
    width: 320,
    height: 180,
    duration: 1,
    rotation: 0,
    sampleAspectRatio: 1,
    audioChannels: [],
    colour: { dynamicRange: 'sdr', bitDepth: 8 },
  };
  return {
    asset,
    checked,
    text: {
      box: { ...newTextBox(asset, 10, 10), text: name },
      minimumHeight: 10,
    },
    time: 0,
  };
}
function harness(
  directory: string,
  entries: WorkspaceEntry[],
  render?: (
    request: ExportRequest,
    options: { destination: string; suffix: number },
  ) => Promise<ExportResult>,
) {
  const workspace: Workspace = {
    entries,
    activeId: entries[0]?.asset.id ?? null,
    textDefault: null,
  };
  let cancel: () => void = () => {};
  const media: ConstructorParameters<typeof ExportQueueService>[0] = {
    outputFolder: directory,
    onOutputFolderChanged: undefined,
    isBusy: () => false,
    inspectExport: async (id: string) => {
      const found = entries.find((item) => item.asset.id === id);
      assert.ok(found);
      if (found.issue) throw new Error(found.issue);
      return { ...found.asset, codec: 'h264' };
    },
    getProgress: () => ({ phase: 'encoding' as const, fraction: 0.5 }),
    cancel: () => cancel(),
  };
  const queue = new ExportQueueService(
    media,
    join(directory, 'export-session.json'),
    render ??
      (async () => ({
        ok: true,
        outcome: 'completed',
        id: randomUUID(),
        path: '/published.mp4',
      })),
  );
  return {
    queue,
    media,
    workspace,
    onCancel: (handler: () => void) => {
      cancel = handler;
    },
  };
}

test('failed output-folder persistence restores the exact reviewed destination and filename plan', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'video-editor-queue-'));
  try {
    const changed = join(directory, 'different');
    await mkdir(changed);
    let destination: string | null = null;
    const { queue, workspace, media } = harness(
      directory,
      [entry()],
      async (_request, options) => {
        destination = options.destination;
        return {
          ok: true,
          outcome: 'completed',
          id: randomUUID(),
          path: '/published.mp4',
        };
      },
    );
    await queue.prepare('all', workspace);
    const reviewed = queue.snapshot();
    media.onOutputFolderChanged = async () => {
      throw new Error('Simulated preference save failure');
    };
    await assert.rejects(queue.setFolder(changed), /preference save failure/);
    assert.deepEqual(
      queue.snapshot(),
      reviewed,
      'A rejected folder command must not change the destination behind the renderer.',
    );
    assert.equal(media.outputFolder, directory);
    await queue.start(queue.snapshot()!.id);
    await queue.wait();
    assert.equal(destination, directory);
  } finally {
    await rm(directory, { recursive: true });
  }
});

test('preflight scopes are independent of active video; blank and unavailable sources stay distinct; names reserve collisions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'video-editor-queue-'));
  try {
    const entries = [
      entry('same.mp4', false),
      entry('same.mov'),
      entry('blank.mp4'),
      entry('missing.mp4'),
    ];
    entries[2]!.text!.box.text = ' \n ';
    entries[3]!.issue = 'Source unavailable';
    const { queue, workspace, media } = harness(directory, entries);
    const inspect = media.inspectExport;
    media.inspectExport = async (id) => ({
      ...(await inspect(id)),
      codec: id === entries[1]!.asset.id ? 'hevc' : 'h264',
    });
    await writeFile(join(directory, 'same_edited.mp4'), 'keep');
    await queue.prepare('checked', workspace);
    assert.equal(
      queue.snapshot()!.jobs[0]!.format,
      'HEVC Main / 8-bit SDR MP4',
    );
    assert.deepEqual(
      queue.snapshot()!.jobs.map((job) => job.status),
      ['ready', 'skipped', 'blocked'],
    );
    assert.equal(queue.snapshot()!.jobs[0]!.filename, 'same_edited_2.mp4');
    await queue.prepare('current', workspace);
    assert.deepEqual(
      queue.snapshot()!.jobs.map((job) => job.assetId),
      [entries[0]!.asset.id],
    );
    await queue.prepare('all', workspace);
    assert.deepEqual(
      queue
        .snapshot()!
        .jobs.slice(0, 2)
        .map((job) => job.filename),
      ['same_edited_2.mp4', 'same_edited_3.mp4'],
    );
    const noFolder = harness(directory, entries);
    noFolder.workspace.activeId = entries[0]!.asset.id;
    await noFolder.queue.prepare('all', noFolder.workspace);
    await noFolder.queue.setFolder(join(directory, 'not-created'));
    assert.deepEqual(
      noFolder.queue
        .snapshot()!
        .jobs.slice(0, 2)
        .map((job) => job.filename),
      ['same_edited.mp4', 'same_edited_2.mp4'],
    );
    await queue.setFolder(join(directory, 'not-created'));
    assert.match(queue.snapshot()!.folderError!, /unavailable/);
    await assert.rejects(queue.start(queue.snapshot()!.id), /valid folder/);
    assert.deepEqual((await readdir(directory)).sort(), ['same_edited.mp4']);
  } finally {
    await rm(directory, { recursive: true });
  }
});

test('queue freezes definitions, runs sequentially after a failure, and retries only failures with current edits', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'video-editor-queue-'));
  try {
    const entries = [entry('bad.mp4'), entry('good.mp4')];
    let active = 0;
    let fail = true;
    const seen: ExportRequest[] = [];
    const { queue, workspace } = harness(
      directory,
      entries,
      async (request) => {
        active++;
        assert.equal(active, 1);
        seen.push(structuredClone(request));
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        if (fail && request.assetId === entries[0]!.asset.id)
          throw new Error('One encoder failure');
        return {
          ok: true,
          outcome: 'completed',
          id: randomUUID(),
          path: join(directory, 'output.mp4'),
        };
      },
    );
    await queue.prepare('all', workspace);
    entries[0]!.text!.box.text = 'changed after preflight';
    await queue.start(queue.snapshot()!.id);
    await queue.wait();
    assert.equal(seen[0]!.textBox.text, 'bad.mp4');
    assert.deepEqual(
      queue.snapshot()!.jobs.map((job) => job.status),
      ['failed', 'completed'],
    );
    entries[0]!.text!.box.text = 'retry current text';
    fail = false;
    await queue.prepare('retry', workspace);
    assert.equal(queue.snapshot()!.jobs.length, 1);
    assert.equal(
      queue.snapshot()!.jobs[0]!.textBox!.text,
      'retry current text',
    );
    queue.dismiss();
    await queue.prepare('retry', workspace);
    assert.equal(
      queue.snapshot()!.jobs.length,
      1,
      'Cancelling retry preflight must not discard the failed jobs.',
    );
    await queue.start(queue.snapshot()!.id);
    await queue.wait();
    assert.equal(seen.length, 3);
    assert.equal(seen[2]!.textBox.text, 'retry current text');
    assert.equal(queue.snapshot()!.jobs[0]!.status, 'completed');
    assert.equal(
      ExportQueueSchema.parse(
        JSON.parse(
          await readFile(join(directory, 'export-session.json'), 'utf8'),
        ),
      ).status,
      'finished',
    );
  } finally {
    await rm(directory, { recursive: true });
  }
});

test('cancellation waits for the writer, preserves completed files, cancels remaining jobs and exposes cleanup failure paths', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'video-editor-queue-'));
  try {
    const entries = [
      entry('first.mp4'),
      entry('second.mp4'),
      entry('third.mp4'),
    ];
    const entered = Promise.withResolvers<void>();
    const stopped = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const output = join(directory, 'first_edited.mp4');
    const { queue, workspace, onCancel } = harness(
      directory,
      entries,
      async (request) => {
        if (request.assetId === entries[0]!.asset.id) {
          await writeFile(output, 'validated output');
          return {
            ok: true,
            outcome: 'completed',
            id: randomUUID(),
            path: output,
          };
        }
        entered.resolve();
        await stopped.promise;
        await release.promise;
        throw new Error(
          `Temporary export files could not be removed: ${directory}/.owned-partial`,
        );
      },
    );
    onCancel(() => stopped.resolve());
    await queue.prepare('all', workspace);
    await queue.start(queue.snapshot()!.id);
    await entered.promise;
    queue.cancel();
    queue.cancel();
    assert.equal(queue.isRunning(), true);
    assert.equal(queue.snapshot()!.status, 'stopping');
    assert.equal(queue.snapshot()!.jobs[2]!.status, 'queued');
    release.resolve();
    await queue.wait();
    assert.deepEqual(
      queue.snapshot()!.jobs.map((job) => job.status),
      ['completed', 'failed', 'cancelled'],
    );
    assert.match(queue.snapshot()!.jobs[1]!.error!, /\.owned-partial/);
    assert.equal(await readFile(output, 'utf8'), 'validated output');
    assert.equal(queue.isRunning(), false);
  } finally {
    await rm(directory, { recursive: true });
  }
});

test('journal restoration marks active/pending work interrupted without restarting; corrupt records are preserved and disclosed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'video-editor-queue-'));
  try {
    const entries = [entry(), entry('other.mp4')];
    const { queue, workspace } = harness(directory, entries);
    await queue.prepare('all', workspace);
    const state = queue.snapshot()!;
    state.status = 'running';
    state.jobs[0]!.status = 'exporting';
    state.jobs[1]!.status = 'queued';
    const record = join(directory, 'export-session.json');
    await writeFile(record, JSON.stringify(state));
    let renders = 0;
    const restored = harness(directory, entries, async () => {
      renders++;
      throw new Error('Must not restart');
    }).queue;
    await restored.load();
    assert.equal(restored.snapshot()!.status, 'interrupted');
    assert.deepEqual(
      restored.snapshot()!.jobs.map((job) => job.status),
      ['interrupted', 'interrupted'],
    );
    assert.equal(renders, 0);
    await writeFile(record, 'damaged');
    const damaged = harness(directory, entries).queue;
    await damaged.load();
    assert.match(damaged.snapshot()!.notice!, /unreadable.*preserved/);
    const archive = (await readdir(directory)).find((name) =>
      name.includes('.damaged-'),
    );
    assert.ok(archive);
    assert.equal(await readFile(join(directory, archive), 'utf8'), 'damaged');
  } finally {
    await rm(directory, { recursive: true });
  }
});

test('publication respects planned suffixes and late collisions without overwriting', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'video-editor-publish-'));
  try {
    const partial = join(directory, 'partial.mp4');
    await writeFile(partial, 'new');
    await writeFile(join(directory, 'clip_edited_2.mp4'), 'keep');
    const output = await publishOutput(
      partial,
      directory,
      'clip.mov',
      new AbortController().signal,
      2,
    );
    assert.equal(output, join(directory, 'clip_edited_3.mp4'));
    assert.equal(
      await readFile(join(directory, 'clip_edited_2.mp4'), 'utf8'),
      'keep',
    );
    assert.equal(await readFile(output, 'utf8'), 'new');
  } finally {
    await rm(directory, { recursive: true });
  }
});
test('a per-file output-name blocker does not invalidate the destination or other videos', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'video-editor-queue-'));
  try {
    const { queue, workspace } = harness(directory, [
      entry(`${'n'.repeat(250)}.mp4`),
      entry('short.mp4'),
    ]);
    await queue.prepare('all', workspace);
    assert.equal(queue.snapshot()!.folderError, null);
    assert.deepEqual(
      queue.snapshot()!.jobs.map((job) => job.status),
      ['blocked', 'ready'],
    );
    assert.match(queue.snapshot()!.jobs[0]!.error!, /filename is too long/);
    await queue.start(queue.snapshot()!.id);
    await queue.wait();
    assert.deepEqual(
      queue.snapshot()!.jobs.map((job) => job.status),
      ['blocked', 'completed'],
    );
  } finally {
    await rm(directory, { recursive: true });
  }
});

test('journal write failure starts no worker and can be retried after repair', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'video-editor-queue-'));
  try {
    let renders = 0;
    const { queue, workspace } = harness(directory, [entry()], async () => {
      renders++;
      return {
        ok: true,
        outcome: 'completed',
        id: randomUUID(),
        path: '/published.mp4',
      };
    });
    await queue.prepare('all', workspace);
    const record = join(directory, 'export-session.json');
    await mkdir(record);
    await assert.rejects(queue.start(queue.snapshot()!.id));
    assert.equal(renders, 0);
    assert.equal(queue.isRunning(), false);
    assert.equal(queue.snapshot()!.status, 'preflight');
    queue.setClosing(true);
    await assert.rejects(
      queue.start(queue.snapshot()!.id),
      /no longer current/,
    );
    queue.setClosing(false);
    assert.equal(
      (await readdir(directory)).filter((name) => name.endsWith('.tmp')).length,
      0,
    );
    await rm(record, { recursive: true });
    await queue.start(queue.snapshot()!.id);
    await queue.wait();
    assert.equal(renders, 1);
    assert.equal(queue.snapshot()!.status, 'finished');
  } finally {
    await rm(directory, { recursive: true });
  }
});
