import { describe, it, expect, vi } from "vitest";
import * as nw from "../src/network";
import { writeValidHeader, TestTCNetClient } from "./helpers";

function createDataBuffer(dataType: number, layer: number, size: number): Buffer {
    const buffer = Buffer.alloc(size);
    writeValidHeader(buffer, 200);
    buffer.writeUInt8(dataType, 24);
    buffer.writeUInt8(layer, 25);
    return buffer;
}

describe("receiveUnicast マルチパケット対応", () => {
    it("CUEパケットで data イベントが emit される", () => {
        const client = new TestTCNetClient();
        client.simulateConnected();
        const handler = vi.fn();
        client.on("data", handler);

        const buffer = createDataBuffer(nw.TCNetDataPacketType.CUEData, 1, 436);
        buffer.writeUInt32LE(1000, 42);
        client.simulateUnicast(buffer);

        expect(handler).toHaveBeenCalledTimes(1);
        const packet = handler.mock.calls[0][0];
        expect(packet).toBeInstanceOf(nw.TCNetDataPacketCUE);
        expect(packet.data).not.toBeNull();
        expect(packet.data.loopInTime).toBe(1000);
    });

    it("SmallWaveFormパケットで data イベントが emit される", () => {
        const client = new TestTCNetClient();
        client.simulateConnected();
        const handler = vi.fn();
        client.on("data", handler);

        const buffer = createDataBuffer(nw.TCNetDataPacketType.SmallWaveFormData, 1, 2442);
        client.simulateUnicast(buffer);

        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0]).toBeInstanceOf(nw.TCNetDataPacketSmallWaveForm);
    });
});

describe("receiveUnicast 未定義dataType", () => {
    it("未定義dataTypeのDataパケットを受信してもクラッシュしない", () => {
        const client = new TestTCNetClient();
        client.simulateConnected();
        const handler = vi.fn();
        client.on("data", handler);

        // dataType=255 はTCNetDataPacketsに定義されていない
        const buffer = createDataBuffer(255, 1, 436);
        expect(() => client.simulateUnicast(buffer)).not.toThrow();
        expect(handler).not.toHaveBeenCalled();
    });

    it("TCNetDataPacketsに未定義キーでアクセスするとundefinedが返る", () => {
        const result = nw.TCNetDataPackets[255 as nw.TCNetDataPacketType];
        expect(result).toBeUndefined();
    });
});

describe("TCNetClient.requestData() layer バリデーション", () => {
    // バリデーション失敗時は sendServer に到達しないため、接続状態不要でテスト可能

    it("layer = -1 は RangeError で reject される", async () => {
        const client = new TestTCNetClient();
        await expect(client.requestData(2, -1)).rejects.toThrow(RangeError);
    });

    it("layer = 8 は RangeError で reject される", async () => {
        const client = new TestTCNetClient();
        await expect(client.requestData(2, 8)).rejects.toThrow(RangeError);
    });

    it("layer = 3.5 (小数) は RangeError で reject される", async () => {
        const client = new TestTCNetClient();
        await expect(client.requestData(2, 3.5)).rejects.toThrow(RangeError);
    });

    it("layer = NaN は RangeError で reject される", async () => {
        const client = new TestTCNetClient();
        await expect(client.requestData(2, NaN)).rejects.toThrow(RangeError);
    });
});
