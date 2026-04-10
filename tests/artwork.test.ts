import { describe, it, expect, vi, afterEach } from "vitest";
import * as nw from "../src/network";
import { writeValidHeader, createHeader, TestTCNetClient } from "./helpers";

// Fileパケット (MessageType=204) のバッファを生成するヘルパー
function createFilePacketBuffer(
    dataType: number,
    layer: number,
    totalPackets: number,
    packetNo: number,
    data: Buffer,
): Buffer {
    const clusterSize = data.length;
    const size = 42 + clusterSize;
    const buffer = Buffer.alloc(size);
    writeValidHeader(buffer, nw.TCNetMessageType.File);
    buffer.writeUInt8(dataType, 24);
    buffer.writeUInt8(layer, 25);
    buffer.writeUInt32LE(totalPackets, 30);
    buffer.writeUInt32LE(packetNo, 34);
    buffer.writeUInt32LE(clusterSize, 38);
    data.copy(buffer, 42);
    return buffer;
}

describe("TCNetFilePacket", () => {
    it("type() は TCNetMessageType.File(204) を返す", () => {
        expect(new nw.TCNetFilePacket().type()).toBe(204);
    });

    it("TCNetDataPacket のインスタンスである", () => {
        expect(new nw.TCNetFilePacket()).toBeInstanceOf(nw.TCNetDataPacket);
    });

    it("dataType と layer をパースする", () => {
        const buffer = Buffer.alloc(42);
        writeValidHeader(buffer, nw.TCNetMessageType.File);
        buffer.writeUInt8(128, 24); // dataType = ArtworkData
        buffer.writeUInt8(1, 25); // layer (1-based)

        const packet = new nw.TCNetFilePacket();
        packet.buffer = buffer;
        packet.header = createHeader(buffer);
        packet.read();

        expect(packet.dataType).toBe(128);
        expect(packet.layer).toBe(0); // 1-based -> 0-based
    });

    it("length() は -1 (可変長) を返す", () => {
        expect(new nw.TCNetFilePacket().length()).toBe(-1);
    });
});

describe("TCNetDataPacketArtwork", () => {
    it("read() で単一パケットからJPEGデータを読み取る", () => {
        const jpegData = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
        const buffer = Buffer.alloc(42 + jpegData.length);
        writeValidHeader(buffer, nw.TCNetMessageType.File);
        buffer.writeUInt8(128, 24);
        buffer.writeUInt8(1, 25);
        buffer.writeUInt32LE(1, 30); // totalPackets
        buffer.writeUInt32LE(1, 34); // packetNo
        buffer.writeUInt32LE(jpegData.length, 38); // clusterSize
        jpegData.copy(buffer, 42);

        const packet = new nw.TCNetDataPacketArtwork();
        packet.buffer = buffer;
        packet.header = createHeader(buffer);
        packet.read();

        expect(packet.data).not.toBeNull();
        expect(packet.data!.jpeg).toEqual(jpegData);
    });

    it("read() で clusterSize=0 の File パケットからバッファ末尾までJPEGデータを読み取る", () => {
        // Fileパケットではclusterサイズが0のため、バッファ末尾までをデータとして扱う
        const jpegData = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02, 0x03, 0x04]);
        const buffer = Buffer.alloc(42 + jpegData.length);
        writeValidHeader(buffer, nw.TCNetMessageType.File);
        buffer.writeUInt8(128, 24);
        buffer.writeUInt8(1, 25);
        buffer.writeUInt32LE(0, 38); // clusterSize = 0 (Fileパケットの実機挙動)
        jpegData.copy(buffer, 42);

        const packet = new nw.TCNetDataPacketArtwork();
        packet.buffer = buffer;
        packet.header = createHeader(buffer);
        packet.read();

        expect(packet.data).not.toBeNull();
        expect(packet.data!.jpeg).toEqual(jpegData);
    });

    it("readAssembled() でアセンブル済みバッファからJPEGデータを読み取る", () => {
        const jpegData = Buffer.alloc(4800);
        // JPEGマジックナンバーを先頭に設定
        jpegData.writeUInt8(0xff, 0);
        jpegData.writeUInt8(0xd8, 1);
        // 末尾にEOIマーカーを設定
        jpegData.writeUInt8(0xff, jpegData.length - 2);
        jpegData.writeUInt8(0xd9, jpegData.length - 1);

        const packet = new nw.TCNetDataPacketArtwork();
        packet.buffer = Buffer.alloc(42); // ダミーバッファ
        packet.readAssembled(jpegData);

        expect(packet.data).not.toBeNull();
        expect(packet.data!.jpeg).toEqual(jpegData);
        expect(packet.data!.jpeg[0]).toBe(0xff);
        expect(packet.data!.jpeg[1]).toBe(0xd8);
    });

    it("readAssembled() は元バッファへの参照を共有しない", () => {
        const original = Buffer.from([0xff, 0xd8, 0x01, 0x02]);
        const packet = new nw.TCNetDataPacketArtwork();
        packet.buffer = Buffer.alloc(42);
        packet.readAssembled(original);

        // 元バッファを変更してもパケットデータに影響しない
        original.writeUInt8(0x00, 0);
        expect(packet.data!.jpeg[0]).toBe(0xff);
    });

    it("write() はエラーを投げる", () => {
        expect(() => new nw.TCNetDataPacketArtwork().write()).toThrow("not supported!");
    });

    it("length() は -1 (可変長) を返す", () => {
        expect(new nw.TCNetDataPacketArtwork().length()).toBe(-1);
    });
});

describe("TCNetDataPacketType レジストリ", () => {
    it("ArtworkData(128) が TCNetDataPacketType に定義されている", () => {
        expect(nw.TCNetDataPacketType.ArtworkData).toBe(128);
    });

    it("TCNetPackets[204] が TCNetFilePacket に登録されている", () => {
        expect(nw.TCNetPackets[nw.TCNetMessageType.File]).toBe(nw.TCNetFilePacket);
    });

    it("TCNetDataPackets[128] が TCNetDataPacketArtwork に登録されている", () => {
        expect(nw.TCNetDataPackets[nw.TCNetDataPacketType.ArtworkData]).toBe(nw.TCNetDataPacketArtwork);
    });
});

describe("receiveUnicast Artwork マルチパケット", () => {
    // fake timers を使うテストで、アサーション失敗時にも実時間タイマーに復帰させるための保険
    afterEach(() => {
        vi.useRealTimers();
    });

    // 3パケット(2400+2400+902、実機ログのパターン)で Artwork をアセンブルするヘルパー
    async function receiveThreePacketArtwork(): Promise<nw.TCNetDataPacketArtwork> {
        const client = new TestTCNetClient();
        client.simulateConnected();
        const mockSocket = {
            send: vi.fn((_buf: Buffer, _port: number, _addr: string, cb: () => void) => cb()),
        };
        (client as any).broadcastSocket = mockSocket;
        (client as any).config.broadcastAddress = "255.255.255.255";

        const promise = client.requestData(nw.TCNetDataPacketType.ArtworkData, 0);

        const chunk1 = Buffer.alloc(2400, 0xff); // 1st cluster
        const chunk2 = Buffer.alloc(2400, 0xd8); // 2nd cluster
        const chunk3 = Buffer.alloc(902, 0xe0); // 3rd cluster (末尾)

        client.simulateUnicast(createFilePacketBuffer(128, 1, 3, 1, chunk1));
        client.simulateUnicast(createFilePacketBuffer(128, 1, 3, 2, chunk2));
        client.simulateUnicast(createFilePacketBuffer(128, 1, 3, 3, chunk3));

        return (await promise) as nw.TCNetDataPacketArtwork;
    }

    it("3パケット受信で TCNetDataPacketArtwork がアセンブルされる", async () => {
        const artwork = await receiveThreePacketArtwork();
        expect(artwork).toBeInstanceOf(nw.TCNetDataPacketArtwork);
        expect(artwork.data).not.toBeNull();
    });

    it("3パケットアセンブル後のJPEG長さが全チャンクの合計サイズになる", async () => {
        const artwork = await receiveThreePacketArtwork();
        // 長さ = 2400 + 2400 + 902
        expect(artwork.data!.jpeg.length).toBe(5702);
    });

    it("3パケットアセンブル後のJPEGが各チャンクを順序通り連結した内容になる", async () => {
        const artwork = await receiveThreePacketArtwork();
        // 各チャンクの先頭バイトが期待位置にあることを検証する
        expect(artwork.data!.jpeg[0]).toBe(0xff); // chunk1
        expect(artwork.data!.jpeg[2400]).toBe(0xd8); // chunk2
        expect(artwork.data!.jpeg[4800]).toBe(0xe0); // chunk3
    });

    it("totalPackets=0 の単一 File パケットがタイムアウトベースで resolve する", async () => {
        vi.useFakeTimers();
        const client = new TestTCNetClient();
        client.simulateConnected();
        const mockSocket = { send: vi.fn((_buf: Buffer, _port: number, _addr: string, cb: () => void) => cb()) };
        (client as any).broadcastSocket = mockSocket;
        (client as any).config.broadcastAddress = "255.255.255.255";

        const promise = client.requestData(nw.TCNetDataPacketType.ArtworkData, 0);

        const jpegData = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02, 0x03, 0x04]);
        const bufSize = 42 + jpegData.length;
        const pkt = Buffer.alloc(bufSize);
        writeValidHeader(pkt, nw.TCNetMessageType.File);
        pkt.writeUInt8(128, 24); // dataType = ArtworkData
        pkt.writeUInt8(1, 25); // layer (1-based)
        pkt.writeUInt32LE(0, 30); // totalPackets = 0
        pkt.writeUInt32LE(0, 34); // packetNo = 0
        pkt.writeUInt32LE(0, 38); // clusterSize = 0
        jpegData.copy(pkt, 42);

        client.simulateUnicast(pkt);

        // fileCollectionTimeout (200ms) 経過でアセンブル完了
        vi.advanceTimersByTime(200);

        const result = await promise;
        expect(result).toBeInstanceOf(nw.TCNetDataPacketArtwork);
        const artwork = result as nw.TCNetDataPacketArtwork;
        expect(artwork.data).not.toBeNull();
        expect(artwork.data!.jpeg).toEqual(jpegData);
    });

    it("totalPackets=0 のマルチ File パケットが蓄積されてアセンブルされる", async () => {
        vi.useFakeTimers();
        const client = new TestTCNetClient();
        client.simulateConnected();
        const mockSocket = { send: vi.fn((_buf: Buffer, _port: number, _addr: string, cb: () => void) => cb()) };
        (client as any).broadcastSocket = mockSocket;
        (client as any).config.broadcastAddress = "255.255.255.255";

        const promise = client.requestData(nw.TCNetDataPacketType.ArtworkData, 0);

        // 3パケットに分割されたJPEGデータ (全てtotalPackets=0)
        const chunk1 = Buffer.alloc(2400, 0xff);
        const chunk2 = Buffer.alloc(2400, 0xd8);
        const chunk3 = Buffer.alloc(900, 0xe0);

        const pkt1 = createFilePacketBuffer(128, 1, 0, 0, chunk1);
        const pkt2 = createFilePacketBuffer(128, 1, 0, 0, chunk2);
        const pkt3 = createFilePacketBuffer(128, 1, 0, 0, chunk3);

        client.simulateUnicast(pkt1);
        vi.advanceTimersByTime(10); // 10ms後に次パケット
        client.simulateUnicast(pkt2);
        vi.advanceTimersByTime(10);
        client.simulateUnicast(pkt3);

        // まだresolveしない (200ms未経過)
        vi.advanceTimersByTime(100);

        // 200ms経過でアセンブル完了
        vi.advanceTimersByTime(100);

        const result = await promise;
        expect(result).toBeInstanceOf(nw.TCNetDataPacketArtwork);
        const artwork = result as nw.TCNetDataPacketArtwork;
        expect(artwork.data!.jpeg.length).toBe(5700); // 2400 + 2400 + 900
        expect(artwork.data!.jpeg[0]).toBe(0xff);
        expect(artwork.data!.jpeg[2400]).toBe(0xd8);
        expect(artwork.data!.jpeg[4800]).toBe(0xe0);
    });

    it("2パケットの Artwork もアセンブルされる", async () => {
        const client = new TestTCNetClient();
        client.simulateConnected();
        const mockSocket = { send: vi.fn((_buf: Buffer, _port: number, _addr: string, cb: () => void) => cb()) };
        (client as any).broadcastSocket = mockSocket;
        (client as any).config.broadcastAddress = "255.255.255.255";

        const promise = client.requestData(nw.TCNetDataPacketType.ArtworkData, 0);

        const chunk1 = Buffer.alloc(2400, 0xaa);
        const chunk2 = Buffer.alloc(1704, 0xbb); // 1746 - 42 = 1704

        const pkt1 = createFilePacketBuffer(128, 1, 2, 1, chunk1);
        const pkt2 = createFilePacketBuffer(128, 1, 2, 2, chunk2);

        client.simulateUnicast(pkt1);
        client.simulateUnicast(pkt2);

        const result = await promise;
        expect(result).toBeInstanceOf(nw.TCNetDataPacketArtwork);
        const artwork = result as nw.TCNetDataPacketArtwork;
        expect(artwork.data!.jpeg.length).toBe(4104);
    });

    it("アセンブル完了時に data イベントが emit される", async () => {
        const client = new TestTCNetClient();
        client.simulateConnected();
        const mockSocket = { send: vi.fn((_buf: Buffer, _port: number, _addr: string, cb: () => void) => cb()) };
        (client as any).broadcastSocket = mockSocket;
        (client as any).config.broadcastAddress = "255.255.255.255";

        const handler = vi.fn();
        client.on("data", handler);

        const promise = client.requestData(nw.TCNetDataPacketType.ArtworkData, 0);

        const chunk1 = Buffer.alloc(100, 0x01);
        const chunk2 = Buffer.alloc(50, 0x02);

        client.simulateUnicast(createFilePacketBuffer(128, 1, 2, 1, chunk1));
        // 1パケット目ではemitされない
        expect(handler).not.toHaveBeenCalled();

        client.simulateUnicast(createFilePacketBuffer(128, 1, 2, 2, chunk2));
        // 2パケット目(最終)でemitされる
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0]).toBeInstanceOf(nw.TCNetDataPacketArtwork);

        await promise;
    });

    it("totalPackets=0 のfileChunks蓄積がrequestTimeoutで上限タイムアウトする", async () => {
        vi.useFakeTimers();
        const client = new TestTCNetClient();
        client.simulateConnected();
        const mockSocket = { send: vi.fn((_buf: Buffer, _port: number, _addr: string, cb: () => void) => cb()) };
        (client as any).broadcastSocket = mockSocket;
        (client as any).config.broadcastAddress = "255.255.255.255";
        (client as any).config.requestTimeout = 500;

        const promise = client.requestData(nw.TCNetDataPacketType.ArtworkData, 0);

        const chunk = Buffer.alloc(100, 0xff);
        // パケットを200ms未満の間隔で送り続け、fileCollectionTimeoutをリセットし続ける
        client.simulateUnicast(createFilePacketBuffer(128, 1, 0, 0, chunk));
        vi.advanceTimersByTime(150);
        client.simulateUnicast(createFilePacketBuffer(128, 1, 0, 0, chunk));
        vi.advanceTimersByTime(150);
        client.simulateUnicast(createFilePacketBuffer(128, 1, 0, 0, chunk));

        // requestTimeout(500ms)到達で上限タイムアウト
        vi.advanceTimersByTime(200);

        await expect(promise).rejects.toThrow("Timeout");
    });

    it("同一keyで再requestした場合、旧リクエストが reject され新リクエストが正常動作する", async () => {
        const client = new TestTCNetClient();
        client.simulateConnected();
        const mockSocket = { send: vi.fn((_buf: Buffer, _port: number, _addr: string, cb: () => void) => cb()) };
        (client as any).broadcastSocket = mockSocket;
        (client as any).config.broadcastAddress = "255.255.255.255";

        // 1回目のリクエスト (応答なしで放置)
        const promise1 = client.requestData(nw.TCNetDataPacketType.ArtworkData, 0);

        // 2回目のリクエスト (同一key: 128-0)
        const promise2 = client.requestData(nw.TCNetDataPacketType.ArtworkData, 0);

        // 1回目は "Superseded" で reject される
        await expect(promise1).rejects.toThrow("Superseded by new request");

        // 2回目は正常にレスポンスを受信できる
        const chunk = Buffer.alloc(100, 0xff);
        client.simulateUnicast(createFilePacketBuffer(128, 1, 1, 1, chunk));

        const result = await promise2;
        expect(result).toBeInstanceOf(nw.TCNetDataPacketArtwork);
        expect((result as nw.TCNetDataPacketArtwork).data!.jpeg.length).toBe(100);
    });
});
