import { isBridgeRunning, getBridgePid, stopBridge } from "./helpers";

// テスト前からBridgeが起動していたかのフラグ
let bridgeWasRunningBefore = false;

export async function setup(): Promise<void> {
    bridgeWasRunningBefore = await isBridgeRunning();
}

export async function teardown(): Promise<void> {
    // テスト前から起動していたBridgeは終了しない
    if (bridgeWasRunningBefore) return;

    // テスト中に起動されたBridgeがまだ動いていれば停止する
    if (await isBridgeRunning()) {
        try {
            const pid = await getBridgePid();
            await stopBridge(pid);
        } catch {
            // isBridgeRunningとgetBridgePidの間にBridgeが終了した場合は無視する
        }
    }
}
