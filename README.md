# Ollama Notes Chat

A right-sidebar chat panel that lets you chat with your notes using a remote Ollama server over its native chat API. Local-first — nothing leaves your LAN.

## Features

- **Right-sidebar chat** — opens from the left ribbon (chat-bubble icon), the command palette, or the editor right-click menu.
- **Native Obsidian look** — styled with theme CSS variables, so it adapts to any light/dark theme automatically.
- **Streaming responses** — tokens arrive live over NDJSON.
- **Context modes** — chat about the current note, the current selection, the current note plus its one-hop linked notes, the whole current folder, retrieved passages from across the vault (RAG), or no context at all. Pick a mode from the **context dropdown** in the subheader.
- **Quick model switch** — a **model dropdown** in the subheader changes the active Ollama model on the fly, without opening settings.
- **Retrieval (RAG)** — embed your question and pull the most relevant passages from anywhere in the vault. Citations render as real `[[Note#Heading]]` links you can click. Index builds incrementally in the background; edits and renames re-embed automatically with a 2s debounce. Embedder model is configurable and independent from the chat model.
- **Markdown rendering** — AI responses are rendered with Obsidian's own Markdown renderer: code blocks, callouts, tables, and `[[wikilinks]]` all work.
- **Slash commands** — `/summarize`, `/expand`, `/rewrite`, `/brainstorm` out of the box, fully editable in settings.
- **Per-note overrides** — add `ai: { model: ..., systemPrompt: ... }` to a note's frontmatter to override global settings when chatting with that note.
- **Save as note** — dump the conversation to a Markdown file (`Chats/YYYY-MM-DD — <title>.md` by default).
- **Insert into note** — one click to paste an AI response at the cursor in the active editor.
- **Regenerate** — redo the last response with the same prompt.
- **Token estimate** — rough context-budget warning turns amber/red as you approach the model's limit.
- **Multi-session history** — keep as many parallel chats as you want. The header's history icon opens a drawer listing every conversation with its preview and "last updated" stamp; click any row to switch, click the title to rename in place, trash icon to delete. New chat via the `+` icon or command palette.
- **Auto-titled conversations** — new chats derive their title from your first message (slash-command prefix stripped). Manual rename sticks forever; the auto-titler never overwrites it.

## Screenshots

> _Screenshots pending capture. The shot list and exact filenames live in [`assets/README.md`](assets/README.md); drop the PNGs into `assets/` and uncomment the block below to enable this section._

<!-- Uncomment once the matching image files exist in assets/ (names must match assets/README.md):
| Chat sidebar | Settings |
| --- | --- |
| ![Chat sidebar](assets/chat-sidebar.png) | ![Settings](assets/settings.png) |

| RAG citations | Rewrite diff |
| --- | --- |
| ![RAG citations](assets/rag-citation.png) | ![Rewrite diff](assets/rewrite-diff.png) |

| History drawer |
| --- |
| ![History drawer](assets/history-drawer.png) |
-->

## Prerequisites

1. **Ollama running on another PC on your LAN.** On the host:

	```bash
	# macOS
	launchctl setenv OLLAMA_HOST "0.0.0.0:11434"
	launchctl setenv OLLAMA_ORIGINS "app://obsidian.md"
	# restart Ollama

	# Linux (systemd)
	sudo systemctl edit ollama.service
	# add under [Service]:
	#   Environment="OLLAMA_HOST=0.0.0.0:11434"
	#   Environment="OLLAMA_ORIGINS=app://obsidian.md"
	sudo systemctl restart ollama

	# Windows
	# Set OLLAMA_HOST=0.0.0.0:11434 and OLLAMA_ORIGINS=app://obsidian.md in System Environment Variables,
	# then restart the Ollama app.
	```

	Obsidian needs `OLLAMA_ORIGINS` set so it can make streaming `fetch` requests to Ollama across the LAN. **Prefer `app://obsidian.md`** — it scopes access to Obsidian only. `OLLAMA_ORIGINS=*` also works and is convenient for troubleshooting, but it's less restrictive, so avoid leaving it as `*` on a host exposed to your LAN. Comma-separate the value to allow multiple origins.

2. At least one Ollama chat model pulled, plus (if you want retrieval / RAG) an embedder model:

	```bash
	ollama pull llama3.1:8b           # chat
	ollama pull nomic-embed-text      # embedder — only needed for the retrieval context mode
	```

## Install

**From Obsidian's Community plugins browser (recommended):**

1. Open **Settings → Community plugins** and turn off Restricted mode if prompted.
2. Click **Browse**, search for **"Ollama Notes Chat"**, and click **Install**.
3. Click **Enable**.

Then configure it:

4. Open **Settings → Ollama Notes Chat**:
	- Set the **Base URL** to your Ollama host, e.g. `http://192.168.1.50:11434`.
	- Click **Test** — you should see "Connected — N models available".
	- Pick a model from the dropdown.
5. Click the chat-bubble icon in the left ribbon to open the sidebar, and start chatting.

## Build from source (development)

Only needed if you want to hack on the plugin or run an unreleased build. Requires Node.js (`brew install node` on macOS).

1. Clone and build:

	```bash
	git clone https://github.com/tdmarchetta/obsidian-ollama-notes-chat.git
	cd obsidian-ollama-notes-chat
	npm install
	npm run build
	```

	This produces `main.js` alongside `manifest.json` and `styles.css`.

2. Copy (or symlink) the plugin folder into your vault's plugins directory. The folder name must match the plugin id, `ollama-notes-chat`:

	```bash
	ln -s "/path/to/obsidian-ollama-notes-chat" \
	       "/path/to/vault/.obsidian/plugins/ollama-notes-chat"
	```

3. In Obsidian, open **Settings → Community plugins**, turn off Restricted mode if needed, reload plugins, and enable **Ollama Notes Chat**. Then set the Base URL as described above.

## Retrieval / RAG setup (optional)

If you want to chat with the whole vault instead of a single active note:

1. In **Settings → Ollama Notes Chat**, scroll to the **Retrieval** section.
2. Pick an **embedder model** from the dropdown (`nomic-embed-text` is the small, fast default). This is separate from your chat model.
3. Leave **auto-index on load** on (default) or click **Reindex vault** to build the index manually. Progress appears in the same panel.
4. In the chat view, open the **context dropdown** in the subheader and choose "Retrieved passages".
5. Ask a question. The response will include `From [[Note#Heading]]` citations you can click to jump to the source.

Index is stored at `.obsidian/plugins/ollama-notes-chat/index.json`. It updates incrementally when notes change (2-second debounce) and invalidates automatically if you change the embedder model. On large vaults the cold reindex can take several minutes — you can click Cancel at any time and resume later.

## Keyboard shortcuts

Obsidian doesn't bind a default hotkey — assign one in **Settings → Hotkeys** by searching for "Ollama Notes Chat". The most useful commands to bind: "Open chat", "New chat", and "Open chat history".

## Per-note overrides

In any note's frontmatter:

```yaml
---
ai:
  model: llama3.1:70b
  systemPrompt: "You are a code reviewer. Be blunt and specific."
---
```

When this note is the active context, the plugin uses these values instead of the global settings for that send.

## Troubleshooting

- **"Cannot reach server"** — check that Ollama is running and that `OLLAMA_HOST=0.0.0.0:11434` and `OLLAMA_ORIGINS=app://obsidian.md` are set on the host. Restart Ollama after setting them. (If it still won't connect, temporarily try `OLLAMA_ORIGINS=*` to rule out an origins issue.)
- **Streams but errors partway** — the response may have hit the model's context window or max-tokens limit. Raise max tokens in settings or use a larger model.
- **Model dropdown is empty** — click the refresh button next to it. If still empty, run `ollama list` on the host to verify models are installed.
- **Context is too long warning** — switch the context mode to "Current selection" to only include highlighted text, or raise the truncation limit in settings.
- **"Index is empty — run reindex in settings"** — retrieval mode is selected but no embeddings exist yet. Open settings, scroll to Retrieval, and click **Reindex vault**.
- **"Embedding failed — check your server is reachable"** — the embedder model isn't available on the Ollama host, or the host is down. Run `ollama list` on the host and pull `nomic-embed-text` if missing.
- **Retrieval returns stale results after edits** — edits debounce for 2 seconds before re-embedding. If you need an immediate rebuild, click Reindex vault.

## Architecture

- `main.ts` — plugin entry; registers the view, ribbon icon, commands, editor menu, settings tab. Owns the conversation store + persistence (including the one-shot 0.1.0 → 0.2.0 migration) and, since 0.3.0, the RAG vector store + indexer.
- `src/view/ChatView.ts` — the sidebar `ItemView` that owns the chat UI, streaming, and rendering.
- `src/view/HistoryDrawer.ts` — overlay controller for the multi-session history drawer (mounted inside the chat view, not a separate `ItemView`).
- `src/chat/ConversationStore.ts` — CRUD layer over `ConversationSnapshot[]`; filters empty conversations out of persistence.
- `src/chat/Conversation.ts` — per-conversation state, auto-titling, and `ConversationSnapshot` shape.
- `src/ollama/OllamaClient.ts` — `fetch`-based native `/api/chat` client with NDJSON streaming generator (keeps Ollama's timing fields for the stats modal) plus `requestUrl`-based `/api/embed` and `/api/tags`.
- `src/context/NoteContext.ts` — builds the context block from the active note/selection/linked notes/retrieved passages.
- `src/rag/Chunker.ts` — heading-first markdown chunker with fixed-size fallback.
- `src/rag/VectorStore.ts` — in-memory map, flat JSON persistence at `index.json`, atomic tmp+rename writes, inline cosine top-K.
- `src/rag/Indexer.ts` — vault walk, mtime-diff, batched embedding, debounced event handlers.
- `src/settings/` — typed settings, defaults, and the settings tab.
- `styles.css` — scoped under `.ollama-chat-view` / `.ollama-chat-settings`; uses only Obsidian theme variables.

## Changelog

Release history is in [CHANGELOG.md](CHANGELOG.md).

## Support

Ollama Notes Chat is free and open source. If it makes your notes more useful and you'd like to support continued development, you can buy me a coffee:

[☕ buymeacoffee.com/tdmarchetta](https://buymeacoffee.com/tdmarchetta)

100% of contributions go to the developer.

## License

MIT
