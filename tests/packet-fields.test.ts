import { describe, it, expect } from "vitest";
import {
    TCNetMessageType,
    TCNetErrorPacket,
    TCNetTimePacket,
    TCNetTimecodeState,
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

describe("TCNetTimePacket Timecodeセクション", () => {
    it("154バイトバッファからTimecodeセクションを読み取る", () => {
        const buffer = Buffer.alloc(154);
        writeValidHeader(buffer, TCNetMessageType.Time);

        // レイヤー0のTimecode (offset=106)
        buffer.writeUInt8(2, 106); // smpteMode
        buffer.writeUInt8(TCNetTimecodeState.Running, 107); // state
        buffer.writeUInt8(1, 108); // hours
        buffer.writeUInt8(30, 109); // minutes
        buffer.writeUInt8(45, 110); // seconds
        buffer.writeUInt8(24, 111); // frames

        // レイヤー7のTimecode (offset=148)
        buffer.writeUInt8(3, 148); // smpteMode
        buffer.writeUInt8(TCNetTimecodeState.Stopped, 149); // state
        buffer.writeUInt8(0, 150); // hours
        buffer.writeUInt8(0, 151); // minutes
        buffer.writeUInt8(0, 152); // seconds
        buffer.writeUInt8(0, 153); // frames

        const packet = new TCNetTimePacket();
        packet.buffer = buffer;
        packet.header = createHeader(buffer);
        packet.read();

        expect(packet.layers[0].timecode).toBeDefined();
        expect(packet.layers[0].timecode!.smpteMode).toBe(2);
        expect(packet.layers[0].timecode!.state).toBe(TCNetTimecodeState.Running);
        expect(packet.layers[0].timecode!.hours).toBe(1);
        expect(packet.layers[0].timecode!.minutes).toBe(30);
        expect(packet.layers[0].timecode!.seconds).toBe(45);
        expect(packet.layers[0].timecode!.frames).toBe(24);

        expect(packet.layers[7].timecode).toBeDefined();
        expect(packet.layers[7].timecode!.smpteMode).toBe(3);
        expect(packet.layers[7].timecode!.state).toBe(TCNetTimecodeState.Stopped);
    });

    it("162バイトバッファでもTimecodeセクションを読み取る", () => {
        const buffer = Buffer.alloc(162);
        writeValidHeader(buffer, TCNetMessageType.Time);

        // レイヤー2のTimecode (offset=118)
        buffer.writeUInt8(1, 118); // smpteMode
        buffer.writeUInt8(TCNetTimecodeState.ForceReSync, 119); // state
        buffer.writeUInt8(23, 120); // hours
        buffer.writeUInt8(59, 121); // minutes
        buffer.writeUInt8(59, 122); // seconds
        buffer.writeUInt8(29, 123); // frames

        const packet = new TCNetTimePacket();
        packet.buffer = buffer;
        packet.header = createHeader(buffer);
        packet.read();

        expect(packet.layers[2].timecode).toBeDefined();
        expect(packet.layers[2].timecode!.smpteMode).toBe(1);
        expect(packet.layers[2].timecode!.state).toBe(TCNetTimecodeState.ForceReSync);
        expect(packet.layers[2].timecode!.hours).toBe(23);
        expect(packet.layers[2].timecode!.minutes).toBe(59);
        expect(packet.layers[2].timecode!.seconds).toBe(59);
        expect(packet.layers[2].timecode!.frames).toBe(29);
    });

    it("全8レイヤーのTimecodeが独立して読み取れる", () => {
        const buffer = Buffer.alloc(154);
        writeValidHeader(buffer, TCNetMessageType.Time);

        for (let n = 0; n < 8; n++) {
            const offset = 106 + n * 6;
            buffer.writeUInt8(n, offset); // smpteMode = レイヤー番号
            buffer.writeUInt8(1, offset + 1); // state = Running
            buffer.writeUInt8(n + 1, offset + 2); // hours
            buffer.writeUInt8(n * 5, offset + 3); // minutes
            buffer.writeUInt8(n * 7, offset + 4); // seconds
            buffer.writeUInt8(n * 3, offset + 5); // frames
        }

        const packet = new TCNetTimePacket();
        packet.buffer = buffer;
        packet.header = createHeader(buffer);
        packet.read();

        for (let n = 0; n < 8; n++) {
            expect(packet.layers[n].timecode).toBeDefined();
            expect(packet.layers[n].timecode!.smpteMode).toBe(n);
            expect(packet.layers[n].timecode!.hours).toBe(n + 1);
            expect(packet.layers[n].timecode!.minutes).toBe(n * 5);
            expect(packet.layers[n].timecode!.seconds).toBe(n * 7);
            expect(packet.layers[n].timecode!.frames).toBe(n * 3);
        }
    });
});
