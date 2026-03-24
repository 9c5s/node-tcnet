import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { spawn, execFile } from "child_process";
import { TCNetClient, TCNetConfiguration } from "../../src/tcnet";
import { EventEmitter } from "events";

const DEFAULT_BRIDGE_PATH = "C:\\Program Files\\AlphaTheta\\PRO DJ LINK Bridge\\PRO DJ LINK Bridge.exe";

/**
 * E2Eテストの設定
 */
export interface E2EConfig {
    bridgePath: string;
    testInterface?: string;
}

/**
 * .env.e2eファイルからE2Eテスト設定を読み込む
 * ファイルが存在しない場合はデフォルト値を使用する
 */
export function loadConfig(): E2EConfig {
    const envPath = resolve(__dirname, "../../.env.e2e");
    const config: E2EConfig = { bridgePath: DEFAULT_BRIDGE_PATH };

    if (existsSync(envPath)) {
        const lines = readFileSync(envPath, "utf-8").split(/\r?\n/);
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) continue;
            const eqIndex = trimmed.indexOf("=");
            if (eqIndex === -1) continue;
            const key = trimmed.slice(0, eqIndex).trim();
            const value = trimmed.slice(eqIndex + 1).trim();
            if (key === "TCNET_BRIDGE_PATH" && value) config.bridgePath = value;
            if (key === "TCNET_TEST_INTERFACE" && value) config.testInterface = value;
        }
    }

    return config;
}

/**
 * テスト用のTCNetClientを生成する
 * デフォルトでdetectionTimeout=10s, requestTimeout=5sに設定される
 * @param overrides - TCNetConfigurationの上書き値
 */
export function createTestClient(overrides?: Partial<TCNetConfiguration>): TCNetClient {
    const config = new TCNetConfiguration();
    config.detectionTimeout = 10_000;
    config.requestTimeout = 5_000;
    if (overrides) Object.assign(config, overrides);
    return new TCNetClient(config);
}

/**
 * EventEmitterの指定イベントをPromiseで待機する
 * タイムアウト時はエラーをthrowする
 * @param emitter - イベント発火元のEventEmitter
 * @param event - 待機するイベント名
 * @param timeoutMs - タイムアウト(ミリ秒)。デフォルト10秒
 */
export function waitForEvent<T = unknown>(emitter: EventEmitter, event: string, timeoutMs = 10_000): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            emitter.removeListener(event, handler);
            reject(new Error(`Timeout waiting for "${event}" event (${timeoutMs}ms)`));
        }, timeoutMs);

        function handler(data: T) {
            clearTimeout(timer);
            resolve(data);
        }

        emitter.once(event, handler);
    });
}

const BRIDGE_PROCESS_NAME = "PRO DJ LINK Bridge.exe";

/**
 * Bridgeプロセスが実行中かどうかを確認する
 * @returns 実行中ならtrue
 */
export async function isBridgeRunning(): Promise<boolean> {
    return new Promise((resolve) => {
        execFile("tasklist", ["/FI", `IMAGENAME eq ${BRIDGE_PROCESS_NAME}`, "/FO", "CSV", "/NH"], (err, stdout) => {
            if (err) {
                resolve(false);
                return;
            }
            resolve(stdout.includes(BRIDGE_PROCESS_NAME));
        });
    });
}

/**
 * 実行中のBridgeプロセスのPIDを取得する
 * @returns BridgeプロセスのPID
 * @throws {Error} Bridgeプロセスが見つからない場合
 */
export async function getBridgePid(): Promise<number> {
    return new Promise((resolve, reject) => {
        execFile("tasklist", ["/FI", `IMAGENAME eq ${BRIDGE_PROCESS_NAME}`, "/FO", "CSV", "/NH"], (err, stdout) => {
            if (err) {
                reject(new Error("Failed to get Bridge PID"));
                return;
            }
            // CSV形式: "プロセス名","PID","セッション名","セッション#","メモリ使用量"
            const match = stdout.match(/"[^"]*","(\d+)"/);
            if (!match) {
                reject(new Error("Bridge process not found in tasklist output"));
                return;
            }
            resolve(parseInt(match[1], 10));
        });
    });
}

/**
 * Bridge起動完了をTCNetプロトコルで検知する
 * @param timeoutMs - タイムアウト(ミリ秒)。デフォルト30秒
 */
async function waitForBridgeReady(timeoutMs = 30_000): Promise<void> {
    const client = createTestClient({ detectionTimeout: timeoutMs });
    try {
        await client.connect();
        await waitForEvent(client, "adapterSelected", timeoutMs);
    } catch {
        throw new Error(`Bridge started but not responding on TCNet within ${timeoutMs / 1000}s`);
    } finally {
        await client.disconnect();
    }
}

/**
 * Bridgeプロセスを起動する
 * 既に実行中の場合はそのPIDを返す
 * @returns pid: プロセスID, alreadyRunning: 既に実行中だったかどうか
 */
export async function startBridge(): Promise<{ pid: number; alreadyRunning: boolean }> {
    const config = loadConfig();

    if (await isBridgeRunning()) {
        const pid = await getBridgePid();
        return { pid, alreadyRunning: true };
    }

    const child = spawn(config.bridgePath, [], {
        detached: true,
        stdio: "ignore",
    });
    child.unref();

    if (!child.pid) {
        throw new Error(`Failed to start Bridge: ${config.bridgePath}`);
    }

    // Bridge起動完了を待機 (TCNetプロトコルで検知)
    await waitForBridgeReady();

    return { pid: child.pid, alreadyRunning: false };
}

/**
 * Bridgeプロセスを強制終了する
 * @param pid - 終了対象のプロセスID
 */
export async function stopBridge(pid: number): Promise<void> {
    return new Promise((resolve) => {
        execFile("taskkill", ["/PID", String(pid), "/F"], (err) => {
            // taskkillの失敗はテスト結果に影響しないため無視する
            void err;
            resolve();
        });
    });
}
