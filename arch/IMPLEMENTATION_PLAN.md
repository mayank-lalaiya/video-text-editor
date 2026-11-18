# Video Text Editor: Implementation Plan

- Version: 0.9
- Date: 2026-11-17
- Status: APPROVED on 2026-11-17; Milestone 9 authorized for local-only Mac review
- Design direction: approved for planning
- Application implementation: Milestones 1 through 9 implemented locally; Milestone 10 Windows preview authorized on 2026-11-18; client-OS/hardware and physical HDR certification pending
- First release: macOS 15+ on Apple silicon
- Windows preview target: Windows 10 and 11 on Intel x64, using the shared codebase

References: [requirements](./PRD.md), [design](./DESIGN.md),
[visual mockup](./editor-macos.svg).

## 1. How we will work

Work on one milestone at a time. At each checkpoint:

1. Demonstrate the milestone's real behavior, not just a screenshot or mock result.
2. Run focused tests and relevant type/build checks.
3. Report what passed, what remains incomplete, and any deviation from the design.
4. Ask before starting the next milestone.

Do not silently expand scope or proceed through the whole plan at once.
An intermediate prototype is not a completed release.

The order deliberately proves text accuracy, real video output, and HDR before
building the complete interface around unverified media assumptions.

## 2. Approval and execution gates

| Item                                              | Current state                                                                                                   |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| macOS-first shared-codebase approach              | Approved                                                                                                        |
| Visual and technical design direction             | Approved for planning                                                                                           |
| Full PRD, including detailed defaults and targets | Approved on 2026-11-17                                                                                          |
| This implementation plan                          | Approved on 2026-11-17                                                                                          |
| Start application coding                          | Milestone 1 authorized on 2026-11-17                                                                            |
| Milestone 1 checkpoint                            | Verified locally; user authorized progression                                                                   |
| Milestone 2                                       | Authorized on 2026-11-17; local SDR/text proof complete for review                                              |
| Milestone 3                                       | Explicitly authorized: "let's go with hdr export"; automated HDR proof verified, physical visual review pending |
| Milestone 4                                       | Explicitly authorized: "lets go ahead with phase 4"; local playback/seek proof verified                         |
| Milestone 5                                       | Explicitly authorized: "le't go aehad with phase 5"; complete single-video editing proof verified               |
| Milestone 6                                       | Explicitly authorized: "le'ts go ahead with phase 6"; persistent multi-video workspace implemented              |
| Milestone 7                                       | Explicitly authorized: "let's go ahead with phase 7"; Apply to All and reusable defaults implemented            |
| Milestone 8                                       | Explicitly authorized: "let's go aieadh with phase 8"; native sequential export queue implemented              |
| Milestone 9                                       | Explicitly authorized: "let' go ahead with phase 9"; user chose "Local-only review build for my Mac"           |

The user has finalized the PRD and explicitly requested Milestone 9. Later
milestones still need their own proceed decisions. Approval is not evidence of
unmeasured performance or a claim that the proposed HDR pipeline already works.

## 3. Milestone overview

| Step | User-visible outcome                                                     | Main dependency      |
| ---- | ------------------------------------------------------------------------ | -------------------- |
| 1    | The desktop app opens with the agreed layout and bundled-resource checks | Approval gates       |
| 2    | One SDR video exports with directly edited text in the correct place     | 1                    |
| 3    | A real HDR sample exports correctly without being downgraded             | 2                    |
| 4    | Fast low-quality playback and seeking work inside the editor             | 3                    |
| 5    | The complete single-video text editor works                              | 4                    |
| 6    | Multiple videos, independent selection, and workspace recovery work      | 5                    |
| 7    | Apply to All and later-import defaults work safely                       | 6                    |
| 8    | Current/checked/all export, progress, cancellation, and retry work       | 7                    |
| 9    | A validated offline macOS application package is ready                   | 8                    |
| 10   | The Windows version is adapted, packaged, and independently tested       | macOS release review |

Steps are sequential for delivery and review. Some underlying tests are reusable,
but that is not permission to start several milestones without approval.

## 4. Detailed milestones

### Milestone 1: Desktop foundation

**Goal:** a real Mac application window, not a browser-only prototype.

Work:

- Bootstrap Electron, React, and TypeScript using maintained ecosystem tooling.
  Preserve the existing requirements/design/plan files; do not replace the workspace.
- Establish the main process, narrow preload API, renderer, and shared domain types.
- Create the dark three-column layout, native title bar, empty workspace, toolbar,
  and disabled states for features not implemented yet.
- Bundle the selected font/emoji resources and candidate macOS-arm64 media tools.
  Record their source, build capabilities, and applicable licences.
- Configure renderer isolation/sandboxing and prevent arbitrary shell/filesystem
  access through the UI.
- Establish scripts for type checking, focused tests, builds, and packaging.

Verification:

- Launch the application on macOS and close/reopen it cleanly.
- Verify minimum-window layout, keyboard focus, and required resource resolution.
- Verify missing/corrupt bundled resources produce an explicit error.
- Type-check and build successfully; confirm the UI does not need network access.

**Checkpoint:** demonstrate the empty application and explain its current limits.

### Milestone 2: One-video text-to-SDR-export proof

**Goal:** prove the central feature end to end before building every control.

Work:

- Select one real local SDR MP4/MOV and read its stream, orientation, and timing data.
- Display an oriented poster frame without waiting for a full proxy.
- Implement the candidate editable text adapter and eight custom box-only handles.
  Preserve extra box height and the text-fit minimum without scaling the font.
- Load bundled fonts/emoji before measuring; support representative multiline text,
  long words, colour, bold/italic, alignment, and grapheme-safe editing.
- Render the same source-space text to a full-resolution transparent overlay.
- Export a short SDR sample through the candidate media engine.
- Preserve the original and publish output only after successful finalization.

Verification:

- Test creation, typing, moving, every handle, reflow, and off-frame clipping.
- Verify handles do not alter font size; verify auto-fit never shrinks the font.
- Compare preview layout with the full-resolution overlay and decoded output.
- Cover ordinary emoji, skin-tone modifiers, flags, and a supported ZWJ sequence.
- Check oriented dimensions, duration, audio synchronization, and a VFR/rotated sample.
- Play the actual output externally; at this stage editor playback is not yet complete.

**Gate G1/G3:** the candidate text adapter and basic SDR pipeline must work.
If either needs fragile workarounds, revise the design before proceeding.

### Milestone 3: HDR export proof

**Goal:** resolve the highest-risk output requirement early.

Work:

- Test representative 10-bit HLG/PQ sources and compatible iPhone HDR footage.
- Establish the high-precision colour-compositing path for the shared RGBA overlay.
- Map text colour/reference white appropriately into HDR and handle alpha correctly.
- Encode standard 10-bit HEVC/AAC MP4 with appropriate colour metadata.
- Do not retain stale Dolby Vision dynamic metadata after changing the picture.
- Establish the actual encoder/filter capabilities of the proposed bundled build.

Verification:

- Inspect filter-format negotiation and reference frames for unintended 8-bit loss.
- Check decoded high-precision gradients and non-text regions against a trusted
  reference, not just the output pixel-format tag.
- Check text brightness, alpha edges, colour signalling, source timing, and audio.
- Perform HDR playback/visual review on suitable equipment; record any verification
  that available hardware cannot support rather than marking it passed.

**Gate G4:** no silent SDR fallback and no claim that a 10-bit output tag proves
correct HDR processing. If the engine cannot pass, stop for a design decision about
the media backend. Do not remove HDR from scope without approval.

### Milestone 4: Fast preview and playback

**Goal:** let users play and check placement without high-quality preview costs.

Work:

- Implement the proposed on-demand SDR preview stream and bounded buffering.
- Validate the fragmented-MP4/MediaSource delivery path rather than assuming it works.
- Add Play/Pause, seek, elapsed/total time, and preview-only Mute.
- Start from a small poster frame; enable text placement before full-video processing.
- Cancel stale seek requests and obsolete preview workers when switching/seeking.
- Tone-map HDR for preview and show the SDR-preview/HDR-export explanation.
- Keep original timeline mapping and preview audio/video synchronization.

Verification:

- Test H.264, HEVC, HDR, portrait, and rotated sources.
- Measure first editable frame and seeking against PRD targets.
- Use a 30-minute 4K/60 fps source to prove playback/seek does not require waiting
  for an entire proxy or loading the whole video into RAM.
- Verify preview frame dropping, scaling, and Mute do not affect export.
- Verify only one active video's preview decoder remains active.

**Gate G2:** if this preview path misses the requirements, compare alternatives
and revise the design before committing to a permanent playback implementation.

### Milestone 5: Complete single-video editor

**Goal:** promote the proven text adapter into the approved editing experience.

Work:

- Complete the right inspector: fonts, size, Bold/Italic, colour/HEX, alignment,
  X/Y/Width/Height, Centre in Video, and Delete Text.
- Implement exact creation/selection/double-click behavior and pause-on-edit.
- Finish hover deletion, persistent deletion, numeric validation, and empty states.
- Implement per-video Undo/Redo with one entry per drag and coherent typing edits.
- Complete keyboard navigation, nudging, text-entry shortcuts, and accessible labels.
- Keep fit-to-window resizing independent of stored geometry.

Verification:

- Run focused tests for inspector/canvas consistency, minimum height, and invalid input.
- Verify selection/deletion keys never intercept normal character editing.
- Check narrow/minimum-window layout, scrollable properties, hover-to-delete movement,
  focus visibility, and non-drag positioning/sizing.
- Confirm saved overlay geometry stays constant through application-window resizing.

**Checkpoint:** demonstrate the complete editor on one video and a matching export.

### Milestone 6: Multiple videos and workspace persistence

**Goal:** make the app usable for a real collection of reels.

Work:

- Add multi-file selection/drop, thumbnails, probing, and per-file import errors.
- Keep one active video and independent export checkboxes/Select All.
- Preserve each video's edits and paused playhead across navigation.
- Add duplicate notices, workspace-only removal, and confirmed Clear Workspace.
- Autosave a versioned workspace with recoverable writes and truthful save status.
- Restore local source references and provide missing-file/relink recovery.
- Surface source changes, inaccessible media, and save failures explicitly.

Verification:

- Import 30 mixed clips while keeping interaction responsive.
- Switch videos without losing edits or changing checkbox state.
- Test duplicates, mixed valid/invalid imports, missing sources, and mismatched relinks.
- Relaunch and verify edits, order, checkboxes, playheads, and output-folder preference.
- Inject a write failure in a test-owned location; verify no false Saved state.

**Checkpoint:** demonstrate a persistent multi-video workspace. This stage does
not yet imply complete batch-text or batch-export support.

### Milestone 7: Apply to All and reusable new-import text

**Goal:** prepare text once, then inspect independent copies across the collection.

Work:

- Add the batch section in the inspector using the PRD's copy rules.
- Fill only absent/empty/whitespace text; preserve existing non-empty custom text.
- Apply relative geometry/font/padding mapping to every target, regardless of
  export checkboxes; allow mixed ratios and flag reflow for review.
- Save a detached default; support inheritance for later imports and an off switch.
- Persist that default without linking it to later source edits or source-row removal.
- Implement immediate group Undo/Redo and the transition back to per-video history.
- Report filled/preserved/source/error counts accurately, including zero-fill default updates.

Verification:

- Check exact 2x scaling from 1080 x 1920 to 2160 x 3840.
- Check mixed-ratio reflow/minimum height without stretching letters.
- Verify existing text is unchanged and the next video already displays its copy.
- Change/delete one copy; verify other copies and the saved default do not change.
- Import after modifying the source: inherit the last-applied snapshot, not new edits.
- Test switch off/on, relaunch, source removal, and Clear Workspace.
- Test group Undo after navigation/playback and ordinary Undo after a later mutation;
  never discard unrelated subsequent edits.

**Checkpoint:** demonstrate the full "apply once, play/check each reel" workflow.

### Milestone 8: Complete export queue and cancellation

**Goal:** reliable current/checked/all export with understandable outcomes.

Work:

- Finish preflight, eligibility/skipped lists, automatic formats, and output-folder choice.
- Capture immutable job definitions and process one video at a time.
- Lock workspace/default mutations during export and safely unlock after completion/cancel.
- Add per-job/overall progress, failure continuation, results, and Retry Failed.
- Implement collision-safe naming and final publication without overwriting any file.
- Own and track worker processes and temporary outputs through every lifecycle stage.
- Handle cancellation during overlay preparation, active encoding, and finalization.
- Handle quit requests and interrupted exports without implicit restart.

Verification:

- Export current, checked, and all scopes with both SDR and HDR inputs.
- Include empty text and unavailable sources; verify preflight explains exclusions.
- Force one failure and verify later jobs finish and only failures are retried.
- Cancel at several points: preserve completed outputs, stop writers before unlocking,
  and remove/report tracked partial files.
- Test an existing output name and a collision appearing after preflight.
- Test unwritable/full destinations using controlled fixtures, not destructive changes
  to the user's source folders.

**Checkpoint:** demonstrate a real batch, failure/retry, and cancellation.

### Milestone 9: macOS package and release validation

**Goal:** a usable offline Apple-silicon application, not only a development session.

Work:

- Produce the macOS-arm64 application package with working bundled-tool paths/permissions.
- Verify font/emoji resources, native worker execution, app-data paths, and no
  dependency on development tools or the developer's machine configuration.
- Complete missing-resource, restore-error, cancellation-cleanup, and quit flows.
- Include required licence/build/source notices for the chosen dependencies and binaries.
- Address signing/notarization before wider distribution; do not disable OS protections
  as a substitute for a valid distribution package.
- Record acceptance results and known limitations honestly.

Verification:

- Run the packaged app offline on the supported Mac baseline.
- Run the applicable PRD acceptance scenarios, including 30 mixed videos and an
  individual 4K/60 fps/30-minute source.
- Measure UI feedback, first frame, seeking, autosave, cancellation, geometry,
  video duration, and audio offset against the exact PRD thresholds.
- Inspect real SDR/HDR outputs, not only thumbnails or metadata.
- Confirm completed outputs and originals survive cancellation, failure, and relaunch.
- Verify the final application has no dead placeholder controls or success-shaped failures.

**Gate G5 / macOS release review:** the application is not complete until these
checks pass or an explicit requirement revision is agreed.

### Milestone 10: Windows preview, authorized

Authorized on 2026-11-18 after review of the Windows-specific approach.
The approved target expands to Windows 10 and 11 on Intel x64. No 32-bit or
Windows ARM release is included.

- Preserve the macOS media pipeline and share the UI, workspace and editor rules.
- Use CPU x264/x265 encoding, including HEVC Main10, without a GPU requirement.
  The separately built Windows FFmpeg is GPL-2.0-or-later with corresponding
  source/notices; macOS remains LGPL-only. This trade-off was explicitly approved.
- Build static, offline workers from immutable source pins in MSYS2 UCRT64.
- Supervise native children using Windows Job Objects and a parent-lifeline/
  cancellation pipe; retain bounded stop, crash cleanup and source safety.
- Flush pending workspace bytes and atomically replace saves with backups.
  Do not attempt unsupported POSIX directory fsync on Windows.
- Produce an unsigned portable ZIP, not a signed installer or auto-updater.
- Build/test through GitHub Actions on Windows Server 2022 and 2025 runners.
  Separately validate actual Windows 10/11 clients, physical HDR and performance
  before claiming a certified Windows release.

- Use the shared UI, domain rules, schemas, text resources, and job workflow.
- Add/test Windows x64 tool binaries, codec capabilities, app-data paths, permissions,
  Ctrl shortcuts, window integration, process cancellation, and installer behavior.
- Validate the same text/emoji geometry and HDR/SDR output on Windows itself.
- Run Windows acceptance/performance checks before claiming support.
- Obtain access to a suitable Windows test/build environment when this phase begins.
  Do not assume a Mac build or an untested cross-build proves Windows behavior.

**Checkpoint:** the implementation plan, CPU/GPL trade-off and GitHub workflow
publication are approved. A passing Mac build or Server CI alone does not close
the Windows client-OS, physical HDR or reference-hardware release gates.

## 5. Code and tooling boundaries

Start with one application project. Add modules only as they are needed:

| Area              | Responsibility                                                              |
| ----------------- | --------------------------------------------------------------------------- |
| `src/main`        | Native dialogs, filesystem/persistence, source checks, worker/job ownership |
| `src/preload`     | Narrow validated bridge; no arbitrary commands                              |
| `src/renderer`    | React UI, editing store, canvas adapter, preview playback                   |
| `src/shared`      | Domain types/schemas, geometry/copy rules, serializable job definitions     |
| Bundled resources | Pinned fonts/emoji and platform-specific media tools                        |

Selected tooling is recorded in [package.json](../package.json) and the dependency
lockfile. Keep the lockfile with the project source. No Git repository or commit
has been created as part of this milestone.

Use focused unit tests for domain/history rules, renderer/interaction checks for
the text canvas, real-media integration tests for rendering, and packaged-app smoke
tests. Milestone 1 uses Node 24's native TypeScript/test support and Playwright
against the actual packaged Electron renderer. No additional unit-test framework
is needed for the current foundation.

Actual commands and their scope are documented in [README.md](../README.md).
Milestone 2 adds focused geometry/worker/publication tests and real-media native
integration tests. New milestone behavior still requires its own relevant tests.

## 6. Test media and evidence

- Generate small synthetic fixtures for routine tests; keep expected geometry,
  timestamps, orientation, audio, and colour properties explicit.
- Use local representative phone/reel files for device-specific HDR/HEVC behavior.
  Request suitable samples when that milestone needs them; never upload originals.
- Keep large/long performance fixtures out of the application bundle and ordinary
  quick test runs. Run them intentionally at media/release checkpoints.
- Retain actual command results, measured timings, output paths, and media checks
  in an implementation validation record when implementation is authorized.
- Log exact reference hardware/software versions without collecting device identifiers.
- Never infer HDR fidelity from a 10-bit file tag alone, text fidelity from a
  screenshot alone, or offline packaging from a development build alone.

## 7. Definition of done for each milestone

- Requested milestone behavior works and persists where required.
- Related checks pass; new tests cover introduced/fixed behavior rather than constants.
- No unrelated feature additions or silent fallback to reduced requirements.
- UI errors identify the affected file/control and the recovery action.
- Temporary test files/processes are cleaned up; original media is untouched.
- Documentation reflects any agreed design changes.
- The user receives a concise demonstration/result and chooses whether to proceed.

No calendar estimate is committed before the rendering/preview feasibility gates.
After those results, scope and estimates can be revisited with evidence.

## 8. Current checkpoint

**Milestone 9 is implemented for local Mac review. Milestone 10 is now authorized
for an unsigned Windows 10/11 x64 CPU-compatible preview. Broader release
certification, physical HDR visual review, minimum-OS execution and reference
hardware certification remain open.**

Current source: **0.10.0 preview**, with Windows native/portable validation in
progress. Last delivered Mac review build: **0.9.2**, unsigned under
`out/preview-0.9.2/`. Older isolated packages are preserved.

### Balanced export bitrate correction (0.9.2)

Real footage exposed quality-95 H.264 growth from approximately 22 Mbps HEVC
input to 283–294 Mbps output. The user authorized codec preservation and
source-aware rate control, then explicitly selected balanced size/quality
after a stricter 0.99 SSIM trial detected re-encoding differences.

Eight-bit HEVC stays HEVC Main; H.264 remains H.264. Ten-bit/HDR stay Main10.
Native preflight and output validation share that policy; no workspace schema
change or loss of saved text is required. Target average video bitrate is 150%
of the source video bitrate, with a 150%-of-target rate limit and three-second
buffer. Minimum eight/ten-bit targets are 256 Kbps / 4 Mbps. Missing metadata
is logged and measured from only the selected video's packets; invalid rates
fail explicitly. No resolution, timing, audio or compositor downgrade is used.

Full-length hidden-editor exports of the seven supplied originals preserve
all displayed frames, exact decoded timestamps, durations, AAC packet payloads
and source hashes. Size ratios are 1.48–1.49; non-text lower-75% comparisons
measure PSNR 43.63–46.54 dB and SSIM 0.9806–0.9875. Balanced real-footage checks
require PSNR >=42 dB / SSIM >=0.98 after the user's explicit trade-off decision;
all pre-existing numerical fidelity thresholds are unchanged.
Separate test-text exports and machine-readable measurements are retained in
`out/export-bitrate-review-0.9.2-final/`. Prior exports and originals are untouched.

Final validation passes type-check/lint/build, 61 unit/native-worker and 40
hidden desktop/package tests. The routine suite skips the real-data and
30-minute preview opt-ins. The exact isolated 0.9.2 hardened app passes four
packaged workflows plus the full real Sample B balanced test: 84.201381 MB,
1216 displayed frames, zero timestamp drift, unchanged AAC/source hashes,
43.773353 dB non-text PSNR / 0.981219 SSIM. This independently reproduces the
seven-clip measurements after the final native-only metadata implementation.
ZIP integrity passes; no owned app/media/test processes remain.
SHA-256: `7ce6112764b2ed67d9f0791da343564927ded1c1c3f05e28c2154f674bbd3b96`.
Preview code is unchanged; the long preview benchmark was not rerun.
Local-only signing/physical-HDR/minimum/reference hardware limits are unchanged.

### Historical Phase 9 audit fix (0.9.1)

Confirmed and fixed a zero-degree mirrored-HDR playback mismatch: the GPU path
ignored the display reflection although the poster/export applied it correctly.
Hardware preview eligibility now excludes display matrices, not just nonzero
rotation. The established CPU orientation path handles these inputs. Normal
HDR retains hardware downscaling; text geometry and export quality are unchanged.
The new visual regression fails against 0.9.0 and verifies matching poster,
playback and actual edited export against the fix for limited-range HLG and
full-range PQ.

Patch validation passes type-check/lint, 59 unit/native-worker and 40 hidden
desktop/package cases. SDR PSNR 52.539 dB, copied AAC packets, VFR within 2 us
and HLG/PQ gradient counts 877/1024 remain unchanged. The exact isolated 0.9.1
hardened app passes four package workflows and its 30-minute UHD 4K60 benchmark:
1374.8 ms import, 979.9 ms seek p95, one decoder / 146528 KiB peak decoder RSS,
about 12 s buffered, cancellation acknowledgement 21.7 ms / stop 2522.0 ms.
No workers/partials remain. ZIP integrity and actual extracted-app offline
edit/play/export/restore pass. Seek headroom, physical HDR and minimum/reference
hardware limits remain as documented; no threshold or export setting changed.
SHA-256: `5f65176c1ea2085959bee6f29ecce815e3a13b95b7ec8a787c94b2c01097e942`.

### Original Milestone 9 package acceptance (0.9.0)

- `npm run make:review` creates an isolated versioned app/ZIP and refuses
  replacement. `test:package` audits the actual bundle's version/minimum OS,
  arm64 architecture, internal symlinks, restrictive fuses/ASAR, 20 pinned
  resources, licences/source notices and system-only native dependencies.
- A relocated hardened-app test removes developer PATH, blocks networking,
  edits bundled emoji, plays, exports, validates output with its bundled ffprobe
  and restores the text/results after relaunch. No shipping fuse is weakened.
- Paused painted-edit feedback p95 is 17.6 ms (target 100 ms); durable autosave
  is 233 ms (target 1 s). The 30-video collection test now preflights and actually
  exports all 30 checked mixed clips, then preserves all 31 completed outputs
  through Clear Workspace. Its focused UI worst interval is 22.3 ms (limit 250 ms).
- HDR preview adapts to 360 pixels and 50 ms fragments. Untransformed HEVC
  yuv420p10le HDR downscales on VideoToolbox before readback; other formats and
  rotations retain the existing CPU orientation path. SDR remains 720 pixels /
  15 fps. Text geometry and source-resolution export quality are unchanged.
- The actual hardened 0.9.0 app passes the retained 30-minute UHD 4K60 HLG
  benchmark: 108,000 frames / 1.52 GB, import-to-editable 1374.0 ms, 20-seek p95
  972.0 ms against 1000 ms, one decoder, 146896 KiB peak decoder RSS and
  about 12 seconds peak buffering. Active long-export cancellation acknowledges
  in 17.6 ms and stops in 2460.1 ms, with no remaining workers/partials.
  The source is a looped synthetic pattern, not a real-camera corpus.
- Seek margin is limited. The baseline p95 was 1112.7 ms; a development-runtime
  run after optimization still measured 1021.5 ms. The hardened-package pass
  does not establish M1 Pro 16 GiB / minimum-OS performance. No PRD threshold
  was weakened, and local-only scope is not public-distribution certification.
- Signing/notarization is deferred only for this user's explicit local review
  choice. It remains required before wider distribution; no credentials were
  requested and no OS protections disabled.
- Final validation passes type-check/lint, 59 unit/native-worker and 39 hidden
  desktop/package cases, plus the separate hardened long benchmark. All four
  exact isolated-app checks pass. The delivered ZIP passes integrity and actual
  extraction/relocated offline edit/play/export/restore tests. The earlier
  hardened run also passed (987.3 ms seek p95); no threshold was relaxed.
  SHA-256: `62fbc2f1f95d4921add1abf715d3d2f0b29601b663b9d93716d272009a6b6887`.

### Historical Milestone 8 audit fixes (0.8.1)

- Current/checked/all preflight lists eligible formats/planned names, empty-text
  skips and unavailable sources. One remembered, changeable folder is validated.
- Native-owned frozen jobs reuse the existing SDR/HDR pipeline sequentially;
  final publication remains collision-safe, including duplicate basenames and
  files appearing after preflight.
- Per-job/current/overall progress, truthful results, failure continuation and
  Retry Failed use the failed videos' current edits without rerendering successes.
- Cancel waits for all writers/cleanup, preserves completed outputs and cancels
  pending work. Cleanup warnings retain exact paths and published-output status.
- Close/quit confirms Continue Export / Cancel and Quit and serializes shutdown.
  An atomic export journal marks interrupted work on relaunch without auto-restart.
  Exact temporary paths are recorded before rendering; a crash before worker
  launch may leave a tracked folder, explicitly exposed for inspection.
- Verification passes type-check/lint, 59 unit/native-worker tests and 37 hidden
  desktop tests; one opt-in 4K60 benchmark is skipped. The exact isolated hardened
  0.8.1 app passes startup/resources, collection/default/relink restoration and
  repeated/Force Quit lifecycle checks. ZIP integrity and bundle version pass.
- The final-results journal is committed before the UI unlocks; a controlled
  delayed-write regression verifies that boundary. Destination probes and actual
  export folders are distinguished in the retained overlay-capture helper.
- The 0.8.1 audit fixes seven reproduced issues: destination drift after failed
  preference saves, missing hard-link preflight, history edits behind results,
  hidden preflight after window reopen, stale folder-picker replies, late-stage
  overlay cancellation/deadline hangs and disappearing cleanup warnings.
  Permanent unit/hidden regressions cover each; stalled conversion tests verify
  actual interruption, remaining-job behavior, window disposal and partial cleanup.
- Existing fidelity checks retain SDR PSNR 52.539 dB, unchanged AAC packets,
  irregular timestamps within 2 us, and HLG/PQ gradient counts of 877/1024.
  The 30-clip UI run remains below its 250 ms worst-interval limit.
  No Phase 9 release certification, physical HDR validation or fresh 30-minute
  4K60 benchmark is claimed.

### Historical Milestone 7 audit fixes (0.7.1)

Previous build: **0.7.1**, macOS arm64, unsigned local review under
`out/preview-0.7.1/`.

The Phase 7 audit fixes failed-cleanup save/UI divergence, stale close snapshots
during Remove/Clear, overlapping sidebar action hit targets, disabled reset of an
empty collection's default and missing pixel-shape reflow warnings. Committed
removals report cache-cleanup warnings; save failures preserve the previous
document. Pending mutations are serialized with close, including recovery from
the native close timeout. Permanent unit/hidden UI regressions cover these paths.
Patch validation passes type-check/lint/build, 51 unit/native-worker tests and
26 hidden desktop tests, including the exact isolated 0.7.1 hardened app; one
opt-in 4K60 benchmark is skipped. Export-quality/lifecycle checks and ZIP integrity
pass. The 30-clip responsiveness run records 22.8 ms worst against a 250 ms limit.

The original 0.7.0 milestone evidence follows; patch validation is recorded in
the development guide.

- Apply to All fills absent/empty/whitespace text regardless of export checks,
  preserves nonempty targets and the source, and reports failures per target.
- Exact width/height-relative mapping preserves fractional/off-frame geometry,
  padding and uniformly scaled fonts; mixed aspect ratios reflow for review.
- Detached last-applied defaults survive source edits/removal and relaunch.
  First apply enables future-import inheritance; later applies respect off/on.
  Clear Workspace resets the default; deleted text is never refilled by navigation.
- Immediate group Undo/Redo restores successful targets' previous text/histories
  and the previous default/settings without rolling back source edits, navigation,
  playback, seeking or checks. Later mutations return to per-video history.
- Shared 100-step / 16-MiB retention includes group checkpoints, with explicit
  feedback when a checkpoint cannot fit; current text/default are never evicted.
- Workspace version 2 migrates version 1 without losing existing work.
- Retained unit tests cover copy precision/fitting, failures, histories, detached
  defaults, step/byte budgets and migration. A hidden synthetic end-to-end test
  copies 1080 x 1920 text to 2160 x 3840, plays/exports the copy, checks decoded
  glyphs and exercises group/default lifecycle through source removal/relaunch.
- The separate 30-minute 4K60 benchmark was not rerun for Phase 7. Export remains
  high-quality lossy; physical HDR and minimum-Mac certification remain open.
- Verification: type-check/lint/build, 47 unit/native-worker and 20 hidden desktop
  tests pass, with one opt-in benchmark skipped. The exact isolated hardened
  0.7.0 app passes startup, collection/relink/relaunch and persisted-default
  inheritance. ZIP integrity and bundle version are verified. The 30-clip
  responsiveness check records 25.8 ms worst against its 250 ms limit.
- Batch export was deferred at this checkpoint and is now implemented in Milestone 8.

### Historical Milestone 6 workspace proof (0.6.0)

- Multi-file import/drop, compact thumbnails, per-file failures, duplicate notices.
- Independent row activation/export checks, tri-state Select All, per-video edits,
  session history and paused playheads; confirmed workspace-only removal/clear.
- Versioned local autosave with atomic replacement, fsynced data/directory and
  backup; truthful save status/retry; close/export flush.
- Missing/changed source recovery and full-content SHA-256-verified relink;
  corrupt-workspace retry, previous-save recovery and explicit archive/reset.
- 34 unit/native-worker tests and 17 hidden desktop tests cover collection,
  write failure/corruption recovery, source recovery and previous export/lifecycle
  behavior. Thirty mixed SDR/HDR MP4/MOV clips imported with a 22.3 ms worst
  renderer timer interval in the local responsiveness check (250 ms limit).
- The hardened package separately imports, saves, relaunches and relinks a real
  collection using renderer CDP and native file paths. Node inspection stays
  disabled; deeper dialog/export tests use the same production bundles in the
  development Electron runtime.
- The 30-minute 4K60 HDR benchmark still passes without relaxing gates:
  1,384 ms editable, 908 ms seek p95, 12 s buffer, one decoder (~416 MiB peak).
- Apply to All and import defaults were deferred here and are now implemented
  in Milestone 7. Batch export remains Milestone 8.

### Historical regression-fix release 0.5.1

Current regression-fix build: **0.5.1**, macOS arm64, local unsigned review package
isolated under `out/preview-0.5.1/`. No Milestone 6 work is included.

The user authorized fixing the two core/lifecycle audits and chose high-quality
lossy MP4 plus 100-step/16-MiB Undo retention. The fix adds non-scrollable preview
clipping, exact filter timebase for SDR, 10-bit SDR Main10 export, quality 95 and
AAC packet copy. A bundled parent-lifeline guardian reaps workers after Force Quit;
the quit gate also waits through repeated Quit requests. Export reveal IDs no
longer accumulate. Retained tests exercise noisy-detail PSNR >=42 dB (local result
52.539 dB), exact AAC packets, irregular PTS within 2 us, edge glyph placement,
history limits, parent death and stalled repeated-Quit cleanup.

0.5.1 verification completed:

| Check                                      | Result                                                                                                     |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Type-check / lint                          | Pass                                                                                                       |
| Unit / native-worker regressions           | 31 passed                                                                                                  |
| Hidden desktop / native export regressions | 14 passed, also against the isolated review app                                                            |
| 30-minute 4K60 HDR benchmark               | 888 ms editable; 931 ms seek p95; 12 s buffer; one decoder; 419 MiB decoder peak                           |
| Repeated-use audit                         | 32 cycles; stable DOM/listener counts; no idle media workers, live preview URLs or partial exports         |
| Actual active-export shutdown              | Window close, Quit, SIGTERM and Force Quit cleaned up; Force Quit completed in 1.54 s                      |
| Distribution                               | ZIP integrity checked; bundle version 0.5.1; arm64 guardian present; packaged resource verification passed |

The original native image-cache growth observation was not confirmed as an
unbounded application leak. Do not equate steady JS heaps with zero native leaks
or claim physical HDR certification.

| Milestone 5 check      | Result                                                                                                                                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Creation and selection | Video click creates/focuses empty text; accessible Add Text centres it; background click selects without moving; unused workspace click commits/deselects                                             |
| Direct text entry      | Native caret/character selection, plain textarea input, newlines, Escape/Cmd+Enter, representative emoji/combining sequences; character keys do not delete objects                                    |
| Complete inspector     | Bundled families/styles, one-decimal font size with one-pixel steppers, opaque HSV/preset/HEX colour, alignment, X/Y/Width/Height, centring and persistent deletion                                   |
| Validation             | Invalid/non-finite/below-minimum entries retain valid source geometry; unsupported renderer font sizes fail explicitly; invalid/alpha HEX is rejected, not truncated                                  |
| History                | Canonical box and minimum-height snapshots; one entry per drag/resize/colour gesture; coherent typing/selection boundaries; creation, auto-fit, formatting, centring and deletion restore fully       |
| Native menu and fields | Toolbar, macOS Edit menu and platform keyboard Undo/Redo agree; numeric/HEX field editing retains native undo rather than consuming object history                                                    |
| Recovery/deletion      | Hover-delete bridge remains usable; panel/keyboard deletion and Undo work; off-frame box can be recovered without changing size/style                                                                 |
| Fit and access         | 1100 x 700 layout without horizontal page/property overflow; independently scrollable inspector; visible keyboard focus; non-drag positioning/sizing; window fitting leaves source geometry unchanged |
| Matching export        | Restored styled box exports with glyph bounds within one source pixel of canonical overlay; SDR/HDR precision, source/audio/timing/cancellation/no-overwrite regressions remain green                 |
| Retained checks        | 25 unit/native-worker tests, 10 routine desktop tests, and the separate 30-minute 4K60 HDR benchmark pass with hidden/unfocused windows                                                               |
| Preview rerun          | M4 Max / 48GiB: 358ms import-to-editable, 914ms presented-frame seek p95, about 12s buffer, one decoder, about 416MiB decoder RSS; unchanged thresholds                                               |
| Packaging              | v0.5.0 isolated from older builds; cached Electron archive validated with checksums from the pinned dependency, without disabling integrity checks                                                    |

History remains session-local and resets on successful source replacement.
Playback, seeking, import and export are not text edits. Multiple-video histories,
persistence, Apply to All and batch export remain later milestones. No private
camera media is required. The regression fix includes a small project-owned native
guardian, built from bundled C source, rather than a new third-party dependency.

### Historical Milestone 4 playback proof

| Milestone 4 check         | Result                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Actual playback transport | On-demand H.264/AAC fMP4 in Chromium MediaSource; eight-second windows, no full proxy or whole-video RAM load                         |
| Controls                  | Play/Pause, seek slider, elapsed/total time, preview Mute; Space outside text/focused controls                                        |
| Text editing              | Poster-first placement; playback pauses for text operations; canonical text geometry unchanged                                        |
| Preview-only quality      | At most 720px SDR / 480px HDR long edge, 15fps; HDR remains explicitly labelled SDR preview                                           |
| Source coverage           | H.264, HEVC Main10 HLG/PQ, portrait rotation, VFR, audio and one-frame clips                                                          |
| Stale work                | Rapid superseding seeks; old workers fully close before replacement; cancelling backpressured stdout cannot hang shutdown             |
| Audio safety              | First track converted to stereo AAC for preview; decoded impulse alignment within 20ms; preview Mute does not change all-track export |
| Long fixture              | 30-minute 3840 x 2160, 60fps, Main10 HLG: 108,000 frames, approximately 1.52GB, looped synthetic two-second pattern                   |
| Editable-frame latency    | Approximately 0.35s full import through editable text, including metadata/poster work; below the 2s post-metadata target              |
| Presented-frame seeking   | Approximately 0.90s p95 across 20 non-keyframe-aligned positions; unchanged 1s target                                                 |
| Bounded playback          | About 12s peak buffered span, one owned decoder, about 416MiB peak decoder RSS; normal timeline speed across refills                  |
| Available hardware        | M4 Max, 48GiB RAM; this is not certification of the PRD's M1 Pro / 16GB reference or minimum macOS                                    |
| Retained checks           | 22 unit/native-worker cases, eight routine desktop cases and a separate opt-in long-video benchmark                                   |
| Non-disruptive automation | Test windows stay hidden/unfocused; no Dock activation or visible confirmation dialogs; normal app launches unchanged                 |
| Export preservation       | Existing SDR/HDR gradient, glyph, timing, frame-count, audio, cancellation and no-overwrite checks retained                           |

The initial 720px HDR stream missed the seek target. Native first-fragment and
shutdown measurements informed bounded decoder threading and low-delay encoding;
HDR playback also adapts downward to 480px as FR-08 permits. Neither export
quality nor the benchmark threshold was relaxed. Fixtures/profiles are generated
locally and removed in test cleanup; no private footage is needed.

`npm run test:preview-benchmark` retains the measured 30-minute test. It checks
actual frame presentation, not merely a seek acknowledgement. Normal desktop
tests skip this large-fixture case. Broad real-footage, reference-hardware and
minimum-OS performance remain unverified. Full fused-package export/playback
certification remains a later release gate; native integration uses production
bundles in the development Electron runtime, while package tests cover startup.

### Historical Milestone 3 HDR proof

Build **0.3.0**, isolated under `out/hdr-0.3.0/`:

| Milestone 3 check           | Result                                                                                                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Explicit HDR classification | Tagged 10-bit BT.2020 HLG/PQ, full/limited range; only supported standalone Dolby profile 8 bases accepted                                                  |
| High-precision colour path  | Explicit transfer functions and float32 linear-light alpha compositing; no automatic clipped HDR-to-linear conversion or 8-bit HDR intermediate             |
| Text colour and brightness  | Canonical sRGB converted to linear BT.2020; nominal 203 cd/m² white, independently normalized alpha; numerical colour/alpha regressions retained            |
| Native HLG and PQ exports   | Main10 HEVC/hvc1; 872 HLG and 1,020 PQ decoded gradient levels; mean non-text luma errors 0.007813 and 0.003906 10-bit code values                          |
| Decoded text white          | 3,058 opaque interior samples per fixture; mean errors 0.14647 HLG and 0.08373 PQ code values, below one-code tolerance                                     |
| Timing and audio            | Both 50-frame VFR fixtures retain all timestamps within 1 ms; AAC impulse offsets within 20 ms                                                              |
| Metadata safety             | Encoded-packet Dolby RPU stripping plus every-frame HDR metadata validation before publication; stream tags alone were insufficient                         |
| Real rotated HLG footage    | Full 31.9-second export; 957 displayed frames, zero frame-timestamp drift, 1080 x 1920 Main10 BT.2020 HLG                                                   |
| Real non-text fidelity      | Mean luma error 0.434182 10-bit code values over 259,200 samples in the first frame's non-text region                                                       |
| Independent Apple decoder   | AVFoundation decoded all 957 frames at 1080 x 1920 into 10-bit `x420` buffers                                                                               |
| Source and audio safety     | Original checksum unchanged; APAC reported rather than silently dropped; authorized verification copy retained identical encoded HDR video/main AAC packets |
| Repeatable regressions      | 20 unit/native-worker cases; seven sequential packaged/native desktop cases, using generated non-private fixtures                                           |
| Native dependencies         | Existing pinned LGPL-only binaries reused; no new native dependency, download or rebuild                                                                    |

The real source also contained unsupported Apple APAC spatial audio. With the
user's explicit permission, verification used a temporary copy containing the
unchanged HDR video and main stereo AAC packets, omitting only that extra track.
The original import instead produced the explicit APAC error. This was not a
change to the application's no-silent-audio-loss policy. The temporary reference,
export and private profile are removed after verification; no private footage is
part of the regression suite or package.

Encoded Dolby RPU persisted in the first real output despite frame-side cleanup
and clean stream-level metadata. The encoded-packet `dovi_rpu=strip=1` filter fixed
it. The final real rerun had input RPU but none on any output frame. A production
all-frame guard now rejects forbidden metadata or unverifiable scans before
publication.

These are numerical/decode results, not a physical HDR appearance certification.
At that checkpoint, preview remained an explicitly labelled SDR poster; playback,
workspace/batch features, long 4K performance and release certification were not delivered.

### Historical Milestone 2 SDR proof

Build **0.2.1**, macOS arm64, local unsigned review package:

| Milestone 2 check                      | Result                                                                                                               |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Native import and oriented poster      | Actual SDR H.264/HEVC MP4/MOV metadata and decoding; source identity retained                                        |
| Shared text adapter                    | Native textarea/custom frame; same `TextLayer` in preview and hidden export page; no Fabric or `drawtext`            |
| Direct editing and fit                 | Multiline/long words, native caret, plain text, font/style/colour/alignment, numeric positioning and centring        |
| Eight real handles                     | Box-only resize; constant font size; opposite anchor retained at top/left fit minimum                                |
| Invalid numeric height                 | Prior valid geometry retained with visible error                                                                     |
| Unicode proof                          | Ordinary emoji, skin tone, flag, family ZWJ and combining accent caret steps; bundled coloured glyphs survive export |
| Transparent overlay and decoded export | Source-sized PNG, excluded controls, bounds agree within one source pixel, negative-position clipping                |
| Colour and orientation                 | ICC-aware sRGB normalization; glyph-interior RGB error 3/255, below 5/255; source/poster/output corners agree        |
| Rotated VFR                            | 24 frames with two frame intervals; all timestamps retained within 1 ms                                              |
| Audio content                          | Stereo and mono AAC tracks retained; decoded impulse offsets within 20 ms                                            |
| Output safety                          | Original checksum unchanged; concurrent publication cannot overwrite existing files; owned worker cancellation       |
| Failure paths                          | Corrupt import, synthetic 10-bit HLG rejection, cancellation and changed source retain the editing workspace         |
| Independent external playback          | Native AVFoundation played the actual 2-second MP4 to its end and delivered 50 decoded 320 x 180 frames              |
| Focused automated checks               | 14 unit/native-worker tests; 4 native editing/media tests; 2 packaged startup/resource tests                         |

Real-media tests use synthetic encoded files and production bundles with the
unmodified development Electron runtime. Only native test dialogs are stubbed.
Packaged Node-inspection fuses remain intact; browser-only packaged tests cover
offline startup, layout, resources, recovery and relaunch. This is not a claim
that the full export path has been automated inside the fused package.

Two implementation findings were resolved at their source:

- The original `--disable-autodetect` media build excluded PNG encoding. Rebuilt
  FFmpeg/ffprobe with explicit system zlib, reviewed executable hashes and
  system-only dependencies, and updated the manifest/build recipe/notices.
- Native Chromium screenshots contained Display P3 pixels with an ICC profile.
  FFmpeg ignored that profile. Explicit one-to-one sRGB conversion in the hidden
  Chromium page fixed the measured colour error without another layout engine.

Necessary single-video inspector controls were included to exercise this proof;
Undo/Redo and complete single-video UX were deferred to Milestone 5, now verified
above. At that checkpoint, no later playback/workspace/batch/HDR feature
was implemented.

Historical editor captures and exported demos were generated locally under
`out/` and are not committed. At that checkpoint, sessions were not saved; closing
nonempty edits warns. Real phone footage, arbitrary colour spaces/scripts/audio
layouts, non-square-pixel proof, long 4K performance, HDR, minimum-macOS execution,
Windows and signed/notarized distribution remain unverified.

#### 0.2.1 frame-count validation fix

A locally supplied SDR HEVC clip reported 408 container samples, including six
discarded by its MP4 edit list. Both FFmpeg and Apple's independent AVFoundation
decoder produced 402 displayed frames; export also preserved 402. Comparing raw
container totals incorrectly blocked that valid result.

On mismatched or unavailable container counts, validation now decodes source and
output to compare actual displayed counts. Real dropped frames and missing or
invalid verification results still fail. Import remains metadata/poster-only.
A non-private synthetic trimmed MP4 with 30 stored samples and 25 displayed frames
reproduces the issue in the native export test; a unit regression rejects genuine
frame loss. The supplied original is never modified or added to the test suite.
The supplied clip subsequently completed an export through the native application:
402 displayed frames in, 402 out, with the original checksum unchanged. All 14
unit/native-worker and six packaged/native integration checks pass for the fix.

### Historical Milestone 1 foundation

Verified on the available Apple-silicon Mac on 2026-11-17:

| Check                                                                         | Result                                                                        |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Strict application/tooling type checks and module-boundary lint/format checks | Passed                                                                        |
| Focused resource unit tests                                                   | 6 passed                                                                      |
| Actual packaged-app UI tests                                                  | 2 passed                                                                      |
| Offline packaged reload and local font decoding                               | Passed; 19 resource entries and 5 font faces                                  |
| Native minimum size and layout                                                | Passed; 1100 x 700 minimum, 240/280-pixel side panels, no horizontal overflow |
| Keyboard-visible focus, resource recheck, quit/relaunch                       | Passed                                                                        |
| Missing/corrupt resource notification and repair                              | Passed in an isolated cloned app; original bundle untouched                   |
| Production build and local macOS-arm64 ZIP                                    | Passed                                                                        |
| Development launch through Vite                                               | Passed with actual native window and resource checks                          |

The application separates native ownership, the narrow validated preload bridge,
shared contracts and React components. It does not introduce an unused editing
store or a speculative framework. The maintained Forge scaffold is preserved
with macOS-only packaging; Windows packaging remains deferred.

The initial prebuilt media candidate was rejected because its actual flags enabled
nonfree components. The bundle instead includes locally built FFmpeg/ffprobe
9.0.2, corresponding source and notices, no enabled GPL/nonfree components,
disabled networking, and only standard macOS dynamic dependencies. Its source
and executable hashes, build recipe and explicit limitations are recorded under
[resources](../resources/manifest.json).

At that checkpoint, import, text editing, video preview, autosave and export were
disabled. No real video had been processed;
SDR/HDR correctness, emoji editing, media performance, Windows support and
execution on the minimum macOS version remain unverified. In particular, the
initial media build has no `zscale`; the HDR gate may require an explicit build
change rather than a silent fallback.

Milestones 2 through 7 were subsequently authorized and are recorded above. The next
separate implementation approval is for Milestone 8.
