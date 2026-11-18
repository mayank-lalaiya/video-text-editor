# Development and Validation History

Implementation history and validation evidence through the 0.10.0 Windows
portable preview. For current setup, usage and build instructions, see the
[project README](../README.md). Real-footage samples use anonymous labels;
private media, measurements containing source paths and generated packages
are not included in the repository.

An offline macOS-first desktop application. **Milestone 9: local macOS review package**
validates the bundled app, offline editing/playback/export and acceptance measurements.
Edit text on a poster immediately, play to check placement,
then export high-quality MP4 without changing the original. Eight-bit SDR retains
H.264 or HEVC; 10-bit SDR and HDR use Main10 HEVC. Compatible AAC audio is copied.

This is a local review build, not the complete PRD or a production release.
Wider-distribution certification and physical HDR visual review are still required.

## Windows portable preview: 0.10.0

Validated on 2026-11-18 by
[GitHub Actions run 44329161383](https://github.com/mayank-lalaiya/video-text-editor/actions/runs/44329161383),
commit `e92d8a765ed5bbc46bbc225569d02170c3d42f38`.

- Windows Server 2022 x64: source-built static CPU workers, PE/build/DLL audit,
  pinned resources/licenses/corresponding source, typecheck/lint, all **65**
  unit/native cases, portable ZIP packaging and **2** packaged checks passed.
- Windows Server 2025 x64: independently downloaded/extracted the actual ZIP
  and passed both packaged checks again, without a developer media-tool PATH.
- The real hardened app imported and exported SDR H.264, SDR HEVC, HLG Main10
  and PQ Main10, played the preview, rendered text/emoji, used paths containing
  spaces and accented characters, and reopened the saved workspace offline.
- Each export retained **50** displayed frames, timestamp drift within **2 us**,
  identical AAC packet hashes, unchanged original source bytes and visible text.
  No owned partial-export directory remained.
- Job Object supervision passed ordinary cancellation (keeping live session
  posters) and forced-parent-death cleanup (reaping the worker and preserving
  originals). Oversized Windows output names are blocked per file.

The same artifact passed these unchanged numerical gates on both runners:

| Measurement | Required | Observed |
| --- | --- | --- |
| Non-text SDR H.264 PSNR | >=42 dB | >=56.61 dB |
| Non-text SDR HEVC PSNR | >=42 dB | 61.01 dB |
| HLG / PQ gradient levels | >700 | 821 / 1021 |
| HLG / PQ mean non-text ten-bit error | <2 codes | 0.129 / 0.005 codes |
| HLG / PQ mean glyph-white error | <3 codes | 0.644 / 0.460 codes |
| Opaque white glyph-interior samples | >50 | 270 per HDR export |

HLG uses limited range; PQ uses full range. The gradient inputs are genuinely
ten-bit, not eight-bit images relabelled as Main10.

The Windows-only offscreen text compositor was followed by a fresh Mac build
and calibrated HDR export regression: HLG/PQ gradient levels **772 / 932** and
glyph-white errors **1.023 / 0.944** codes, unchanged from earlier Mac results.
The full existing Mac desktop/package suite had already passed **40** checks
with **2** optional skips; **23** focused colour/preview/queue/guardian cases
also passed after the Windows lifecycle and filename fixes.

These are unsigned portable previews, not signed installers or production
certification. No Windows 10/11 client PC, physical HDR display or reference-PC
performance/power-loss testing was performed. Server CI does not close those
release gates. Mac workers remain LGPL-only; the separate Windows GPL FFmpeg
build includes its pinned FFmpeg/x264/x265/zlib sources, recipe and notices.

The remaining sections record the historical macOS milestones through 0.9.2.

## Historical macOS review workflow

1. Import or drop H.264/HEVC MP4/MOV files: SDR or supported 10-bit BT.2020 HLG/PQ.
   HDR shows **SDR preview; HDR export**; preview colour is a placement approximation.
   Further imports append independent entries; duplicates preserve existing edits
   and show a notice. Invalid files are listed individually without losing valid clips.
   Click a row to open it; its export checkbox does not change the active video.
2. Click the video to create text, or use **Add text** in the empty inspector
   for a centred box. Type directly; double-click or press Enter on the selected
   box to edit again. Escape or Cmd+Enter finishes typing. Clicking unused
   workspace space deselects; clicking the video selects the existing box.
3. Drag the box to move it. Its eight handles resize the bounds without changing
   font size. The inspector controls font, size, bold/italic, colour/HEX, alignment,
   X/Y/Width/Height, centring and deletion. Font size accepts one decimal place;
   its steppers change one video pixel. The colour swatch opens an opaque HSV/
   preset picker with keyboard-accessible sliders; HEX accepts only `#RRGGBB`.
   Selected-box arrows nudge 1 pixel, or 10 with Shift; Delete/Backspace deletes
   the object only outside text entry.
4. Use Play/Pause, the playhead slider, elapsed/total time and preview Mute below
   the video. Space toggles playback outside text inputs/focused controls. Text
   operations pause playback. Preview plays the first audio track; Mute and
   preview quality never change the exported audio, resolution or frame timing.
5. Use **Apply to all** under Position & Size to copy text to every other video
   with absent, empty or whitespace-only text, including unchecked videos.
   Existing nonempty text and the source stay unchanged. Position/box width scale
   with video width; vertical geometry, font size and padding scale with height.
   Mixed aspect ratios can wrap differently: play each copy to check it.
6. The last-applied snapshot becomes the independent default for later imports.
   The first apply enables **Auto-apply to new imports**; later applies respect
   its on/off setting, even when no videos need filling. Source/copy edits,
   deletion and source removal do not change this saved snapshot. Toggling the
   setting affects future imports only; navigation/relaunch never refills deleted text.
7. Choose **Export current**, or use **Export batch > Export checked / Export all**.
   The scope is independent of the open video. Preflight lists automatic formats,
   planned names, empty-text skips and unavailable sources. Choose/change one
   output folder, then **Start export**. Text and workspace mutations stay locked
   until the queue finishes or cancellation has stopped all writers.
8. The progress dialog shows each job and current/overall progress. Individual
   failures do not stop later jobs. Results show real paths, errors and distinct
   completed/failed/cancelled/skipped/unavailable counts. **Retry failed** uses only
   those videos' current edits; choose Done, edit, then **Review export results**
   to retry with changed text. Successful videos are not rendered again.
   Open the output folder or inspect the final MP4s in your video player.

Undo/Redo is available in the toolbar, macOS Edit menu and Cmd/Ctrl+Z /
Cmd+Shift+Z (Ctrl+Y or Ctrl+Shift+Z). Each drag/resize is one edit; typing is
grouped into bursts, with caret/selection and explicit commit boundaries.
Normal numeric/HEX field undo and character-editing keys remain native.
Each video has independent, session-local history; playback/seeking/export are not
edits. Across the workspace, Undo/Redo retains up to 100 steps or 16 MiB of
estimated snapshots, whichever comes first, including pending edits. Older
inactive-video history is evicted first. Current text is never discarded;
very large edits may exceed the available undo budget.

Immediately after Apply to all, Undo/Redo restores the copied text and previous
default/settings as one group, including after navigation, playback, seeking and
export-checkbox changes. It never undoes the source edit or those navigation/
check/playhead changes. A later content/default change, import, removal or relink
ends the group opportunity; copies retain ordinary per-video history. Group
checkpoints share the global history budget; the inspector reports when one
cannot be retained.

Text spans the full video duration. Off-frame text is cropped. Invalid numeric
height retains the previous geometry. Export locks editing and provides Cancel;
final files use collision-safe names such as `clip_edited_2.mp4`.

### Local save and recovery

- Edits, collection order, active video, export checks and paused playheads
  autosave after 200 ms of inactivity. The last export folder is also remembered.
  Navigation retains each video's independent text and playback position.
- Saving / Saved Locally / Save Failed are real persistence states. A failed
  save keeps in-memory text and offers persistent Retry Save feedback.
- Clean close flushes pending edits before closing. A failed flush offers Keep
  Open (the default) or explicitly closing without saving. Force Quit cannot
  guarantee preservation of the most recent uncommitted changes.
  Closing also waits for pending Remove/Clear and relink operations. Conflicting
  actions/autosave are suspended during Remove/Clear; status reads Updating workspace.
  A timed-out close does not leave editing permanently locked.
- Closing/quitting during an export offers **Continue Export** or **Cancel and
  Quit**. Confirmed cancellation waits for workers and cleanup, preserves completed
  outputs and saves edits before quitting. Normal non-export window close still
  follows macOS application lifetime.
- A separate atomic, fsynced `export-session.json` records frozen job text,
  statuses, output paths and exact temporary folders before rendering. Relaunch
  marks unfinished work **interrupted**, never automatically restarts it and
  never presents a partial as completed. Worker guardians clean owned partials
  after parent death; a crash before a worker starts may leave a tracked folder.
  Interrupted results identify that folder for inspection, not unsafe scanning
  or deletion of unrelated files. A damaged record is preserved and disclosed.
- Normal cancellation removes tracked partials before unlocking. Cleanup failures
  remain visible with the exact path. A validated, published output is still
  reported completed if only temporary cleanup fails, with an explicit warning.
- Version-2 `workspace.json` lives in Electron's local user-data directory.
  Source references, metadata and edits are saved, not video copies. Writes use
  an fsynced temporary file, atomic replacement and a previous-save backup.
  Interrupted `.pending` writes do not replace the valid primary.
  Version-1 workspaces migrate automatically with no saved text default.
  Version 2 also persists the detached default and its enabled state; older
  builds cannot read this newer format. Quit older builds before upgrading.
- Source identity includes stat identity and a full-file SHA-256 digest.
  Hashing streams bounded chunks alongside probing; relinking requires an exact
  content match. Missing/changed sources retain text and provide Locate recovery.
  Locate is also available on healthy rows for moved or newly inaccessible media.
  Edits and export selections made while Locate runs are preserved.
- A damaged/unsupported workspace is not silently overwritten: Retry Restore,
  Recover Previous Save or explicitly Archive and Reset. Undo history and
  playing state are deliberately not restored.
  Recovery keeps the primary and last good backup until replacement succeeds.
  A missing primary with an existing backup requires explicit recovery, not an
  empty autosave. Successful Retry Restore re-enables saving.
- Only one app instance can write each user-data workspace. Opening it again
  activates the existing window, or reopens it after a normal macOS window close.
  Closing during source restoration causes a fresh retry on reopening.
- Remove confirms discarding nonempty text. Clear Workspace always confirms.
  Clear Workspace also clears the saved default. Neither action deletes
  original media or completed exports.
  Clear remains available with no videos when a saved default still exists.
  Once removal is saved, a cached-poster cleanup failure is a visible warning,
  not a failed removal: visible and saved entries remain consistent, and the
  original video can be imported again.

## Run and validate

Requires Apple silicon, macOS 15+ and Node.js 24+. Install once with `npm ci`;
dependency installation requires internet access. Application runtime does not.

```sh
npm start
npm run typecheck
npm run lint
npm test
npm run build
npm run test:desktop
npm run make:review
```

- `build` creates `out/Video Text Editor-darwin-arm64/Video Text Editor.app`.
- `test:package` audits the actual app's version, minimum OS, arm64 binaries,
  internal symlinks, shipping fuses/ASAR, all 20 pinned resources, licences and
  system-only native dependencies.
- `test:desktop` runs packaged startup/resource, real-media/UI and shutdown
  integration tests sequentially. Build first. The media tests use the production
  bundles with the development Electron runtime for deep media/dialog/lifecycle
  checks. A separate hardened-package workflow relocates the app outside the
  checkout, removes developer PATH, goes offline, edits bundled emoji, plays,
  exports, probes the output and restores results. These tests use renderer CDP;
  the shipping Node-inspection fuse remains disabled.
  Set `VIDEO_EDITOR_PACKAGED_APP` to an absolute `.app` path to test an isolated
  package's audit and hardened workflows without replacing an application that
  is currently open. Media/dialog tests continue using the production bundles.
- `npm run test:preview-benchmark` separately generates a 30-minute 4K/60 Main10
  HLG source and checks editable-frame latency, 20 presented-frame seeks, buffer
  eviction, normal-speed playback, owned decoder count and active-encoder
  cancellation. Set `VIDEO_EDITOR_PACKAGED_APP` to run this benchmark against
  the actual hardened app rather than development Electron. Build first; allow
  several GB of temporary space. Fixtures/profiles are removed even on failure.
  This opt-in benchmark is skipped by the routine desktop command.
- `npm run build:guardian` rebuilds the bundled, project-owned macOS worker
  supervisor and updates its checksum pin. Use it after changing its C source.
- `make` creates a local ZIP in `out/make/zip/darwin/arm64/`.
- `make:review` creates the app and ZIP under `out/preview-<version>/`.
  It refuses to overwrite an existing review directory. Preserve that output
  for inspection if packaging fails; do not remove a build that may be running.
- The package is unsigned for distribution and is not release-certified.

UI tests run with hidden windows and no macOS activation/Dock focus by default.
They keep background rendering enabled so playback, screenshots and text checks
still execute; this does not change ordinary application launches. For an
intentional visible manual/debug run only, set `VIDEO_EDITOR_TEST_BACKGROUND=0`.

### Retained regression tests

These are permanent project tests, not disposable milestone scripts:

- `npm test`: resource failures, geometry, safe publication, cancellation,
  displayed-frame counting, HDR float/gradient/colour/alpha math, compatible
  Dolby bases, APAC rejection, all-frame HDR metadata validation, binary-stream
  backpressure/cancellation, repeated-worker process/abort-listener cleanup,
  cancellation escalation when a worker ignores SIGTERM, bounded fMP4/audio
  alignment and grouped snapshot history (auto-fit/style/deletion restoration,
  redo branching and reset), precise relative copies, mixed-ratio fitting and
  per-file errors, detached defaults, group-history transitions/retention limits
  and version-1 workspace migration.
- `npm run test:desktop`: actual text editing, emoji, rotated VFR/audio,
  edit-list regression, HLG and PQ Main10 exports, decoded gradient and glyph
  measurements, encoded Dolby removal, playback across windows, rapid seeking,
  preview muting, pause-on-edit, one-frame clips, failure safety and packaged startup.
  Single-video UX checks cover native Edit-menu/keyboard history, every handle's
  one-step undo, typing/selection boundaries, hover-delete traversal, character/
  field keys, centred creation, unsupported size/HEX rejection, HSV pointer/
  keyboard editing, off-frame recovery, window fitting and restored-style export.
  The Phase 7 workflow covers actual 1080 x 1920 to 2160 x 3840 copies/export,
  mixed-ratio playback, preservation/whitespace handling, group Undo/Redo,
  fractional-font precision, off/on import inheritance, source removal,
  relaunch and Clear Workspace. Hardened-package tests also persist a default
  and inherit it on a later import.
  Queue checks cover all scopes, empty/unavailable sources, duplicate names and
  late collisions, simulated full/unwritable folders, failure continuation and
  retry with changed text. Controlled overlay/validation/post-publication
  cancellation, cleanup warnings, final-journal persistence, Continue Export /
  Cancel and Quit, and crash/relaunch interruption are permanent regressions.
  Colour-sensitive screenshot fixtures use an explicit sRGB test display profile:
  Chromium can otherwise return untagged Display P3 PNGs. Export/geometry/colour
  tolerances are unchanged; shipped display colour management is not overridden.

### Balanced source-aware exports: 0.9.2

The user approved preserving HEVC and chose **balanced** size/quality after
real-footage comparisons. Eight-bit HEVC originals now export as HEVC Main
(`hvc1`), not H.264; H.264 SDR remains H.264. Preflight and output validation
use the actual native source codec. Workspace format and saved text are unchanged.

The uncapped quality-95 preset is replaced by source-aware average bitrate:
150% of the original **video-stream** bitrate, with a 150%-of-target rate limit
and a three-second target buffer. Audio/container bitrate never inflates this
calculation. Minimum targets are 256 Kbps for eight-bit and 4 Mbps for ten-bit
to retain new glyph detail on very simple sources. Missing/invalid bitrate
metadata triggers an explicit native log and measurement of the selected
video's packet bytes; unverifiable rates fail rather than using an uncapped preset.
These are encoder targets, not a byte-exact size guarantee; short, very
compressible or ten-bit clips can grow more because of text and quality floors.

Seven full-length HEVC samples (Samples A-G) were exported through
the hidden editor with representative text. Resolution remains 1080 x 1920;
all displayed frames and exact decoded frame timestamps are preserved, AAC
packet bytes match, durations pass validation and source SHA-256 values match.
New sizes are 1.48–1.49 times the originals. Non-text comparisons over the lower
75% of each full video measure PSNR 43.63–46.54 dB and SSIM 0.9806–0.9875.
The initial stricter 0.99 SSIM trial failed; after reviewing the trade-off the
user explicitly chose balanced exports rather than increasing size further.
The balanced real-footage checks require PSNR >=42 dB and SSIM >=0.98.
No existing SDR/HDR fidelity, geometry or timing threshold was relaxed.

| Sample | Original | Previous export | Balanced export |
| ------ | -------: | --------------: | --------------: |
| A      |  62.9 MB |         66.8 MB |         93.7 MB |
| B      |  56.5 MB |        745.1 MB |         84.2 MB |
| C      |  21.2 MB |        277.2 MB |         31.4 MB |
| D      |  55.3 MB |        682.8 MB |         82.5 MB |
| E      |  67.4 MB |        854.2 MB |        100.6 MB |
| F      |  77.0 MB |        969.1 MB |        114.9 MB |
| G      |  79.0 MB |        997.1 MB |        117.8 MB |

Sample A's previous export was already small; the balanced preset does not promise
to beat every prior file. Actual test exports and per-file measurements are under
`out/export-bitrate-review-0.9.2-final/`, separate from originals/existing exports.
They contain test text, not an attempt to reproduce the user's prior text.
Quality remains lossy, not pixel-identical.

Final verification passes type-check/lint/build, 61 unit/native-worker and
40 hidden desktop/package cases. Routine runs skip the two opt-in real-data/
30-minute preview cases. The new synthetic HEVC Main regression verifies the
actual codec/profile/tag, alongside existing H.264 and Main10 checks. SDR
high-detail PSNR is 52.108 dB; HDR gradient levels are 772 HLG / 932 PQ
(required: more than 700), with glyph-white errors 1.023 / 0.944 codes
(required: less than 3). All pre-existing thresholds pass; these measured
values are not a claim of lossless encoding.

The exact isolated 0.9.2 hardened app passes all four package workflows and
repeats the complete real Sample B export offline, with identical measured size,
timing, audio and non-text quality to the seven-clip run. Its balanced real-data
test passes. ZIP integrity passes and no owned test/media processes remain.
ZIP SHA-256: `7ce6112764b2ed67d9f0791da343564927ded1c1c3f05e28c2154f674bbd3b96`.
The 30-minute benchmark was not rerun: the preview implementation is unchanged.
Local-only unsigned scope and physical HDR/minimum/reference-Mac limits remain.

To repeat the opt-in real-footage check, set `VIDEO_EDITOR_REAL_VIDEO_INPUTS`
to a JSON array of absolute source paths and `VIDEO_EDITOR_REAL_EXPORTS` to a
new output directory, then run:
`node --test --test-name-pattern='real-footage source-aware' tests/editor.test.mts`.
Build first. The output directory must not exist; successful per-file
measurements are retained in its `verification.json`. This lengthy, local-data
test is skipped in ordinary runs. Set `VIDEO_EDITOR_PACKAGED_APP` to an absolute
app path to perform this workflow with the actual hardened package; its remembered
test-only output folder avoids any native folder picker.

### Historical Phase 9 audit fix: 0.9.1

The GPU preview path incorrectly treated zero-degree rotation as proof that no
display transform existed. A valid display matrix can also vertically mirror a
picture without rotating it. This made playback disagree with the poster and
correctly oriented export, potentially misleading text placement.

Hardware downscaling now requires no display-matrix metadata. Transformed HDR
uses the existing orientation-aware path; ordinary HDR keeps its fast GPU path.
No export settings, text geometry or source files are changed. A retained visual
regression failed before the fix (HLG poster top/bottom 253/30 versus playback
30/253) and now verifies matching playback and actual edited exports for both
limited-range HLG and full-range PQ.
The original 0.9.0 package is preserved separately.

Verification: type-check/lint, 59 unit/native-worker and 40 hidden desktop/package
cases pass. SDR PSNR remains 52.539 dB, AAC packets unchanged, VFR within 2 us
and HLG/PQ gradient counts 877/1024. The exact hardened 0.9.1 app passes its four
package workflows and the separate 30-minute UHD 4K60 HLG benchmark:
import-to-editable 1.375 s, seek p95 979.9 ms, one decoder, about 143.1 MiB peak
decoder RSS and 12 s buffered. Active-export cancellation acknowledges in
21.7 ms and stops in 2.522 s with no workers/partials remaining. Seek margin
remains small; reference-hardware and physical HDR certification remain open.
ZIP integrity and extracted-app offline editing/export/restoration also pass.
ZIP SHA-256: `5f65176c1ea2085959bee6f29ecce815e3a13b95b7ec8a787c94b2c01097e942`.

### Historical Milestone 9 local review: 0.9.0

- Self-contained local review packaging and actual-artifact audits retain the
  shipping sandbox/fuses, bundled fonts/emoji, native workers and required
  licence/source/build notices. No signing credentials or OS-protection changes
  are needed for this user's local-only scope; wider distribution remains unsigned.
- HDR placement preview now uses a 360-pixel long edge, at most 15 fps and
  50 ms fragments. Untransformed HEVC 10-bit 4:2:0 HDR downscales on VideoToolbox
  before CPU readback/tone mapping; rotated and other formats retain the
  established orientation-aware path. SDR remains at most 720 pixels.
  Full-resolution text layout and the export compositor/quality are unchanged.
- Retained acceptance checks measure painted text updates, durable autosave,
  cancellation acknowledgement/worker stop and an actual 30-video batch.
  Rotated HDR playback and relocated, offline packaged export remain regressions.

Measured on the available M4 Max / 48 GiB / macOS 26.7.2:

| Acceptance check                                   | Measured result                                                                                |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Painted text feedback p95 / durable autosave       | 17.6 ms / 233 ms, against 100 ms / 1 s                                                         |
| 30 checked mixed clips                             | 30 completed batch outputs; prior output and originals preserved                               |
| Hardened 30-minute UHD 4K60 HLG import-to-editable | 1.374 s, conservatively including metadata, against 2 s                                        |
| 20 presented-frame seeks, p95                      | 972.0 ms against 1 s; worst 1023.7 ms                                                          |
| Preview bounds                                     | One decoder, 143.5 MiB peak decoder RSS, about 12 s buffered                                   |
| Cancel during the long native export               | Painted acknowledgement 17.6 ms; workers stopped in 2.460 s, against 250 ms / 5 s; no partials |

The long source has 108,000 frames and is about 1.52 GB, generated from a looped
synthetic pattern. Seek headroom is small: a development-runtime run measured
1021.5 ms before the hardened-package measurement above. These results do not
certify reference hardware, diverse camera footage or physical HDR appearance.
Minimum macOS 15 / M1 Pro 16 GiB execution and wider-distribution signing/
notarization remain open. Stop before Phase 10.

Final verification passes type-check/lint, 59 unit/native-worker cases and
39 hidden desktop/package cases; the optional long benchmark passes separately.
The exact isolated app passes all four hardened/package checks and repeats the
long benchmark above (the earlier hardened run measured 987.3 ms seek p95).
ZIP integrity passes; extracting the delivered ZIP also passes the bundle audit
and relocated offline edit/play/export/restore workflow.
ZIP SHA-256: `62fbc2f1f95d4921add1abf715d3d2f0b29601b663b9d93716d272009a6b6887`.

### Historical regression fixes in 0.8.1

- Failed output-folder preference saves restore the exact reviewed destination
  and filename plan, rather than silently changing the native export destination.
- Preflight tests hard-link publication as well as writing/free space. Writable
  folders without hard links are rejected before rendering, without weakening
  atomic, no-overwrite publication.
- Closing/reopening restores an unfinished preflight. Late folder-picker replies
  from a closed window or superseded preflight cannot change the current plan.
- Results/preflight dialogs block global keyboard and native-menu history, not
  just pointer edits. Ordinary Undo/Redo resumes after Done/Cancel.
- Cancellation and the 20-second overlay deadline cover screenshot/conversion
  as well as renderer readiness. A stalled conversion releases its hidden
  window and queue; cancellation before creation opens no overlay window.
- Cleanup/interruption warnings retain exact tracked paths after Done and later
  edits. They appear in the dialog while open, and persist in the editor afterward.

Verification: type-check/lint/build, 59 unit/native-worker tests and 37 hidden
desktop tests pass, including hardened-package startup/restoration and repeated/
Force Quit. The opt-in 30-minute benchmark is skipped. SDR PSNR remains
52.539 dB, AAC packets unchanged and irregular timestamps within 2 us;
HLG/PQ gradient counts remain 877/1024. The unsigned, isolated 0.8.1 package
passes bundle-version and ZIP-integrity checks. Phase 9 was unstarted at that checkpoint.

### Historical Milestone 8 verification (0.8.0)

Type-check, lint and isolated packaging pass. Across the retained suites,
58 unit/native-worker and 32 hidden desktop tests pass; the optional 30-minute
4K60 benchmark is not rerun. The final hardened app passes offline startup,
collection/default/relink restoration and lifecycle checks; ZIP integrity and
version are verified. SDR/HDR quality checks retain 52.539 dB SDR PSNR, unchanged
AAC packets, irregular timestamps within 2 us and 877/1024 HLG/PQ gradient levels.
Physical HDR review, reference-hardware certification and Phase 9 remain open.

### Regression fixes in 0.7.1

- Failed cached-media cleanup no longer leaves a visible clip missing from the
  saved workspace while claiming Saved Locally. Committed removals/clears update
  the UI and report cleanup warnings explicitly. Failed saves retain the previous
  native document and expose retryable Save Failed feedback.
- Closing waits for pending Remove/Clear and their renderer updates before
  flushing; deleted videos/defaults cannot be restored by a stale close snapshot.
  The token-validated close acknowledgement also unlocks a timed-out/failed close.
- Separate sidebar action rows prevent Locate from intercepting Remove clicks,
  including at the minimum window size.
- Clear Workspace can reset a retained text default after the last video is removed.
- Copy/default inheritance review warnings cover differences in pixel shape as
  well as display aspect ratio. Anamorphic clips can wrap differently even when
  both videos display as 16:9. The approved transfer formulas remain unchanged.

Permanent regressions exercise slow/failing cleanup, close/relaunch, the actual
15-second close timeout, reimport after cleanup warnings, pointer-accessible
removal, empty-collection reset and anamorphic copy/inheritance warnings.
Verification: type-check/lint/build, 51 unit/native-worker tests and 26 hidden
desktop tests pass, including the exact isolated hardened 0.7.1 app. SDR PSNR
remains 52.539 dB, AAC packets unchanged and irregular timestamps within 2 us;
HLG/PQ export regressions also pass. ZIP integrity and bundle version are verified.
The 30-minute 4K60 benchmark is not rerun for this patch.

### Historical Milestone 7 review build: 0.7.0

Apply to All, reusable defaults and immediate group Undo/Redo are implemented.
Inherited fractional font sizes retain canonical precision when focused or
stepped; manual font-size entry still accepts one decimal place.
Per-file fitting failures are reported without discarding the video or its text.
All earlier recovery, export-quality and process-lifecycle protections remain.

Verification: type-check/lint/build, 47 unit/native-worker tests and 20 hidden
desktop tests pass, including the exact isolated 0.7.0 hardened app. The ZIP
passes archive-integrity checks. The 30-clip responsiveness run recorded a
25.8 ms worst timer interval against its 250 ms limit.

The opt-in 30-minute 4K60 benchmark is not part of this milestone's routine
validation. Physical HDR visual review, minimum-Mac certification and batch export
remain pending; this is still an unsigned local review build.

Run typecheck, unit tests and lint after changes. Rebuild and run the desktop
suite when changing rendering, UI, native resources or export behavior. Fixtures
are generated locally; private user videos are not committed or required.

### Regression fixes in 0.6.1

- Failed recovery cannot archive away the primary or overwrite the valid backup.
  Recovery can also repair the missing-primary state left by an interrupted
  older recovery. A corrected workspace no longer remains write-blocked.
- Relinking replaces source metadata only; concurrent text, geometry, check,
  playhead and Undo/Redo state remain consistent with the saved document.
- A second launch cannot become a competing workspace writer. Normal macOS
  close/reopen behavior is retained, including retrying an interrupted restore.
- Permanent workspace unit and hidden desktop regressions cover these paths,
  including edits during a real full-file relink hash and a second process launch.

Verification: type-check/lint/build, 39 unit/native-worker tests and 19 hidden
desktop tests pass. The opt-in 4K60 benchmark was not rerun for this patch.
Quit older review builds before launching 0.6.1: pre-fix versions do not
participate in the single-instance lock.

### Regression fixes in 0.5.1

- Preview clipping is non-scrollable: typing near video edges cannot shift text
  away from its source/export coordinates.
- SDR exports preserve supported 8/10-bit 4:2:0 precision and colour signalling;
  unsupported SDR precision/chroma formats fail explicitly rather than being
  silently reduced. All exports retain the filter timebase for irregular VFR.
- VideoToolbox export quality is 95. This is high-quality **lossy** MP4, not a
  lossless guarantee. The retained noisy-detail fixture measures at least 42 dB
  RGB PSNR with off-frame text; actual local results exceeded 52 dB.
- AAC packets are copied unchanged; other supported audio is encoded as AAC
  without silently dropping streams or channels.
- A bundled native guardian supervises each media job using a parent-lifeline
  pipe. Parent death stops the encoder, escalates to SIGKILL within two seconds
  when necessary, and removes that job's known temporary media. It does not
  depend on Electron's JavaScript running after Force Quit.
- Repeated Quit cannot bypass pending cleanup. Normal macOS window-close
  behavior is unchanged: the application stays open, but media work stops.
- Undo/Redo has the approved memory/step limits. Only the current export's
  reveal ID/path is retained, and successful source replacement clears it.

Verification: type-check/lint, 31 unit/native-worker tests and 14 hidden desktop
tests pass, including the exact isolated 0.5.1 review app. The separate 30-minute
4K60 HDR benchmark also passes: editable in 888 ms, seek p95 931 ms, at most
12 seconds buffered and one decoder (419 MiB peak decoder RSS).

### Memory audit scope

The pre-fix hidden-window audit exercised 128 repeated import/edit/play/seek/export
cycles. After garbage collection, JavaScript heaps approached a plateau (renderer
about 6.9 MiB; main about 6.3 MiB), with constant DOM/listener counts, no live
preview object URLs after export, no leftover overlay windows and no idle native
workers. Renderer RSS nevertheless grew from about 228 to 297 MiB. A separate
native allocation trace identified compositor image-cache growth; this is not
proof that long-session native memory is bounded or that all leaks are absent.

Closing the last window on macOS intentionally keeps the application open, but
stops preview/export work. Normal Quit (Cmd+Q) and SIGTERM stopped all observed
owned processes and removed temporary session/export files. A single Quit also
reaped a deliberately stalled encoder through the worker's kill deadline.

The originally reproduced Force Quit and repeated-Quit orphan bugs are fixed
and covered by retained hidden HDR-export tests. Worker tests also verify
parent-death cleanup, termination escalation and abort-listener removal.
The audit terminated its own surviving pre-fix workers and removed its fixtures.
Native image-cache observations are not a claim that every possible memory leak
has been excluded. Physical HDR visual review remains open.

The post-fix 32-cycle rerun retained 675 DOM nodes / 243 listeners and 18 window
listeners, with no idle media workers, live preview URLs or partial exports.
Renderer RSS still grew approximately 226 to 244 MiB, consistent with the earlier
native-cache observation rather than proof of a fixed native leak. Active-export
window close, Quit, SIGTERM and Force Quit all cleaned up; Force Quit left no
owned descendants or temporary media after 1.54 seconds.

## Module boundaries

| Area           | Owns                                                                                               | Must not do                                           |
| -------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `src/main`     | Native lifecycle, registered sources, probing, owned workers, capture and output publication       | Delegate native authority to UI code                  |
| `src/preload`  | Ten narrow desktop methods, including a validated history subscription; separate overlay handshake | Expose Electron, arbitrary channels or shell commands |
| `src/shared`   | Process-neutral schemas, source-pixel text model, pure resize rules and snapshot history           | Import Node, Electron, main or preload code           |
| `src/renderer` | React UI, one authoritative editing hook, DOM measurement and shared text layout                   | Import native APIs or bypass the desktop bridge       |

Oxlint enforces the renderer/shared native-import boundary. Components are split
by their visible responsibilities, not a speculative service/framework hierarchy.
The editor hook owns the canonical text box and measured minimum height together;
components receive values and callbacks. Pure geometry rules do not depend on
React or FFmpeg. The media service owns native job state, source identity and
temporary files; the worker, probe, publisher and text capture remain separate
modules. The pure colour-plan module owns SDR/HDR filters and encoder options;
neither the UI nor the job coordinator contains transfer-function math. There
is no speculative generic store or framework. Media workers use the small bundled
C guardian rather than a shell wrapper or an Electron RunAsNode exception.

The pure text-history reducer stores complete canonical box/minimum-height
snapshots. Live typing/gesture/inspector groups commit without intermediate undo
steps; no-op gestures preserve redo. `useEditor` owns the current source's history
and selection state. The native Edit menu receives only validated availability/
field-focus state and emits allowlisted Undo/Redo commands; native field undo
stays separate from video-object history. No filesystem authority was added.

Preview is a separate native session owner and renderer `PreviewPlayer` adapter;
`usePreview` connects its state/DOM lifecycle to React. Native workers stream
eight-second fMP4 windows over opaque, one-use `app-media:` URLs into MediaSource.
Backpressure, stale-session cancellation and playhead-local eviction bound the
work instead of generating/loading a whole-video proxy. SDR uses at most a
720-pixel long edge; HDR adapts to 360 pixels with guarded hardware downscaling
and 50 ms fragments to reduce seek startup/readback cost.
Both are at most 15 fps. Text stays in original source coordinates and is never
reflowed or baked into this low-quality stream.

A plain Chromium textarea and custom selection frame replace the proposed Fabric
adapter. The same `TextLayer` renders the preview and a hidden sandboxed export
page at oriented source resolution with device scale factor one. Captured PNGs
are explicitly colour-converted to sRGB before FFmpeg: native screenshots can
contain Display P3 pixels, whose ICC profile FFmpeg does not apply. This keeps
monitor colour management out of exported text. No second text-layout engine or
FFmpeg `drawtext` is used. See the [design](./DESIGN.md).

Production uses a sandboxed renderer, context isolation, no Node integration,
no permission grants, no external navigation/popups and a restrictive local
content policy. Only allowlisted bundled font IDs are served by `app-font:`;
`app-media:` serves only the registered poster and current opaque preview session.
Production fetch is restricted to that local scheme; media playback uses local
MediaSource blob URLs. Source paths are obtained
from an actual selected File in preload, not an arbitrary renderer path string.
Development alone permits local Vite/HMR connections and inline HMR styles/scripts.
Packaging retains the scaffold's restrictive Electron fuses.

Forge's Vite integration is still labelled experimental by its maintainers.
Forge 8.0.1 and the dependency lockfile are pinned; upgrade this tooling
deliberately and repeat both development and packaged-app checks.
Packaging uses SHA-256 checksums shipped with the pinned Electron dependency,
so a cached archive can be verified without another GitHub checksum download.

## Offline resources

[Resource manifest](../resources/manifest.json) records per-file source URLs,
licenses and SHA-256 pins. Startup checks every required file; runs native tools
with argument arrays and a timeout; checks the native arm64 header, pinned version
and build flags; and decodes all five bundled font faces in Chromium.
Errors stay visible with details and a **Check again** action.

- Noto Sans and Noto Serif: variable normal/italic faces including bold weights.
- Noto Color Emoji: bundled COLRv1 font. Representative emoji editing/rendering
  is tested; arbitrary scripts, font coverage and all emoji sequences are not
  certified. Unverified character repertoires display a warning.
- FFmpeg/ffprobe 9.0.2: locally built, LGPL-only, network disabled, system-only
  dynamic dependencies. The Milestone 2 build explicitly enables system zlib for
  the PNG encoder used by real imports. Corresponding source, full license and
  build instructions ship with the tools. Milestone 3 reuses those same pinned
  binaries: explicit float processing and the reference scaler backend require
  no new native dependency. The native version suffix remains `-m2`.

See [third-party notices](../resources/THIRD_PARTY_NOTICES.txt) and
[native build details](../resources/media-tools/darwin-arm64/BUILD-INFO.txt).
`npm run build:media` rebuilds from the included pinned source with Xcode Command
Line Tools. Review/update executable hashes after an intentional toolchain change;
the application must not silently accept changed binaries.

The common prebuilt `ffmpeg-static` arm64 candidate was rejected because its
actual build enabled nonfree components. Those binaries are not packaged.

## Milestone 5 verification

- Creation, direct typing/selection, deselection/reselection, deletion through
  hover/panel/keyboard, and keyboard centring/positioning alternatives pass.
- Toolbar, native macOS Edit menu and keyboard history agree. Typing bursts,
  explicit character selection, all eight resize handles and colour drags undo
  coherently, including auto-fit and full-style restoration.
- Decimal font sizes/one-pixel steppers, finite/minimum validation, renderer-size
  limits, invalid/alpha HEX rejection and HSV edge cases at black/white pass.
- The populated 1100 x 700 window has no horizontal page/inspector overflow;
  properties scroll independently, keyboard focus is visible, and changing fit
  scale leaves source geometry unchanged.
- A styled, centred box restored with Redo exports with glyph bounds within one
  source pixel of its canonical overlay. Existing SDR/HDR precision, timing,
  audio, frame-count, cancellation and source-safety checks remain green.
- **25 unit/native-worker tests and 10 routine desktop tests pass**, plus the
  separate 30-minute benchmark. All native test windows remain hidden/unfocused.

## Playback regression verification

- Fragmented H.264/AAC actually plays through Chromium MediaSource, including
  crossing windows, seeking while paused, rapid superseding seeks and tiny clips.
- Rotated portrait, HLG and full-range PQ previews work. Existing SDR/HDR export
  precision, timing, audio and original-file protections remain covered.
- The retained 30-minute benchmark uses a two-second looped synthetic pattern:
  3840 x 2160, 60 fps, Main10 HLG, 108,000 frames, approximately 1.52 GB. It is
  not a substitute for testing diverse real camera footage.
- On the available M4 Max / 48 GiB Mac, full import through editable text was
  about 0.36 seconds; p95 requested-frame presentation over 20 seeks was about
  0.91 seconds in the v0.5.0 rerun. Limits remain 2 seconds and 1 second respectively.
- Continuous playback retained normal timeline speed, at most one owned native
  decoder, approximately 12 seconds of buffered media, and about 416 MiB peak
  native decoder RSS. No full proxy or whole-video RAM load was required.
- The first 720-pixel HDR attempt missed the seek target. Smaller HDR frames,
  measured decoder-thread limits and explicit low-delay encoding improved it;
  no export-quality reduction or performance-threshold relaxation was used.

Run `npm test` (25 cases), `npm run test:desktop` (10 routine checks), and the
opt-in benchmark when changing the preview engine. The PRD's M1 Pro reference
machine and minimum macOS version have not been independently measured.

## Historical Milestone 3 verification

- Float32 transfer/alpha/colour regressions retain HDR peaks and dense gradients.
  Text uses canonical sRGB converted to BT.2020 at nominal 203 cd/m² graphics white.
- Actual HLG and full-range PQ exports retain 872 and 1,020 decoded gradient levels.
  Mean non-text luma errors are 0.007813 and 0.003906 10-bit code values; opaque
  text-white errors are 0.14647 and 0.08373, below a one-code tolerance.
- Both 50-frame VFR fixtures preserve timestamps within 1 ms and AAC impulse timing
  within 20 ms. HDR is encoded as HEVC Main10/hvc1 with fresh colour signalling.
- A real rotated 31.9-second HLG clip exported all 957 displayed frames with zero
  frame-timestamp drift. Non-text mean luma error was 0.434182 code values.
  Apple's independent AVFoundation decoder supplied all 957 portrait frames in
  10-bit buffers. This is not a physical HDR visual review.
- The source's extra APAC track was explicitly rejected. With permission, the
  real proof used a temporary stereo-only copy whose encoded HDR video and main
  AAC packets were unchanged. The original checksum remained unchanged.
  Temporary media and its private profile are deleted after verification.
- Real output exposed Dolby RPU despite clean stream metadata. An encoded-packet
  stripping filter fixes that; every output HDR frame is independently scanned
  before publication. Dolby Vision output itself is not claimed.

At that checkpoint, the suite contained 20 unit/native-worker tests and seven
desktop cases. See the [implementation record](./IMPLEMENTATION_PLAN.md#8-current-checkpoint)
for evidence and remaining gates.

## Historical Milestone 2 verification

Verified locally on the available Apple-silicon Mac:

- Fourteen unit/native-worker tests and six desktop/integration cases cover
  resource failures, pure geometry, concurrent no-overwrite publication, worker
  cancellation, actual editing, imports and exported media.
- All eight handles preserve font size; top/left minimum-fit drags retain the
  opposite anchor. Multiline text, long words, wrapping and invalid numeric
  height are exercised through the real application.
- Native caret movement covers ordinary emoji, skin tones, flags, family ZWJ
  and combining accents. Bundled colour emoji survives the transparent overlay
  and decoded export.
- Preview, transparent overlay and decoded output bounds agree within one
  source pixel. Oriented picture corners match. The coloured-serif proof has
  mean absolute glyph-interior RGB error 3/255, below its 5/255 limit.
- A genuinely rotated VFR fixture retains all 24 frame timestamps within 1 ms.
  Both stereo and mono audio streams survive; decoded impulse timing stays
  within 20 ms. Negative-coordinate clipping and centring are checked.
- Corrupt inputs, synthetic 10-bit HLG rejection, cancellation and changed
  originals produce explicit outcomes without losing the current edits.
- Version 0.2.1 fixes false frame-count errors for trimmed MP4 edit lists.
  Container totals can include hidden samples. When reported totals disagree or
  are unavailable, validation decodes both videos and compares displayed frame
  counts; genuine loss or unverifiable counts still prevents publication.
  This extra scan happens during export validation, not import. A synthetic
  30-sample/25-displayed-frame clip covers the complete export path. A locally
  supplied SDR HEVC clip also completed the native application export with all
  402 displayed frames preserved and its original checksum unchanged.
- Apple's AVFoundation independently played the actual two-second demo to its
  end and supplied all 50 decoded 320 x 180 video frames.
- Packaged offline startup/reload, 19 resources, five font faces, no renderer Node
  globals, minimum layout, focus, quit/relaunch and cloned-bundle font recovery
  remain covered.

Tests temporarily enable loopback debugging and generate small synthetic local
media. They do not weaken packaged Node-inspection fuses or enable a production
debug endpoint by default. Node's built-in runner avoids another test framework.

Historical desktop captures and edited MP4 evidence were generated locally
under `out/`; generated artifacts and media are intentionally not committed.

### Review packages

The v0.9.2 macOS review package is isolated from older builds. To open it:

```sh
open "out/preview-0.9.2/Video Text Editor-darwin-arm64/Video Text Editor.app"
```

Copy any unsaved text/settings before quitting an old app, then open the new app
from that folder or its ZIP. The earlier v0.2.1 review hotfix remains separately
under `out/hotfix-0.2.1/`, v0.3.0 under `out/hdr-0.3.0/` and v0.4.0 under
`out/preview-0.4.0/`.
Fresh `npm run build`/`make` commands use the default
output paths documented above.

## Current limits and next checkpoint

The editor supports independent multi-video workspaces, Apply to All/defaults,
one whole-box style per video and sequential current/checked/all exports.
Only one video's preview plays at a time.

Supported HDR has 10-bit pixels, BT.2020 non-constant-luminance colour, explicit
full/limited range and HLG/PQ transfer. Compatible Dolby Vision profile 8 bases
export as standard HDR, not Dolby Vision. Other Dolby variants, ambiguous colour,
12-bit HDR and Apple APAC spatial audio are explicitly rejected. Audio is never
silently discarded or downmixed during export. Preview uses the first audio
track converted to stereo AAC. Use an AAC-compatible source/copy for APAC
footage; automatic audio conversion or track dropping is not implemented.

Automated checks do not certify all real-device footage, every colour space,
all audio layouts/scripts, non-square pixels, every long 4K workload or physical HDR
appearance. Windows, minimum-macOS execution and signed/notarized distribution
remain unverified.

Follow the [approved plan](./IMPLEMENTATION_PLAN.md). Stop after Milestone 9 for
local review; Milestone 10 is not authorized. The outstanding physical HDR visual review
and reference-hardware/minimum-OS checks are not waived by this progression.
