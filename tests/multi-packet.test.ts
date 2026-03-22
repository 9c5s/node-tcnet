import { describe, it, expect } from "vitest";
import { MultiPacketAssembler } from "../src/multi-packet";

function createMultiPacketBuffer(totalPackets: number, packetNo: number, clusterSize: number, data: number[]): Buffer {
    const buffer = Buffer.alloc(42 + clusterSize);
    buffer.writeUInt32LE(totalPackets * clusterSize, 26);
    buffer.writeUInt32LE(totalPackets, 30);
    buffer.writeUInt32LE(packetNo, 34);
    buffer.writeUInt32LE(clusterSize, 38);
    for (let i = 0; i < data.length; i++) {
        buffer.writeUInt8(data[i], 42 + i);
    }
    return buffer;
}

describe("MultiPacketAssembler", () => {
    it("単一パケットで完了する", () => {
        const assembler = new MultiPacketAssembler();
        const buf = createMultiPacketBuffer(1, 0, 10, [1, 2, 3]);
        expect(assembler.add(buf)).toBe(true);
        const result = assembler.assemble();
        expect(result.readUInt8(0)).toBe(1);
        expect(result.readUInt8(1)).toBe(2);
        expect(result.readUInt8(2)).toBe(3);
    });

    it("複数パケットを順序通りに組み立てる", () => {
        const assembler = new MultiPacketAssembler();
        const buf0 = createMultiPacketBuffer(3, 0, 4, [10, 11, 12, 13]);
        const buf1 = createMultiPacketBuffer(3, 1, 4, [20, 21, 22, 23]);
        const buf2 = createMultiPacketBuffer(3, 2, 4, [30, 31, 32, 33]);
        expect(assembler.add(buf0)).toBe(false);
        expect(assembler.add(buf1)).toBe(false);
        expect(assembler.add(buf2)).toBe(true);
        const result = assembler.assemble();
        expect(result.length).toBe(12);
        expect(result.readUInt8(0)).toBe(10);
        expect(result.readUInt8(4)).toBe(20);
        expect(result.readUInt8(8)).toBe(30);
    });

    it("順序がバラバラでも正しく組み立てる", () => {
        const assembler = new MultiPacketAssembler();
        const buf0 = createMultiPacketBuffer(2, 0, 4, [10, 11, 12, 13]);
        const buf1 = createMultiPacketBuffer(2, 1, 4, [20, 21, 22, 23]);
        expect(assembler.add(buf1)).toBe(false);
        expect(assembler.add(buf0)).toBe(true);
        const result = assembler.assemble();
        expect(result.readUInt8(0)).toBe(10);
        expect(result.readUInt8(4)).toBe(20);
    });

    it("reset() で状態がクリアされる", () => {
        const assembler = new MultiPacketAssembler();
        assembler.add(createMultiPacketBuffer(2, 0, 4, [10, 11, 12, 13]));
        assembler.reset();
        const buf = createMultiPacketBuffer(1, 0, 4, [99]);
        expect(assembler.add(buf)).toBe(true);
        expect(assembler.assemble().readUInt8(0)).toBe(99);
    });

    it("42バイト未満のバッファを無視する", () => {
        const assembler = new MultiPacketAssembler();
        const shortBuf = Buffer.alloc(30);
        expect(assembler.add(shortBuf)).toBe(false);
    });

    it("clusterSize がバッファ実長を超えるパケットを拒否する", () => {
        const assembler = new MultiPacketAssembler();
        const buf = Buffer.alloc(50); // 42 + 8 = 50 バイト
        buf.writeUInt32LE(1, 30); // totalPackets = 1
        buf.writeUInt32LE(0, 34); // packetNo = 0
        buf.writeUInt32LE(100, 38); // clusterSize = 100 (実データは8バイトしかない)
        expect(assembler.add(buf)).toBe(false);
    });

    it("totalPackets が変わったパケットを無視する", () => {
        const assembler = new MultiPacketAssembler();
        const buf1 = createMultiPacketBuffer(3, 0, 4, [10, 11, 12, 13]);
        const badBuf = createMultiPacketBuffer(5, 1, 4, [20, 21, 22, 23]); // totalPackets不一致
        const buf2 = createMultiPacketBuffer(3, 1, 4, [30, 31, 32, 33]);
        const buf3 = createMultiPacketBuffer(3, 2, 4, [40, 41, 42, 43]);

        expect(assembler.add(buf1)).toBe(false);
        expect(assembler.add(badBuf)).toBe(false); // 無視される
        expect(assembler.add(buf2)).toBe(false);
        expect(assembler.add(buf3)).toBe(true); // 3パケット揃った
    });
});
