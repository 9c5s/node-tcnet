// BigWaveForm, BeatGrid のマルチパケットを組み立てるアセンブラ
export class MultiPacketAssembler {
    private packets: Map<number, Buffer> = new Map();
    private totalPackets = 0;

    // パケットを追加し、全パケットが揃ったら true を返す
    add(buffer: Buffer): boolean {
        this.totalPackets = buffer.readUInt32LE(30);
        const packetNo = buffer.readUInt32LE(34);
        const clusterSize = buffer.readUInt32LE(38);
        const dataStart = 42;
        const dataEnd = Math.min(dataStart + clusterSize, buffer.length);
        this.packets.set(packetNo, buffer.slice(dataStart, dataEnd));
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
