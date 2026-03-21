# node-tcnet

> フォーク元: <https://github.com/chdxD1/node-tcnet>

TCNetプロトコルのNode.js実装である。Pioneer DJ / ShowKontrol / Event Imagineering GroupのTCNetプロトコル仕様に基づく。

## インストール

```bash
npm install @9c5s/node-tcnet
```

## 使い方

```typescript
import { TCNetClient, TCNetConfiguration, TCNetDataPacketType, TCNetDataPacketMetadata } from "@9c5s/node-tcnet";

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
```

## 前提条件

以下のいずれかが必要である:

- [PRO DJ LINK Bridge](https://www.pioneerdj.com/en/product/software/pro-dj-link-bridge/software/) (Windows / Mac)
- [ShowKontrol / Beatkontrol](https://www.tc-supply.com/home) (Mac)

## 機能

- [x] TCNetネットワーク接続
- [x] ステータスイベント受信
- [x] メタデータリクエスト (アーティスト名、曲名)
- [x] メトリクスリクエスト
- [x] タイムスタンプ受信
- [ ] Time Sync (NTP/PTP相当)
- [ ] Beat Grid / Wave Formリクエスト
- [ ] Control機能 (レイヤー制御)

## ドキュメント

詳細は[Wiki](https://github.com/9c5s/node-tcnet/wiki)を参照:

- [Getting Started](https://github.com/9c5s/node-tcnet/wiki/Getting-Started) -- 導入ガイド
- [API Reference](https://github.com/9c5s/node-tcnet/wiki/API-Reference) -- APIリファレンス
- [PRO DJ LINK Bridge](https://github.com/9c5s/node-tcnet/wiki/PRO-DJ-LINK-Bridge) -- Bridge固有の制限
- [TCNet Protocol](https://github.com/9c5s/node-tcnet/wiki/TCNet-Protocol) -- プロトコル仕様
- [Contributing](https://github.com/9c5s/node-tcnet/wiki/Contributing) -- 開発への参加

## 関連プロジェクト

- [prolink-connect](https://github.com/EvanPurkhiser/prolink-connect) (JS) -- Pro DJ Linkプロトコル直接実装
- [dysentery](https://github.com/Deep-Symmetry/dysentery) (Java) -- 同上

## 免責事項

本プロジェクトはPioneer DJおよびEvent Imagineering Groupの支援・承認を受けていない。全ての製品名・企業名は各所有者の商標または登録商標である。
