import { networkInterfaces } from "os";

/**
 * IPv4アドレス文字列を32bit数値に変換する
 * @param ip - IPv4アドレス文字列(例: "192.168.0.1")
 * @returns 32bit数値
 * @throws {Error} 不正なIPv4形式(オクテット数不一致、非整数、範囲外)の場合
 */
export function ipToNumber(ip: string): number {
    const parts = ip.split(".").map(Number);
    if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
        throw new Error(`Invalid IPv4 address: ${ip}`);
    }
    return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/**
 * IPv4アドレスとサブネットマスクからブロードキャストアドレスを計算する
 * @param address - IPv4アドレス文字列
 * @param netmask - サブネットマスク文字列
 * @returns ブロードキャストアドレス文字列
 */
function calculateBroadcastAddress(address: string, netmask: string): string {
    const addrParts = address.split(".").map(Number);
    const maskParts = netmask.split(".").map(Number);
    return addrParts.map((a, i) => a | (~maskParts[i] & 0xff)).join(".");
}

/**
 * 指定インタフェースのブロードキャストアドレスを返す
 * @param ifname - ネットワークインタフェース名
 * @returns ブロードキャストアドレス文字列
 */
export function interfaceAddress(ifname: string): string {
    const interfaces = networkInterfaces();
    const intf = interfaces[ifname];
    if (!intf) {
        throw new Error(`Interface ${ifname} does not exist`);
    }

    const address = intf.find((el) => el.family === "IPv4");
    if (!address) {
        throw new Error(`Interface ${ifname} does not have IPv4 address`);
    }

    return calculateBroadcastAddress(address.address, address.netmask);
}

/**
 * 条件が偽の場合にエラーをスローするアサーション関数
 * @param condition - 検証する条件
 * @param message - エラーメッセージ
 */
export const assert = (condition: boolean, message?: string): void => {
    if (!condition) {
        throw new Error(`Assertion failed: ${message}`);
    }
};

/**
 * ネットワークアダプタのアドレス情報を表すインタフェース
 * @category Utilities
 */
export interface NetworkAdapterAddress {
    address: string;
    netmask: string;
    family: "IPv4" | "IPv6";
    mac: string;
    internal: boolean;
    cidr: string | null;
    scopeid?: number;
}

/**
 * ネットワークアダプタの情報を表すインタフェース
 * @category Utilities
 */
export interface NetworkAdapterInfo {
    name: string;
    addresses: NetworkAdapterAddress[];
}

/**
 * アダプタからnon-internalなIPv4アドレスを検索する
 * @param adapter - 検索対象のネットワークアダプタ
 * @returns IPv4アドレス情報。見つからない場合はundefined
 * @category Utilities
 */
export function findIPv4Address(adapter: NetworkAdapterInfo): NetworkAdapterAddress | undefined {
    return adapter.addresses.find((a) => a.family === "IPv4" && !a.internal);
}

/**
 * システム上のネットワークアダプタ一覧を返す
 * @returns ネットワークアダプタ情報の配列
 * @category Utilities
 */
export function listNetworkAdapters(): NetworkAdapterInfo[] {
    const interfaces = networkInterfaces();
    const result: NetworkAdapterInfo[] = [];
    for (const [name, addrs] of Object.entries(interfaces)) {
        if (!addrs) continue;
        result.push({
            name,
            addresses: addrs.map((a) => ({
                address: a.address,
                netmask: a.netmask,
                family: a.family === "IPv4" || a.family === "IPv6" ? a.family : "IPv4",
                mac: a.mac,
                internal: a.internal,
                cidr: a.cidr,
                ...(a.family === "IPv6" ? { scopeid: a.scopeid } : {}),
            })),
        });
    }
    return result;
}
