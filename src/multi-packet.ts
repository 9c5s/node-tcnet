// BigWaveForm, BeatGrid のマルチパケットを組み立てるアセンブラ
export class MultiPacketAssembler {
    private packets: Map<number, Buffer> = new Map();
    private totalPackets = 0;

    // パケットを追加し、全パケットが揃ったら true を返す
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
        if (dataStart + clusterSize > buffer.length) return false;
        // T3: Buffer.from() でコピーを保持し、元バッファへの参照共有を防ぐ
        this.packets.set(packetNo, Buffer.from(buffer.slice(dataStart, dataStart + clusterSize)));
        return this.packets.size >= this.totalPackets;
    }

    // packetNo 順にソートしてデータを結合する
    assemble(): Buffer {
        const sorted = [...this.packets.entries()].sort((a, b) => a[0] - b[0]);
        return Buffer.concat(sorted.map(([, buf]) => buf));
    }

    // 状態をリセットする
    reset(): void {
        this.packets.clear();
        this.totalPackets = 0;
    }
}
