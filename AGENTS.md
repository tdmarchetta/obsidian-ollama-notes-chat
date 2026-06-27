# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

---

# AGENTS.md — Ollama Notes Chat

## What this project is

Obsidian right-sidebar plugin that chats with your notes via a remote Ollama server on the LAN. Local-first; published in the Obsidian community store (id `ollama-notes-chat`, auto-updates in-app). Deeper docs: [wiki/architecture.md](wiki/architecture.md), [project.md](project.md), [roadmap.md](roadmap.md), [docs/user-guide.md](docs/user-guide.md).

## Commands

- **Build:** `npm run build` — `tsc -noEmit -skipLibCheck` (typecheck = the correctness gate) then esbuild bundle. **Don't** remove `noEmit`.
- **Dev watch:** `npm run dev` — esbuild only, no typecheck.
- **Test:** `npm test` (all) · `npx vitest run <path>` (one file) · `npx vitest run -t "<pattern>"` (by name) · `npm run test:watch`.
- **Lint:** `npm run lint` — CI-only on the SynologyDrive mount (local `node_modules` can't resolve `eslint-plugin-obsidianmd` → `@microsoft/eslint-plugin-sdl`).

## Stack & conventions

- **TypeScript (strict)**, `lib: ["DOM", "ES2021"]`, CJS bundle via esbuild. `main.js` ships zero runtime deps (only `tslib`); Obsidian + CodeMirror externalized. `tsconfig` has `strict: true` + `noUncheckedIndexedAccess` (since 0.7.10) — don't weaken the flags. Index-access convention: in production code, guard or use a `??` fallback with a brief comment when the access is in-bounds by invariant; bare `!` assertions are fine in tests.
- **Build:** `npm run build` (`tsc -noEmit -skipLibCheck && esbuild`) — typecheck is the correctness gate; `tsc` is typecheck-only (`noEmit: true` in tsconfig — **don't remove it**: a bare emitting `tsc` litters a per-file `.js` beside every `.ts`/`.test.ts`, gitignored under `src|test/**/*.js`). `npm run dev` = esbuild watch (no typecheck).
- **Tests:** `npm test` (vitest). Single file: `npx vitest run path`; by name: `-t "pattern"`. `vitest.config.ts` aliases `obsidian` → `test/obsidian-stub.ts`, so only pure-logic modules are covered; a test needing an un-stubbed API must extend the stub first. Code using `window.*` timers needs `vi.stubGlobal("window", …)` — `Indexer.test.ts` shows the pattern (incl. fake-timer debounce tests).
- **Lint:** `npm run lint` (ESLint v10 flat + `eslint-plugin-obsidianmd/recommended` — same ruleset ObsidianReviewBot runs — plus `eslint-plugin-no-unsanitized`, which fails CI on unsafe DOM sinks like `innerHTML`).
- **Repo guardrails (since 2026-06-10):** `main` is branch-protected — PR with green `CI / check` required, **admins included**, and **branches must be up to date before merging**, so even doc-only changes go through a PR (no direct pushes) and dependabot/stacked PRs each need an `update-branch` → fresh-CI → merge cycle — they can't batch-merge, since landing one bumps the rest back to `BEHIND`. Dependabot alerts + weekly npm/actions bump PRs (`.github/dependabot.yml`, **14-day cooldown** — a version bump only opens once its target is ≥14 days old; security updates bypass it); CodeQL default setup scans push/PR.
- **CSS** scoped under `.ollama-chat-view` / `.ollama-chat-settings`; Obsidian theme variables only (never hardcoded colors); flat class names, not BEM.
- **Identifiers:** plugin id `ollama-notes-chat`, view type `ollama-notes-chat-view`, command `ollama-notes-chat:rewrite-selection`. Vault symlink folder must match the plugin id.
- **Compatibility:** `minAppVersion` `1.7.2` (`revealLeaf`, `setTooltip`). Desktop-only.
- **Schemas:** conversations v2, RAG index v1; `schemaVersion` lives in both blobs.
- **Streaming needs CORS** on the Ollama host (`OLLAMA_ORIGINS=app://obsidian.md`, or `*`). `/api/embed` + `/api/tags` use `requestUrl()` and don't.

## Module map

`main.ts` is the `Plugin` entry — registers view/ribbon/commands/editor-menu/settings; owns conversation persistence (`data.json`, schema-v2 migration) and the RAG vector store + indexer.

- **Chat UI** — `src/view/ChatView.ts`, the sidebar `ItemView` (streaming, Markdown render, context/model picker dropdowns); `HistoryDrawer`/`StatsModal`/`ExportModal`/`ConfirmModal` are overlays inside it.
- **Conversations** — `src/chat/`: `Conversation`, `ConversationStore`, `ExportConversation`/`SaveAsNote`, `SlashCommands`.
- **Ollama I/O** — `src/ollama/OllamaClient.ts`: `fetch`-streamed `/api/chat` (NDJSON), `requestUrl` `/api/embed`+`/api/tags`; parses tool calls.
- **Context** — `src/context/NoteContext.ts`: builds the context block (active note / selection / one-hop links / retrieved passages); `formatCitation` path-qualifies duplicate basenames.
- **RAG** — `src/rag/`: `Chunker` (heading-first), `VectorStore` (flat JSON `index.json`, cosine top-K), `Indexer` (vault walk, mtime-diff, debounced re-embed).
- **Rewrite** — `src/rewrite/`: `RewriteCommand`, `DiffView` (CM6 `Decoration.replace`), `MyersDiff`.
- **Tools** — `src/tools/`: `ToolLoop` (opt-in), `VaultTools` (pure reads).
- **TTS** — `src/tts/`: `SpeechPlayer`, `markdownToPlainText`.
- **Settings** — `src/settings/`: `Settings.ts` (defaults + `mergeSettings`), `SettingsTab.ts`.
- **Util** — `src/util/`: pure `obsidian`-free helpers (`frontmatter.ts`, `parseBoundedInt.ts`), unit-testable.

## Current focus

**Latest: 0.7.15** (published 2026-06-26; `main` at #29, 238 tests) — maintenance: eslint 9 → 10 (#20, dev-only) + path-escape `assertWithinFolder` dedup (#28). No user-facing behavior change. Full per-release history (0.1.0 → 0.7.15) lives in [CHANGELOG.md](CHANGELOG.md); the durable release gotchas it doesn't capture:

- **`npm ci`, not `npm install`, before tagging** — `install` hides a drifted lock; CI runs `ci`. The lockfile's two root `version` fields must match the bump or `npm ci` fails.
- **Release branches can be stacked** — a release PR can auto-target the prior `release/*` instead of `main`; check `gh pr view N --json baseRefName` before merging, then verify `main`'s manifest (0.7.11's first PR mis-merged into `release/0.7.10`).
- **A dev-dep type bump can surface a new `@typescript-eslint/no-deprecated` error** (e.g. obsidian 1.13.1 deprecating `setDynamicTooltip`) — fix the deprecation, which also unblocks the bump; never disable the rule.
- **`obsidianmd/ui/sentence-case` rejects brand capitalization in UI strings** — a `Notice` saying "Ollama" mid-sentence fails CI; use "the server".
- **Local ESLint can't run on this working copy** — the SynologyDrive mount's `node_modules` can't resolve `eslint-plugin-obsidianmd` → `@microsoft/eslint-plugin-sdl`; typecheck/test/build run via `node`, lint is CI-only here.

**Directory status (verified 2026-06-26):** listed in `obsidian-releases`/`community-plugins.json` (id `ollama-notes-chat`), not in any removed list — **no active delisting**. The 0.7.7 `eslint-disable @typescript-eslint/no-deprecated` worry was fixed in 0.7.9 and is clean through 0.7.12; the entry just carries Obsidian's boilerplate `- This plugin has not been manually reviewed by Obsidian staff.` disclaimer that ~46% of the directory (2256/4865) shares — benign, removable only via an optional manual staff review. `obsidian-releases` now has PRs disabled; submissions/review go through the `community.obsidian.md` dashboard, so there is no thread to chase. Deferred: 0.2.1 (edit-and-resend + fork-from-message); context-aware prompt templates. **Dependency policy (2026-06-26): 14-day cooldown** (`dependabot.yml`) — bump only to versions ≥14 days old. eslint 10.5.0 cleared the cooldown on 06-26 (published 06-12) and merged (#20) into 0.7.15. Still cooldown-blocked, left open: vitest 4.1.9 (eligible 06-29), actions/checkout v7 (07-02), @types/node 26 (07-08). The two past-cooldown bumps that fail CI — TypeScript 6 (#18, vs `strict`+`noUncheckedIndexedAccess`) and eslint-plugin-obsidianmd 0.3.0 (#7, new review-bot rules) — were **closed** per the hygiene policy (dependabot reopens when due), not held for migration.

## Key decisions

- [ADR-001](wiki/decisions/ADR-001-native-ollama-api.md): native `/api/chat` — for the stats-modal timing fields.
- [ADR-002](wiki/decisions/ADR-002-streaming-fetch.md): stream via `fetch`, not `requestUrl` (which buffers the body).
- [ADR-003](wiki/decisions/ADR-003-multi-conversation-schema.md): multi-conversation schema v2 + stream-switch guard.
- [ADR-004](wiki/decisions/ADR-004-rag-retrieval.md): RAG via flat JSON vector store, outside `data.json`.
- [ADR-005](wiki/decisions/ADR-005-rewrite-in-place-diff.md): rewrite-in-place via CM6 `Decoration.replace`.
- [ADR-006](wiki/decisions/ADR-006-tool-use.md): tool use via native Ollama protocol — pure reads only.
- [ADR-007](wiki/decisions/ADR-007-security-hardening.md): pre-GitHub security hardening.
- [ADR-008](wiki/decisions/ADR-008-security-audit-review.md): external audit review — no code change.
- [ADR-009](wiki/decisions/ADR-009-stability-audit-and-test-scaffold.md): stability audit + vitest scaffold.
- [ADR-010](wiki/decisions/ADR-010-ci-release-attestation.md): CI-built releases with provenance attestation.

## Do not

- Switch the chat endpoint to OpenAI-compatible without a stats story (ADR-001).
- Move streaming from `fetch` to `requestUrl()` — kills live tokens (ADR-002).
- Remove `ChatView`'s stream-switch guard unless `appendToLast` binds to a captured conv ref — tokens land in the wrong conversation (ADR-003; same hazard between tool-loop iterations, ADR-006).
- Bundle embeddings into `data.json` — they belong in `index.json` (ADR-004; a 2k-note vault ≈ 120MB of floats).
- Inject synthetic block IDs for citation precision — heading-level is the intended scope (ADR-004).
- Mutate the doc during a rewrite preview — `Decoration.replace` keeps `state.doc` clean until Accept (ADR-005).
- Add write tools (`create_note`/`append_to_note`/`edit_note`) without a preview-and-approve UX first (ADR-006). Pure reads only. **Trigger condition:** ADR-008's accepted-risk verdict on prompt injection is conditional on tools staying read-only and opt-in — re-run that analysis before shipping write tools *or* prompt-template variable injection.
- Re-attempt conversation PDF export — Obsidian's command isn't programmatically reachable (dropped 0.7.1).
- Bump `schemaVersion` for additive optional `Message` fields — `isSnapshot()` tolerates them.
- Add `@codemirror/*` to `package.json` — runtime-provided; use `// eslint-disable-next-line import/no-extraneous-dependencies -- runtime-provided by Obsidian, externalized in esbuild`.
- Write a bare `eslint-disable` — always add `-- reason` (`obsidianmd/no-undescribed-eslint-disable` errors otherwise).
- **Disable `@typescript-eslint/no-deprecated`** — the community-directory review bot rejects it outright (it delisted 0.7.7 for exactly this). Fix the deprecation instead: e.g. `ButtonComponent.setWarning()` → `.setClass("mod-warning")` (since 0.9.7); don't reach for `setDestructive()` (1.13.0 > `minAppVersion` 1.7.2). Local lint is type-aware (`parserOptions.project`), so it catches deprecated calls — never silence them.
- Use `globalThis` / bare `document` / bare timers / `document.createElement`. Use `activeDocument`, `window.setTimeout|setInterval|requestAnimationFrame` (the rule wants `window.`, not `activeWindow.`), and `createEl`/`createSpan`/`createDiv`. `crypto.randomUUID` is fine bare.
- Add runtime npm deps — esbuild externalizes everything beyond `tslib`.
- **Merge a dependency bump whose target version is <14 days old** — a 14-day cooldown (`dependabot.yml`) enforces it so a freshly-published (possibly compromised or half-baked) release ages out first; take the latest version that's ≥14 days old. Security updates bypass the cooldown.
- Commit `data.json`, `index.json`, `main.js`, `CLAUDE.md`, `project.md`, `roadmap.md`, `dependencies.md`, `changelog.md`, `raw/`, `wiki/` — gitignored local context (`AGENTS.md` itself is tracked). Stray compiled `.js` are gitignored too (`src/**/*.js`, `test/**/*.js`, `vitest.config.js` — tsc-emit artifacts since 0.7.12; never commit them).
- Edit a shared section here without mirroring into `CLAUDE.md` (the gitignored Claude copy; `AGENTS.md` is committed).
- Loosen ADR-007 defenses: URL-scheme allow-list, NDJSON 8 MB cap, prototype-pollution filter (applied at every depth — ADR-009 V6), path-traversal defenses, YAML/wikilink escape, vector-index validation, `noopener,noreferrer` on `window.open`.
- Re-litigate accepted audit findings: LLM-tool-execution / prompt-injection (defenses are load-bearing — ADR-008); percent-encoded traversal, `topK()`↔`Indexer.upsert()` race, rewrite double-invocation, `schemaVersion` coercion, `appendToLast` wrong-ref (ADR-009).
- Build/upload release assets by hand — `release.yml` is the only attested path (ADR-010).
- **Land a `manifest.json`/`versions.json` version bump on `main` before that version's release is published.** Obsidian reads the branch manifest and shows a phantom, undownloadable update ("manifest points at X but no release published"). Bump on a branch; merge + tag + publish together. A draft doesn't count as published. Full per-release ritual (gates + manual smoke list + ship sequence): [docs/release-checklist.md](docs/release-checklist.md). The lockfile's two root `version` fields must match the bump (`npm ci` fails otherwise).
