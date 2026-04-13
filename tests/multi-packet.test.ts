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
        // Arrange
        const assembler = new MultiPacketAssembler();
        const buf0 = createMultiPacketBuffer(3, 0, 4, [10, 11, 12, 13]);
        const buf1 = createMultiPacketBuffer(3, 1, 4, [20, 21, 22, 23]);
        const buf2 = createMultiPacketBuffer(3, 2, 4, [30, 31, 32, 33]);

        // Act
        assembler.add(buf0);
        assembler.add(buf1);
        assembler.add(buf2);
        const result = assembler.assemble();

        // Assert
        expect(result.length).toBe(12);
        expect(result.readUInt8(0)).toBe(10);
        expect(result.readUInt8(4)).toBe(20);
        expect(result.readUInt8(8)).toBe(30);
    });

    it("add() は最後のパケットでのみ true を返す", () => {
        // Arrange
        const assembler = new MultiPacketAssembler();
        const buf0 = createMultiPacketBuffer(3, 0, 4, [10, 11, 12, 13]);
        const buf1 = createMultiPacketBuffer(3, 1, 4, [20, 21, 22, 23]);
        const buf2 = createMultiPacketBuffer(3, 2, 4, [30, 31, 32, 33]);

        // 状態遷移テスト: 各 add() の完了/未完了フラグを順に検証する
        expect(assembler.add(buf0)).toBe(false);
        expect(assembler.add(buf1)).toBe(false);
        expect(assembler.add(buf2)).toBe(true);
    });

    it("順序がバラバラでも正しく組み立てる", () => {
        // Arrange
        const assembler = new MultiPacketAssembler();
        const buf0 = createMultiPacketBuffer(2, 0, 4, [10, 11, 12, 13]);
        const buf1 = createMultiPacketBuffer(2, 1, 4, [20, 21, 22, 23]);

        // Act: 到着順序を逆にして追加する
        assembler.add(buf1);
        assembler.add(buf0);
        const result = assembler.assemble();

        // Assert
        expect(result.readUInt8(0)).toBe(10);
        expect(result.readUInt8(4)).toBe(20);
    });

    it("add() は受信順によらず最後の 1 枚で true を返す", () => {
        // Arrange
        const assembler = new MultiPacketAssembler();
        const buf0 = createMultiPacketBuffer(2, 0, 4, [10, 11, 12, 13]);
        const buf1 = createMultiPacketBuffer(2, 1, 4, [20, 21, 22, 23]);

        // 状態遷移テスト: 到着順が逆でも 2 枚目で完了フラグが立つ
        expect(assembler.add(buf1)).toBe(false);
        expect(assembler.add(buf0)).toBe(true);
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

    it("中間パケットで clusterSize がバッファ実長を超える場合は拒否する", () => {
        // Arrange: totalPackets=3 の中間パケット (packetNo=1) で clusterSize 不一致
        const assembler = new MultiPacketAssembler();
        const buf = Buffer.alloc(50); // 42 + 8 = 50 バイト
        buf.writeUInt32LE(3, 30); // totalPackets = 3
        buf.writeUInt32LE(1, 34); // packetNo = 1 (中間)
        buf.writeUInt32LE(100, 38); // clusterSize = 100 (実データは8バイトしかない)

        // Act / Assert: 中間パケットの破損は拒否される
        expect(assembler.add(buf)).toBe(false);
    });

    it("最終パケットで clusterSize がバッファ実長を超える場合は実バッファ範囲で受け入れる", () => {
        // Bridge (BRIDGE64) は最終パケットで clusterSize を実長に更新せず、
        // 中間パケットと同じ値を送信する。node-tcnet は実バッファ範囲での受け入れを許容する。
        // Arrange: 中間 2 枚 + 最終パケット (実データ短) の 3 枚構成
        const assembler = new MultiPacketAssembler();
        const buf0 = createMultiPacketBuffer(3, 0, 4, [10, 11, 12, 13]);
        const buf1 = createMultiPacketBuffer(3, 1, 4, [20, 21, 22, 23]);
        // 最終パケット: clusterSize=4 (中間と同じ) だが実データは 2 バイト
        const lastBuf = Buffer.alloc(44); // 42 + 2
        lastBuf.writeUInt32LE(3, 30);
        lastBuf.writeUInt32LE(2, 34);
        lastBuf.writeUInt32LE(4, 38); // clusterSize = 4 (中間と同じ値)
        lastBuf.writeUInt8(30, 42);
        lastBuf.writeUInt8(31, 43);

        // Act
        assembler.add(buf0);
        assembler.add(buf1);
        const complete = assembler.add(lastBuf);
        const result = assembler.assemble();

        // Assert: 3 枚揃い、最終パケットは実バッファ範囲 (2 バイト) だけ採用される
        expect(complete).toBe(true);
        expect(result.length).toBe(4 + 4 + 2);
        expect(result.readUInt8(8)).toBe(30);
        expect(result.readUInt8(9)).toBe(31);
    });

    it("totalPackets が変わったパケットを無視して正しく組み立てる", () => {
        // Arrange
        const assembler = new MultiPacketAssembler();
        const buf0 = createMultiPacketBuffer(3, 0, 4, [10, 11, 12, 13]);
        const badBuf = createMultiPacketBuffer(5, 1, 4, [20, 21, 22, 23]); // totalPackets不一致
        const buf1 = createMultiPacketBuffer(3, 1, 4, [30, 31, 32, 33]);
        const buf2 = createMultiPacketBuffer(3, 2, 4, [40, 41, 42, 43]);

        // Act: totalPackets不一致のパケットを混入させて追加する
        assembler.add(buf0);
        assembler.add(badBuf);
        assembler.add(buf1);
        assembler.add(buf2);
        const result = assembler.assemble();

        // Assert: 不正パケットが無視され、正規の 3 パケットが組み立てられる
        expect(result.length).toBe(12);
        expect(result.readUInt8(0)).toBe(10);
        expect(result.readUInt8(4)).toBe(30);
        expect(result.readUInt8(8)).toBe(40);
    });

    it("totalPackets 不一致のパケットは add() が false を返して完了しない", () => {
        // Arrange
        const assembler = new MultiPacketAssembler();
        const buf0 = createMultiPacketBuffer(3, 0, 4, [10, 11, 12, 13]);
        const badBuf = createMultiPacketBuffer(5, 1, 4, [20, 21, 22, 23]); // totalPackets不一致
        const buf1 = createMultiPacketBuffer(3, 1, 4, [30, 31, 32, 33]);
        const buf2 = createMultiPacketBuffer(3, 2, 4, [40, 41, 42, 43]);

        // 状態遷移テスト: 不正パケットは無視され、3 枚目の正規パケットで完了する
        expect(assembler.add(buf0)).toBe(false);
        expect(assembler.add(badBuf)).toBe(false); // 無視される
        expect(assembler.add(buf1)).toBe(false);
        expect(assembler.add(buf2)).toBe(true); // 3パケット揃った
    });

    it("clusterSize=0 の場合、バッファ末尾までをデータとして扱う", () => {
        // FileパケットではclusterSizeが0のため、バッファ実長からdataStartを引いた値を使用する
        const assembler = new MultiPacketAssembler();
        const data = [0xff, 0xd8, 0xff, 0xe0];
        const buf = Buffer.alloc(42 + data.length);
        buf.writeUInt32LE(1, 30); // totalPackets = 1
        buf.writeUInt32LE(0, 34); // packetNo = 0 (0-indexed で単一パケット)
        buf.writeUInt32LE(0, 38); // clusterSize = 0 (Fileパケットの実機挙動)
        for (let i = 0; i < data.length; i++) {
            buf.writeUInt8(data[i], 42 + i);
        }
        expect(assembler.add(buf)).toBe(true);
        const result = assembler.assemble();
        expect(result.length).toBe(data.length);
        // 全4バイトを検証し、途中の破損を検出できるようにする
        expect(result.readUInt8(0)).toBe(0xff);
        expect(result.readUInt8(1)).toBe(0xd8);
        expect(result.readUInt8(2)).toBe(0xff);
        expect(result.readUInt8(3)).toBe(0xe0);
    });

    it("同じ packetNo で add() すると後のデータで上書きされる", () => {
        // Arrange
        const assembler = new MultiPacketAssembler();
        // packetNo=0 を 2 回 add() する (Map.set() の上書き動作の確認)
        const buf0First = createMultiPacketBuffer(2, 0, 4, [10, 11, 12, 13]);
        const buf0Second = createMultiPacketBuffer(2, 0, 4, [99, 98, 97, 96]); // 上書き用
        const buf1 = createMultiPacketBuffer(2, 1, 4, [20, 21, 22, 23]);

        // Act: 同じ packetNo=0 を 2 度送信した後、packetNo=1 を送信する
        assembler.add(buf0First);
        assembler.add(buf0Second); // packetNo=0 を上書きする
        expect(assembler.add(buf1)).toBe(true); // 2パケット揃った
        const result = assembler.assemble();

        // Assert: 先頭 4 バイトが後から上書きした値になっている
        expect(result.readUInt8(0)).toBe(99);
        expect(result.readUInt8(1)).toBe(98);
        expect(result.readUInt8(2)).toBe(97);
        expect(result.readUInt8(3)).toBe(96);
    });
});
