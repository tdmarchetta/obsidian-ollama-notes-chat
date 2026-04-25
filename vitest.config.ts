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
		alias: {
			obsidian: path.resolve(here, "test/obsidian-stub.ts"),
		},
	},
});
