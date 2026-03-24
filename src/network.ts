import { assert } from "./utils";
import type {
    CueData,
    CuePoint,
    WaveformBar,
    WaveformData,
    BeatGridEntry,
    BeatGridData,
    MixerChannel,
    MixerData,
} from "./types";

/**
 * TCNetメッセージタイプの列挙
 * @category Enums
 */
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

/**
 * TCNetデータパケットタイプの列挙
 * @category Enums
 */
export enum TCNetDataPacketType {
    MetricsData = 2,
    MetaData = 4,
    BeatGridData = 8,
    CUEData = 12,
    SmallWaveFormData = 16,
    BigWaveFormData = 32,
    MixerData = 150,
}

/**
 * TCNetノードタイプの列挙
 * @category Enums
 */
export enum NodeType {
    Auto = 1,
    Master = 2,
    Slave = 4,
    Repeater = 8,
}

/** パケットの読み書きインタフェース */
interface TCNetReaderWriter {
    read(): void;
    write(): void;
}

/**
 * TCNetパケットの抽象基底クラス
 * @category Packets
 */
export abstract class TCNetPacket implements TCNetReaderWriter {
    buffer: Buffer;
    header: TCNetManagementHeader;

    abstract read(): void;
    abstract write(): void;
    abstract length(): number;
    abstract type(): number;
}

/**
 * TCNet管理ヘッダー (全パケット共通の24バイトヘッダー)
 * @category Packets
 */
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

    /**
     * TCNet管理ヘッダーを生成する
     * @param buffer - パケットバッファ
     */
    constructor(buffer: Buffer) {
        this.buffer = buffer;
    }

    /** バッファからヘッダーを読み取る */
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

    /** ヘッダーをバッファに書き込む */
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

/**
 * TCNet OptInパケット (ネットワーク参加通知)
 * @category Packets
 */
export class TCNetOptInPacket extends TCNetPacket {
    nodeCount: number;
    nodeListenerPort: number;
    uptime: number;
    vendorName: string;
    appName: string;
    majorVersion: number;
    minorVersion: number;
    bugVersion: number;

    /** バッファからパケットデータを読み取る */
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
    /** パケットデータをバッファに書き込む */
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

    /**
     * パケットのバイト長を返す
     * @returns パケット長
     */
    length(): number {
        return 68;
    }

    /**
     * メッセージタイプを返す
     * @returns メッセージタイプ
     */
    type(): number {
        return TCNetMessageType.OptIn;
    }
}

/**
 * TCNet OptOutパケット (ネットワーク離脱通知)
 * @category Packets
 */
export class TCNetOptOutPacket extends TCNetPacket {
    nodeCount: number;
    nodeListenerPort: number;

    /** バッファからパケットデータを読み取る */
    read(): void {
        this.nodeCount = this.buffer.readUInt16LE(24);
        this.nodeListenerPort = this.buffer.readUInt16LE(26);
    }
    /** パケットデータをバッファに書き込む */
    write(): void {
        this.buffer.writeUInt16LE(this.nodeCount, 24);
        this.buffer.writeUInt16LE(this.nodeListenerPort, 26);
    }

    /**
     * パケットのバイト長を返す
     * @returns パケット長
     */
    length(): number {
        return 28;
    }

    /**
     * メッセージタイプを返す
     * @returns メッセージタイプ
     */
    type(): number {
        return TCNetMessageType.OptOut;
    }
}

/**
 * TCNetレイヤーの再生状態を表す列挙
 * @category Enums
 */
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

/**
 * TCNet Statusパケット (ノードのレイヤー状態)
 * @category Packets
 */
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

    /** バッファからパケットデータを読み取る */
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
    /** パケットデータをバッファに書き込む */
    write(): void {
        throw new Error("not supported!");
    }
    /**
     * パケットのバイト長を返す
     * @returns パケット長
     */
    length(): number {
        return 300;
    }
    /**
     * メッセージタイプを返す
     * @returns メッセージタイプ
     */
    type(): number {
        return TCNetMessageType.Status;
    }
}

/**
 * TCNet Requestパケット (データ要求)
 * @category Packets
 */
export class TCNetRequestPacket extends TCNetPacket {
    dataType: number;
    layer: number;

    /** バッファからパケットデータを読み取る */
    read(): void {
        this.dataType = this.buffer.readUInt8(24);
        this.layer = this.buffer.readUInt8(25);
    }
    /** パケットデータをバッファに書き込む */
    write(): void {
        assert(0 <= this.dataType && this.dataType <= 255);
        assert(0 <= this.layer && this.layer <= 255);

        this.buffer.writeUInt8(this.dataType, 24);
        this.buffer.writeUInt8(this.layer, 25);
    }
    /**
     * パケットのバイト長を返す
     * @returns パケット長
     */
    length(): number {
        return 26;
    }
    /**
     * メッセージタイプを返す
     * @returns メッセージタイプ
     */
    type(): number {
        return TCNetMessageType.Request;
    }
}

/**
 * TCNetタイムコードの状態を表す列挙
 * @category Enums
 */
export enum TCNetTimecodeState {
    Stopped = 0,
    Running = 1,
    ForceReSync = 2,
}

/**
 * TCNetタイムコードデータ
 * @category Packets
 */
export class TCNetTimecode {
    mode: number;
    state: TCNetTimecodeState;
    hours: number;
    minutes: number;
    seconds: number;
    frames: number;

    /**
     * バッファの指定オフセットからタイムコードを読み取る
     * @param buffer - 読み取り元バッファ
     * @param offset - 読み取り開始位置
     */
    read(buffer: Buffer, offset: number): void {
        this.mode = buffer.readUInt8(offset + 0);
        this.state = buffer.readUInt8(offset + 1);
        this.hours = buffer.readUInt8(offset + 2);
        this.minutes = buffer.readUInt8(offset + 3);
        this.seconds = buffer.readUInt8(offset + 4);
        this.frames = buffer.readUInt8(offset + 5);
    }
}

/**
 * Timeパケットの1レイヤー分のデータ
 * @category Types
 */
export type TCNetTimePacketLayer = {
    currentTimeMillis: number;
    totalTimeMillis: number;
    beatMarker: number;
    state: TCNetLayerStatus;
    onAir: number;
};

/**
 * TCNet Timeパケット (レイヤーの時間情報)
 * @category Packets
 */
export class TCNetTimePacket extends TCNetPacket {
    private _layers: TCNetTimePacketLayer[] = new Array(8);
    private _generalSMPTEMode = 0;

    /** バッファからパケットデータを読み取る */
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
    /** パケットデータをバッファに書き込む */
    write(): void {
        throw new Error("not supported!");
    }
    /**
     * パケットのバイト長を返す
     * @returns パケット長
     */
    length(): number {
        switch (this.buffer.length) {
            case 154:
            case 162:
                return this.buffer.length;
            default:
                return -1;
        }
    }
    /**
     * メッセージタイプを返す
     * @returns メッセージタイプ
     */
    type(): number {
        return TCNetMessageType.Time;
    }

    /**
     * 全レイヤーの時間情報を返す
     * @returns レイヤーデータの配列
     */
    get layers(): TCNetTimePacketLayer[] {
        return this._layers;
    }

    /**
     * 汎用SMPTEモードを返す
     * @returns SMPTEモード値
     */
    get generalSMPTEMode(): number {
        return this._generalSMPTEMode;
    }
}

/**
 * TCNetデータパケットの基底クラス
 * @category Data Packets
 */
export class TCNetDataPacket extends TCNetPacket {
    dataType: TCNetDataPacketType;
    /**
     * 0-indexed layer ID (0-7)
     */
    layer: number;

    /** バッファからパケットデータを読み取る */
    read(): void {
        this.dataType = this.buffer.readUInt8(24);
        this.layer = this.buffer.readUInt8(25) - 1;
    }
    /** パケットデータをバッファに書き込む */
    write(): void {
        assert(0 <= this.dataType && this.dataType <= 255);
        assert(0 <= this.layer && this.layer <= 255);

        this.buffer.writeUInt8(this.dataType, 24);
        this.buffer.writeUInt8(this.layer, 25);
    }
    /**
     * パケットのバイト長を返す
     * @returns パケット長
     */
    length(): number {
        return -1;
    }
    /**
     * メッセージタイプを返す
     * @returns メッセージタイプ
     */
    type(): number {
        return TCNetMessageType.Data;
    }
}

/**
 * TCNetレイヤーの同期マスター状態を表す列挙
 * @category Enums
 */
export enum TCNetLayerSyncMaster {
    Slave = 0,
    Master = 1,
}

/**
 * メトリクスデータパケット (BPM/速度/位置等)
 * @category Data Packets
 */
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

    /** バッファからパケットデータを読み取る */
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

    /** パケットデータをバッファに書き込む */
    write(): void {
        throw new Error("not supported!");
    }
    /**
     * パケットのバイト長を返す
     * @returns パケット長
     */
    length(): number {
        return 122;
    }
}

/**
 * メタデータパケット (トラック情報)
 * @category Data Packets
 */
export class TCNetDataPacketMetadata extends TCNetDataPacket {
    info: {
        trackArtist: string;
        trackTitle: string;
        trackKey: number;
        trackID: number;
    } | null = null;

    /** バッファからパケットデータを読み取る */
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
    /** パケットデータをバッファに書き込む */
    write(): void {
        throw new Error("not supported!");
    }
    /**
     * パケットのバイト長を返す
     * @returns パケット長
     */
    length(): number {
        return 548;
    }
}

/**
 * CUEデータパケット (キューポイント情報)
 * @category Data Packets
 */
export class TCNetDataPacketCUE extends TCNetDataPacket {
    data: CueData | null = null;

    /** バッファからパケットデータを読み取る */
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

    /** パケットデータをバッファに書き込む */
    write(): void {
        throw new Error("not supported!");
    }
    /**
     * パケットのバイト長を返す
     * @returns パケット長
     */
    length(): number {
        return 436;
    }
}

/**
 * 波形バーを共通パースするファイル内ヘルパー関数。
 * dataStart から source の末尾 (または dataStart + maxBytes の手前) まで
 * 2バイト単位で WaveformBar を生成して返す。
 * 奇数バイト境界への読み出しを防ぐため safeEnd は偶数バイトに切り捨てる。
 * @param source - 読み取り元バッファ
 * @param dataStart - データ開始オフセット
 * @param maxBytes - 最大読み取りバイト数
 * @returns 波形バーの配列
 */
function parseWaveformBars(source: Buffer, dataStart: number, maxBytes?: number): WaveformBar[] {
    const bars: WaveformBar[] = [];
    const end = maxBytes !== undefined ? Math.min(dataStart + maxBytes, source.length) : source.length;
    // 偶数バイト境界に切り捨て: i + 1 が範囲外にならないよう保証する
    const safeEnd = dataStart + ((end - dataStart) & ~1);
    for (let i = dataStart; i < safeEnd; i += 2) {
        bars.push({
            level: source.readUInt8(i),
            color: source.readUInt8(i + 1),
        });
    }
    return bars;
}

/**
 * 小波形データパケット (1200バー固定)
 * @category Data Packets
 */
export class TCNetDataPacketSmallWaveForm extends TCNetDataPacket {
    data: WaveformData | null = null;

    /** バッファからパケットデータを読み取る */
    read(): void {
        // T5: バッファが 2400 バイトに満たない場合でもクラッシュしない
        this.data = { bars: parseWaveformBars(this.buffer, 42, 2400) };
    }

    /** パケットデータをバッファに書き込む */
    write(): void {
        throw new Error("not supported!");
    }
    /**
     * パケットのバイト長を返す
     * @returns パケット長
     */
    length(): number {
        return 2442;
    }
}

/**
 * ミキサーデータパケット (チャンネル/エフェクト状態)
 * @category Data Packets
 */
export class TCNetDataPacketMixer extends TCNetDataPacket {
    data: MixerData | null = null;

    /** バッファからパケットデータを読み取る */
    read(): void {
        // T6: 最大オフセット (channels[5] の crossfaderAssign = 245 + 13 = 258) を確認する
        if (this.buffer.length < 259) {
            return;
        }

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

    /** パケットデータをバッファに書き込む */
    write(): void {
        throw new Error("not supported!");
    }
    /**
     * パケットのバイト長を返す
     * @returns パケット長
     */
    length(): number {
        return 270;
    }
}

/**
 * ビートグリッドデータパケット (ビート位置情報)
 * @category Data Packets
 */
export class TCNetDataPacketBeatGrid extends TCNetDataPacket {
    data: BeatGridData | null = null;

    /** バッファからパケットデータを読み取る */
    read(): void {
        this.readFromOffset(42);
    }

    /**
     * アセンブル済みバッファからビートグリッドをパースする
     * @param assembled - 結合済みバッファ
     */
    readAssembled(assembled: Buffer): void {
        this.readFromOffset(0, assembled);
    }

    /**
     * 指定オフセットからビートグリッドエントリを読み取る
     * @param dataStart - データ開始オフセット
     * @param buf - 読み取り元バッファ。省略時はthis.bufferを使用
     */
    private readFromOffset(dataStart: number, buf?: Buffer): void {
        const source = buf ?? this.buffer;
        const entries: BeatGridEntry[] = [];
        for (let offset = dataStart; offset + 8 <= source.length; offset += 8) {
            const beatNumber = source.readUInt16LE(offset);
            const beatType = source.readUInt8(offset + 2);
            const timestampMs = source.readUInt32LE(offset + 4);
            // 仕様書に明示的な記載はないが、実機観察に基づきゼロエントリをスキップする
            if (beatNumber === 0 && timestampMs === 0) continue;
            entries.push({ beatNumber, beatType, timestampMs });
        }
        this.data = { entries };
    }

    /** パケットデータをバッファに書き込む */
    write(): void {
        throw new Error("not supported!");
    }
    /**
     * パケットのバイト長を返す
     * @returns パケット長
     */
    length(): number {
        return 2442;
    }
}

/**
 * 大波形データパケット (可変長、マルチパケット)
 * @category Data Packets
 */
export class TCNetDataPacketBigWaveForm extends TCNetDataPacket {
    data: WaveformData | null = null;

    /** バッファからパケットデータを読み取る */
    read(): void {
        // T7: parseWaveformBars ヘルパーを使用して重複を排除する
        this.data = { bars: parseWaveformBars(this.buffer, 42) };
    }

    /**
     * アセンブル済みバッファから波形データをパースする
     * @param assembled - 結合済みバッファ
     */
    readAssembled(assembled: Buffer): void {
        this.data = { bars: parseWaveformBars(assembled, 0) };
    }

    /** パケットデータをバッファに書き込む */
    write(): void {
        throw new Error("not supported!");
    }
    /**
     * パケットのバイト長を返す
     * @returns パケット長
     */
    length(): number {
        return -1;
    }
}

/**
 * コンストラクタを持つ型の汎用インタフェース
 * @internal
 */
export interface Constructable<T> {
    new (...args: unknown[]): T;
}

/**
 * メッセージタイプからパケットクラスへのマッピング
 * @internal
 */
export const TCNetPackets: Record<TCNetMessageType, Constructable<TCNetPacket> | null> = {
    [TCNetMessageType.OptIn]: TCNetOptInPacket,
    [TCNetMessageType.OptOut]: TCNetOptOutPacket,
    [TCNetMessageType.Status]: TCNetStatusPacket,
    [TCNetMessageType.TimeSync]: null, // 未実装
    [TCNetMessageType.Error]: null, // 未実装
    [TCNetMessageType.Request]: TCNetRequestPacket,
    [TCNetMessageType.ApplicationData]: null, // 未実装
    [TCNetMessageType.Control]: null, // 未実装
    [TCNetMessageType.Text]: null, // 未実装
    [TCNetMessageType.Keyboard]: null, // 未実装
    [TCNetMessageType.Data]: TCNetDataPacket,
    [TCNetMessageType.File]: null, // 未実装
    [TCNetMessageType.Time]: TCNetTimePacket,
};

/**
 * データパケットタイプからデータパケットクラスへのマッピング
 * @internal
 */
export const TCNetDataPackets: Record<TCNetDataPacketType, typeof TCNetDataPacket | null> = {
    [TCNetDataPacketType.MetricsData]: TCNetDataPacketMetrics,
    [TCNetDataPacketType.MetaData]: TCNetDataPacketMetadata,
    [TCNetDataPacketType.BeatGridData]: TCNetDataPacketBeatGrid,
    [TCNetDataPacketType.CUEData]: TCNetDataPacketCUE,
    [TCNetDataPacketType.SmallWaveFormData]: TCNetDataPacketSmallWaveForm,
    [TCNetDataPacketType.BigWaveFormData]: TCNetDataPacketBigWaveForm,
    [TCNetDataPacketType.MixerData]: TCNetDataPacketMixer,
};
