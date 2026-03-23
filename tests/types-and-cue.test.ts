import { describe, it, expect } from "vitest";
import { TCNetDataPacketCUE, TCNetManagementHeader } from "../src/network";

describe("TCNetDataPacketCUE", () => {
    function createHeader(buffer: Buffer): TCNetManagementHeader {
        const header = new TCNetManagementHeader(buffer);
        header.minorVersion = 5;
        return header;
    }

    it("CUEデータをパースする", () => {
        const buffer = Buffer.alloc(436);
        buffer.writeUInt8(3, 2);
        buffer.write("TCN", 4, "ascii");
        buffer.writeUInt8(200, 7);
        buffer.writeUInt8(12, 24);
        buffer.writeUInt8(1, 25);
        buffer.writeUInt32LE(1000, 42);
        buffer.writeUInt32LE(2000, 46);
        // CUE 1 at byte 50
        buffer.writeUInt8(1, 50);
        buffer.writeUInt32LE(5000, 52);
        buffer.writeUInt32LE(0, 56);
        buffer.writeUInt8(255, 61);
        buffer.writeUInt8(0, 62);
        buffer.writeUInt8(128, 63);
        // CUE 2 at byte 72
        buffer.writeUInt8(2, 72);
        buffer.writeUInt32LE(10000, 74);

        const packet = new TCNetDataPacketCUE();
        packet.buffer = buffer;
        packet.header = createHeader(buffer);
        packet.read();

        expect(packet.data).not.toBeNull();
        expect(packet.data!.loopInTime).toBe(1000);
        expect(packet.data!.loopOutTime).toBe(2000);
        expect(packet.data!.cues).toHaveLength(2);
        expect(packet.data!.cues[0]).toEqual({
            index: 1,
            type: 1,
            inTime: 5000,
            outTime: 0,
            color: { r: 255, g: 0, b: 128 },
        });
        expect(packet.data!.cues[1].index).toBe(2);
    });

    it("type === 0 のCUEエントリはスキップする", () => {
        const buffer = Buffer.alloc(436);
        buffer.writeUInt8(3, 2);
        buffer.write("TCN", 4, "ascii");
        buffer.writeUInt8(200, 7);
        buffer.writeUInt8(12, 24);
        buffer.writeUInt8(1, 25);
        buffer.writeUInt8(0, 50);
        buffer.writeUInt8(1, 72);
        buffer.writeUInt32LE(3000, 74);

        const packet = new TCNetDataPacketCUE();
        packet.buffer = buffer;
        packet.header = createHeader(buffer);
        packet.read();

        expect(packet.data!.cues).toHaveLength(1);
        expect(packet.data!.cues[0].index).toBe(2);
    });

    it("length() は 436 を返す", () => {
        expect(new TCNetDataPacketCUE().length()).toBe(436);
    });

    it("write() はエラーを投げる", () => {
        expect(() => new TCNetDataPacketCUE().write()).toThrow("not supported!");
    });
});
