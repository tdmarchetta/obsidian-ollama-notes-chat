export interface ChunkOptions {
	chunkSize: number;
	overlap: number;
}

export interface Chunk {
	heading?: string;
	text: string;
}

interface Section {
	heading?: string;
	body: string;
}

export function chunkMarkdown(raw: string, opts: ChunkOptions): Chunk[] {
	const body = stripFrontmatter(raw);
	const sections = splitByHeadings(body);
	const chunks: Chunk[] = [];
	for (const sec of sections) {
		const trimmed = sec.body.trim();
		if (trimmed.length === 0) continue;
		if (trimmed.length <= opts.chunkSize) {
			chunks.push({ heading: sec.heading, text: trimmed });
			continue;
		}
		const windowSize = opts.chunkSize;
		const step = Math.max(1, windowSize - opts.overlap);
		for (let start = 0; start < trimmed.length; start += step) {
			const slice = trimmed.slice(start, start + windowSize).trim();
			if (slice.length === 0) continue;
			chunks.push({ heading: sec.heading, text: slice });
			if (start + windowSize >= trimmed.length) break;
		}
	}
	return chunks;
}

function stripFrontmatter(raw: string): string {
	if (!raw.startsWith("---")) return raw;
	const end = raw.indexOf("\n---", 3);
	if (end < 0) return raw;
	const after = raw.indexOf("\n", end + 4);
	return after < 0 ? "" : raw.slice(after + 1);
}

function splitByHeadings(body: string): Section[] {
	const lines = body.split("\n");
	const sections: Section[] = [];
	let current: Section = { heading: undefined, body: "" };
	const headingRe = /^(#{1,3})\s+(.+?)\s*#*\s*$/;
	for (const line of lines) {
		const match = headingRe.exec(line);
		if (match) {
			if (current.body.length > 0 || current.heading !== undefined) {
				sections.push(current);
			}
			current = { heading: match[2].trim(), body: "" };
		} else {
			current.body += (current.body.length > 0 ? "\n" : "") + line;
		}
	}
	sections.push(current);
	return sections;
}
