import { describe, it, expect } from "vitest";
import { TCNetMessageType, TCNetErrorPacket, TCNetManagementHeader } from "../src/network";

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
