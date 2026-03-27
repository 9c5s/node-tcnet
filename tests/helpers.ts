import { beforeAll, afterAll } from "vitest";
import * as nw from "../src/network";
import { TCNetClient } from "../src/tcnet";

/**
 * テスト用に最小限の有効なManagementHeaderをBufferに書き込む
 * @param buffer - 書き込み先バッファ
 * @param messageType - メッセージタイプ
 */
export function writeValidHeader(buffer: Buffer, messageType: number): void {
    buffer.writeUInt16LE(1, 0);
    buffer.writeUInt8(3, 2);
    buffer.writeUInt8(5, 3);
    buffer.write("TCN", 4, "ascii");
    buffer.writeUInt8(messageType, 7);
    buffer.write("BRIDGE\x00\x00", 8, "ascii");
    buffer.writeUInt8(42, 16);
    buffer.writeUInt8(0x04, 17);
    buffer.writeUInt16LE(7, 18);
    buffer.writeUInt32LE(0, 20);
}

/**
 * ヘッダーオブジェクト生成ヘルパー
 * @param buffer - バッファ
 */
export function createHeader(buffer: Buffer): nw.TCNetManagementHeader {
    const header = new nw.TCNetManagementHeader(buffer);
    header.minorVersion = 5;
    return header;
}

/**
 * privateメソッドへアクセスするテストヘルパークラス
 */
export class TestTCNetClient extends TCNetClient {
    public simulateUnicast(
        msg: Buffer,
        rinfo = { address: "127.0.0.1", port: 65023, family: "IPv4" as const, size: msg.length },
    ): void {
        (this as any).receiveUnicast(msg, rinfo);
    }
    public simulateConnected(): void {
        (this as any).connected = true;
    }
}

/**
 * TCNET_XTEA_CIPHERTEXT環境変数をテスト間で隔離する。
 * テストファイルのトップレベルで呼び出すこと。
 */
export function isolateXteaEnv(): void {
    const saved = process.env.TCNET_XTEA_CIPHERTEXT;
    beforeAll(() => {
        delete process.env.TCNET_XTEA_CIPHERTEXT;
    });
    afterAll(() => {
        if (saved !== undefined) process.env.TCNET_XTEA_CIPHERTEXT = saved;
        else delete process.env.TCNET_XTEA_CIPHERTEXT;
    });
}
