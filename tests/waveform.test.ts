import { describe, it, expect } from "vitest";
import { TCNetDataPacketSmallWaveForm, TCNetDataPacketBigWaveForm, TCNetManagementHeader } from "../src/network";

function createHeader(buffer: Buffer): TCNetManagementHeader {
    const header = new TCNetManagementHeader(buffer);
    header.minorVersion = 5;
    return header;
}

describe("TCNetDataPacketSmallWaveForm", () => {
    it("波形バーをパースする", () => {
        const buffer = Buffer.alloc(2442);
        buffer.writeUInt8(3, 2);
        buffer.write("TCN", 4, "ascii");
        buffer.writeUInt8(200, 7);
        buffer.writeUInt8(16, 24);
        buffer.writeUInt8(1, 25);
        buffer.writeUInt8(200, 42);
        buffer.writeUInt8(150, 43);
        buffer.writeUInt8(100, 44);
        buffer.writeUInt8(50, 45);

        const packet = new TCNetDataPacketSmallWaveForm();
        packet.buffer = buffer;
        packet.header = createHeader(buffer);
        packet.read();

        expect(packet.data).not.toBeNull();
        expect(packet.data!.bars).toHaveLength(1200);
        expect(packet.data!.bars[0]).toEqual({ level: 200, color: 150 });
        expect(packet.data!.bars[1]).toEqual({ level: 100, color: 50 });
        expect(packet.data!.bars[2]).toEqual({ level: 0, color: 0 });
    });

    it("バッファが短い場合でもクラッシュしない", () => {
        const buffer = Buffer.alloc(100); // 2442 より短い
        buffer.writeUInt8(3, 2);
        buffer.write("TCN", 4, "ascii");
        buffer.writeUInt8(200, 7);
        buffer.writeUInt8(16, 24);
        buffer.writeUInt8(1, 25);
        buffer.writeUInt8(200, 42);
        buffer.writeUInt8(150, 43);

        const packet = new TCNetDataPacketSmallWaveForm();
        packet.buffer = buffer;
        packet.header = createHeader(buffer);
        packet.read();

        expect(packet.data).not.toBeNull();
        expect(packet.data!.bars.length).toBeLessThan(1200);
        expect(packet.data!.bars[0]).toEqual({ level: 200, color: 150 });
    });

    it("length() は 2442 を返す", () => {
        expect(new TCNetDataPacketSmallWaveForm().length()).toBe(2442);
    });

    it("write() はエラーを投げる", () => {
        expect(() => new TCNetDataPacketSmallWaveForm().write()).toThrow("not supported!");
    });
});

describe("TCNetDataPacketBigWaveForm", () => {
    it("アセンブル済みバッファから波形バーをパースする", () => {
        const data = Buffer.alloc(10);
        data.writeUInt8(200, 0);
        data.writeUInt8(150, 1);
        data.writeUInt8(100, 2);
        data.writeUInt8(50, 3);

        const packet = new TCNetDataPacketBigWaveForm();
        packet.readAssembled(data);

        expect(packet.data).not.toBeNull();
        expect(packet.data!.bars).toHaveLength(5);
        expect(packet.data!.bars[0]).toEqual({ level: 200, color: 150 });
        expect(packet.data!.bars[1]).toEqual({ level: 100, color: 50 });
    });

    it("通常の read() は個別パケットの波形データをパースする", () => {
        const buffer = Buffer.alloc(4842);
        buffer.writeUInt8(3, 2);
        buffer.write("TCN", 4, "ascii");
        buffer.writeUInt8(200, 7);
        buffer.writeUInt8(32, 24);
        buffer.writeUInt8(1, 25);
        buffer.writeUInt8(128, 42);
        buffer.writeUInt8(64, 43);

        const packet = new TCNetDataPacketBigWaveForm();
        packet.buffer = buffer;
        packet.header = createHeader(buffer);
        packet.read();

        expect(packet.data).not.toBeNull();
        expect(packet.data!.bars[0]).toEqual({ level: 128, color: 64 });
    });

    it("length() は -1 を返す (可変長)", () => {
        expect(new TCNetDataPacketBigWaveForm().length()).toBe(-1);
    });
});
