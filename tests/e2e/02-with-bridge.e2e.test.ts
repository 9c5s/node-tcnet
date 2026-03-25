import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TCNetClient } from "../../src/tcnet";
import { TCNetTimePacket, TCNetDataPacketMetrics, TCNetDataPacketType } from "../../src/network";
import type { NetworkAdapterInfo } from "../../src/utils";
import { createTestClient, waitForEvent, startBridge, stopBridge } from "./helpers";

// Bridge起動済み環境でのE2Eテストである
// アダプタ検出, パケット受信, データリクエスト, アダプタ切替を検証する

let bridgeInfo: { pid: number; alreadyRunning: boolean };

beforeAll(async () => {
    // Bridgeが起動していなければ起動する (前のテストファイルとの状態共有に依存しない)
    bridgeInfo = await startBridge();
});

afterAll(async () => {
    // テストで起動したBridgeのみ停止する (テスト前から起動済みなら触らない)
    if (bridgeInfo && !bridgeInfo.alreadyRunning) {
        await stopBridge(bridgeInfo.pid);
    }
});

describe("アダプタ自動検出・収束", () => {
    let client: TCNetClient;
    let detectedAdapter: NetworkAdapterInfo;

    beforeAll(async () => {
        client = createTestClient();
        const adapterPromise = waitForEvent<NetworkAdapterInfo>(client, "adapterSelected", 15_000);
        await client.connect();
        detectedAdapter = await adapterPromise;
    });

    afterAll(async () => {
        if (client) await client.disconnect();
    });

    it("adapterSelectedイベントが発火し、有効なアダプタ情報が渡される", () => {
        expect(detectedAdapter).toBeDefined();
        expect(detectedAdapter.name).toBeTruthy();
    });

    it("selectedAdapterがnon-null", () => {
        expect(client.selectedAdapter).not.toBeNull();
        expect(client.selectedAdapter!.name).toBe(detectedAdapter.name);
    });
});

describe("broadcast/timeイベント受信", () => {
    let client: TCNetClient;

    beforeAll(async () => {
        client = createTestClient();
        const adapterPromise = waitForEvent(client, "adapterSelected", 15_000);
        await client.connect();
        await adapterPromise;
    });

    afterAll(async () => {
        if (client) await client.disconnect();
    });

    it("broadcastイベントでパケットを受信する", async () => {
        const packet = await waitForEvent(client, "broadcast", 10_000);
        expect(packet).toBeDefined();
    });

    it("timeイベントでTCNetTimePacketを受信する", async () => {
        const packet = await waitForEvent<TCNetTimePacket>(client, "time", 10_000);
        expect(packet).toBeInstanceOf(TCNetTimePacket);
        expect(packet.layers).toHaveLength(8);
    });
});

describe("requestData", () => {
    let client: TCNetClient;

    beforeAll(async () => {
        client = createTestClient({ requestTimeout: 10_000 });
        const adapterPromise = waitForEvent(client, "adapterSelected", 15_000);
        await client.connect();
        await adapterPromise;
    });

    afterAll(async () => {
        if (client) await client.disconnect();
    });

    it("Metricsデータを取得できる", async () => {
        // MetricsDataのみテストする (CUEData等はBridge側が未対応のため対象外)
        const packet = await client.requestData(TCNetDataPacketType.MetricsData, 0);
        expect(packet).toBeInstanceOf(TCNetDataPacketMetrics);
        const metrics = packet as TCNetDataPacketMetrics;
        expect(metrics.data).toBeDefined();
    });
});

describe("switchAdapter", () => {
    let client: TCNetClient;

    beforeAll(async () => {
        client = createTestClient();
        const adapterPromise = waitForEvent(client, "adapterSelected", 15_000);
        await client.connect();
        await adapterPromise;
    });

    afterAll(async () => {
        if (client) await client.disconnect();
    });

    it("同じアダプタへの再接続でadapterSelectedイベントが発火する", async () => {
        const currentAdapter = client.selectedAdapter;
        expect(currentAdapter).not.toBeNull();

        const adapterPromise = waitForEvent<NetworkAdapterInfo>(client, "adapterSelected", 15_000);
        await client.switchAdapter(currentAdapter!.name);
        const adapter = await adapterPromise;
        expect(adapter.name).toBe(currentAdapter!.name);
    });
});
