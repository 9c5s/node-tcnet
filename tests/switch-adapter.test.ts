import { describe, it, expect, vi } from "vitest";
import { TCNetClient } from "../src/tcnet";
import { listNetworkAdapters } from "../src/utils";
import { writeValidHeader, isolateXteaEnv } from "./helpers";

isolateXteaEnv();

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
    public callWaitConnected(): Promise<void> {
        return (this as any).waitConnected();
    }
    public simulateBroadcast(
        msg: Buffer,
        rinfo = { address: "192.168.0.10", port: 60000, family: "IPv4" as const, size: msg.length },
    ): void {
        (this as any).receiveBroadcast(msg, rinfo);
    }
    public simulateTimestamp(
        msg: Buffer,
        rinfo = { address: "192.168.0.10", port: 60001, family: "IPv4" as const, size: msg.length },
    ): void {
        (this as any).receiveTimestamp(msg, rinfo);
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

function createStatusBuffer(): Buffer {
    const buffer = Buffer.alloc(300);
    writeValidHeader(buffer, 5); // Status
    return buffer;
}

function createTimeBuffer(): Buffer {
    const buffer = Buffer.alloc(154);
    writeValidHeader(buffer, 254); // Time
    return buffer;
}

// テストごとにユニークなユニキャストポートを割り当てる
let nextPort = 64000;
function uniquePort(): number {
    return nextPort++;
}

describe("connect() 新挙動", () => {
    it("即座にresolveする", async () => {
        const client = new TestTCNetClient();
        client.setConfig({
            detectionTimeout: 100,
            requestTimeout: 100,
            unicastPort: uniquePort(),
            nodeOptions: 0,
        });
        await client.connect();
        expect(client.isConnected).toBe(false);
        expect(client.selectedAdapter).toBeNull();
        await client.disconnect();
    });

    it("二重呼び出しでエラー", async () => {
        const client = new TestTCNetClient();
        client.setConfig({ detectionTimeout: 100, unicastPort: uniquePort(), nodeOptions: 0 });
        await client.connect();
        await expect(client.connect()).rejects.toThrow();
        await client.disconnect();
    });

    it("detectionTimeoutイベントが発火する", async () => {
        vi.useFakeTimers();
        try {
            const client = new TestTCNetClient();
            client.setConfig({ detectionTimeout: 100, unicastPort: uniquePort(), nodeOptions: 0 });
            const handler = vi.fn();
            await client.connect();
            client.on("detectionTimeout", handler);
            await vi.advanceTimersByTimeAsync(100);
            expect(handler).toHaveBeenCalledTimes(1);
            await client.disconnect();
        } finally {
            vi.useRealTimers();
        }
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
        vi.useFakeTimers();
        try {
            const port = uniquePort();
            const client = new TestTCNetClient();
            client.setConfig({ detectionTimeout: 50, unicastPort: port });
            await client.connect();
            await vi.advanceTimersByTimeAsync(50);
            await client.disconnect();
            // disconnect後は同じポートを再利用可能
            client.setConfig({ detectionTimeout: 50, unicastPort: port });
            await expect(client.connect()).resolves.toBeUndefined();
            await client.disconnect();
        } finally {
            vi.useRealTimers();
        }
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

    it("waitConnected中にdisconnectSockets()するとrejectされる", async () => {
        const client = new TestTCNetClient();
        client.initMockSockets();
        client.setConfig({ detectionTimeout: 0 });

        const waitPromise = client.callWaitConnected();

        await client.callDisconnectSockets();

        await expect(waitPromise).rejects.toThrow("Disconnected");
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
        const nw = await import("../src/network");
        const packet = new nw.TCNetOptInPacket();
        // broadcastSocketがnullなのでエラーになる
        await expect(client.broadcastPacket(packet)).rejects.toThrow("Adapter not yet selected");
    });

    it("検出中はbroadcastイベントが発火しない", () => {
        // 実ネットワークを使わずモック状態でテストする (フレークテスト対策)
        const client = new TestTCNetClient();
        const handler = vi.fn();
        client.on("broadcast", handler);
        // connected=falseのままStatusパケットをシミュレーションする
        client.simulateBroadcast(createStatusBuffer());
        expect(handler).not.toHaveBeenCalled();
    });

    it("検出中はtimeイベントが発火しない", () => {
        // 実ネットワークを使わずモック状態でテストする (フレークテスト対策)
        const client = new TestTCNetClient();
        const timeHandler = vi.fn();
        client.on("time", timeHandler);
        // connected=falseのままTimeパケットをシミュレーションする
        client.simulateTimestamp(createTimeBuffer());
        expect(timeHandler).not.toHaveBeenCalled();
    });
});

describe("switchAdapter() バリデーション", () => {
    it("存在しないアダプタ名でエラー", async () => {
        const client = new TestTCNetClient();
        client.initMockSockets();
        client.setConnected(true);
        await expect(client.switchAdapter("nonexistent_adapter_xyz_12345")).rejects.toThrow("does not exist");
    });

    const ipv6OnlyAdapter = listNetworkAdapters().find(
        (a) => a.addresses.length > 0 && !a.addresses.some((addr) => addr.family === "IPv4" && !addr.internal),
    );

    it.skipIf(!ipv6OnlyAdapter)("IPv4のないアダプタでエラー", async () => {
        const client = new TestTCNetClient();
        client.initMockSockets();
        client.setConnected(true);
        await expect(client.switchAdapter(ipv6OnlyAdapter!.name)).rejects.toThrow("IPv4");
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
        await expect(pendingPromise).rejects.toThrow("Disconnected");
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
