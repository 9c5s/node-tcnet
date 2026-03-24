import { describe, it, expect, vi } from "vitest";
import { TCNetClient } from "../src/tcnet";
import { listNetworkAdapters } from "../src/utils";

// privateメンバにアクセスするためのテストヘルパー
class TestTCNetClient extends TCNetClient {
    public setConnected(value: boolean): void {
        (this as any).connected = value;
    }
    public getConnected(): boolean {
        return (this as any).connected;
    }
    public initMockSockets(): void {
        const mockSocket = { close: (cb: () => void) => cb() };
        (this as any).broadcastSocket = mockSocket;
        (this as any).unicastSocket = mockSocket;
        (this as any).timestampSocket = mockSocket;
        (this as any).announcementInterval = null;
        (this as any).broadcastSockets = new Map();
        (this as any).timestampSockets = new Map();
    }
    public async callDisconnectSockets(): Promise<void> {
        await (this as any).disconnectSockets();
    }
    public setConfig(overrides: Record<string, unknown>): void {
        Object.assign((this as any).config, overrides);
    }
}

// テストごとにユニークなユニキャストポートを割り当てる
let nextPort = 64000;
function uniquePort(): number {
    return nextPort++;
}

describe("connect() 新挙動", () => {
    it("即座にresolveする", async () => {
        const client = new TestTCNetClient();
        client.setConfig({ detectionTimeout: 100, requestTimeout: 100, unicastPort: uniquePort() });
        await client.connect();
        expect(client.isConnected).toBe(false);
        expect(client.selectedAdapter).toBeNull();
        await client.disconnect();
    });

    it("二重呼び出しでエラー", async () => {
        const client = new TestTCNetClient();
        client.setConfig({ detectionTimeout: 100, unicastPort: uniquePort() });
        await client.connect();
        await expect(client.connect()).rejects.toThrow();
        await client.disconnect();
    });

    it("detectionTimeoutイベントが発火する", async () => {
        const client = new TestTCNetClient();
        client.setConfig({ detectionTimeout: 100, unicastPort: uniquePort() });
        const handler = vi.fn();
        await client.connect();
        client.on("detectionTimeout", handler);
        await new Promise((r) => setTimeout(r, 200));
        expect(handler).toHaveBeenCalledTimes(1);
        await client.disconnect();
    });

    it("selectedAdapterが初期状態でnull", async () => {
        const client = new TestTCNetClient();
        expect(client.selectedAdapter).toBeNull();
    });

    it("isConnectedが初期状態でfalse", async () => {
        const client = new TestTCNetClient();
        expect(client.isConnected).toBe(false);
    });

    it("detectionTimeout後にdisconnect→connectで再接続できる", async () => {
        const port = uniquePort();
        const client = new TestTCNetClient();
        client.setConfig({ detectionTimeout: 50, unicastPort: port });
        await client.connect();
        await new Promise((r) => setTimeout(r, 100));
        await client.disconnect();
        // disconnect後は同じポートを再利用可能
        client.setConfig({ detectionTimeout: 50, unicastPort: port });
        await expect(client.connect()).resolves.toBeUndefined();
        await client.disconnect();
    });
});

describe("disconnect()", () => {
    it("リスナーが全て削除される", async () => {
        const client = new TestTCNetClient();
        client.initMockSockets();
        client.setConnected(true);
        const handler = vi.fn();
        client.on("broadcast", handler);

        await client.disconnect();

        expect(client.listenerCount("broadcast")).toBe(0);
    });

    it("connectedがfalseになる", async () => {
        const client = new TestTCNetClient();
        client.initMockSockets();
        client.setConnected(true);

        await client.disconnect();

        expect(client.getConnected()).toBe(false);
    });
});

describe("disconnectSockets()", () => {
    it("リスナーが維持される", async () => {
        const client = new TestTCNetClient();
        client.initMockSockets();
        client.setConnected(true);
        const handler = vi.fn();
        client.on("broadcast", handler);

        await client.callDisconnectSockets();

        expect(client.listenerCount("broadcast")).toBe(1);
        expect(client.getConnected()).toBe(false);
    });
});
