/**
 * Reduce a vault-relative note path to its display name.
 *
 * Takes the last path segment and strips a trailing `.md` extension, e.g.
 * `"A/B/Project Roadmap.md"` → `"Project Roadmap"`. Returns `null` when nothing
 * usable remains (empty input, a path ending in `/`).
 *
 * Pure and `obsidian`-free so it can be unit-tested directly. Used by
 * `deriveAutoTitle()` to title note-centric chats (e.g. a bare `/summarize`) by
 * the note they're about rather than the slash-command literal.
 */
export function noteBasename(path: string): string | null {
	const seg = path.split("/").pop() ?? path;
	const base = seg.replace(/\.md$/i, "").trim();
	return base.length > 0 ? base : null;
}
