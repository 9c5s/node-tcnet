import { describe, it, expect } from "vitest";
import type {
    CuePoint,
    CueData,
    WaveformBar,
    WaveformData,
    BeatGridEntry,
    BeatGridData,
    MixerChannel,
    MixerData,
} from "../src/types";
import { TCNetDataPacketCUE, TCNetManagementHeader } from "../src/network";

describe("types", () => {
    it("CueData の型が正しく定義されている", () => {
        const cue: CueData = {
            loopInTime: 0,
            loopOutTime: 0,
            cues: [],
        };
        expect(cue).toBeDefined();
    });

    it("WaveformData の型が正しく定義されている", () => {
        const waveform: WaveformData = {
            bars: [{ level: 128, color: 200 }],
        };
        expect(waveform.bars).toHaveLength(1);
    });

    it("BeatGridData の型が正しく定義されている", () => {
        const beatgrid: BeatGridData = {
            entries: [{ beatNumber: 1, beatType: 20, timestampMs: 1000 }],
        };
        expect(beatgrid.entries).toHaveLength(1);
    });

    it("MixerData の型が正しく定義されている", () => {
        const mixer: MixerData = {
            mixerId: 1,
            mixerType: 0,
            mixerName: "DJM-900NXS2",
            masterAudioLevel: 100,
            masterFaderLevel: 127,
            masterFilter: 64,
            masterIsolatorOn: false,
            masterIsolatorHi: 64,
            masterIsolatorMid: 64,
            masterIsolatorLow: 64,
            filterHpf: 0,
            filterLpf: 127,
            filterResonance: 0,
            crossFader: 64,
            crossFaderCurve: 0,
            channelFaderCurve: 0,
            beatFxOn: false,
            beatFxSelect: 0,
            beatFxLevelDepth: 0,
            beatFxChannelSelect: 0,
            headphonesALevel: 0,
            headphonesBLevel: 0,
            boothLevel: 0,
            channels: [],
        };
        expect(mixer.mixerName).toBe("DJM-900NXS2");
    });
});

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
        buffer.writeUInt32LE(2000, 46);
        // CUE 1 at byte 50
        buffer.writeUInt8(1, 50);
        buffer.writeUInt32LE(5000, 52);
        buffer.writeUInt32LE(0, 56);
        buffer.writeUInt8(255, 61);
        buffer.writeUInt8(0, 62);
        buffer.writeUInt8(128, 63);
        // CUE 2 at byte 72
        buffer.writeUInt8(2, 72);
        buffer.writeUInt32LE(10000, 74);

        const packet = new TCNetDataPacketCUE();
        packet.buffer = buffer;
        packet.header = createHeader(buffer);
        packet.read();

        expect(packet.data).not.toBeNull();
        expect(packet.data!.loopInTime).toBe(1000);
        expect(packet.data!.loopOutTime).toBe(2000);
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

    it("type === 0 のCUEエントリはスキップする", () => {
        const buffer = Buffer.alloc(436);
        buffer.writeUInt8(3, 2);
        buffer.write("TCN", 4, "ascii");
        buffer.writeUInt8(200, 7);
        buffer.writeUInt8(12, 24);
        buffer.writeUInt8(1, 25);
        buffer.writeUInt8(0, 50);
        buffer.writeUInt8(1, 72);
        buffer.writeUInt32LE(3000, 74);

        const packet = new TCNetDataPacketCUE();
        packet.buffer = buffer;
        packet.header = createHeader(buffer);
        packet.read();

        expect(packet.data!.cues).toHaveLength(1);
        expect(packet.data!.cues[0].index).toBe(2);
    });

    it("length() は 436 を返す", () => {
        expect(new TCNetDataPacketCUE().length()).toBe(436);
    });

    it("write() はエラーを投げる", () => {
        expect(() => new TCNetDataPacketCUE().write()).toThrow("not supported!");
    });
});
