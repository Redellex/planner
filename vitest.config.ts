// Set before any worker starts so threads inherit it; `test.env` and setup files do not reach thread workers in time.
process.env.TZ = "UTC";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
