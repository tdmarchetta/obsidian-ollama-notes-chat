import { describe, expect, it } from "vitest";
import { isLoopbackUrl, hostnameOf } from "./loopback";

describe("isLoopbackUrl", () => {
	it("treats localhost / 127.x / ::1 as loopback (data stays on this machine)", () => {
		expect(isLoopbackUrl("http://localhost:11434")).toBe(true);
		expect(isLoopbackUrl("http://127.0.0.1:11434")).toBe(true);
		expect(isLoopbackUrl("http://127.1.2.3:11434")).toBe(true);
		expect(isLoopbackUrl("http://[::1]:11434")).toBe(true);
	});

	it("treats LAN / public hosts as NOT loopback (data would leave the machine)", () => {
		expect(isLoopbackUrl("http://192.168.7.43:11434")).toBe(false);
		expect(isLoopbackUrl("http://10.0.0.5:11434")).toBe(false);
		expect(isLoopbackUrl("https://ollama.example.com")).toBe(false);
	});

	it("tolerates a scheme-less value (the settings field accepts it)", () => {
		expect(isLoopbackUrl("localhost:11434")).toBe(true);
		expect(isLoopbackUrl("192.168.7.43:11434")).toBe(false);
	});

	it("fails closed: an unparseable value is treated as non-loopback", () => {
		expect(isLoopbackUrl("")).toBe(false);
		expect(isLoopbackUrl("   ")).toBe(false);
	});
});

describe("hostnameOf", () => {
	it("extracts the host with or without a scheme", () => {
		expect(hostnameOf("http://192.168.7.43:11434")).toBe("192.168.7.43");
		expect(hostnameOf("localhost:11434")).toBe("localhost");
	});
});
