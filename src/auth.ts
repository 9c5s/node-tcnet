/**
 * TCNASDP認証モジュール
 *
 * TCNet Application Specific Data Protocol (TCNASDP) の認証機能を提供する。
 * FNV-1a Int32ハッシュによる認証ペイロード生成を実装する。
 */

/** FNV-1a オフセットバイアス */
const FNV_OFFSET_BASIS = 0x811c9dc5;

/** FNV-1a プライム */
const FNV_PRIME = 0x01000193;

/**
 * fnv1aInt32([0xA0, 0x0A]) の事前計算値。全クライアント共通定数。
 * @category Auth
 */
export const DATA_HASH = 0xc688a0af;

/**
 * TCNASDP認証の状態を表す型
 * @category Auth
 */
export type AuthState = "none" | "pending" | "authenticated" | "refreshing" | "failed";

/**
 * FNV-1a Int32変種ハッシュ関数
 *
 * 標準FNV-1aのInt32 XOR変種である。バイト単位ではなくInt32単位でXORし、
 * Math.imulで乗算して符号なし32ビットに切り詰める。
 * @param values - ハッシュ対象の値配列
 * @returns 32ビットハッシュ値
 * @category Auth
 */
export function fnv1aInt32(values: number[]): number {
    let hash = FNV_OFFSET_BASIS;
    for (const v of values) {
        hash = Math.imul((hash ^ v) >>> 0, FNV_PRIME) >>> 0;
    }
    return hash >>> 0;
}

/**
 * TCNASDP認証ペイロードを生成する
 *
 * auth[0:4] = FNV1a_int32(client_ip_octets) XOR DATA_HASH XOR session_token
 * auth[4:12] = XTEA暗号文
 * @param sessionToken - Bridgeから取得したセッショントークン
 * @param clientIp - クライアントのIPアドレス (ドット区切り)
 * @param xteaCiphertext - XTEA暗号文 (8バイト)。省略時はauth[4:12]をゼロで送信
 * @returns 12バイトの認証ペイロード
 * @category Auth
 */
export function generateAuthPayload(sessionToken: number, clientIp: string, xteaCiphertext?: Buffer): Buffer {
    if (xteaCiphertext && xteaCiphertext.length !== 8) {
        throw new Error(`Invalid XTEA ciphertext length: expected 8 bytes, got ${xteaCiphertext.length}`);
    }

    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(clientIp)) {
        throw new Error(`Invalid IPv4 address: "${clientIp}"`);
    }
    const octets = clientIp.split(".").map((o) => Number.parseInt(o, 10));
    if (octets.some((o) => o > 255)) {
        throw new Error(`Invalid IPv4 address: "${clientIp}"`);
    }
    const keyHash = fnv1aInt32(octets);
    const K = (keyHash ^ DATA_HASH) >>> 0;

    const payload = Buffer.alloc(12);
    payload.writeUInt32LE((K ^ sessionToken) >>> 0, 0);
    if (xteaCiphertext) {
        xteaCiphertext.copy(payload, 4);
    }
    return payload;
}
