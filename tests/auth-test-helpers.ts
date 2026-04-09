import type { RemoteInfo, Socket } from "dgram";
import { vi } from "vitest";
import type { NetworkAdapterInfo } from "../src/utils";
import type { AuthState } from "../src/auth";
import { TCNetClient, type TCNetLogger } from "../src/tcnet";
import type { TCNetApplicationDataPacket, TCNetErrorPacket } from "../src/network";

/** テストで使用する Master 側 RemoteInfo の共通値 */
export const MASTER_RINFO: RemoteInfo = {
    address: "192.168.0.100",
    port: 65207,
    family: "IPv4",
    size: 0,
};

/**
 * TCNetApplicationDataPacket の cmd バイト位置
 *
 * ManagementHeader (24 byte) + AppData body (dest + subType + field1 + field2 +
 * fixedValue 6 bytes + 2 bytes subType の後 + padding) の後に cmd が配置される。
 * 送信バッファから cmd の値を直接読み取る際に使用する。
 */
export const APPDATA_CMD_OFFSET = 42;

/**
 * microtask キューを複数回フラッシュして非同期チェーンの完了を待つ
 *
 * handleAuthPacket 内の `.then()/.catch()` チェーンや、sendAuthSequence/
 * sendAuthCommandOnly が返す Promise の解決を決定的に待つために使用する。
 * `vi.waitFor()` のポーリングに依存しないため、CI 環境でのフレイキーを回避できる。
 * @param iterations - フラッシュする microtask の回数 (既定値は5回、通常のチェーンに十分)
 */
export async function flushAsync(iterations = 5): Promise<void> {
    for (let i = 0; i < iterations; i++) {
        await Promise.resolve();
    }
}

/**
 * 単一 IPv4 アドレスを持つテスト用ネットワークアダプタを生成する
 * @param ip - アダプタに割り当てる IPv4 アドレス
 */
export function createAdapter(ip: string): NetworkAdapterInfo {
    return {
        name: "test0",
        addresses: [
            {
                address: ip,
                netmask: "255.255.255.0",
                family: "IPv4" as const,
                mac: "00:00:00:00:00:00",
                internal: false,
                cidr: `${ip}/24`,
            },
        ],
    };
}

/**
 * handleAuthPacket の動作検証用テストヘルパー
 *
 * sendAuthSequence をコンストラクタでモックし、実際のネットワーク操作を回避する。
 * handleAuthPacket の分岐や状態遷移を検証する用途向けである。
 */
export class AuthTestClient extends TCNetClient {
    constructor() {
        super();
        this.config.xteaCiphertext = "0000000000000000";
        // sendAuthSequence をモックしてネットワーク操作を回避する
        this.sendAuthSequence = vi.fn().mockResolvedValue(undefined);
        this.server = { ...MASTER_RINFO };
    }

    /**
     * handleAuthPacket を外部から呼び出す
     * @param packet - 受信パケット
     * @param rinfo - 送信元情報 (省略時は MASTER_RINFO)
     */
    public callHandleAuth(
        packet: TCNetApplicationDataPacket | TCNetErrorPacket,
        rinfo: RemoteInfo = MASTER_RINFO,
    ): void {
        this.handleAuthPacket(packet, rinfo);
    }

    public getSessionToken(): number | null {
        return this.sessionToken;
    }

    public setSessionToken(token: number | null): void {
        this.sessionToken = token;
    }

    public setAuthState(state: AuthState): void {
        this._authState = state;
    }

    public clearXteaCiphertext(): void {
        this.config.xteaCiphertext = undefined;
    }

    public clearServer(): void {
        this.server = null;
    }
}

/**
 * sendAuthSequence/sendAuthCommandOnly 自体の動作検証用テストヘルパー
 *
 * sendAuthSequence をモックしないため、broadcastSocket 等のネットワーク依存を
 * 個別に差し込んでフルフロー検証ができる。
 */
export class AuthSequenceTestClient extends TCNetClient {
    constructor(xteaCiphertext = "8ee0dc051b1ddf8b") {
        super();
        this.config.xteaCiphertext = xteaCiphertext;
        this.server = { ...MASTER_RINFO };
    }

    public getSessionToken(): number | null {
        return this.sessionToken;
    }

    public setSessionToken(token: number | null): void {
        this.sessionToken = token;
    }

    public setAuthState(state: AuthState): void {
        this._authState = state;
    }

    public callHandleAuth(
        packet: TCNetApplicationDataPacket | TCNetErrorPacket,
        rinfo: RemoteInfo = MASTER_RINFO,
    ): void {
        this.handleAuthPacket(packet, rinfo);
    }

    public setBroadcastSocket(socket: Socket | null): void {
        this.broadcastSocket = socket;
    }

    public setSelectedAdapter(adapter: NetworkAdapterInfo | null): void {
        this._selectedAdapter = adapter;
    }

    public callSendAuthSequence(): Promise<void> {
        return this.sendAuthSequence();
    }

    public callSendAuthCommandOnly(): Promise<boolean> {
        return this.sendAuthCommandOnly();
    }

    public callDetectBridgeIsWindows(): Promise<boolean> {
        return this.detectBridgeIsWindows();
    }

    public callResetAuthSession(): void {
        this.resetAuthSession();
    }

    public getBridgeIsWindows(): boolean | null {
        return this.bridgeIsWindows;
    }

    public setBridgeIsWindows(value: boolean | null): void {
        this.bridgeIsWindows = value;
    }

    public setServer(server: RemoteInfo | null): void {
        this.server = server;
    }

    public setBroadcastAddress(address: string): void {
        this.config.broadcastAddress = address;
    }

    public setLogger(logger: TCNetLogger | null): void {
        this.config.logger = logger;
    }

    public getAuthResponseFailureCount(): number {
        return this.authResponseFailureCount;
    }

    public setAuthResponseFailureCount(count: number): void {
        this.authResponseFailureCount = count;
    }

    /**
     * 既存テストの sendAuthSequence 差し替えパターン向けヘルパー
     * @param mock - 差し替え先のモック関数
     */
    public setSendAuthSequenceMock(mock: () => Promise<void>): void {
        this.sendAuthSequence = mock;
    }
}
