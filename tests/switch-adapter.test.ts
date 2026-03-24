import { describe, it, expect, vi } from "vitest";
import { TCNetClient } from "../src/tcnet";
import { listNetworkAdapters } from "../src/utils";

function getFirstNonLoopbackAdapter(): string {
    const adapters = listNetworkAdapters();
    const adapter = adapters.find((a) => a.addresses.some((addr) => addr.family === "IPv4" && !addr.internal));
    if (!adapter) throw new Error("テスト実行にはnon-internal IPv4アダプタが必要");
    return adapter.name;
}

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
    public addMockRequest(key: string, resolve: (value?: any) => void, reject: (reason?: any) => void): void {
        const timeout = setTimeout(() => {}, 10000);
        (this as any).requests.set(key, { resolve, reject, timeout });
    }
    public mockConnectToAdapter(): void {
        (this as any).connectToAdapter = async () => {
            const mockSocket = {
                close: (cb: () => void) => cb(),
                setBroadcast: () => {},
                send: (_b: any, _p: any, _a: any, cb: any) => cb(),
            };
            (this as any).broadcastSocket = mockSocket;
            (this as any).unicastSocket = mockSocket;
            (this as any).timestampSocket = mockSocket;
            (this as any).announcementInterval = null;
            (this as any).connected = true;
        };
    }
    public setRetryConfig(count: number, interval: number): void {
        (this as any).config.switchRetryCount = count;
        (this as any).config.switchRetryInterval = interval;
    }
    public mockConnectAlwaysFail(): void {
        (this as any).connectToAdapter = async () => {
            throw new Error("Timeout connecting to network");
        };
    }
    public mockConnectWithFailures(failCount: number): void {
        let attempt = 0;
        (this as any).connectToAdapter = async () => {
            if (attempt < failCount) {
                attempt++;
                throw new Error("Timeout connecting to network");
            }
            const mockSocket = {
                close: (cb: () => void) => cb(),
                setBroadcast: () => {},
                send: (_b: any, _p: any, _a: any, cb: any) => cb(),
            };
            (this as any).broadcastSocket = mockSocket;
            (this as any).unicastSocket = mockSocket;
            (this as any).timestampSocket = mockSocket;
            (this as any).announcementInterval = null;
            (this as any).connected = true;
        };
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

describe("ガード", () => {
    it("アダプタ未確定時にbroadcastPacket()がエラー", async () => {
        const client = new TestTCNetClient();
        client.setConfig({ detectionTimeout: 100, unicastPort: uniquePort() });
        await client.connect();
        const nw = await import("../src/network");
        const packet = new nw.TCNetOptInPacket();
        await expect(client.broadcastPacket(packet)).rejects.toThrow();
        await client.disconnect();
    });

    it("検出中はbroadcastイベントが発火しない", async () => {
        const client = new TestTCNetClient();
        client.setConfig({ detectionTimeout: 200, unicastPort: uniquePort() });
        const handler = vi.fn();
        await client.connect();
        client.on("broadcast", handler);
        await new Promise((r) => setTimeout(r, 100));
        expect(handler).not.toHaveBeenCalled();
        await client.disconnect();
    });

    it("検出中はtimeイベントが発火しない", async () => {
        const client = new TestTCNetClient();
        client.setConfig({ detectionTimeout: 200, unicastPort: uniquePort() });
        const timeHandler = vi.fn();
        await client.connect();
        client.on("time", timeHandler);
        await new Promise((r) => setTimeout(r, 100));
        expect(timeHandler).not.toHaveBeenCalled();
        await client.disconnect();
    });
});

describe("switchAdapter() バリデーション", () => {
    it("存在しないアダプタ名でエラー", async () => {
        const client = new TestTCNetClient();
        client.initMockSockets();
        client.setConnected(true);
        await expect(client.switchAdapter("nonexistent_adapter_xyz_12345")).rejects.toThrow("does not exist");
    });

    it("IPv4のないアダプタでエラー", async () => {
        const adapters = listNetworkAdapters();
        const ipv6Only = adapters.find(
            (a) => a.addresses.length > 0 && !a.addresses.some((addr) => addr.family === "IPv4" && !addr.internal),
        );
        if (!ipv6Only) return;
        const client = new TestTCNetClient();
        client.initMockSockets();
        client.setConnected(true);
        await expect(client.switchAdapter(ipv6Only.name)).rejects.toThrow("IPv4");
    });
});

describe("switchAdapter() 切り替えロジック", () => {
    it("pendingリクエストがrejectされる", async () => {
        const client = new TestTCNetClient();
        client.initMockSockets();
        client.setConnected(true);
        client.mockConnectToAdapter();

        const pendingPromise = new Promise<void>((resolve, reject) => {
            client.addMockRequest("2-0", resolve, reject);
        });

        const adapterName = getFirstNonLoopbackAdapter();
        const switchPromise = client.switchAdapter(adapterName).catch(() => {});
        await expect(pendingPromise).rejects.toThrow("Connection switching");
        await switchPromise;
    });

    it("リスナーが維持される", async () => {
        const client = new TestTCNetClient();
        client.initMockSockets();
        client.setConnected(true);
        client.mockConnectToAdapter();

        const handler = vi.fn();
        client.on("broadcast", handler);

        await client.switchAdapter(getFirstNonLoopbackAdapter());

        expect(client.listenerCount("broadcast")).toBe(1);
    });

    it("switching中にsendServer()がエラー", async () => {
        const client = new TestTCNetClient();
        client.initMockSockets();
        client.setConnected(true);
        (client as any).connectToAdapter = () => new Promise((r) => setTimeout(r, 500));

        const switchPromise = client.switchAdapter(getFirstNonLoopbackAdapter()).catch(() => {});
        await new Promise((r) => setTimeout(r, 50));
        const nw = await import("../src/network");
        await expect(client.sendServer(new nw.TCNetOptInPacket())).rejects.toThrow("switching");
        await client.disconnect();
        await switchPromise;
    });

    it("switching中にrequestData()がエラー", async () => {
        const client = new TestTCNetClient();
        client.initMockSockets();
        client.setConnected(true);
        (client as any).connectToAdapter = () => new Promise((r) => setTimeout(r, 500));

        const switchPromise = client.switchAdapter(getFirstNonLoopbackAdapter()).catch(() => {});
        await new Promise((r) => setTimeout(r, 50));
        await expect(client.requestData(2, 0)).rejects.toThrow("switching");
        await client.disconnect();
        await switchPromise;
    });
});

describe("switchAdapter() リトライ", () => {
    it("初回失敗、2回目で成功", async () => {
        const client = new TestTCNetClient();
        client.initMockSockets();
        client.setConnected(true);
        client.setRetryConfig(3, 50);
        client.mockConnectWithFailures(1);

        await expect(client.switchAdapter(getFirstNonLoopbackAdapter())).resolves.toBeUndefined();
    });

    it("全リトライ失敗でエラー", async () => {
        const client = new TestTCNetClient();
        client.initMockSockets();
        client.setConnected(true);
        client.setRetryConfig(2, 50);
        client.mockConnectAlwaysFail();

        await expect(client.switchAdapter(getFirstNonLoopbackAdapter())).rejects.toThrow("Failed to switch adapter");
    });

    it("リトライ中にdisconnect()で中断", async () => {
        const client = new TestTCNetClient();
        client.initMockSockets();
        client.setConnected(true);
        client.setRetryConfig(5, 100);
        client.mockConnectAlwaysFail();

        const adapterName = getFirstNonLoopbackAdapter();
        const switchPromise = client.switchAdapter(adapterName);
        setTimeout(() => client.disconnect(), 150);
        await expect(switchPromise).rejects.toThrow("interrupted");
    });

    it("検出中 (未確定) での切り替え", async () => {
        const client = new TestTCNetClient();
        client.setConfig({ detectionTimeout: 500, unicastPort: uniquePort() });
        await client.connect();
        client.mockConnectToAdapter();
        await expect(client.switchAdapter(getFirstNonLoopbackAdapter())).resolves.toBeUndefined();
        await client.disconnect();
    });
});
