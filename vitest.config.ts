// Set before any worker starts so every pool inherits it; `test.env` works under the default forks pool but not under threads.
process.env.TZ = "UTC";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
