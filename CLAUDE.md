# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CB Clipper is a Chrome Extension (Manifest V3, v2.2.0) for capturing, organizing, and revisiting highlighted text, screenshots, video timestamps, and voice notes from any web page. It is fully local — no backend, no auth, no cloud sync.

## Repository Layout

- `extension/` — The loadable Chrome extension (vanilla JS, ready to load unpacked)
- `dashboard/` — React source for the dashboard SPA (builds into `extension/dashboard/`)
- `Images/` — README screenshots
- `Universal_Clipper_PRD.docx` — Product requirements document

## Build & Development Commands

All dashboard commands run from `dashboard/`:

```bash
cd dashboard
npm install        # Install dependencies (first time)
npm run dev        # Vite dev server for dashboard development
npm run build      # Production build → outputs to ../extension/dashboard/
npm run lint       # ESLint (React hooks + React Refresh rules)
npm run preview    # Preview production build locally
```

There is no build step for the extension scripts themselves — `background.js`, `content.js`, `popup.js`, `sidebar.js`, and `idb-helper.js` are plain JS loaded directly.

**After changing dashboard code, run `npm run build` in `dashboard/` so the built output in `extension/dashboard/` is updated.** The Vite config (`base: './'`, `outDir: '../extension/dashboard'`) handles this.

To test the extension: load `extension/` as an unpacked extension in `chrome://extensions/` with Developer Mode enabled.

There are no tests in this project.

## Architecture

### Four execution contexts, one shared database

| Context | Files | Runs in |
|---|---|---|
| Service Worker | `background.js`, `idb-helper.js` | Single persistent-ish background process (MV3) |
| Content Script | `content.js`, `content.css` | Every page, **all frames** (`all_frames: true`) |
| Popup | `popup.html`, `popup.js` | Toolbar icon click |
| Sidebar | `sidebar.html`, `sidebar.js` | iframe injected into pages by content.js |
| Dashboard | `dashboard/src/` (React) | Extension page opened as a new tab |

All contexts share one IndexedDB database named `"CBClipper"` (version 2) with a single `"clips"` object store.

### Clip capture flow (the critical path)

1. User triggers capture (hotkey `Ctrl+Shift+S`, context menu, or sidebar button)
2. `background.js` takes a screenshot via `captureVisibleTab`, then runs `scripting.executeScript` with `allFrames: true` to call `getFrameCaptureData()` in every frame's `content.js`
3. Each frame returns its text selection, DOM path, selection offsets, and video timestamp
4. `background.js` picks the best result (prefers frames with actual selections and video timestamps)
5. `background.js` sends `finalize_capture_and_show_modal` to the top frame's `content.js`
6. `content.js` renders a capture modal where the user adds notes, voice memo, tags
7. On save, `content.js` sends `save_clip` → `background.js` → `idb-helper.js` writes to IndexedDB
8. `background.js` broadcasts `CLIPS_UPDATED` to refresh sidebar/popup

### Clip restoration flow

1. Dashboard's `handleLinkClick` opens original URL with `?universal-clip-id={id}` appended
2. `content.js` on the target page reads the URL param, fetches the clip via `get_clip` message
3. `restoreHighlight()` finds the element via saved DOM path, falls back to XPath text search
4. Scrolls to element, highlights it, shows toast with note/timestamp

### Timer system

Timer state lives in `chrome.storage.local` (not IndexedDB). Uses `chrome.alarms` for countdown persistence across service worker restarts. Supports focus/break modes and timer/stopwatch types. The popup, sidebar, and content.js floating button all read timer state independently.

### Two copies of the IndexedDB wrapper

- `extension/idb-helper.js` — loaded via `importScripts()` in the service worker context
- `dashboard/src/db.js` — ES module version for React imports

These are functionally identical but exist separately due to module system differences. Changes to the DB schema or CRUD logic must be applied to both files.

## Key Domain Concepts

- **Clip**: The core data unit — contains selected text, metadata (URL, title, favicon, DOM path, selection offsets), optional screenshot (JPEG base64), optional voice note (WebM base64), tags array, video timestamp, notes, and soft-delete fields (`isDeleted`, `deletedAt`)
- **Streak**: Consecutive-day visit counter for `codebasics.io`, stored in `chrome.storage.local` under `cb_streak_data`
- **Activity log**: Daily aggregated stats (focus seconds, break seconds, visit count, session list) keyed by date string in `chrome.storage.local`
- **Multi-frame capture**: The extension captures from all frames because video players (Gumlet, Mux, etc.) are often embedded in iframes
- **Shadow DOM traversal**: `findVideosDeep()` in content.js recursively enters shadow roots to find video elements

## Storage split

| Data | Where | Why |
|---|---|---|
| Clips (text, screenshots, audio) | IndexedDB | Large binary payloads exceed `chrome.storage` limits |
| Timer state, streaks, activity log | `chrome.storage.local` | Needs reactive `onChanged` events across contexts |

## Lint rules

ESLint config in `dashboard/eslint.config.js`: `@eslint/js` recommended + `react-hooks` + `react-refresh/vite`. The `no-unused-vars` rule ignores variables starting with uppercase or underscore (`varsIgnorePattern: '^[A-Z_]'`).

## Known duplication to be aware of

- `popup.js` and `sidebar.js` have near-identical timer UI code (~130 lines each)
- `idb-helper.js` and `dashboard/src/db.js` duplicate the same IndexedDB interface — update both when changing DB logic
- Streak increment logic exists in both `background.js` and `dashboard/src/components/HomeView.jsx`
