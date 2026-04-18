import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
	{
		ignores: [
			"main.js",
			"main.js.map",
			"node_modules/**",
			"*.mjs",
			"dist/**",
			"package.json",
			"package-lock.json",
			"tsconfig.json",
			"manifest.json",
			"versions.json",
			"data.json",
		],
	},
	...obsidianmd.configs.recommended,
	{
		files: ["**/*.ts"],
		languageOptions: {
			parser: tsparser,
			parserOptions: { project: "./tsconfig.json" },
		},
		rules: {
			"no-unused-vars": "off",
			"@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
			"@typescript-eslint/ban-ts-comment": "off",
			"@typescript-eslint/no-empty-function": "off",
			"no-prototype-builtins": "off",
			"obsidianmd/prefer-active-doc": "off",
			"obsidianmd/no-unsupported-api": "off",
			"obsidianmd/prefer-active-window-timers": "off",
		},
	},
]);
