import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

// vitest pulls source files in directly. Anything that imports the `obsidian`
// runtime gets the test/obsidian-stub.ts shim instead of the real module
// (which only exists inside Obsidian's Electron host).
const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	test: {
		include: ["src/**/*.test.ts", "test/**/*.test.ts"],
	},
	resolve: {
		// Prefer source over the generated main.js when testing after a build.
		extensions: [".ts", ".tsx", ".mts", ".mjs", ".js", ".jsx", ".json"],
		alias: {
			obsidian: path.resolve(here, "test/obsidian-stub.ts"),
		},
	},
});
