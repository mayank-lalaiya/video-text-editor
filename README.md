# Video Text Editor

An offline desktop app for adding text to videos. Import several
clips, edit one at a time, reuse text across the collection, and export a
separate MP4 for each video without modifying the originals.

**Current version: 0.10.0 preview.** Targets macOS on Apple silicon and
Windows 10/11 on Intel x64 PCs. Review builds are unsigned, not production
releases. Windows client-OS, physical HDR and reference-hardware certification
remain separate release gates.

## Features

- Import multiple H.264/HEVC MP4 or MOV files into a persistent local workspace.
- Click the video to add a text box and type directly on the preview.
- Move text and resize its box using eight handles or numeric position/size
  controls. Resizing the box does not change font size.
- Set font, size, colour, bold/italic and alignment using bundled fonts.
- Play, pause, seek and mute the preview to check placement.
- Apply text to videos with no existing nonempty text. Optionally reuse the
  last-applied text as an independent default for future imports.
- Undo/redo text edits, autosave locally, and relink moved source files.
- Export the current video, checked videos or the full collection sequentially,
  with progress, cancellation, collision-safe filenames and failed-job retry.
- Export supported SDR and 10-bit HLG/PQ HDR while preserving resolution,
  orientation and source frame timing. Compatible AAC audio is copied.

The scope is deliberately limited: one full-duration text box with one style
per video. There is no trimming, clip merging, multi-layer timeline or text
animation.

## Requirements

- macOS 15+ on Apple silicon, or Windows 10/11 on an x64 PC.
- Windows x86/32-bit, Windows ARM and Intel Macs are not supported.
- Node.js 24 or newer, with npm.
- Internet access for the initial dependency installation. Editing and exports
  run locally without internet access.

Pinned fonts and macOS media workers are included in the repository.
Windows workers are built from pinned source by the Windows workflow and
included in its portable ZIP, together with required licenses and corresponding
source. Packaged apps do not need a system FFmpeg installation, Node.js or
Microsoft Store codec extensions.

## Run from source on macOS

```sh
git clone https://github.com/mayank-lalaiya/video-text-editor.git
cd video-text-editor
npm ci
npm start
```

`npm start` launches the development app with Vite hot reload. Keep its terminal
running while developing. For a standalone application, build a local package
using the commands below.

## Run the Windows preview

1. Open [Windows x64 preview builds](https://github.com/mayank-lalaiya/video-text-editor/actions/workflows/windows.yml).
2. Select a successful run and download its **Video-Text-Editor-windows-x64**
   artifact. GitHub requires signing in to download Actions artifacts.
3. Extract the artifact and the application ZIP inside it to a writable local
   folder. Do not run the executable from inside the ZIP.
4. Open **Video Text Editor.exe**. No separate codec pack or GPU is required.

The portable ZIP is not an installer and does not add a Start-menu shortcut.
Keep the executable and its resource files together. Edits are saved in the
normal per-user application-data directory, not beside the executable.
Unsigned builds may show Windows reputation warnings; verify the origin and
do not disable Windows security protections.

Windows uses software H.264 and HEVC/Main10 encoders for compatibility with
ordinary Intel x64 PCs. Exports can be slower than the Mac's hardware encoder;
no real-time 4K export or GPU-acceleration guarantee is made.

## Using the editor

1. Import or drop supported videos, then choose a video in the left sidebar.
2. Click the preview or **Add text**. Type directly into the box; press Escape
   or Cmd+Enter on macOS / Ctrl+Enter on Windows to finish typing.
3. Drag to reposition, resize the box using its handles, and use the inspector
   for formatting. Coordinates and font sizes are in source-video pixels.
4. Play and seek to check placement. **Apply to all** fills other videos with
   absent or whitespace-only text without replacing existing nonempty text.
   Review copies when aspect ratios differ.
5. Choose **Export current** or **Export batch**, review the selected scope and
   destination folder, then start the export.

Exports use names such as `clip_edited.mp4` and `clip_edited_2.mp4`; existing
files and original media are never intentionally overwritten.
Source files stay in their original locations. The app saves source references
and edits in its local Electron user-data directory, not inside this checkout.
Use **Locate** when a source moves. **Clear Workspace** removes saved edits,
not source videos or completed exports.
Use Cmd+Z / Cmd+Shift+Z on macOS, or Ctrl+Z / Ctrl+Y (also Ctrl+Shift+Z)
on Windows for text-object history.

### Export quality and supported media

- Eight-bit SDR H.264 stays H.264; eight-bit HEVC stays HEVC Main.
- Supported ten-bit SDR and HDR export as HEVC Main10. Compatible Dolby Vision
  profile 8 base layers export as standard HDR, not Dolby Vision.
- The balanced preset targets 150% of the original video-stream bitrate, with
  minimum targets of 256 Kbps for eight-bit and 4 Mbps for ten-bit output.
  These are encoder targets, not a fixed file-size guarantee.
- Export is lossy, not pixel-identical. Text detail, source complexity and the
  minimum bitrate targets can make some exports substantially larger.
- HDR preview is tone-mapped SDR for placement; the export retains supported
  HDR signalling. Preview resolution, frame rate and mute do not change output.
- Ambiguous/unsupported colour formats and Apple APAC spatial audio are
  rejected explicitly. Audio is not silently discarded or downmixed.

## Build a standalone macOS app

```sh
npm run build
open "out/Video Text Editor-darwin-arm64/Video Text Editor.app"
```

Create a ZIP:

```sh
npm run make
```

The ZIP is written under `out/make/zip/darwin/arm64/`.

For an isolated, versioned review package:

```sh
npm run make:review
```

This writes the app and ZIP beneath `out/preview-<version>/` and refuses to
overwrite an existing review directory. Preserve earlier builds and close the
old app before opening a different version.

Builds are not signed/notarized for wider distribution. Do not disable macOS
security protections to run them.

## Build on Windows x64

Build and validate Windows packages on Windows itself. A cross-package from a
Mac is not proof of working Windows media, process cleanup or rendering.

Install Node.js 24+ and MSYS2. In an **MSYS2 UCRT64** shell with Windows Node.js
on `PATH`, clone this repository, then run:

```sh
npm ci
pacman -S --needed make curl tar unzip diffutils \
  mingw-w64-ucrt-x86_64-gcc \
  mingw-w64-ucrt-x86_64-ninja mingw-w64-ucrt-x86_64-pkgconf
bash scripts/build-windows-media.sh
node scripts/prepare-windows-resources.mts
npm start
```

The native build downloads checksum-pinned x264, x265 and zlib source and a
compatible pinned CMake 3.x tool, then reuses the included FFmpeg source.
It builds static CPU workers and a Windows Job
Object supervisor. The Windows manifest is generated from verified source and
output bytes; the tracked macOS manifest remains unchanged.
Native build workspaces are printed and retained for diagnosis.

After preparing resources:

```sh
npm run build:windows
npm run make:windows
npm run test:windows
```

The app is under `out/Video Text Editor-win32-x64/`, and its portable ZIP is
under `out/make/zip/win32/x64/`. On Windows, `npm run make:review` instead creates
an isolated `out/preview-<version>-windows-x64/` directory.
Native resources and local packages are generated files, not committed binaries.

## Validate changes

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run test:desktop
```

- `npm test` runs domain, resource, media-worker and persistence regressions.
- `npm run test:desktop` requires a built app and runs UI, real synthetic-media,
  lifecycle and hardened-package workflows sequentially.
- `npm run test:package` checks the actual app bundle and packaged workflows.
- On Windows, use `npm test` and `npm run test:windows` after a Windows build;
  the legacy `test:desktop` / `test:package` commands audit macOS specifically.
  Windows checks exercise the actual hardened portable app offline, CPU
  H.264/HEVC SDR and HLG/PQ Main10 exports, frame timing, AAC packet copying,
  text/emoji, Unicode/space-containing paths and workspace restoration.
- The Windows workflow builds on `windows-2022`, then extracts the actual ZIP
  and repeats packaged checks on `windows-2025`. These are Windows Server CI
  runners, not evidence that Windows 10/11 client PCs or physical HDR displays
  have been certified.
- UI tests use hidden windows without activation/Dock focus by default.
  Set `VIDEO_EDITOR_TEST_BACKGROUND=0` only for intentional visible debugging.
- `VIDEO_EDITOR_PACKAGED_APP` can select an absolute `.app` path for isolated
  package audits and hardened workflows.
- The optional `npm run test:preview-benchmark` generates a 30-minute 4K60 HDR
  fixture. Allow several GB of temporary space; it is not part of routine tests.
- Optional real-footage checks require locally supplied media and are skipped
  by default. See the [validation history](./arch/VALIDATION.md) for instructions
  and measured results. Private media is not required for routine tests.

Physical HDR appearance, minimum-macOS execution and reference-hardware
performance still need independent certification.
Windows saves flush pending file bytes before atomic replacement and retain a
previous-save backup. Windows does not provide the POSIX directory-fsync step
used on macOS through Node's filesystem API; power-loss durability still needs
client-OS validation.

## Project structure

| Location                                     | Purpose                                                              |
| -------------------------------------------- | -------------------------------------------------------------------- |
| [`src/main/`](./src/main/)                   | Electron lifecycle, native media work, exports and persistence       |
| [`src/preload/`](./src/preload/)             | Narrow, validated desktop bridge                                     |
| [`src/renderer/`](./src/renderer/)           | React editor, text layout and playback UI                            |
| [`src/shared/`](./src/shared/)               | Schemas and pure editor/history/collection logic                     |
| [`resources/`](./resources/)                 | Pinned offline fonts, workers, corresponding source and notices      |
| [`scripts/`](./scripts/)                     | Native rebuild and isolated packaging commands                       |
| [`tests/`](./tests/)                         | Unit, media, UI, lifecycle and package regressions                   |
| [`arch/`](./arch/)                           | Requirements, architecture, design mockup and implementation history |
| [`.github/workflows/`](./.github/workflows/) | Native Windows builds and portable-artifact validation               |

Generated builds, dependencies, local media and editor-state files are ignored
by Git. Do not commit credentials, private footage, local profiles or reports
containing source paths.

## Architecture and design

- [Product requirements](./arch/PRD.md)
- [UI and technical design](./arch/DESIGN.md)
- [Design mockup](./arch/editor-macos.svg) - an illustration, not an app screenshot
- [Implementation plan and checkpoints](./arch/IMPLEMENTATION_PLAN.md)
- [Development and validation history](./arch/VALIDATION.md)

The app uses Electron, React and TypeScript with locally bundled FFmpeg/
ffprobe workers. Text uses a shared Chromium layout for editing and transparent
export overlays. The renderer is sandboxed and cannot access arbitrary native
APIs; media work and file publication remain in the main process.

## Native resources and licensing

Per-file origins, licenses and SHA-256 pins are recorded in the
[resource manifest](./resources/manifest.json). Startup validates the required
resources; changed or missing files produce a visible error.

- `npm run build:guardian` rebuilds the project-owned supervisor and updates its
  manifest pin after intentional C-source changes.
- `npm run build:media` rebuilds FFmpeg/ffprobe from the included source archive.
  This requires Xcode Command Line Tools on Apple silicon; review and update
  the binary pins after an intentional toolchain change.
- Windows uses the separate [source pins](./resources/media-tools/win32-x64/sources.json)
  and [build recipe](./scripts/build-windows-media.sh). Its FFmpeg build includes
  GPL-licensed x264/x265 CPU encoders; it is **GPL-2.0-or-later**, unlike the
  unchanged LGPL-only Mac build. Both disable networking and nonfree components.

See [native build instructions](./resources/media-tools/darwin-arm64/BUILD-INFO.txt)
and [third-party notices](./resources/THIRD_PARTY_NOTICES.txt).
Required upstream copyright and license notices are retained.

Project code is currently **UNLICENSED**; public repository visibility does not
grant an open-source license. Bundled third-party components retain their own
licenses, including SIL OFL fonts, LGPL macOS FFmpeg/ffprobe and GPL Windows
FFmpeg/x264/x265. Windows packages include corresponding codec/dependency source,
build scripts and notices.
