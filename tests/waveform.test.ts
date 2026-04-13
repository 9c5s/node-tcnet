import { describe, it, expect } from "vitest";
import { TCNetDataPacketSmallWaveForm, TCNetDataPacketBigWaveForm, TCNetManagementHeader } from "../src/network";

function createHeader(buffer: Buffer): TCNetManagementHeader {
    const header = new TCNetManagementHeader(buffer);
    header.minorVersion = 5;
    return header;
}

function createSmallWaveFormPacket(dataBytes: number[]): TCNetDataPacketSmallWaveForm {
    const buffer = Buffer.alloc(2442);
    buffer.writeUInt8(3, 2);
    buffer.write("TCN", 4, "ascii");
    buffer.writeUInt8(200, 7);
    buffer.writeUInt8(16, 24);
    buffer.writeUInt8(1, 25);
    for (let i = 0; i < dataBytes.length; i++) {
        buffer.writeUInt8(dataBytes[i], 42 + i);
    }
    const packet = new TCNetDataPacketSmallWaveForm();
    packet.buffer = buffer;
    packet.header = createHeader(buffer);
    packet.read();
    return packet;
}

describe("TCNetDataPacketSmallWaveForm", () => {
    it("波形バーをパースする", () => {
        const packet = createSmallWaveFormPacket([200, 150, 100, 50]);

        expect(packet.data).not.toBeNull();
        expect(packet.data!.bars).toHaveLength(1200);
        expect(packet.data!.bars[0]).toEqual({ color: 200, level: 150 });
        expect(packet.data!.bars[1]).toEqual({ color: 100, level: 50 });
        expect(packet.data!.bars[2]).toEqual({ color: 0, level: 0 });
    });

    it("バッファが短い場合でもクラッシュしない", () => {
        const buffer = Buffer.alloc(100);
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
        expect(packet.data!.bars[0]).toEqual({ color: 200, level: 150 });
    });

    it("length() は 2442 を返す", () => {
        expect(new TCNetDataPacketSmallWaveForm().length()).toBe(2442);
    });

    it("write() はエラーを投げる", () => {
        expect(() => new TCNetDataPacketSmallWaveForm().write()).toThrow("not supported!");
    });

    it("奇数バイト境界のバッファ (dataStart=42, 1バイト) では bars が空になる", () => {
        const buffer = Buffer.alloc(43);
        buffer.writeUInt8(3, 2);
        buffer.write("TCN", 4, "ascii");
        buffer.writeUInt8(200, 7);
        buffer.writeUInt8(16, 24);
        buffer.writeUInt8(1, 25);
        buffer.writeUInt8(255, 42);

        const packet = new TCNetDataPacketSmallWaveForm();
        packet.buffer = buffer;
        packet.header = createHeader(buffer);
        packet.read();

        expect(packet.data).not.toBeNull();
        expect(packet.data!.bars).toHaveLength(0);
    });

    it("colorとlevelが同一値でも正しくパースする", () => {
        const packet = createSmallWaveFormPacket([100, 100]);
        expect(packet.data!.bars[0]).toEqual({ color: 100, level: 100 });
    });

    it("colorとlevelの境界値を正しくパースする", () => {
        const packet = createSmallWaveFormPacket([0, 255, 255, 0]);
        expect(packet.data!.bars[0]).toEqual({ color: 0, level: 255 });
        expect(packet.data!.bars[1]).toEqual({ color: 255, level: 0 });
    });
});

describe("TCNetDataPacketBigWaveForm", () => {
    it("アセンブル済みバッファから波形バーをパースし、末尾のゼロ埋めを削除する", () => {
        // BigWaveForm は byte[i]=level, byte[i+1]=color の順で送信される (SmallWaveForm と逆)。
        // Bridge は固定長バッファで送信するため、トラック実データ長を超える末尾は 0 埋め。
        // readAssembled は末尾の (color=0, level=0) 連続を削除し、実データ長に揃える
        const data = Buffer.alloc(10);
        data.writeUInt8(200, 0);
        data.writeUInt8(150, 1);
        data.writeUInt8(100, 2);
        data.writeUInt8(50, 3);
        // byte 4-9 は 0 埋め (bars[2..4] が (0,0))

        const packet = new TCNetDataPacketBigWaveForm();
        packet.readAssembled(data);

        expect(packet.data).not.toBeNull();
        expect(packet.data!.bars).toHaveLength(2);
        expect(packet.data!.bars[0]).toEqual({ level: 200, color: 150 });
        expect(packet.data!.bars[1]).toEqual({ level: 100, color: 50 });
    });

    it("中間のゼロバーは保持し、末尾の連続ゼロのみ削除する", () => {
        // data = [200,150, 0,0, 100,50, 0,0, 0,0]
        //  → bars = [(level=200,color=150), (0,0), (level=100,color=50), (0,0), (0,0)]
        //  → trim後 = [(level=200,color=150), (0,0), (level=100,color=50)]
        const data = Buffer.from([200, 150, 0, 0, 100, 50, 0, 0, 0, 0]);
        const packet = new TCNetDataPacketBigWaveForm();
        packet.readAssembled(data);

        expect(packet.data!.bars).toHaveLength(3);
        expect(packet.data!.bars[0]).toEqual({ level: 200, color: 150 });
        expect(packet.data!.bars[1]).toEqual({ level: 0, color: 0 });
        expect(packet.data!.bars[2]).toEqual({ level: 100, color: 50 });
    });

    it("全ゼロバッファは空配列を返す", () => {
        const data = Buffer.alloc(10);
        const packet = new TCNetDataPacketBigWaveForm();
        packet.readAssembled(data);
        expect(packet.data!.bars).toHaveLength(0);
    });

    it("通常の read() は個別パケットの波形データをパースする (byte[i]=level, byte[i+1]=color)", () => {
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

    it("write() はエラーを投げる", () => {
        expect(() => new TCNetDataPacketBigWaveForm().write()).toThrow("not supported!");
    });

    it("readAssembled() で 5 バイトのバッファは bars.length = 2 になる (末尾 1 バイトは切り捨て)", () => {
        const assembled = Buffer.alloc(5);
        assembled.writeUInt8(10, 0);
        assembled.writeUInt8(20, 1);
        assembled.writeUInt8(30, 2);
        assembled.writeUInt8(40, 3);
        assembled.writeUInt8(99, 4);

        const packet = new TCNetDataPacketBigWaveForm();
        packet.readAssembled(assembled);

        expect(packet.data).not.toBeNull();
        expect(packet.data!.bars).toHaveLength(2);
        expect(packet.data!.bars[0]).toEqual({ level: 10, color: 20 });
        expect(packet.data!.bars[1]).toEqual({ level: 30, color: 40 });
    });
});
