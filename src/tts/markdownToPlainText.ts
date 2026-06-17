// Strip markdown for text-to-speech. Not exhaustive — handles the cases
// that matter for spoken output (code blocks dropped entirely, inline
// formatting markers stripped, links/wikilinks reduced to their display
// text). Intentionally tolerant: anything we don't recognize falls
// through unchanged rather than throwing.

export function markdownToPlainText(md: string): string {
	if (!md) return "";
	let s = md;

	// Fenced code blocks — drop entirely; speaking code aloud is noise.
	s = s.replace(/```[\s\S]*?```/g, "");
	// Inline code — keep the content, drop the backticks.
	s = s.replace(/`([^`]+)`/g, "$1");

	// Images: ![alt](url) → alt (or "" if no alt).
	s = s.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1");
	// Links: [text](url) → text.
	s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
	// Wikilinks: [[note]] or [[note|alias]] → alias or note.
	s = s.replace(
		/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
		(_m: string, target: string, alias: string | undefined): string => alias || target,
	);

	// Bold / italic / strikethrough.
	s = s.replace(/(\*\*|__)(.+?)\1/g, "$2");
	s = s.replace(/(\*|_)(.+?)\1/g, "$2");
	s = s.replace(/~~(.+?)~~/g, "$1");

	// Headings, blockquote markers, list markers.
	s = s.replace(/^\s*#{1,6}\s+/gm, "");
	s = s.replace(/^\s*>\s?/gm, "");
	s = s.replace(/^\s*[-*+]\s+/gm, "");
	s = s.replace(/^\s*\d+\.\s+/gm, "");

	// HTML tags — strip but keep inner text. Loop to a fixpoint: a single
	// global replace does one left-to-right scan and won't re-examine text
	// joined across a removed span, so re-run until the string stops changing.
	let prev: string;
	do {
		prev = s;
		s = s.replace(/<[^>]+>/g, "");
	} while (s !== prev);

	// Collapse runs of blank lines.
	s = s.replace(/\n{3,}/g, "\n\n");

	return s.trim();
}
