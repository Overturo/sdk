import { defineConfig } from "tsup"

export default defineConfig({
  entry: {
    index: "src/index.ts",
    authorize: "src/authorize/index.ts",
    oversight: "src/oversight/index.ts",
    decisions: "src/decisions/index.ts",
    receipts: "src/receipts/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "node20",
  splitting: false,
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".mjs" }
  },
})
