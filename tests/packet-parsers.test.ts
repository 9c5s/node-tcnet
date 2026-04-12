import { describe, it, expect } from "vitest";
import {
    TCNetManagementHeader,
    TCNetOptInPacket,
    TCNetOptOutPacket,
    TCNetStatusPacket,
    TCNetRequestPacket,
    TCNetTimecode,
    TCNetTimePacket,
    TCNetDataPacket,
    TCNetDataPacketMetrics,
    TCNetDataPacketMetadata,
    TCNetMessageType,
    TCNetLayerStatus,
    TCNetLayerSyncMaster,
    TCNetTimecodeState,
} from "../src/network";

// テスト用に最小限の有効なManagementHeaderをBufferに書き込むヘルパー関数
function writeValidHeader(buffer: Buffer, messageType: number = TCNetMessageType.OptIn): void {
    buffer.writeUInt16LE(1, 0); // nodeId
    buffer.writeUInt8(3, 2); // majorVersion = 3
    buffer.writeUInt8(5, 3); // minorVersion
    buffer.write("TCN", 4, "ascii"); // magic header
    buffer.writeUInt8(messageType, 7); // messageType
    buffer.write("NODE01\x00\x00", 8, "ascii"); // nodeName (8バイト)
    buffer.writeUInt8(42, 16); // seq
    buffer.writeUInt8(2, 17); // nodeType
    buffer.writeUInt16LE(7, 18); // nodeOptions
    buffer.writeUInt32LE(12345678, 20); // timestamp
}

// Dataパケット系テストで使うヘッダーオブジェクト生成ヘルパー
function createHeader(buffer: Buffer): TCNetManagementHeader {
    const header = new TCNetManagementHeader(buffer);
    header.minorVersion = 5;
    return header;
}

describe("TCNetManagementHeader", () => {
    it("正常なBufferからヘッダーフィールドをパースする", () => {
        // Arrange
        const buffer = Buffer.alloc(24);
        buffer.writeUInt16LE(100, 0); // nodeId = 100
        buffer.writeUInt8(3, 2); // majorVersion
        buffer.writeUInt8(5, 3); // minorVersion
        buffer.write("TCN", 4, "ascii"); // magic
        buffer.writeUInt8(TCNetMessageType.Status, 7); // messageType
        buffer.write("MYNODE\x00\x00", 8, "ascii"); // nodeName
        buffer.writeUInt8(99, 16); // seq
        buffer.writeUInt8(2, 17); // nodeType
        buffer.writeUInt16LE(7, 18); // nodeOptions
        buffer.writeUInt32LE(999999, 20); // timestamp

        // Act
        const header = new TCNetManagementHeader(buffer);
        header.read();

        // Assert
        expect(header.nodeId).toBe(100);
        expect(header.minorVersion).toBe(5);
        expect(header.messageType).toBe(TCNetMessageType.Status);
        expect(header.nodeName).toBe("MYNODE");
        expect(header.seq).toBe(99);
        expect(header.nodeType).toBe(2);
        expect(header.nodeOptions).toBe(7);
        expect(header.timestamp).toBe(999999);
    });

    it("write()後にread()すると同じ値が得られる(ラウンドトリップ)", () => {
        // Arrange
        const buffer = Buffer.alloc(24);
        const header = new TCNetManagementHeader(buffer);
        header.nodeId = 200;
        header.minorVersion = 5;
        header.messageType = TCNetMessageType.OptIn;
        header.nodeName = "TESTND";
        header.seq = 77;
        header.nodeType = 4;
        header.nodeOptions = 3;
        header.timestamp = 424242;

        // Act
        header.write();
        const header2 = new TCNetManagementHeader(buffer);
        header2.read();

        // Assert
        expect(header2.nodeId).toBe(200);
        expect(header2.minorVersion).toBe(5);
        expect(header2.messageType).toBe(TCNetMessageType.OptIn);
        expect(header2.nodeName).toBe("TESTND");
        expect(header2.seq).toBe(77);
        expect(header2.nodeType).toBe(4);
        expect(header2.nodeOptions).toBe(3);
        expect(header2.timestamp).toBe(424242);
    });

    it("majorVersionが3でない場合はread()が例外を投げる", () => {
        // Arrange
        const buffer = Buffer.alloc(24);
        buffer.writeUInt8(99, 2); // 不正なmajorVersion
        buffer.write("TCN", 4, "ascii");

        // Act / Assert
        expect(() => {
            const header = new TCNetManagementHeader(buffer);
            header.read();
        }).toThrow("Assertion failed");
    });

    it("マジックヘッダーが'TCN'でない場合はread()が例外を投げる", () => {
        // Arrange
        const buffer = Buffer.alloc(24);
        buffer.writeUInt8(3, 2); // 正しいmajorVersion
        buffer.write("XXX", 4, "ascii"); // 不正なmagic

        // Act / Assert
        expect(() => {
            const header = new TCNetManagementHeader(buffer);
            header.read();
        }).toThrow("Assertion failed");
    });

    it("nodeNameが8バイトを超える場合はwrite()が例外を投げる", () => {
        // Arrange
        const buffer = Buffer.alloc(24);
        const header = new TCNetManagementHeader(buffer);
        header.nodeId = 1;
        header.minorVersion = 5;
        header.messageType = TCNetMessageType.OptIn;
        header.nodeName = "TOOLONGNAME"; // 11バイト > 8バイト
        header.seq = 0;
        header.nodeType = 0;
        header.nodeOptions = 0;
        header.timestamp = 0;

        // Act / Assert
        expect(() => header.write()).toThrow("Assertion failed");
    });
});

describe("TCNetOptInPacket", () => {
    it("OptInパケットのフィールドをパースする", () => {
        // Arrange
        const buffer = Buffer.alloc(68);
        writeValidHeader(buffer, TCNetMessageType.OptIn);
        buffer.writeUInt16LE(5, 24); // nodeCount
        buffer.writeUInt16LE(60000, 26); // nodeListenerPort
        buffer.writeUInt16LE(3600, 28); // uptime
        buffer.write("Pioneer DJ\x00\x00\x00\x00\x00\x00", 32, "ascii"); // vendorName (16バイト)
        buffer.write("rekordbox\x00\x00\x00\x00\x00\x00\x00", 48, "ascii"); // appName (16バイト)
        buffer.writeUInt8(6, 64); // majorVersion
        buffer.writeUInt8(7, 65); // minorVersion
        buffer.writeUInt8(2, 66); // bugVersion

        const packet = new TCNetOptInPacket();
        packet.buffer = buffer;
        packet.header = createHeader(buffer);

        // Act
        packet.read();

        // Assert
        expect(packet.nodeCount).toBe(5);
        expect(packet.nodeListenerPort).toBe(60000);
        expect(packet.uptime).toBe(3600);
        expect(packet.vendorName).toBe("Pioneer DJ");
        expect(packet.appName).toBe("rekordbox");
        expect(packet.majorVersion).toBe(6);
        expect(packet.minorVersion).toBe(7);
        expect(packet.bugVersion).toBe(2);
    });

    it("write()後にread()すると同じ値が得られる(ラウンドトリップ)", () => {
        // Arrange
        const buffer = Buffer.alloc(68);
        writeValidHeader(buffer, TCNetMessageType.OptIn);
        const packet = new TCNetOptInPacket();
        packet.buffer = buffer;
        packet.header = createHeader(buffer);
        packet.nodeCount = 3;
        packet.nodeListenerPort = 65023;
        packet.uptime = 7200;
        packet.vendorName = "TestVendor";
        packet.appName = "TestApp";
        packet.majorVersion = 1;
        packet.minorVersion = 2;
        packet.bugVersion = 3;

        // Act
        packet.write();
        const packet2 = new TCNetOptInPacket();
        packet2.buffer = buffer;
        packet2.header = createHeader(buffer);
        packet2.read();

        // Assert
        expect(packet2.nodeCount).toBe(3);
        expect(packet2.nodeListenerPort).toBe(65023);
        expect(packet2.uptime).toBe(7200);
        expect(packet2.vendorName).toBe("TestVendor");
        expect(packet2.appName).toBe("TestApp");
        expect(packet2.majorVersion).toBe(1);
        expect(packet2.minorVersion).toBe(2);
        expect(packet2.bugVersion).toBe(3);
    });

    it("length() は 68 を返す", () => {
        expect(new TCNetOptInPacket().length()).toBe(68);
    });

    it("type() は TCNetMessageType.OptIn(2) を返す", () => {
        expect(new TCNetOptInPacket().type()).toBe(2);
    });
});

describe("TCNetOptOutPacket", () => {
    it("OptOutパケットのフィールドをパースする", () => {
        // Arrange
        const buffer = Buffer.alloc(28);
        writeValidHeader(buffer, TCNetMessageType.OptOut);
        buffer.writeUInt16LE(4, 24); // nodeCount
        buffer.writeUInt16LE(60001, 26); // nodeListenerPort

        const packet = new TCNetOptOutPacket();
        packet.buffer = buffer;
        packet.header = createHeader(buffer);

        // Act
        packet.read();

        // Assert
        expect(packet.nodeCount).toBe(4);
        expect(packet.nodeListenerPort).toBe(60001);
    });

    it("write()後にread()すると同じ値が得られる(ラウンドトリップ)", () => {
        // Arrange
        const buffer = Buffer.alloc(28);
        writeValidHeader(buffer, TCNetMessageType.OptOut);
        const packet = new TCNetOptOutPacket();
        packet.buffer = buffer;
        packet.header = createHeader(buffer);
        packet.nodeCount = 7;
        packet.nodeListenerPort = 50000;

        // Act
        packet.write();
        const packet2 = new TCNetOptOutPacket();
        packet2.buffer = buffer;
        packet2.header = createHeader(buffer);
        packet2.read();

        // Assert
        expect(packet2.nodeCount).toBe(7);
        expect(packet2.nodeListenerPort).toBe(50000);
    });

    it("length() は 28 を返す", () => {
        expect(new TCNetOptOutPacket().length()).toBe(28);
    });

    it("type() は TCNetMessageType.OptOut(3) を返す", () => {
        expect(new TCNetOptOutPacket().type()).toBe(3);
    });
});

describe("TCNetStatusPacket", () => {
    it("Statusパケットのdataフィールドをパースする", () => {
        // Arrange
        const buffer = Buffer.alloc(300);
        writeValidHeader(buffer, TCNetMessageType.Status);
        buffer.writeUInt16LE(6, 24); // nodeCount
        buffer.writeUInt16LE(60002, 26); // nodeListenerPort
        buffer.writeUInt8(1, 83); // smpteMode
        buffer.writeUInt8(2, 84); // autoMasterMode

        const packet = new TCNetStatusPacket();
        packet.buffer = buffer;
        packet.header = createHeader(buffer);

        // Act
        packet.read();

        // Assert
        expect(packet.data).not.toBeNull();
        expect(packet.data!.nodeCount).toBe(6);
        expect(packet.data!.nodeListenerPort).toBe(60002);
        expect(packet.data!.smpteMode).toBe(1);
        expect(packet.data!.autoMasterMode).toBe(2);
    });

    it("Statusパケットの8レイヤー情報をパースする", () => {
        // Arrange
        const buffer = Buffer.alloc(300);
        writeValidHeader(buffer, TCNetMessageType.Status);
        // レイヤー0: source=1, status=PLAYING, trackID=9999, name="TrackA"
        buffer.writeUInt8(1, 34); // source[0]
        buffer.writeUInt8(TCNetLayerStatus.PLAYING, 42); // status[0]
        buffer.writeUInt32LE(9999, 50); // trackID[0]
        buffer.write("TrackA\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00", 172, "ascii"); // name[0] (16バイト)
        // レイヤー1: source=2, status=PAUSED, trackID=1234, name="TrackB"
        buffer.writeUInt8(2, 35); // source[1]
        buffer.writeUInt8(TCNetLayerStatus.PAUSED, 43); // status[1]
        buffer.writeUInt32LE(1234, 54); // trackID[1]
        buffer.write("TrackB\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00", 188, "ascii"); // name[1] (16バイト)

        const packet = new TCNetStatusPacket();
        packet.buffer = buffer;
        packet.header = createHeader(buffer);

        // Act
        packet.read();

        // Assert
        expect(packet.layers).toHaveLength(8);
        expect(packet.layers[0].source).toBe(1);
        expect(packet.layers[0].status).toBe(TCNetLayerStatus.PLAYING);
        expect(packet.layers[0].trackID).toBe(9999);
        expect(packet.layers[0].name).toBe("TrackA");
        expect(packet.layers[1].source).toBe(2);
        expect(packet.layers[1].status).toBe(TCNetLayerStatus.PAUSED);
        expect(packet.layers[1].trackID).toBe(1234);
        expect(packet.layers[1].name).toBe("TrackB");
    });

    it("write() はエラーを投げる", () => {
        expect(() => new TCNetStatusPacket().write()).toThrow("not supported!");
    });

    it("length() は 300 を返す", () => {
        expect(new TCNetStatusPacket().length()).toBe(300);
    });

    it("type() は TCNetMessageType.Status(5) を返す", () => {
        expect(new TCNetStatusPacket().type()).toBe(5);
    });
});

describe("TCNetRequestPacket", () => {
    it("Requestパケットのフィールドをパースする", () => {
        // Arrange
        const buffer = Buffer.alloc(26);
        writeValidHeader(buffer, TCNetMessageType.Request);
        buffer.writeUInt8(12, 24); // dataType = CUEData
        buffer.writeUInt8(2, 25); // layer = 2

        const packet = new TCNetRequestPacket();
        packet.buffer = buffer;
        packet.header = createHeader(buffer);

        // Act
        packet.read();

        // Assert
        expect(packet.dataType).toBe(12);
        expect(packet.layer).toBe(2);
    });

    it("write()後にread()すると同じ値が得られる(ラウンドトリップ)", () => {
        // Arrange
        const buffer = Buffer.alloc(26);
        writeValidHeader(buffer, TCNetMessageType.Request);
        const packet = new TCNetRequestPacket();
        packet.buffer = buffer;
        packet.header = createHeader(buffer);
        packet.dataType = 16; // SmallWaveFormData
        packet.layer = 3;

        // Act
        packet.write();
        const packet2 = new TCNetRequestPacket();
        packet2.buffer = buffer;
        packet2.header = createHeader(buffer);
        packet2.read();

        // Assert
        expect(packet2.dataType).toBe(16);
        expect(packet2.layer).toBe(3);
    });

    it("length() は 26 を返す", () => {
        expect(new TCNetRequestPacket().length()).toBe(26);
    });

    it("type() は TCNetMessageType.Request(20) を返す", () => {
        expect(new TCNetRequestPacket().type()).toBe(20);
    });
});

describe("TCNetTimecode", () => {
    it("バッファの指定オフセットからタイムコードをパースする", () => {
        // Arrange
        const buffer = Buffer.alloc(20);
        // offset=10 にタイムコードデータを書き込む
        buffer.writeUInt8(1, 10); // mode
        buffer.writeUInt8(TCNetTimecodeState.Running, 11); // state
        buffer.writeUInt8(2, 12); // hours
        buffer.writeUInt8(30, 13); // minutes
        buffer.writeUInt8(45, 14); // seconds
        buffer.writeUInt8(15, 15); // frames

        // Act
        const tc = new TCNetTimecode();
        tc.read(buffer, 10);

        // Assert
        expect(tc.smpteMode).toBe(1);
        expect(tc.state).toBe(TCNetTimecodeState.Running);
        expect(tc.hours).toBe(2);
        expect(tc.minutes).toBe(30);
        expect(tc.seconds).toBe(45);
        expect(tc.frames).toBe(15);
    });

    it("offset=0 からタイムコードをパースする", () => {
        // Arrange
        const buffer = Buffer.alloc(6);
        buffer.writeUInt8(0, 0); // mode
        buffer.writeUInt8(TCNetTimecodeState.Stopped, 1); // state
        buffer.writeUInt8(0, 2); // hours
        buffer.writeUInt8(0, 3); // minutes
        buffer.writeUInt8(0, 4); // seconds
        buffer.writeUInt8(0, 5); // frames

        // Act
        const tc = new TCNetTimecode();
        tc.read(buffer, 0);

        // Assert
        expect(tc.smpteMode).toBe(0);
        expect(tc.state).toBe(TCNetTimecodeState.Stopped);
        expect(tc.hours).toBe(0);
        expect(tc.minutes).toBe(0);
        expect(tc.seconds).toBe(0);
        expect(tc.frames).toBe(0);
    });
});

describe("TCNetTimePacket", () => {
    it("154バイトバッファから8レイヤーの時間情報をパースする(onAirは255固定)", () => {
        // Arrange
        const buffer = Buffer.alloc(154);
        writeValidHeader(buffer, TCNetMessageType.Time);
        // レイヤー0: currentTimeMillis=1000, totalTimeMillis=300000, beatMarker=1, state=PLAYING
        buffer.writeUInt32LE(1000, 24); // currentTimeMillis[0]
        buffer.writeUInt32LE(300000, 56); // totalTimeMillis[0]
        buffer.writeUInt8(1, 88); // beatMarker[0]
        buffer.writeUInt8(TCNetLayerStatus.PLAYING, 96); // state[0]
        // レイヤー1: currentTimeMillis=5000
        buffer.writeUInt32LE(5000, 28); // currentTimeMillis[1]
        buffer.writeUInt8(TCNetLayerStatus.PAUSED, 97); // state[1]
        // generalSMPTEMode
        buffer.writeUInt8(3, 105);

        const packet = new TCNetTimePacket();
        packet.buffer = buffer;
        packet.header = createHeader(buffer);

        // Act
        packet.read();

        // Assert
        expect(packet.layers).toHaveLength(8);
        expect(packet.layers[0].currentTimeMillis).toBe(1000);
        expect(packet.layers[0].totalTimeMillis).toBe(300000);
        expect(packet.layers[0].beatMarker).toBe(1);
        expect(packet.layers[0].state).toBe(TCNetLayerStatus.PLAYING);
        expect(packet.layers[0].onAir).toBe(255); // 154バイトなので常に255
        expect(packet.layers[1].currentTimeMillis).toBe(5000);
        expect(packet.layers[1].state).toBe(TCNetLayerStatus.PAUSED);
        expect(packet.generalSMPTEMode).toBe(3);
    });

    it("162バイトバッファではonAirフィールドをパースする", () => {
        // Arrange
        const buffer = Buffer.alloc(162);
        writeValidHeader(buffer, TCNetMessageType.Time);
        // レイヤー0のonAir = 1
        buffer.writeUInt8(1, 154);
        // レイヤー1のonAir = 0
        buffer.writeUInt8(0, 155);

        const packet = new TCNetTimePacket();
        packet.buffer = buffer;
        packet.header = createHeader(buffer);

        // Act
        packet.read();

        // Assert
        expect(packet.layers[0].onAir).toBe(1);
        expect(packet.layers[1].onAir).toBe(0);
    });

    it("write() はエラーを投げる", () => {
        const buffer = Buffer.alloc(154);
        const packet = new TCNetTimePacket();
        packet.buffer = buffer;
        expect(() => packet.write()).toThrow("not supported!");
    });

    it("length() は 154バイトバッファで 154 を返す", () => {
        const buffer = Buffer.alloc(154);
        const packet = new TCNetTimePacket();
        packet.buffer = buffer;
        expect(packet.length()).toBe(154);
    });

    it("length() は 162バイトバッファで 162 を返す", () => {
        const buffer = Buffer.alloc(162);
        const packet = new TCNetTimePacket();
        packet.buffer = buffer;
        expect(packet.length()).toBe(162);
    });

    it("length() はそれ以外のサイズで -1 を返す", () => {
        const buffer = Buffer.alloc(200);
        const packet = new TCNetTimePacket();
        packet.buffer = buffer;
        expect(packet.length()).toBe(-1);
    });

    it("type() は TCNetMessageType.Time(254) を返す", () => {
        expect(new TCNetTimePacket().type()).toBe(254);
    });
});

describe("TCNetDataPacketMetrics", () => {
    it("Metricsデータをパースする", () => {
        // Arrange
        const buffer = Buffer.alloc(122);
        buffer.writeUInt8(3, 2);
        buffer.write("TCN", 4, "ascii");
        buffer.writeUInt8(200, 7); // messageType = Data
        buffer.writeUInt8(2, 24); // dataType = MetricsData
        buffer.writeUInt8(1, 25); // layer (1-indexed, 0-indexedで0になる)
        buffer.writeUInt8(TCNetLayerStatus.PLAYING, 27); // state
        buffer.writeUInt8(TCNetLayerSyncMaster.Master, 29); // syncMaster
        buffer.writeUInt8(1, 31); // beatMarker
        buffer.writeUInt32LE(240000, 32); // trackLength
        buffer.writeUInt32LE(60000, 36); // currentPosition
        buffer.writeUInt32LE(100000, 40); // speed
        buffer.writeUInt32LE(4, 57); // beatNumber
        buffer.writeUInt32LE(14000, 112); // bpm (= 140.00 BPM * 100)
        buffer.writeInt16LE(600, 116); // pitchBend (+6.00%)
        buffer.writeUInt32LE(777, 118); // trackID

        const packet = new TCNetDataPacketMetrics();
        packet.buffer = buffer;
        packet.header = createHeader(buffer);

        // Act
        packet.read();

        // Assert
        expect(packet.data).not.toBeNull();
        expect(packet.data!.state).toBe(TCNetLayerStatus.PLAYING);
        expect(packet.data!.syncMaster).toBe(TCNetLayerSyncMaster.Master);
        expect(packet.data!.beatMarker).toBe(1);
        expect(packet.data!.trackLength).toBe(240000);
        expect(packet.data!.currentPosition).toBe(60000);
        expect(packet.data!.speed).toBe(100000);
        expect(packet.data!.beatNumber).toBe(4);
        expect(packet.data!.bpm).toBe(14000);
        expect(packet.data!.pitchBend).toBe(600);
        expect(packet.data!.trackID).toBe(777);
    });

    it("write() はエラーを投げる", () => {
        const buffer = Buffer.alloc(122);
        const packet = new TCNetDataPacketMetrics();
        packet.buffer = buffer;
        expect(() => packet.write()).toThrow("not supported!");
    });

    it("length() は 122 を返す", () => {
        expect(new TCNetDataPacketMetrics().length()).toBe(122);
    });

    it.each([
        { value: 0, label: "ピッチ変更なし" },
        { value: 600, label: "+6.00%" },
        { value: -600, label: "-6.00%" },
        { value: 32767, label: "最大値" },
        { value: -32768, label: "最小値" },
    ])("pitchBend=$value ($label) を正しくパースする", ({ value }) => {
        const buffer = Buffer.alloc(122);
        buffer.writeUInt8(3, 2);
        buffer.write("TCN", 4, "ascii");
        buffer.writeUInt8(200, 7);
        buffer.writeUInt8(2, 24);
        buffer.writeUInt8(1, 25);
        buffer.writeInt16LE(value, 116);
        const packet = new TCNetDataPacketMetrics();
        packet.buffer = buffer;
        packet.header = createHeader(buffer);
        packet.read();
        expect(packet.data!.pitchBend).toBe(value);
    });
});

describe("TCNetDataPacket", () => {
    it("byte 25 = 1 のとき layer は 0 になる (1-based → 0-based 変換)", () => {
        // Arrange
        const buffer = Buffer.alloc(26);
        buffer.writeUInt8(3, 2);
        buffer.write("TCN", 4, "ascii");
        buffer.writeUInt8(200, 7);
        buffer.writeUInt8(2, 24); // dataType
        buffer.writeUInt8(1, 25); // layer (1-based)

        // Act
        const packet = new TCNetDataPacket();
        packet.buffer = buffer;
        packet.header = createHeader(buffer);
        packet.read();

        // Assert
        expect(packet.layer).toBe(0);
    });

    it("byte 25 = 8 のとき layer は 7 になる (1-based → 0-based 変換)", () => {
        // Arrange
        const buffer = Buffer.alloc(26);
        buffer.writeUInt8(3, 2);
        buffer.write("TCN", 4, "ascii");
        buffer.writeUInt8(200, 7);
        buffer.writeUInt8(2, 24); // dataType
        buffer.writeUInt8(8, 25); // layer (1-based)

        // Act
        const packet = new TCNetDataPacket();
        packet.buffer = buffer;
        packet.header = createHeader(buffer);
        packet.read();

        // Assert
        expect(packet.layer).toBe(7);
    });
});

describe("TCNetDataPacketMetadata", () => {
    it("Metadataデータをパースする(minorVersion=5)", () => {
        // Arrange
        const buffer = Buffer.alloc(548);
        buffer.writeUInt8(3, 2);
        buffer.write("TCN", 4, "ascii");
        buffer.writeUInt8(200, 7); // messageType = Data
        buffer.writeUInt8(4, 24); // dataType = MetaData
        buffer.writeUInt8(1, 25); // layer

        // trackArtist: UTF-16LE, offset 29-284 (256バイト = 128文字)
        const artist = "DJ Shadow";
        buffer.write(artist, 29, "utf16le");

        // trackTitle: UTF-16LE, offset 285-540 (256バイト = 128文字)
        const title = "Endtroducing";
        buffer.write(title, 285, "utf16le");

        // trackKey
        buffer.writeUInt16LE(5, 541);

        // trackID
        buffer.writeUInt32LE(42, 543);

        const packet = new TCNetDataPacketMetadata();
        packet.buffer = buffer;
        packet.header = createHeader(buffer); // minorVersion=5

        // Act
        packet.read();

        // Assert
        expect(packet.info).not.toBeNull();
        expect(packet.info!.trackArtist).toBe("DJ Shadow");
        expect(packet.info!.trackTitle).toBe("Endtroducing");
        expect(packet.info!.trackKey).toBe(5);
        expect(packet.info!.trackID).toBe(42);
    });

    it("minorVersion < 5 の場合は read() が例外を投げる", () => {
        // Arrange
        const buffer = Buffer.alloc(548);
        buffer.writeUInt8(3, 2);
        buffer.write("TCN", 4, "ascii");
        buffer.writeUInt8(200, 7);
        buffer.writeUInt8(4, 24);
        buffer.writeUInt8(1, 25);

        const packet = new TCNetDataPacketMetadata();
        packet.buffer = buffer;

        // minorVersion=4 の古いヘッダーを設定
        const header = new TCNetManagementHeader(buffer);
        header.minorVersion = 4;
        packet.header = header;

        // Act / Assert
        expect(() => packet.read()).toThrow("Unsupported packet version");
    });

    it("write() はエラーを投げる", () => {
        const buffer = Buffer.alloc(548);
        const packet = new TCNetDataPacketMetadata();
        packet.buffer = buffer;
        expect(() => packet.write()).toThrow("not supported!");
    });

    it("length() は 548 を返す", () => {
        expect(new TCNetDataPacketMetadata().length()).toBe(548);
    });

    it("trackArtist/trackTitle 領域が全て \\x00 のとき空文字列になる", () => {
        // Arrange: Buffer.alloc のデフォルトで全バイトが 0x00
        const buffer = Buffer.alloc(548);
        buffer.writeUInt8(3, 2);
        buffer.write("TCN", 4, "ascii");
        buffer.writeUInt8(200, 7);
        buffer.writeUInt8(4, 24); // dataType = MetaData
        buffer.writeUInt8(1, 25); // layer

        // Act
        const packet = new TCNetDataPacketMetadata();
        packet.buffer = buffer;
        packet.header = createHeader(buffer); // minorVersion=5

        packet.read();

        // Assert
        expect(packet.info).not.toBeNull();
        expect(packet.info!.trackArtist).toBe("");
        expect(packet.info!.trackTitle).toBe("");
    });
});
