import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { publishOutput } from '../src/main/media/publish.ts';
import {
  describeVideo,
  validateOutput,
  type Probe,
} from '../src/main/media/probe.ts';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MediaWorker } from '../src/main/media/worker.ts';
import {
  HANDLES,
  newTextBox,
  resizeTextBox,
  unsupportedText,
} from '../src/shared/editor.ts';
import {
  canRedo,
  canUndo,
  newTextHistory,
  textHistoryReducer,
  type EditKind,
  type TextState,
} from '../src/shared/history.ts';

test('text history groups typing bursts and restores complete auto-fit/style/deletion snapshots', () => {
  let state = newTextHistory();
  const original: TextState = {
    box: newTextBox({ width: 1920, height: 1080 }, 100, 200),
    minimumHeight: 75,
  };
  const change = (value: TextState | null, kind: EditKind, time: number) => {
    state = textHistoryReducer(state, { type: 'change', value, kind, time });
  };
  change(original, 'discrete', 0);
  change({ ...original, box: { ...original.box, text: 'H' } }, 'typing', 10);
  const typed = { ...original, box: { ...original.box, text: 'Hello' } };
  change(typed, 'typing', 300);
  const wrapped = {
    box: { ...typed.box, text: 'Hello\nWorld', height: 160 },
    minimumHeight: 160,
  };
  change(wrapped, 'typing', 1100);
  const styled = {
    ...wrapped,
    box: { ...wrapped.box, fontSize: 64.5, bold: true, colour: '#12AB34' },
  };
  change(styled, 'discrete', 1200);
  change(null, 'discrete', 1300);
  for (const expected of [styled, wrapped, typed, original, null]) {
    assert.equal(canUndo(state), true);
    state = textHistoryReducer(state, { type: 'undo' });
    assert.deepEqual(state.present, expected);
  }
  assert.equal(canUndo(state), false);
  for (const expected of [original, typed, wrapped, styled, null]) {
    assert.equal(canRedo(state), true);
    state = textHistoryReducer(state, { type: 'redo' });
    assert.deepEqual(state.present, expected);
  }
  assert.equal(canRedo(state), false);
});

test('long gestures/compositions are single edits; a round-trip gesture retains redo', () => {
  const original: TextState = {
    box: newTextBox({ width: 1920, height: 1080 }, 100, 200),
    minimumHeight: 75,
  };
  let state = textHistoryReducer(newTextHistory(), {
    type: 'change',
    value: original,
    kind: 'discrete',
    time: 0,
  });
  const moved = {
    ...original,
    box: { ...original.box, x: -300, y: 1200, width: 800, height: 400 },
  };
  for (let time = 0; time <= 10000; time += 1000)
    state = textHistoryReducer(state, {
      type: 'change',
      value: { ...moved, box: { ...moved.box, x: moved.box.x + time } },
      kind: 'gesture',
      time,
    });
  state = textHistoryReducer(state, { type: 'commit' });
  const final = state.present;
  state = textHistoryReducer(state, { type: 'undo' });
  assert.deepEqual(state.present, original);
  assert.equal(canRedo(state), true);
  for (const value of [moved, original])
    state = textHistoryReducer(state, {
      type: 'change',
      value,
      kind: 'gesture',
      time: 20000,
    });
  state = textHistoryReducer(state, { type: 'commit' });
  assert.equal(
    canRedo(state),
    true,
    'An unchanged gesture must not destroy redo.',
  );
  state = textHistoryReducer(state, { type: 'redo' });
  assert.deepEqual(state.present, final);
  state = textHistoryReducer(state, { type: 'undo' });
  for (const [time, text] of [
    [0, 'e'],
    [5000, 'e\u0301'],
  ] as const)
    state = textHistoryReducer(state, {
      type: 'change',
      value: { ...original, box: { ...original.box, text } },
      kind: 'composition',
      time,
    });
  assert.equal(canRedo(state), false);
  state = textHistoryReducer(state, { type: 'undo' });
  assert.deepEqual(state.present, original);
});

test('explicit boundaries split typing, divergent edits clear redo, and source replacement resets history', () => {
  const box = newTextBox({ width: 1920, height: 1080 }, 0, 0);
  const value = { box, minimumHeight: 75 };
  let state = textHistoryReducer(newTextHistory(), {
    type: 'change',
    value,
    kind: 'discrete',
    time: 0,
  });
  for (const text of ['A', 'AB']) {
    state = textHistoryReducer(state, {
      type: 'change',
      value: { ...value, box: { ...box, text } },
      kind: 'typing',
      time: 10,
    });
    state = textHistoryReducer(state, { type: 'commit' });
  }
  state = textHistoryReducer(state, { type: 'undo' });
  assert.equal(state.present?.box.text, 'A');
  state = textHistoryReducer(state, {
    type: 'change',
    value: { ...value, box: { ...box, text: 'AX' } },
    kind: 'typing',
    time: 20,
  });
  assert.equal(canRedo(state), false);
  state = textHistoryReducer(state, { type: 'redo' });
  assert.equal(state.present?.box.text, 'AX');
  state = textHistoryReducer(state, { type: 'reset' });
  assert.equal(state.present, null);
  assert.equal(canUndo(state), false);
  assert.equal(canRedo(state), false);
});

test('history retains the closest 100 steps across Undo/Redo without changing current text', () => {
  let state = newTextHistory();
  for (let index = 0; index < 150; index++) {
    state = textHistoryReducer(state, {
      type: 'change',
      value: {
        box: {
          ...newTextBox({ width: 320, height: 180 }, index, 0),
          text: 'Keep me',
        },
        minimumHeight: 20,
      },
      kind: 'discrete',
      time: index,
    });
  }
  assert.equal(state.past.length, 100);
  for (let index = 0; index < 100; index++)
    state = textHistoryReducer(state, { type: 'undo' });
  assert.equal(state.present?.box.x, 49);
  assert.equal(canUndo(state), false);
  for (let index = 0; index < 100; index++)
    state = textHistoryReducer(state, { type: 'redo' });
  assert.equal(state.present?.box.x, 149);
  assert.equal(state.present?.box.text, 'Keep me');
});

test('history enforces its 16 MiB snapshot budget, including a pending gesture', () => {
  let state = newTextHistory();
  const text = 'X'.repeat(1024 * 1024);
  for (let index = 0; index < 20; index++) {
    state = textHistoryReducer(state, {
      type: 'change',
      value: {
        box: { ...newTextBox({ width: 320, height: 180 }, index, 0), text },
        minimumHeight: 20,
      },
      kind: index === 19 ? 'gesture' : 'discrete',
      time: index,
    });
  }
  assert.ok(state.past.length + (state.pending ? 1 : 0) <= 7);
  assert.equal(state.present?.box.text, text);
  state = textHistoryReducer(state, { type: 'undo' });
  assert.equal(state.present?.box.x, 18);
  state = textHistoryReducer(state, { type: 'redo' });
  assert.equal(state.present?.box.x, 19);
});

test('all eight handles resize only bounds and retain the opposite anchor', () => {
  const box = {
    ...newTextBox({ width: 1920, height: 1080 }, 100, 200),
    width: 300,
    height: 150,
  };
  for (const handle of HANDLES) {
    const next = resizeTextBox(box, handle, 20, 30, () => ({
      width: 40,
      height: 50,
    }));
    assert.equal(next.fontSize, box.fontSize);
    assert.equal(next.text, box.text);
    if (handle.includes('w'))
      assert.equal(next.x + next.width, box.x + box.width);
    if (handle.includes('n'))
      assert.equal(next.y + next.height, box.y + box.height);
    if (!handle.includes('w') && !handle.includes('e'))
      assert.equal(next.width, box.width);
    if (!handle.includes('n') && !handle.includes('s'))
      assert.equal(next.height, box.height);
  }
});

test('a top/left drag crossing the fit minimum keeps the bottom/right fixed', () => {
  const box = {
    ...newTextBox({ width: 1920, height: 1080 }, -20, -40),
    width: 300,
    height: 150,
  };
  const next = resizeTextBox(box, 'nw', 400, 400, () => ({
    width: 80,
    height: 100,
  }));
  assert.equal(next.width, 80);
  assert.equal(next.height, 100);
  assert.equal(next.x + next.width, box.x + box.width);
  assert.equal(next.y + next.height, box.y + box.height);
  const wider = resizeTextBox(box, 's', 0, 100, () => ({
    width: 80,
    height: 100,
  }));
  assert.equal(wider.height, 250);
});

test('warn about unverified scripts without flagging Latin or representative emoji clusters', () => {
  assert.deepEqual(unsupportedText('Cafe\u0301\n😀 👍🏽 🇨🇦 👨‍👩‍👧‍👦 #1 + 2 = 3'), []);
  assert.deepEqual(unsupportedText('Text 文文'), ['文']);
});

test('simultaneous publications cannot overwrite existing files or each other', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'video-editor-publish-test-'));
  try {
    const first = join(directory, 'first.partial');
    const second = join(directory, 'second.partial');
    const existing = join(directory, 'clip_edited.mp4');
    await Promise.all([
      writeFile(first, 'first'),
      writeFile(second, 'second'),
      writeFile(existing, 'original-existing-output'),
    ]);
    const signal = new AbortController().signal;
    const paths = await Promise.all([
      publishOutput(first, directory, 'clip.mov', signal),
      publishOutput(second, directory, 'clip.mov', signal),
    ]);
    assert.deepEqual(paths.map((path) => basename(path)).sort(), [
      'clip_edited_2.mp4',
      'clip_edited_3.mp4',
    ]);
    assert.equal(await readFile(existing, 'utf8'), 'original-existing-output');
    assert.deepEqual(
      (await Promise.all(paths.map((path) => readFile(path, 'utf8')))).sort(),
      ['first', 'second'],
    );
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      publishOutput(first, directory, 'other.mov', controller.signal),
      /cancelled/,
    );
    assert.equal(
      (await readdir(directory)).includes('other_edited.mp4'),
      false,
    );
  } finally {
    await rm(directory, { recursive: true });
  }
});

test('unusable output duration cannot accidentally pass validation through NaN', () => {
  const source: Probe = {
    streams: [
      {
        index: 0,
        codec_type: 'video',
        codec_name: 'h264',
        width: 320,
        height: 180,
        start_time: '0',
        avg_frame_rate: '25/1',
        nb_frames: '50',
      },
    ],
    format: { duration: '2' },
  };
  const asset = describeVideo(source, randomUUID(), 'clip.mp4');
  for (const duration of [undefined, 'N/A', 'NaN']) {
    const output: Probe = {
      ...source,
      format: duration === undefined ? {} : { duration },
    };
    assert.throws(
      () => validateOutput(source, output, asset),
      /output duration/,
    );
  }
});

test('decoded counts handle hidden edit-list samples without accepting lost frames', () => {
  const source: Probe = {
    streams: [
      {
        index: 0,
        codec_type: 'video',
        codec_name: 'h264',
        width: 320,
        height: 180,
        start_time: '0',
        avg_frame_rate: '25/1',
        nb_frames: '30',
        nb_read_frames: '25',
      },
    ],
    format: { duration: '1' },
  };
  const asset = describeVideo(source, randomUUID(), 'trimmed.mp4');
  const output = (count: string | undefined): Probe => ({
    ...source,
    streams: source.streams.map((stream) => ({
      ...stream,
      nb_frames: '25',
      nb_read_frames: count,
    })),
  });
  assert.doesNotThrow(() => validateOutput(source, output('25'), asset));
  assert.throws(
    () => validateOutput(source, output('24'), asset),
    /expected 25 displayed frames, received 24/,
  );
  for (const count of [undefined, 'N/A', '0']) {
    assert.throws(
      () => validateOutput(source, output(count), asset),
      /Frame counts could not be verified/,
    );
  }
});

test(
  'cancelling a running native worker waits for the owned process to stop',
  { timeout: 10000 },
  async () => {
    const worker = new MediaWorker();
    const controller = new AbortController();
    let cancelledAt = 0;
    await assert.rejects(
      worker.run(
        fileURLToPath(
          new URL(
            process.platform === 'win32'
              ? '../resources/media-tools/win32-x64/ffmpeg.exe'
              : '../resources/media-tools/darwin-arm64/ffmpeg',
            import.meta.url,
          ),
        ),
        [
          '-nostdin',
          '-v',
          'error',
          '-re',
          '-f',
          'lavfi',
          '-i',
          'testsrc2=s=320x180:r=25:d=8',
          '-progress',
          'pipe:1',
          '-nostats',
          '-f',
          'null',
          '-',
        ],
        controller.signal,
        (microseconds) => {
          if (microseconds > 0 && !controller.signal.aborted) {
            cancelledAt = Date.now();
            controller.abort();
          }
        },
      ),
      /cancelled/,
    );
    assert.ok(
      cancelledAt > 0,
      'Cancellation must happen after actual native progress.',
    );
    assert.ok(
      Date.now() - cancelledAt < 5000,
      'The process must stop within five seconds.',
    );
  },
);
