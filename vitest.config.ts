// Test-only Vite config. Vitest reads this file instead of vite.config.ts, so the
// suite runs without the TanStack Start plugin that rewrites createServerFn() calls
// into remote-call stubs at transform time. Without that rewrite, tests can mock
// "@tanstack/react-start" and exercise a server function's real handler in-process.
// The app build still uses vite.config.ts unchanged.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import tsConfigPaths from "vite-tsconfig-paths";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [tsConfigPaths()],
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "src"),
      "entities/lib/decode.js": path.resolve(
        rootDir,
        "node_modules/entities/lib/decode.js",
      ),
      "entities/lib/encode.js": path.resolve(
        rootDir,
        "node_modules/entities/lib/encode.js",
      ),
      entities: path.resolve(rootDir, "node_modules/entities"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
