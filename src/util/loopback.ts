// Pure, obsidian-free helpers for deciding whether a base URL points at *this*
// computer (loopback) or another machine. Used by the egress guard
// (`OllamaClient`) and the settings grandfather logic (`mergeSettings`).

/** Best-effort hostname extraction that tolerates a scheme-less value like
 *  "192.168.1.50:11434" or "localhost:11434" (which the settings field accepts). */
export function hostnameOf(url: string): string | null {
	try {
		const u = new URL(url);
		if (u.hostname) return u.hostname;
	} catch {
		// fall through to the scheme-prefixed attempt
	}
	try {
		return new URL(`http://${url}`).hostname;
	} catch {
		return null;
	}
}

function isLoopbackHostname(hostname: string): boolean {
	let host = hostname.toLowerCase();
	// URL.hostname keeps the brackets around an IPv6 literal, e.g. "[::1]".
	if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
	if (host === "localhost" || host === "::1") return true;
	// IPv4 loopback block 127.0.0.0/8 (almost always 127.0.0.1).
	if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
	return false;
}

/** True when `url` targets this machine's loopback interface — i.e. data sent
 *  there never leaves the computer. A value we can't parse is treated as NOT
 *  loopback so the privacy guard fails closed (blocks rather than leaks). */
export function isLoopbackUrl(url: string): boolean {
	const host = hostnameOf(url);
	return host !== null && isLoopbackHostname(host);
}
