/**
 * Strip a leading YAML frontmatter block from raw Markdown.
 *
 * Returns the body after the closing `---` fence (and the newline that follows
 * it). If the text doesn't open with `---`, or the block is never closed, the
 * input is returned unchanged — except an unterminated-but-opened block that
 * runs to EOF, which yields "" (there is no body).
 *
 * Pure and `obsidian`-free so it can be unit-tested directly. Shared by
 * `Chunker.ts` (RAG chunking) and `NoteContext.ts` (context building), which
 * previously held byte-identical private copies.
 */
export function stripFrontmatter(raw: string): string {
	if (!raw.startsWith("---")) return raw;
	const end = raw.indexOf("\n---", 3);
	if (end < 0) return raw;
	const after = raw.indexOf("\n", end + 4);
	return after < 0 ? "" : raw.slice(after + 1);
}
