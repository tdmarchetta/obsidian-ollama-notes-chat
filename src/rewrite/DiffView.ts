// CodeMirror 6 is provided at runtime by Obsidian; esbuild externalizes these imports.
// eslint-disable-next-line import/no-extraneous-dependencies
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
// eslint-disable-next-line import/no-extraneous-dependencies
import { EditorSelection, Extension, StateEffect, StateField } from "@codemirror/state";
import type { DiffToken } from "./MyersDiff";

export interface PendingRange {
	from: number;
	to: number;
	requestId: number;
}

export interface DiffPayload {
	from: number;
	to: number;
	rewrite: string;
	tokens: DiffToken[];
	requestId: number;
}

export const setPendingEffect = StateEffect.define<PendingRange>();
export const clearPendingEffect = StateEffect.define<null>();
export const setDiffEffect = StateEffect.define<DiffPayload>();
export const clearDiffEffect = StateEffect.define<null>();

export const pendingField = StateField.define<PendingRange | null>({
	create: () => null,
	update(state, tr) {
		for (const ef of tr.effects) {
			if (ef.is(setPendingEffect)) return ef.value;
			if (ef.is(clearPendingEffect)) return null;
			if (ef.is(setDiffEffect)) return null;
		}
		if (state && tr.docChanged) {
			let touched = false;
			tr.changes.iterChangedRanges((fa, ta) => {
				if (fa <= state.to && ta >= state.from) touched = true;
			});
			if (touched) return null;
			return {
				...state,
				from: tr.changes.mapPos(state.from),
				to: tr.changes.mapPos(state.to),
			};
		}
		return state;
	},
});

class DiffReplaceWidget extends WidgetType {
	constructor(readonly payload: DiffPayload) {
		super();
	}

	eq(other: DiffReplaceWidget): boolean {
		return (
			other.payload.requestId === this.payload.requestId &&
			other.payload.from === this.payload.from &&
			other.payload.to === this.payload.to &&
			other.payload.rewrite === this.payload.rewrite
		);
	}

	toDOM(view: EditorView): HTMLElement {
		const container = document.createElement("span");
		container.className = "ollama-rewrite-diff";

		const body = document.createElement("span");
		body.className = "ollama-rewrite-diff-body";
		for (const tok of this.payload.tokens) {
			const span = document.createElement("span");
			if (tok.type === "equal") span.className = "ollama-rewrite-eq";
			else if (tok.type === "insert") span.className = "ollama-rewrite-ins";
			else span.className = "ollama-rewrite-del";
			span.textContent = tok.text;
			body.appendChild(span);
		}
		container.appendChild(body);

		const chips = document.createElement("span");
		chips.className = "ollama-rewrite-chips";

		const acceptBtn = document.createElement("button");
		acceptBtn.type = "button";
		acceptBtn.className = "ollama-rewrite-chip ollama-rewrite-chip-accept";
		acceptBtn.textContent = "Accept";
		acceptBtn.addEventListener("mousedown", (ev) => {
			ev.preventDefault();
			ev.stopPropagation();
			const field = view.state.field(diffField, false);
			if (!field || field.requestId !== this.payload.requestId) return;
			view.dispatch({
				changes: { from: field.from, to: field.to, insert: this.payload.rewrite },
				effects: clearDiffEffect.of(null),
				selection: EditorSelection.cursor(field.from + this.payload.rewrite.length),
				userEvent: "ollama.rewrite.accept",
			});
		});

		const rejectBtn = document.createElement("button");
		rejectBtn.type = "button";
		rejectBtn.className = "ollama-rewrite-chip ollama-rewrite-chip-reject";
		rejectBtn.textContent = "Reject";
		rejectBtn.addEventListener("mousedown", (ev) => {
			ev.preventDefault();
			ev.stopPropagation();
			view.dispatch({
				effects: clearDiffEffect.of(null),
				userEvent: "ollama.rewrite.reject",
			});
		});

		chips.appendChild(acceptBtn);
		chips.appendChild(rejectBtn);
		container.appendChild(chips);

		return container;
	}

	ignoreEvent(): boolean {
		return false;
	}
}

export const diffField = StateField.define<DiffPayload | null>({
	create: () => null,
	update(state, tr) {
		for (const ef of tr.effects) {
			if (ef.is(setDiffEffect)) return ef.value;
			if (ef.is(clearDiffEffect)) return null;
		}
		if (state && tr.docChanged) {
			let touched = false;
			tr.changes.iterChangedRanges((fa, ta) => {
				if (fa <= state.to && ta >= state.from) touched = true;
			});
			if (touched) return null;
			return {
				...state,
				from: tr.changes.mapPos(state.from),
				to: tr.changes.mapPos(state.to),
			};
		}
		return state;
	},
	provide: (f) =>
		EditorView.decorations.from(f, (payload) => {
			if (!payload) return Decoration.none;
			const widget = Decoration.replace({
				widget: new DiffReplaceWidget(payload),
				block: false,
			});
			return Decoration.set([widget.range(payload.from, payload.to)]);
		}),
});

export const rewriteExtension: Extension[] = [pendingField, diffField];
