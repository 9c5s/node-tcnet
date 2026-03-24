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
}

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
