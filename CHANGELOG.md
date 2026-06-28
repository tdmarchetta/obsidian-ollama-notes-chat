# Changelog

All notable changes to Ollama Notes Chat. Format loosely follows [Keep a Changelog](https://keepachangelog.com/). Versions are SemVer-zero (pre-1.0); minor bumps may include breaking behavior, patch bumps do not.

## [0.7.18] — 2026-06-28

Bug fixes surfaced by a full button-by-button UI audit. No schema or settings change.

### Fixed
- **"Insert into note" works from the chat sidebar again.** It previously always failed with *"No active note to insert into"*: clicking the button makes the sidebar the active leaf, so `getActiveViewOfType(MarkdownView)` returned `null`. It now falls back to the most-recently-active main-area leaf (`ChatView.insertIntoNote`).
- **Conversation titles can contain spaces.** The inline rename `<input>` is a child of a `role="button"` element whose keydown handler treated Space as activation, swallowing the space before it reached the input — so titles truncated at the first word. The header rename (`ChatView`) and history-drawer rename (`HistoryDrawer`) now ignore key events originating from the child input.
- **Renaming the active chat from the history drawer updates its header live.** The store/drawer updated but the open view's in-memory title stayed stale until a switch/reload; `ChatView` now syncs its title on rename of the active conversation.

## [0.7.17] — 2026-06-27

Privacy: an explicit network-egress control. No schema change.

### Added
- **"Allow data to leave this computer" setting** (Connection section) — when **off** (default for new installs), the plugin only connects to a loopback Ollama server (`localhost` / `127.x` / `::1`), so note content never leaves the machine; a non-local Base URL is refused with a clear, host-named error. When **on**, it may connect to a server on another machine on the LAN. Enforced centrally in `OllamaClient` before every request path (chat, stream, embed, list-models), so retrieval/indexing and tool use are covered too. New pure helper `src/util/loopback.ts`.

### Changed
- **Upgrade is non-breaking:** `mergeSettings` grandfathers an existing non-local Base URL (auto-enables the new toggle) so current LAN setups keep working; fresh installs stay private by default.

## [0.7.16] — 2026-06-27

Security-hardening release from a full audit. No critical or high-severity findings; these are low-severity hardening items. No schema or settings change.

### Added
- **"Note override" indicator** (#30) — the status strip below the message box now shows a **note override** badge (with a tooltip) whenever the active note's `ai` frontmatter overrides the system prompt or model, so a note from an untrusted source can't silently redirect the assistant. The badge tracks the active note via an `active-leaf-change` listener, so it appears/clears as you switch notes.

### Changed
- **In-app connection hint recommends the scoped `OLLAMA_ORIGINS=app://obsidian.md`** instead of the wildcard `*` (#30) — the error toast is the guidance users are most likely to copy, so it now points at the least-permissive origin that works, matching the README and user guide.

### Security
- **`eslint-plugin-no-unsanitized` now enforced in CI** (#30) — the installed-but-unwired linter is registered in the flat config, failing the build on unsafe DOM sinks (`innerHTML`, etc.) so a future change can't reintroduce an injection vector. Current code is clean.

### Internal
- **`manifest.json` / `package.json` / `versions.json`** bumped to `0.7.16`.

## [0.7.15] — 2026-06-26

Maintenance release — a dev-toolchain bump plus housekeeping already landed on `main`. No user-facing behavior change.

### Changed
- **eslint 9 → 10** (#20). Dev-only lint toolchain; eslint isn't bundled into `main.js`, so the shipped plugin is behavior-identical. Taken once it cleared the 14-day cooldown (published 2026-06-12). The other open bumps stayed behind the cooldown and were left open: vitest 4.1.9 (eligible 06-29), actions/checkout v7 (07-02), `@types/node` 26 (07-08).
- **Path-escape guard deduped into a shared `assertWithinFolder` helper** (#28) — behavior-preserving refactor of the path-traversal defense (ADR-007 / ADR-009); the only delta to the shipped `main.js`.

### Internal
- **14-day dependency cooldown** added to `.github/dependabot.yml` (#26); committed `CHANGELOG.md` + thinned `AGENTS.md` (#27).
- **`manifest.json` / `package.json` / `versions.json`** bumped to `0.7.15`.

## [0.7.14] — 2026-06-26

Chat-subheader UX — the context pill becomes two dropdown pickers. No schema or settings change.

### Changed
- **Context + model pickers** (`src/view/ChatView.ts`, `styles.css`). The single click-to-cycle context pill is now two independent click-to-open dropdowns built on Obsidian's native `Menu`: a **context-mode picker** (all six modes, active one checkmarked — no more blind rotation) and a **model picker** that lists installed Ollama models from `/api/tags` and switches `settings.model` live through the existing `saveSettings → notifyViews → refreshSubheader` path, so you change models without opening Settings. Both segments are keyboard-accessible (Tab + Enter/Space) and anchored under the click; a fetch failure or empty list degrades to a `Notice`. New `buildSubheaderSegment` / `openContextMenu` / `openModelMenu` / `selectModel` / `showMenuUnder`; `cycleContextMode()` → `setContextMode()`. Context selection stays session-only.
- **`manifest.json` / `versions.json`** — bumped to `0.7.14`.

### Internal
- Lint lesson: `obsidianmd/ui/sentence-case` rejects brand-name capitalization in UI strings — a `Notice` reading "Ollama" mid-sentence failed CI; use "the server".

## [0.7.13] — 2026-06-26

Note-name chat-history titles + a one-time backfill. No schema, settings, dependency, or LLM-call change.

### Fixed
- **Auto-titles for context-only chats** (`src/chat/Conversation.ts`, `main.ts`). `deriveAutoTitle()` took the title from the first user message, so chats sent as a bare `/summarize` (relying on active-note context) were all titled "/summarize". It now falls back to the source note's basename when the typed text is empty, and a one-time load-time backfill re-titles existing auto-named chats. Manually-renamed chats (`titleManuallySet`) are untouched; a null re-derivation is skipped so no title is wiped. History previews also strip the leading slash command.

### Added
- **`src/util/noteBasename.ts`** *(new)* — pure basename helper, with tests. Suite 229 → 238.
- **`versions.json`** — added `"0.7.13": "1.7.2"`.

## [0.7.12] — 2026-06-17

Maintenance pass — removes a deprecated Settings API and a build-hygiene wart. No user-facing behavior change.

### Changed
- **Dropped four deprecated `SliderComponent.setDynamicTooltip()` calls** (`src/settings/SettingsTab.ts`). The value shows inline as of Obsidian 1.13.x and the 1.13.1 types mark the method `@deprecated`; removing the calls cleared the community-dashboard recommendation and unblocked the obsidian 1.13.0 → 1.13.1 devDependency bump (#8), whose CI had failed on those exact lines via `@typescript-eslint/no-deprecated`.
- **`tsconfig` `noEmit: true`** — a bare `tsc` had littered ~50 stray compiled `.js` next to the sources (esbuild does the bundling; `tsc` is typecheck-only), plus a `.gitignore` backstop (`src|test/**/*.js`, `vitest.config.js`).
- Dependabot: actions/checkout 6.0.3 (#4), typescript-eslint 8.61.1 (#5), @typescript-eslint/parser 8.61.1 (#6).
- **`versions.json`** — added `"0.7.12": "1.7.2"`.

## [0.7.11] — 2026-06-16

"Current folder" context mode + a pre-release scan-clearing pass. Folds in the never-published 0.7.10 hardening (below).

### Added
- **"Current folder" context mode** — chat with every note in the active note's folder. The sixth context mode (none / current-note / current-selection / linked-notes / current-folder / retrieval).

### Security
- **esbuild `0.28.0` → `0.28.1`** — closes two Dependabot alerts: a high-severity RCE via `NPM_CONFIG_REGISTRY` and a low-severity Windows dev-server file read. Both dev-only / externalized (esbuild never ships in `main.js`).

### Changed
- **`markdownToPlainText` HTML strip now loops to a fixpoint** (`src/tts/markdownToPlainText.ts`), clearing CodeQL `js/incomplete-multi-character-sanitization`. The output feeds TTS, not a DOM sink — scanner hygiene, not an exploit fix.
- **`versions.json`** — added `"0.7.11"` (and `"0.7.10"`, folded here).

## [0.7.10] — folded into 0.7.11 (never published standalone)

Hardening pass — **no user-facing behavior change**. Implements the post-audit recommendations: full TypeScript strict mode, tests for the last untested orchestration modules, a documented release checklist, and repo guardrails.

### Changed
- **TypeScript `strict: true` + `noUncheckedIndexedAccess`** (`tsconfig.json`). ~60 compile errors fixed across 11 files — all behavior-preserving guards/`??` fallbacks on index accesses that were in-bounds by invariant, plus two real `strictFunctionTypes` signature fixes (`main.ts` editor-menu callback; `RewriteCommand` now correctly narrows `MarkdownView | MarkdownFileInfo` before running, so the rewrite command no-ops in embedded editors instead of receiving a mistyped context).
- **One latent bug fixed by the migration** (`src/context/NoteContext.ts`): an empty embeddings array from `/api/embed` previously produced `queryVec = undefined` and crashed `topK()`; it now degrades to the `embed-failed` retrieval status.

### Added
- **`src/tools/ToolLoop.test.ts`** — 8 tests over the tool-call loop: no-call exit, spec passing, tool execution + message threading, base-array immutability, unknown-tool and throwing-tool error paths, iteration cap (final iteration skips execution), per-iteration stats.
- **`src/rag/Indexer.test.ts`** — 13 tests over the vault indexer: no-embedder guard, fresh index + mtime recording, embedding-dim capture, mtime-diff incremental re-embed, stale-path removal, empty-note removal, embedder-model-change rebuild, cancellation, non-md skip, remove/rename delegation, debounce coalescing, debounce cancel. Suite 203 → 224.
- **`docs/release-checklist.md`** — automated gates + the ~5-min manual smoke list for UI surfaces vitest can't reach, + the merge/tag/publish sequence.
- **Repo guardrails** (2026-06-10, repo settings + `.github/dependabot.yml` on `main`): branch protection on `main` (PR + green CI, admins included), Dependabot alerts + weekly bump PRs, CodeQL default setup.
- **`versions.json`** — added `"0.7.10": "1.7.2"`.

## [0.7.9] — 2026-06-10

*(Renumbered from the staged-but-never-published 0.7.8 — no 0.7.8 release exists.)*

Code-health pass — **no user-facing behavior change**. Three behavior- and schema-preserving refactors that de-duplicate logic and shave per-query work, plus a near-doubling of the unit-test suite. Conversation schema (v2), the `index.json` schema (v1), and every security defense are untouched. Also carries the fix that restores the community-directory listing — 0.7.7 was pulled from the store for a lint-policy violation (see **Fixed**).

### Fixed
- **Obsidian directory-review compliance** (`src/view/ConfirmModal.ts`). The destructive confirm button styled itself with the deprecated `ButtonComponent.setWarning()` behind an `eslint-disable @typescript-eslint/no-deprecated` directive. The community-directory review bot forbids disabling that rule, so it pulled 0.7.7 from the store listing. Replaced with `setClass("mod-warning")` — non-deprecated, available since 0.9.7 — which applies the same `mod-warning` styling with no visual change and without raising `minAppVersion` (the suggested `setDestructive()` only exists since 1.13.0, above our 1.7.2 floor). The eslint-disable is gone; local lint runs the same type-aware `no-deprecated` rule the bot does and is clean.

### Changed
- **Shared `stripFrontmatter()`** (`src/util/frontmatter.ts`). The byte-identical private copies in `Chunker.ts` and `NoteContext.ts` now delegate to one tested helper.
- **`parseBoundedInt()` helper** (`src/util/parseBoundedInt.ts`). Replaces the six copy-pasted `parseInt` + `Number.isFinite` + bound guards in `SettingsTab.ts` with one tested function; parsing behavior (including `parseInt`'s leading-numeric tolerance) is preserved.
- **Cached per-chunk vector norms** in `VectorStore.topK()` (`src/rag/VectorStore.ts`). L2 norms are memoized in a memory-only `WeakMap` keyed by the chunk object, so repeated queries stop recomputing √(Σ eᵢ²) for every chunk. Keying on the object (not the path) means a re-chunked note recomputes correctly. Never serialized — `index.json` is byte-for-byte unchanged.
- **`finalize()` and `normalize()` exported** — `finalize` from `NoteContext.ts` and the base-URL `normalize()` from `OllamaClient.ts`, both for direct unit testing (same precedent as `formatCitation` in 0.7.7); production reaches them only through `buildContext` / the `OllamaClient` constructor.

### Added
- **Unit coverage** for `Conversation` + `deriveAutoTitle`, `ConversationStore`, `SlashCommands` (`parseSlash` / `expandTemplate` / `matchingCompletions`), `Settings` (`mergeSettings` / `contextLimitForModel`), `Chunker`, `VectorStore.topK`, `NoteContext.finalize`, the base-URL `normalize()` scheme allow-list (ADR-007 H1), and the two new `src/util/` helpers. The suite grows from 90 to 203 tests.
- **`versions.json`** — added `"0.7.9": "1.7.2"`.

### Security
- **Pre-release security + system audit (2026-06-09): no findings.** Full-codebase pass over every untrusted data flow — note content → context block → LLM; model output → markdown render → DOM; tool calls → vault reads; `data.json`/`index.json` → `JSON.parse`; rendered links → `window.open`. No high-confidence security vulnerabilities and no system bugs found; the ADR-007/009 defenses (scheme allow-lists in `normalize()`/`isSafeExternalHref()`, `sanitizePath()` traversal guards, deep `sanitizeArgs()` pollution filter, vector-index validation) were each re-verified at their call sites. No code change resulted.

## [0.7.7] — 2026-06-08

Citation disambiguation for duplicate note names, plus a build-tooling refresh and CI on every push. First release with a code change since the community-store launch.

### Added
- **Disambiguated RAG citations** (`src/context/NoteContext.ts`). When two notes in the vault share a basename, retrieval citations are now path-qualified with a display alias — `[[Work/Notes/Index#Goals|Index#Goals]]` instead of a bare `[[Index#Goals]]` that could resolve to the wrong note. Unambiguous names keep the clean `[[Note#Heading]]` form. `formatCitation()` is now exported and covered by unit tests (`src/context/NoteContext.test.ts`); the suite is at 90 tests.
- **CI on every push** (`.github/workflows/ci.yml`). Runs lint + tests + build + a production-dependency `npm audit` on pushes to `main` and on PRs, with pinned action SHAs. Complements the tag-triggered `release.yml` added in 0.7.6.
- **`AGENTS.md`** — a Codex-oriented context file mirroring `CLAUDE.md`.

### Changed
- **Build tooling bumped** — esbuild `^0.20` → `^0.25`, vitest `^2.1` → `^4.0`. Both are devDependencies; `main.js` still ships zero runtime deps. (The esbuild bump now builds the released `main.js` in CI.)
- **`package.json` metadata** — added `repository`, `bugs`, and `homepage` fields.
- **README** — leads with install from Obsidian's Community plugins browser; build-from-source moved to a dedicated dev section. `OLLAMA_ORIGINS` guidance now recommends the scoped `app://obsidian.md` over `*`. Added a Screenshots section (images pending capture).
- **`docs/user-guide.md`** — version stamp 0.7.1 → 0.7.7.
- **`versions.json`** — added `"0.7.7": "1.7.2"`.

## [0.7.6] — 2026-05-18

CI-built releases — **no plugin code change**; `main.js` / `manifest.json` / `styles.css` ship byte-identical to 0.7.5. The first release built and attested in CI rather than by hand.

### Changed
- **Release build moved into GitHub Actions** (ADR-010). A pushed version tag triggers `.github/workflows/release.yml`, which verifies `manifest.json` / `package.json` / `versions.json` all match the tag, runs lint + tests, builds `main.js`, generates build-provenance attestations for `main.js` / `manifest.json` / `styles.css`, and opens a **draft** GitHub release with the three assets attached. Through 0.7.5 the assets were hand-built on the maintainer's machine and uploaded with `gh release create`.
- **`versions.json`** — added `"0.7.6": "1.7.2"`.

## [0.7.5] — 2026-05-18

Maintenance release — no user-visible behavior change; a lint/perf cleanup. Shipped the same day the plugin was accepted into the Obsidian community plugin store.

### Changed
- **CSS `:has()` selectors removed** (`styles.css`, `src/settings/SettingsTab.ts`). The two settings-pane `:has(.ollama-chat-textarea-wide)` selectors — which trigger broad style invalidation — were replaced with an `ollama-chat-setting-wide` class applied via `Setting.setClass()`. Layout is unchanged; specificity preserved via `.setting-item.ollama-chat-setting-wide`.
- **Streaming call qualified** (`src/ollama/OllamaClient.ts`). The streaming `/api/chat` `fetch` is now `window.fetch`, which lets the `no-restricted-globals` eslint-disable be dropped. Still `fetch`, not `requestUrl` — ADR-002 holds.
- **README title** aligned to the plugin name (`Ollama Chat for Obsidian` → `Ollama Notes Chat`).
- **`versions.json`** — added `"0.7.5": "1.7.2"`.

### Notes
- **Published to the Obsidian community store.** Gallery submission PR [#12075](https://github.com/obsidianmd/obsidian-releases/pull/12075) was accepted on 2026-05-18 — `ollama-notes-chat` now appears in `community-plugins.json` and installs/updates through Obsidian's in-app Community plugins browser. The store listing carries Obsidian's standard "not manually reviewed by Obsidian staff" disclaimer.

## [0.7.4] — 2026-05-12

Lint cleanup — clears the last two warnings from the Obsidian review bot's 0.7.3 rescan. No user-visible change.

### Changed
- **Timer functions use `window.*`** — `requestAnimationFrame()` → `window.requestAnimationFrame()` (`src/view/ChatView.ts`) and `activeWindow.setTimeout()` → `window.setTimeout()` (`src/view/StatsModal.ts`). The Obsidian rule wants `window.` for timer functions specifically (not `activeWindow.`); 0.7.3 had over-corrected to `activeWindow.`.
- **`versions.json`** — added `"0.7.4": "1.7.2"`.

## [0.7.3] — 2026-05-12

Obsidian review-bot cleanup + popout-window compatibility. Addresses every bot finding on 0.7.2 except the intentionally-skipped streaming `fetch` (ADR-002). No user-visible features. Net −31 lines.

### Changed
- **`minAppVersion` 1.4.0 → 1.7.2** — declared honestly; the plugin uses `Workspace.revealLeaf` (1.7.2) and `setTooltip` (1.4.4).
- **Popout-window compatibility** — `document` → `activeDocument` / `createEl` helpers across `DiffView`, `SettingsTab` (model + embedder dropdowns), `ChatView` (title rename input), `HistoryDrawer` (row rename input). `setTimeout` → `activeWindow.setTimeout` in `StatsModal`.
- **`crypto.randomUUID`** — dropped the `globalThis` cast; the global `crypto` is accessed directly (`Conversation`, `OllamaClient`).
- **esbuild config** — replaced the `builtin-modules` dev dependency with `node:module`'s `builtinModules`.
- **`versions.json`** — added `"0.7.3": "1.7.2"`.

### Fixed
- **`-- reason` descriptions** added to all `eslint-disable` directives (`SaveAsNote`, `DiffView`) — the `obsidianmd/no-undescribed-eslint-disable` rule flags bare disables as errors.
- **UI string** — `(no models installed)` → `(No models installed)` (sentence case).

## [0.7.2] — 2026-05-12

Text-to-speech for assistant responses.

### Added
- **Read responses aloud** — a speaker button on each assistant message's action row reads the response via the browser-native Web Speech API (`window.speechSynthesis`). No network, no API keys, no new runtime deps. Click again (or another message's speaker) to stop; the accent color marks the message being spoken.
- **`src/tts/SpeechPlayer.ts`** *(new)* — wraps `speechSynthesis` with a single-utterance model and a listener so the UI keeps button state in sync.
- **`src/tts/markdownToPlainText.ts`** *(new)* — strips code blocks (silenced), inline markdown, links / wikilinks, and HTML before speaking. Covered by 13 new vitest cases — total now **85 tests across 9 files**.
- **Settings: "Enable text-to-speech"** toggle (default on). Toggling hides the speaker button via a CSS class on the view root — no re-render. An `isSupported()` guard hides the button on platforms without `speechSynthesis`.

### Changed
- **`versions.json`** — added `"0.7.2": "1.4.0"`.

## [0.7.1] — 2026-04-25

Export & portability — first feature release after the 0.7.0 stability pass. One-click conversation export to Markdown or JSON; PDF deferred per the roadmap risk note (Obsidian doesn't expose a programmatic "export to PDF" command). First tagged release since 0.3.0 — 0.4.0 / 0.5.x / 0.7.0 work is bundled into the 0.7.1 GitHub release notes.

### Added
- **Export Conversations modal** — opens via a new `share-2` header icon or the `ollama-notes-chat:export-conversations` palette command. Three scopes: `this conversation` / `all conversations` / `date range` (inclusive on both ends, YYYY-MM-DD). Two formats:
  - **Markdown** — one `.md` per conversation, reuses `SaveAsNote.renderMarkdown()`. Files land under the configured export folder; auto-deduplicates with `(2)` / `(3)` suffix on collision.
  - **JSON** — single `ollama-export-YYYY-MM-DD.json` containing the `ConversationSnapshot[]` array verbatim. Round-trippable via the persisted snapshot type.
- **Settings: Export section** — `Export folder` (default `Chats`) and `Default export format` (default Markdown). Override per-export from the modal without affecting the saved defaults.
- **`src/chat/ExportConversation.ts`** *(new)* — pure functions: `renderJson`, `filterByDateRange`, `exportToMarkdown`, `exportToJson`. Path-traversal-defended via the existing `sanitizeFolder` / `sanitizeFilename` / `uniquePath` / `ensureFolder` / `fillFilenameTemplate` from `SaveAsNote.ts` (now exported instead of file-private).
- **`src/view/ExportModal.ts`** *(new)* — Obsidian Modal subclass; pre-fills format and folder from settings; surfaces validation errors via `Notice` (invalid date range, empty conversation, no scope match).
- **17 new vitest cases** in `src/chat/ExportConversation.test.ts` (round-trip JSON, date-range edge cases, vault.create call counts, filename pattern, traversal sanitization). Total now **72 tests across 8 files**.
- **`docs/user-guide.md`** — full plugin user guide (15 sections covering chat panel, context modes, history, slash commands, tool use, rewrite, RAG, save-as-note, export, per-note overrides, stats, settings, shortcuts, troubleshooting). First end-user-facing doc in the repo.

### Changed
- **`SaveAsNote.ts` helpers exported.** `fillFilenameTemplate`, `ensureFolder`, `uniquePath` are now `export`ed (were file-private). Reused by `ExportConversation.ts` so we don't fork the path-handling defenses.
- **`manifest.json` `authorUrl`** — fixed from `https://buymeacoffee.com/tdmarchetta` (funding link) to `https://github.com/tdmarchetta` (author profile), per Obsidian community plugin guidelines. Funding link remains in `fundingUrl`.
- **`versions.json`** — added `"0.7.1": "1.4.0"`.

### Notes
- **First tagged release since 0.3.0.** Tag `0.7.1` (no `v` prefix) with a GitHub release attaching `main.js` / `manifest.json` / `styles.css` as individual files. The 0.4.0 / 0.5.0 / 0.5.1 / 0.5.2 / 0.7.0 work was never tagged — those releases ship as part of 0.7.1.
- **Gallery submission PR [#12075](https://github.com/obsidianmd/obsidian-releases/pull/12075)** opened 2026-04-18, bot-validated, awaiting human review. Plugin is **installable via direct download / BRAT** but not yet listed in the gallery's `community-plugins.json`.

## [0.7.0] — 2026-04-25

Stability audit + bug-fix pass on the existing 0.5.x surface, plus a vitest test scaffold for pure-logic modules. Three audit agents flagged ~30 candidate findings; eight were verified by reading the actual source and fixed (V1–V8); five were investigated and rejected as not real (documented below so the next audit doesn't re-flag them). See ADR-009.

### Added
- **vitest test runner** — `npm test` and `npm run test:watch`. `vitest.config.ts` aliases the `obsidian` import to `test/obsidian-stub.ts` so source modules can be unit-tested without the Electron host. **55 tests across 7 files** cover MyersDiff, stripFences, sanitizePath + list_folder, SaveAsNote helpers, parseToolCall + sanitizeArgs, VectorStore (with a fault-injecting fake adapter), and the alias smoke test. Pure-logic only — anything that needs a real `EditorView` (DiffView, ChatView) stays manual-test.

### Fixed
- **V1 — MyersDiff CRLF normalization** (`src/rewrite/MyersDiff.ts`). `diff()` now folds `\r\n` → `\n` on both inputs before tokenizing. Eliminates phantom whitespace-only insert/delete pairs when the editor selection and the model response have different line endings.
- **V2 — Tilde fence stripping** (`src/rewrite/RewriteCommand.ts`). `stripFences()` now uses a single regex with a backreference, handling both ` ``` ` and `~~~` fences and correctly leaving mismatched pairs alone.
- **V3 — Identical-output gate normalization** (`src/rewrite/RewriteCommand.ts`). The "No changes proposed" check compares LF-normalized forms, so a rewrite that differs only in line endings still trips the gate.
- **V4 — `list_folder` dotfile filter** (`src/tools/VaultTools.ts`). The tool now skips children whose names start with `.` (`.obsidian/`, `.git/`, user-created `.private/`, etc.) defensively. Whether Obsidian's adapter exposes `.obsidian/` here is adapter-dependent; the filter is forward-compatible.
- **V5 — YAML newline collapse on save** (`src/chat/SaveAsNote.ts`). `renderMarkdown()` collapses CR/LF runs in the active-note title to a single space before the existing YAML escape pass. Prevents an unusual title from producing a multi-line quoted scalar that downstream YAML readers might mis-handle.
- **V6 — Deep prototype-pollution defense** (`src/ollama/OllamaClient.ts`). `parseToolCall()` now calls a recursive `sanitizeArgs()` that rebuilds every plain object on `Object.create(null)` and drops `__proto__` / `constructor` / `prototype` at every depth. Recursion is capped at 8 levels so a hostile model can't force stack-blowing recursion. Extends ADR-007 H3 ahead of any future tool whose args downstream code might spread or merge.
- **V7 — `VectorStore.save()` crash recovery** (`src/rag/VectorStore.ts`). New atomic-write sequence: write `tmp` → rename existing `index.json` aside to `.bak` → rename `tmp` into place → drop `.bak`. If the rename-into-place fails, the catch restores `.bak` to the live path. Eliminates the previous window where a mid-write crash could leave the user with no index file at all (forcing a full re-embed of a 2k-note vault).

### Changed
- **V8 — Renamed `READ_CAP_BYTES` → `READ_CAP_CHARS`** in `src/tools/VaultTools.ts`. Naming-only fix; the constant was used against `String.length` (UTF-16 code units), not bytes. Behavior unchanged.

### Investigated and rejected

So the next audit doesn't re-flag them — full rationale in ADR-009.

- **Path traversal via `%2e%2e`.** Obsidian's `normalizePath()` doesn't URL-decode and `vault.getAbstractFileByPath()` looks up the literal string. Not exploitable. ADR-007 H4 stands.
- **`topK()` ↔ `Indexer.upsert()` race.** JS is single-threaded; both code paths are synchronous and can't interleave.
- **Rewrite double-invocation race.** The `WeakMap` guard in `RewriteCommand.ts` blocks the second invocation until the first request's `finally` clears `inFlight`. No in-flight overlap window exists.
- **`schemaVersion` type-coercion bypass.** Worst case is "migration is skipped" — which is the right behavior for any non-v1 data. No data loss.
- **`appendToLast()` capturing wrong message.** Async generators capture variables in lexical scope; the suggested race would require multi-threading.

## [0.5.2] — 2026-04-19

Pre-GitHub security hardening pass. No user-visible features; every change is a defense-in-depth fix on an existing boundary. See ADR-007.

### Fixed
- **Base URL scheme allow-list** (`src/ollama/OllamaClient.ts`). `normalize()` now parses the setting with `new URL()` and rejects anything that isn't `http:` or `https:`. A `file://` / `javascript:` / `data:` value (from typo or tampered `data.json`) would previously have been dispatched verbatim by Electron's fetch. All HTTP methods now go through a `requireBaseUrl()` guard that throws a user-facing "Ollama base URL is missing or invalid — set a http(s) URL in settings." error.
- **NDJSON buffer cap** (`src/ollama/OllamaClient.ts`). `chatStream()` now aborts with a descriptive error if the unparsed buffer exceeds 8 MB without a newline. Closes an unbounded-memory failure mode on a hostile or malfunctioning server.
- **Tool-call argument prototype-pollution defense** (`src/ollama/OllamaClient.ts`). `parseToolCall()` copies only own-enumerable keys into an `Object.create(null)` target, skipping `__proto__` / `constructor` / `prototype`. Also caps `fn.name.length` at 200 so a runaway model can't bloat history or UI chips.
- **Vault-tool path sanitation** (`src/tools/VaultTools.ts`). `sanitizePath()` rejects null bytes, folds Windows separators to posix before segment checks, rejects absolute paths and any `.` / `..` segment, and runs through Obsidian's `normalizePath()` with a post-check that the shape didn't collapse upward. Tightens `read_note` / `list_folder` against model-controlled paths.
- **Save-as-note folder and filename defenses** (`src/chat/SaveAsNote.ts`). `sanitizeFolder()` rejects `..` segments explicitly (Obsidian's `normalizePath` does not strip upward traversal). `sanitizeInterpolatedValue()` strips path separators / reserved glyphs / control chars from `{{title}}` *before* template expansion. `sanitizeFilename()` strips leading/trailing dots. Post-normalization escape check refuses any final path that doesn't sit under `folderPath`.
- **YAML / wikilink escaping on save** (`src/chat/SaveAsNote.ts`). `renderMarkdown()` now escapes `\`, `"`, and `]]` in the active note title before interpolating it into the `source: "[[title]]"` frontmatter line. An unusual filename could previously break out of the YAML string or close the wikilink early.
- **Vector index validation** (`src/rag/VectorStore.ts`). `load()` validates every `IndexedChunk` via `isValidIndexedChunk()` before adoption: embedding must be a non-empty array of finite numbers. Entries keyed by `__proto__` / `constructor` / `prototype` are skipped. A truncated or tampered `index.json` used to feed `NaN` / `Infinity` into cosine math and return garbage hits silently; now it's discarded cleanly.
- **Reverse-tabnabbing defense on `window.open`** (`src/view/ChatView.ts`, `src/settings/SettingsTab.ts`). Both call sites now pass `"noopener,noreferrer"` as the `windowFeatures` argument. Anchors in rendered assistant content also flow through an `isSafeExternalHref()` check (http/https only) before opening.
- **`summarizeToolArgs` hasOwnProperty guard** (`src/view/ChatView.ts`). Inline tool-chip summary now guards `Object.prototype.hasOwnProperty.call(args, k)` before reading each key, so model-supplied argument bags with inherited enumerable keys can't feed stray `prototype` fields into the chip label.

## [0.5.1] — 2026-04-19

### Fixed
- **Text selection in chat message bodies.** Obsidian's sidebar `.view-content` inherits `user-select: none`, which silently blocked click-drag selection on message bubbles — only the bottom "copy conversation" button worked. Added an explicit `user-select: text` rule on `.ollama-chat-msg-body` (plus `cursor: text` for the affordance). The bottom copy button is untouched.

## [0.5.0] — 2026-04-18

### Added
- **Tool use / function calling** — opt-in per-conversation tool calls via Ollama's native `/api/chat` `tools` protocol. With a capable model (Qwen2.5+, Llama 3.1+), the assistant can fetch vault content mid-conversation instead of only seeing whatever was pre-loaded via the context modes. See ADR-006.
- **Vault tools (read-only)** — `read_note({ path })` returns `{ content, size, mtime }` with a 32KB content cap; `list_folder({ path })` returns `{ folders, notes }` for direct children. Strict argument validation; path-escape rejection; unknown tool names feed back to the model as a tool-role error so it can recover.
- **Tool loop** — `src/tools/ToolLoop.ts` async generator drives the chat → tool-call → chat cycle. Hard iteration cap (default 5, range 2–10) surfaces a `[tool-use iteration cap reached]` marker when hit. Each iteration produces a fresh assistant message so per-round reasoning is independently addressable.
- **Tool UI** — chips (`.ollama-chat-tool-chip`) on the assistant message showing wrench + function name + argument summary. Expandable result cards (`.ollama-chat-tool-card`) for each tool-role message with a click-to-toggle body. All theme-variable-only styling.
- **`src/tools/VaultTools.ts`** — tool specs, `buildVaultToolRegistry()`, `InvalidArgumentsError`, shared `ToolContext` passed to tool runners.
- **Settings: Tools section** — `Enable tool use` toggle (default off) + `Max tool iterations` slider (2–10, default 5).
- **Per-note frontmatter** — `ai.toolsDisabled: true` blocks tool use on sensitive notes even when globally enabled. Flows through the existing `getPerNoteOverride()` alongside `ai.rewriteDisabled` / `ai.systemPrompt` / `ai.model`.

### Changed
- **`OllamaClient`** — `ChatMessage.role` widened to include `"tool"`; `ChatOptions` accepts `tools?: ToolSpec[]`; `ChatStreamEvent` is now a three-arm tagged union (`delta` | `tool_calls` | `stats`) — existing consumers that only handle `delta` and `stats` keep working.
- **`Conversation` schema** — `Role` widened to include `"tool"`; `Message` gains optional `toolCalls?` / `toolCallId?` / `toolName?` fields. No `schemaVersion` bump — optional fields pass the existing `isSnapshot()` validator and legacy snapshots load unchanged.

## [0.4.0] — 2026-04-18

### Added
- **Rewrite-in-place** — new editor command "Rewrite selection with Ollama". Highlight text in any markdown note → LLM proposes a rewrite → inline diff appears with word-level insertions (green) and deletions (strikethrough red). Accept or Reject chips at the trailing edge; Accept replaces the range as a single undo step, Reject clears the overlay. No chat transcript, no modal.
- **`OllamaClient.chatOnce()`** — non-streaming one-shot call wrapping `/api/chat` via `requestUrl()` (ADR-002 compliant; streaming stays on `fetch`).
- **`src/rewrite/` module** — `MyersDiff.ts` (inline Myers word-diff, zero runtime deps), `DiffView.ts` (CodeMirror 6 extension with two `StateField`s for pending-range tracking and diff preview), `RewriteCommand.ts` (orchestrator with concurrency guard, fence stripping, identical-output check, per-note override honor).
- **Rewrite settings section** — independent rewrite system prompt and rewrite temperature (default 0.3), both editable in Settings.
- **Per-note frontmatter** — `ai.rewriteDisabled: true` blocks the rewrite command on sensitive notes; `ai.rewriteSystemPrompt: "..."` overrides the global rewrite prompt per note.

## [0.3.0] — 2026-04-18

### Added
- **Retrieval context mode** — new fifth mode, "Retrieved passages". Embeds your message, pulls top-K relevant chunks from across the vault, injects them into the prompt with clickable `[[Note#Heading]]` citations. Cycle to it via the subheader. See ADR-004.
- **Embedder model setting** — independent from the chat model; defaults to `nomic-embed-text`. Dropdown populates from `/api/tags`.
- **RAG settings section** — top-k slider (1–15, default 5), chunk size + overlap, auto-index toggle, reindex button (toggles to "Cancel" during a run), live progress bar.
- **Background indexer** — walks `app.vault.getMarkdownFiles()` on `workspace.onLayoutReady()`, diffs `mtime`, embeds changed files in batches of 20 with event-loop yields. Subscribes to `vault.on("modify" | "rename")` with a 2s debounce; `delete` is immediate.
- **`OllamaClient.embed()`** — wraps `/api/embed` (non-streaming, via `requestUrl`).
- **`src/rag/` module** — `Chunker.ts` (heading-split with ~800-char sliding fallback + ~100-char overlap), `VectorStore.ts` (in-memory map, flat JSON persistence, atomic tmp+rename writes, inline cosine top-K, schema v1), `Indexer.ts` (walk/chunk/embed orchestrator, cancel-aware, progress callbacks).

### Changed
- **Persistence is now split across two files.** `data.json` still holds settings + conversations. Embeddings live separately in `{manifest.dir}/index.json` so settings saves stay cheap — a 2k-note vault is ~120MB of floats and would otherwise rewrite the whole blob on every toggle.
- **Context-mode dropdown + subheader cycle** include "Retrieved passages".

## [0.2.0] — 2026-04-17

### Added
- **Multi-session history** — keep parallel chats; open the drawer from the header icon. Switch, rename, delete per row.
- **Auto-titled conversations** — new chats derive their title from the first user message (slash-command prefix stripped). Manual rename sticks; auto-titler never overwrites.
- **ESLint configuration** — project now lints cleanly via `npm run lint` against `@typescript-eslint/recommended-requiring-type-checking`.

### Changed
- **Persistence schema bumped to v2.** `data.json` now stores `{ settings, conversations[], activeConversationId, schemaVersion: 2 }`. One-shot migration from v1 runs on load — see ADR-003.
- **Native /api/chat streaming.** Switched from OpenAI-compatible `/v1/chat/completions` to Ollama's native `/api/chat` for full timing stats — see ADR-001.
- **Obsidian conventions.** Migrated non-streaming calls to `requestUrl()`, void-wrapped floating promises, removed unnecessary type assertions, replaced inline `element.style.height` with `setCssProps` + CSS var, sentence-cased all UI strings — see ADR-002 for why the streaming call stays on `fetch`.

### Fixed
- Stream-switch guard prevents dropped tokens when switching conversations mid-stream (`Notice` surfaces the conflict).
- Empty-conversation filtering in `ConversationStore.toPersistable()` stops abandoned `+` clicks from bloating `data.json`.

## [0.1.0] — 2026-04-17

### Added
- Initial public release.
- Right-sidebar chat view backed by a remote Ollama server over `/v1/chat/completions` (OpenAI-compatible; changed to native in 0.2.0).
- Context modes: current note / current selection / linked notes / none.
- Slash commands (`/summarize`, `/expand`, `/rewrite`, `/brainstorm`) editable in settings.
- Per-note `ai:` frontmatter override for model and system prompt.
- Save-as-note and insert-into-note actions.
- Stats modal surfacing Ollama's timing fields per request.
- Native Obsidian look via theme CSS variables.
