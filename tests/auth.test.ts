import { describe, it, expect, vi } from "vitest";
import { fnv1aInt32, generateAuthPayload, DATA_HASH } from "../src/auth";
import { TCNetApplicationDataPacket, TCNetErrorPacket, TCNetMessageType } from "../src/network";
import { TCNetClient, TCNetConfiguration, type TCNetLogger } from "../src/tcnet";
import { writeValidHeader, createHeader, isolateXteaEnv } from "./helpers";
import {
    AuthTestClient,
    AuthSequenceTestClient,
    flushAsync,
    APPDATA_CMD_OFFSET,
    createAdapter,
} from "./auth-test-helpers";

isolateXteaEnv();

describe("fnv1aInt32", () => {
    it("fnv1aInt32([192,168,0,10]) は 0x92ADC21F を返す", () => {
        expect(fnv1aInt32([192, 168, 0, 10])).toBe(0x92adc21f);
    });

    it("fnv1aInt32([0xA0,0x0A]) は DATA_HASH (0xC688A0AF) と一致する", () => {
        expect(fnv1aInt32([0xa0, 0x0a])).toBe(0xc688a0af);
        expect(fnv1aInt32([0xa0, 0x0a])).toBe(DATA_HASH);
    });

    it("空配列ではFNVオフセットバイアス (0x811C9DC5) を返す", () => {
        expect(fnv1aInt32([])).toBe(0x811c9dc5);
    });

    it("単一要素のハッシュが正しく計算される", () => {
        expect(fnv1aInt32([0])).toBe(0x050c5d1f);
    });

    it("全て0のIPオクテットでもクラッシュしない", () => {
        const result = fnv1aInt32([0, 0, 0, 0]);
        expect(typeof result).toBe("number");
        expect(result).toBeGreaterThanOrEqual(0);
    });
});

describe("generateAuthPayload", () => {
    it("auth[0:4]にK XOR tokenが書き込まれる", () => {
        // token=0xDEEC6DFC, clientIP=192.168.0.10
        const ciphertext = Buffer.alloc(8, 0xab);
        const payload = generateAuthPayload(0xdeec6dfc, "192.168.0.10", ciphertext);

        expect(payload.length).toBe(12);
        const K = (fnv1aInt32([192, 168, 0, 10]) ^ DATA_HASH) >>> 0;
        expect(payload.readUInt32LE(0)).toBe((K ^ 0xdeec6dfc) >>> 0);
        expect(payload.slice(4, 12)).toEqual(ciphertext);
    });

    it("auth[4:12]は暗号文未指定時にゼロ埋めされる", () => {
        const payload = generateAuthPayload(0xaabbccdd, "10.0.0.1");
        expect(payload.slice(4, 12).toString("hex")).toBe("0000000000000000");
    });

    it("トークンが0の場合はKがそのまま書き込まれる", () => {
        const payload = generateAuthPayload(0, "192.168.0.10");
        const K = (fnv1aInt32([192, 168, 0, 10]) ^ DATA_HASH) >>> 0;
        expect(payload.readUInt32LE(0)).toBe(K);
    });

    it("異なるIPアドレスでは異なるペイロードが生成される", () => {
        const payload1 = generateAuthPayload(0x11111111, "192.168.0.10");
        const payload2 = generateAuthPayload(0x11111111, "192.168.0.20");
        expect(payload1.equals(payload2)).toBe(false);
    });

    it("異なるトークンでは異なるペイロードが生成される", () => {
        const payload1 = generateAuthPayload(0x11111111, "192.168.0.10");
        const payload2 = generateAuthPayload(0x22222222, "192.168.0.10");
        expect(payload1.equals(payload2)).toBe(false);
    });

    it("暗号文Bufferがauth[4:12]にコピーされる", () => {
        const ciphertext = Buffer.alloc(8, 0xab);
        const payload = generateAuthPayload(0xaabbccdd, "10.0.0.1", ciphertext);
        expect(payload.slice(4, 12)).toEqual(ciphertext);
    });

    it("第3引数を省略するとauth[4:12]がゼロ埋めされる", () => {
        const payload = generateAuthPayload(0xaabbccdd, "10.0.0.1");
        expect(payload.slice(4, 12).toString("hex")).toBe("0000000000000000");
    });
});

describe("TCNetApplicationDataPacket", () => {
    it("write()後にread()すると同じ値が得られる(ラウンドトリップ)", () => {
        // Arrange
        const buffer = Buffer.alloc(62);
        writeValidHeader(buffer, TCNetMessageType.ApplicationData);

        const packet = new TCNetApplicationDataPacket();
        packet.buffer = buffer;
        packet.header = createHeader(buffer);
        packet.dest = 0xffff;
        packet.subType = 0x14;
        packet.field1 = 1;
        packet.field2 = 1;
        packet.fixedValue = 0x0aa0;
        packet.cmd = 2;
        packet.listenerPort = 65023;
        packet.token = 0x12345678;
        packet.payload = Buffer.alloc(12, 0xab);

        // Act
        packet.write();
        const packet2 = new TCNetApplicationDataPacket();
        packet2.buffer = buffer;
        packet2.header = createHeader(buffer);
        packet2.read();

        // Assert
        expect(packet2.dest).toBe(0xffff);
        expect(packet2.subType).toBe(0x14);
        expect(packet2.field1).toBe(1);
        expect(packet2.field2).toBe(1);
        expect(packet2.fixedValue).toBe(0x0aa0);
        expect(packet2.cmd).toBe(2);
        expect(packet2.listenerPort).toBe(65023);
        expect(packet2.token).toBe(0x12345678);
    });

    it("payloadが12バイトで正しくラウンドトリップする", () => {
        // Arrange
        const buffer = Buffer.alloc(62);
        writeValidHeader(buffer, TCNetMessageType.ApplicationData);

        const testPayload = Buffer.alloc(12);
        testPayload.fill(0xab);

        const packet = new TCNetApplicationDataPacket();
        packet.buffer = buffer;
        packet.header = createHeader(buffer);
        packet.dest = 0xffff;
        packet.subType = 0x14;
        packet.field1 = 1;
        packet.field2 = 1;
        packet.fixedValue = 0x0aa0;
        packet.cmd = 2;
        packet.listenerPort = 65023;
        packet.token = 0;
        packet.payload = testPayload;

        // Act
        packet.write();
        const packet2 = new TCNetApplicationDataPacket();
        packet2.buffer = buffer;
        packet2.header = createHeader(buffer);
        packet2.read();

        // Assert
        expect(Buffer.from(packet2.payload).equals(testPayload)).toBe(true);
    });

    it("length() は 62 を返す", () => {
        expect(new TCNetApplicationDataPacket().length()).toBe(62);
    });

    it("type() は TCNetMessageType.ApplicationData(30) を返す", () => {
        expect(new TCNetApplicationDataPacket().type()).toBe(30);
    });

    it("cmd=0 (hello) パケットのフィールドが正しく設定される", () => {
        // Arrange
        const buffer = Buffer.alloc(62);
        writeValidHeader(buffer, TCNetMessageType.ApplicationData);

        const packet = new TCNetApplicationDataPacket();
        packet.buffer = buffer;
        packet.header = createHeader(buffer);
        packet.dest = 0xffff;
        packet.subType = 0x14;
        packet.field1 = 1;
        packet.field2 = 1;
        packet.fixedValue = 0x0aa0;
        packet.cmd = 0; // hello
        packet.listenerPort = 65023;
        packet.token = 0;
        packet.payload = Buffer.alloc(12);

        // Act
        packet.write();
        const packet2 = new TCNetApplicationDataPacket();
        packet2.buffer = buffer;
        packet2.header = createHeader(buffer);
        packet2.read();

        // Assert
        expect(packet2.cmd).toBe(0);
        expect(packet2.token).toBe(0);
    });
});

describe("TCNetErrorPacket", () => {
    it("認証成功のErrorパケットを構造化フィールドでパースする", () => {
        // Arrange
        const buffer = Buffer.alloc(30);
        writeValidHeader(buffer, TCNetMessageType.Error);
        buffer.writeUInt8(0xff, 24); // dataType
        buffer.writeUInt8(0xff, 25); // layerId
        buffer.writeUInt16LE(0xffff, 26); // code
        buffer.writeUInt16LE(0x00, 28); // messageType

        const packet = new TCNetErrorPacket();
        packet.buffer = buffer;
        packet.header = createHeader(buffer);

        // Act
        packet.read();

        // Assert
        expect(packet.dataType).toBe(0xff);
        expect(packet.layerId).toBe(0xff);
        expect(packet.code).toBe(0xffff);
        expect(packet.messageType).toBe(0x00);
    });

    it("認証失敗のErrorパケット (code=0x000D) をパースする", () => {
        // Arrange
        const buffer = Buffer.alloc(30);
        writeValidHeader(buffer, TCNetMessageType.Error);
        buffer.writeUInt8(0xff, 24); // dataType
        buffer.writeUInt8(0xff, 25); // layerId
        buffer.writeUInt16LE(0x000d, 26); // code = Not Possible
        buffer.writeUInt16LE(0x00, 28); // messageType

        const packet = new TCNetErrorPacket();
        packet.buffer = buffer;
        packet.header = createHeader(buffer);

        // Act
        packet.read();

        // Assert
        expect(packet.dataType).toBe(0xff);
        expect(packet.layerId).toBe(0xff);
        expect(packet.code).toBe(0x000d);
    });

    it("write() はエラーを投げる", () => {
        expect(() => new TCNetErrorPacket().write()).toThrow("not supported!");
    });

    it("length() は 30 を返す", () => {
        expect(new TCNetErrorPacket().length()).toBe(30);
    });

    it("type() は TCNetMessageType.Error(13) を返す", () => {
        expect(new TCNetErrorPacket().type()).toBe(13);
    });
});

function createAppDataPacket(cmd: number, token: number): TCNetApplicationDataPacket {
    const buffer = Buffer.alloc(62);
    writeValidHeader(buffer, TCNetMessageType.ApplicationData);
    const packet = new TCNetApplicationDataPacket();
    packet.buffer = buffer;
    packet.header = createHeader(buffer);
    packet.dest = 0xffff;
    packet.subType = 0x14;
    packet.field1 = 1;
    packet.field2 = 1;
    packet.fixedValue = 0x0aa0;
    packet.cmd = cmd;
    packet.listenerPort = 65023;
    packet.token = token;
    packet.payload = Buffer.alloc(12);
    packet.write();
    // read()で値を再設定してinstanceofチェックを通す
    const result = new TCNetApplicationDataPacket();
    result.buffer = buffer;
    result.header = createHeader(buffer);
    result.read();
    return result;
}

function createErrorPacket(dataType: number, layerId: number, code: number): TCNetErrorPacket {
    const buffer = Buffer.alloc(30);
    writeValidHeader(buffer, TCNetMessageType.Error);
    buffer.writeUInt8(dataType, 24);
    buffer.writeUInt8(layerId, 25);
    buffer.writeUInt16LE(code, 26);
    buffer.writeUInt16LE(0, 28);
    const packet = new TCNetErrorPacket();
    packet.buffer = buffer;
    packet.header = createHeader(buffer);
    packet.read();
    return packet;
}

describe("handleAuthPacket", () => {
    it("AppData cmd=1 でauthStateがpendingに遷移しトークンが保存される", () => {
        const client = new AuthTestClient();
        const appData = createAppDataPacket(1, 0xdeec6dfc);

        client.callHandleAuth(appData);

        expect(client.authenticationState).toBe("pending");
        expect(client.getSessionToken()).toBe(0xdeec6dfc);
    });

    it("Error 0xFFFFFF でauthStateがauthenticatedに遷移する", () => {
        const client = new AuthTestClient();
        client.setAuthState("pending");
        const errorPkt = createErrorPacket(0xff, 0xff, 0xff);

        client.callHandleAuth(errorPkt);

        expect(client.authenticationState).toBe("authenticated");
    });

    it("Error 0xFFFF0D でauthStateがfailedに遷移する", () => {
        const client = new AuthTestClient();
        client.setAuthState("pending");
        const errorPkt = createErrorPacket(0xff, 0xff, 0x0d);

        client.callHandleAuth(errorPkt);

        expect(client.authenticationState).toBe("failed");
    });

    it("authenticatedイベントが発火する", () => {
        const client = new AuthTestClient();
        client.setAuthState("pending");
        const handler = vi.fn();
        client.on("authenticated", handler);

        client.callHandleAuth(createErrorPacket(0xff, 0xff, 0xff));

        expect(handler).toHaveBeenCalledTimes(1);
    });

    it("authFailedイベントが発火する", () => {
        const client = new AuthTestClient();
        client.setAuthState("pending");
        const handler = vi.fn();
        client.on("authFailed", handler);

        client.callHandleAuth(createErrorPacket(0xff, 0xff, 0x0d));

        expect(handler).toHaveBeenCalledTimes(1);
    });

    it("認証失敗後にsessionTokenがクリアされ再試行可能になる", () => {
        const client = new AuthTestClient();

        // 1回目: cmd=1でトークン受信 → pending
        client.callHandleAuth(createAppDataPacket(1, 0xaabbccdd));
        expect(client.authenticationState).toBe("pending");

        // 認証失敗
        client.callHandleAuth(createErrorPacket(0xff, 0xff, 0x0d));
        expect(client.authenticationState).toBe("failed");
        expect(client.getSessionToken()).toBeNull();

        // 2回目: 新しいcmd=1を受け付ける
        client.callHandleAuth(createAppDataPacket(1, 0x11223344));
        expect(client.authenticationState).toBe("pending");
        expect(client.getSessionToken()).toBe(0x11223344);
    });

    it("xteaCiphertext未設定の場合は何も処理しない", () => {
        const client = new AuthTestClient();
        client.clearXteaCiphertext();
        const appData = createAppDataPacket(1, 0x12345678);

        client.callHandleAuth(appData);

        expect(client.authenticationState).toBe("none");
        expect(client.getSessionToken()).toBeNull();
    });

    it("authenticated状態でAppData cmd=1を受信してもauthStateは変化しない", () => {
        // SK方式の反応型プロトコル: authenticated状態で cmd=1 を受信すると
        // sendAuthCommandOnlyが呼ばれるが、state遷移は発生しない。
        // (sendAuthCommandOnlyはbroadcastSocket未設定のため実際の送信には至らない)
        const client = new AuthTestClient();
        client.setAuthState("authenticated");
        client.setSessionToken(0x12345678);
        const appData = createAppDataPacket(1, 0x12345678);

        client.callHandleAuth(appData);

        // authenticatedのまま維持される
        expect(client.authenticationState).toBe("authenticated");
    });

    it("authStateがpending以外のときErrorパケットを無視する", () => {
        const client = new AuthTestClient();
        // authState="none"のまま
        const handler = vi.fn();
        client.on("authenticated", handler);

        client.callHandleAuth(createErrorPacket(0xff, 0xff, 0xff));

        expect(client.authenticationState).toBe("none");
        expect(handler).not.toHaveBeenCalled();
    });

    it("送信元IPがMasterと異なる場合はパケットを無視する", () => {
        const client = new AuthTestClient();
        const appData = createAppDataPacket(1, 0xdeec6dfc);
        const otherRinfo = { address: "192.168.0.200", port: 65207, family: "IPv4", size: 0 };

        client.callHandleAuth(appData, otherRinfo);

        expect(client.authenticationState).toBe("none");
        expect(client.getSessionToken()).toBeNull();
    });

    it("serverが未設定の場合はパケットを無視する", () => {
        const client = new AuthTestClient();
        client.clearServer();
        const appData = createAppDataPacket(1, 0xdeec6dfc);

        client.callHandleAuth(appData);

        expect(client.authenticationState).toBe("none");
        expect(client.getSessionToken()).toBeNull();
    });
});

describe("sendAuthSequence 状態リセット", () => {
    it("xteaCiphertextが不正な場合、authStateとsessionTokenがリセットされる", async () => {
        const client = new AuthSequenceTestClient("invalid-hex");
        client.setSessionToken(0xdeec6dfc);
        client.setAuthState("pending");
        client.setBroadcastSocket({
            send: vi.fn((_buf: Buffer, _port: number, _addr: string, cb: () => void) => cb()),
        });

        // sendAuthSequenceを直接呼び出す
        await client.callSendAuthSequence();

        expect(client.authenticationState).toBe("none");
        expect(client.getSessionToken()).toBeNull();
    });

    it("broadcastSocketがnullの場合、authStateとsessionTokenがリセットされる", async () => {
        const client = new AuthSequenceTestClient();
        client.setSessionToken(0xdeec6dfc);
        client.setAuthState("pending");
        // broadcastSocket未設定 (null)

        await client.callSendAuthSequence();

        expect(client.authenticationState).toBe("none");
        expect(client.getSessionToken()).toBeNull();
    });

    it("sendPacketが例外を投げた場合、catchでauthStateとsessionTokenがリセットされる", async () => {
        const client = new AuthSequenceTestClient();
        client.setSessionToken(0xdeec6dfc);
        client.setAuthState("pending");
        client.setBroadcastSocket({
            send: vi.fn(() => {
                throw new Error("send failed");
            }),
        });
        client.setBroadcastAddress("255.255.255.255");

        // handleAuthPacket経由のcatchハンドラで呼ばれることを検証
        const appData = createAppDataPacket(1, 0xdeec6dfc);
        // authStateをnoneに戻してcmd=1受付条件を満たす
        client.setAuthState("none");
        client.setSessionToken(null);
        client.callHandleAuth(appData);

        // handleAuthPacket 内の sendAuthSequence().catch() チェーンを microtask flush で待つ
        await flushAsync();
        expect(client.authenticationState).toBe("none");
        expect(client.getSessionToken()).toBeNull();
    });

    it("状態リセット後に再度cmd=1を受信すると認証を再試行できる", async () => {
        const client = new AuthSequenceTestClient("invalid-hex");
        client.setBroadcastSocket({
            send: vi.fn((_buf: Buffer, _port: number, _addr: string, cb: () => void) => cb()),
        });

        // 1回目: cmd=1を受信 → sendAuthSequence → xteaCiphertext不正でリセット
        const appData1 = createAppDataPacket(1, 0xaabbccdd);
        client.callHandleAuth(appData1);
        await flushAsync();
        expect(client.authenticationState).toBe("none");
        expect(client.getSessionToken()).toBeNull();

        // 2回目: 再度cmd=1を受信 → 新しいトークンで再試行される
        const appData2 = createAppDataPacket(1, 0x11223344);
        client.callHandleAuth(appData2);
        // sendAuthSequenceが呼ばれてpendingになった後、xteaCiphertext不正でリセットされる
        await flushAsync();
        expect(client.authenticationState).toBe("none");
        // リセット後なので再度受付可能な状態
        expect(client.getSessionToken()).toBeNull();
    });
});

describe("xteaCiphertext設定の結合テスト", () => {
    it("xteaCiphertext未設定ではauth[4:12]がゼロ埋めになる", () => {
        const payload = generateAuthPayload(0xdeec6dfc, "192.168.0.10");
        expect(payload.slice(4, 12).toString("hex")).toBe("0000000000000000");
    });

    it("TCNetConfiguration.xteaCiphertext のデフォルトはundefined", () => {
        const config = new TCNetConfiguration();
        expect(config.xteaCiphertext).toBeUndefined();
    });

    it("TCNetConfiguration.xteaCiphertext に値を設定できる", () => {
        const config = new TCNetConfiguration();
        config.xteaCiphertext = "0000000000000000";
        const client = new TCNetClient(config);
        expect((client as any).config.xteaCiphertext).toBe("0000000000000000");
    });
});

describe("generateAuthPayload clientIpバリデーション", () => {
    it("不正なIPアドレスでErrorをthrowする", () => {
        expect(() => generateAuthPayload(0, "not-an-ip")).toThrow("Invalid IPv4");
    });

    it("オクテットが範囲外でErrorをthrowする", () => {
        expect(() => generateAuthPayload(0, "256.0.0.1")).toThrow("Invalid IPv4");
    });

    it("空文字列でErrorをthrowする", () => {
        expect(() => generateAuthPayload(0, "")).toThrow("Invalid IPv4");
    });

    it("3オクテットのIPでErrorをthrowする", () => {
        expect(() => generateAuthPayload(0, "192.168.0")).toThrow("Invalid IPv4");
    });

    it("負のオクテットでErrorをthrowする", () => {
        expect(() => generateAuthPayload(0, "192.168.-1.10")).toThrow("Invalid IPv4");
    });

    it("xteaCiphertextが7バイトでErrorをthrowする", () => {
        expect(() => generateAuthPayload(0, "192.168.0.10", Buffer.alloc(7))).toThrow(
            "Invalid XTEA ciphertext length: expected 8 bytes, got 7",
        );
    });

    it("xteaCiphertextが9バイトでErrorをthrowする", () => {
        expect(() => generateAuthPayload(0, "192.168.0.10", Buffer.alloc(9))).toThrow(
            "Invalid XTEA ciphertext length: expected 8 bytes, got 9",
        );
    });

    it("xteaCiphertextが8バイトで正常に処理される", () => {
        expect(() => generateAuthPayload(0, "192.168.0.10", Buffer.alloc(8))).not.toThrow();
    });

    it("16進表記のオクテットでErrorをthrowする", () => {
        expect(() => generateAuthPayload(0, "0x7f.0.0.1")).toThrow("Invalid IPv4");
    });

    it("科学記法のオクテットでErrorをthrowする", () => {
        expect(() => generateAuthPayload(0, "1e2.0.0.1")).toThrow("Invalid IPv4");
    });

    it("空オクテット (連続ドット) でErrorをthrowする", () => {
        expect(() => generateAuthPayload(0, "192.168..1")).toThrow("Invalid IPv4");
    });
});

describe("認証タイムアウト", () => {
    it("認証応答がない場合、タイムアウトでauthStateがリセットされる", async () => {
        vi.useFakeTimers();
        try {
            const client = new AuthSequenceTestClient("invalid-hex");
            client.setBroadcastSocket({
                send: vi.fn((_buf: Buffer, _port: number, _addr: string, cb: () => void) => cb()),
            });

            // cmd=1を受信してpendingに遷移 (sendAuthSequenceはxteaCiphertext不正で即リセットされるが
            // タイムアウトタイマーは先に設定される)
            const appData = createAppDataPacket(1, 0xdeec6dfc);
            client.callHandleAuth(appData);

            // sendAuthSequenceが非同期でリセットするのを待つ
            await flushAsync();
            expect(client.authenticationState).toBe("none");
        } finally {
            vi.useRealTimers();
        }
    });

    it("pending状態で5秒経過するとタイムアウトしてリセットされる", async () => {
        vi.useFakeTimers();
        try {
            const client = new AuthSequenceTestClient();
            // sendAuthSequenceをモックして成功させる (pendingのまま残る状況を再現)
            client.setSendAuthSequenceMock(vi.fn().mockResolvedValue(undefined));
            client.setBroadcastSocket({
                send: vi.fn((_buf: Buffer, _port: number, _addr: string, cb: () => void) => cb()),
            });

            const appData = createAppDataPacket(1, 0xdeec6dfc);
            client.callHandleAuth(appData);
            expect(client.authenticationState).toBe("pending");

            // 5秒経過でタイムアウト
            await vi.advanceTimersByTimeAsync(5000);
            expect(client.authenticationState).toBe("none");
            expect(client.getSessionToken()).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    it("認証成功時にタイムアウトタイマーがクリアされる", async () => {
        vi.useFakeTimers();
        try {
            const client = new AuthSequenceTestClient();
            client.setSendAuthSequenceMock(vi.fn().mockResolvedValue(undefined));
            client.setBroadcastSocket({
                send: vi.fn((_buf: Buffer, _port: number, _addr: string, cb: () => void) => cb()),
            });

            const appData = createAppDataPacket(1, 0xdeec6dfc);
            client.callHandleAuth(appData);
            expect(client.authenticationState).toBe("pending");

            // 認証成功
            const errorPkt = createErrorPacket(0xff, 0xff, 0xff);
            client.callHandleAuth(errorPkt);
            expect(client.authenticationState).toBe("authenticated");

            // 5秒経過してもnoneにリセットされない
            await vi.advanceTimersByTimeAsync(5000);
            expect(client.authenticationState).toBe("authenticated");
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("TCNetApplicationDataPacket.write() payload長検証", () => {
    it("payloadが12バイト以外の場合write()がassertエラーを投げる", () => {
        const buffer = Buffer.alloc(62);
        writeValidHeader(buffer, TCNetMessageType.ApplicationData);
        const packet = new TCNetApplicationDataPacket();
        packet.buffer = buffer;
        packet.header = createHeader(buffer);
        packet.dest = 0xffff;
        packet.subType = 0x14;
        packet.field1 = 1;
        packet.field2 = 1;
        packet.fixedValue = 0x0aa0;
        packet.cmd = 0;
        packet.listenerPort = 65023;
        packet.token = 0;
        packet.payload = Buffer.alloc(8); // 12バイト以外

        expect(() => packet.write()).toThrow("ApplicationData payload must be 12 bytes");
    });
});

describe("sendAuthSequence XTEA暗号文バイトリバース", () => {
    it("Windows Bridge判定時に暗号文がバイトリバースされて送信される", async () => {
        const client = new AuthSequenceTestClient("8ee0dc051b1ddf8b");
        client.setSessionToken(0xdeec6dfc);
        client.setAuthState("pending");
        client.setSelectedAdapter(createAdapter("192.168.0.10"));

        const sentBuffers: Buffer[] = [];
        client.setBroadcastSocket({
            send: vi.fn((buf: Buffer, _port: number, _addr: string, cb: (err: Error | null) => void) => {
                sentBuffers.push(Buffer.from(buf));
                cb(null);
            }),
        });
        client.setBroadcastAddress("255.255.255.255");

        // BridgeをWindowsとして事前設定する
        client.setBridgeIsWindows(true);

        await client.callSendAuthSequence();

        // 2番目のパケット (cmd=2) のpayloadを検査する
        expect(sentBuffers.length).toBe(2);
        const authBuf = sentBuffers[1];
        // payloadはoffset 50から12バイト
        const payload = authBuf.subarray(50, 62);
        // auth[4:12]がリバースされた暗号文であることを確認
        const reversedCiphertext = Buffer.from("8ee0dc051b1ddf8b", "hex").reverse();
        expect(payload.subarray(4, 12)).toEqual(reversedCiphertext);
    });

    it("non-Windows Bridge判定時に暗号文がそのまま送信される", async () => {
        const client = new AuthSequenceTestClient("8ee0dc051b1ddf8b");
        client.setSessionToken(0xdeec6dfc);
        client.setAuthState("pending");
        client.setSelectedAdapter(createAdapter("192.168.0.10"));

        const sentBuffers: Buffer[] = [];
        client.setBroadcastSocket({
            send: vi.fn((buf: Buffer, _port: number, _addr: string, cb: (err: Error | null) => void) => {
                sentBuffers.push(Buffer.from(buf));
                cb(null);
            }),
        });
        client.setBroadcastAddress("255.255.255.255");

        // Bridgeをnon-Windowsとして事前設定する
        client.setBridgeIsWindows(false);

        await client.callSendAuthSequence();

        expect(sentBuffers.length).toBe(2);
        const authBuf = sentBuffers[1];
        const payload = authBuf.subarray(50, 62);
        const originalCiphertext = Buffer.from("8ee0dc051b1ddf8b", "hex");
        expect(payload.subarray(4, 12)).toEqual(originalCiphertext);
    });

    it("resetAuthSessionでbridgeIsWindowsキャッシュがクリアされる", () => {
        const client = new AuthSequenceTestClient();
        client.setBridgeIsWindows(true);
        client.setAuthState("pending");

        client.callResetAuthSession();

        expect(client.getBridgeIsWindows()).toBeNull();
    });
});

describe("sendAuthCommandOnly (authenticated状態でのcmd=1応答)", () => {
    function makeClient(): AuthSequenceTestClient {
        const client = new AuthSequenceTestClient();
        client.setSessionToken(0xb3fe319e);
        client.setAuthState("authenticated");
        client.setBridgeIsWindows(false);
        client.setSelectedAdapter(createAdapter("192.168.0.10"));
        client.setBroadcastAddress("255.255.255.255");
        return client;
    }

    it("cmd=2 (auth) だけを送信する (cmd=0 helloは送らない)", async () => {
        const client = makeClient();

        const sentBuffers: Buffer[] = [];
        client.setBroadcastSocket({
            send: vi.fn((buf: Buffer, _port: number, _addr: string, cb: (err: Error | null) => void) => {
                sentBuffers.push(Buffer.from(buf));
                cb(null);
            }),
        });

        await client.callSendAuthCommandOnly();

        // sendAuthSequence とは異なり hello + auth ではなく auth 1 つだけ
        expect(sentBuffers.length).toBe(1);
        // cmd byte はAppDataボディのoffset 42 (cmd=2)
        expect(sentBuffers[0][APPDATA_CMD_OFFSET]).toBe(2);
    });

    it("sessionToken=nullのときは何もしない (authenticated状態を壊さない)", async () => {
        const client = makeClient();
        client.setSessionToken(null);

        const send = vi.fn((_buf: Buffer, _port: number, _addr: string, cb: () => void) => cb());
        client.setBroadcastSocket({ send });

        await client.callSendAuthCommandOnly();

        expect(send).not.toHaveBeenCalled();
        expect(client.authenticationState).toBe("authenticated");
    });

    it("handleAuthPacketがauthenticated状態のcmd=1でsendAuthCommandOnlyを起動する", async () => {
        const client = makeClient();

        const sentBuffers: Buffer[] = [];
        client.setBroadcastSocket({
            send: vi.fn((buf: Buffer, _port: number, _addr: string, cb: (err: Error | null) => void) => {
                sentBuffers.push(Buffer.from(buf));
                cb(null);
            }),
        });

        const appData = createAppDataPacket(1, 0xb3fe319e);
        client.callHandleAuth(appData);

        // sendAuthCommandOnly は fire-and-forget なので microtask を回して完了待ち
        await flushAsync();

        expect(sentBuffers.length).toBe(1);
        expect(sentBuffers[0][APPDATA_CMD_OFFSET]).toBe(2);
        // state は authenticated のまま維持される
        expect(client.authenticationState).toBe("authenticated");
    });

    it("cmd=1のtokenが既存と異なる場合はsessionTokenを更新する", () => {
        const client = makeClient();
        client.setSessionToken(0xaaaaaaaa);
        client.setBroadcastSocket({
            send: vi.fn((_buf: Buffer, _port: number, _addr: string, cb: () => void) => cb()),
        });

        // Bridgeが別tokenを送ってきた想定 (SKの実測では常に同一tokenだが防御的に更新する)
        const appData = createAppDataPacket(1, 0xbbbbbbbb);
        client.callHandleAuth(appData);

        // token更新はhandleAuthPacket内で同期的に行われるため即座に検証できる
        expect(client.getSessionToken()).toBe(0xbbbbbbbb);
    });

    it("連続的なcmd=1到着でも状態が一貫して維持される", async () => {
        // Bridgeがfloodモードに入った場合のシミュレーション。
        // 10回の連続cmd=1に対して全て正常応答することを検証する。
        const client = makeClient();

        const sentBuffers: Buffer[] = [];
        client.setBroadcastSocket({
            send: vi.fn((buf: Buffer, _port: number, _addr: string, cb: (err: Error | null) => void) => {
                sentBuffers.push(Buffer.from(buf));
                cb(null);
            }),
        });

        // 10回連続でcmd=1を受信する
        for (let i = 0; i < 10; i++) {
            client.callHandleAuth(createAppDataPacket(1, 0xb3fe319e));
        }

        await flushAsync();

        // 10 回全て cmd=2 で応答していること
        expect(sentBuffers.length).toBe(10);
        for (const buf of sentBuffers) {
            expect(buf[APPDATA_CMD_OFFSET]).toBe(2);
        }
        // state は authenticated を維持、sessionToken は不変、失敗カウンタはゼロ
        expect(client.authenticationState).toBe("authenticated");
        expect(client.getSessionToken()).toBe(0xb3fe319e);
        expect(client.getAuthResponseFailureCount()).toBe(0);
    });
});

describe("sendAuthCommandOnly 連続失敗カウンタ", () => {
    function makeClient(logger?: TCNetLogger): AuthSequenceTestClient {
        const client = new AuthSequenceTestClient();
        client.setSessionToken(0xb3fe319e);
        client.setAuthState("authenticated");
        client.setBridgeIsWindows(false);
        client.setSelectedAdapter(createAdapter("192.168.0.10"));
        client.setBroadcastAddress("255.255.255.255");
        if (logger) {
            client.setLogger(logger);
        }
        return client;
    }

    it("失敗後に成功するとauthResponseFailureCountが0にリセットされる", async () => {
        // Arrange
        const client = makeClient();
        // 1 回目は失敗、2 回目は成功するソケット
        let callCount = 0;
        client.setBroadcastSocket({
            send: vi.fn((_buf: Buffer, _port: number, _addr: string, cb: (err: Error | null) => void) => {
                callCount++;
                if (callCount === 1) {
                    cb(new Error("send failed"));
                } else {
                    cb(null);
                }
            }),
        });

        // Act: 1 回目の cmd=1 受信 (失敗)
        const appData = createAppDataPacket(1, 0xb3fe319e);
        client.callHandleAuth(appData);
        await flushAsync();

        // 失敗したのでカウンタは 1 になっているはず
        expect(client.getAuthResponseFailureCount()).toBe(1);
        // 閾値未満なので authenticated のまま
        expect(client.authenticationState).toBe("authenticated");

        // Act: 2 回目の cmd=1 受信 (成功)
        client.callHandleAuth(appData);
        await flushAsync();

        // Assert: 成功したので 0 にリセットされている
        expect(client.getAuthResponseFailureCount()).toBe(0);
        expect(client.authenticationState).toBe("authenticated");
    });

    it("1回失敗してもauthenticated状態が維持される(閾値未満)", async () => {
        // Arrange
        const client = makeClient();
        client.setBroadcastSocket({
            send: vi.fn((_buf: Buffer, _port: number, _addr: string, cb: (err: Error | null) => void) => {
                cb(new Error("send failed"));
            }),
        });

        // Act: 1 回だけ失敗させる
        const appData = createAppDataPacket(1, 0xb3fe319e);
        client.callHandleAuth(appData);
        await flushAsync();

        // Assert: 閾値 (2) 未満なのでセッションはリセットされない
        expect(client.getAuthResponseFailureCount()).toBe(1);
        expect(client.authenticationState).toBe("authenticated");
        expect(client.getSessionToken()).toBe(0xb3fe319e);
    });

    it("2回連続失敗するとresetAuthSessionが呼ばれauthStateがnoneになる", async () => {
        // Arrange
        const client = makeClient();
        client.setBroadcastSocket({
            send: vi.fn((_buf: Buffer, _port: number, _addr: string, cb: (err: Error | null) => void) => {
                cb(new Error("send failed"));
            }),
        });

        // Act: 2 回連続失敗させる
        const appData = createAppDataPacket(1, 0xb3fe319e);
        client.callHandleAuth(appData);
        await flushAsync();
        // 1 回目失敗後は authenticated 維持
        expect(client.authenticationState).toBe("authenticated");
        expect(client.getAuthResponseFailureCount()).toBe(1);

        client.callHandleAuth(appData);
        await flushAsync();

        // Assert: 閾値到達で resetAuthSession が呼ばれセッションリセット
        expect(client.authenticationState).toBe("none");
        expect(client.getSessionToken()).toBeNull();
        // resetAuthSession はカウンタも 0 に戻す
        expect(client.getAuthResponseFailureCount()).toBe(0);
        // 部分リセットなので bridgeIsWindows キャッシュは保持される (無駄な再 ping を避ける)
        expect(client.getBridgeIsWindows()).toBe(false);
    });

    it("prepareAuthPayloadのガード失敗時はauthResponseFailureCountが変化しない", async () => {
        // Arrange: _selectedAdapter を null にすると prepareAuthPayload が
        // clientIp 取得に失敗して null を返す (実送信は行われない)
        const client = makeClient();
        client.setSelectedAdapter(null);
        client.setAuthResponseFailureCount(1);
        const send = vi.fn((_buf: Buffer, _port: number, _addr: string, cb: (err: Error | null) => void) => {
            cb(null);
        });
        client.setBroadcastSocket({ send });

        // Act
        const appData = createAppDataPacket(1, 0xb3fe319e);
        client.callHandleAuth(appData);
        await flushAsync();

        // Assert: 送信されていないので failureCount は変化しない (リセットも増加もしない)
        expect(send).not.toHaveBeenCalled();
        expect(client.getAuthResponseFailureCount()).toBe(1);
        expect(client.authenticationState).toBe("authenticated");
    });

    it("authenticated状態で異なるtokenのcmd=1を受信するとlogger.warnが呼ばれる", async () => {
        // Arrange
        const logger = {
            error: vi.fn(),
            warn: vi.fn(),
            debug: vi.fn(),
        };
        const client = makeClient(logger);
        client.setBroadcastSocket({
            send: vi.fn((_buf: Buffer, _port: number, _addr: string, cb: (err: Error | null) => void) => {
                cb(null);
            }),
        });

        // Act: 既存 token (0xB3FE319E) と異なる token で cmd=1 を受信
        const appData = createAppDataPacket(1, 0xcafebabe);
        client.callHandleAuth(appData);
        await flushAsync();

        // Assert: token 変化を warn で記録している
        expect(logger.warn).toHaveBeenCalledTimes(1);
        const warnMessage = logger.warn.mock.calls[0][0] as string;
        expect(warnMessage).toContain("Auth token changed unexpectedly");
        expect(warnMessage).toContain("0xb3fe319e");
        expect(warnMessage).toContain("0xcafebabe");
        // 実際に sessionToken も更新されている
        expect(client.getSessionToken()).toBe(0xcafebabe);
    });
});

describe("pending状態でのcmd=1再受信 (初回認証中の反応型プロトコル)", () => {
    function makePendingClient(logger?: TCNetLogger): AuthSequenceTestClient {
        const client = new AuthSequenceTestClient();
        client.setSessionToken(0xb3fe319e);
        client.setAuthState("pending");
        client.setBridgeIsWindows(false);
        client.setSelectedAdapter(createAdapter("192.168.0.10"));
        client.setBroadcastAddress("255.255.255.255");
        if (logger) {
            client.setLogger(logger);
        }
        return client;
    }

    it("pending状態でcmd=1を再受信するとcmd=2のみが再送される", async () => {
        const client = makePendingClient();
        const sentBuffers: Buffer[] = [];
        client.setBroadcastSocket({
            send: vi.fn((buf: Buffer, _port: number, _addr: string, cb: (err: Error | null) => void) => {
                sentBuffers.push(Buffer.from(buf));
                cb(null);
            }),
        });

        client.callHandleAuth(createAppDataPacket(1, 0xb3fe319e));
        await flushAsync();

        expect(sentBuffers.length).toBe(1);
        expect(sentBuffers[0][APPDATA_CMD_OFFSET]).toBe(2);
        expect(client.authenticationState).toBe("pending");
        expect(client.getSessionToken()).toBe(0xb3fe319e);
    });

    it("pending中の連続cmd=1で毎回cmd=2を応答する (Bridge flood対応)", async () => {
        const client = makePendingClient();
        const sentBuffers: Buffer[] = [];
        client.setBroadcastSocket({
            send: vi.fn((buf: Buffer, _port: number, _addr: string, cb: (err: Error | null) => void) => {
                sentBuffers.push(Buffer.from(buf));
                cb(null);
            }),
        });

        for (let i = 0; i < 10; i++) {
            client.callHandleAuth(createAppDataPacket(1, 0xb3fe319e));
        }
        await flushAsync();

        expect(sentBuffers.length).toBe(10);
        for (const buf of sentBuffers) {
            expect(buf[APPDATA_CMD_OFFSET]).toBe(2);
        }
        expect(client.authenticationState).toBe("pending");
        expect(client.getSessionToken()).toBe(0xb3fe319e);
    });

    it("pending中のtoken変化時は初回認証フロー(sendAuthSequence)が再起動される", async () => {
        const client = makePendingClient();
        const sendSequenceMock = vi.fn().mockResolvedValue(undefined);
        client.setSendAuthSequenceMock(sendSequenceMock);
        client.setBroadcastSocket({
            send: vi.fn((_buf: Buffer, _port: number, _addr: string, cb: (err: Error | null) => void) => {
                cb(null);
            }),
        });

        client.callHandleAuth(createAppDataPacket(1, 0xcafebabe));
        await flushAsync();

        expect(sendSequenceMock).toHaveBeenCalledTimes(1);
        expect(client.getSessionToken()).toBe(0xcafebabe);
        expect(client.authenticationState).toBe("pending");
    });

    it("pending中の同一tokenではsendAuthSequenceは呼ばれない (高速パス)", async () => {
        const client = makePendingClient();
        const sendSequenceMock = vi.fn().mockRejectedValue(new Error("should not be called"));
        client.setSendAuthSequenceMock(sendSequenceMock);
        client.setBroadcastSocket({
            send: vi.fn((_buf: Buffer, _port: number, _addr: string, cb: (err: Error | null) => void) => {
                cb(null);
            }),
        });

        client.callHandleAuth(createAppDataPacket(1, 0xb3fe319e));
        await flushAsync();

        expect(sendSequenceMock).not.toHaveBeenCalled();
    });

    it("pending中のtoken変化時は古いauthTimeoutIdがクリアされ新タイマーが起動する", async () => {
        // 古いタイマーが新世代を早期リセットする Codex#2 回帰テスト
        vi.useFakeTimers();
        try {
            const client = new AuthSequenceTestClient();
            const sendSequenceMock = vi.fn().mockResolvedValue(undefined);
            client.setSendAuthSequenceMock(sendSequenceMock);
            client.setBridgeIsWindows(false);
            client.setSelectedAdapter(createAdapter("192.168.0.10"));
            client.setBroadcastAddress("255.255.255.255");
            client.setBroadcastSocket({
                send: vi.fn((_buf: Buffer, _port: number, _addr: string, cb: () => void) => cb()),
            });

            // 初回 cmd=1 (token A): pending + 5秒タイマー起動
            client.callHandleAuth(createAppDataPacket(1, 0xaaaaaaaa));
            expect(client.authenticationState).toBe("pending");
            expect(client.getSessionToken()).toBe(0xaaaaaaaa);

            // 4.9 秒経過 (古いタイマー発火直前)
            await vi.advanceTimersByTimeAsync(4900);
            expect(client.authenticationState).toBe("pending");

            // token B の cmd=1 受信: 認証世代を刷新
            client.callHandleAuth(createAppDataPacket(1, 0xbbbbbbbb));
            await flushAsync();
            expect(client.getSessionToken()).toBe(0xbbbbbbbb);
            expect(client.authenticationState).toBe("pending");
            expect(sendSequenceMock).toHaveBeenCalledTimes(2);

            // さらに 0.2 秒経過 (古いタイマーなら 5.1 秒で発火するタイミング)
            await vi.advanceTimersByTimeAsync(200);
            expect(client.authenticationState).toBe("pending");
            expect(client.getSessionToken()).toBe(0xbbbbbbbb);

            // 新タイマーの 5秒後に発火すると state=none になる (残り 4.8 秒)
            await vi.advanceTimersByTimeAsync(4800);
            expect(client.authenticationState).toBe("none");
            expect(client.getSessionToken()).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    it("pending中のcmd=2送信失敗でもpending状態とsessionTokenは維持される", async () => {
        const client = makePendingClient();
        client.setBroadcastSocket({
            send: vi.fn((_buf: Buffer, _port: number, _addr: string, cb: (err: Error | null) => void) => {
                cb(new Error("send failed"));
            }),
        });

        client.callHandleAuth(createAppDataPacket(1, 0xb3fe319e));
        await flushAsync();

        expect(client.authenticationState).toBe("pending");
        expect(client.getSessionToken()).toBe(0xb3fe319e);
        // pending 中の失敗は継続認証フローとは独立で failureCount に影響しない
        expect(client.getAuthResponseFailureCount()).toBe(0);
    });

    it("authenticated遷移後にsendAuthSequenceが遅延rejectしても認証済みセッションは破壊されない", async () => {
        // Codex P1#1 回帰: 新 pending fast-path で sendAuthCommandOnly が
        // Error(0xffffff) 受信により state=authenticated に遷移した後、
        // 元の sendAuthSequence() promise が遅延 reject した場合、
        // handleInitialAuthRequest の catch が token 一致だけで resetAuthSession を
        // 呼んでしまうと authenticated セッションを破壊してしまう。
        // 修正後は state === "pending" のチェックも追加して破壊を防ぐ。
        vi.useFakeTimers();
        try {
            const client = new AuthSequenceTestClient();
            client.setSelectedAdapter(createAdapter("192.168.0.10"));
            client.setBroadcastAddress("255.255.255.255");
            client.setBroadcastSocket({
                send: vi.fn((_buf: Buffer, _port: number, _addr: string, cb: () => void) => cb()),
            });

            // sendAuthSequence が prepareAuthPayload 内の detectBridgeIsWindows await で停止するようにする
            let rejectDetection!: (reason: Error) => void;
            const detectionPromise = new Promise<boolean>((_resolve, reject) => {
                rejectDetection = reject;
            });
            vi.spyOn(
                client as unknown as { detectBridgeIsWindows: () => Promise<boolean> },
                "detectBridgeIsWindows",
            ).mockReturnValue(detectionPromise);

            // 初回 cmd=1 (token A): pending + sendAuthSequence 起動
            client.callHandleAuth(createAppDataPacket(1, 0xaaaaaaaa));
            expect(client.authenticationState).toBe("pending");
            await vi.advanceTimersByTimeAsync(50);
            await flushAsync();
            // sendAuthSequence は detectBridgeIsWindows の await で停止中

            // Error(0xffffff) 受信で authenticated に遷移 (他経路で認証が完了した状況を再現)
            client.callHandleAuth(createErrorPacket(0xff, 0xff, 0xff));
            expect(client.authenticationState).toBe("authenticated");

            // 元の sendAuthSequence を rejection で終わらせる (送信エラー等を模擬)
            rejectDetection(new Error("stale detect rejection"));
            await flushAsync(10);

            // authenticated が維持されていること (catch の pending ガードが機能)
            expect(client.authenticationState).toBe("authenticated");
            expect(client.getSessionToken()).toBe(0xaaaaaaaa);
        } finally {
            vi.useRealTimers();
        }
    });

    it("pending中のtoken変化時は旧sendAuthSequenceが新世代のstateを破壊しない (stale promise race)", async () => {
        // stale Promise race の真の回帰検知テスト。
        // detectBridgeIsWindows を controllable promise でモックし、旧 sendAuthSequence
        // を prepareAuthPayload 内部の await で確実に停止させた状態で token を切り替える。
        // これにより旧 run の prepareAuthPayload が null を返す経路に到達し、
        // expectedToken ガードが無いと resetAuthSession() を呼んで新世代の state を破壊する。
        vi.useFakeTimers();
        try {
            const client = new AuthSequenceTestClient();
            client.setSelectedAdapter(createAdapter("192.168.0.10"));
            client.setBroadcastAddress("255.255.255.255");
            client.setBroadcastSocket({
                send: vi.fn((_buf: Buffer, _port: number, _addr: string, cb: () => void) => cb()),
            });

            // detectBridgeIsWindows を手動制御可能な Promise に差し替える
            let resolveDetection!: (value: boolean) => void;
            const detectionPromise = new Promise<boolean>((resolve) => {
                resolveDetection = resolve;
            });
            vi.spyOn(
                client as unknown as { detectBridgeIsWindows: () => Promise<boolean> },
                "detectBridgeIsWindows",
            ).mockReturnValue(detectionPromise);

            // 初回 cmd=1 (token A): handleInitialAuthRequest → sendAuthSequence 起動
            client.callHandleAuth(createAppDataPacket(1, 0xaaaaaaaa));
            expect(client.getSessionToken()).toBe(0xaaaaaaaa);
            expect(client.authenticationState).toBe("pending");

            // cmd=0 送信の microtask を消化し、50ms wait を進めて prepareAuthPayload 内の
            // detectBridgeIsWindows await まで到達させる
            await vi.advanceTimersByTimeAsync(50);
            await flushAsync();

            // token B の cmd=1 受信: handlePendingReauthRequest → resetAuthSession(true)
            //   + handleInitialAuthRequest(B) で新世代開始。
            //   新 sendAuthSequence も detectBridgeIsWindows の同じ pending promise を待機する
            client.callHandleAuth(createAppDataPacket(1, 0xbbbbbbbb));
            expect(client.getSessionToken()).toBe(0xbbbbbbbb);
            expect(client.authenticationState).toBe("pending");

            // 新世代の 50ms wait も消化して detectBridgeIsWindows await まで到達させる
            await vi.advanceTimersByTimeAsync(50);
            await flushAsync();

            // detectionPromise を resolve し、旧・新の両方を再開させる
            //   旧 run: tokenBeforePing=A !== sessionToken=B → prepareAuthPayload null 返却
            //            → expectedToken ガードで resetAuthSession を呼ばずに return
            //   新 run: tokenBeforePing=B === sessionToken=B → payload 生成 → cmd=2 送信
            resolveDetection(false);
            await flushAsync(10);

            // 新世代の state が維持されていることを検証 (旧 run が resetAuthSession を呼ばなかった証左)
            expect(client.getSessionToken()).toBe(0xbbbbbbbb);
            expect(client.authenticationState).toBe("pending");
        } finally {
            vi.useRealTimers();
        }
    });
});
