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

「2026-10-11 の観測」と記した項目は、同一マシン上の Bridge V1.1.8 と CDJ-3000X の組み合わせで得た結果である。BeatGrid と Artwork の破損を除き、CDJ-3000 で同じ挙動になるかは確認していない。

### MetaData

- `trackID` = 0
- `trackKey` = 0

StatusパケットのtrackIDは正常に返される。MetaDataのtrackIDが必要な場合はStatusパケットの値を使用する。

トラックのロード直後の要求には、空の title で応答することがある。2026-10-11 の観測では 47 件中 24 件が空の title で、ロードから約 1.7 秒後に空でない title の応答を受けた例もある。空の応答を受けた場合は時間を置いて再要求する。

### Metrics

別マシンのBridgeでは全フィールドが正常に取得可能であることを実機で確認済み (BPM, trackLength, currentPosition, speed, beatNumber, pitchBend, trackID)。

同一マシン上のBridgeではこれらのフィールドが0で返されることがある。

#### Layer State の仕様外の値

Bridge は CDJ のステータスパケットにある再生状態の値を、そのまま layerState として転送していると考えられる。TCNet 仕様の 0、3〜9 は CDJ の再生状態と値が対応しており、仕様にない値として以下が届く。値の意味は beat-link の `CdjStatus.PlayState1` の定義による。

| state | node-tcnet の定数 | 意味 |
|-------|------------------|------|
| 2 | `TCNetLayerStatus.LOADING` | トラックの読み込み中 |
| 17 | `TCNetLayerStatus.ENDED` | トラックの終端に到達して停止 |

観測された遷移パターン: `3(再生) → 17 → 2 → 0(トラック変更) → 3(再生開始)`

2026-10-11 の観測では、17 が約 830ms 続いた後に 5 (PAUSED) へ遷移する例もあった。

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

`TCNetLayerSyncMaster` enum は仕様の値 (`{Slave:0, Master:1}`) を表し、`MetricsData.syncMaster` は player number を扱えるよう number 型で公開している。アプリ側で master deck を判定する場合は、自分の player number と `metrics.syncMaster` を比較することで期待動作となる (`syncMaster === 1` 単純判定は誤動作を招く)。

#### Speed フィールド (byte 40)

仕様では 32768 = 100% だが、Bridge 実機は 1048576 (2^20) = 100% で送信する。2026-10-11 の観測では、ピッチ 0 の通常再生で 1048576 が続き、再生位置は実時間と同じ速さで進んだ。node-tcnet は生値をそのまま返すため、利用側で 1048576 を 100% として換算する。

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

#### CUE Type フィールドの実機仕様

各CUEエントリの byte+0 (CUE Type) は Memory Cue と Hot Cue A-H を識別する値が入る。仕様書には値の意味が明記されていないが、実機 (BRIDGE + CDJ-3000) では以下の対応で送出される。

| type 値 | 意味 |
|---|---|
| 0 | Memory Cue |
| 1 | Hot Cue A |
| 2 | Hot Cue B |
| 3 | Hot Cue C |
| 4 | Hot Cue D |
| 5 | Hot Cue E |
| 6 | Hot Cue F |
| 7 | Hot Cue G |
| 8 | Hot Cue H |

アプリ側で Hot Cue A-H ラベルを表示したい場合は `String.fromCharCode(64 + cue.type)` で取得できる。

#### トラック切替直後の CUE

CUE パケットには trackID が含まれない。2026-10-11 の観測では、新しいトラックの Metrics が届いた約 1ms 後に前のトラックと同一内容の CUE が届き、その約 1ms 後に CUE がクリアされてから新しいトラックの値に更新された。受信した CUE を直前の Metrics の trackID と即座に関連付けると、前のトラックの CUE を一瞬だけ新しいトラックのものとして扱う。

### Time

2026-10-11 の観測では、`currentTimeMillis` と `beatMarker` には非ゼロの値が入り、`totalTimeMillis` だけが全 layer で常に 0 だった。トラックの長さは Metrics の `trackLength` から取得する。以前の記録では 3 つのフィールドがすべて 0 とされていたが、再検証した結果と異なる。

### SmallWaveForm

2026-10-11 の観測では、SmallWaveForm (DataType 16) の要求 23 件すべてに応答がなかった。応答しない条件と原因は確認できていない。

### BeatGrid と Artwork の破損

Bridge V1.1.8 は CDJ から分割して届くデータを、chunk ごとに 1368 バイト間隔の固定位置へ配置して TCNet に出力する。CDJ-3000 の chunk は 1368 バイトなので隙間なく連結される。CDJ-3000X の chunk は 1106 バイトなので各 chunk の後ろに 262 バイトのゼロが挟まり、BeatGrid と Artwork の内容が破損する。

2026-10-11 の PCAP 解析で、この配置を再現するモデルが CDJ-3000X の BeatGrid 47 転送の拍番号と時刻、Artwork 41 転送の全バイトと一致した。2026-10-12 には CDJ-3000 2 台で、CDJ から Bridge への分割転送 (PRO DJ LINK の type 0x56) の chunk が 1368 バイトであることを確かめた。このとき Bridge の出力は破損せず、BeatGrid は全拍の拍番号が連続し、Artwork は CDJ の入力とバイト単位で一致した。Bridge V1.1.8 (2024-11 公開) は CDJ-3000X (2025-09 発売) より前に公開されており、CDJ-3000X の chunk 長に対応していないと考えられる。Bridge 内部の実装は確認していない。

CDJ-3000X での破損の内容を示す。

- BeatGrid: 先頭 137 エントリは CDJ の入力と一致する。その後は 33 エントリ分がゼロになり、以降は 8 バイトのレコード境界がずれた値 (時刻の逆行やトラック長を超える値) になる。時刻の上位バイトが失われるため、ずれた部分は復元できない
- Artwork: JPEG の途中にゼロが挟まり、デコードはできるが画像が横帯状に破損する。全体の長さが 1368 の倍数になり、各 1368 バイトの先頭 1106 バイトをつなぐと CDJ の入力と同じ JPEG に戻る

CDJ を経由しない Artwork (同じ解析では 5702 バイトの画像 26 件) はこの配置にならず、破損しない。CDJ-3000 の Artwork も出力長は 1368 の倍数で、末尾はゼロで埋められる。長さだけでは破損を判定できないため、各 1368 バイトの 1106 バイト目以降がゼロかどうかで判定する。node-tcnet は受信したデータをそのまま返すため、破損の検出と復元は利用側で行う。

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

2026-10-11 に同一マシン上の Bridge で計測した Time の間隔は、中央値 20.0ms、99 パーセンタイル 23.8ms (約 50 回/sec) で、上表の値と異なる。

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
