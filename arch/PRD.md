# Product Requirements Document: Video Text Editor

For setup and usage, see the [project README](../README.md).

- Version: 0.9
- Date: 2026-11-17
- Status: APPROVED on 2026-11-17
- Phase: Milestones 9 and 10 Mac/Windows previews implemented; native Windows Server 2022/2025 validation passed on 2026-11-18; client-OS and physical HDR review pending
- UI direction: approved
- Implementation: Milestones 1 through 10 authorized; Windows client-OS and hardware release certification remain required
- Regression-fix decisions: high-quality lossy MP4 and 100-step/16-MiB Undo retention approved on 2026-11-17

## 1. Product goal

Create a local, offline desktop application for adding one editable text box to
each original video and exporting separate edited videos.

The main workflow is a collection of short reels, usually sharing an aspect
ratio, with occasional longer videos. Users can prepare text once and fill the
other videos without text, then play and check each independent copy. Mixed aspect
ratios remain supported. The editor must make text placement fast and predictable,
without the complexity of a general-purpose video editor.

The video preview is a placement aid: speed matters more than preview image
quality. Final exports remain high quality.

### Success criteria

1. Import multiple videos, open one at a time, and retain independent text edits.
2. Create, move, resize, format, edit, and delete a text box directly on the video.
3. Keep text placement and line wrapping consistent between preview and export.
4. Export the current video or a batch, with a separate output per original.
5. Preserve source resolution, display orientation, frame timing, duration, audio,
   and HDR where applicable, subject to the explicitly defined encoding policy.
6. Never overwrite originals or silently discard failed, skipped, or unsaved work.
7. Work offline on macOS first, including fonts and emoji, using a shared codebase
   for a later Windows release.
8. Reuse text, formatting, and relative layout across a batch and optionally on
   later imports, without overwriting existing per-video text.

This document defines the full product scope. The current single-video proof and
its validation limits are recorded in the implementation plan; later milestones
remain subject to separate approval.

## 2. Confirmed product decisions

| Area                 | Confirmed requirement                                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Platforms            | macOS 15+ on Apple silicon; Windows preview: Windows 10 and 11 on Intel x64 PCs                                   |
| Development approach | Shared cross-platform codebase, with separate packages and necessary OS-specific integrations                     |
| Processing           | Entirely local; no uploading videos to servers                                                                    |
| Multiple videos      | Independent editing jobs; never combined                                                                          |
| Typical batch        | Usually matching aspect ratios; different resolutions and mixed aspect ratios remain supported                    |
| Apply to All         | Fill other videos without text using independent copies of the active text, formatting, and relative layout       |
| Existing text        | Preserve existing non-empty text and its per-video formatting/layout                                              |
| Copy scaling         | Scale proportionally for matching aspect ratios; use relative placement/sizing for mixed ratios, accepting reflow |
| Later imports        | Inherit the last-applied copy automatically, with an option to turn this off                                      |
| Batch undo           | One immediate Undo reverses Apply to All, including its new-import default                                        |
| Editor               | Display one active video at a time                                                                                |
| Text count           | At most one text box per video                                                                                    |
| Text timing          | Visible for the video's entire duration                                                                           |
| Creation             | Clicking the video creates a text box if none exists                                                              |
| Selection            | If a box exists, clicking anywhere on the video selects it                                                        |
| Editing              | Double-click the text box to edit its contents                                                                    |
| Movement             | Drag the entire text box to reposition it                                                                         |
| Resizing             | All eight handles resize the box, not the font                                                                    |
| Wrapping             | Text wraps as width changes                                                                                       |
| Height               | Enforce a text-fit minimum height; grow the box when necessary                                                    |
| Frame edges          | Allow off-frame placement; crop off-frame content                                                                 |
| Formatting           | Font family, size, colour, bold, italic, left/centre/right alignment                                              |
| Style scope          | One consistent style for the entire text box                                                                      |
| Fonts                | Curated bundled fonts, identical on both platforms                                                                |
| Characters           | English/Latin text, numbers, punctuation, and emoji                                                               |
| Preview              | Fast, low-quality, fit-to-window preview; no zoom controls                                                        |
| Output               | High-quality MP4; preserve source dimensions, timing, duration, and audio                                         |
| SDR output           | Retain H.264/HEVC for 8-bit sources; Main10 HEVC for 10-bit; AAC audio                                              |
| HDR output           | Standard HDR using 10-bit HEVC and appropriate HLG/PQ signalling                                                  |
| Dolby Vision         | Exact Dolby Vision metadata preservation is not required                                                          |
| Export scope         | Current, checked videos, or all imported videos                                                                   |
| Empty text           | Skip missing/empty text and list skipped videos before export                                                     |
| Export editing       | Finish or cancel export before making further edits                                                               |
| Cancellation         | Visible Cancel Export action                                                                                      |
| Batch failures       | Continue remaining videos; report failures and allow retry                                                        |
| Destination          | One chosen output folder per operation; remember the last folder                                                  |
| Filenames            | Safe automatic names; never overwrite existing files                                                              |
| Persistence          | Automatically restore the last workspace                                                                          |
| Tested workload      | 30 mixed videos, mostly reels; individual videos up to 4K/60 fps/30 minutes                                       |
| Layout               | Three columns: videos left, preview centre, properties right                                                      |
| Appearance           | Dark interface only                                                                                               |

## 3. Approved defaults

These details were proposed during discovery and accepted with full PRD approval
on 2026-11-17. Performance targets still require measurement, and the planned
implementation-time feasibility gates are not waived by approval.

| Topic                     | Proposed default                                                                                                                                          |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Font collection           | Noto Sans and Noto Serif, with regular/bold/italic/bold-italic faces; bundled Noto colour emoji fallback                                                  |
| Emoji styling             | Emoji retain their intrinsic colours; text colour and bold/italic affect ordinary text                                                                    |
| Font-size units           | Output-video pixels, independent of preview scale                                                                                                         |
| Initial text style        | Noto Sans Regular, white `#FFFFFF`, left aligned                                                                                                          |
| Initial size              | Round `48 * orientedVideoHeight / 1080` to a whole video pixel                                                                                            |
| Initial box               | Width 60% of oriented video width; height fits one line; creation click anchors its top-left corner                                                       |
| Text padding              | Internal padding scales from 8 video pixels per side at a 1080-pixel video height                                                                         |
| New imports               | Append in import order, unchecked for batch export; inherit the saved text default when enabled; open the first video if none is active                   |
| Duplicate imports         | Do not add an identical already-imported source again; show a notice                                                                                      |
| Preview budget            | Low-resolution video, initially targeting at most 720 pixels on its long edge and 15 displayed frames/second                                              |
| HDR preview               | Tone-mapped SDR placement preview, clearly labelled; no native HDR preview mode                                                                           |
| Export execution          | One video at a time to limit resource usage                                                                                                               |
| Export setup              | One Export workflow; no separate Build button                                                                                                             |
| Workspace storage         | Save source references, editing metadata, and the detached last-applied text default/settings, not copies of original videos                              |
| Interrupted exports       | Do not resume automatically after relaunch; identify interrupted work and allow a fresh export                                                            |
| Undo                      | Per-video, current-session edit history, with the confirmed immediate Apply to All group-undo exception; restoring history after relaunch is not required |
| Mixed-ratio copy mapping  | Scale X/box width by video width; Y/box height/font size/padding by video height; reflow and enforce the minimum text-fit height                          |
| Empty targets for copying | Missing box, empty string, or whitespace-only text, consistent with export eligibility; an empty box's style is replaced by the copied style              |
| Window sizing             | Sidebars 240/280 logical pixels; minimum window 1100 x 700; initial size up to 1440 x 900 within available desktop space                                  |

## 4. Scope and non-goals

### Included

- Local multi-file import, drag-and-drop import, and video selection.
- One full-duration, uniformly styled text box per video.
- Direct text editing, wrapping, movement, resizing, and deletion.
- Apply to All for videos without text and an optional reusable default for new imports.
- Basic playback, seeking, and preview-only muting.
- Numeric positioning and dimensions, centring, and Undo/Redo.
- Current-video and batch rendering/export.
- Autosave, workspace restoration, missing-file recovery, and explicit errors.

### Excluded from version 1

- Combining clips, multi-track timelines, trimming, splitting, cropping the video,
  transitions, speed changes, filters, and colour grading.
- Multiple text boxes, grouping, layers, rich per-word styling, text rotation,
  animation, timed text, automatic captions, and transcription.
- Live-linked text edits across videos and bulk replacement of existing non-empty text.
- Text backgrounds, shadows, outlines, opacity controls, and custom font imports.
- Zoom/pan controls, snapping, alignment guides, and editable aspect ratios.
- Audio editing, music libraries, recording, and changing export audio through
  preview controls.
- Accounts, cloud storage/rendering, collaboration, and social-media publishing.
- Named project files, portable project packages, and source-media duplication.
- Intel Macs, Windows ARM, 32-bit Windows, mobile devices, and web-browser clients.
- Exact Dolby Vision preservation, true HDR preview, and user-facing encoder settings.
- Signed Windows installers, automatic updates and release certification are
  separate from the authorized unsigned portable Windows preview.

## 5. Primary user journey

1. Launch the app; restore the last workspace, if available.
2. Import videos or drop them into the app; inherit the saved text default if enabled.
3. Open a video by clicking its row.
4. If it has no text box, click the video to create one and start typing.
5. Move the box, resize its bounds, or adjust formatting in the right panel.
6. Optionally use Apply to All to fill other videos without text and save the
   current text/layout as the default for later imports.
7. Switch videos; copied text is already visible. Play or seek to check placement,
   adjust an individual copy if needed, and retain all other videos' edits.
8. Export Current, Export Checked, or Export All.
9. Review eligible and skipped videos and choose the output folder.
10. Start export; view progress, finish, or cancel before editing again.
11. Review completed/failed/cancelled results and retry failures if needed.

## 6. Functional requirements

### FR-01: Import and collection management

- Accept local `.mp4` and `.mov` files containing H.264 or HEVC video, including
  supported iPhone HDR footage.
- Support multi-file selection through the operating system file picker.
- Support dropping multiple files onto the empty workspace or the video list.
- Keep imported videos independent; never append one source to another.
- Validate the actual media streams, not just filename extensions.
- Probe and generate thumbnails without blocking UI interaction.
- Import valid files even if other files in the same selection are unsupported.
- Provide a per-file import-error summary for corrupt, unreadable, unsupported,
  or inaccessible media. Do not silently drop files.
- Support portrait, landscape, square, and source rotation/display metadata.
- For multiple video streams, use the primary playable picture stream; auxiliary
  depth or thumbnail streams are not editing targets.
- Do not alter, move, or delete source media.
- A row remove action removes only that workspace entry and its edits. Confirm
  removal when it would discard non-empty text.
- Provide Clear Workspace with confirmation, explicitly stating that source
  files and completed exports remain on disk. Also clear the saved text default
  and turn automatic inheritance off for the new workspace.
- Duplicate-source detection must preserve the existing entry and edits, with
  an explicit already-imported notice.

### FR-02: Active video and export selection

- Exactly one video is active in the editor.
- Clicking a row activates it without changing its export checkbox.
- Toggling a checkbox changes export membership without activating that video.
- Select All has unchecked, checked, and partially checked states.
- New entries are unchecked; users can use Export All without checking each row.
- Preserve edits immediately when switching videos; never require Apply or Save
  to retain an individual video's edits. Apply to All is a separate copy action.
- Opening a video shows its stored text immediately, including any inherited copy.
  Navigation alone never reapplies a default or recreates deliberately deleted text.
- Pause the previous video and restore the next video's saved playback position
  in a paused state. The first opening starts at the beginning.
- An exported video may be edited and exported again; it is not permanently locked.

### FR-03: Coordinates and preview fidelity

- Define geometry in oriented video pixels: origin at the displayed video's
  top-left, positive X rightwards and positive Y downwards.
- Apply source rotation/display orientation before interpreting text coordinates.
- Fit the complete video into the central preview without changing its aspect ratio.
- Map all text geometry through one consistent video-to-preview transform.
- Window resizing must not alter stored geometry, font size, or wrapping.
- Compute text layout using the source-space box dimensions, not the low-resolution
  preview's pixel dimensions.
- Text content is clipped to the video frame; selection decorations may extend
  into the surrounding preview area.
- Allow negative X/Y, partial off-frame text, and entirely off-frame text.
- Centre in Video must recover an off-frame box without changing its style,
  dimensions, or font size.
- Selection borders, handles, caret, placeholders, and delete controls must never
  appear in exports.

### FR-04: Creation, selection, and editing

- If no box exists, a single click within the video creates one at that location,
  pauses playback, and focuses an insertion caret.
- The new box is initially empty. A placeholder such as "Enter text" is UI only,
  never actual exported content.
- Provide Add Text in the empty properties panel as an accessible alternative;
  it creates the box centred on the video and begins typing.
- If a box already exists, clicking anywhere within the video selects that box.
  It does not create another box and does not move the existing box.
- Double-clicking the text box enters direct text-editing mode.
- While editing, ordinary clicks position the caret and normal text-selection
  gestures operate on characters.
- Support typing, plain-text paste, selection, cut/copy, numbers, punctuation,
  manual newlines, and supported emoji sequences.
- Enter inserts a newline. Escape or Cmd/Ctrl+Enter ends editing and retains changes.
- Clicking a property control commits the current text buffer and applies that
  control to the entire box.
- Clicking outside the video in unused workspace space ends editing/deselects.
  Returning to the video selects the existing box again.
- Whitespace-only content is considered empty for export, but ordinary content
  retains intentional whitespace and manual newlines.

### FR-05: Moving, resizing, and text fit

- In object-selection mode, dragging the box body or border moves the whole box.
  Dragging characters while in text-editing mode selects characters instead.
- Show eight handles: four corners and the midpoint of each side.
- Handles change box width/height only. Never change font size or stretch glyphs.
- Horizontal resizing reflows text; vertical resizing changes available box space.
- Keep text top-aligned within the box; horizontal alignment is configurable.
- Permit extra blank space below the text, but not a height smaller than the
  wrapped text and internal padding require.
- Grow height when typing, changing fonts/sizes, or narrowing the box requires it.
  Automatic growth keeps the top-left fixed unless an active resize anchor
  requires the opposite edge to remain fixed.
- Stop drag-based shrinking at the text-fit minimum. For invalid numeric height
  entries, display the required minimum and retain the previous valid geometry.
- Wrap long unbroken text at valid character/grapheme boundaries. Never split an
  emoji sequence or combining-character sequence into separate visible fragments.
- Preserve font size during automatic height changes.
- The text-fit rule applies to the box, not the video: content outside the video
  is intentionally cropped, even when it fits inside the box.
- Show appropriate move, resize, and text-edit cursors.
- One continuous drag/resize is one undoable edit, including resulting auto-fit.

### FR-06: Formatting

- Apply one font family, size, colour, bold state, italic state, and alignment to
  the entire box.
- Offer bundled Noto Sans and Noto Serif with the necessary style faces.
- Use bundled emoji resources consistently on both platforms; do not rely on
  platform-specific emoji appearances or online assets.
- Support normal, bold, italic, and bold-italic text.
- Provide font sizes in video pixels, with a 1-pixel minimum, 1-pixel steppers,
  and numeric entry supporting one decimal place.
- Display and reject invalid/non-finite values explicitly. Do not silently
  substitute another font or numeric value when input is unsupported.
- Support an opaque text colour using a picker and `#RRGGBB` entry.
- Emoji retain intrinsic colours; colour controls do not recolour colour emoji.
- Offer left, centre, and right alignment; default to left.
- Font/style changes remeasure wrapping and minimum height immediately.
- Warn on unsupported glyphs rather than silently exporting missing-glyph boxes.
  Required English text and bundled emoji must work offline.
- Show missing font/resource failures explicitly; never silently use system fonts.

### FR-07: Deletion, recovery, and Undo/Redo

- On text-box hover, show a delete button outside its top-right corner.
- Keep that button usable while moving the pointer from the box onto it, and
  expose it on keyboard focus/selection as appropriate.
- Also provide a persistent Delete Text button in the properties panel.
- In object-selection mode, Delete/Backspace deletes the box; in text-editing
  mode those keys delete characters.
- Deletion removes the text box, not the source video.
- After deletion, the next click on the video creates a new box.
- Provide per-video Undo/Redo for creation, content changes, formatting, movement,
  resizing, centring, and deletion.
- Text auto-fit changes are part of the edit that caused them.
- Import/removal, export checkbox changes, playback, and seeking are not text edits.
- Undo/Redo normally affects the active video only. The immediate Apply to All
  exception reverses/redoes that batch as one operation, as defined in FR-13.
  Histories remain session-local.
- Retain at most 100 steps or 16 MiB of estimated snapshots across Undo, Redo and
  the pending edit, whichever limit is reached first. Discard older history, not
  the current text; an individual oversized edit may not be undoable.

### FR-08: Speed-first preview and playback

- Use a low-quality, downscaled preview; high-resolution preview is not a goal.
- Initial preview budget: at most 720 pixels on the long edge and 15 displayed
  frames/second. Adapt downward if needed to keep interaction responsive.
- Do not wait for a complete full-video proxy transcode before allowing text editing.
- Decode/downscale frames on demand or use an equivalent progressive approach.
- Keep text readable and its source-space position, size, and wrapping accurate.
- Pause playback when beginning a text operation.
- Provide Play/Pause, seeking, elapsed/total time, and preview-only Mute.
- Preview playback follows the original timeline at normal speed even if preview
  frames are dropped; do not export dropped frames.
- Maintain preview audio/video synchronization. Preview Mute never changes exports.
- Use a tone-mapped SDR preview for HDR sources and label it
  "SDR preview; HDR export". No native HDR preview mode is required.
- No preview quality selector, zoom, panning, full editing timeline, or export
  resolution adjustment is included.

### FR-09: Export eligibility and preflight

- Provide Export Current, Export Checked, and Export All.
- Export scope is independent of which video is open.
- Render one output per eligible source; never combine sources.
- Before rendering, list videos to export and videos skipped, with explicit reasons.
- Missing boxes, empty strings, and whitespace-only text are skipped.
- Identify unavailable sources and other blocking per-file problems separately;
  never present them as successfully exported.
- If no eligible video remains, disable Start Export and explain how to proceed.
- Display each eligible video's output filename and automatic SDR/HDR format.
- Choose one output folder for the operation; remember it for next time and allow
  changing it before every export.
- Validate destination access and report insufficient resources explicitly.
- Starting export commits pending text edits and captures a stable job definition.
- Disable workspace mutations, including text changes, imports/removal, and batch
  selection changes, until the operation completes or cancellation has finished.
  This includes Apply to All and changes to the new-import text default.

### FR-10: Rendering and output

- Fully render text into the exported video; playback must not need the editor,
  external fonts, or a sidecar text file.
- Do not render a full-resolution edited copy after each keystroke. Final
  full-resolution compositing occurs during Export.
- Eight-bit SDR sources preserve H.264 or HEVC in high-quality MP4. Supported 10-bit SDR
  sources produce Main10 HEVC MP4 without reducing their precision. Unsupported
  SDR bit depths/chroma formats fail explicitly instead of being silently reduced.
- HDR sources produce MP4 with 10-bit HEVC, appropriate HLG/PQ transfer, colour
  primaries, and HDR signalling. Do not silently downgrade HDR to SDR.
- Dolby Vision input may be rendered to suitable standard HLG/PQ HDR. Retaining
  Dolby Vision-specific dynamic metadata is not required.
- Apply text in the correct colour space without making it unintentionally
  peak-bright in HDR. The SDR preview is a placement approximation, not an HDR
  brightness reference.
- Match source display resolution, orientation, aspect ratio, video timeline,
  frame rate/timestamps, duration, and soundtrack.
- Preserve variable frame timing rather than silently converting it to a fixed rate.
- Preserve source audio streams and synchronization, re-encoding to AAC as needed.
  Copy compatible AAC streams unchanged instead of recompressing them.
  Silent sources remain silent. Do not silently drop unsupported audio.
- Do not silently downmix or discard audio channels; report incompatible cases.
- No trimming, speed change, automatic crop, forced downscaling, or watermark.
- Re-encoding is expected; lossless, byte-identical output and a particular output
  file size are not promised.
- Use an automatic balanced, source-aware high-quality export preset internally.
  The user approved preserving HEVC and selected balanced size/quality on
  2026-11-18: aim around 1.5 times the original size, accepting small re-encoding
  differences rather than arbitrarily large exports. This is a target, not a
  size guarantee; do not reduce resolution/frame rate to reach it.
  Do not expose bitrate,
  quality, frame-rate, codec, or resolution settings.
- Write to a tracked temporary output and publish the final `.mp4` only after
  successful completion and validation.
- Use `<source>_edited.mp4`; on collision use `_edited_2`, `_edited_3`, etc.
  Handle duplicate source basenames and files created after preflight safely.
- Never overwrite originals or completed files. Results show the actual saved path.

### FR-11: Queue, progress, failure, and cancellation

- Process eligible videos sequentially, with per-video and overall progress.
- Show queued, exporting, completed, failed, cancelled, and preflight-skipped
  outcomes distinctly. Progress is media processed, not a guaranteed time estimate.
- Do not show successful completion until the output file has been finalized.
- An individual render failure must not stop other queued videos.
- Show an actionable per-file error and preserve successful outputs.
- Provide Retry Failed; it reopens preflight using the affected videos' current
  edits and does not rerender successful videos.
- A visible Cancel Export stops the active job and cancels jobs not yet started.
- Show "Stopping export" while cancellation is in progress; do not immediately
  claim cancellation or re-enable editing while a renderer is still writing.
- Keep completed files. Remove tracked incomplete temporary outputs.
- If temporary cleanup fails, show the error and exact path; never report clean
  cancellation when cleanup is unresolved. Editing may resume after all writers
  have stopped, with the cleanup warning still visible.
- A close/quit request during rendering offers Continue Export or Cancel and Quit.
  Safely cancel and save work before completing a confirmed quit.
- After a crash/relaunch, mark interrupted work explicitly. Do not automatically
  restart rendering or count incomplete files as completed.

### FR-12: Autosave, restoration, and source recovery

- Save the video collection/order, active video, export checkboxes, text/style/
  geometry, playback positions, and last output folder locally.
- Save the detached last-applied text snapshot, its reference video dimensions,
  and the automatic-new-import setting. Removing its original source entry must
  not invalidate this saved default.
- Store source references, not source-media copies.
- Autosave committed changes within one second under normal writable-disk conditions.
  Flush pending work on clean close and before starting export.
- Show Saving, Saved Locally, or Save Failed truthfully.
- Use recoverable/atomic workspace writes; do not replace a valid workspace with
  partially written data.
- On relaunch, restore work paused; never autoplay. Restore independent copies
  exactly as saved, including later edits/deletions; do not reapply the default
  to existing entries during restoration.
- If a source is missing, preserve its edits and show Locate File and Remove
  from Workspace. Do not silently delete the entry.
- Verify media identity when relinking. Reject a mismatched replacement explicitly
  instead of applying old coordinates to unrelated content.
- If storage fails, preserve in-memory work and show persistent Retry Save and
  loss-risk information. Do not display Saved Locally.
- If restoration fails, report it and offer recoverable/reset actions without
  silently overwriting the failed workspace.

### FR-13: Apply to All and automatic text inheritance

#### Source, targets, and independent copies

- Provide Apply to All when the active video has a valid, non-empty text box.
  Commit pending typing before capturing the source.
- Capture content, font family, size, colour, bold/italic, alignment, box geometry,
  padding, and the source video's oriented dimensions.
- Fill every other imported video without text, regardless of its export checkbox.
  Keep the source video unchanged.
- Missing boxes, empty strings, and whitespace-only content are eligible. An
  eligible empty box receives the copied formatting/layout, not its previous style.
- Preserve every target with existing non-empty text, including previous copies
  and manually customised layouts. Never silently replace them.
- Create independent per-video boxes, not links. Later edits/deletions on one
  video do not update any other video or the saved new-import default.
- Populate copies as part of the action, not lazily when a video is opened.
  The next video already shows its copy and can be played/checked immediately.
- Copies remain visible for each target's full duration. Applying text does not
  render an output file or modify source media.
- Repeating Apply to All fills only newly eligible videos and refreshes the saved
  default from the active video; it does not refresh existing non-empty copies.

#### Relative placement and sizing

- Use oriented source/target video dimensions, never preview dimensions.
- Matching aspect ratios must produce the same relative position, box dimensions,
  font size, padding, formatting, and line wrapping at different resolutions.
  For example, 1080 x 1920 to 2160 x 3840 doubles pixel geometry and font size.
- Mixed aspect ratios are also targets. Use the proposed mapping below; wrapping
  may change and users may adjust each independent copy after checking playback.

```text
widthRatio  = targetVideoWidth  / sourceVideoWidth
heightRatio = targetVideoHeight / sourceVideoHeight

targetX         = sourceX         * widthRatio
targetY         = sourceY         * heightRatio
targetBoxWidth  = sourceBoxWidth  * widthRatio
targetBoxHeight = sourceBoxHeight * heightRatio
targetFontSize  = sourceFontSize  * heightRatio
targetPadding   = sourcePadding   * heightRatio
```

- Scale font size uniformly; never stretch glyphs horizontally or vertically.
  Preserve content, family, colour, bold/italic, and alignment.
- Reflow at the target width, then grow height to the required text-fit minimum
  if it exceeds the mapped height. Never shrink the font to force a fit.
- Preserve negative/off-frame relative placement; video-frame cropping still
  applies. Never change a video's resolution or aspect ratio to fit the text.
- Preserve canonical calculation precision; formatting a numeric field for
  display must not round stored values or trigger reflow.
- This transfer-time font scaling is distinct from manual handle resizing,
  which still never changes font size.
- Report mixed-ratio copies as needing visual review because wrapping may differ.
  Include coded-pixel/pixel-shape differences even when display aspect ratios match.

#### Default for later imports

- Save a detached snapshot whenever Apply to All succeeds, even if there are no
  empty target videos. Report this accurately as a default update, not as filled videos.
- The first successful use enables Auto-apply to New Imports. Later uses refresh
  the snapshot but respect the user's current on/off setting.
- Provide a visible switch/checkbox to disable or re-enable inheritance.
- Turning it off leaves existing copies untouched. Turning it back on affects
  future imports only; neither action fills existing empty entries.
- When enabled, each newly imported valid video receives an independent copy of
  the last-applied snapshot using the same relative mapping and text-fit rules.
- Editing the original source or another copy does not refresh this snapshot.
  Use Apply to All explicitly to choose a new default.
- Duplicate/rejected imports are not new entries and must not overwrite existing
  workspace edits through automatic inheritance.
- Clearly show when no default has been saved; disable the inheritance checkbox
  until the first valid snapshot exists.
- Deleting text and later viewing/relaunching that video must not refill it.
  Only a later explicit Apply to All can fill that existing empty entry again.

#### Undo, feedback, and errors

- Treat each Apply to All as one immediate group-undo operation: restore affected
  videos, their prior undo histories, the previous saved default, and its on/off setting.
  Do not undo the source edit that preceded the application.
- Selection, navigation, playback, seeking, export checkbox changes, and autosave
  do not consume this opportunity. Immediate Redo reapplies the same group.
- A subsequent text edit, another Apply to All, a default-setting change, or
  importing/removing videos ends that immediate group-undo opportunity.
  Ordinary per-video undo then applies without discarding unrelated later work.
- Retain each successful copied-box change in its target's per-video history so
  it can still be undone independently after the group opportunity ends.
- Auto-inherited text on a newly imported video is independently undoable;
  undoing it does not remove the imported video or change other copies.
- Show counts of filled videos and preserved existing-text videos, separately
  identify the unchanged source, and report any copy errors per file.
- If an item cannot receive a valid copy, preserve its prior state and report the
  failure; never count it as filled. Group Undo covers only changes actually made.
- Save the operation's copies and default/settings coherently. Disable the action
  and inheritance-setting changes during export.

## 7. UI layout and component placement

### 7.1 Main window

All dimensions below are logical display pixels, not video pixels. Preserve native
window controls on each operating system. There is no custom mobile layout.

```text
+--------------------------------------------------------------------------+
| Native title bar: Video Text Editor                                      |
+--------------------------------------------------------------------------+
| Import Videos  Undo Redo    Saved Locally    Export Current  Export Batch |
+------------------+-----------------------------------+-------------------+
| Videos (30)  ... | Filename / dimensions / fps / HDR  | Text              |
| Select All       +-----------------------------------+ Font family       |
|                  |                                   | Size     B  I     |
| [ ] thumb name   |        Fitted video preview       | Colour / HEX      |
|     time status  |                                   | Alignment         |
| [x] thumb name   |      One editable text box        | Position & Size   |
|     time status  |                                   | X / Y / W / H     |
| ... scroll ...   |                                   | Apply to All      |
|                  |                                   | [x] New imports   |
|                  |                                   | Applied / Undo    |
|                  +-----------------------------------+ Centre in Video   |
|                  | Play  time -- scrubber -- Mute    | Delete Text       |
+------------------+-----------------------------------+-------------------+
```

- Main toolbar: 56 pixels high below native window chrome.
- Left sidebar: 240 pixels wide; right panel: 280 pixels wide.
- Centre expands to remaining space; sidebars stay fixed-width.
- Minimum window: 1100 x 700; initial size up to 1440 x 900, bounded by the desktop.
- Vertical separators distinguish the three columns; no resizable splitters.
- Lists and the property content scroll independently when necessary.
- Preserve a visible gutter around the fitted video for selection controls.

### 7.2 Main-screen component inventory

| ID    | Component and placement                                       | Interaction and states                                                                                                                                    |
| ----- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI-01 | Import Videos, toolbar far left                               | Opens native multi-file picker; disabled during export                                                                                                    |
| UI-02 | Undo/Redo, immediately after Import                           | Normally active-video history; immediately after Apply to All, act on the whole group with explicit tooltips; disabled when unavailable or exporting      |
| UI-03 | Save status, toolbar centre                                   | Saving / Saved Locally / Save Failed; failure has persistent retry feedback                                                                               |
| UI-04 | Export Current, toolbar right                                 | Opens current-video preflight; disabled when no active source                                                                                             |
| UI-05 | Export Batch menu, toolbar far right                          | Export Checked with count, and Export All with count; unavailable scopes disabled                                                                         |
| UI-06 | Videos header, top of left sidebar                            | Collection count; overflow menu contains Clear Workspace                                                                                                  |
| UI-07 | Select All row, below sidebar header                          | Tri-state checkbox plus checked count; does not open a video                                                                                              |
| UI-08 | Video rows, scrollable sidebar body                           | Approximately 72 pixels tall; checkbox, thumbnail, filename, duration, status                                                                             |
| UI-09 | Row active highlight                                          | Clicking row opens it; highlight is distinct from checkbox state                                                                                          |
| UI-10 | Row remove button, row right edge                             | Visible on hover/focus; workspace-only removal; explanatory tooltip and confirmation when needed                                                          |
| UI-11 | Preview header, top of centre                                 | Active filename, oriented dimensions, source frame rate, HDR badge where relevant; full filename available on hover/focus                                 |
| UI-12 | Video preview, centre body                                    | Aspect-fit, low-quality video with source-accurate text overlay; no zoom controls                                                                         |
| UI-13 | Empty-text hint, on preview                                   | "Click anywhere on the video to add text"; UI-only, hidden once a box exists                                                                              |
| UI-14 | Text outline and eight handles                                | Visible when selected; handles at corners/side midpoints; proper resize cursors                                                                           |
| UI-15 | Floating Delete, outside box top-right                        | Appears on box hover/focus/selection; stays clickable when pointer enters it; never exported                                                              |
| UI-16 | Playback strip, directly below preview                        | Play/Pause left, elapsed time, flexible scrubber, total duration, preview Mute right                                                                      |
| UI-17 | Text panel title, top right                                   | Identifies active-video properties; separates the batch-application section from individual formatting                                                    |
| UI-18 | Font family dropdown, first property                          | Bundled families only; sample styling; ordinary keyboard dropdown behavior                                                                                |
| UI-19 | Font size field, next row                                     | Video-pixel label and steppers; inline numeric validation                                                                                                 |
| UI-20 | Bold/Italic, beside size                                      | Independent toggles; active states announced and visibly distinct                                                                                         |
| UI-21 | Colour row, below style                                       | Swatch opens picker; adjacent HEX field edits the same opaque colour                                                                                      |
| UI-22 | Colour popup, anchored to swatch                              | Saturation/value area, hue control, and preset swatches; no alpha control; changes apply live                                                             |
| UI-23 | Alignment row                                                 | Three labelled/accessible left/centre/right buttons; one active                                                                                           |
| UI-24 | Position & Size section                                       | Two-column X/Y then Width/Height numeric fields; units in video pixels; minimum-height errors inline                                                      |
| UI-41 | Apply to All, below Position & Size and above Centre in Video | Copies active text to empty videos immediately; helper says existing text is kept; disabled without valid non-empty source text or during export          |
| UI-42 | Auto-apply to New Imports, directly below Apply to All        | Checkbox and last-applied-default explanation; initially disabled until a snapshot exists; on/off does not change existing videos; disabled during export |
| UI-43 | Batch-copy feedback, below inheritance checkbox               | Filled/preserved counts, source identification, mixed-ratio review note, per-file errors, and immediate Undo Apply to All action while available          |
| UI-25 | Centre in Video, lower right panel                            | Centres existing box; preserves dimensions and style; undoable                                                                                            |
| UI-26 | Delete Text, right-panel bottom                               | Persistent alternative to hover deletion; disabled if no box or during export                                                                             |
| UI-27 | Empty text-panel state                                        | Formatting fields disabled; explanation and Add Text button to create a centred box                                                                       |
| UI-28 | Error/recovery banner, below toolbar                          | Persistent actionable save/restore/resource errors; never only a colour change                                                                            |
| UI-29 | Empty workspace, centre body                                  | Drop zone, supported-format explanation, and Import Videos action; export/playback disabled                                                               |

### 7.3 Video-row states

- Needs Text: no box or empty content.
- Ready: non-empty text, valid available source.
- Exporting: active job, with progress.
- Exported: output completed for the current edit revision.
- Changed Since Export: edits no longer match the last completed output.
- Failed: last export failed; details accessible from results.
- Missing Source: source cannot be accessed; Locate action available.

An icon or colour can reinforce these labels, but cannot replace the text.

### 7.4 Export and recovery dialogs

| ID    | Dialog and placement                        | Components and behavior                                                                                                                                              |
| ----- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI-30 | Export preflight, centred modal             | Scope/count; read-only list of outputs and formats; skipped/unavailable list with reasons; output folder with Choose Folder; Cancel and Start Export at bottom right |
| UI-31 | Export progress, centred modal              | Current filename, per-file progress, total progress/counts, scrollable job statuses, visible Cancel Export; workspace mutations disabled                             |
| UI-32 | Cancelling state, progress modal            | "Stopping export"; cancellation action disabled against repeat clicks; completed outputs remain listed                                                               |
| UI-33 | Export results, centred modal               | Success/failure/cancel/skip counts, actual output paths, per-file errors, Retry Failed, Show Output Folder, Done                                                     |
| UI-34 | Import summary, centred when errors occur   | Rejected filenames and actionable reasons; successfully imported files remain available                                                                              |
| UI-35 | Missing source, central preview placeholder | Locate File and Remove from Workspace; preserves saved text and metadata                                                                                             |
| UI-36 | Relink picker and validation                | Native file picker followed by identity validation; mismatch error without discarding the old reference                                                              |
| UI-37 | Remove/Clear confirmation, centred modal    | Describes discarded workspace edits; explicitly says source media and exports are not deleted; Cancel is safe default                                                |
| UI-38 | Quit-during-export confirmation             | Continue Export or Cancel and Quit; never abandon a writer silently                                                                                                  |
| UI-39 | Save-failure close confirmation             | Retry Save, Cancel Close, or explicit Quit Without Saving with loss warning                                                                                          |
| UI-40 | Restore/recovery state                      | Loading indicator, recovery/error explanation, and confirmed reset only when necessary                                                                               |

In preflight, Start Export is disabled if the destination is invalid or no eligible
video remains. A skip summary must be visible before any rendering starts.
Progress closes into results only after writers have stopped and outputs are finalized.

### 7.5 Keyboard, focus, and hit testing

| Input                                                 | Result                                                                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Cmd/Ctrl+Z                                            | Undo active video's edit, or the whole immediate Apply to All group while that opportunity is available |
| Cmd+Shift+Z; Ctrl+Y or Ctrl+Shift+Z                   | Redo using platform conventions, including the immediate Apply to All group                             |
| Arrow keys, selected box outside text entry           | Move one video pixel                                                                                    |
| Shift+Arrow, selected box outside text entry          | Move ten video pixels                                                                                   |
| Delete/Backspace, selected box outside text entry     | Delete box                                                                                              |
| Enter, inside text editing                            | Insert newline                                                                                          |
| Escape or Cmd/Ctrl+Enter, inside text editing         | Commit/end text editing                                                                                 |
| Space, when not typing or operating a focused control | Play/Pause preview                                                                                      |
| Tab/Shift+Tab                                         | Traverse visible interactive controls logically                                                         |

- In numeric/text inputs, preserve normal editing keys instead of intercepting
  them for playback, deletion, or movement.
- Pointer priority is delete button, resize handle, box body, then video background.
- Use visible keyboard focus and accessible labels for icon-only buttons.
- Standard buttons should have at least 32 x 32 logical-pixel hit areas.
- Small visual resize handles need generous hit areas; numeric geometry fields
  provide a reliable non-drag alternative when handles are crowded.
- Hover-only actions must also be reachable by focus or persistent controls.

### 7.6 Appearance

- Dark neutral surfaces, subtle dividers, readable text, and a distinct active accent.
- Standard UI text contrast at least 4.5:1; essential component/focus contrast at
  least 3:1. State is never communicated by colour alone.
- These are UI accessibility requirements, not automatic changes to a user's
  chosen video-text colour.
- Keep invalid-field messages beside the relevant control and announce important
  errors/progress state changes accessibly.
- Do not tint, darken, or decorate the exported media to match the editor theme.

## 8. Processing, privacy, and reliability

- All core features, rendering, fonts, emoji, workspace storage, and recovery work
  without an internet connection.
- No account, media upload, cloud renderer, online font fetch, or automatic
  diagnostic upload is part of version 1.
- Bundle required runtime resources; do not require users to install a separate
  encoder, font package, or command-line tool.
- Include applicable font and dependency licences in the distributed application.
- Decode and render incrementally; never load entire videos or all 30 decoders
  into memory at once.
- Keep the UI event loop responsive during probing, thumbnailing, rendering,
  cancellation, and cleanup.
- Track temporary files explicitly and delete only files the app created.
- Never suppress an error by claiming a successful import, save, export, or cleanup.
- Errors identify the affected file and offer an appropriate next action:
  retry, locate source, choose another folder, edit text, or dismiss.
- The shared framework and visual direction in [the design document](./DESIGN.md)
  are approved for planning. Candidate text/media components still require the
  planned implementation-time feasibility checks.
- After implementation is explicitly authorized, validate HDR output, emoji,
  preview speed, and preview/export layout fidelity before committing to the
  rendering approach. Any necessary reduction in capability requires a PRD
  change, not a silent fallback.

## 9. Workload and performance acceptance targets

### Supported validation workload

- 30 imported videos and a 30-item export selection.
- Mostly short reels, usually sharing an aspect ratio, with mixed duration and
  resolution. Also include mixed-aspect-ratio batches for relative text transfer.
- Include an individual 30-minute UHD 4K/60 fps source and shorter portrait reels;
  the workload does not assume all 30 videos are 30-minute 4K sources.
- Include SDR H.264, SDR HEVC, HDR HLG/PQ, supported iPhone HDR, silent clips,
  audio-bearing clips, rotation metadata, and variable-frame-rate examples.
- 30 videos and the individual-video profile are test targets, not silent hard
  count/file-size limits. Larger workloads are not guaranteed and resource
  failures must be explicit.

### Proposed measurable targets

For the first release, benchmark local SSD media on an Apple-silicon Mac with
16 GB RAM. For the Windows release, test Windows 10 and 11 x64 PCs with 16 GB RAM
and a modern six-core CPU. Record exact machines during implementation; these
are benchmark references, not an added CPU-family promise. Windows validation
is a gate for the Windows release, not a prerequisite for delivering macOS.

The Windows preview uses CPU H.264/HEVC encoders for broad Intel x64 compatibility,
including Main10 HDR; real-time export is not promised. The approved Windows
FFmpeg build is GPL-2.0-or-later, with the corresponding x264/x265/zlib and FFmpeg
source, build recipe and license notices included. The Mac build remains LGPL-only.
Windows Server CI is an automation environment, not client-OS/HDR certification.

| Measure                                            | Acceptance target                                                                         |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Paused-preview text manipulation                   | 95th-percentile visible feedback within 100 ms                                            |
| First editable preview after metadata is available | Within 2 seconds on reference hardware                                                    |
| Seeking to a requested placement frame             | 95th percentile within 1 second                                                           |
| Cancel acknowledgement                             | Visible cancelling state within 250 ms                                                    |
| Renderer stop after cancellation                   | Within 5 seconds on reference workload, with explicit failure if shutdown cannot complete |
| Autosave                                           | Within 1 second of committed/idle changes under normal storage conditions                 |
| Geometry agreement                                 | Exported text position/dimensions within 1 source-video pixel of canonical layout         |
| Text layout agreement                              | Same content, glyph choices, line breaks, alignment, and style; no preview-scale reflow   |
| Video duration                                     | Difference no greater than the larger of one source frame or 20 ms                        |
| Audio synchronization                              | No introduced offset greater than 20 ms                                                   |

These targets remain unmeasured until implementation. If they cannot be met,
report evidence and revisit the requirement rather than silently weakening it.

There is no real-time export guarantee or fixed compression ratio. Export time
depends on hardware, source media, and HDR encoding. Final quality is not reduced
to meet preview-speed targets.

## 10. Acceptance scenarios

Run the applicable scenarios on macOS first. References to both platforms define
the later Windows release checks as well; they do not imply Windows is already
implemented or must ship alongside macOS.

| ID    | Scenario and required result                                                                                                                                                                          |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-01 | Import 30 mixed supported sources: each appears independently; only one video is displayed                                                                                                            |
| AC-02 | Import valid and corrupt files together: valid files remain usable; rejected filenames and reasons are shown                                                                                          |
| AC-03 | Click a video without text: one editable box appears at the clicked position; placeholder is never exported                                                                                           |
| AC-04 | Click empty video background after creation: existing box selects; no second box or movement occurs                                                                                                   |
| AC-05 | Double-click box, type/paste English, punctuation, multiline text, and emoji: edit in place and preserve content                                                                                      |
| AC-06 | Drag box: position changes; resize every corner/side handle: box changes but font size does not                                                                                                       |
| AC-07 | Narrow box or increase font size: wrapping/height updates; no text-box overflow clipping or automatic font shrinking                                                                                  |
| AC-08 | Place text partially/entirely off-frame: video crops it; Centre in Video recovers the same box                                                                                                        |
| AC-09 | Change each style and alignment: entire box updates; bundled font/emoji output is consistent on both platforms                                                                                        |
| AC-10 | Delete through hover button, panel button, and keyboard: box disappears; Undo restores it; next video click can recreate it                                                                           |
| AC-11 | Resize window: fitted preview changes scale, but source-space text geometry and line breaks stay unchanged                                                                                            |
| AC-12 | Use low-quality preview: placement matches high-quality output; preview limits do not change output resolution or frame timing                                                                        |
| AC-13 | Toggle export checkboxes without activating rows, and activate rows without changing checkboxes                                                                                                       |
| AC-14 | Export current/checked/all: only that scope is considered and each eligible video creates its own file                                                                                                |
| AC-15 | Include missing/empty/whitespace text: preflight lists skipped sources; all-empty selection cannot start rendering                                                                                    |
| AC-16 | Export SDR and HDR together: retain H.264/HEVC for 8-bit SDR, Main10 HEVC for 10-bit SDR, and 10-bit HEVC/AAC with valid standard HDR signalling for HDR                                              |
| AC-17 | Compare source/output: preserve oriented dimensions, aspect ratio, frame timing, duration, and audio synchronization                                                                                  |
| AC-18 | Export repeatedly or use duplicate basenames: safe suffixes prevent overwriting originals or existing outputs                                                                                         |
| AC-19 | Cancel mid-batch: editing stays locked until stopped; completed files survive, incomplete files are removed, remaining jobs are cancelled                                                             |
| AC-20 | Force one encoder failure: remaining videos continue; failure is actionable and Retry Failed excludes successful outputs                                                                              |
| AC-21 | Quit during export: explicit confirmation and safe shutdown; no success-shaped partial outputs                                                                                                        |
| AC-22 | Relaunch normally or after interruption: restore edits and checked state paused; interrupted jobs do not restart automatically                                                                        |
| AC-23 | Move a source or deny storage access: preserve edits, show the real error, and provide recovery instead of silent loss                                                                                |
| AC-24 | Disconnect internet: importing, all required characters/fonts, editing, export, and restoration still work                                                                                            |
| AC-25 | Use keyboard/numeric controls without dragging: creation, editing, styling, movement, sizing, deletion, and export remain operable                                                                    |
| AC-26 | Inspect outputs: no controls, handles, placeholder text, selection borders, or editor watermark are burned in                                                                                         |
| AC-27 | Measure the reference workload: meet section 9 targets and record actual results on both supported platforms                                                                                          |
| AC-28 | Apply to All with empty targets: copy text/style/layout to other videos regardless of export checkboxes; opening the next video shows its copy without another action                                 |
| AC-29 | Copy 1080 x 1920 to 2160 x 3840: double geometry, font size, and padding; retain relative appearance and line wrapping                                                                                |
| AC-30 | Copy across different aspect ratios: use relative mapping, reflow/grow height as needed, never stretch glyphs or change the video, and identify copies needing review                                 |
| AC-31 | Mix non-empty custom text, absent boxes, empty boxes, and whitespace text: preserve non-empty edits exactly; fill only eligible empty targets; keep source unchanged                                  |
| AC-32 | Edit/delete one copy: other copies/default remain unchanged; navigating away/back must not refill a deliberately emptied video                                                                        |
| AC-33 | Import after applying a default: inherit the last-applied snapshot, not later source edits; disable inheritance and verify subsequent imports stay empty                                              |
| AC-34 | Relaunch: retain the snapshot, switch setting, and independent edited/deleted states; removing the source entry keeps the default, while Clear Workspace resets it                                    |
| AC-35 | Apply, navigate/play, then Undo/Redo: reverse/restore the whole group including default/settings; after another mutation, per-video Undo must not discard other videos' later edits                   |
| AC-36 | Repeat Apply to All after changing the source: preserve existing non-empty copies, fill new empty targets, refresh the future-import snapshot, and respect an explicitly disabled inheritance setting |

High-quality export also requires visual review for added compression artifacts,
correct HDR appearance/signalling, clean glyphs, and absence of unexpected
tone-mapping. An SDR placement preview is not a sufficient HDR-output quality test.

## 11. Research and design rationale

The following documentation informed discovery; competitors' unrelated features
are not automatically included in this product.

| Source                                                                                                                                                          | Relevant finding and implication                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| [Clipchamp: Add text to video](https://clipchamp.com/en/add-text-to-video/)                                                                                     | Text appearance controls and positioning are distinct operations; keep the inspector separate from direct manipulation                |
| [Canva: Add text to video](https://www.canva.com/features/add-text-to-video/)                                                                                   | Canvas placement, font/colour controls, and text-duration choices are common; this product deliberately uses full-duration text only  |
| [Adobe Express: Video editing guide](https://www.adobe.com/express/learn/blog/video-editing-in-express)                                                         | Canvas editing, layer timing, and checking legibility across frames; retain simple playback but omit layers/timing                    |
| [Microsoft: Text Box pane](https://support.microsoft.com/en-us/office/graphics-visuals/format-object-text-box-pane)                                             | Historical PowerPoint 2010 documentation distinguishes fitting text and resizing a shape; not evidence of a current universal default |
| [W3C: Dragging Movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html)                                                                  | Keyboard support alone is not a non-drag pointer alternative; provide numeric geometry controls                                       |
| [W3C: Target Size Minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)                                                                | Small controls need adequate target areas or equivalent controls; relevant to handles and hover delete                                |
| [Apple: Export HDR files](https://support.apple.com/en-kg/guide/final-cut-pro/ver504d31dd2/mac)                                                                 | Standard HDR output and source-specific metadata formats are different requirements                                                   |
| [Apple: Incorporating HDR video with Dolby Vision](https://docs.developer.apple.com/av-foundation/Incorporating-HDR-video-with-Dolby-Vision-into-your-apps.pdf) | Dolby Vision has additional metadata requirements; Apple-platform behavior does not establish Windows support                         |
| [Noto Sans licence](https://github.com/google/fonts/blob/main/ofl/notosans/OFL.txt)                                                                             | Official font licence is SIL OFL 1.1                                                                                                  |
| [Noto Serif licence](https://github.com/google/fonts/blob/main/ofl/notoserif/OFL.txt)                                                                           | Official font licence is SIL OFL 1.1                                                                                                  |
| [Noto Emoji font licence](https://github.com/googlefonts/noto-emoji/blob/main/LICENSE)                                                                          | Official font-software licence is SIL OFL 1.1; this does not assert the same licence for unrelated image assets                       |

Font licences were checked through the official repositories during discovery.
Ship the applicable notices and comply with their redistribution conditions.

## 12. Approval gate and next phase

- Research and one-question-at-a-time requirement gathering are complete.
- Base component placement and supporting UI direction were explicitly approved.
- Version 0.2 adds the confirmed batch-text behavior; the new control placement
  is accepted in the approved design direction.
- Version 0.3 records the confirmed shared-codebase, macOS-first release approach.
  This initially authorized design/planning; subsequent milestone approvals below
  authorize application coding.
- The user approved [the design direction](./DESIGN.md) for creation of the
  [implementation plan](./IMPLEMENTATION_PLAN.md), and subsequently approved that
  plan before coding.
- On 2026-11-17, the user approved this PRD and explicitly requested Milestone 1.
- After reviewing the foundation, the user explicitly requested Milestone 2.
  Its local one-video SDR/text proof is complete and its frame-count fix was
  confirmed working by the user.
- The user explicitly requested Milestone 3: "let's go with hdr export".
  HDR implementation is authorized.
- The user then explicitly authorized Milestone 4: "lets go ahead with phase 4".
  Playback implementation is authorized; physical HDR visual review remains open.
- The user then explicitly authorized Milestone 5: "le't go aehad with phase 5".
  Complete single-video editing is authorized;
  physical HDR, reference-hardware and minimum-OS review gates remain open.
- The user explicitly authorized Milestone 6: "le'ts go ahead with phase 6".
  The persistent multi-video workspace and its subsequent recovery fixes are implemented.
- The user explicitly authorized Milestone 7: "let's go ahead with phase 7".
  Apply to All and reusable defaults are implemented.
- The user explicitly authorized Milestone 8: "let's go aieadh with phase 8".
  Current/checked/all export, progress, results, cancellation, retry and interrupted
  work reporting are implemented locally.
- The user explicitly authorized Milestone 9: "let' go ahead with phase 9",
  then selected "Local-only review build for my Mac". This authorizes local
  packaging/acceptance, not signed/notarized wider distribution. Reference
  hardware, minimum-OS and physical HDR certification remain open; the numerical
  requirements are unchanged. Stop for review before Milestone 10.
- Architectural and feasibility work must preserve the approved scope. Report
  unverified capabilities and unmet targets rather than implying approval proves them.

### Approval record

- Full PRD approved: Yes
- Approval date: 2026-11-17
- Application implementation: Milestones 1 through 9 implemented locally for local-only Mac review; physical HDR, minimum-OS and M1 Pro certification remain open
