# TCNet Protocol

TCNetはエンターテイメント業界向けに設計されたオープンな通信プロトコル。デバイスやソフトウェア間でリアルタイムのタイムコードとメタデータをUDP経由で共有する。

## ノードとロール

各ノードは固有のMACアドレスで識別される。

| 値 | ロール | 説明 |
|----|--------|------|
| 1 | Auto | 自動(Master昇格候補) |
| 2 | Master | タイムコード生成/送信 |
| 4 | Slave | メタデータ/タイミング受信のみ |
| 8 | Repeater | 送信と受信の両方が可能 |

- MasterまたはRepeaterがデータ送信可能。Slave/Repeaterはデータリクエストのみ可能
- どのロールでもControl Messageの送受信は可能
- Masterが切断した場合、Autoノードの中でUptime+Timestampが最大のものが新Masterに昇格する

## ネットワークポート

| ポート | 種別 | 用途 |
|--------|------|------|
| 60000 | Broadcast | OptIn/OptOut, Status, Application Specific Data |
| 60001 | Broadcast | Timeパケット |
| 60002 | Broadcast | データパケット応答 |
| 65023-65535 | Unicast | ユニキャストメッセージ(デフォルト: 65023) |

## ネットワーク参加手順

1. 内部タイマーを作成する(0-999999マイクロ秒)
2. ポート60000, 60001, 60002でリスナーを開く
3. OptInパケットを1000ms毎にブロードキャストする
4. 受信したOptInメッセージからノードリストを構築する
5. (任意)全ノード間でタイムシンクを実行する

## Management Header

全パケットに共通の24バイトヘッダー。

| Byte | Size | Type | 説明 |
|------|------|------|------|
| 0 | 2 | UInt16LE | Node ID |
| 2 | 1 | UInt8 | Protocol Version Major(固定値: 3) |
| 3 | 1 | UInt8 | Protocol Version Minor |
| 4 | 3 | ASCII | マジックヘッダー "TCN" |
| 7 | 1 | UInt8 | Message Type |
| 8 | 8 | ASCII | Node Name(null埋め) |
| 16 | 1 | UInt8 | Sequence Number |
| 17 | 1 | UInt8 | Node Type(1/2/4/8) |
| 18 | 2 | UInt16LE | Node Options |
| 20 | 4 | UInt32LE | Timestamp(マイクロ秒, 0-999999) |

## Node Options

複数のフラグを設定する場合は値を合算する(例: 1 + 2 + 8 = 11)。

| フラグ値 | 説明 |
|---------|------|
| 1 | NEED AUTHENTICATION(拡張通信に認証が必要) |
| 2 | SUPPORTS TCNCM(Control Messageを受信可能) |
| 4 | SUPPORTS TCNASDP(Application Specific Data Packetを受信可能) |
| 8 | DND(Do Not Disturb/スリープ中) |

## メッセージタイプ一覧

| Type | 名称 | ポート | サイズ |
|------|------|--------|--------|
| 2 | OptIn | 60000 + Unicast | 68 |
| 3 | OptOut | 60000 + Unicast | 28 |
| 5 | Status | 60000 + Unicast | 300 |
| 10 | Time Sync | Unicast | 32 |
| 13 | Error/Notification | Unicast | 30 |
| 20 | Request | Unicast | 26 |
| 30 | Application Specific Data | 60001 / Unicast | 可変 |
| 101 | Control | Unicast | 42 + DataSize |
| 128 | Text Data | 60000 / Unicast | 42 + DataSize |
| 132 | Keyboard Data | 60000 / Unicast | 44 |
| 200 | Data | Unicast | 可変(DataTypeによる) |
| 204 | File | Unicast | 可変 |
| 254 | Time | 60001 + Unicast | 162 |

## DataPacketタイプ一覧

MessageType=200のData内のサブタイプ。

| DataType | 名称 | サイズ |
|----------|------|--------|
| 2 | Metrics Data | 122 |
| 4 | Meta Data | 548 |
| 8 | Beat Grid Data | 2442(マルチパケット) |
| 12 | CUE Data | 436 |
| 16 | Small Wave Form | 2442(マルチパケット) |
| 32 | Big Wave Form | 可変(マルチパケット) |
| 128 | Low Res Artwork(File Type 204) | 可変(マルチパケット) |
| 150 | Mixer Data | 270 |

## 主要パケット構造

### OptIn(Type=2, 68バイト)

| Byte | Size | Type | 説明 |
|------|------|------|------|
| 0-23 | 24 | -- | Management Header |
| 24 | 2 | UInt16LE | Node Count |
| 26 | 2 | UInt16LE | Node Listener Port(65023-65535) |
| 28 | 2 | UInt16LE | Uptime(秒, 12時間でロールオーバー) |
| 30 | 2 | -- | RESERVED |
| 32 | 16 | ASCII | Vendor Name |
| 48 | 16 | ASCII | Application/Device Name |
| 64 | 1 | UInt8 | Major Version |
| 65 | 1 | UInt8 | Minor Version |
| 66 | 1 | UInt8 | Bug Version |
| 67 | 1 | -- | RESERVED |

### Status(Type=5, 300バイト)

| Byte | Size | Type | 説明 |
|------|------|------|------|
| 0-23 | 24 | -- | Management Header |
| 24 | 2 | UInt16LE | Node Count |
| 26 | 2 | UInt16LE | Node Listener Port |
| 28 | 6 | -- | RESERVED |
| 34-41 | 8x1 | UInt8 | Layer 1-C Source |
| 42-49 | 8x1 | UInt8 | Layer 1-C Status |
| 50-81 | 8x4 | UInt32LE | Layer 1-C Track ID |
| 83 | 1 | UInt8 | SMPTE Mode |
| 84 | 1 | UInt8 | Auto Master Mode |
| 85-99 | 15 | -- | RESERVED |
| 100-171 | 72 | -- | APP SPECIFIC |
| 172-299 | 8x16 | ASCII | Layer 1-C Name |

### Request(Type=20, 26バイト)

| Byte | Size | Type | 説明 |
|------|------|------|------|
| 0-23 | 24 | -- | Management Header |
| 24 | 1 | UInt8 | Data Type |
| 25 | 1 | UInt8 | Layer(1-based) |

### Time(Type=254, 154-162バイト)

| Byte | Size | Type | 説明 |
|------|------|------|------|
| 0-23 | 24 | -- | Management Header |
| 24-55 | 8x4 | UInt32LE | Layer 1-C Current Time(ミリ秒) |
| 56-87 | 8x4 | UInt32LE | Layer 1-C Total Time(ミリ秒) |
| 88-95 | 8x1 | UInt8 | Layer 1-C Beat Marker |
| 96-103 | 8x1 | UInt8 | Layer 1-C State |
| 105 | 1 | UInt8 | General SMPTE Mode |
| 106-153 | 8x6 | -- | Layer 1-C Timecode(SMPTE, Hours, Min, Sec, Frames) |
| 154-161 | 8x1 | UInt8 | Layer 1-C OnAir(V3.3.3+, 省略可) |

## 値エンコーディング

| 項目 | エンコーディング | 例 |
|------|-----------------|-----|
| BPM | 100倍値(UInt32LE) | 12000 = 120.00 BPM |
| Speed | 32768 = 100%, 0 = 0%, 65536 = 200%(UInt32LE) | 32768 = 100% |
| Pitch Bend | UInt16LE(0-65535, 32768=100%) | 32768 = 100% |
| WaveformBar | 2バイト/バー: byte[i]=BColor, byte[i+1]=BLevel。仕様書の「奇数/偶数バイト」は0-originオフセットを指す(実機検証済み) | [Color, Level] 順 |
| Layer ID | 1-based(1=Layer1 ... 8=LayerC) | ワイヤ上の1がAPI上の0に対応 |
| MetaDataテキスト | V3.5.0+はUTF-16LE、V3.4以前はUTF-8(各256バイト) | -- |

## 仕様書のタイポ

TimeパケットのLayer MとLayer Cのオフセットについて、仕様書(P31)に誤記がある。

| フィールド | 仕様記載 | 正しい値 |
|-----------|---------|---------|
| LM Current Time | byte 48 | byte 48 |
| LC Current Time | byte 48 | byte 52 |
| LM Beat Marker | byte 94 | byte 94 |
| LC Beat Marker | byte 94 | byte 95 |

LM TimeとLC Timeが同じオフセット48と記載されているが、正しくはLM=48, LC=52。Beat Markerも同様にLM=94, LC=95。
