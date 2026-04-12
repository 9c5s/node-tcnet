import { describe, it, expect } from "vitest";
import { TCNetDataPacketMixer, TCNetDataPacketBeatGrid, TCNetManagementHeader } from "../src/network";

function createHeader(buffer: Buffer): TCNetManagementHeader {
    const header = new TCNetManagementHeader(buffer);
    header.minorVersion = 5;
    return header;
}

describe("TCNetDataPacketMixer", () => {
    it("read()後のthis.layerはmixerId(buffer[25])と一致する", () => {
        const buffer = Buffer.alloc(270);
        buffer.writeUInt8(0, 25);

        const packet = new TCNetDataPacketMixer();
        packet.buffer = buffer;
        packet.header = createHeader(buffer);
        packet.layer = -1; // 基底クラスの-1変換を模擬する
        packet.read();

        expect(packet.layer).toBe(0);
    });

    it("mixerId=3のパケットでthis.layerが3になる", () => {
        const buffer = Buffer.alloc(270);
        buffer.writeUInt8(3, 25);

        const packet = new TCNetDataPacketMixer();
        packet.buffer = buffer;
        packet.header = createHeader(buffer);
        packet.layer = 2; // 基底クラスが3-1=2を設定する想定
        packet.read();

        expect(packet.layer).toBe(3);
        expect(packet.data!.mixerId).toBe(3);
    });

    it("全フィールドが正しいオフセットから読み取られる", () => {
        const buffer = Buffer.alloc(270);
        // Mixer ID / Type
        buffer.writeUInt8(1, 25);
        buffer.writeUInt8(2, 26);
        buffer.write("DJM-900NXS2\x00\x00\x00\x00", 29, "ascii");
        // マスターセクション
        buffer.writeUInt8(59, 59); // micEqHi
        buffer.writeUInt8(60, 60); // micEqLow
        buffer.writeUInt8(100, 61); // masterAudioLevel
        buffer.writeUInt8(127, 62); // masterFaderLevel
        buffer.writeUInt8(67, 67); // linkCueA
        buffer.writeUInt8(68, 68); // linkCueB
        buffer.writeUInt8(64, 69); // masterFilter
        buffer.writeUInt8(71, 71); // masterCueA
        buffer.writeUInt8(72, 72); // masterCueB
        buffer.writeUInt8(1, 74); // masterIsolatorOn
        buffer.writeUInt8(64, 75); // masterIsolatorHi
        buffer.writeUInt8(64, 76); // masterIsolatorMid
        buffer.writeUInt8(64, 77); // masterIsolatorLow
        // フィルター
        buffer.writeUInt8(10, 79); // filterHpf
        buffer.writeUInt8(127, 80); // filterLpf
        buffer.writeUInt8(50, 81); // filterResonance
        // Send FX
        buffer.writeUInt8(84, 84); // sendFxEffect
        buffer.writeUInt8(85, 85); // sendFxExt1
        buffer.writeUInt8(86, 86); // sendFxExt2
        buffer.writeUInt8(87, 87); // sendFxMasterMix
        buffer.writeUInt8(88, 88); // sendFxSizeFeedback
        buffer.writeUInt8(89, 89); // sendFxTime
        buffer.writeUInt8(90, 90); // sendFxHpf
        buffer.writeUInt8(91, 91); // sendFxLevel
        buffer.writeUInt8(92, 92); // sendReturn3Source
        buffer.writeUInt8(93, 93); // sendReturn3Type
        buffer.writeUInt8(94, 94); // sendReturn3On
        buffer.writeUInt8(95, 95); // sendReturn3Level
        // クロスフェーダー/チャンネルフェーダー
        buffer.writeUInt8(1, 97); // channelFaderCurve
        buffer.writeUInt8(2, 98); // crossFaderCurve
        buffer.writeUInt8(64, 99); // crossFader
        // Beat FX
        buffer.writeUInt8(1, 100); // beatFxOn
        buffer.writeUInt8(50, 101); // beatFxLevelDepth
        buffer.writeUInt8(3, 102); // beatFxChannelSelect
        buffer.writeUInt8(5, 103); // beatFxSelect
        buffer.writeUInt8(104, 104); // beatFxFreqHi
        buffer.writeUInt8(105, 105); // beatFxFreqMid
        buffer.writeUInt8(106, 106); // beatFxFreqLow
        // ヘッドフォン
        buffer.writeUInt8(107, 107); // headphonesPreEq
        buffer.writeUInt8(80, 108); // headphonesALevel
        buffer.writeUInt8(109, 109); // headphonesAMix
        buffer.writeUInt8(60, 110); // headphonesBLevel
        buffer.writeUInt8(111, 111); // headphonesBMix
        // ブース
        buffer.writeUInt8(90, 112); // boothLevel
        buffer.writeUInt8(113, 113); // boothEqHi
        buffer.writeUInt8(114, 114); // boothEqLow
        // Channel 1 at offset 125
        buffer.writeUInt8(1, 125);
        buffer.writeUInt8(100, 126);
        buffer.writeUInt8(127, 127);

        const packet = new TCNetDataPacketMixer();
        packet.buffer = buffer;
        packet.header = createHeader(buffer);
        packet.read();

        const d = packet.data!;
        expect(d).not.toBeNull();
        expect(d.mixerId).toBe(1);
        expect(d.mixerType).toBe(2);
        expect(d.mixerName).toBe("DJM-900NXS2");
        // マスターセクション
        expect(d.micEqHi).toBe(59);
        expect(d.micEqLow).toBe(60);
        expect(d.masterAudioLevel).toBe(100);
        expect(d.masterFaderLevel).toBe(127);
        expect(d.linkCueA).toBe(67);
        expect(d.linkCueB).toBe(68);
        expect(d.masterFilter).toBe(64);
        expect(d.masterCueA).toBe(71);
        expect(d.masterCueB).toBe(72);
        expect(d.masterIsolatorOn).toBe(true);
        expect(d.masterIsolatorHi).toBe(64);
        expect(d.masterIsolatorMid).toBe(64);
        expect(d.masterIsolatorLow).toBe(64);
        // フィルター
        expect(d.filterHpf).toBe(10);
        expect(d.filterLpf).toBe(127);
        expect(d.filterResonance).toBe(50);
        // Send FX
        expect(d.sendFxEffect).toBe(84);
        expect(d.sendFxExt1).toBe(85);
        expect(d.sendFxExt2).toBe(86);
        expect(d.sendFxMasterMix).toBe(87);
        expect(d.sendFxSizeFeedback).toBe(88);
        expect(d.sendFxTime).toBe(89);
        expect(d.sendFxHpf).toBe(90);
        expect(d.sendFxLevel).toBe(91);
        expect(d.sendReturn3Source).toBe(92);
        expect(d.sendReturn3Type).toBe(93);
        expect(d.sendReturn3On).toBe(94);
        expect(d.sendReturn3Level).toBe(95);
        // クロスフェーダー/チャンネルフェーダー
        expect(d.channelFaderCurve).toBe(1);
        expect(d.crossFaderCurve).toBe(2);
        expect(d.crossFader).toBe(64);
        // Beat FX
        expect(d.beatFxOn).toBe(true);
        expect(d.beatFxLevelDepth).toBe(50);
        expect(d.beatFxChannelSelect).toBe(3);
        expect(d.beatFxSelect).toBe(5);
        expect(d.beatFxFreqHi).toBe(104);
        expect(d.beatFxFreqMid).toBe(105);
        expect(d.beatFxFreqLow).toBe(106);
        // ヘッドフォン
        expect(d.headphonesPreEq).toBe(107);
        expect(d.headphonesALevel).toBe(80);
        expect(d.headphonesAMix).toBe(109);
        expect(d.headphonesBLevel).toBe(60);
        expect(d.headphonesBMix).toBe(111);
        // ブース
        expect(d.boothLevel).toBe(90);
        expect(d.boothEqHi).toBe(113);
        expect(d.boothEqLow).toBe(114);
        // チャンネル
        expect(d.channels).toHaveLength(6);
        expect(d.channels[0].sourceSelect).toBe(1);
        expect(d.channels[0].audioLevel).toBe(100);
        expect(d.channels[0].faderLevel).toBe(127);
    });

    it("length() は 270 を返す", () => {
        expect(new TCNetDataPacketMixer().length()).toBe(270);
    });

    it("バッファが 258 バイトの場合 data は null のまま", () => {
        const buffer = Buffer.alloc(258);
        buffer.writeUInt8(3, 2);
        buffer.write("TCN", 4, "ascii");
        buffer.writeUInt8(200, 7);

        const packet = new TCNetDataPacketMixer();
        packet.buffer = buffer;
        packet.header = createHeader(buffer);
        packet.read();

        expect(packet.data).toBeNull();
    });

    it("バッファが短い場合はthis.layerを上書きしない", () => {
        const buffer = Buffer.alloc(258);
        const packet = new TCNetDataPacketMixer();
        packet.buffer = buffer;
        packet.header = createHeader(buffer);
        packet.layer = -1;
        packet.read();

        expect(packet.layer).toBe(-1);
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
