import { getClusterEnd } from "./utils";

/**
 * BigWaveFormとBeatGridのマルチパケットを組み立てるアセンブラ
 * @category Utilities
 */
export class MultiPacketAssembler {
    private packets: Map<number, Buffer> = new Map();
    private totalPackets = 0;

    /**
     * パケットを追加し、全パケットが揃ったらtrueを返す
     * @param buffer - パケットのバッファ
     * @returns 全パケットが揃った場合true
     */
    add(buffer: Buffer): boolean {
        // T1: バッファが最小ヘッダサイズ未満なら不正パケットとして無視する
        if (buffer.length < 42) return false;
        const newTotalPackets = buffer.readUInt32LE(30);
        if (newTotalPackets === 0) return false;
        // T4: totalPackets が途中で変わった場合は不整合パケットとして無視する
        if (this.totalPackets > 0 && newTotalPackets !== this.totalPackets) return false;
        this.totalPackets = newTotalPackets;
        const packetNo = buffer.readUInt32LE(34);
        const clusterSize = buffer.readUInt32LE(38);
        const dataStart = 42;
        const end = getClusterEnd(buffer.length, dataStart, clusterSize);
        // clusterSize と実バッファ長が不一致の場合、中間パケットは破損とみなし拒否する。
        // 最終パケット (packetNo === totalPackets - 1) は Bridge (BRIDGE64) が clusterSize を
        // 実データ長に更新せず中間と同じ値を送ってくるため、実バッファ範囲での受け入れを許容する
        if (clusterSize > 0 && end !== dataStart + clusterSize) {
            const isLastPacket = packetNo === newTotalPackets - 1;
            if (!isLastPacket) return false;
        }
        // T3: Buffer.from() でコピーを保持し、元バッファへの参照共有を防ぐ
        this.packets.set(packetNo, Buffer.from(buffer.slice(dataStart, end)));
        return this.packets.size >= this.totalPackets;
    }

    /**
     * packetNo順にソートしてデータを結合する
     * @returns 結合されたバッファ
     */
    assemble(): Buffer {
        const sorted = [...this.packets.entries()].sort((a, b) => a[0] - b[0]);
        return Buffer.concat(sorted.map(([, buf]) => buf));
    }

    /** 状態をリセットする */
    reset(): void {
        this.packets.clear();
        this.totalPackets = 0;
    }
}
