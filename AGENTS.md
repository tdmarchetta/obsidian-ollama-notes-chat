# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

---

# AGENTS.md — Ollama Notes Chat

## What this project is

Obsidian right-sidebar plugin that chats with your notes via a remote Ollama server on the LAN. Local-first; started as a personal-use plugin and is now published in the Obsidian community plugin store — gallery submission [obsidianmd/obsidian-releases#12075](https://github.com/obsidianmd/obsidian-releases/pull/12075) was accepted on 2026-05-18, so `ollama-notes-chat` installs and auto-updates through Obsidian's in-app Community plugins browser. Detailed system design lives in [wiki/architecture.md](wiki/architecture.md); current-state dev guidance in [project.md](project.md); planned releases in [roadmap.md](roadmap.md); end-user docs in [docs/user-guide.md](docs/user-guide.md).

## Stack & conventions

- **TypeScript**, `lib: ["DOM", "ES2021"]`, CJS bundle via esbuild. Zero runtime deps in `main.js` (only `tslib` helpers); Obsidian + CodeMirror externalized at runtime.
- **Build:** `npm run build` (= `tsc -noEmit -skipLibCheck && esbuild`). The typecheck is the correctness gate. `npm run dev` runs esbuild in watch mode (rebuilds `main.js` on save, no typecheck).
- **Tests:** `npm test` (vitest, 90 tests over pure-logic modules; see [ADR-009](wiki/decisions/ADR-009-stability-audit-and-test-scaffold.md)); `npm run test:watch` for watch mode. Single file: `npx vitest run src/path/to/file.test.ts`. By test name: `npx vitest run -t "pattern"`. `vitest.config.ts` aliases the `obsidian` import to `test/obsidian-stub.ts` — tests run without the real Obsidian runtime, so a test needing an un-stubbed API must extend the stub first. That alias is why only pure-logic modules are covered.
- **Lint:** `npm run lint` (ESLint v9 flat + `eslint-plugin-obsidianmd/recommended` — same ruleset ObsidianReviewBot runs).
- **CSS** scoped under `.ollama-chat-view` / `.ollama-chat-settings`. Obsidian theme variables (`--background-primary`, `--text-normal`, `--interactive-accent`) only — never hardcoded colors. Class names are flat (`.ollama-chat-history-row--active`), not BEM.
- **Identifiers:** plugin id `ollama-notes-chat`, view type `ollama-notes-chat-view`, editor command `ollama-notes-chat:rewrite-selection`. Vault symlink folder name must match the plugin id.
- **Compatibility:** `minAppVersion` is `1.7.2` (uses `Workspace.revealLeaf` and `setTooltip`). Desktop-only.
- **Schemas:** persisted conversations at v2; RAG index at v1. `schemaVersion` lives in both blobs.
- **Streaming requires CORS** on the Ollama host (`OLLAMA_ORIGINS=*` or `app://obsidian.md`). `/api/embed` and `/api/tags` use `requestUrl()` and don't need it.

## Module map

`main.ts` is the `Plugin` entry point — registers the view, ribbon icon, commands, editor-menu item, and settings tab; owns conversation persistence (`data.json`, schema-v2 migration) and the RAG vector store + indexer. From there:

- **Chat UI** — `src/view/ChatView.ts`, the sidebar `ItemView` (streaming, Markdown rendering, context-mode pill). `HistoryDrawer`, `StatsModal`, `ExportModal`, `ConfirmModal` are overlays mounted inside it.
- **Conversations** — `src/chat/`: `Conversation.ts` (per-conversation state + auto-titling), `ConversationStore.ts` (CRUD over snapshots), `ExportConversation.ts` / `SaveAsNote.ts`, `SlashCommands.ts`.
- **Ollama I/O** — `src/ollama/OllamaClient.ts`: `fetch`-streamed `/api/chat` (NDJSON), `requestUrl`-based `/api/embed` + `/api/tags`; parses tool calls from model output.
- **Context** — `src/context/NoteContext.ts` builds the context block (active note / selection / one-hop linked notes / retrieved passages).
- **RAG** — `src/rag/`: `Chunker` (heading-first), `VectorStore` (flat JSON at `index.json`, cosine top-K), `Indexer` (vault walk, mtime-diff, debounced re-embed).
- **Rewrite** — `src/rewrite/`: `RewriteCommand` (editor command), `DiffView` (CM6 `Decoration.replace` preview), `MyersDiff`.
- **Tools** — `src/tools/`: `ToolLoop` (opt-in tool-call loop), `VaultTools` (pure-read vault functions).
- **TTS** — `src/tts/`: `SpeechPlayer` (`window.speechSynthesis`), `markdownToPlainText`.
- **Settings** — `src/settings/`: `Settings.ts` (typed defaults + `mergeSettings`), `SettingsTab.ts`.

## Current focus

**0.7.7 — citation disambiguation + tooling refresh.** Prepared but **not yet tagged** — the working tree is dirty on `main` (HEAD `241988f` = 0.7.6); version is already bumped to `0.7.7` in `manifest.json` / `package.json` / `versions.json`. Lint, typecheck, and build are green and **90 tests pass** (vitest 4). Contents:

- **Citation disambiguation** (`src/context/NoteContext.ts`) — the only user-facing change. When two vault notes share a basename, RAG citations are path-qualified with a display alias (`[[Work/Notes/Index#Goals|Index#Goals]]`) so they resolve to the right note; unambiguous names keep the clean `[[Note#Heading]]` form. `formatCitation()` is now exported and unit-tested (`src/context/NoteContext.test.ts`, +5 → 90 tests).
- **Build tooling** — esbuild `^0.20` → `^0.25`, vitest `^2` → `^4` (devDependencies only; `main.js` still ships zero runtime deps). The esbuild bump now builds the *released* `main.js` in CI, so smoke-load the bundle in Obsidian before publishing.
- **CI on every push** — `.github/workflows/ci.yml` runs lint + test + build + a prod-dep `npm audit` on pushes to `main` and PRs (complements the tag-triggered `release.yml` from 0.7.6).
- **Misc** — `package.json` `repository`/`bugs`/`homepage`; README overhaul (community-store install first; `OLLAMA_ORIGINS` now recommends scoped `app://obsidian.md`; Screenshots section pending image capture in `assets/`); this `AGENTS.md` Codex-context mirror added.

**Before tagging:** eyeball the citation feature in a vault with duplicate basenames (the integration is untested — the unit test only covers `formatCitation` in isolation), smoke-load the esbuild-0.25 bundle in Obsidian, and either capture the README screenshots or leave that section commented out. Then the per-release ritual (version bumps already done): commit → tag with the bare version (no `v`) → push the tag → review the CI-created draft release and publish it. Obsidian's updater distributes the published release with no per-release review.

0.7.6 (2026-05-18) was the **first CI-built, attested release** ([ADR-010](wiki/decisions/ADR-010-ci-release-attestation.md)) — no plugin code change; `main.js` / `manifest.json` / `styles.css` shipped byte-identical to 0.7.5. `minAppVersion` is `1.7.2`.

**Deferred** (was the planned 0.7.7, now unscheduled — see [roadmap.md](roadmap.md)): a code-health pass that roughly doubles the vitest suite onto `Conversation` / `SlashCommands` / `Settings` / `Chunker` / `NoteContext.finalize` and lands three behavior-preserving refactors — a shared `src/util/frontmatter.ts` (de-duping `stripFrontmatter()`), a `parseBoundedInt` helper for `SettingsTab`, and cached per-chunk vector norms in `VectorStore.topK()`. Also behind it: 0.2.1 (edit-and-resend + fork-from-message) and context-aware prompt templates.

## Key decisions

- [ADR-001: Use Ollama's native /api/chat](wiki/decisions/ADR-001-native-ollama-api.md) — for the timing fields the stats modal needs.
- [ADR-002: Streaming via fetch, not requestUrl](wiki/decisions/ADR-002-streaming-fetch.md) — `requestUrl()` buffers the body.
- [ADR-003: Multi-conversation schema v2](wiki/decisions/ADR-003-multi-conversation-schema.md) — and the stream-switch guard that goes with it.
- [ADR-004: RAG via flat JSON vector store](wiki/decisions/ADR-004-rag-retrieval.md) — index lives outside `data.json`.
- [ADR-005: Rewrite-in-place via CM6 Decoration.replace](wiki/decisions/ADR-005-rewrite-in-place-diff.md) — doc stays clean until Accept.
- [ADR-006: Tool use via native Ollama tools protocol](wiki/decisions/ADR-006-tool-use.md) — pure reads only for now.
- [ADR-007: Pre-GitHub security hardening pass](wiki/decisions/ADR-007-security-hardening.md).
- [ADR-008: External security audit review — no code change](wiki/decisions/ADR-008-security-audit-review.md).
- [ADR-009: Stability audit + vitest scaffold](wiki/decisions/ADR-009-stability-audit-and-test-scaffold.md).
- [ADR-010: CI-built releases with artifact attestation](wiki/decisions/ADR-010-ci-release-attestation.md) — release build + provenance moved into GitHub Actions.

## Do not

- Switch the chat endpoint back to OpenAI-compatible without a stats story (ADR-001).
- Move the streaming call from `fetch` to `requestUrl()` — kills live-token UX (ADR-002).
- Remove `ChatView`'s stream-switch guard without rewriting `appendToLast` to bind to a captured conv reference; tokens land in the wrong conversation (ADR-003). The same hazard covers the gaps *between* tool-loop iterations (ADR-006).
- Bundle embeddings into `data.json` — they belong in `index.json` (ADR-004). A 2k-note vault is ~120MB of floats.
- Inject synthetic block IDs into user notes for citation precision — heading-level is the intentional scope (ADR-004).
- Mutate the document during a rewrite preview; `Decoration.replace` keeps `state.doc` clean until Accept (ADR-005).
- Add write tools (`create_note`, `append_to_note`, `edit_note`) without designing a preview-and-approve UX first (ADR-006). Pure reads only until then.
- Re-attempt PDF export of conversations — Obsidian's "export to PDF" command isn't programmatically reachable; investigated and dropped for 0.7.1.
- Bump `schemaVersion` for additive optional fields on `Message`; `isSnapshot()` already tolerates them.
- Add `@codemirror/view` / `@codemirror/state` to `package.json` — Obsidian provides them at runtime; use `// eslint-disable-next-line import/no-extraneous-dependencies -- runtime-provided by Obsidian, externalized in esbuild` instead.
- Omit the `-- reason` description on any `eslint-disable` directive. The `obsidianmd/no-undescribed-eslint-disable` rule (which the gallery review bot runs) flags bare disables as errors.
- Reach for `globalThis`, bare `document`, bare timer functions, or `document.createElement` in plugin code. Use `activeDocument` for document references, `window.setTimeout` / `window.setInterval` / `window.requestAnimationFrame` for timers (the Obsidian rule wants `window.` for timer functions specifically — not `activeWindow.`), and the `createEl` / `createSpan` / `createDiv` helpers for element creation. The global `crypto.randomUUID` is fine without prefix.
- Add runtime npm deps. esbuild externalizes everything beyond `tslib` helpers.
- Commit `data.json`, `index.json`, `main.js`, `CLAUDE.md`, `project.md`, `roadmap.md`, `dependencies.md`, `changelog.md`, `raw/`, or `wiki/` — all gitignored as local context. (`AGENTS.md` itself is currently tracked, not gitignored.)
- Edit this file's shared sections without mirroring the change into `CLAUDE.md` — it is the gitignored Claude-facing copy of the same context, so the two drift apart if only one is updated.
- Loosen the URL scheme allow-list, NDJSON 8 MB buffer cap, prototype-pollution defense, path-traversal defenses, YAML / wikilink escape, vector-index validation, or `noopener,noreferrer` on `window.open` (ADR-007). Note: `sanitizeArgs` now applies pollution filtering at every depth, not just top-level (ADR-009 V6).
- Re-mitigate the LLM-tool-execution / prompt-injection audit findings; both were analyzed and accepted as not posing real risk under this plugin's threat model. The actual defenses (opt-in tool loop, visible chips, per-note disable, path sanitization, iteration cap) are already load-bearing (ADR-008).
- Re-flag the audit findings already investigated and rejected: percent-encoded path traversal, `topK()` ↔ `Indexer.upsert()` race, rewrite double-invocation race, `schemaVersion` type-coercion bypass, `appendToLast` wrong-reference (ADR-009).
- Build or upload release assets by hand — `.github/workflows/release.yml` is the only path that produces attested artifacts; a manually-built `main.js` ships without provenance (ADR-010).
