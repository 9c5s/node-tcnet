import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
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
