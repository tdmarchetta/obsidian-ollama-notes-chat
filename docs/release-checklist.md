# Release checklist

Per-release ritual for Ollama Notes Chat. The automated gates catch what unit
tests can reach; the smoke list covers the UI/editor surfaces that structurally
can't be unit-tested (they need the real Obsidian runtime — `ChatView`,
`DiffView`, modals).

## Automated gates (all must be green)

- [ ] `npm run lint` — type-aware; zero `eslint-disable` of `@typescript-eslint/no-deprecated`
- [ ] `npm run build` — `tsc -noEmit` strict typecheck + production esbuild
- [ ] `npm test` — full vitest suite
- [ ] `npm ci` succeeds — lockfile in sync, **including the two root `version` fields** (they must match the bump or CI fails)
- [ ] `manifest.json` / `package.json` / `versions.json` all equal the intended tag

## Manual smoke test (~5 min, in a real vault)

Load the built plugin (symlinked vault, `Cmd+R` after build):

- [ ] **Stream + stop** — send a prompt, watch live tokens, hit stop mid-stream; the partial message is kept and marked stopped
- [ ] **Switch-while-streaming guard** — try switching/creating/deleting a conversation mid-stream; a Notice refuses
- [ ] **Context modes** — cycle the pill through all five modes; send once with active-note context and confirm the note text reaches the model
- [ ] **RAG retrieval** — retrieval mode with an indexed vault: citations render as clickable `[[Note#Heading]]` links that open the right note (duplicate-basename citation resolves correctly)
- [ ] **Rewrite** — select a paragraph, run "Rewrite selection", check the inline diff renders, then Accept once / Reject once (doc untouched on reject; single undo entry on accept)
- [ ] **Tool use** (if a tool-capable model is available) — enable tools, ask something that triggers `read_note`; chips render and expand
- [ ] **Export** — export current conversation as Markdown and JSON; files land in the export folder
- [ ] **Save as note** — save a conversation; frontmatter is valid YAML
- [ ] **TTS** — speaker button reads a response aloud (and stops)
- [ ] **Settings pane** — open settings, change a numeric field, confirm it persists after `Cmd+R`

## Ship sequence (merge + tag + publish together — no phantom window)

1. PR into `main` — **verify the base is `main`, not the parent `release/*`** (`gh pr view N --json baseRefName`): release branches are stacked, so a release PR auto-targets the branch it was cut from (0.7.11's first PR mis-merged into `release/0.7.10`). CI green, merge, then confirm `main`'s manifest actually updated.
2. `git tag X.Y.Z && git push origin X.Y.Z` (bare version, no `v`)
3. `release.yml` builds, attests, opens a **draft** release — verify the three assets (`main.js`, `manifest.json`, `styles.css`)
4. **Publish the draft promptly** — the manifest bump is now on `main`, so an unpublished draft shows users a phantom update
5. Spot-check provenance: `gh attestation verify main.js --repo tdmarchetta/obsidian-ollama-notes-chat`
