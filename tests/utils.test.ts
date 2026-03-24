import { describe, it, expect } from "vitest";
import { assert, listNetworkAdapters } from "../src/utils";

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

describe("listNetworkAdapters", () => {
    it("1つ以上のアダプタを返す", () => {
        const adapters = listNetworkAdapters();
        expect(adapters.length).toBeGreaterThanOrEqual(1);
    });

    it("各アダプタにnameとaddressesが含まれる", () => {
        const adapters = listNetworkAdapters();
        for (const adapter of adapters) {
            expect(typeof adapter.name).toBe("string");
            expect(Array.isArray(adapter.addresses)).toBe(true);
        }
    });

    it("各アドレスに必須プロパティが含まれる", () => {
        const adapters = listNetworkAdapters();
        const allAddresses = adapters.flatMap((a) => a.addresses);
        expect(allAddresses.length).toBeGreaterThanOrEqual(1);
        for (const addr of allAddresses) {
            expect(addr).toHaveProperty("address");
            expect(addr).toHaveProperty("netmask");
            expect(addr).toHaveProperty("family");
            expect(addr).toHaveProperty("mac");
            expect(addr).toHaveProperty("internal");
            expect(addr).toHaveProperty("cidr");
        }
    });
});
