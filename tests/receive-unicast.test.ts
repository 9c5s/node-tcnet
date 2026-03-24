import { describe, it, expect, vi } from "vitest";
import { TCNetClient } from "../src/tcnet";
import * as nw from "../src/network";

class TestTCNetClient extends TCNetClient {
    public simulateUnicast(
        msg: Buffer,
        rinfo = { address: "127.0.0.1", port: 65023, family: "IPv4" as const, size: msg.length },
    ): void {
        (this as any).receiveUnicast(msg, rinfo);
    }
    public simulateConnected(): void {
        (this as any).connected = true;
    }
}

function createDataBuffer(dataType: number, layer: number, size: number): Buffer {
    const buffer = Buffer.alloc(size);
    buffer.writeUInt16LE(1, 0);
    buffer.writeUInt8(3, 2);
    buffer.writeUInt8(5, 3);
    buffer.write("TCN", 4, "ascii");
    buffer.writeUInt8(200, 7);
    buffer.writeUInt8(0x04, 17);
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
