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

## 未実装DataPacketタイプ

以下のDataTypeはパケット受信時にTCNetDataPacket基底クラスとしてパースされる。個別フィールドの読み取りは未実装。

| DataType | 名称 | サイズ | 備考 |
|----------|------|--------|------|
| 8 | Beat Grid Data | 2442 | マルチパケット |
| 12 | CUE Data | 436 | 最大18キュー |
| 16 | Small Wave Form | 2442 | マルチパケット、1200バーの波形 |
| 32 | Big Wave Form | 可変 | マルチパケット |
| 128 | Low Res Artwork | 可変 | JPEG形式、マルチパケット(File Type 204) |
| 150 | Mixer Data | 270 | 6チャンネル対応 |

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

## 関連ページ

Bridge固有の制限は[[PRO DJ LINK Bridge]]を参照。
