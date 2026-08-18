import { defineConfig } from "tsdown";

export default defineConfig({
	dts: true,
	// `packages/**/*.ts` also globbed packages/*/node_modules, so the build tried
	// to compile @noble/curves' and @babel/parser's own TypeScript sources and
	// failed on syntax it was never meant to parse. Scope it to our own src/.
	entry: ["packages/*/src/**/*.ts", "!packages/**/*.test.*"],
	fixedExtension: false,
	outDir: "dist",
	unbundle: true,
});
