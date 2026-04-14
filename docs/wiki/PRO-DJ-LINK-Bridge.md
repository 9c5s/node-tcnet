# PRO DJ LINK Bridge

PRO DJ LINK Bridgeは、Pioneer DJのCDJ/XDJをTCNetネットワークに接続するブリッジアプリケーション。
本ページでは、node-tcnetとBridgeを組み合わせて使用する際の通信制約とトラブルシューティングをまとめる。

## 通信制約

Bridgeは標準的なTCNetノードとは異なる通信上の制約を持つ。

| 制約 | 詳細 |
|------|------|
| 受付ポート | ポート60000(broadcastSocket)からのパケットのみ受け付ける。unicastSocket(65023等)経由の送信は無視される |
| 同一マシン制限 | 同一マシン上で動作するBridgeはブロードキャストOptInを受信してもユニキャストOptIn応答を返さない |
| OptIn応答ポート | Bridgeのポート60009から送信される(仕様上のlistenerPortとは異なる) |
| Data応答ポート | Bridgeのポート60002から送信される |

## データ制限

Bridgeが送信するパケットには、常に0で返されるフィールドがある。

### MetaData

- `trackID` = 0
- `trackKey` = 0

StatusパケットのtrackIDは正常に返される。MetaDataのtrackIDが必要な場合はStatusパケットの値を使用する。

### Metrics

別マシンのBridgeでは全フィールドが正常に取得可能であることを実機で確認済み (BPM, trackLength, currentPosition, speed, beatNumber, pitchBend, trackID)。

同一マシン上のBridgeではこれらのフィールドが0で返されることがある。

#### Layer State の未定義値

仕様で定義されていないlayerState値がBridgeから送信されることがある。

| state | 観測された挙動 |
|-------|--------------|
| 17 | トラック終端到達時 (state=3の後に遷移) |
| 2 | 停止直前の中間状態 (state=17の後、state=0の前に遷移) |

観測された遷移パターン: `3(再生) → 17 → 2 → 0(トラック変更) → 3(再生開始)`

#### RESERVED領域

byte 44-45に`0x001e` (=30) が入ることもある。用途不明 (値30はSMPTE 30fpsとの関連が推測されるが未確認)。

#### Sync Master フィールド (byte 29)

仕様 V3.5.1B では `0=Slave, 1=Master` の layer 単位 flag と定義されているが、Bridge実機では**「master deck の player number (1-4)」を全 layer に共通値で broadcast** している。

| 実機状態 | 全 layer の byte 29 |
|---|---|
| master = player 1 | 1 |
| master = player 2 | 2 |
| master = player 3 | 3 |
| master = player 4 | 4 |

`TCNetLayerSyncMaster` enumは仕様準拠のまま (`{Slave:0, Master:1}`) だが、実機では範囲外の 2-4 も送信される。アプリ側で master deck を判定する場合は、自分の player number と `metrics.syncMaster` を比較することで期待動作となる (`syncMaster === 1` 単純判定は誤動作を招く)。

### Mixer

TCNetマスターの種類 (StatusパケットのautoMasterModeまたはノードリストで確認可能) によって取得できるフィールドが異なる。

`masterAudioLevel`は常に0で返される (TCNetマスターの種類に依らない)。

| フィールド群 | Bridgeマスター | ShowKontrolマスター |
|-------------|--------------|-------------------|
| masterAudioLevel | 0 | 0 |
| チャンネル audioLevel | 0 | リアルタイム取得可能 |
| EQ, Filter, Trim等のノブ系 | リアルタイム取得可能 | 0 |
| フェーダー位置 (faderLevel, crossFader) | リアルタイム取得可能 | リアルタイム取得可能 |

### CUE

以下の制限がある。

- CUE数の上限は**15個** (仕様上の最大18個に対し、16個以上ではパケットは届くがCUEスロットが空で返される)
- Memory Cueの色は転送されない (常にcolor=(0,0,0))
- Hot Cueの色は正常に転送される
- ループCUEのoutTimeは正常に転送される
- Hot Cueのコメントはパケットに含まれない (CUEデータへの影響もなし)

### Time

以下のフィールドが0で返される (未再検証)。

- `currentTimeMillis`
- `totalTimeMillis`
- `beatMarker`

### 未実装パケット

Bridge実行ファイル (`PRO DJ LINK Bridge.exe`) のバイナリ解析により、以下のパケットタイプは処理コードが存在しないことを確認した。確認方法: TCNet関連ルーチン名の文字列検索 (`cmdOfferTCNet*`) およびmsgType値との比較命令 (cmp) のコード検索。

| Type | 名称 | 状態 |
|------|------|------|
| 101 | Control | 未実装 (`cmdOfferTCNetControl`不在、cmp 0x65不在。nodeOptionsのSUPPORTS TCNCMフラグは静的設定) |
| 128 | Text Data | 未実装 (`cmdOfferTCNetText`不在) |
| 132 | Keyboard Data | 未実装 (`cmdOfferTCNetKeyboard`不在) |

## パケットタイミング

仕様値とBridgeの実測値の比較を示す。

| パケット | 仕様 | 実測 | 備考 |
|---------|------|------|------|
| OptIn | 1000ms毎 | 1000.0ms | 一致 |
| Status | 1000ms毎 | 約293ms(約3.4回/sec) | 仕様より高頻度 |
| Time | 1-40ms毎 | 約31ms(約32回/sec) | SMPTE 30fps付近 |
| Metrics | キャッシュ変更時 | 約414ms(約2.4回/sec) | -- |
| MetaData | 更新イベント時/リクエスト時 | トラック変更時のみ | -- |

## トラブルシューティング

### 接続タイムアウト

Bridgeとの接続が確立できない場合、以下を順に確認する。

1. **ポート確認** -- node-tcnetがbroadcastSocket(ポート60000)経由でパケットを送信しているか確認する。unicastSocket経由だとBridgeは応答しない
2. **ネットワークIF** -- BridgeとNode.jsアプリケーションが同一サブネット上にあるか確認する。`interfaceAddress`オプションで明示的にNICを指定する
3. **ファイアウォール** -- UDP 60000, 60001, 60002, 60009, 65023の各ポートが許可されているか確認する
4. **同一マシン** -- BridgeとNode.jsを同一マシン上で動作させている場合、ブロードキャスト未到達の制約がある。receiveBroadcastでのOptIn検出が有効であることを確認する

### データが取得できない

- 同一マシン上のBridgeではMetricsの一部フィールドが0で返されることがある。別マシンのBridgeでは全フィールド正常に取得可能
- MetaDataのtrackID/trackKeyが0なのはBridge固有の制限。トラックの識別にはStatusパケットのtrackIDを使用する

## 関連ページ

実装状況の詳細は[[Implementation Status]]を参照。
