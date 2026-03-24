import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["tests/e2e/**/*.e2e.test.ts"],
        globalSetup: ["tests/e2e/global-setup.ts"],
        testTimeout: 60_000,
        reporters: ["verbose"],
        sequence: { concurrent: false },
    },
});
