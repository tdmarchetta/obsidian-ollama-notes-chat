# Ollama Chat for Obsidian

A right-sidebar chat panel that lets you chat with your notes using a remote Ollama server over its OpenAI-compatible API. Personal-use, local-first — nothing leaves your LAN.

## Features

- **Right-sidebar chat** — opens from the left ribbon (chat-bubble icon), the command palette, or the editor right-click menu.
- **Native Obsidian look** — styled with theme CSS variables, so it adapts to any light/dark theme automatically.
- **Streaming responses** — tokens arrive live via SSE.
- **Context modes** — chat about the current note, the current selection, the current note plus its one-hop linked notes, or no context at all. Tap the subheader to cycle modes.
- **Markdown rendering** — AI responses are rendered with Obsidian's own markdown renderer: code blocks, callouts, tables, and `[[wikilinks]]` all work.
- **Slash commands** — `/summarize`, `/expand`, `/rewrite`, `/brainstorm` out of the box, fully editable in settings.
- **Per-note overrides** — add `ai: { model: ..., systemPrompt: ... }` to a note's frontmatter to override global settings when chatting with that note.
- **Save as note** — dump the conversation to a markdown file (`Chats/YYYY-MM-DD — <title>.md` by default).
- **Insert into note** — one click to paste an AI response at the cursor in the active editor.
- **Regenerate** — redo the last response with the same prompt.
- **Token estimate** — rough context-budget warning turns amber/red as you approach the model's limit.
- **Conversation persists** across sidebar close/reopen.

## Prerequisites

1. **Ollama running on another PC on your LAN.** On the host:

	```bash
	# macOS
	launchctl setenv OLLAMA_HOST "0.0.0.0:11434"
	launchctl setenv OLLAMA_ORIGINS "*"
	# restart Ollama

	# Linux (systemd)
	sudo systemctl edit ollama.service
	# add under [Service]:
	#   Environment="OLLAMA_HOST=0.0.0.0:11434"
	#   Environment="OLLAMA_ORIGINS=*"
	sudo systemctl restart ollama

	# Windows
	# Set OLLAMA_HOST=0.0.0.0:11434 and OLLAMA_ORIGINS=* in System Environment Variables,
	# then restart the Ollama app.
	```

	`OLLAMA_ORIGINS=*` is required so Obsidian can make streaming `fetch` requests to Ollama across the LAN. If you want tighter security, set it to `app://obsidian.md` instead (comma-separate for multiple values).

2. At least one Ollama model pulled:

	```bash
	ollama pull llama3.1:8b
	```

3. Node.js on your Mac (only needed once, to build this plugin):

	```bash
	brew install node
	```

## Install

1. Build the plugin:

	```bash
	cd "/path/to/Obsidian_Plugin_Ollama_Chat"
	npm install
	npm run build
	```

	This produces `main.js` alongside `manifest.json` and `styles.css`.

2. Copy (or symlink) the plugin folder into your vault's plugins directory:

	```bash
	ln -s "/path/to/Obsidian_Plugin_Ollama_Chat" \
	       "/path/to/vault/.obsidian/plugins/ollama-chat"
	```

3. In Obsidian, open **Settings → Community plugins**, turn off restricted mode if needed, reload plugins, and enable **Ollama Chat**.

4. Open **Settings → Ollama Chat**:
	- Set the **Base URL** to your Ollama host, e.g. `http://192.168.1.50:11434`.
	- Click **Test** — you should see "Connected — N models available".
	- Pick a model from the dropdown.

5. Click the chat-bubble icon in the left ribbon to open the sidebar, and start chatting.

## Keyboard shortcuts

Obsidian doesn't bind a default hotkey — assign one in **Settings → Hotkeys** by searching for "Ollama Chat".

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

- **"Cannot reach server"** — check that Ollama is running and that `OLLAMA_HOST=0.0.0.0:11434` and `OLLAMA_ORIGINS=*` are set on the host. Restart Ollama after setting them.
- **Streams but errors partway** — the response may have hit the model's context window or max-tokens limit. Raise max tokens in settings or use a larger model.
- **Model dropdown is empty** — click the refresh button next to it. If still empty, run `ollama list` on the host to verify models are installed.
- **Context is too long warning** — switch the context mode to "Current selection" to only include highlighted text, or raise the truncation limit in settings.

## Architecture

- `main.ts` — plugin entry; registers the view, ribbon icon, commands, editor menu, and settings tab.
- `src/view/ChatView.ts` — the sidebar `ItemView` that owns the chat UI, streaming, and rendering.
- `src/ollama/OllamaClient.ts` — `fetch`-based OpenAI-compatible client with streaming generator.
- `src/context/NoteContext.ts` — builds the context block from the active note/selection/linked notes.
- `src/chat/` — conversation state, slash commands, save-as-note.
- `src/settings/` — typed settings, defaults, and the settings tab.
- `styles.css` — scoped under `.ollama-chat-view` / `.ollama-chat-settings`; uses only Obsidian theme variables.

## Support

Ollama Notes Chat is free and open source. If it makes your notes more useful and you'd like to support continued development, you can buy me a coffee:

[☕ buymeacoffee.com/tdmarchetta](https://buymeacoffee.com/tdmarchetta)

100% of contributions go to the developer.

## License

MIT
