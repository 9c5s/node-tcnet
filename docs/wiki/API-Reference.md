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
| `detectionTimeout` | `number` | `5000` | アダプタ自動検出タイムアウト(ms)。タイムアウト時に`detectionTimeout`イベントを発火する。`0`で無効化 |
| `switchRetryCount` | `number` | `3` | `switchAdapter()`のリトライ回数 |
| `switchRetryInterval` | `number` | `1000` | `switchAdapter()`のリトライ間隔(ms) |

---

## TCNetClient

`EventEmitter`を継承するTCNetプロトコルクライアント。

### コンストラクタ

```ts
new TCNetClient(config?: TCNetConfiguration)
```

`config`を省略するとデフォルト設定で動作する。

### プロパティ

| プロパティ | 型 | 説明 |
| --- | --- | --- |
| `selectedAdapter` | `NetworkAdapterInfo \| null` | 確定済みのアダプタ情報。未確定の場合は`null` |
| `isConnected` | `boolean` | Masterを検出済みかどうか |

### メソッド

#### connect

```ts
connect(): Promise<void>
```

システム上の全non-internal IPv4アダプタに対してブロードキャスト(60000)・タイムスタンプ(60001)ソケットを作成し、OptInパケットの送信を開始した後、即座にresolveする。

- いずれかのアダプタでMaster OptInを検出した時点でそのアダプタに収束し、他アダプタのソケットを閉じる
- アダプタ収束時に`adapterSelected`イベントを発火する
- `detectionTimeout`ms以内に検出されない場合は`detectionTimeout`イベントを発火するが、listenは継続する
- non-internal IPv4アダプタが存在しない場合は例外を投げる

#### disconnect

```ts
disconnect(): Promise<void>
```

全ソケットを閉じ、イベントリスナーを全て除去する。

#### switchAdapter

```ts
switchAdapter(interfaceName: string): Promise<void>
```

接続中のアダプタを指定したネットワークインターフェースに切り替える。

- 既存のpendingリクエストを全て`"Connection switching"`エラーでrejectする
- 現在のソケットを閉じ、指定アダプタのみで再接続する
- `config.switchRetryCount`回リトライし、全て失敗した場合は例外を投げる
- 成功時に`adapterSelected`イベントを発火する
- `interfaceName`が存在しない、またはIPv4アドレスを持たない場合は即座に例外を投げる
- 切り替え中は`sendServer()`・`requestData()`・`broadcastPacket()`が例外を投げる

#### requestData

```ts
requestData(dataType: number, layer: number): Promise<TCNetDataPacket>
```

指定したデータ型とレイヤーのデータをMasterにリクエストし、応答パケットで解決するPromiseを返す。

- `dataType` -- `TCNetDataPacketType`の値を指定する
- `layer` -- 0-based(0-7)。内部で+1して仕様の1-basedに変換する
- BigWaveFormDataとBeatGridDataはマルチパケットで返されるため、内部のMultiPacketAssemblerで自動組み立て後に解決する
- タイムアウト時は例外を投げる
- `layer`が0-7の整数でない場合は`RangeError`でrejectされる

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
| `"adapterSelected"` | `NetworkAdapterInfo` | アダプタが確定したとき。`connect()`でのMaster検出時と`switchAdapter()`成功時に発火する |
| `"detectionTimeout"` | なし | `connect()`後、`detectionTimeout`ms以内にMasterを検出できなかったとき。listenは継続する |

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
| `onAir` | `number` | On Air状態。V3.3.3以前のパケット(154バイト)では255、V3.3.3以上(162バイト)では実値 |

`generalSMPTEMode`プロパティ(getter): SMPTEモードを返す。

### TCNetDataPacketCUE

レイヤーのCUEデータ。`TCNetDataPacket`を継承する。

`data`プロパティを持つ(`CueData | null`)。

| フィールド | 型 | 説明 |
| --- | --- | --- |
| `loopInTime` | `number` | ループイン時間(ms) |
| `loopOutTime` | `number` | ループアウト時間(ms) |
| `cues` | `CuePoint[]` | CUEポイントの配列(最大18個、type=0のスロットは除外) |

`CuePoint`の構造は以下の通りである。

| フィールド | 型 | 説明 |
| --- | --- | --- |
| `index` | `number` | CUEインデックス(1-18) |
| `type` | `number` | CUEタイプ |
| `inTime` | `number` | イン時間(ms) |
| `outTime` | `number` | アウト時間(ms) |
| `color` | `{ r: number; g: number; b: number }` | CUEカラー(RGB) |

### TCNetDataPacketSmallWaveForm

小波形データ。`TCNetDataPacket`を継承する。1200バーの波形を含む。

`data`プロパティを持つ(`WaveformData | null`)。

### TCNetDataPacketBigWaveForm

大波形データ。`TCNetDataPacket`を継承する。可変長のマルチパケット。

`data`プロパティを持つ(`WaveformData | null`)。

`WaveformData`の構造は以下の通りである。

| フィールド | 型 | 説明 |
| --- | --- | --- |
| `bars` | `WaveformBar[]` | 波形バーの配列 |

`WaveformBar`の構造は以下の通りである。

| フィールド | 型 | 説明 |
| --- | --- | --- |
| `level` | `number` | レベル(0-255) |
| `color` | `number` | カラー(0-255) |

### TCNetDataPacketBeatGrid

ビートグリッドデータ。`TCNetDataPacket`を継承する。マルチパケット。

`data`プロパティを持つ(`BeatGridData | null`)。

`BeatGridData`の構造は以下の通りである。

| フィールド | 型 | 説明 |
| --- | --- | --- |
| `entries` | `BeatGridEntry[]` | ビートグリッドエントリの配列(beatNumber=0かつtimestampMs=0のエントリは除外) |

`BeatGridEntry`の構造は以下の通りである。

| フィールド | 型 | 説明 |
| --- | --- | --- |
| `beatNumber` | `number` | ビート番号 |
| `beatType` | `number` | ビートタイプ |
| `timestampMs` | `number` | タイムスタンプ(ms) |

### TCNetDataPacketMixer

ミキサーデータ。`TCNetDataPacket`を継承する。6チャンネル対応。

`data`プロパティを持つ(`MixerData | null`)。

`MixerData`の構造は以下の通りである。

| フィールド | 型 | 説明 |
| --- | --- | --- |
| `mixerId` | `number` | ミキサーID |
| `mixerType` | `number` | ミキサータイプ |
| `mixerName` | `string` | ミキサー名 |
| `masterAudioLevel` | `number` | マスターオーディオレベル |
| `masterFaderLevel` | `number` | マスターフェーダーレベル |
| `masterFilter` | `number` | マスターフィルター |
| `masterIsolatorOn` | `boolean` | マスターアイソレーターON/OFF |
| `masterIsolatorHi` | `number` | マスターアイソレーターHi |
| `masterIsolatorMid` | `number` | マスターアイソレーターMid |
| `masterIsolatorLow` | `number` | マスターアイソレーターLow |
| `filterHpf` | `number` | フィルターHPF |
| `filterLpf` | `number` | フィルターLPF |
| `filterResonance` | `number` | フィルターレゾナンス |
| `crossFader` | `number` | クロスフェーダー位置 |
| `crossFaderCurve` | `number` | クロスフェーダーカーブ |
| `channelFaderCurve` | `number` | チャンネルフェーダーカーブ |
| `beatFxOn` | `boolean` | Beat FX ON/OFF |
| `beatFxSelect` | `number` | Beat FXセレクト |
| `beatFxLevelDepth` | `number` | Beat FXレベル/デプス |
| `beatFxChannelSelect` | `number` | Beat FXチャンネルセレクト |
| `headphonesALevel` | `number` | ヘッドフォンAレベル |
| `headphonesBLevel` | `number` | ヘッドフォンBレベル |
| `boothLevel` | `number` | ブースレベル |
| `channels` | `MixerChannel[]` | 6チャンネルの配列 |

`MixerChannel`の構造は以下の通りである。

| フィールド | 型 | 説明 |
| --- | --- | --- |
| `sourceSelect` | `number` | ソース選択 |
| `audioLevel` | `number` | オーディオレベル |
| `faderLevel` | `number` | フェーダーレベル |
| `trimLevel` | `number` | トリムレベル |
| `compLevel` | `number` | コンプレッサーレベル |
| `eqHi` | `number` | EQ Hi |
| `eqHiMid` | `number` | EQ Hi-Mid |
| `eqLowMid` | `number` | EQ Low-Mid |
| `eqLow` | `number` | EQ Low |
| `filterColor` | `number` | フィルターカラー |
| `send` | `number` | センドレベル |
| `cueA` | `number` | CUE A |
| `cueB` | `number` | CUE B |
| `crossfaderAssign` | `number` | クロスフェーダーアサイン |

---

## ネットワークアダプタ

### listNetworkAdapters

```ts
listNetworkAdapters(): NetworkAdapterInfo[]
```

`os.networkInterfaces()`をラップし、フィルタなしで全アダプタの情報を返す。

### findIPv4Address

```ts
findIPv4Address(adapter: NetworkAdapterInfo): NetworkAdapterAddress | undefined
```

指定アダプタからnon-internalなIPv4アドレスを返す。該当なしの場合`undefined`を返す。

### NetworkAdapterInfo

ネットワークアダプタの情報を表す型。

| プロパティ | 型 | 説明 |
| --- | --- | --- |
| `name` | `string` | アダプタ名 |
| `addresses` | `NetworkAdapterAddress[]` | アダプタに割り当てられたアドレスの配列 |

### NetworkAdapterAddress

アダプタに割り当てられた1つのアドレス情報を表す型。

| プロパティ | 型 | 説明 |
| --- | --- | --- |
| `address` | `string` | IPアドレス |
| `netmask` | `string` | サブネットマスク |
| `family` | `"IPv4" \| "IPv6"` | アドレスファミリ |
| `mac` | `string` | MACアドレス |
| `internal` | `boolean` | ループバックアダプタかどうか |
| `cidr` | `string \| null` | CIDR表記のアドレス |
| `scopeid` | `number` (省略可) | IPv6スコープID(IPv6の場合のみ存在) |

---

## MultiPacketAssembler

BigWaveFormやBeatGridなどのマルチパケットを組み立てるユーティリティクラス。
`requestData()`で内部的に使用されるが、単体でも利用可能。

### メソッド

#### add

```ts
add(buffer: Buffer): boolean
```

パケットを追加する。全パケットが揃った場合に`true`を返す。

#### assemble

```ts
assemble(): Buffer
```

packetNo順にソートしてデータを結合したBufferを返す。

#### reset

```ts
reset(): void
```

内部状態をリセットする。

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
| 8 | `BeatGridData` | ビートグリッド |
| 12 | `CUEData` | キューデータ |
| 16 | `SmallWaveFormData` | 小波形 |
| 32 | `BigWaveFormData` | 大波形 |
| 150 | `MixerData` | ミキサー |

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
