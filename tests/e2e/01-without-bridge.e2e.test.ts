import { describe, it, expect } from "vitest";
import { createTestClient, waitForEvent } from "./helpers";

// Bridge未起動環境でのクライアント動作を検証するE2Eテストである
// このテストはBridgeが起動していない状態でのみ正常に通過する
describe("Bridge未起動テスト", () => {
    it("connect()が即resolveし、isConnected === false", async () => {
        const client = createTestClient({ detectionTimeout: 3_000 });
        await client.connect();
        expect(client.isConnected).toBe(false);
        expect(client.selectedAdapter).toBeNull();
        await client.disconnect();
    });

    it("detectionTimeoutイベントが発火する", async () => {
        const client = createTestClient({ detectionTimeout: 3_000 });
        await client.connect();
        // detectionTimeoutイベントは引数なしで発火するため、resolveすること自体を検証する
        await waitForEvent(client, "detectionTimeout", 5_000);
        await client.disconnect();
    });
});
