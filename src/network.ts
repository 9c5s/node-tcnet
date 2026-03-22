import { assert } from "./utils";
import type { CueData, CuePoint, WaveformBar, WaveformData, MixerChannel, MixerData } from "./types";

export enum TCNetMessageType {
    OptIn = 2,
    OptOut = 3,
    Status = 5,
    TimeSync = 10,
    Error = 13,
    Request = 20,
    ApplicationData = 30,
    Control = 101,
    Text = 128,
    Keyboard = 132,
    Data = 200,
    File = 204,
    Time = 254,
}

export enum TCNetDataPacketType {
    MetricsData = 2,
    MetaData = 4,
    BeatGridData = 8,
    CUEData = 12,
    SmallWaveFormData = 16,
    BigWaveFormData = 32,
    MixerData = 150,
}

export enum NodeType {
    Auto = 1,
    Master = 2,
    Slave = 4,
    Repeater = 8,
}

interface TCNetReaderWriter {
    read(): void;
    write(): void;
}

export abstract class TCNetPacket implements TCNetReaderWriter {
    buffer: Buffer;
    header: TCNetManagementHeader;

    abstract read(): void;
    abstract write(): void;
    abstract length(): number;
    abstract type(): number;
}

export class TCNetManagementHeader implements TCNetReaderWriter {
    static MAJOR_VERSION = 3;
    static MAGIC_HEADER = "TCN";

    buffer: Buffer;

    nodeId: number;
    minorVersion: number;
    messageType: TCNetMessageType;
    nodeName: string;
    seq: number;
    nodeType: number;
    nodeOptions: number;
    timestamp: number;

    constructor(buffer: Buffer) {
        this.buffer = buffer;
    }

    public read(): void {
        this.nodeId = this.buffer.readUInt16LE(0);

        assert(this.buffer.readUInt8(2) == TCNetManagementHeader.MAJOR_VERSION);
        this.minorVersion = this.buffer.readUInt8(3);
        assert(this.buffer.slice(4, 7).toString("ascii") == TCNetManagementHeader.MAGIC_HEADER);

        this.messageType = this.buffer.readUInt8(7);
        this.nodeName = this.buffer.slice(8, 16).toString("ascii").replace(/\0.*$/g, "");
        this.seq = this.buffer.readUInt8(16);
        this.nodeType = this.buffer.readUInt8(17);
        this.nodeOptions = this.buffer.readUInt16LE(18);
        this.timestamp = this.buffer.readUInt32LE(20);
    }

    public write(): void {
        assert(Buffer.from(this.nodeName, "ascii").length <= 8);

        this.buffer.writeUInt16LE(this.nodeId, 0);
        this.buffer.writeUInt8(TCNetManagementHeader.MAJOR_VERSION, 2);
        this.buffer.writeUInt8(this.minorVersion, 3);
        this.buffer.write(TCNetManagementHeader.MAGIC_HEADER, 4, "ascii");
        this.buffer.writeUInt8(this.messageType, 7);
        this.buffer.write(this.nodeName.padEnd(8, "\x00"), 8, "ascii");
        this.buffer.writeUInt8(this.seq, 16);
        this.buffer.writeUInt8(this.nodeType, 17); // 02
        this.buffer.writeUInt16LE(this.nodeOptions, 18); // 07 00
        this.buffer.writeUInt32LE(this.timestamp, 20);
    }
}

export class TCNetOptInPacket extends TCNetPacket {
    nodeCount: number;
    nodeListenerPort: number;
    uptime: number;
    vendorName: string;
    appName: string;
    majorVersion: number;
    minorVersion: number;
    bugVersion: number;

    read(): void {
        this.nodeCount = this.buffer.readUInt16LE(24);
        this.nodeListenerPort = this.buffer.readUInt16LE(26);
        this.uptime = this.buffer.readUInt16LE(28);
        this.vendorName = this.buffer.slice(32, 48).toString("ascii").replace(/\0.*$/g, "");
        this.appName = this.buffer.slice(48, 64).toString("ascii").replace(/\0.*$/g, "");
        this.majorVersion = this.buffer.readUInt8(64);
        this.minorVersion = this.buffer.readUInt8(65);
        this.bugVersion = this.buffer.readUInt8(66);
    }
    write(): void {
        assert(Buffer.from(this.vendorName, "ascii").length <= 16);
        assert(Buffer.from(this.appName, "ascii").length <= 16);

        this.buffer.writeUInt16LE(this.nodeCount, 24);
        this.buffer.writeUInt16LE(this.nodeListenerPort, 26);
        this.buffer.writeUInt16LE(this.uptime, 28);
        this.buffer.write(this.vendorName.padEnd(16, "\x00"), 32, "ascii");
        this.buffer.write(this.appName.padEnd(16, "\x00"), 48, "ascii");
        this.buffer.writeUInt8(this.majorVersion, 64);
        this.buffer.writeUInt8(this.minorVersion, 65);
        this.buffer.writeUInt8(this.bugVersion, 66);
    }

    length(): number {
        return 68;
    }

    type(): number {
        return TCNetMessageType.OptIn;
    }
}

export class TCNetOptOutPacket extends TCNetPacket {
    nodeCount: number;
    nodeListenerPort: number;

    read(): void {
        this.nodeCount = this.buffer.readUInt16LE(24);
        this.nodeListenerPort = this.buffer.readUInt16LE(26);
    }
    write(): void {
        this.buffer.writeUInt16LE(this.nodeCount, 24);
        this.buffer.writeUInt16LE(this.nodeListenerPort, 26);
    }

    length(): number {
        return 28;
    }

    type(): number {
        return TCNetMessageType.OptOut;
    }
}

export enum TCNetLayerStatus {
    IDLE = 0,
    PLAYING = 3,
    LOOPING = 4,
    PAUSED = 5,
    STOPPED = 6,
    CUEDOWN = 7,
    PLATTERDOWN = 8,
    FFWD = 9,
    FFRV = 10,
    HOLD = 11,
}

export class TCNetStatusPacket extends TCNetPacket {
    data: null | {
        nodeCount: number;
        nodeListenerPort: number;
        smpteMode: number;
        autoMasterMode: number;
    } = null;

    layers: Array<{
        source: number;
        status: TCNetLayerStatus;
        trackID: number;
        name: string;
    }> = new Array(8);

    read(): void {
        this.data = {
            nodeCount: this.buffer.readUInt16LE(24),
            nodeListenerPort: this.buffer.readUInt16LE(26),
            smpteMode: this.buffer.readUInt8(83),
            autoMasterMode: this.buffer.readUInt8(84),
        };

        for (let n = 0; n < 8; n++) {
            this.layers[n] = {
                source: this.buffer.readUInt8(34 + n),
                status: this.buffer.readUInt8(42 + n),
                trackID: this.buffer.readUInt32LE(50 + n * 4),
                name: this.buffer
                    .slice(172 + n * 16, 172 + (n + 1) * 16)
                    .toString("ascii")
                    .replace(/\0.*$/g, ""),
            };
        }
    }
    write(): void {
        throw new Error("not supported!");
    }
    length(): number {
        return 300;
    }
    type(): number {
        return TCNetMessageType.Status;
    }
}

export class TCNetRequestPacket extends TCNetPacket {
    dataType: number;
    layer: number;

    read(): void {
        this.dataType = this.buffer.readUInt8(24);
        this.layer = this.buffer.readUInt8(25);
    }
    write(): void {
        assert(0 <= this.dataType && this.dataType <= 255);
        assert(0 <= this.layer && this.layer <= 255);

        this.buffer.writeUInt8(this.dataType, 24);
        this.buffer.writeUInt8(this.layer, 25);
    }
    length(): number {
        return 26;
    }
    type(): number {
        return TCNetMessageType.Request;
    }
}

export enum TCNetTimecodeState {
    Stopped = 0,
    Running = 1,
    ForceReSync = 2,
}

export class TCNetTimecode {
    mode: number;
    state: TCNetTimecodeState;
    hours: number;
    minutes: number;
    seconds: number;
    frames: number;

    read(buffer: Buffer, offset: number): void {
        this.mode = buffer.readUInt8(offset + 0);
        this.state = buffer.readUInt8(offset + 1);
        this.hours = buffer.readUInt8(offset + 2);
        this.minutes = buffer.readUInt8(offset + 3);
        this.seconds = buffer.readUInt8(offset + 4);
        this.frames = buffer.readUInt8(offset + 5);
    }
}

export type TCNetTimePacketLayer = {
    currentTimeMillis: number;
    totalTimeMillis: number;
    beatMarker: number;
    state: TCNetLayerStatus;
    onAir: number;
};

export class TCNetTimePacket extends TCNetPacket {
    private _layers: TCNetTimePacketLayer[] = new Array(8);
    private _generalSMPTEMode = 0;

    read(): void {
        for (let n = 0; n < 8; n++) {
            this._layers[n] = {
                currentTimeMillis: this.buffer.readUInt32LE(24 + n * 4),
                totalTimeMillis: this.buffer.readUInt32LE(56 + n * 4),
                beatMarker: this.buffer.readUInt8(88 + n),
                state: this.buffer.readUInt8(96 + n),
                onAir: this.buffer.length > 154 ? this.buffer.readUInt8(154 + n) : 255,
            };
        }
        this._generalSMPTEMode = this.buffer.readUInt8(105);
    }
    write(): void {
        throw new Error("not supported!");
    }
    length(): number {
        switch (this.buffer.length) {
            case 154:
            case 162:
                return this.buffer.length;
            default:
                return -1;
        }
    }
    type(): number {
        return TCNetMessageType.Time;
    }

    get layers(): TCNetTimePacketLayer[] {
        return this._layers;
    }

    get generalSMPTEMode(): number {
        return this._generalSMPTEMode;
    }
}

export class TCNetDataPacket extends TCNetPacket {
    dataType: TCNetDataPacketType;
    /**
     * 0-indexed layer ID (0-7)
     */
    layer: number;

    read(): void {
        this.dataType = this.buffer.readUInt8(24);
        this.layer = this.buffer.readUInt8(25) - 1;
    }
    write(): void {
        assert(0 <= this.dataType && this.dataType <= 255);
        assert(0 <= this.layer && this.layer <= 255);

        this.buffer.writeUInt8(this.dataType, 24);
        this.buffer.writeUInt8(this.layer, 25);
    }
    length(): number {
        return -1;
    }
    type(): number {
        return TCNetMessageType.Data;
    }
}

export enum TCNetLayerSyncMaster {
    Slave = 0,
    Master = 1,
}

export class TCNetDataPacketMetrics extends TCNetDataPacket {
    data: {
        state: TCNetLayerStatus;
        syncMaster: TCNetLayerSyncMaster;
        beatMarker: number;
        trackLength: number;
        currentPosition: number;
        speed: number;
        beatNumber: number;
        bpm: number;
        pitchBend: number;
        trackID: number;
    } | null = null;

    read(): void {
        this.data = {
            state: this.buffer.readUInt8(27),
            syncMaster: this.buffer.readUInt8(29),
            beatMarker: this.buffer.readUInt8(31),
            trackLength: this.buffer.readUInt32LE(32),
            currentPosition: this.buffer.readUInt32LE(36),
            speed: this.buffer.readUInt32LE(40),
            beatNumber: this.buffer.readUInt32LE(57),
            bpm: this.buffer.readUInt32LE(112),
            pitchBend: this.buffer.readInt16LE(116),
            trackID: this.buffer.readUInt32LE(118),
        };
    }

    write(): void {
        throw new Error("not supported!");
    }
    length(): number {
        return 122;
    }
}

export class TCNetDataPacketMetadata extends TCNetDataPacket {
    info: {
        trackArtist: string;
        trackTitle: string;
        trackKey: number;
        trackID: number;
    } | null = null;

    read(): void {
        if (this.header.minorVersion < 5) {
            throw new Error("Unsupported packet version");
        }

        this.info = {
            trackArtist: this.buffer.slice(29, 285).toString("utf16le").replace(/\0/g, ""),
            trackTitle: this.buffer.slice(285, 541).toString("utf16le").replace(/\0/g, ""),
            trackKey: this.buffer.readUInt16LE(541),
            trackID: this.buffer.readUInt32LE(543),
        };
    }
    write(): void {
        throw new Error("not supported!");
    }
    length(): number {
        return 548;
    }
}

export class TCNetDataPacketCUE extends TCNetDataPacket {
    data: CueData | null = null;

    read(): void {
        const loopInTime = this.buffer.readUInt32LE(42);
        const loopOutTime = this.buffer.readUInt32LE(46);
        const cues: CuePoint[] = [];
        // 仕様書にはCUE 1開始を byte 47 と記載しているが、
        // Loop OUT Time (byte 46-49) と重複するため仕様書の誤記。
        // 実機検証に基づき byte 50 を採用。
        const cueStart = 50;
        for (let i = 0; i < 18; i++) {
            const offset = cueStart + i * 22;
            if (offset + 22 > this.buffer.length) break;
            const type = this.buffer.readUInt8(offset);
            if (type === 0) continue;
            cues.push({
                index: i + 1,
                type,
                inTime: this.buffer.readUInt32LE(offset + 2),
                outTime: this.buffer.readUInt32LE(offset + 6),
                color: {
                    r: this.buffer.readUInt8(offset + 11),
                    g: this.buffer.readUInt8(offset + 12),
                    b: this.buffer.readUInt8(offset + 13),
                },
            });
        }
        this.data = { loopInTime, loopOutTime, cues };
    }

    write(): void {
        throw new Error("not supported!");
    }
    length(): number {
        return 436;
    }
}

export class TCNetDataPacketSmallWaveForm extends TCNetDataPacket {
    data: WaveformData | null = null;

    read(): void {
        const bars: WaveformBar[] = [];
        const dataStart = 42;
        for (let i = 0; i < 2400; i += 2) {
            bars.push({
                level: this.buffer.readUInt8(dataStart + i),
                color: this.buffer.readUInt8(dataStart + i + 1),
            });
        }
        this.data = { bars };
    }

    write(): void {
        throw new Error("not supported!");
    }
    length(): number {
        return 2442;
    }
}

export class TCNetDataPacketMixer extends TCNetDataPacket {
    data: MixerData | null = null;

    read(): void {
        const parseChannel = (offset: number): MixerChannel => ({
            sourceSelect: this.buffer.readUInt8(offset),
            audioLevel: this.buffer.readUInt8(offset + 1),
            faderLevel: this.buffer.readUInt8(offset + 2),
            trimLevel: this.buffer.readUInt8(offset + 3),
            compLevel: this.buffer.readUInt8(offset + 4),
            eqHi: this.buffer.readUInt8(offset + 5),
            eqHiMid: this.buffer.readUInt8(offset + 6),
            eqLowMid: this.buffer.readUInt8(offset + 7),
            eqLow: this.buffer.readUInt8(offset + 8),
            filterColor: this.buffer.readUInt8(offset + 9),
            send: this.buffer.readUInt8(offset + 10),
            cueA: this.buffer.readUInt8(offset + 11),
            cueB: this.buffer.readUInt8(offset + 12),
            crossfaderAssign: this.buffer.readUInt8(offset + 13),
        });

        this.data = {
            mixerId: this.buffer.readUInt8(25),
            mixerType: this.buffer.readUInt8(26),
            mixerName: this.buffer.slice(29, 45).toString("ascii").replace(/\0.*$/g, ""),
            masterAudioLevel: this.buffer.readUInt8(61),
            masterFaderLevel: this.buffer.readUInt8(62),
            masterFilter: this.buffer.readUInt8(69),
            masterIsolatorOn: this.buffer.readUInt8(74) === 1,
            masterIsolatorHi: this.buffer.readUInt8(75),
            masterIsolatorMid: this.buffer.readUInt8(76),
            masterIsolatorLow: this.buffer.readUInt8(77),
            filterHpf: this.buffer.readUInt8(79),
            filterLpf: this.buffer.readUInt8(80),
            filterResonance: this.buffer.readUInt8(81),
            crossFader: this.buffer.readUInt8(99),
            crossFaderCurve: this.buffer.readUInt8(98),
            channelFaderCurve: this.buffer.readUInt8(97),
            beatFxOn: this.buffer.readUInt8(100) === 1,
            beatFxSelect: this.buffer.readUInt8(103),
            beatFxLevelDepth: this.buffer.readUInt8(101),
            beatFxChannelSelect: this.buffer.readUInt8(102),
            headphonesALevel: this.buffer.readUInt8(108),
            headphonesBLevel: this.buffer.readUInt8(110),
            boothLevel: this.buffer.readUInt8(112),
            channels: [125, 149, 173, 197, 221, 245].map(parseChannel),
        };
    }

    write(): void {
        throw new Error("not supported!");
    }
    length(): number {
        return 270;
    }
}

export interface Constructable<T> {
    new (...args: unknown[]): T;
}

export const TCNetPackets: Record<TCNetMessageType, Constructable<TCNetPacket> | null> = {
    [TCNetMessageType.OptIn]: TCNetOptInPacket,
    [TCNetMessageType.OptOut]: TCNetOptOutPacket,
    [TCNetMessageType.Status]: TCNetStatusPacket,
    [TCNetMessageType.TimeSync]: null, // not yet implemented
    [TCNetMessageType.Error]: null, // not yet implemented
    [TCNetMessageType.Request]: TCNetRequestPacket,
    [TCNetMessageType.ApplicationData]: null, // not yet implemented
    [TCNetMessageType.Control]: null, // not yet implemented
    [TCNetMessageType.Text]: null, // not yet implemented
    [TCNetMessageType.Keyboard]: null, // not yet implemented
    [TCNetMessageType.Data]: TCNetDataPacket,
    [TCNetMessageType.File]: null, // not yet implemented
    [TCNetMessageType.Time]: TCNetTimePacket,
};

export const TCNetDataPackets: Record<TCNetDataPacketType, typeof TCNetDataPacket | null> = {
    [TCNetDataPacketType.MetricsData]: TCNetDataPacketMetrics,
    [TCNetDataPacketType.MetaData]: TCNetDataPacketMetadata,
    [TCNetDataPacketType.BeatGridData]: null, // not yet implemented
    [TCNetDataPacketType.CUEData]: TCNetDataPacketCUE,
    [TCNetDataPacketType.SmallWaveFormData]: TCNetDataPacketSmallWaveForm,
    [TCNetDataPacketType.BigWaveFormData]: null, // not yet implemented
    [TCNetDataPacketType.MixerData]: TCNetDataPacketMixer,
};
