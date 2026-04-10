import { describe, it, expect } from "vitest";
import { TCNetClient } from "../src/tcnet";
import type { NetworkAdapterInfo } from "../src/utils";
import { isolateXteaEnv, TestTCNetClient, writeValidHeader } from "./helpers";
import * as nw from "../src/network";

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

    it("重複サブネットではlongest prefix matchで最も具体的なアダプタを返す", () => {
        const client = new TestClient();
        client.addAdapter("vpn0", "192.168.0.50", "255.0.0.0"); // /8 VPN
        client.addAdapter("en0", "192.168.0.10", "255.255.255.0"); // /24 LAN
        // /24 の方が具体的なので en0 が選択される
        expect(client.resolve("192.168.0.130")).toBe("en0");
    });

    it("完全に同一のサブネット(/24同士)では最初にマッチしたアダプタを返す", () => {
        const client = new TestClient();
        client.addAdapter("en0", "192.168.0.10", "255.255.255.0");
        client.addAdapter("en1", "192.168.0.20", "255.255.255.0");
        // 同じマスク長なので最初のマッチ(en0)が返る
        expect(client.resolve("192.168.0.130")).toBe("en0");
    });
});

function setupConnectedClient(): TestTCNetClient {
    const client = new TestTCNetClient();
    (client as any).connected = true;
    (client as any)._selectedAdapter = {
        name: "en0",
        addresses: [
            {
                address: "192.168.0.10",
                netmask: "255.255.255.0",
                family: "IPv4" as const,
                mac: "00:00:00:00:00:00",
                internal: false,
                cidr: null,
            },
        ],
    };
    (client as any).server = { address: "192.168.0.100", port: 65207, family: "IPv4", size: 0 };
    return client;
}

describe("receiveBroadcast サブネットフィルタ", () => {
    it("pre-connected状態で選択アダプタと異なるサブネットのMaster OptInを無視する", () => {
        const client = new TestTCNetClient();
        // connectToAdapter経由: connected=false, detectingAdapter=false, selectedAdapter設定済み
        (client as any)._selectedAdapter = {
            name: "en0",
            addresses: [
                {
                    address: "192.168.0.10",
                    netmask: "255.255.255.0",
                    family: "IPv4" as const,
                    mac: "00:00:00:00:00:00",
                    internal: false,
                    cidr: null,
                },
            ],
        };

        const buffer = Buffer.alloc(68);
        writeValidHeader(buffer, nw.TCNetMessageType.OptIn);
        buffer.writeUInt8(nw.NodeType.Master, 17);
        buffer.writeUInt16LE(65207, 26);

        client.simulateBroadcast(buffer, {
            address: "10.0.0.50",
            port: 60000,
            family: "IPv4" as const,
            size: buffer.length,
        });

        // pre-connected状態なのでserverは設定されない
        expect((client as any).server).toBeNull();
        expect((client as any).connected).toBe(false);
    });

    it("connected後、選択アダプタと異なるサブネットのMaster OptInでserverが更新されない", () => {
        const client = setupConnectedClient();

        // 別サブネット(10.0.0.x)のMaster OptInを送信
        const buffer = Buffer.alloc(68);
        writeValidHeader(buffer, nw.TCNetMessageType.OptIn);
        buffer.writeUInt8(nw.NodeType.Master, 17); // nodeType = Master
        buffer.writeUInt16LE(65207, 26); // nodeListenerPort

        client.simulateBroadcast(buffer, {
            address: "10.0.0.50",
            port: 60000,
            family: "IPv4" as const,
            size: buffer.length,
        });

        // serverは元のまま (10.0.0.50に更新されていない)
        expect((client as any).server.address).toBe("192.168.0.100");
    });

    it("connected後、同一サブネットのMaster OptInでserverが更新される", () => {
        const client = setupConnectedClient();

        const buffer = Buffer.alloc(68);
        writeValidHeader(buffer, nw.TCNetMessageType.OptIn);
        buffer.writeUInt8(nw.NodeType.Master, 17);
        buffer.writeUInt16LE(65208, 26);

        client.simulateBroadcast(buffer, {
            address: "192.168.0.200",
            port: 60000,
            family: "IPv4" as const,
            size: buffer.length,
        });

        // 同一サブネットなのでserverが更新される
        expect((client as any).server.address).toBe("192.168.0.200");
    });
});
