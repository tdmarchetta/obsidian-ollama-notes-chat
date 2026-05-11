// Thin wrapper around the browser-native Web Speech API
// (window.speechSynthesis). Single-utterance model: starting a new
// playback cancels any in-progress one. Listeners are notified on every
// state change so UI can keep buttons in sync.

type ChangeListener = () => void;

export class SpeechPlayer {
	private currentId: string | null = null;
	private listeners = new Set<ChangeListener>();

	/**
	 * True if the browser exposes a usable speechSynthesis API. Always
	 * check this before showing TTS UI — Obsidian on some platforms may
	 * lack it.
	 */
	static isSupported(): boolean {
		return typeof window !== "undefined" && typeof window.speechSynthesis !== "undefined";
	}

	/**
	 * Begin speaking `text` for the message identified by `id`. Cancels
	 * any current playback first. No-op if the text is empty or the
	 * platform lacks speechSynthesis.
	 */
	speak(id: string, text: string): void {
		this.stop();
		const trimmed = text.trim();
		if (trimmed.length === 0) return;
		if (!SpeechPlayer.isSupported()) return;

		const u = new SpeechSynthesisUtterance(trimmed);
		u.onend = () => this.handleFinish(id);
		u.onerror = () => this.handleFinish(id);
		this.currentId = id;
		window.speechSynthesis.speak(u);
		this.emit();
	}

	stop(): void {
		if (this.currentId === null) return;
		if (SpeechPlayer.isSupported()) {
			window.speechSynthesis.cancel();
		}
		this.currentId = null;
		this.emit();
	}

	isSpeaking(id: string): boolean {
		return this.currentId === id;
	}

	onChange(fn: ChangeListener): () => void {
		this.listeners.add(fn);
		return () => {
			this.listeners.delete(fn);
		};
	}

	private handleFinish(id: string): void {
		// Guard against races where stop() already moved us on.
		if (this.currentId !== id) return;
		this.currentId = null;
		this.emit();
	}

	private emit(): void {
		for (const fn of this.listeners) fn();
	}
}
