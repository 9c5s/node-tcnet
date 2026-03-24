import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import jsdoc from "eslint-plugin-jsdoc";

// tests/examples共通のJSDoc緩和ルール
const relaxedJsdocRules = {
    "jsdoc/require-jsdoc": "off",
    "jsdoc/require-description": "off",
    "jsdoc/require-param-description": "off",
    "jsdoc/require-returns-description": "off",
    "jsdoc/require-returns": "off",
    "jsdoc/require-hyphen-before-param-description": "off",
};

export default [
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    jsdoc.configs["flat/recommended-typescript-error"],
    {
        rules: {
            // 既存ルールの移行
            "@typescript-eslint/no-unused-vars": [
                "warn",
                {
                    argsIgnorePattern: "^_",
                    varsIgnorePattern: "^_",
                    caughtErrorsIgnorePattern: "^_",
                    ignoreRestSiblings: true,
                },
            ],
            "@typescript-eslint/no-empty-function": ["warn", { allow: ["arrowFunctions"] }],
            "no-console": ["warn"],

            // JSDoc ルール (TypeDoc最適化)
            "jsdoc/require-jsdoc": [
                "error",
                {
                    require: {
                        FunctionDeclaration: true,
                        MethodDefinition: true,
                        ClassDeclaration: true,
                        ArrowFunctionExpression: false,
                        FunctionExpression: false,
                    },
                },
            ],
            "jsdoc/require-hyphen-before-param-description": ["error", "always"],
            "jsdoc/require-description": "error",
            "jsdoc/require-param-description": "error",
            "jsdoc/require-returns-description": "error",
            "jsdoc/require-returns": ["error", { forceRequireReturn: false }],
            "jsdoc/no-types": "error",
            "jsdoc/check-tag-names": [
                "error",
                {
                    definedTags: ["remarks", "example", "category", "see"],
                },
            ],
        },
    },
    {
        files: ["tests/**"],
        rules: {
            ...relaxedJsdocRules,
            "@typescript-eslint/no-explicit-any": "off",
        },
    },
    {
        files: ["examples/**"],
        rules: {
            ...relaxedJsdocRules,
            "no-console": "off",
        },
    },
    {
        ignores: ["**/*.d.ts", "dist/**", "node_modules/**", ".tmp/**", "scripts/**", ".*.js", ".worktrees/**"],
    },
];
