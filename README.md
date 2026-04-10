# node-tcnet

> フォーク元: <https://github.com/s0/node-tcnet>

TCNetプロトコルのNode.js実装。Pioneer DJ / ShowKontrol / Event Imagineering GroupのTCNet仕様に準拠。

## インストール

```bash
npm install @9c5s/node-tcnet
```

## 使い方

```typescript
import { TCNetClient, TCNetConfiguration, TCNetDataPacketType, TCNetDataPacketMetadata } from "@9c5s/node-tcnet";

async function main() {
  const config = new TCNetConfiguration();
  config.broadcastInterface = "10GbE"; // ネットワークインターフェース名

  const client = new TCNetClient(config);

  client.on("broadcast", (packet) => console.log(packet));
  client.on("data", (packet) => console.log(packet));

  await client.connect();

  // メタデータ取得 (layer: 0-based)
  const meta = await client.requestData(TCNetDataPacketType.MetaData, 0);
  if (meta instanceof TCNetDataPacketMetadata && meta.info) {
    console.log(meta.info.trackArtist, meta.info.trackTitle);
  }

  await client.disconnect();
}

main().catch(console.error);
```

## 前提条件

以下のいずれかが必要。

- [PRO DJ LINK Bridge](https://www.pioneerdj.com/en/product/software/pro-dj-link-bridge/software/) (Windows / Mac)
- [ShowKontrol / Beatkontrol](https://www.tc-supply.com/home) (Mac)

## 機能

- [x] TCNetネットワーク接続・アダプタ自動検出
- [x] ステータス / タイムスタンプ受信
- [x] メタデータリクエスト (アーティスト名、曲名)
- [x] メトリクスリクエスト (BPM、Speed、Position)
- [x] CUEデータリクエスト
- [x] Beat Grid / Wave Form (Small / Big) リクエスト
- [x] Mixerデータリクエスト
- [x] アートワーク取得 (JPEG)
- [x] TCNASDP認証 (セッション自動維持)
- [x] マルチパケット自動組み立て
- [ ] Time Sync (NTP/PTP相当)
- [ ] Control機能 (レイヤー制御)

## ドキュメント

- [Getting Started](https://github.com/9c5s/node-tcnet/wiki/Getting-Started) -- 導入ガイド
- [API Reference](https://9c5s.github.io/node-tcnet/) -- APIリファレンス
- [PRO DJ LINK Bridge](https://github.com/9c5s/node-tcnet/wiki/PRO-DJ-LINK-Bridge) -- Bridge固有の制限
- [TCNet Protocol](https://github.com/9c5s/node-tcnet/wiki/TCNet-Protocol) -- プロトコル仕様
- [Implementation Status](https://github.com/9c5s/node-tcnet/wiki/Implementation-Status) -- 実装状況

## 関連プロジェクト

- [prolink-connect](https://github.com/EvanPurkhiser/prolink-connect) (JS) -- Pro DJ Linkプロトコル直接実装
- [dysentery](https://github.com/Deep-Symmetry/dysentery) (Java) -- 同上

## 免責事項

Pioneer DJおよびEvent Imagineering Groupの支援・承認を受けていない。製品名・企業名は各所有者の商標または登録商標。
