# API Reference

`@9c5s/node-tcnet` が公開するクラス、メソッド、型の一覧。

---

## TCNetConfiguration

`TCNetClient`のコンストラクタに渡す設定クラス。
省略した場合はデフォルト値が使われる。

| プロパティ | 型 | デフォルト値 | 説明 |
| --- | --- | --- | --- |
| `logger` | `TCNetLogger \| null` | `null` | ログ出力先。`error`と`debug`メソッドを持つオブジェクトを渡す |
| `unicastPort` | `number` | `65023` | ユニキャスト受信ポート |
| `applicationCode` | `number` | `0xFFFF` | アプリケーションコード |
| `nodeId` | `number` | ランダム(0-0xFFFF) | ノードID |
| `nodeName` | `string` | `"TCNET.JS"` | ノード名(ASCII 8文字以内) |
| `vendorName` | `string` | `"CHDXD1"` | ベンダー名(ASCII 16文字以内) |
| `appName` | `string` | `"NODE-TCNET"` | アプリケーション名(ASCII 16文字以内) |
| `broadcastInterface` | `string \| null` | `null` | ブロードキャスト送信に使うNICの名前。`broadcastAddress`がデフォルト値(`"255.255.255.255"`)の場合のみ自動計算する |
| `broadcastAddress` | `string` | `"255.255.255.255"` | ブロードキャスト送信先アドレス |
| `broadcastListeningAddress` | `string` | `""` (実行時に`"0.0.0.0"`へ) | ブロードキャスト受信バインドアドレス |
| `requestTimeout` | `number` | `2000` | リクエストタイムアウト(ms)。接続待ちにも使われる |

---

## TCNetClient

`EventEmitter`を継承するTCNetプロトコルクライアント。

### コンストラクタ

```ts
new TCNetClient(config?: TCNetConfiguration)
```

`config`を省略するとデフォルト設定で動作する。

### メソッド

#### connect

```ts
connect(): Promise<void>
```

ブロードキャスト(60000)、タイムスタンプ(60001)、ユニキャストの3ソケットをバインドし、OptInパケットの送信を開始する。
Masterからの応答を受信すると解決する。`requestTimeout`以内に応答がなければ例外を投げる。

#### disconnect

```ts
disconnect(): Promise<void>
```

全ソケットを閉じ、イベントリスナーを全て除去する。

#### requestData

```ts
requestData(dataType: number, layer: number): Promise<TCNetDataPacket>
```

指定したデータ型とレイヤーのデータをMasterにリクエストし、応答パケットで解決するPromiseを返す。

- `dataType` -- `TCNetDataPacketType`の値を指定する
- `layer` -- 0-based(0-7)。内部で+1して仕様の1-basedに変換する
- タイムアウト時は例外を投げる

#### broadcastPacket

```ts
broadcastPacket(packet: TCNetPacket): Promise<void>
```

パケットをブロードキャストアドレスのポート60000へ送信する。

#### sendServer

```ts
sendServer(packet: TCNetPacket): Promise<void>
```

パケットを検出済みのMasterへ送信する。Masterが未検出の場合は例外を投げる。
内部ではブロードキャストソケット(ポート60000)から送信する。

### イベント

| イベント名 | コールバック引数 | 発火タイミング |
| --- | --- | --- |
| `"broadcast"` | `TCNetPacket` | ブロードキャストポートでパケットを受信したとき。OptIn、OptOut、Status等が届く |
| `"data"` | `TCNetDataPacket` | ユニキャストポートでDataパケットを受信したとき。Metrics、MetaData等が届く |
| `"time"` | `TCNetTimePacket` | タイムスタンプポート(60001)でTimeパケットを受信したとき |

---

## パケット型

全てのパケットは`TCNetPacket`抽象クラスを継承する。
共通で`buffer`、`header`(TCNetManagementHeader)プロパティを持つ。

### TCNetManagementHeader

全パケットに付与される24バイトのヘッダ。

| プロパティ | 型 | 説明 |
| --- | --- | --- |
| `nodeId` | `number` | 送信元ノードID |
| `minorVersion` | `number` | プロトコルマイナーバージョン |
| `messageType` | `TCNetMessageType` | メッセージ種別 |
| `nodeName` | `string` | 送信元ノード名 |
| `seq` | `number` | シーケンス番号 |
| `nodeType` | `number` | ノード種別(NodeType) |
| `nodeOptions` | `number` | ノードオプションフラグ |
| `timestamp` | `number` | タイムスタンプ |

### TCNetOptInPacket

ネットワーク参加通知パケット。

| プロパティ | 型 | 説明 |
| --- | --- | --- |
| `nodeCount` | `number` | ノード数 |
| `nodeListenerPort` | `number` | ユニキャスト受信ポート |
| `uptime` | `number` | 稼働時間(秒、12時間でロールオーバー) |
| `vendorName` | `string` | ベンダー名 |
| `appName` | `string` | アプリケーション名 |
| `majorVersion` | `number` | メジャーバージョン |
| `minorVersion` | `number` | マイナーバージョン |
| `bugVersion` | `number` | バグフィックスバージョン |

### TCNetOptOutPacket

ネットワーク離脱通知パケット。

| プロパティ | 型 | 説明 |
| --- | --- | --- |
| `nodeCount` | `number` | ノード数 |
| `nodeListenerPort` | `number` | ユニキャスト受信ポート |

### TCNetStatusPacket

ノードのステータス情報パケット。

`data`プロパティを持つ。

| フィールド | 型 | 説明 |
| --- | --- | --- |
| `nodeCount` | `number` | ノード数 |
| `nodeListenerPort` | `number` | ユニキャスト受信ポート |
| `smpteMode` | `number` | SMPTEモード |
| `autoMasterMode` | `number` | 自動マスターモード |

`layers`プロパティは8要素の配列。

| フィールド | 型 | 説明 |
| --- | --- | --- |
| `source` | `number` | ソース |
| `status` | `TCNetLayerStatus` | レイヤー状態 |
| `trackID` | `number` | トラックID |
| `name` | `string` | トラック名 |

### TCNetDataPacket

Dataパケットの基底クラス。

| プロパティ | 型 | 説明 |
| --- | --- | --- |
| `dataType` | `TCNetDataPacketType` | データ種別 |
| `layer` | `number` | レイヤー(0-based、0-7) |

### TCNetDataPacketMetrics

レイヤーの再生メトリクス。`TCNetDataPacket`を継承する。

`data`プロパティを持つ。

| フィールド | 型 | 説明 |
| --- | --- | --- |
| `state` | `TCNetLayerStatus` | 再生状態 |
| `syncMaster` | `TCNetLayerSyncMaster` | 同期マスター(0=Slave, 1=Master) |
| `beatMarker` | `number` | ビートマーカー |
| `trackLength` | `number` | トラック長 |
| `currentPosition` | `number` | 現在位置 |
| `speed` | `number` | 再生速度 |
| `beatNumber` | `number` | ビート番号 |
| `bpm` | `number` | BPM |
| `pitchBend` | `number` | ピッチベンド(符号付き) |
| `trackID` | `number` | トラックID |

### TCNetDataPacketMetadata

レイヤーのトラックメタデータ。`TCNetDataPacket`を継承する。
プロトコルバージョン3.5以上が必要。

`info`プロパティを持つ。

| フィールド | 型 | 説明 |
| --- | --- | --- |
| `trackArtist` | `string` | アーティスト名(UTF-16LE) |
| `trackTitle` | `string` | トラックタイトル(UTF-16LE) |
| `trackKey` | `number` | トラックキー |
| `trackID` | `number` | トラックID |

### TCNetTimePacket

タイムコードパケット。ポート60001で高頻度(通常は数十ms間隔)に受信する。

`layers`プロパティ(getter)は8要素の配列。

| フィールド | 型 | 説明 |
| --- | --- | --- |
| `currentTimeMillis` | `number` | 現在時間(ms) |
| `totalTimeMillis` | `number` | 総時間(ms) |
| `beatMarker` | `number` | ビートマーカー |
| `state` | `TCNetLayerStatus` | レイヤー状態 |
| `onAir` | `number` | On Air状態(非対応時は255) |

`generalSMPTEMode`プロパティ(getter): SMPTEモードを返す。

---

## Enum

### TCNetMessageType

パケットのメッセージ種別。

| 値 | 名前 | 説明 |
| --- | --- | --- |
| 2 | `OptIn` | ネットワーク参加 |
| 3 | `OptOut` | ネットワーク離脱 |
| 5 | `Status` | ステータス |
| 10 | `TimeSync` | 時刻同期(未実装) |
| 13 | `Error` | エラー(未実装) |
| 20 | `Request` | データリクエスト |
| 30 | `ApplicationData` | アプリケーションデータ(未実装) |
| 101 | `Control` | コントロール(未実装) |
| 128 | `Text` | テキスト(未実装) |
| 132 | `Keyboard` | キーボード(未実装) |
| 200 | `Data` | データ応答 |
| 204 | `File` | ファイル(未実装) |
| 254 | `Time` | タイムコード |

### TCNetDataPacketType

Dataパケットのサブタイプ。

| 値 | 名前 | 説明 |
| --- | --- | --- |
| 2 | `MetricsData` | 再生メトリクス |
| 4 | `MetaData` | トラックメタデータ |
| 8 | `BeatGridData` | ビートグリッド(未実装) |
| 12 | `CUEData` | キューデータ(未実装) |
| 16 | `SmallWaveFormData` | 小波形(未実装) |
| 32 | `BigWaveFormData` | 大波形(未実装) |
| 150 | `MixerData` | ミキサー(未実装) |

### NodeType

ノード種別。

| 値 | 名前 |
| --- | --- |
| 1 | `Auto` |
| 2 | `Master` |
| 4 | `Slave` |
| 8 | `Repeater` |

### TCNetLayerStatus

レイヤーの再生状態。

| 値 | 名前 |
| --- | --- |
| 0 | `IDLE` |
| 3 | `PLAYING` |
| 4 | `LOOPING` |
| 5 | `PAUSED` |
| 6 | `STOPPED` |
| 7 | `CUEDOWN` |
| 8 | `PLATTERDOWN` |
| 9 | `FFWD` |
| 10 | `FFRV` |
| 11 | `HOLD` |

### TCNetTimecodeState

タイムコードの状態。

| 値 | 名前 |
| --- | --- |
| 0 | `Stopped` |
| 1 | `Running` |
| 2 | `ForceReSync` |

### TCNetLayerSyncMaster

レイヤーの同期マスター設定。

| 値 | 名前 |
| --- | --- |
| 0 | `Slave` |
| 1 | `Master` |
