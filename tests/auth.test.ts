import { describe, it, expect, vi } from "vitest";
import { fnv1aInt32, generateAuthPayload, DATA_HASH } from "../src/auth";
import { TCNetApplicationDataPacket, TCNetErrorPacket, TCNetMessageType } from "../src/network";
import { TCNetClient, TCNetConfiguration } from "../src/tcnet";
import { writeValidHeader, createHeader, isolateXteaEnv } from "./helpers";

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
    it("errorDataにoffset 24以降のバイトが格納される", () => {
        // Arrange
        const buffer = Buffer.alloc(27);
        writeValidHeader(buffer, TCNetMessageType.Error);
        buffer.writeUInt8(0xff, 24);
        buffer.writeUInt8(0xff, 25);
        buffer.writeUInt8(0xff, 26);

        const packet = new TCNetErrorPacket();
        packet.buffer = buffer;
        packet.header = createHeader(buffer);

        // Act
        packet.read();

        // Assert
        expect(packet.errorData.length).toBe(3);
        expect(packet.errorData[0]).toBe(0xff);
        expect(packet.errorData[1]).toBe(0xff);
        expect(packet.errorData[2]).toBe(0xff);
    });

    it("認証失敗のErrorパケット (0xFFFF0D) をパースする", () => {
        // Arrange
        const buffer = Buffer.alloc(27);
        writeValidHeader(buffer, TCNetMessageType.Error);
        buffer.writeUInt8(0xff, 24);
        buffer.writeUInt8(0xff, 25);
        buffer.writeUInt8(0x0d, 26);

        const packet = new TCNetErrorPacket();
        packet.buffer = buffer;
        packet.header = createHeader(buffer);

        // Act
        packet.read();

        // Assert
        expect(packet.errorData[0]).toBe(0xff);
        expect(packet.errorData[1]).toBe(0xff);
        expect(packet.errorData[2]).toBe(0x0d);
    });

    it("write() はエラーを投げる", () => {
        expect(() => new TCNetErrorPacket().write()).toThrow("not supported!");
    });

    it("length() は -1 を返す (可変長)", () => {
        expect(new TCNetErrorPacket().length()).toBe(-1);
    });

    it("type() は TCNetMessageType.Error(13) を返す", () => {
        expect(new TCNetErrorPacket().type()).toBe(13);
    });
});

// handleAuthPacketとsendAuthSequenceにアクセスするテストヘルパー
const MASTER_RINFO = { address: "192.168.0.100", port: 65207, family: "IPv4", size: 0 };

class AuthTestClient extends TCNetClient {
    constructor() {
        super();
        // xteaCiphertextを設定して認証を有効化する
        (this as any).config.xteaCiphertext = "0000000000000000";
        // sendAuthSequenceをモックしてネットワーク操作を回避する
        (this as any).sendAuthSequence = vi.fn().mockResolvedValue(undefined);
        // serverをMasterのrinfoに設定する
        (this as any).server = { address: MASTER_RINFO.address, port: MASTER_RINFO.port };
    }
    public callHandleAuth(packet: any, rinfo = MASTER_RINFO): void {
        (this as any).handleAuthPacket(packet, rinfo);
    }
    public getSessionToken(): number | null {
        return (this as any).sessionToken;
    }
    public setAuthState(state: string): void {
        (this as any)._authState = state;
    }
    public clearXteaCiphertext(): void {
        (this as any).config.xteaCiphertext = undefined;
    }
}

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

function createErrorPacket(b0: number, b1: number, b2: number): TCNetErrorPacket {
    const buffer = Buffer.alloc(27);
    writeValidHeader(buffer, TCNetMessageType.Error);
    buffer.writeUInt8(b0, 24);
    buffer.writeUInt8(b1, 25);
    buffer.writeUInt8(b2, 26);
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

    it("xteaCiphertext未設定の場合は何も処理しない", () => {
        const client = new AuthTestClient();
        client.clearXteaCiphertext();
        const appData = createAppDataPacket(1, 0x12345678);

        client.callHandleAuth(appData);

        expect(client.authenticationState).toBe("none");
        expect(client.getSessionToken()).toBeNull();
    });

    it("authStateがnone以外のときAppData cmd=1を無視する", () => {
        const client = new AuthTestClient();
        client.setAuthState("authenticated");
        const appData = createAppDataPacket(1, 0x12345678);

        client.callHandleAuth(appData);

        // 既にauthenticatedなので変化しない
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
        (client as any).server = null;
        const appData = createAppDataPacket(1, 0xdeec6dfc);

        client.callHandleAuth(appData);

        expect(client.authenticationState).toBe("none");
        expect(client.getSessionToken()).toBeNull();
    });
});

// sendAuthSequenceをモックせずに状態リセット動作を検証するヘルパー
class AuthSequenceTestClient extends TCNetClient {
    constructor(xteaCiphertext = "87d32058a31992c2") {
        super();
        (this as any).config.xteaCiphertext = xteaCiphertext;
        (this as any).server = { address: MASTER_RINFO.address, port: MASTER_RINFO.port };
    }
    public getSessionToken(): number | null {
        return (this as any).sessionToken;
    }
    public setSessionToken(token: number): void {
        (this as any).sessionToken = token;
    }
    public setAuthState(state: string): void {
        (this as any)._authState = state;
    }
    public callHandleAuth(packet: any, rinfo = MASTER_RINFO): void {
        (this as any).handleAuthPacket(packet, rinfo);
    }
    public setBroadcastSocket(socket: any): void {
        (this as any).broadcastSocket = socket;
    }
    public setSelectedAdapter(adapter: any): void {
        (this as any)._selectedAdapter = adapter;
    }
}

describe("sendAuthSequence 状態リセット", () => {
    it("xteaCiphertextが不正な場合、authStateとsessionTokenがリセットされる", async () => {
        const client = new AuthSequenceTestClient("invalid-hex");
        client.setSessionToken(0xdeec6dfc);
        client.setAuthState("pending");
        client.setBroadcastSocket({
            send: vi.fn((_buf: Buffer, _port: number, _addr: string, cb: () => void) => cb()),
        });

        // sendAuthSequenceを直接呼び出す
        await (client as any).sendAuthSequence();

        expect(client.authenticationState).toBe("none");
        expect(client.getSessionToken()).toBeNull();
    });

    it("broadcastSocketがnullの場合、authStateとsessionTokenがリセットされる", async () => {
        const client = new AuthSequenceTestClient();
        client.setSessionToken(0xdeec6dfc);
        client.setAuthState("pending");
        // broadcastSocket未設定 (null)

        await (client as any).sendAuthSequence();

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
        (client as any).config.broadcastAddress = "255.255.255.255";

        // handleAuthPacket経由のcatchハンドラで呼ばれることを検証
        const appData = createAppDataPacket(1, 0xdeec6dfc);
        // authStateをnoneに戻してcmd=1受付条件を満たす
        client.setAuthState("none");
        (client as any).sessionToken = null;
        client.callHandleAuth(appData);

        // catchハンドラは非同期なのでtick待ち
        await vi.waitFor(() => {
            expect(client.authenticationState).toBe("none");
            expect(client.getSessionToken()).toBeNull();
        });
    });

    it("状態リセット後に再度cmd=1を受信すると認証を再試行できる", async () => {
        const client = new AuthSequenceTestClient("invalid-hex");
        client.setBroadcastSocket({
            send: vi.fn((_buf: Buffer, _port: number, _addr: string, cb: () => void) => cb()),
        });

        // 1回目: cmd=1を受信 → sendAuthSequence → xteaCiphertext不正でリセット
        const appData1 = createAppDataPacket(1, 0xaabbccdd);
        client.callHandleAuth(appData1);
        await vi.waitFor(() => {
            expect(client.authenticationState).toBe("none");
        });
        expect(client.getSessionToken()).toBeNull();

        // 2回目: 再度cmd=1を受信 → 新しいトークンで再試行される
        const appData2 = createAppDataPacket(1, 0x11223344);
        client.callHandleAuth(appData2);
        // sendAuthSequenceが呼ばれてpendingになった後、xteaCiphertext不正でリセットされる
        await vi.waitFor(() => {
            expect(client.authenticationState).toBe("none");
        });
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
});
