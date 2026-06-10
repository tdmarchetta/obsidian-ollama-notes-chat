/**
 * Parse a base-10 integer from user input and validate it against a lower
 * (and optional upper) bound. Returns `null` when the input isn't a finite
 * number or falls outside the bounds — callers treat `null` as "reject this
 * edit and leave the setting untouched".
 *
 * Extracted from the six copy-pasted `parseInt` + `Number.isFinite` + bound
 * guards in `SettingsTab.ts`. Pure and `obsidian`-free for direct unit testing.
 */
export function parseBoundedInt(raw: string, min: number, max?: number): number | null {
	const n = parseInt(raw, 10);
	if (!Number.isFinite(n) || n < min) return null;
	if (max !== undefined && n > max) return null;
	return n;
}
