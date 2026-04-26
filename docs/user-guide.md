# Ollama Notes Chat — User Guide

**Version 0.7.1** · Personal-use, local-first chat with your Obsidian vault via a remote Ollama server.

---

## Table of Contents

1. [Overview](#1-overview)
2. [The Chat Panel](#2-the-chat-panel)
3. [Context Modes](#3-context-modes)
4. [Conversation History](#4-conversation-history)
5. [Slash Commands](#5-slash-commands)
6. [Tool Use](#6-tool-use)
7. [Rewrite In Place](#7-rewrite-in-place)
8. [Retrieval (RAG)](#8-retrieval-rag)
9. [Save as Note](#9-save-as-note)
10. [Export Conversations](#10-export-conversations)
11. [Per-Note Overrides](#11-per-note-overrides)
12. [Stats Modal](#12-stats-modal)
13. [Settings Reference](#13-settings-reference)
14. [Keyboard Shortcuts & Commands](#14-keyboard-shortcuts--commands)
15. [Troubleshooting](#15-troubleshooting)

---

## 1. Overview

Ollama Notes Chat puts an AI chat panel in your right sidebar. It talks to an Ollama server on your LAN over Ollama's native `/api/chat` protocol — nothing leaves your network. All conversation history, embeddings, and settings live in your vault's plugin folder.

**What makes it different from a generic AI chat:**

- The AI can see your currently open note, your current text selection, your note's linked notes, or passages retrieved from anywhere in the vault — all without copy-pasting.
- It can read notes and list folders mid-conversation using built-in vault tools.
- You can dump the entire conversation into a proper Obsidian note or export it as Markdown/JSON for archiving.

---

## 2. The Chat Panel

### Opening the panel

- **Ribbon icon** — click the `messages-square` icon in the left ribbon.
- **Command palette** — search "Open chat".
- **Editor right-click menu** — "Chat about selection" opens the panel with the selected text pre-loaded as context.

### Header buttons (left to right)

| Icon | Label | What it does |
|---|---|---|
| `panel-left-open` | Chat history | Opens/closes the conversation history drawer |
| *(title area)* | Conversation title | Click or press Enter/Space to rename the current conversation |
| `plus` | New chat | Creates a new empty conversation |
| `trash-2` | Clear active chat | Deletes all messages from the current conversation (after confirmation) |
| `download` | Save as note | Saves the conversation to a Markdown file in your vault |
| `share-2` | Export conversations | Opens the export modal to export one or all conversations as Markdown or JSON |
| `settings` | Open plugin settings | Jumps to the plugin settings tab |

### Subheader (context mode pill)

The pill below the header shows the active context mode, e.g. "Current note". **Click it** (or press Enter/Space) to cycle through the five modes. The mode you choose applies to every message you send until you change it.

### Sending a message

Type in the composer at the bottom. Press **Enter** to send, **Shift+Enter** for a new line. The send button also works with a click.

While a response is streaming, the send button becomes a **stop button** — click it to halt generation mid-stream. The response up to that point is kept and labelled "(stopped)".

### Message actions

Each message bubble has a small toolbar that appears on hover:

- **Insert** — pastes the AI response text at your cursor in the active editor.
- **Regenerate** — removes the last assistant response and re-sends your previous message, letting you get a fresh reply.
- **Stats** — opens the Stats modal showing token counts and Ollama timing for that specific message.
- **Copy** — copies raw Markdown to the clipboard.

### Token budget bar

A thin bar at the bottom of the input area changes color as you approach the model's context limit:

- **Grey** — plenty of headroom.
- **Amber** — approaching the limit; context may be truncated soon.
- **Red** — over the configured limit; content will be clipped before sending.

The limit is set per-model (or falls back to **Default model context limit** in settings). Adjust the limit in settings if the estimate is wrong for your model.

---

## 3. Context Modes

Context mode controls what note content, if any, is injected before your message. Tap the subheader pill to cycle through them, or change the **Default context mode** in settings.

### No context

Nothing from your vault is sent. The AI answers from its own training knowledge. Useful for general-purpose questions, brainstorming, or when you don't want a note cluttering the prompt.

### Current note

The full content of whatever note is currently open in the editor is prepended to your message. By default this includes YAML frontmatter — disable that with **Include frontmatter in context** in settings.

If the note is longer than the **Truncation limit**, it is clipped with a warning in the chat. Raise the limit or switch to "Current selection" to work around this.

### Current selection

Only the text you have highlighted in the editor is sent. Useful when a note is long and you only want to ask about a specific section. If nothing is selected, the AI receives no context (same as "No context").

### Current + linked notes

The active note's content plus the content of every note it links to with `[[wikilinks]]` (one hop only). Good for synthesising a cluster of related notes — e.g., a project note that links to meeting notes, decisions, and references.

### Retrieved passages

The question you type is embedded and compared against every chunk in the vault's embeddings index. The most relevant passages (controlled by **Top-k passages** in settings) are retrieved and injected as context, with citations like `From [[Note#Heading]]` in the response. Click any citation to jump to the source.

This mode requires the RAG index to be built first. See [Section 8](#8-retrieval-rag).

---

## 4. Conversation History

The plugin keeps all your chats across sessions. Each conversation has a title, a timestamp, and a preview.

### Opening the history drawer

Click the `panel-left-open` icon or run the "Open chat history" command. The drawer slides in over the chat panel.

### In the drawer

- **Click any conversation row** to switch to it. The current conversation is highlighted.
- **Click the conversation title** inside a row to rename it inline.
- **Trash icon** on a row to delete that conversation (with confirmation).

### Titles

When you start a new conversation, the title is derived automatically from the first thing you type (slash-command prefixes like `/summarize` are stripped so you don't end up with a dozen chats all titled "/summarize…"). Once you rename a conversation manually, the auto-titler stops updating it.

### Empty conversations

A new empty chat is created when you press the `+` button or run "New chat". If you switch away without sending anything, the empty conversation is not saved — it disappears cleanly on next load.

---

## 5. Slash Commands

Slash commands are message templates triggered by typing `/` at the start of a message. They expand into full prompts before sending.

### Built-in commands

| Command | What it sends |
|---|---|
| `/summarize` | "Summarize the note in 3-5 concise bullet points." |
| `/expand` | "Expand the following idea…" then your text |
| `/rewrite` | "Rewrite the following for clarity and concision…" then your text |
| `/brainstorm` | "Brainstorm 8-10 diverse ideas related to…" then your text |

### Using a command

Type `/` in the composer. An autocomplete dropdown appears listing available commands. Continue typing to filter, then press Tab or click to select. Add any additional text after the command name — it substitutes into the `{{input}}` placeholder in the template.

Example: `/expand The Zettelkasten method is…` → sends the expand template with your text filled in.

### Managing commands

Go to **Settings → Slash commands**. Each command has a name field (what you type after `/`) and a template field.

- Use `{{input}}` in the template where you want the user's typed text to go.
- If there is no `{{input}}` in the template, the user's text is ignored and the template is sent as-is.
- Add commands with the "Add command" button; delete with the trash icon on any row.

**What to expect when you edit a command:** Changes apply immediately on your next `/` invocation. There is no confirmation; edits save on blur.

---

## 6. Tool Use

When enabled, the AI can autonomously call vault tools mid-conversation to fetch information it needs to answer your question — without you having to copy-paste anything.

### How it works

After you send a message, the model can respond with a tool call instead of (or before) its final answer. The plugin executes the tool, feeds the result back to the model, and the model continues. This loop runs up to **Max tool iterations** times, then forces a final text reply.

Each tool call renders as a collapsed "card" in the chat showing the tool name, its arguments, and the result (expandable). This keeps the conversation readable without hiding what the AI is doing.

### Available tools

| Tool | Description |
|---|---|
| `read_note` | Reads the full content of a specific note by its vault path |
| `list_folder` | Lists the files and subfolders in a vault folder |

Both are read-only. The AI cannot create, edit, or delete notes.

### Enabling tool use

Settings → Tools → **Enable tool use** toggle. Off by default because smaller models often produce malformed tool-call JSON, causing errors.

**What models support this:** Tool use requires a model that has been trained to emit the Ollama tool-call schema. `qwen2.5` (7B+), `llama3.1` (8B+), and `mistral-nemo` all work well. Small models like `phi3:3.8b` typically don't.

### Per-note disable

If a specific note should never trigger tool use (e.g., it contains sensitive content), add to its frontmatter:

```yaml
---
ai:
  toolsDisabled: true
---
```

### Max tool iterations

**Settings → Tools → Max tool iterations** (default 5, range 2–10). This is a safety cap — if the model keeps looping without giving a final text answer, the plugin cuts it off and forces a response. Raise it for complex multi-step tasks, lower it to keep costs and latency under control.

---

## 7. Rewrite In Place

The Rewrite feature lets you highlight text in any note, ask the AI to rewrite it, preview the diff, and accept or reject with a single click.

### Using it

1. Select text in the editor.
2. Open the command palette and run **"Rewrite selection"** (or assign a hotkey in **Settings → Hotkeys**). Alternatively, right-click the selection and choose "Chat about selection" and ask for a rewrite there.
3. The AI rewrites the selected text. A green/red inline diff appears in the editor showing what changed.
4. Click **Accept** to replace the text, or **Reject** to restore the original.

The document is not modified until you accept — the diff is purely visual.

### Rewrite vs. chat rewrite

The command-palette rewrite uses a dedicated, minimal system prompt focused on copy-editing (no chitchat, just the rewritten text). This is separate from the chat system prompt and has its own temperature setting.

**Settings → Rewrite:**

- **Rewrite system prompt** — what the AI is told before your text. Default: "You are a copy editor. Rewrite the user's text for clarity and concision…". Override this if you want a different voice (e.g., make it more formal, or translate).
- **Rewrite temperature** (default 0.3) — low = faithful to original, high = more creative. Raising it above 0.5 noticeably increases deviation from the source.

---

## 8. Retrieval (RAG)

Retrieval-Augmented Generation lets the AI pull relevant passages from anywhere in the vault to answer your question, rather than being limited to whatever note is currently open.

### How it works

1. Your vault notes are chunked into passages of ~800 characters (configurable).
2. Each chunk is embedded (converted to a vector of numbers) using a small embedding model on your Ollama server.
3. When you send a message in "Retrieved passages" mode, your query is also embedded and compared against every stored chunk using cosine similarity.
4. The top-K most similar chunks are injected into the prompt as context.
5. The AI's response includes `From [[Note#Heading]]` citations you can click.

### Building the index

- **Auto-index on load** (default: on) — the plugin walks the vault at startup and embeds any notes that have changed since the last index. This is incremental and typically fast after the first build.
- **Manual reindex** — Settings → Retrieval → **Reindex vault**. Use this after enabling retrieval for the first time, or after changing the embedder model or chunk settings. The button shows live progress; click "Cancel" to stop and resume later.
- **Incremental updates** — edits and renames to notes re-embed automatically with a 2-second debounce. You don't need to manually reindex after routine note editing.

The index is stored at `.obsidian/plugins/ollama-notes-chat/index.json`, separate from `data.json`. On a 2,000-note vault it is around 120 MB.

### Settings — Retrieval

| Setting | Default | What changing it does |
|---|---|---|
| **Embedder model** | `nomic-embed-text` | The Ollama model used to generate embeddings. Changing this invalidates the existing index — you must reindex. `nomic-embed-text` is small (274 MB) and fast. `mxbai-embed-large` gives better quality at ~670 MB. |
| **Top-k passages** | 5 | How many chunks are retrieved per query (1–15). More = richer context but larger prompt and slower responses. 3–5 is practical for most questions; raise to 8–10 for synthesis tasks. |
| **Chunk size (chars)** | 800 | Target size of each passage. Smaller = more precise citations but more chunks to compare. Larger = more context per chunk but citations are less specific. Requires a full reindex after changing. |
| **Chunk overlap (chars)** | 100 | How many characters of overlap between consecutive chunks, so sentences at chunk boundaries aren't split mid-thought. Requires a full reindex after changing. |
| **Auto-index on load** | On | Turn off if your vault is very large and startup time matters. You can still trigger reindex manually whenever you want. |

---

## 9. Save as Note

The `download` button in the header saves the current conversation to a Markdown file inside your vault.

### Output format

The file includes YAML frontmatter (creation time, update time, source note wikilink if applicable, and the tag `ollama-chat`) followed by the conversation as headings and paragraphs. System messages are omitted. Example:

```markdown
---
created: 2026-04-25T16:00:00.000Z
updated: 2026-04-25T16:30:00.000Z
source: "[[My Project Note]]"
tags: [ollama-chat]
---

### You

What are the main risks in this project?

### Ollama _(gemma3:27b)_

The three main risks are…
```

### Settings — Conversations

| Setting | Default | What changing it does |
|---|---|---|
| **Save folder** | `Chats` | Vault folder where saved files land. Use `/` for nested paths, e.g. `Archive/Chats`. The folder is created automatically if it doesn't exist. Never use `..` — it is rejected for security. |
| **Filename template** | `{{date}} — {{title}}` | Template for the filename. Variables: `{{date}}` (YYYY-MM-DD), `{{time}}` (HHmm), `{{title}}` (first ~40 chars of conversation title). If a file with that name already exists, ` (2)`, ` (3)` etc. are appended. |
| **Auto-save frequency (messages)** | 0 (off) | When set to N > 0, the conversation is automatically saved after every N user messages. The file is overwritten if it already exists from a prior auto-save. Set to 0 to disable. |

---

## 10. Export Conversations

The `share-2` button (or the **"Export conversations"** command in the palette) opens the Export modal, which offers more control than the one-click Save as Note.

### Format

- **Markdown** — same format as "Save as Note" (YAML frontmatter + conversation headings). One `.md` file is created per conversation.
- **JSON** — all selected conversations are written as a single JSON file (`ollama-export-YYYY-MM-DD.json`) containing the raw `ConversationSnapshot[]` array. Useful for programmatic processing, backups, or migrating data.

### Scope

| Scope | What is exported |
|---|---|
| **This conversation** | Only the currently active conversation. If the conversation is empty, export is blocked with a notice. |
| **All conversations** | Every non-empty conversation in the plugin's history. |
| **Date range** | Conversations whose "last updated" timestamp falls within the entered range (inclusive on both ends). Enter dates as YYYY-MM-DD. |

### Output folder

Pre-filled from **Settings → Export → Export folder**. You can change it per-export in the modal without affecting the saved setting.

### What to expect

- After clicking **Export**, a notice appears: "Exported N conversation(s) to Chats" (Markdown) or "Exported N conversations to Chats/ollama-export-2026-04-25.json" (JSON).
- If a file with the same name already exists, a ` (2)` / ` (3)` suffix is added automatically — no file is ever overwritten.
- If the date range is invalid (not YYYY-MM-DD), an error notice appears and the modal stays open.
- If no conversations match the scope (e.g., date range returns nothing), a notice says so and nothing is written.

### Settings — Export

| Setting | Default | What changing it does |
|---|---|---|
| **Export folder** | `Chats` | Default output folder for the export modal. Overridable per-export in the modal. Follows the same rules as Save folder. |
| **Default export format** | Markdown | Pre-selects the format dropdown in the modal. Does not prevent you from choosing the other format per-export. |

---

## 11. Per-Note Overrides

Any note can override global settings for conversations that use it as context. Add an `ai` block to the note's YAML frontmatter:

```yaml
---
ai:
  model: llama3.1:70b
  systemPrompt: "You are a code reviewer. Be precise and use examples."
  toolsDisabled: true
---
```

### Available override keys

| Key | Type | Effect |
|---|---|---|
| `model` | string | Uses this Ollama model instead of the global model for sends involving this note. |
| `systemPrompt` | string | Replaces the global system prompt when this note is the context source. |
| `toolsDisabled` | boolean | When `true`, disables tool use for this note even if globally enabled. |

Overrides only apply when the note is the **active context** (i.e., current-note, current-selection, or linked-notes modes using this note as the root). They have no effect in retrieval mode or no-context mode.

---

## 12. Stats Modal

Every assistant message has a **Stats** button (on hover). Click it to open a modal showing:

- **Model** — which model produced this response.
- **Token counts** — prompt tokens, completion tokens, total.
- **Timing** — total duration, load duration, prompt eval duration, eval duration (all in milliseconds and converted to seconds).
- **Speed** — tokens per second (completion tokens ÷ eval duration).

This is useful for comparing models, understanding latency, and diagnosing slow responses (e.g., "is it the prompt eval or the generation that's slow?").

---

## 13. Settings Reference

Open **Settings → Ollama Notes Chat** to configure everything. Sections are listed in the order they appear.

### Connection

| Setting | Default | Notes |
|---|---|---|
| **Base URL** | `http://localhost:11434` | Full URL including scheme and port. Must start with `http://` or `https://`. For a LAN server: `http://192.168.1.50:11434`. |
| **Test connection** | — | Pings `/api/tags` to verify the server is reachable and lists available models. Run this whenever you change the URL. The status shows "Connected — N models available" on success. |
| **Model** | (empty) | Chat model to use. Populated from the server after a successful test. Click the refresh icon to reload the list without running the full test. |

**What to expect when Base URL is wrong:** All chat requests fail with a network error. The token bar will show no limit (it falls back to the default context limit). Run Test connection to verify.

**What to expect when Model is empty:** The plugin cannot send any messages. Set the model or run Test → it auto-selects the first available model.

---

### Generation

| Setting | Default | Notes |
|---|---|---|
| **System prompt** | See default in settings | Prepended to every new conversation as a `system` role message. Changing this affects new conversations; existing ones keep whatever system message they were created with. |
| **Temperature** | 0.7 | 0 = deterministic, 1.5 = very creative. Values above 1.0 can produce incoherent output on some models. For factual Q&A, 0.2–0.4 is good; for creative writing, 0.8–1.2. |
| **Max tokens per response** | 2048 | Hard cap on how long a single reply can be. The model stops generating once it hits this. Raise it for long-form writing tasks; lower it to keep responses tight and reduce latency. |
| **Default model context limit (tokens)** | 8192 | Used purely for the token budget bar in the UI. Set this to match your model's actual context window. For example, `llama3.1:8b` has a 128k context window; set this to 131072 if you want the bar to reflect that. Changing this takes effect immediately in the UI (no restart). |

---

### Tools

| Setting | Default | Notes |
|---|---|---|
| **Enable tool use** | Off | Enables the model to call `read_note` and `list_folder` during a conversation. Only turn on with models that support it (`qwen2.5+`, `llama3.1+`). With unsupported models, you'll see tool-call errors in the chat. |
| **Max tool iterations** | 5 | Maximum number of tool-call rounds before the plugin forces a final text response. Prevents infinite loops. Raise to 8–10 for complex research tasks; lower to 2–3 to keep conversations snappy. |

---

### Rewrite

| Setting | Default | Notes |
|---|---|---|
| **Rewrite system prompt** | "You are a copy editor…" | The instruction given to the model for the rewrite-selection command. Change this to alter the rewrite style (e.g., "Make this more formal" or "Translate to Spanish"). |
| **Rewrite temperature** | 0.3 | Lower = stays closer to the original wording. Higher = more creative / divergent rewrites. Values above 0.7 can produce text that drifts significantly from the source. |

---

### Context

| Setting | Default | Notes |
|---|---|---|
| **Default context mode** | Current note | The mode selected when you first open a chat. You can always change it per-session with the subheader pill. |
| **Truncation limit (chars)** | 16,000 | If the injected context exceeds this, it is clipped and a warning appears in the chat. This is a character count, not a token count. Rough guide: 16,000 chars ≈ 4,000 tokens. Raise this if you're seeing truncation warnings on notes you want fully included. Lowering it speeds up responses by reducing context. |
| **Include frontmatter in context** | On | When on, YAML frontmatter is included in the note content sent to the model. Turn off if your frontmatter is large and noisy (e.g., lots of plugin-generated keys), or if you don't want the AI to see metadata like tags, dates, etc. |

---

### Retrieval

See [Section 8](#8-retrieval-rag) for a full explanation of each setting.

---

### Conversations

| Setting | Default | Notes |
|---|---|---|
| **Save folder** | `Chats` | Where "Save as note" creates files. See [Section 9](#9-save-as-note). |
| **Filename template** | `{{date}} — {{title}}` | Template for saved note filenames. Tokens: `{{date}}` (YYYY-MM-DD), `{{time}}` (HHmm), `{{title}}` (conversation title, truncated). |
| **Auto-save frequency (messages)** | 0 | When non-zero, auto-saves after every N user messages. 0 = disabled. |

---

### Export

| Setting | Default | Notes |
|---|---|---|
| **Export folder** | `Chats` | Default folder pre-filled in the Export modal. See [Section 10](#10-export-conversations). |
| **Default export format** | Markdown | Markdown or JSON. Pre-selects the format in the modal; you can override per-export. |

---

### Slash Commands

A list of all your slash commands. Each row has:

- **Name** — what you type after `/` in the composer.
- **Template** — the prompt that gets sent. Use `{{input}}` to inject any text you type after the command name.
- **Delete** — trash icon removes the command.

Changes save automatically on blur. New commands are added with the "Add command" button at the bottom.

---

### Appearance

| Setting | Default | Notes |
|---|---|---|
| **Compact mode** | Off | Reduces padding and line spacing in the chat list. Useful on small screens or when you want more messages visible at once. |
| **Font size** | Inherit | Override the text size in the chat panel. "Inherit" uses your vault's default font size. "Small" / "Medium" / "Large" apply fixed sizes. Takes effect immediately. |

---

## 14. Keyboard Shortcuts & Commands

No hotkeys are bound by default. Assign them in **Settings → Hotkeys** by searching "Ollama Notes Chat".

### Available commands

| Command ID | What it does |
|---|---|
| `ollama-notes-chat:open-panel` | Open the chat sidebar |
| `ollama-notes-chat:new-chat` | Create a new conversation and focus the input |
| `ollama-notes-chat:open-history` | Open the conversation history drawer |
| `ollama-notes-chat:clear-conversation` | Clear all messages in the active conversation |
| `ollama-notes-chat:export-conversations` | Open the Export modal (pre-set to "All conversations") |
| `ollama-notes-chat:rewrite-selection` | Rewrite the currently selected text with an inline diff |
| *(editor menu)* | Chat about selection | Right-click selected text → opens chat panel with selection as context |

---

## 15. Troubleshooting

### "Cannot reach server"
Ollama is not reachable from Obsidian. Check:
- `OLLAMA_HOST=0.0.0.0:11434` and `OLLAMA_ORIGINS=*` are set in the Ollama host's environment.
- Ollama was restarted after those variables were set.
- The IP in **Base URL** is correct and the host machine is on the same network.
- No firewall is blocking port 11434.

### Responses stop mid-stream or error partway
The model hit its context window or max-tokens limit. Try:
- Lower the context mode to "Current selection" to reduce prompt size.
- Raise **Max tokens per response** in settings.
- Check if the token bar was already amber/red before sending.

### Model dropdown is empty after test
The server responded but returned no models. Run `ollama list` on the host to confirm models are installed. Pull one with `ollama pull llama3.1:8b`.

### Retrieval context is empty / "Index is empty"
The RAG index hasn't been built yet. Go to **Settings → Retrieval → Reindex vault** and wait for the progress bar to complete.

### Retrieval returns stale results
The index debounces note changes by 2 seconds. If you need an immediate rebuild, click **Reindex vault** in settings.

### Retrieval shows "Embedding failed"
The embedder model (`nomic-embed-text` by default) is not available on the Ollama host. Pull it: `ollama pull nomic-embed-text`.

### Tool calls produce errors
The selected model doesn't support Ollama's tool-call schema. Switch to `qwen2.5:7b`, `llama3.1:8b`, or a larger capable model. Alternatively, disable tool use in settings.

### Auto-titles show "/summarize…"
This is expected if your first message is a slash command with no additional text. The slash command prefix is normally stripped from the auto-title, but if the template expansion produces no further user text, the title falls back to the raw message. Add a brief description after the slash command: `/summarize - Q3 strategy note`.

### Export shows "No conversations match that scope"
For date-range exports: verify your dates are in YYYY-MM-DD format and that at least one conversation has an "updated" timestamp within that range. Conversation timestamps are in UTC.

### Export folder ends up as "Chats" even when I set something else
The folder value `..` or any path containing `..` segments is rejected for security and falls back to `Chats`. Use a simple path like `Archive/Exports`.
