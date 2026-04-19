import { Editor, MarkdownView, Notice } from "obsidian";
import type { EditorView } from "@codemirror/view";
import type OllamaChatPlugin from "../../main";
import { getPerNoteOverride } from "../context/NoteContext";
import { contextLimitForModel } from "../settings/Settings";
import {
	clearDiffEffect,
	clearPendingEffect,
	diffField,
	pendingField,
	setDiffEffect,
	setPendingEffect,
} from "./DiffView";
import { diff } from "./MyersDiff";

const MAX_SELECTION_CHARS = 8_000;
const inFlight = new WeakMap<EditorView, number>();
let nextRequestId = 1;

export function registerRewriteCommand(plugin: OllamaChatPlugin): void {
	plugin.addCommand({
		id: "rewrite-selection",
		name: "Rewrite selection",
		editorCallback: (editor: Editor, view: MarkdownView) => {
			void runRewrite(plugin, editor, view);
		},
	});
}

async function runRewrite(
	plugin: OllamaChatPlugin,
	editor: Editor,
	mdView: MarkdownView,
): Promise<void> {
	const cm = getCm(editor);
	if (!cm) {
		new Notice("Open this note in live-preview or source view first.");
		return;
	}

	const selection = editor.getSelection();
	if (!selection || selection.trim().length === 0) {
		new Notice("Select some text to rewrite first.");
		return;
	}
	if (selection.length > MAX_SELECTION_CHARS) {
		new Notice(`Selection too long (${selection.length} chars, max ${MAX_SELECTION_CHARS}).`);
		return;
	}

	if (inFlight.has(cm)) {
		new Notice("A rewrite is already in progress — accept or reject first.");
		return;
	}
	if (cm.state.field(diffField, false)) {
		new Notice("Accept or reject the current rewrite before starting another.");
		return;
	}

	const override = getPerNoteOverride(plugin.app, mdView.file);
	if (override.rewriteDisabled) {
		new Notice("Rewrite is disabled by this note's frontmatter.");
		return;
	}

	if (!plugin.settings.model) {
		new Notice("Pick a model in settings first.");
		return;
	}

	const fromPos = editor.getCursor("from");
	const toPos = editor.getCursor("to");
	const from = editor.posToOffset(fromPos);
	const to = editor.posToOffset(toPos);
	const requestId = nextRequestId++;

	cm.dispatch({
		effects: setPendingEffect.of({ from, to, requestId }),
	});
	inFlight.set(cm, requestId);

	const loading = new Notice("Rewriting…", 0);
	const model = override.model ?? plugin.settings.model;
	const systemPrompt =
		override.rewriteSystemPrompt ?? plugin.settings.rewriteSystemPrompt;

	try {
		const response = await plugin.ollama.chatOnce({
			model,
			temperature: plugin.settings.rewriteTemperature,
			maxTokens: Math.min(
				plugin.settings.maxTokens,
				contextLimitForModel(plugin.settings, model),
			),
			messages: [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: selection },
			],
		});
		loading.hide();

		const current = inFlight.get(cm);
		if (current !== requestId) {
			return;
		}
		const pending = cm.state.field(pendingField, false);
		if (!pending || pending.requestId !== requestId) {
			new Notice("Rewrite cancelled — document changed.");
			return;
		}

		const rewrite = stripFences(response).trim();
		if (!rewrite) {
			new Notice("Rewrite returned empty text.");
			cm.dispatch({ effects: clearPendingEffect.of(null) });
			return;
		}
		if (rewrite === selection.trim()) {
			new Notice("No changes proposed.");
			cm.dispatch({ effects: clearPendingEffect.of(null) });
			return;
		}

		const tokens = diff(selection, rewrite);
		cm.dispatch({
			effects: setDiffEffect.of({
				from: pending.from,
				to: pending.to,
				rewrite,
				tokens,
				requestId,
			}),
		});
	} catch (err) {
		loading.hide();
		const msg = err instanceof Error ? err.message : String(err);
		new Notice(`Rewrite failed: ${msg}`, 6000);
		cm.dispatch({ effects: clearPendingEffect.of(null) });
		// Also clear any stale diff
		if (cm.state.field(diffField, false)) {
			cm.dispatch({ effects: clearDiffEffect.of(null) });
		}
	} finally {
		if (inFlight.get(cm) === requestId) {
			inFlight.delete(cm);
		}
	}
}

function getCm(editor: Editor): EditorView | null {
	const maybe = (editor as unknown as { cm?: EditorView }).cm;
	return maybe ?? null;
}

function stripFences(s: string): string {
	let out = s.trim();
	const fenceStart = /^```[a-zA-Z0-9_-]*\n/;
	const fenceEnd = /\n```$/;
	if (fenceStart.test(out) && fenceEnd.test(out)) {
		out = out.replace(fenceStart, "").replace(fenceEnd, "");
	}
	return out;
}
