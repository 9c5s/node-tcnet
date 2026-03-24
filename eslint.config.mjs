import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import jsdoc from "eslint-plugin-jsdoc";

export default [
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    jsdoc.configs["flat/recommended-typescript-error"],
    {
        rules: {
            // 既存ルールの移行
            "@typescript-eslint/no-unused-vars": "off",
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
        ignores: [
            "**/*.d.ts",
            "dist/**",
            "node_modules/**",
            "examples/**",
            "tests/**",
            ".tmp/**",
            "scripts/**",
            ".*.js",
        ],
    },
];
