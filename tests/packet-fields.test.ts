import { describe, it, expect } from "vitest";
import {
    TCNetMessageType,
    TCNetErrorPacket,
    TCNetDataPacketSmallWaveForm,
    TCNetDataPacketBigWaveForm,
    TCNetDataPacketBeatGrid,
    TCNetDataPacketArtwork,
    TCNetManagementHeader,
} from "../src/network";

function writeValidHeader(buffer: Buffer, messageType: number): void {
    buffer.writeUInt16LE(1, 0);
    buffer.writeUInt8(3, 2);
    buffer.writeUInt8(5, 3);
    buffer.write("TCN", 4, "ascii");
    buffer.writeUInt8(messageType, 7);
    buffer.write("NODE01\x00\x00", 8, "ascii");
    buffer.writeUInt8(42, 16);
    buffer.writeUInt8(2, 17);
    buffer.writeUInt16LE(7, 18);
    buffer.writeUInt32LE(0, 20);
}

function createHeader(buffer: Buffer): TCNetManagementHeader {
    const header = new TCNetManagementHeader(buffer);
    header.minorVersion = 5;
    return header;
}

describe("TCNetErrorPacket 構造化フィールド", () => {
    it("全フィールドを正しくパースする", () => {
        const buffer = Buffer.alloc(30);
        writeValidHeader(buffer, TCNetMessageType.Error);
        buffer.writeUInt8(16, 24); // dataType = SmallWaveFormData
        buffer.writeUInt8(3, 25); // layerId
        buffer.writeUInt16LE(14, 26); // code = Empty
        buffer.writeUInt16LE(200, 28); // messageType = Data

        const packet = new TCNetErrorPacket();
        packet.buffer = buffer;
        packet.header = createHeader(buffer);
        packet.read();

        expect(packet.dataType).toBe(16);
        expect(packet.layerId).toBe(3);
        expect(packet.code).toBe(14);
        expect(packet.messageType).toBe(200);
    });

    it("code=255 (OK) を正しくパースする", () => {
        const buffer = Buffer.alloc(30);
        writeValidHeader(buffer, TCNetMessageType.Error);
        buffer.writeUInt8(0xff, 24);
        buffer.writeUInt8(0xff, 25);
        buffer.writeUInt16LE(255, 26);
        buffer.writeUInt16LE(30, 28);

        const packet = new TCNetErrorPacket();
        packet.buffer = buffer;
        packet.header = createHeader(buffer);
        packet.read();

        expect(packet.code).toBe(255);
        expect(packet.messageType).toBe(30);
    });

    it("code=1 (Unknown) を正しくパースする", () => {
        const buffer = Buffer.alloc(30);
        writeValidHeader(buffer, TCNetMessageType.Error);
        buffer.writeUInt8(2, 24);
        buffer.writeUInt8(1, 25);
        buffer.writeUInt16LE(1, 26);
        buffer.writeUInt16LE(20, 28);

        const packet = new TCNetErrorPacket();
        packet.buffer = buffer;
        packet.header = createHeader(buffer);
        packet.read();

        expect(packet.dataType).toBe(2);
        expect(packet.layerId).toBe(1);
        expect(packet.code).toBe(1);
        expect(packet.messageType).toBe(20);
    });

    it("length() は 30 を返す", () => {
        expect(new TCNetErrorPacket().length()).toBe(30);
    });
});

/**
 * マルチパケットヘッダーをバッファに書き込む
 * @param buffer - 書き込み先バッファ
 * @param totalDataSize - データ全体のサイズ
 * @param totalPackets - パケット総数
 * @param packetNo - パケット番号
 * @param dataClusterSize - データクラスタサイズ
 */
function writeMultiPacketHeader(
    buffer: Buffer,
    totalDataSize: number,
    totalPackets: number,
    packetNo: number,
    dataClusterSize: number,
): void {
    buffer.writeUInt32LE(totalDataSize, 26);
    buffer.writeUInt32LE(totalPackets, 30);
    buffer.writeUInt32LE(packetNo, 34);
    buffer.writeUInt32LE(dataClusterSize, 38);
}

describe("マルチパケットヘッダー公開", () => {
    describe("TCNetDataPacketSmallWaveForm", () => {
        it("マルチパケットヘッダーフィールドが読み取れる", () => {
            const buffer = Buffer.alloc(2442);
            buffer.writeUInt8(3, 2);
            buffer.write("TCN", 4, "ascii");
            buffer.writeUInt8(200, 7);
            buffer.writeUInt8(16, 24); // dataType
            buffer.writeUInt8(1, 25); // layer
            writeMultiPacketHeader(buffer, 2400, 1, 0, 2400);

            const packet = new TCNetDataPacketSmallWaveForm();
            packet.buffer = buffer;
            packet.header = createHeader(buffer);
            packet.read();

            expect(packet.multiPacketHeader).not.toBeNull();
            expect(packet.multiPacketHeader!.totalDataSize).toBe(2400);
            expect(packet.multiPacketHeader!.totalPackets).toBe(1);
            expect(packet.multiPacketHeader!.packetNo).toBe(0);
            expect(packet.multiPacketHeader!.dataClusterSize).toBe(2400);
        });
    });

    describe("TCNetDataPacketBeatGrid", () => {
        it("マルチパケットヘッダーフィールドが読み取れる", () => {
            const buffer = Buffer.alloc(2442);
            buffer.writeUInt8(3, 2);
            buffer.write("TCN", 4, "ascii");
            buffer.writeUInt8(200, 7);
            buffer.writeUInt8(8, 24); // dataType
            buffer.writeUInt8(1, 25);
            writeMultiPacketHeader(buffer, 9600, 2, 1, 4800);

            const packet = new TCNetDataPacketBeatGrid();
            packet.buffer = buffer;
            packet.header = createHeader(buffer);
            packet.read();

            expect(packet.multiPacketHeader).not.toBeNull();
            expect(packet.multiPacketHeader!.totalDataSize).toBe(9600);
            expect(packet.multiPacketHeader!.totalPackets).toBe(2);
            expect(packet.multiPacketHeader!.packetNo).toBe(1);
            expect(packet.multiPacketHeader!.dataClusterSize).toBe(4800);
        });
    });

    describe("TCNetDataPacketBigWaveForm", () => {
        it("マルチパケットヘッダーフィールドが読み取れる", () => {
            const buffer = Buffer.alloc(100);
            buffer.writeUInt8(3, 2);
            buffer.write("TCN", 4, "ascii");
            buffer.writeUInt8(200, 7);
            buffer.writeUInt8(32, 24); // dataType
            buffer.writeUInt8(1, 25);
            writeMultiPacketHeader(buffer, 48000, 10, 3, 4800);

            const packet = new TCNetDataPacketBigWaveForm();
            packet.buffer = buffer;
            packet.header = createHeader(buffer);
            packet.read();

            expect(packet.multiPacketHeader).not.toBeNull();
            expect(packet.multiPacketHeader!.totalDataSize).toBe(48000);
            expect(packet.multiPacketHeader!.totalPackets).toBe(10);
            expect(packet.multiPacketHeader!.packetNo).toBe(3);
            expect(packet.multiPacketHeader!.dataClusterSize).toBe(4800);
        });
    });

    describe("TCNetDataPacketArtwork", () => {
        it("マルチパケットヘッダーフィールドが読み取れる", () => {
            // JPEGデータを含む最小バッファを作成
            const buffer = Buffer.alloc(50);
            buffer.writeUInt8(3, 2);
            buffer.write("TCN", 4, "ascii");
            buffer.writeUInt8(204, 7); // File
            buffer.writeUInt8(128, 24); // dataType = Artwork
            buffer.writeUInt8(1, 25);
            writeMultiPacketHeader(buffer, 5000, 3, 0, 2400);
            // JPEGヘッダー
            buffer.writeUInt8(0xff, 42);
            buffer.writeUInt8(0xd8, 43);

            const packet = new TCNetDataPacketArtwork();
            packet.buffer = buffer;
            packet.header = createHeader(buffer);
            packet.read();

            expect(packet.multiPacketHeader).not.toBeNull();
            expect(packet.multiPacketHeader!.totalDataSize).toBe(5000);
            expect(packet.multiPacketHeader!.totalPackets).toBe(3);
            expect(packet.multiPacketHeader!.packetNo).toBe(0);
            expect(packet.multiPacketHeader!.dataClusterSize).toBe(2400);
        });

        it("バッファが42バイト未満の場合はmultiPacketHeaderがnullのまま", () => {
            const buffer = Buffer.alloc(30);
            buffer.writeUInt8(3, 2);
            buffer.write("TCN", 4, "ascii");
            buffer.writeUInt8(204, 7);
            buffer.writeUInt8(128, 24);
            buffer.writeUInt8(1, 25);

            const packet = new TCNetDataPacketArtwork();
            packet.buffer = buffer;
            packet.header = createHeader(buffer);
            packet.read();

            expect(packet.multiPacketHeader).toBeNull();
            expect(packet.data).toBeNull();
        });
    });
});
