export type DiffTokenType = "equal" | "insert" | "delete";

export interface DiffToken {
	type: DiffTokenType;
	text: string;
}

const TOKEN_RE = /\s+|\S+/g;

export function tokenize(s: string): string[] {
	if (!s) return [];
	return s.match(TOKEN_RE) ?? [];
}

export function diffTokens(a: string[], b: string[]): DiffToken[] {
	const n = a.length;
	const m = b.length;
	if (n === 0 && m === 0) return [];
	if (n === 0) return b.map((t) => ({ type: "insert" as const, text: t }));
	if (m === 0) return a.map((t) => ({ type: "delete" as const, text: t }));

	const max = n + m;
	const offset = max;
	const v = new Int32Array(2 * max + 1);
	const trace: Int32Array[] = [];

	let found = false;
	outer: for (let d = 0; d <= max; d++) {
		trace.push(v.slice());
		for (let k = -d; k <= d; k += 2) {
			let x: number;
			if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
				x = v[offset + k + 1];
			} else {
				x = v[offset + k - 1] + 1;
			}
			let y = x - k;
			while (x < n && y < m && a[x] === b[y]) {
				x++;
				y++;
			}
			v[offset + k] = x;
			if (x >= n && y >= m) {
				found = true;
				break outer;
			}
		}
	}
	if (!found) return [];

	const out: DiffToken[] = [];
	let x = n;
	let y = m;
	for (let d = trace.length - 1; d > 0; d--) {
		const prev = trace[d];
		const k = x - y;
		let prevK: number;
		if (k === -d || (k !== d && prev[offset + k - 1] < prev[offset + k + 1])) {
			prevK = k + 1;
		} else {
			prevK = k - 1;
		}
		const prevX = prev[offset + prevK];
		const prevY = prevX - prevK;
		while (x > prevX && y > prevY) {
			out.push({ type: "equal", text: a[x - 1] });
			x--;
			y--;
		}
		if (x === prevX) {
			out.push({ type: "insert", text: b[y - 1] });
			y--;
		} else {
			out.push({ type: "delete", text: a[x - 1] });
			x--;
		}
	}
	while (x > 0 && y > 0 && a[x - 1] === b[y - 1]) {
		out.push({ type: "equal", text: a[x - 1] });
		x--;
		y--;
	}
	while (x > 0) {
		out.push({ type: "delete", text: a[x - 1] });
		x--;
	}
	while (y > 0) {
		out.push({ type: "insert", text: b[y - 1] });
		y--;
	}

	return out.reverse();
}

export function mergeAdjacent(tokens: DiffToken[]): DiffToken[] {
	const out: DiffToken[] = [];
	for (const t of tokens) {
		const last = out[out.length - 1];
		if (last && last.type === t.type) {
			last.text += t.text;
		} else {
			out.push({ type: t.type, text: t.text });
		}
	}
	return out;
}

export function diff(before: string, after: string): DiffToken[] {
	// Normalize line endings before tokenizing — the regex /\s+|\S+/g treats
	// "\r\n" and "\n" as distinct whitespace tokens, so an LF selection vs. a
	// CRLF rewrite (or vice versa) would produce a diff full of phantom
	// insert/delete pairs on every line break. Fold both sides to LF so the
	// tokenizer compares apples to apples.
	const a = before.replace(/\r\n/g, "\n");
	const b = after.replace(/\r\n/g, "\n");
	return mergeAdjacent(diffTokens(tokenize(a), tokenize(b)));
}
