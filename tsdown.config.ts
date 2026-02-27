import { defineConfig } from "tsdown";

export default defineConfig({
	dts: true,
	entry: ["packages/**/*.ts", "!packages/**/*.test.*"],
	fixedExtension: false,
	outDir: "lib",
	unbundle: true,
});
