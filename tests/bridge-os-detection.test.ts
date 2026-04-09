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

    it("並行呼び出しで in-flight Promise を共有しpingは1回だけ実行される", async () => {
        // Bridge の cmd=1 flood 等で短時間に複数の detectBridgeIsWindows が
        // 呼ばれても、in-flight Promise を共有することで ping プロセスの
        // 重複起動を防ぐ (single-flight パターンの検証)
        platformMock.mockReturnValue("win32");
        // ping の応答を遅延させて並行性を確保する
        execFileMock.mockImplementation(
            (_cmd: string, _args: string[], _opts: object, cb: (err: Error | null, stdout: string) => void) => {
                setTimeout(() => cb(null, "Reply from 192.168.0.100: bytes=32 time<1ms TTL=128\n"), 10);
            },
        );
        const client = new BridgeOsTestClient();
        client.setSelectedAdapter(createAdapter("192.168.0.10"));

        // 3 つの並行呼び出しを発行する
        const [r1, r2, r3] = await Promise.all([
            client.callDetectBridgeIsWindows(),
            client.callDetectBridgeIsWindows(),
            client.callDetectBridgeIsWindows(),
        ]);

        // 全て同じ結果を返し、ping は 1 回しか実行されていないこと
        expect(r1).toBe(true);
        expect(r2).toBe(true);
        expect(r3).toBe(true);
        expect(execFileMock).toHaveBeenCalledTimes(1);
    });

    it("検出中にserver.addressが変わると古い判定をキャッシュしない", async () => {
        // TOCTOU ガードの検証。ping 完了前に server を別の Bridge に切り替えた
        // シナリオで、古い Bridge 向けの判定が新しい Bridge 用のキャッシュを
        // 上書きしないことを検証する。
        platformMock.mockReturnValue("win32");
        let resolvePing: (stdout: string) => void = () => {};
        execFileMock.mockImplementation(
            (_cmd: string, _args: string[], _opts: object, cb: (err: Error | null, stdout: string) => void) => {
                // ping 応答を手動で制御するためコールバックを保留する
                resolvePing = (stdout: string) => cb(null, stdout);
            },
        );
        const client = new BridgeOsTestClient();
        client.setServer({ address: "192.168.0.100", port: 65207 });
        client.setSelectedAdapter(createAdapter("192.168.0.10"));

        // 検出開始 (ping は pending のまま)
        const detectPromise = client.callDetectBridgeIsWindows();

        // ping 実行中に server を別 Bridge に切り替える
        client.setServer({ address: "192.168.0.130", port: 65207 });

        // Bridge A (Windows, TTL=128) 向けの ping 結果を返す
        resolvePing("Reply from 192.168.0.100: bytes=32 time<1ms TTL=128\n");

        const result = await detectPromise;

        // 呼び出し元は古い判定 (true = Windows) を受け取る
        expect(result).toBe(true);
        // ただし server が変わったためキャッシュは更新されない
        expect(client.getBridgeIsWindows()).toBeNull();
    });

    it("Bridge切替後の呼び出しは旧 in-flight Promise を共有せず別の判定を返す", async () => {
        // Bridge A の ping 待機中に別 Bridge B で detectBridgeIsWindows を呼んだ場合、
        // Bridge IP をキーに in-flight Promise を識別し、Bridge B は新しい ping を
        // 発行して自身の判定を受け取ることを検証する。これにより旧 Bridge 向けの
        // 戻り値を新 Bridge の XTEA byte order 選択に使うリスクを防ぐ。
        platformMock.mockReturnValue("darwin");
        let firstPingResolve: (stdout: string) => void = () => {};
        let callCount = 0;
        execFileMock.mockImplementation(
            (_cmd: string, args: string[], _opts: object, cb: (err: Error | null, stdout: string) => void) => {
                callCount++;
                const targetIp = args[args.length - 1];
                if (targetIp === "192.168.0.100") {
                    // Bridge A の ping は保留して手動で解決する
                    firstPingResolve = (stdout: string) => cb(null, stdout);
                } else {
                    // Bridge B の ping は即座に応答する (TTL=64 → non-Windows)
                    cb(null, "64 bytes from 192.168.0.130: icmp_seq=1 ttl=64 time=0.5 ms\n");
                }
            },
        );
        const client = new BridgeOsTestClient();
        client.setServer({ address: "192.168.0.100", port: 65207 });
        client.setSelectedAdapter(createAdapter("192.168.0.10"));

        // Bridge A 向けの検出を開始 (ping は pending)
        const p1 = client.callDetectBridgeIsWindows();

        // Bridge B に切り替え
        client.setServer({ address: "192.168.0.130", port: 65207 });

        // Bridge B 向けの検出を開始 (こちらは即座に完了するはず)
        const r2 = await client.callDetectBridgeIsWindows();

        // Bridge B の判定は TTL=64 → non-Windows
        expect(r2).toBe(false);

        // Bridge A の ping を解決する (TTL=128 → Windows)
        firstPingResolve("Reply from 192.168.0.100: bytes=32 time<1ms TTL=128\n");
        const r1 = await p1;

        // Bridge A の判定は Windows で戻る (古い Promise 共有なし)
        expect(r1).toBe(true);

        // ping プロセスは 2 回起動されている (別々の Bridge に対して)
        expect(callCount).toBe(2);

        // 最終的なキャッシュは Bridge B の判定 (false) になっている
        // (Bridge A の戻り値は server.address 比較ガードでキャッシュ書き込みスキップ)
        expect(client.getBridgeIsWindows()).toBe(false);
    });
});
