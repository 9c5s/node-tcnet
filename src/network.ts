import { assert, getClusterEnd } from "./utils";
import type {
    ArtworkData,
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
export const TCNetMessageType = {
    OptIn: 2,
    OptOut: 3,
    Status: 5,
    TimeSync: 10,
    Error: 13,
    Request: 20,
    ApplicationData: 30,
    Control: 101,
    Text: 128,
    Keyboard: 132,
    Data: 200,
    File: 204,
    Time: 254,
} as const;
/** TCNetメッセージタイプの値型 */
export type TCNetMessageType = (typeof TCNetMessageType)[keyof typeof TCNetMessageType];

/**
 * as constオブジェクトから逆引きマップ (値→キー名) を生成する
 * @param obj - 変換元のas constオブジェクト
 * @returns 値をキー、名前を値とするマップ
 */
function createReverseMap<T extends Record<string, number>>(obj: T): Record<number, string> {
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [v, k])) as Record<number, string>;
}

/**
 * TCNetMessageTypeの数値から名前への逆引きマップ
 * @category Enums
 */
export const TCNetMessageTypeName = createReverseMap(TCNetMessageType);

/**
 * TCNetデータパケットタイプの列挙
 * @category Enums
 */
export const TCNetDataPacketType = {
    MetricsData: 2,
    MetaData: 4,
    BeatGridData: 8,
    CUEData: 12,
    SmallWaveFormData: 16,
    BigWaveFormData: 32,
    ArtworkData: 128,
    MixerData: 150,
} as const;
/** TCNetデータパケットタイプの値型 */
export type TCNetDataPacketType = (typeof TCNetDataPacketType)[keyof typeof TCNetDataPacketType];

/**
 * TCNetノードタイプの列挙
 * @category Enums
 */
export const NodeType = {
    Auto: 1,
    Master: 2,
    Slave: 4,
    Repeater: 8,
} as const;
/** TCNetノードタイプの値型 */
export type NodeType = (typeof NodeType)[keyof typeof NodeType];

/**
 * パケットの読み書きインタフェース
 * @internal
 */
export interface TCNetReaderWriter {
    read(): void;
    write(): void;
}

/**
 * TCNetパケットの抽象基底クラス
 * @category Packets
 */
export abstract class TCNetPacket implements TCNetReaderWriter {
    buffer!: Buffer;
    header!: TCNetManagementHeader;

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

    nodeId!: number;
    minorVersion!: number;
    messageType!: TCNetMessageType;
    nodeName!: string;
    seq!: number;
    nodeType!: number;
    nodeOptions!: number;
    timestamp!: number;

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

        this.messageType = this.buffer.readUInt8(7) as TCNetMessageType;
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
    nodeCount!: number;
    nodeListenerPort!: number;
    uptime!: number;
    vendorName!: string;
    appName!: string;
    majorVersion!: number;
    minorVersion!: number;
    bugVersion!: number;

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
    nodeCount!: number;
    nodeListenerPort!: number;

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
export const TCNetLayerStatus = {
    IDLE: 0,
    PLAYING: 3,
    LOOPING: 4,
    PAUSED: 5,
    STOPPED: 6,
    CUEDOWN: 7,
    PLATTERDOWN: 8,
    FFWD: 9,
    FFRV: 10,
    HOLD: 11,
} as const;
/** TCNetレイヤーステータスの値型 */
export type TCNetLayerStatus = (typeof TCNetLayerStatus)[keyof typeof TCNetLayerStatus];

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

    /** APP SPECIFICセクション (byte 100-171, 72バイト) */
    appSpecific: Buffer | null = null;

    /** バッファからパケットデータを読み取る */
    read(): void {
        this.data = {
            nodeCount: this.buffer.readUInt16LE(24),
            nodeListenerPort: this.buffer.readUInt16LE(26),
            smpteMode: this.buffer.readUInt8(83),
            autoMasterMode: this.buffer.readUInt8(84),
        };

        // parsePacketがlength()=300で事前検証するため常にtrueだが防御的に残す
        if (this.buffer.length >= 172) {
            this.appSpecific = Buffer.from(this.buffer.slice(100, 172));
        }

        for (let n = 0; n < 8; n++) {
            this.layers[n] = {
                source: this.buffer.readUInt8(34 + n),
                status: this.buffer.readUInt8(42 + n) as TCNetLayerStatus,
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
    dataType!: number;
    layer!: number;

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
export const TCNetTimecodeState = {
    Stopped: 0,
    Running: 1,
    ForceReSync: 2,
} as const;
/** TCNetタイムコードステートの値型 */
export type TCNetTimecodeState = (typeof TCNetTimecodeState)[keyof typeof TCNetTimecodeState];

/**
 * TCNetタイムコードデータ
 * @category Packets
 */
export class TCNetTimecode {
    smpteMode!: number;
    state!: TCNetTimecodeState;
    hours!: number;
    minutes!: number;
    seconds!: number;
    frames!: number;

    /**
     * バッファの指定オフセットからタイムコードを読み取る
     * @param buffer - 読み取り元バッファ
     * @param offset - 読み取り開始位置
     */
    read(buffer: Buffer, offset: number): void {
        this.smpteMode = buffer.readUInt8(offset + 0);
        this.state = buffer.readUInt8(offset + 1) as TCNetTimecodeState;
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
    /** レイヤー別タイムコード (byte 106-153, バッファが十分な場合のみ) */
    timecode?: TCNetTimecode;
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
        // Timecodeセクション (byte 106-153) は8レイヤー x 6バイト = 48バイト
        // 154バイトパケットには含まれるが、将来的に短いバッファが来る可能性に備えガードする
        const hasTimecode = this.buffer.length >= 154;
        for (let n = 0; n < 8; n++) {
            const layer: TCNetTimePacketLayer = {
                currentTimeMillis: this.buffer.readUInt32LE(24 + n * 4),
                totalTimeMillis: this.buffer.readUInt32LE(56 + n * 4),
                beatMarker: this.buffer.readUInt8(88 + n),
                state: this.buffer.readUInt8(96 + n) as TCNetLayerStatus,
                onAir: this.buffer.length > 154 ? this.buffer.readUInt8(154 + n) : 255,
            };
            if (hasTimecode) {
                const tc = new TCNetTimecode();
                tc.read(this.buffer, 106 + n * 6);
                layer.timecode = tc;
            }
            this._layers[n] = layer;
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
    dataType!: TCNetDataPacketType;
    /**
     * 0-indexed layer ID (0-7)
     */
    layer!: number;

    /** バッファからパケットデータを読み取る */
    read(): void {
        this.dataType = this.buffer.readUInt8(24) as TCNetDataPacketType;
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
export const TCNetLayerSyncMaster = {
    Slave: 0,
    Master: 1,
} as const;
/** TCNetレイヤー同期マスターの値型 */
export type TCNetLayerSyncMaster = (typeof TCNetLayerSyncMaster)[keyof typeof TCNetLayerSyncMaster];

/**
 * メトリクスデータパケット (BPM/速度/位置等)
 * @category Data Packets
 */
/**
 * Metricsデータの構造を表す型
 * @category Types
 */
export type MetricsData = {
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
};

/**
 * メトリクスデータパケット (BPM/速度/PitchBend等)
 * @category Data Packets
 */
export class TCNetDataPacketMetrics extends TCNetDataPacket {
    data: MetricsData | null = null;

    /** バッファからパケットデータを読み取る */
    read(): void {
        this.data = {
            state: this.buffer.readUInt8(27) as TCNetLayerStatus,
            syncMaster: this.buffer.readUInt8(29) as TCNetLayerSyncMaster,
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
        // byte 46-49 (Loop OUT Time) はCUE 1開始(byte 47)と重複するため読み取らない
        // CUE 1にデータがあるとloopOutTimeは汚染された値になる
        const cues: CuePoint[] = [];
        const cueStart = 47;
        for (let i = 0; i < 18; i++) {
            const offset = cueStart + i * 22;
            if (offset + 22 > this.buffer.length) break;
            const type = this.buffer.readUInt8(offset);
            const inTime = this.buffer.readUInt32LE(offset + 2);
            const outTime = this.buffer.readUInt32LE(offset + 6);
            // BridgeはTYPEフィールドを0で送信する場合がある
            // type=0かつinTime/outTime両方0のエントリのみスキップする
            // type有効値(>=1)でinTime/outTime=0のケース(トラック先頭CUE)は保持する
            if (type === 0 && inTime === 0 && outTime === 0) continue;
            cues.push({
                index: i + 1,
                type,
                inTime,
                outTime,
                color: {
                    r: this.buffer.readUInt8(offset + 11),
                    g: this.buffer.readUInt8(offset + 12),
                    b: this.buffer.readUInt8(offset + 13),
                },
            });
        }
        this.data = { loopInTime, cues };
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
 * マルチパケットヘッダー情報 (byte 26-41)
 * @category Types
 */
export type MultiPacketHeader = {
    /** データ全体のサイズ (byte 26-29, UInt32LE) */
    totalDataSize: number;
    /** パケット総数 (byte 30-33, UInt32LE) */
    totalPackets: number;
    /** パケット番号 (byte 34-37, UInt32LE) */
    packetNo: number;
    /** データクラスタサイズ (byte 38-41, UInt32LE) */
    dataClusterSize: number;
};

/**
 * マルチパケットヘッダーをバッファから読み取るヘルパー
 * @param buffer - 読み取り元バッファ
 * @returns マルチパケットヘッダー情報
 */
export function readMultiPacketHeader(buffer: Buffer): MultiPacketHeader | null {
    if (buffer.length < 42) return null;
    return {
        totalDataSize: buffer.readUInt32LE(26),
        totalPackets: buffer.readUInt32LE(30),
        packetNo: buffer.readUInt32LE(34),
        dataClusterSize: buffer.readUInt32LE(38),
    };
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
            color: source.readUInt8(i),
            level: source.readUInt8(i + 1),
        });
    }
    return bars;
}

/**
 * 末尾の連続する完全ゼロバー (color=0 かつ level=0) を削除する。
 * BigWaveForm は Bridge が固定長バッファで送信するため、トラックの実データ長を超える
 * 末尾領域が 0 埋めされている。実データ長に揃えるため末尾の 0 埋めを削除する。
 * @param bars - 波形バー配列
 * @returns 末尾ゼロバーを除いた配列
 */
function trimTrailingZeroBars(bars: WaveformBar[]): WaveformBar[] {
    let end = bars.length;
    while (end > 0) {
        const b = bars[end - 1];
        if (b === undefined || b.color !== 0 || b.level !== 0) break;
        end--;
    }
    return end === bars.length ? bars : bars.slice(0, end);
}

/**
 * 小波形データパケット (1200バー固定)
 * @category Data Packets
 */
export class TCNetDataPacketSmallWaveForm extends TCNetDataPacket {
    data: WaveformData | null = null;
    /** マルチパケットヘッダー */
    multiPacketHeader: MultiPacketHeader | null = null;

    /** バッファからパケットデータを読み取る */
    read(): void {
        this.multiPacketHeader = readMultiPacketHeader(this.buffer);
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
        // T6: 最大オフセット (channels[5] の crossFaderAssign = 245 + 13 = 258) を確認する
        if (this.buffer.length < 259) {
            return;
        }

        // Mixer IDはLayer IDではないため、基底クラスの-1変換を上書きする
        this.layer = this.buffer.readUInt8(25);

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
            crossFaderAssign: this.buffer.readUInt8(offset + 13),
        });

        this.data = {
            mixerId: this.buffer.readUInt8(25),
            mixerType: this.buffer.readUInt8(26),
            mixerName: this.buffer.slice(29, 45).toString("ascii").replace(/\0.*$/g, ""),
            masterAudioLevel: this.buffer.readUInt8(61),
            masterFaderLevel: this.buffer.readUInt8(62),
            masterFilter: this.buffer.readUInt8(69),
            micEqHi: this.buffer.readUInt8(59),
            micEqLow: this.buffer.readUInt8(60),
            linkCueA: this.buffer.readUInt8(67),
            linkCueB: this.buffer.readUInt8(68),
            masterCueA: this.buffer.readUInt8(71),
            masterCueB: this.buffer.readUInt8(72),
            masterIsolatorOn: this.buffer.readUInt8(74) === 1,
            masterIsolatorHi: this.buffer.readUInt8(75),
            masterIsolatorMid: this.buffer.readUInt8(76),
            masterIsolatorLow: this.buffer.readUInt8(77),
            filterHpf: this.buffer.readUInt8(79),
            filterLpf: this.buffer.readUInt8(80),
            filterResonance: this.buffer.readUInt8(81),
            sendFxEffect: this.buffer.readUInt8(84),
            sendFxExt1: this.buffer.readUInt8(85),
            sendFxExt2: this.buffer.readUInt8(86),
            sendFxMasterMix: this.buffer.readUInt8(87),
            sendFxSizeFeedback: this.buffer.readUInt8(88),
            sendFxTime: this.buffer.readUInt8(89),
            sendFxHpf: this.buffer.readUInt8(90),
            sendFxLevel: this.buffer.readUInt8(91),
            sendReturn3Source: this.buffer.readUInt8(92),
            sendReturn3Type: this.buffer.readUInt8(93),
            sendReturn3On: this.buffer.readUInt8(94),
            sendReturn3Level: this.buffer.readUInt8(95),
            channelFaderCurve: this.buffer.readUInt8(97),
            crossFaderCurve: this.buffer.readUInt8(98),
            crossFader: this.buffer.readUInt8(99),
            beatFxOn: this.buffer.readUInt8(100) === 1,
            beatFxLevelDepth: this.buffer.readUInt8(101),
            beatFxChannelSelect: this.buffer.readUInt8(102),
            beatFxSelect: this.buffer.readUInt8(103),
            beatFxFreqHi: this.buffer.readUInt8(104),
            beatFxFreqMid: this.buffer.readUInt8(105),
            beatFxFreqLow: this.buffer.readUInt8(106),
            headphonesPreEq: this.buffer.readUInt8(107),
            headphonesALevel: this.buffer.readUInt8(108),
            headphonesAMix: this.buffer.readUInt8(109),
            headphonesBLevel: this.buffer.readUInt8(110),
            headphonesBMix: this.buffer.readUInt8(111),
            boothLevel: this.buffer.readUInt8(112),
            boothEqHi: this.buffer.readUInt8(113),
            boothEqLow: this.buffer.readUInt8(114),
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
    /** マルチパケットヘッダー */
    multiPacketHeader: MultiPacketHeader | null = null;

    /** バッファからパケットデータを読み取る */
    read(): void {
        this.multiPacketHeader = readMultiPacketHeader(this.buffer);
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
    /** マルチパケットヘッダー */
    multiPacketHeader: MultiPacketHeader | null = null;

    /** バッファからパケットデータを読み取る */
    read(): void {
        this.multiPacketHeader = readMultiPacketHeader(this.buffer);
        // T7: parseWaveformBars ヘルパーを使用して重複を排除する
        this.data = { bars: parseWaveformBars(this.buffer, 42) };
    }

    /**
     * アセンブル済みバッファから波形データをパースする
     * @param assembled - 結合済みバッファ
     */
    readAssembled(assembled: Buffer): void {
        this.data = { bars: trimTrailingZeroBars(parseWaveformBars(assembled, 0)) };
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
 * TCNet Fileパケット (MessageType=204、Artworkなどのファイルデータ転送用)
 *
 * Data (200) パケットと同一のバイトレイアウトを持ち、
 * byte24=dataType, byte25=layerID, bytes30-41にマルチパケットヘッダーを含む。
 * DataClusterSizeは2400B (Dataパケットの4800Bとは異なる)。
 * @category Packets
 */
export class TCNetFilePacket extends TCNetDataPacket {
    /**
     * メッセージタイプを返す
     * @returns メッセージタイプ (File=204)
     */
    type(): number {
        return TCNetMessageType.File;
    }
}

/**
 * アートワークデータパケット (JPEGバイナリ、マルチパケット)
 * @category Data Packets
 */
export class TCNetDataPacketArtwork extends TCNetDataPacket {
    data: ArtworkData | null = null;
    /** マルチパケットヘッダー */
    multiPacketHeader: MultiPacketHeader | null = null;

    /** バッファからパケットデータを読み取る */
    read(): void {
        const dataStart = 42;
        if (this.buffer.length < dataStart) {
            return;
        }
        this.multiPacketHeader = readMultiPacketHeader(this.buffer);
        const clusterSize = this.multiPacketHeader?.dataClusterSize ?? 0;
        const end = getClusterEnd(this.buffer.length, dataStart, clusterSize);
        this.data = { jpeg: Buffer.from(this.buffer.slice(dataStart, end)) };
    }

    /**
     * アセンブル済みバッファからJPEGデータを取得する
     * @param assembled - 結合済みバッファ
     */
    readAssembled(assembled: Buffer): void {
        // JPEG SOIマーカー(0xFF 0xD8)が存在しないデータは不正とみなす
        if (assembled.length < 2 || assembled[0] !== 0xff || assembled[1] !== 0xd8) {
            this.data = null;
            return;
        }
        this.data = { jpeg: Buffer.from(assembled) };
    }

    /** パケットデータをバッファに書き込む */
    write(): void {
        throw new Error("not supported!");
    }

    /**
     * パケットのバイト長を返す
     * @returns パケット長 (-1: 可変長)
     */
    length(): number {
        return -1;
    }
}

/**
 * TCNet Errorパケット (エラー応答)
 * @category Packets
 */
export class TCNetErrorPacket extends TCNetPacket {
    /** データタイプ (byte 24) */
    dataType!: number;
    /** レイヤーID (byte 25) */
    layerId!: number;
    /** エラーコード (byte 26-27, UInt16LE) 1=Unknown, 13=Not Possible, 14=Empty, 255=OK */
    code!: number;
    /** メッセージタイプ (byte 28-29, UInt16LE) */
    messageType!: number;

    /** バッファからパケットデータを読み取る */
    read(): void {
        this.dataType = this.buffer.readUInt8(24);
        this.layerId = this.buffer.readUInt8(25);
        this.code = this.buffer.readUInt16LE(26);
        this.messageType = this.buffer.readUInt16LE(28);
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
        return 30;
    }

    /**
     * メッセージタイプを返す
     * @returns メッセージタイプ
     */
    type(): number {
        return TCNetMessageType.Error;
    }
}

/**
 * TCNet ApplicationDataパケット (TCNASDP認証ハンドシェイク用)
 * @category Packets
 */
export class TCNetApplicationDataPacket extends TCNetPacket {
    /** 宛先ノードID (0xFFFF=全ノード) */
    dest!: number;
    /** サブタイプ (認証では0x14固定) */
    subType!: number;
    /** フィールド1 */
    field1!: number;
    /** フィールド2 */
    field2!: number;
    /** 固定識別値 (0x0AA0) */
    fixedValue!: number;
    /** コマンド (0=hello, 1=token応答, 2=認証) */
    cmd!: number;
    /** リスナーポート */
    listenerPort!: number;
    /** セッショントークン */
    token!: number;
    /** 認証ペイロード (12バイト) */
    payload: Buffer = Buffer.alloc(12);

    /** バッファからパケットデータを読み取る */
    read(): void {
        const b = 24;
        this.dest = this.buffer.readUInt16LE(b);
        this.subType = this.buffer.readUInt8(b + 2);
        // b+3 ~ b+5: reserved
        this.field1 = this.buffer.readUInt32LE(b + 6);
        this.field2 = this.buffer.readUInt32LE(b + 10);
        // b+14 ~ b+15: reserved
        this.fixedValue = this.buffer.readUInt16LE(b + 16);
        this.cmd = this.buffer.readUInt16LE(b + 18);
        this.listenerPort = this.buffer.readUInt16LE(b + 20);
        this.token = this.buffer.readUInt32LE(b + 22);
        this.payload = Buffer.from(this.buffer.slice(b + 26, b + 38));
    }

    /** パケットデータをバッファに書き込む */
    write(): void {
        assert(this.payload.length === 12, "ApplicationData payload must be 12 bytes");

        const b = 24;
        this.buffer.writeUInt16LE(this.dest, b);
        this.buffer.writeUInt8(this.subType, b + 2);
        // b+3 ~ b+5: reserved (0)
        this.buffer.writeUInt32LE(this.field1, b + 6);
        this.buffer.writeUInt32LE(this.field2, b + 10);
        // b+14 ~ b+15: reserved (0)
        this.buffer.writeUInt16LE(this.fixedValue, b + 16);
        this.buffer.writeUInt16LE(this.cmd, b + 18);
        this.buffer.writeUInt16LE(this.listenerPort, b + 20);
        this.buffer.writeUInt32LE(this.token, b + 22);
        this.payload.copy(this.buffer, b + 26, 0, 12);
    }

    /**
     * パケットのバイト長を返す
     * @returns パケット長
     */
    length(): number {
        return 62;
    }

    /**
     * メッセージタイプを返す
     * @returns メッセージタイプ
     */
    type(): number {
        return TCNetMessageType.ApplicationData;
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
export const TCNetPackets = {
    [TCNetMessageType.OptIn]: TCNetOptInPacket,
    [TCNetMessageType.OptOut]: TCNetOptOutPacket,
    [TCNetMessageType.Status]: TCNetStatusPacket,
    [TCNetMessageType.TimeSync]: null, // 未実装
    [TCNetMessageType.Error]: TCNetErrorPacket,
    [TCNetMessageType.Request]: TCNetRequestPacket,
    [TCNetMessageType.ApplicationData]: TCNetApplicationDataPacket,
    [TCNetMessageType.Control]: null, // 未実装
    [TCNetMessageType.Text]: null, // 未実装
    [TCNetMessageType.Keyboard]: null, // 未実装
    [TCNetMessageType.Data]: TCNetDataPacket,
    [TCNetMessageType.File]: TCNetFilePacket,
    [TCNetMessageType.Time]: TCNetTimePacket,
} as const satisfies Record<TCNetMessageType, Constructable<TCNetPacket> | null>;

/**
 * データパケットタイプからデータパケットクラスへのマッピング
 * @internal
 */
export const TCNetDataPackets = {
    [TCNetDataPacketType.MetricsData]: TCNetDataPacketMetrics,
    [TCNetDataPacketType.MetaData]: TCNetDataPacketMetadata,
    [TCNetDataPacketType.BeatGridData]: TCNetDataPacketBeatGrid,
    [TCNetDataPacketType.CUEData]: TCNetDataPacketCUE,
    [TCNetDataPacketType.SmallWaveFormData]: TCNetDataPacketSmallWaveForm,
    [TCNetDataPacketType.BigWaveFormData]: TCNetDataPacketBigWaveForm,
    [TCNetDataPacketType.ArtworkData]: TCNetDataPacketArtwork,
    [TCNetDataPacketType.MixerData]: TCNetDataPacketMixer,
} as const satisfies Record<TCNetDataPacketType, typeof TCNetDataPacket | null>;
