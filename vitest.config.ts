import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        exclude: [...configDefaults.exclude, "tests/e2e/**", ".worktrees/**"],
        projects: [
            { extends: true, test: { name: "unit" } },
            {
                test: {
                    name: "e2e",
                    include: ["tests/e2e/**/*.e2e.test.ts"],
                    globalSetup: ["tests/e2e/global-setup.ts"],
                    testTimeout: 60_000,
                    reporters: ["verbose"],
                    sequence: { concurrent: false },
                },
            },
        ],
    },
});
