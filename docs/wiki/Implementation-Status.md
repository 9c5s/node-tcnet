# Implementation Status

node-tcnetにおけるTCNet V3.5.1B仕様の実装状況をまとめる。

## 実装済みメッセージ

| Type | 名称 | サイズ | 備考 |
|------|------|--------|------|
| 2 | OptIn | 68 | 送受信対応 |
| 3 | OptOut | 28 | 送受信対応 |
| 5 | Status | 300 | 受信のみ |
| 20 | Request | 26 | 送信のみ |
| 200 | Data | 可変 | 受信のみ(DataTypeによる) |
| 254 | Time | 154/162 | 受信のみ。OnAirセクション(V3.3.3+)の有無を自動判定する |

## 未実装メッセージ

| Type | 名称 | サイズ | 備考 |
|------|------|--------|------|
| 10 | Time Sync | 32 | ノード間タイムシンク |
| 13 | Error/Notification | 30 | エラー応答 |
| 30 | Application Specific Data | 可変 | アプリケーション固有データ |
| 101 | Control | 42+DataSize | レイヤー制御コマンド |
| 128 | Text Data | 42+DataSize | テキストデータ |
| 132 | Keyboard Data | 44 | キーボード入力 |
| 204 | File | 可変 | Artwork等のファイル転送 |

## 実装済みDataPacketタイプ

| DataType | 名称 | サイズ | 備考 |
|----------|------|--------|------|
| 2 | Metrics Data | 122 | BPM, Speed, Position等 |
| 4 | Meta Data | 548 | Artist, Title, TrackID。V3.5.0+のUTF-16LEに対応 |
| 8 | Beat Grid Data | 2442 | マルチパケット。MultiPacketAssemblerで自動組み立て |
| 12 | CUE Data | 436 | 最大18キュー、Loop In/Out Time |
| 16 | Small Wave Form | 2442 | 1200バーの波形データ |
| 32 | Big Wave Form | 可変 | マルチパケット。MultiPacketAssemblerで自動組み立て |
| 150 | Mixer Data | 270 | 6チャンネル対応 |

## 未実装DataPacketタイプ

| DataType | 名称 | サイズ | 備考 |
|----------|------|--------|------|
| 128 | Low Res Artwork | 可変 | JPEG形式、マルチパケット(File Type 204) |

## 仕様との既知の差異

| 項目 | 仕様 | 実装 | 影響 |
|------|------|------|------|
| MetaData V3.4以前 | UTF-8(256文字) | 未対応(パケット破棄) | V3.5.0未満のノードからMetaDataを受信できない |
| Pitch Bend | UInt16LE(0-65535, 32768=100%) | Int16LE(符号付き) | 32768以上の値が負数として解釈される |
| Timeパケットサイズ | 162バイト(V3.3.3+) | 154または162バイト | buffer.lengthで自動判定しており、OnAir未対応ノードも正常に処理できる |

## バグ修正履歴(PR #2)

PR #2で修正された6件のプロトコル実装バグの概要を示す。

| ID | 概要 | 影響 |
|----|------|------|
| BUG-1 | OptInの`writeUInt8`引数順序が逆転 | Node IDの上位バイトが破壊されていた |
| BUG-2 | WindowsでbroadcastアドレスがローカルIPを返していた | broadcast-addressパッケージ依存を削除し自前計算に変更 |
| BUG-3 | デフォルトユニキャストポートが65032 | 仕様準拠の65023に修正 |
| BUG-4 | receiveBroadcastでMaster OptIn検出が削除されていた | 同一マシンBridge環境での接続確立に必要 |
| BUG-5 | sendServerがunicastSocket経由で送信 | BridgeはbroadcastSocket(ポート60000)からのパケットのみ受け付ける |
| BUG-6 | requestDataのlayer+1変換が欠落 | layer=0(無効値)が送信され、Bridgeがリクエストを無視していた |

BUG-2の修正はBUG-4, BUG-5と連鎖している。修正前のWindows環境ではBUG-2(broadcastAddress=IP)がユニキャスト的に動作することで、BUG-4(broadcast未検出)とBUG-5(送信ソケット)の問題を隠蔽していた。

## ネットワークアダプタ自動検出・切り替え

### 実装済み機能

| 機能 | 説明 |
|------|------|
| `listNetworkAdapters()` | `os.networkInterfaces()`をラップし全アダプタ情報を返す |
| `connect()` マルチアダプタ検出 | 全non-internal IPv4アダプタにソケットを作成し、即座にresolve。Master OptIn検出で収束する |
| `TCNetClient.selectedAdapter` | 確定済みアダプタ情報(`null`=未確定) |
| `TCNetClient.isConnected` | Master検出済みフラグ |
| `switchAdapter(interfaceName)` | 手動アダプタ切り替え。リトライ付き |
| `adapterSelected`イベント | アダプタ確定時に`NetworkAdapterInfo`をペイロードとして発火 |
| `detectionTimeout`イベント | `detectionTimeout`ms以内にMasterを検出できなかった場合に発火 |

### 設定項目

| プロパティ | デフォルト | 説明 |
|------------|-----------|------|
| `TCNetConfiguration.detectionTimeout` | `5000` | 検出タイムアウト(ms)。`0`で無効化 |
| `TCNetConfiguration.switchRetryCount` | `3` | `switchAdapter()`のリトライ回数 |
| `TCNetConfiguration.switchRetryInterval` | `1000` | リトライ間隔(ms) |

### 動作仕様

- `connect()`はnon-internal IPv4アダプタが見つかった時点で即resolveする(Masterの検出を待たない)
- 複数アダプタが存在する場合、最初にMaster OptInを受信したアダプタに収束し、他のアダプタのソケットを閉じる
- `switchAdapter()`はpendingリクエストを全てrejectし、ソケットを再作成してMaster検出を待つ
- 切り替え中(`_switching=true`)は`sendServer()`・`requestData()`・`broadcastPacket()`が例外を投げる

## 関連ページ

Bridge固有の制限は[[PRO DJ LINK Bridge]]を参照。
