import { describe, it, expect } from "vitest";
import { TCNetDataPacketMixer, TCNetDataPacketBeatGrid, TCNetManagementHeader } from "../src/network";

function createHeader(buffer: Buffer): TCNetManagementHeader {
    const header = new TCNetManagementHeader(buffer);
    header.minorVersion = 5;
    return header;
}

describe("TCNetDataPacketMixer", () => {
    it("Mixerデータをパースする", () => {
        const buffer = Buffer.alloc(270);
        buffer.writeUInt8(3, 2);
        buffer.write("TCN", 4, "ascii");
        buffer.writeUInt8(200, 7);
        buffer.writeUInt8(150, 24);
        buffer.writeUInt8(1, 25);
        buffer.writeUInt8(2, 26);
        buffer.write("DJM-900NXS2\x00\x00\x00\x00\x00", 29, "ascii");
        buffer.writeUInt8(100, 61);
        buffer.writeUInt8(127, 62);
        buffer.writeUInt8(64, 69);
        buffer.writeUInt8(1, 74);
        buffer.writeUInt8(64, 75);
        buffer.writeUInt8(64, 76);
        buffer.writeUInt8(64, 77);
        buffer.writeUInt8(0, 79);
        buffer.writeUInt8(127, 80);
        buffer.writeUInt8(0, 81);
        buffer.writeUInt8(1, 97);
        buffer.writeUInt8(2, 98);
        buffer.writeUInt8(64, 99);
        buffer.writeUInt8(1, 100);
        buffer.writeUInt8(50, 101);
        buffer.writeUInt8(3, 102);
        buffer.writeUInt8(5, 103);
        buffer.writeUInt8(80, 108);
        buffer.writeUInt8(60, 110);
        buffer.writeUInt8(90, 112);
        // Channel 1 at offset 125
        buffer.writeUInt8(1, 125);
        buffer.writeUInt8(100, 126);
        buffer.writeUInt8(127, 127);

        const packet = new TCNetDataPacketMixer();
        packet.buffer = buffer;
        packet.header = createHeader(buffer);
        packet.read();

        expect(packet.data).not.toBeNull();
        expect(packet.data!.mixerName).toBe("DJM-900NXS2");
        expect(packet.data!.masterAudioLevel).toBe(100);
        expect(packet.data!.masterIsolatorOn).toBe(true);
        expect(packet.data!.beatFxOn).toBe(true);
        expect(packet.data!.crossFader).toBe(64);
        expect(packet.data!.channels).toHaveLength(6);
        expect(packet.data!.channels[0].sourceSelect).toBe(1);
        expect(packet.data!.channels[0].audioLevel).toBe(100);
        expect(packet.data!.channels[0].faderLevel).toBe(127);
    });

    it("length() は 270 を返す", () => {
        expect(new TCNetDataPacketMixer().length()).toBe(270);
    });

    it("バッファが 258 バイトの場合 data は null のまま", () => {
        // Arrange: 最大オフセット 258 に届かない 258 バイトのバッファ
        const buffer = Buffer.alloc(258);
        buffer.writeUInt8(3, 2);
        buffer.write("TCN", 4, "ascii");
        buffer.writeUInt8(200, 7);

        // Act
        const packet = new TCNetDataPacketMixer();
        packet.buffer = buffer;
        packet.header = createHeader(buffer);
        packet.read();

        // Assert
        expect(packet.data).toBeNull();
    });
});

describe("TCNetDataPacketBeatGrid", () => {
    it("ビートグリッドエントリをパースする", () => {
        const buffer = Buffer.alloc(2442);
        buffer.writeUInt8(3, 2);
        buffer.write("TCN", 4, "ascii");
        buffer.writeUInt8(200, 7);
        buffer.writeUInt8(8, 24);
        buffer.writeUInt8(1, 25);
        buffer.writeUInt16LE(1, 42);
        buffer.writeUInt8(20, 44);
        buffer.writeUInt32LE(1000, 46);
        buffer.writeUInt16LE(2, 50);
        buffer.writeUInt8(10, 52);
        buffer.writeUInt32LE(1500, 54);
        // entry 3: all zero (スキップ)
        buffer.writeUInt16LE(4, 66);
        buffer.writeUInt8(20, 68);
        buffer.writeUInt32LE(2500, 70);

        const packet = new TCNetDataPacketBeatGrid();
        packet.buffer = buffer;
        packet.header = createHeader(buffer);
        packet.read();

        expect(packet.data).not.toBeNull();
        expect(packet.data!.entries).toHaveLength(3);
        expect(packet.data!.entries[0]).toEqual({ beatNumber: 1, beatType: 20, timestampMs: 1000 });
        expect(packet.data!.entries[1].beatType).toBe(10);
        expect(packet.data!.entries[2].beatNumber).toBe(4);
    });

    it("length() は 2442 を返す", () => {
        expect(new TCNetDataPacketBeatGrid().length()).toBe(2442);
    });

    it("beatNumber=0 かつ timestampMs!=0 のエントリはスキップされない", () => {
        // Arrange: offset 42 からエントリを書き込む
        // entry 1: beatNumber=0, timestampMs=500 (スキップされない)
        // entry 2: beatNumber=3, timestampMs=0 (スキップされない)
        // entry 3: beatNumber=0, timestampMs=0 (スキップされる)
        const buffer = Buffer.alloc(2442);
        buffer.writeUInt8(3, 2);
        buffer.write("TCN", 4, "ascii");
        buffer.writeUInt8(200, 7);
        buffer.writeUInt8(8, 24);
        buffer.writeUInt8(1, 25);
        // entry 1: beatNumber=0, beatType=5, timestampMs=500
        buffer.writeUInt16LE(0, 42);
        buffer.writeUInt8(5, 44);
        buffer.writeUInt32LE(500, 46);
        // entry 2: beatNumber=3, beatType=10, timestampMs=0
        buffer.writeUInt16LE(3, 50);
        buffer.writeUInt8(10, 52);
        buffer.writeUInt32LE(0, 54);
        // entry 3: beatNumber=0, beatType=0, timestampMs=0 (スキップ)
        buffer.writeUInt16LE(0, 58);
        buffer.writeUInt8(0, 60);
        buffer.writeUInt32LE(0, 62);

        // Act
        const packet = new TCNetDataPacketBeatGrid();
        packet.buffer = buffer;
        packet.header = createHeader(buffer);
        packet.read();

        // Assert: entry 1, 2 は含まれ, entry 3 はスキップされる
        expect(packet.data).not.toBeNull();
        expect(packet.data!.entries).toHaveLength(2);
        expect(packet.data!.entries[0]).toEqual({ beatNumber: 0, beatType: 5, timestampMs: 500 });
        expect(packet.data!.entries[1]).toEqual({ beatNumber: 3, beatType: 10, timestampMs: 0 });
    });

    it("readAssembled() はオフセット 0 からエントリをパースする", () => {
        // Arrange: アセンブル済みバッファはオフセット 0 からデータが始まる
        const assembled = Buffer.alloc(16);
        // entry 1: beatNumber=7, beatType=1, timestampMs=2000
        assembled.writeUInt16LE(7, 0);
        assembled.writeUInt8(1, 2);
        assembled.writeUInt32LE(2000, 4);
        // entry 2: beatNumber=8, beatType=2, timestampMs=4000
        assembled.writeUInt16LE(8, 8);
        assembled.writeUInt8(2, 10);
        assembled.writeUInt32LE(4000, 12);

        // Act
        const packet = new TCNetDataPacketBeatGrid();
        packet.readAssembled(assembled);

        // Assert
        expect(packet.data).not.toBeNull();
        expect(packet.data!.entries).toHaveLength(2);
        expect(packet.data!.entries[0]).toEqual({ beatNumber: 7, beatType: 1, timestampMs: 2000 });
        expect(packet.data!.entries[1]).toEqual({ beatNumber: 8, beatType: 2, timestampMs: 4000 });
    });
});
