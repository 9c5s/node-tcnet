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
        // 注意: Loop OUT Time (byte 46-49) と CUE 1 (byte 47-) は仕様上重複する
        // CUE 1 at byte 47 (仕様通り)
        buffer.writeUInt8(1, 47);
        buffer.writeUInt32LE(5000, 49);
        buffer.writeUInt32LE(0, 53);
        buffer.writeUInt8(255, 58);
        buffer.writeUInt8(0, 59);
        buffer.writeUInt8(128, 60);
        // CUE 2 at byte 69
        buffer.writeUInt8(2, 69);
        buffer.writeUInt32LE(10000, 71);

        const packet = new TCNetDataPacketCUE();
        packet.buffer = buffer;
        packet.header = createHeader(buffer);
        packet.read();

        expect(packet.data).not.toBeNull();
        expect(packet.data!.loopInTime).toBe(1000);
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

    it("inTime/outTimeが共に0のCUEエントリはスキップする", () => {
        const buffer = Buffer.alloc(436);
        buffer.writeUInt8(3, 2);
        buffer.write("TCN", 4, "ascii");
        buffer.writeUInt8(200, 7);
        buffer.writeUInt8(12, 24);
        buffer.writeUInt8(1, 25);
        // CUE 1 at byte 47: type=1だがinTime/outTime共に0 → スキップ
        buffer.writeUInt8(1, 47);
        // CUE 2 at byte 69: inTime=3000 → 含まれる
        buffer.writeUInt8(1, 69);
        buffer.writeUInt32LE(3000, 71);

        const packet = new TCNetDataPacketCUE();
        packet.buffer = buffer;
        packet.header = createHeader(buffer);
        packet.read();

        expect(packet.data!.cues).toHaveLength(1);
        expect(packet.data!.cues[0].index).toBe(2);
        expect(packet.data!.cues[0].inTime).toBe(3000);
    });

    it("type=0でもinTimeが非0ならエントリに含まれる", () => {
        const buffer = Buffer.alloc(436);
        buffer.writeUInt8(3, 2);
        buffer.write("TCN", 4, "ascii");
        buffer.writeUInt8(200, 7);
        buffer.writeUInt8(12, 24);
        buffer.writeUInt8(1, 25);
        // CUE 1 at byte 47: type=0, inTime=563 (BridgeがTYPE未実装のケース)
        buffer.writeUInt32LE(563, 49);

        const packet = new TCNetDataPacketCUE();
        packet.buffer = buffer;
        packet.header = createHeader(buffer);
        packet.read();

        expect(packet.data!.cues).toHaveLength(1);
        expect(packet.data!.cues[0].type).toBe(0);
        expect(packet.data!.cues[0].inTime).toBe(563);
    });

    it("length() は 436 を返す", () => {
        expect(new TCNetDataPacketCUE().length()).toBe(436);
    });

    it("write() はエラーを投げる", () => {
        expect(() => new TCNetDataPacketCUE().write()).toThrow("not supported!");
    });

    it("全CUEスロットのinTime/outTimeが0の場合cuesは空配列になる", () => {
        const buffer = Buffer.alloc(436);
        buffer.writeUInt8(3, 2);
        buffer.write("TCN", 4, "ascii");
        buffer.writeUInt8(200, 7);
        buffer.writeUInt8(12, 24);
        buffer.writeUInt8(1, 25);
        // 全スロットがゼロ (Buffer.allocのデフォルト) → 全エントリスキップ

        const packet = new TCNetDataPacketCUE();
        packet.buffer = buffer;
        packet.header = createHeader(buffer);
        packet.read();

        expect(packet.data).not.toBeNull();
        expect(packet.data!.cues).toHaveLength(0);
    });
});
