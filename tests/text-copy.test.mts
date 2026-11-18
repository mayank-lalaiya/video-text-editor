import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newTextBox, type VideoAsset } from '../src/shared/editor.ts';
import {
  activeHistory,
  collectionReducer,
  emptyCollection,
  type Collection,
} from '../src/shared/collection.ts';
import {
  copyText,
  createCopyPlan,
  type MeasureText,
} from '../src/shared/text-copy.ts';
import { MAX_HISTORY_STEPS } from '../src/shared/history.ts';

const video = (index: number, width = 1080, height = 1920): VideoAsset => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  name: `${index}.mp4`,
  width,
  height,
  rotation: 0,
  sampleAspectRatio: 1,
  duration: 10,
  audioChannels: [],
  colour: { dynamicRange: 'sdr', bitDepth: 8 },
});
const source = video(1);
const measure: MeasureText = (box) => ({
  width: box.width,
  height: box.fontSize + box.padding * 2,
});
function initial(...targets: VideoAsset[]): Collection {
  let state = emptyCollection;
  for (const asset of [source, ...targets])
    state = collectionReducer(state, {
      type: 'import',
      entry: { asset, text: null, checked: false, time: 0 },
    });
  return collectionReducer(state, {
    type: 'history',
    action: {
      type: 'change',
      kind: 'discrete',
      time: 0,
      value: {
        box: {
          ...newTextBox(source, -108.125, 192.25),
          text: 'Hello\nWorld',
          fontSize: 50.25,
          padding: 8.125,
          width: 540.5,
          height: 140.75,
          bold: true,
          colour: '#12ABEF',
        },
        minimumHeight: 70,
      },
    },
  });
}
const apply = (state: Collection, fit = measure) =>
  collectionReducer(state, { type: 'apply', plan: createCopyPlan(state, fit) });
const navigate = (state: Collection, asset: VideoAsset) =>
  collectionReducer(state, { type: 'activate', id: asset.id });
const history = (state: Collection, type: 'undo' | 'redo') =>
  collectionReducer(state, { type: 'history', action: { type } });

test('relative copies retain exact 2x geometry, font, padding and off-frame precision without sharing boxes', () => {
  const target = video(2, 2160, 3840);
  const before = initial(target);
  const state = apply(before);
  const box = state.entries[0]!.text!.box;
  const copy = state.entries[1]!.text!.box;
  for (const key of [
    'x',
    'y',
    'width',
    'height',
    'fontSize',
    'padding',
  ] as const)
    assert.equal(copy[key], box[key] * 2, key);
  for (const key of [
    'text',
    'font',
    'colour',
    'bold',
    'italic',
    'align',
  ] as const)
    assert.equal(copy[key], box[key], key);
  assert.equal(state.entries[0], before.entries[0]);
  copy.x = 999;
  assert.equal(box.x, -108.125);
  assert.equal(state.textDefault?.box.x, -108.125);
  assert.equal(state.copyReport?.mixed, 0);
});
test('mixed-ratio copies reflow without shrinking fonts, preserve existing content and report failed items', () => {
  const mixed = video(2, 540, 480),
    preserved = video(3),
    failed = video(4, 1080, 1);
  let state = initial(mixed, preserved, failed);
  state = navigate(state, preserved);
  state = collectionReducer(state, {
    type: 'history',
    action: {
      type: 'change',
      kind: 'discrete',
      time: 0,
      value: {
        box: { ...newTextBox(preserved, 0, 0), text: 'Custom' },
        minimumHeight: 10,
      },
    },
  });
  const custom = state.entries[2];
  state = navigate(state, source);
  state = apply(state, (box) => ({
    width: box.width,
    height: box.fontSize < 20 ? 200 : 70,
  }));
  assert.equal(state.entries[1]?.text?.box.fontSize, 50.25 / 4);
  assert.equal(state.entries[1]?.text?.box.height, 200);
  assert.equal(state.entries[1]?.text?.box.x, -108.125 / 2);
  assert.equal(state.entries[2], custom);
  assert.equal(state.entries[3]?.text, null);
  assert.deepEqual(
    {
      ...state.copyReport,
      errors: state.copyReport?.errors.map((error) => error.name),
    },
    {
      sourceName: '1.mp4',
      filled: 1,
      preserved: 1,
      mixed: 1,
      errors: ['4.mp4'],
      undone: false,
      undoLimited: false,
    },
  );
});
test('equal display ratios with different pixel shapes still flag copied text for wrapping review', () => {
  const state = initial(video(2, 640, 360));
  state.entries[0] = {
    ...state.entries[0]!,
    asset: { ...source, width: 320, height: 240, sampleAspectRatio: 4 / 3 },
  };
  const plan = createCopyPlan(state, measure);
  assert.equal(plan.report.mixed, 1);
  const proportional = {
    ...state,
    entries: [
      state.entries[0]!,
      {
        ...state.entries[1]!,
        asset: { ...video(2, 640, 480), sampleAspectRatio: 4 / 3 },
      },
    ],
  };
  assert.equal(createCopyPlan(proportional, measure).report.mixed, 0);
});
test('group Undo/Redo after navigation/checks/seeking preserves source edits and restores prior histories/defaults', () => {
  const target = video(2);
  let state = initial(target);
  state = navigate(state, target);
  const whitespace = {
    box: { ...newTextBox(target, 10, 20), text: ' \n\t' },
    minimumHeight: 20,
  };
  state = collectionReducer(state, {
    type: 'history',
    action: { type: 'change', value: whitespace, kind: 'discrete', time: 0 },
  });
  state = collectionReducer(state, {
    type: 'history',
    action: {
      type: 'change',
      value: { ...whitespace, box: { ...whitespace.box, text: 'Future edit' } },
      kind: 'discrete',
      time: 1,
    },
  });
  state = history(state, 'undo');
  const oldHistory = activeHistory(state);
  state = navigate(state, source);
  state = apply(state);
  const snapshot = state.textDefault;
  state = navigate(state, target);
  state = collectionReducer(state, {
    type: 'check',
    id: target.id,
    checked: true,
  });
  state = collectionReducer(state, { type: 'time', id: target.id, time: 4 });
  state = history(state, 'undo');
  assert.deepEqual(state.entries[1]?.text, whitespace);
  assert.deepEqual(activeHistory(state).past, oldHistory.past);
  assert.deepEqual(activeHistory(state).future, oldHistory.future);
  assert.equal(state.textDefault, null);
  assert.equal(state.entries[1]?.checked, true);
  assert.equal(state.entries[1]?.time, 4);
  assert.equal(state.entries[0]?.text?.box.text, 'Hello\nWorld');
  state = history(state, 'redo');
  assert.equal(state.entries[1]?.text?.box.text, 'Hello\nWorld');
  assert.deepEqual(state.textDefault, snapshot);
  assert.ok(activeHistory(state).revision > oldHistory.revision);
});
test('later edits end group history without linking copies/defaults, while copied and inherited text remains independently undoable', () => {
  const target = video(2),
    imported = video(3);
  let state = apply(initial(target));
  const originalDefault = state.textDefault;
  state = collectionReducer(state, {
    type: 'history',
    action: {
      type: 'change',
      kind: 'discrete',
      time: 1,
      value: {
        box: { ...state.entries[0]!.text!.box, text: 'Later source edit' },
        minimumHeight: 70,
      },
    },
  });
  assert.equal(state.group, null);
  assert.equal(state.textDefault, originalDefault);
  state = navigate(state, target);
  state = history(state, 'undo');
  assert.equal(state.entries[1]?.text, null);
  assert.equal(state.entries[0]?.text?.box.text, 'Later source edit');
  assert.ok(state.textDefault);
  const inherited = copyText(state.textDefault, imported, measure);
  state = collectionReducer(state, {
    type: 'import',
    entry: { asset: imported, text: inherited, checked: false, time: 0 },
  });
  state = navigate(state, imported);
  state = history(state, 'undo');
  assert.equal(state.entries.length, 3);
  assert.equal(state.entries[2]?.text, null);
  assert.equal(state.textDefault, originalDefault);
  state = history(state, 'redo');
  assert.equal(state.entries[2]?.text?.box.text, 'Hello\nWorld');
});
test('zero-fill applies update detached defaults, respect off/on and restore the previous default by group Undo', () => {
  let state = apply(initial());
  const old = state.textDefault;
  assert.equal(old?.enabled, true);
  assert.equal(state.copyReport?.filled, 0);
  state = collectionReducer(state, { type: 'auto-apply', enabled: false });
  state = collectionReducer(state, {
    type: 'history',
    action: {
      type: 'change',
      kind: 'discrete',
      time: 1,
      value: {
        box: { ...state.entries[0]!.text!.box, text: 'New default' },
        minimumHeight: 70,
      },
    },
  });
  const before = state.textDefault;
  state = apply(state);
  assert.equal(state.textDefault?.enabled, false);
  assert.equal(state.textDefault?.box.text, 'New default');
  state = history(state, 'undo');
  assert.deepEqual(state.textDefault, before);
  state = history(state, 'redo');
  state = collectionReducer(state, { type: 'auto-apply', enabled: true });
  assert.equal(state.group, null);
  assert.equal(state.textDefault?.box.text, 'New default');
  state = collectionReducer(state, { type: 'remove', id: source.id });
  assert.equal(state.textDefault?.box.text, 'New default');
});
test('history limits reserve space for a new group while preserving current text', () => {
  let state = initial(video(2));
  for (let index = 0; index < MAX_HISTORY_STEPS + 10; index++)
    state = collectionReducer(state, {
      type: 'history',
      action: {
        type: 'change',
        kind: 'discrete',
        time: index,
        value: {
          box: { ...state.entries[0]!.text!.box, text: `Text ${index}` },
          minimumHeight: 70,
        },
      },
    });
  const current = state.entries[0]?.text;
  state = apply(state);
  assert.ok(state.group);
  assert.ok(
    Object.values(state.histories).reduce(
      (sum, item) => sum + item.past.length + item.future.length,
      0,
    ) < MAX_HISTORY_STEPS,
  );
  state = history(state, 'undo');
  assert.equal(state.entries[0]?.text, current);
  assert.equal(state.entries[1]?.text, null);
});
test('oversized group checkpoints are explicitly dropped without discarding current text or the reusable default', () => {
  let state = initial();
  const text = 'x'.repeat(9 * 1024 * 1024);
  state = collectionReducer(state, {
    type: 'history',
    action: {
      type: 'change',
      value: {
        box: { ...state.entries[0]!.text!.box, text },
        minimumHeight: 70,
      },
      kind: 'discrete',
      time: 1,
    },
  });
  state = apply(state);
  assert.equal(state.group, null);
  assert.equal(state.copyReport?.undoLimited, true);
  assert.equal(state.entries[0]?.text?.box.text, text);
  assert.equal(state.textDefault?.box.text, text);
});
