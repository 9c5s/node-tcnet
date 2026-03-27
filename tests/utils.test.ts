import { describe, it, expect, vi, afterEach } from "vitest";

// ESMではvi.spyOnでosのexportをモックできないため、vi.mockを使用する
vi.mock("os", async () => {
    const actual = await vi.importActual<typeof import("os")>("os");
    return {
        ...actual,
        networkInterfaces: vi.fn(actual.networkInterfaces),
    };
});

import { networkInterfaces } from "os";
import { assert, interfaceAddress, findIPv4Address, listNetworkAdapters } from "../src/utils";
import type { NetworkAdapterInfo } from "../src/utils";

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
            expect(adapter.name).toBeTypeOf("string");
            expect(adapter.addresses).toBeInstanceOf(Array);
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

describe("interfaceAddress", () => {
    afterEach(() => {
        vi.mocked(networkInterfaces).mockRestore();
    });

    it("192.168.1.100/24 のブロードキャストアドレスは 192.168.1.255", () => {
        vi.mocked(networkInterfaces).mockReturnValue({
            eth0: [
                {
                    address: "192.168.1.100",
                    netmask: "255.255.255.0",
                    family: "IPv4",
                    mac: "00:00:00:00:00:00",
                    internal: false,
                    cidr: "192.168.1.100/24",
                },
            ],
        });
        expect(interfaceAddress("eth0")).toBe("192.168.1.255");
    });

    it("10.0.0.5/16 のブロードキャストアドレスは 10.0.255.255", () => {
        vi.mocked(networkInterfaces).mockReturnValue({
            eth0: [
                {
                    address: "10.0.0.5",
                    netmask: "255.255.0.0",
                    family: "IPv4",
                    mac: "00:00:00:00:00:00",
                    internal: false,
                    cidr: "10.0.0.5/16",
                },
            ],
        });
        expect(interfaceAddress("eth0")).toBe("10.0.255.255");
    });

    it("172.16.10.1/20 のブロードキャストアドレスは 172.16.15.255", () => {
        vi.mocked(networkInterfaces).mockReturnValue({
            eth0: [
                {
                    address: "172.16.10.1",
                    netmask: "255.255.240.0",
                    family: "IPv4",
                    mac: "00:00:00:00:00:00",
                    internal: false,
                    cidr: "172.16.10.1/20",
                },
            ],
        });
        expect(interfaceAddress("eth0")).toBe("172.16.15.255");
    });

    it("存在しないインタフェースで例外を投げる", () => {
        vi.mocked(networkInterfaces).mockReturnValue({});
        expect(() => interfaceAddress("nonexistent")).toThrow("does not exist");
    });

    it("IPv4アドレスのないインタフェースで例外を投げる", () => {
        vi.mocked(networkInterfaces).mockReturnValue({
            eth0: [
                {
                    address: "fe80::1",
                    netmask: "ffff:ffff:ffff:ffff::",
                    family: "IPv6",
                    mac: "00:00:00:00:00:00",
                    internal: false,
                    cidr: "fe80::1/64",
                    scopeid: 1,
                },
            ],
        });
        expect(() => interfaceAddress("eth0")).toThrow("does not have IPv4 address");
    });
});

describe("findIPv4Address", () => {
    it("non-internalなIPv4アドレスを返す", () => {
        const adapter: NetworkAdapterInfo = {
            name: "eth0",
            addresses: [
                {
                    address: "192.168.0.10",
                    netmask: "255.255.255.0",
                    family: "IPv4",
                    mac: "aa:bb:cc:dd:ee:ff",
                    internal: false,
                    cidr: "192.168.0.10/24",
                },
            ],
        };
        const result = findIPv4Address(adapter);
        expect(result).toBeDefined();
        expect(result!.address).toBe("192.168.0.10");
    });

    it("internalなIPv4アドレスはスキップする", () => {
        const adapter: NetworkAdapterInfo = {
            name: "lo",
            addresses: [
                {
                    address: "127.0.0.1",
                    netmask: "255.0.0.0",
                    family: "IPv4",
                    mac: "00:00:00:00:00:00",
                    internal: true,
                    cidr: "127.0.0.1/8",
                },
            ],
        };
        expect(findIPv4Address(adapter)).toBeUndefined();
    });

    it("IPv6のみのアダプタではundefinedを返す", () => {
        const adapter: NetworkAdapterInfo = {
            name: "eth1",
            addresses: [
                {
                    address: "fe80::1",
                    netmask: "ffff:ffff:ffff:ffff::",
                    family: "IPv6",
                    mac: "aa:bb:cc:dd:ee:ff",
                    internal: false,
                    cidr: "fe80::1/64",
                    scopeid: 1,
                },
            ],
        };
        expect(findIPv4Address(adapter)).toBeUndefined();
    });

    it("IPv6とIPv4が混在する場合はnon-internal IPv4を返す", () => {
        const adapter: NetworkAdapterInfo = {
            name: "eth0",
            addresses: [
                {
                    address: "fe80::1",
                    netmask: "ffff:ffff:ffff:ffff::",
                    family: "IPv6",
                    mac: "aa:bb:cc:dd:ee:ff",
                    internal: false,
                    cidr: "fe80::1/64",
                    scopeid: 1,
                },
                {
                    address: "10.0.0.5",
                    netmask: "255.255.0.0",
                    family: "IPv4",
                    mac: "aa:bb:cc:dd:ee:ff",
                    internal: false,
                    cidr: "10.0.0.5/16",
                },
            ],
        };
        const result = findIPv4Address(adapter);
        expect(result).toBeDefined();
        expect(result!.address).toBe("10.0.0.5");
    });

    it("アドレスが空の場合はundefinedを返す", () => {
        const adapter: NetworkAdapterInfo = {
            name: "empty",
            addresses: [],
        };
        expect(findIPv4Address(adapter)).toBeUndefined();
    });
});
