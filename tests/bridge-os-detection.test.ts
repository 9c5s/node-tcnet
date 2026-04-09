import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { isolateXteaEnv } from "./helpers";

// os.platformとchild_process.execFileをモックする
vi.mock("os", async (importOriginal) => {
    const actual = await importOriginal<typeof import("os")>();
    return { ...actual, platform: vi.fn(() => "win32") };
});

vi.mock("child_process", async (importOriginal) => {
    const actual = await importOriginal<typeof import("child_process")>();
    return { ...actual, execFile: vi.fn() };
});

import { platform } from "os";
import { execFile } from "child_process";
import { TCNetClient } from "../src/tcnet";

const platformMock = platform as unknown as Mock;
const execFileMock = execFile as unknown as Mock;

isolateXteaEnv();

const MASTER_RINFO = { address: "192.168.0.100", port: 65207, family: "IPv4", size: 0 };

class BridgeOsTestClient extends TCNetClient {
    constructor() {
        super();
        (this as any).config.xteaCiphertext = "8ee0dc051b1ddf8b";
        (this as any).server = { address: MASTER_RINFO.address, port: MASTER_RINFO.port };
    }
    public callDetectBridgeIsWindows(): Promise<boolean> {
        return (this as any).detectBridgeIsWindows();
    }
    public getBridgeIsWindows(): boolean | null {
        return (this as any).bridgeIsWindows;
    }
    public setBridgeIsWindows(value: boolean | null): void {
        (this as any).bridgeIsWindows = value;
    }
    public setServer(server: any): void {
        (this as any).server = server;
    }
    public setSelectedAdapter(adapter: any): void {
        (this as any)._selectedAdapter = adapter;
    }
}

/**
 * テスト用アダプタ情報を生成する
 * @param ip - IPv4アドレス文字列
 */
function createAdapter(ip: string) {
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
 * execFileモックのコールバックを成功として呼び出すヘルパー
 * @param stdout - 標準出力文字列
 */
function mockExecFileSuccess(stdout: string): void {
    execFileMock.mockImplementation(
        (_cmd: string, _args: string[], _opts: object, cb: (err: Error | null, stdout: string) => void) => {
            cb(null, stdout);
        },
    );
}

/**
 * execFileモックのコールバックをエラーとして呼び出すヘルパー
 * @param error - エラーオブジェクト
 */
function mockExecFileError(error: Error): void {
    execFileMock.mockImplementation(
        (_cmd: string, _args: string[], _opts: object, cb: (err: Error | null, stdout: string) => void) => {
            cb(error, "");
        },
    );
}

describe("detectBridgeIsWindows", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("Bridge IPがクライアントIPと一致しos.platform()がwin32ならtrueを返す", async () => {
        platformMock.mockReturnValue("win32");
        const client = new BridgeOsTestClient();
        client.setServer({ address: "192.168.0.10", port: 65207 });
        client.setSelectedAdapter(createAdapter("192.168.0.10"));

        expect(await client.callDetectBridgeIsWindows()).toBe(true);
        expect(client.getBridgeIsWindows()).toBe(true);
    });

    it("Bridge IPがクライアントIPと一致しos.platform()がdarwinならfalseを返す", async () => {
        platformMock.mockReturnValue("darwin");
        const client = new BridgeOsTestClient();
        client.setServer({ address: "192.168.0.10", port: 65207 });
        client.setSelectedAdapter(createAdapter("192.168.0.10"));

        expect(await client.callDetectBridgeIsWindows()).toBe(false);
        expect(client.getBridgeIsWindows()).toBe(false);
    });

    it("リモートBridgeでTTL=128ならWindowsと判定する", async () => {
        platformMock.mockReturnValue("win32");
        mockExecFileSuccess("Reply from 192.168.0.100: bytes=32 time<1ms TTL=128\n");
        const client = new BridgeOsTestClient();
        client.setSelectedAdapter(createAdapter("192.168.0.10"));

        expect(await client.callDetectBridgeIsWindows()).toBe(true);
    });

    it("リモートBridgeでTTL=64ならnon-Windowsと判定する", async () => {
        platformMock.mockReturnValue("darwin");
        mockExecFileSuccess("64 bytes from 192.168.0.100: icmp_seq=1 ttl=64 time=0.5 ms\n");
        const client = new BridgeOsTestClient();
        client.setSelectedAdapter(createAdapter("192.168.0.10"));

        expect(await client.callDetectBridgeIsWindows()).toBe(false);
    });

    it("リモートBridgeでTTL=65ならWindowsと判定する (境界値)", async () => {
        platformMock.mockReturnValue("win32");
        mockExecFileSuccess("Reply from 192.168.0.100: bytes=32 time<1ms TTL=65\n");
        const client = new BridgeOsTestClient();
        client.setSelectedAdapter(createAdapter("192.168.0.10"));

        expect(await client.callDetectBridgeIsWindows()).toBe(true);
    });

    it("ping失敗時はfalseを返しキャッシュしない", async () => {
        platformMock.mockReturnValue("win32");
        mockExecFileError(new Error("ping failed"));
        const client = new BridgeOsTestClient();
        client.setSelectedAdapter(createAdapter("192.168.0.10"));

        expect(await client.callDetectBridgeIsWindows()).toBe(false);
        expect(client.getBridgeIsWindows()).toBeNull();
    });

    it("ping出力にTTLが含まれない場合はfalseを返しキャッシュしない", async () => {
        platformMock.mockReturnValue("win32");
        mockExecFileSuccess("Request timed out.\n");
        const client = new BridgeOsTestClient();
        client.setSelectedAdapter(createAdapter("192.168.0.10"));

        expect(await client.callDetectBridgeIsWindows()).toBe(false);
        expect(client.getBridgeIsWindows()).toBeNull();
    });

    it("結果がキャッシュされ2回目以降はpingを実行しない", async () => {
        platformMock.mockReturnValue("win32");
        mockExecFileSuccess("Reply from 192.168.0.100: bytes=32 time<1ms TTL=128\n");
        const client = new BridgeOsTestClient();
        client.setSelectedAdapter(createAdapter("192.168.0.10"));

        await client.callDetectBridgeIsWindows();
        await client.callDetectBridgeIsWindows();

        expect(execFileMock).toHaveBeenCalledTimes(1);
    });

    it("bridgeIsWindowsキャッシュがnullに戻ると次の呼び出しで再検出される", async () => {
        // resetAuthSession 経由でキャッシュが null に戻るシナリオをシミュレートする。
        platformMock.mockReturnValue("win32");
        mockExecFileSuccess("Reply from 192.168.0.100: bytes=32 time<1ms TTL=128\n");
        const client = new BridgeOsTestClient();
        client.setSelectedAdapter(createAdapter("192.168.0.10"));

        // 初回検出 (ping 実行)
        expect(await client.callDetectBridgeIsWindows()).toBe(true);
        expect(execFileMock).toHaveBeenCalledTimes(1);

        // キャッシュを null に戻す (resetAuthSession 相当)
        client.setBridgeIsWindows(null);

        // 次の呼び出しで ping が再度実行されることを検証する
        expect(await client.callDetectBridgeIsWindows()).toBe(true);
        expect(execFileMock).toHaveBeenCalledTimes(2);
        expect(client.getBridgeIsWindows()).toBe(true);
    });

    it("serverがnullの場合はfalseを返しキャッシュしない", async () => {
        const client = new BridgeOsTestClient();
        client.setServer(null);

        expect(await client.callDetectBridgeIsWindows()).toBe(false);
        // キャッシュされていないことを確認 (nullのまま)
        expect(client.getBridgeIsWindows()).toBeNull();

        // server設定後に再検出が行われることを確認
        platformMock.mockReturnValue("win32");
        client.setServer({ address: "192.168.0.10", port: 65207 });
        client.setSelectedAdapter(createAdapter("192.168.0.10"));
        expect(await client.callDetectBridgeIsWindows()).toBe(true);
    });

    it("不正なIPアドレス形式の場合はfalseを返しキャッシュしない", async () => {
        const client = new BridgeOsTestClient();
        client.setServer({ address: "invalid-ip", port: 65207 });
        client.setSelectedAdapter(createAdapter("192.168.0.10"));

        expect(await client.callDetectBridgeIsWindows()).toBe(false);
        expect(client.getBridgeIsWindows()).toBeNull();
    });

    it("Windowsではping -n 1 -w 1000引数を使用する", async () => {
        platformMock.mockReturnValue("win32");
        mockExecFileSuccess("Reply from 192.168.0.100: bytes=32 time<1ms TTL=128\n");
        const client = new BridgeOsTestClient();
        client.setSelectedAdapter(createAdapter("192.168.0.10"));

        await client.callDetectBridgeIsWindows();

        expect(execFileMock).toHaveBeenCalledWith(
            "ping",
            ["-n", "1", "-w", "1000", "192.168.0.100"],
            expect.objectContaining({ timeout: 3000 }),
            expect.any(Function),
        );
    });

    it("macOS/Linuxではping -c 1 -W 1引数を使用する", async () => {
        platformMock.mockReturnValue("darwin");
        mockExecFileSuccess("64 bytes from 192.168.0.100: icmp_seq=1 ttl=64 time=0.5 ms\n");
        const client = new BridgeOsTestClient();
        client.setSelectedAdapter(createAdapter("192.168.0.10"));

        await client.callDetectBridgeIsWindows();

        expect(execFileMock).toHaveBeenCalledWith(
            "ping",
            ["-c", "1", "-W", "1", "192.168.0.100"],
            expect.objectContaining({ timeout: 3000 }),
            expect.any(Function),
        );
    });
});
