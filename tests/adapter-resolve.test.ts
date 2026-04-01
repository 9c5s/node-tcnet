import { describe, it, expect } from "vitest";
import { TCNetClient } from "../src/tcnet";
import type { NetworkAdapterInfo } from "../src/utils";
import { isolateXteaEnv } from "./helpers";

isolateXteaEnv();

class TestClient extends TCNetClient {
    /**
     * adapterMapにアダプタを追加する
     * @param name - アダプタ名
     * @param address - IPv4アドレス
     * @param netmask - サブネットマスク
     */
    public addAdapter(name: string, address: string, netmask: string): void {
        const adapter: NetworkAdapterInfo = {
            name,
            addresses: [
                {
                    address,
                    netmask,
                    family: "IPv4",
                    mac: "00:00:00:00:00:00",
                    internal: false,
                    cidr: null,
                },
            ],
        };
        (this as any).adapterMap.set(name, adapter);
    }

    /**
     * resolveAdapterByRemoteAddressを公開する
     * @param remoteAddress - 送信元IPv4アドレス
     */
    public resolve(remoteAddress: string): string | null {
        return (this as any).resolveAdapterByRemoteAddress(remoteAddress);
    }
}

describe("resolveAdapterByRemoteAddress", () => {
    it("同一サブネットの送信元からアダプタ名を返す", () => {
        const client = new TestClient();
        client.addAdapter("en0", "192.168.0.10", "255.255.255.0");
        expect(client.resolve("192.168.0.130")).toBe("en0");
    });

    it("異なるサブネットの送信元にはnullを返す", () => {
        const client = new TestClient();
        client.addAdapter("en0", "192.168.0.10", "255.255.255.0");
        expect(client.resolve("10.0.0.1")).toBeNull();
    });

    it("複数アダプタから正しいアダプタを選択する", () => {
        const client = new TestClient();
        client.addAdapter("en0", "192.168.0.10", "255.255.255.0");
        client.addAdapter("utun4", "100.86.239.21", "255.255.255.0");
        expect(client.resolve("192.168.0.130")).toBe("en0");
        expect(client.resolve("100.86.239.50")).toBe("utun4");
    });

    it("/16サブネットで正しくマッチする", () => {
        const client = new TestClient();
        client.addAdapter("en0", "10.0.1.5", "255.255.0.0");
        expect(client.resolve("10.0.200.1")).toBe("en0");
        expect(client.resolve("10.1.0.1")).toBeNull();
    });

    it("アダプタマップが空の場合はnullを返す", () => {
        const client = new TestClient();
        expect(client.resolve("192.168.0.1")).toBeNull();
    });

    it("Bridgeと同一マシン(同一IP)でもマッチする", () => {
        const client = new TestClient();
        client.addAdapter("en12", "192.168.0.130", "255.255.255.0");
        // Bridge自身のIPからのブロードキャスト
        expect(client.resolve("192.168.0.130")).toBe("en12");
    });
});
