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
