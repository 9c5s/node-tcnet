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
import { assert, interfaceAddress, findIPv4Address, listNetworkAdapters, ipToNumber } from "../src/utils";
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

describe("listNetworkAdapters (mock)", () => {
    afterEach(() => {
        vi.mocked(networkInterfaces).mockRestore();
    });

    it("IPv4/IPv6混在のアダプタが正しく返る", () => {
        vi.mocked(networkInterfaces).mockReturnValue({
            eth0: [
                {
                    address: "192.168.0.10",
                    netmask: "255.255.255.0",
                    family: "IPv4",
                    mac: "aa:bb:cc:dd:ee:ff",
                    internal: false,
                    cidr: "192.168.0.10/24",
                },
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
        });
        const adapters = listNetworkAdapters();
        expect(adapters).toHaveLength(1);
        expect(adapters[0].addresses).toHaveLength(2);
        expect(adapters[0].addresses[0].family).toBe("IPv4");
        expect(adapters[0].addresses[1].family).toBe("IPv6");
    });

    it("undefinedアドレスのインタフェースはスキップする", () => {
        vi.mocked(networkInterfaces).mockReturnValue({
            eth0: undefined as any,
            eth1: [
                {
                    address: "10.0.0.1",
                    netmask: "255.0.0.0",
                    family: "IPv4",
                    mac: "00:00:00:00:00:00",
                    internal: false,
                    cidr: "10.0.0.1/8",
                },
            ],
        });
        const adapters = listNetworkAdapters();
        expect(adapters).toHaveLength(1);
        expect(adapters[0].name).toBe("eth1");
    });

    it("internalなアドレスも含めて返す(フィルタはfindIPv4Addressの責務)", () => {
        vi.mocked(networkInterfaces).mockReturnValue({
            lo: [
                {
                    address: "127.0.0.1",
                    netmask: "255.0.0.0",
                    family: "IPv4",
                    mac: "00:00:00:00:00:00",
                    internal: true,
                    cidr: "127.0.0.1/8",
                },
            ],
        });
        const adapters = listNetworkAdapters();
        expect(adapters).toHaveLength(1);
        expect(adapters[0].addresses[0].internal).toBe(true);
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

describe("ipToNumber", () => {
    it("0.0.0.0 は 0 を返す", () => {
        expect(ipToNumber("0.0.0.0")).toBe(0);
    });

    it("255.255.255.255 は 0xFFFFFFFF を返す", () => {
        expect(ipToNumber("255.255.255.255")).toBe(0xffffffff);
    });

    it("192.168.0.130 を正しく変換する", () => {
        // 0xC0=192, 0xA8=168, 0x00=0, 0x82=130
        expect(ipToNumber("192.168.0.130")).toBe(0xc0a80082);
    });

    it("10.0.0.1 を正しく変換する", () => {
        // 0x0A=10, 0x00=0, 0x00=0, 0x01=1
        expect(ipToNumber("10.0.0.1")).toBe(0x0a000001);
    });

    it("同一サブネットの判定に使用できる", () => {
        const mask = ipToNumber("255.255.255.0");
        const a = ipToNumber("192.168.0.10") & mask;
        const b = ipToNumber("192.168.0.130") & mask;
        const c = ipToNumber("10.0.0.1") & mask;
        expect(a).toBe(b);
        expect(a).not.toBe(c);
    });

    it("空セグメント('192.168..1')でエラーを投げる", () => {
        expect(() => ipToNumber("192.168..1")).toThrow("Invalid IPv4 address");
    });

    it("先頭ドット('.0.0.1')でエラーを投げる", () => {
        expect(() => ipToNumber(".0.0.1")).toThrow("Invalid IPv4 address");
    });

    it("範囲外オクテット('256.0.0.0')でエラーを投げる", () => {
        expect(() => ipToNumber("256.0.0.0")).toThrow("Invalid IPv4 address");
    });

    it("非数値('abc.0.0.1')でエラーを投げる", () => {
        expect(() => ipToNumber("abc.0.0.1")).toThrow("Invalid IPv4 address");
    });

    it("空文字列でエラーを投げる", () => {
        expect(() => ipToNumber("")).toThrow("Invalid IPv4 address");
    });

    it("オクテット不足('192.168.0')でエラーを投げる", () => {
        expect(() => ipToNumber("192.168.0")).toThrow("Invalid IPv4 address");
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
