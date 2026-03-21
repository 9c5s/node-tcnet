import { networkInterfaces } from "os";

// IPv4アドレスとサブネットマスクからブロードキャストアドレスを計算する
function calculateBroadcastAddress(address: string, netmask: string): string {
    const addrParts = address.split(".").map(Number);
    const maskParts = netmask.split(".").map(Number);
    return addrParts.map((a, i) => a | (~maskParts[i] & 0xff)).join(".");
}

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

export const assert = (condition: boolean, message?: string): void => {
    if (!condition) {
        throw new Error(`Assertion failed: ${message}`);
    }
};
