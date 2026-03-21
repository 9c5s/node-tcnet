# Getting Started

## 前提条件

TCNetプロトコルでデータを送信するソフトウェアが必要である。

- **PRO DJ LINK Bridge** (Windows / Mac) -- Pioneer DJ機器のデータをTCNetに変換する
- **ShowKontrol** (Mac) -- TCNet対応のショーコントローラー
- **Beatkontrol** (Mac) -- BPM同期ツール

## インストール

```bash
npm install @9c5s/node-tcnet
```

## 基本的な使い方

```typescript
import { TCNetClient, TCNetConfiguration } from "@9c5s/node-tcnet";

const config = new TCNetConfiguration();
config.broadcastInterface = "10GbE"; // Windowsのネットワークインターフェース名

const client = new TCNetClient(config);
await client.connect();

// broadcastイベントでStatus/OptInを受信する
client.on("broadcast", (packet) => {
  console.log(packet);
});

// dataイベントでMetrics/Metadataを受信する
client.on("data", (packet) => {
  console.log(packet);
});

await client.disconnect();
```

## メタデータの取得

`requestData`メソッドで特定のデータを要求できる。

```typescript
import {
  TCNetDataPacketType,
  TCNetDataPacketMetadata,
} from "@9c5s/node-tcnet";

const meta = await client.requestData(TCNetDataPacketType.MetaData, 0); // layer 0 (0-based)
if (meta instanceof TCNetDataPacketMetadata && meta.info) {
  console.log(meta.info.trackArtist, meta.info.trackTitle);
}
```

## Windowsでの注意点

`broadcastInterface`にはOSのネットワークインターフェース名を指定する。
名前は「ネットワーク接続」画面や`os.networkInterfaces()`で確認できる。

```typescript
import os from "os";
console.log(Object.keys(os.networkInterfaces()));
// 例: [ 'Ethernet', '10GbE', 'Wi-Fi', 'Loopback Pseudo-Interface 1' ]
```
