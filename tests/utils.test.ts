import { describe, it, expect } from "vitest";
import { assert } from "../src/utils";

describe("assert", () => {
    it("条件が true の場合は何もしない", () => {
        expect(() => assert(true)).not.toThrow();
    });

    it("条件が false の場合はメッセージ付きで例外を投げる", () => {
        expect(() => assert(false, "test error")).toThrow("Assertion failed: test error");
    });

    it("メッセージ省略時は undefined を含む例外を投げる", () => {
        expect(() => assert(false)).toThrow("Assertion failed: undefined");
    });
});
