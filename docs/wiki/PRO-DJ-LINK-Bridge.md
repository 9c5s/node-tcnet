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

「2026-10-11 の観測」と記した項目は、同一マシン上の Bridge V1.1.8 と CDJ-3000X の組み合わせで得た結果である。「2026-10-12 の観測」と記した項目は、Windows 上の Bridge V1.1.8 と CDJ-3000 2 台の組み合わせで 1 時間記録した結果である。player 2 は USB、player 3 は rekordbox からトラックを読み込み、TCNet クライアントは同じ PC 上で動かした。

### Status

#### nodeCount (Windows 版)

2026-10-12 の観測では、Windows 版の Bridge で Status の nodeCount (byte 24-25) が TCNet クライアントの参加後から 5 秒ごとに 1 ずつ増え、最大 140 まで達した。nodeCount はときどき約 2 秒間隔で半分ずつ減り、その間は Time パケットの送信が 2〜4 秒止まった。Time の送信が止まった 8 回は、すべて nodeCount の半減と同時だった。Mac 版の Bridge では、2026-10-11 の観測で nodeCount は 2 のまま変わらなかった。

### MetaData

- `trackID` = 0
- `trackKey` = 0

StatusパケットのtrackIDは正常に返される。MetaDataのtrackIDが必要な場合はStatusパケットの値を使用する。

トラックのロード直後の要求には、空の title で応答することがある。2026-10-11 の観測では 47 件中 24 件が空の title で、ロードから約 1.7 秒後に空でない title の応答を受けた例もある。空の応答を受けた場合は時間を置いて再要求する。2026-10-12 の観測では 132 件中 38 件が空の title で、トラック ID の変化から空でない title を受けるまでの時間は中央値 0.7 秒、最大 1.5 秒だった。

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

2026-10-11 の観測では、17 が約 830ms 続いた後に 5 (PAUSED) へ遷移する例もあった。2026-10-12 の観測では、Metrics の layerState が CDJ ステータスの再生状態と 99.5% 一致し、一致しないのは状態が切り替わる前後だけだった。

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

2026-10-12 の観測では、speed は CDJ ステータスの byte 0x98 にある 4 バイトのピッチ値 (0x100000 = 等速) と 99% 一致した。Bridge は CDJ のピッチ値をそのまま転送していると考えられる。トラックの読み込み中など、CDJ 側の値が 0 のときは speed も 0 になる。

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

CUE パケットには trackID が含まれない。2026-10-11 の観測では、新しいトラックの Metrics が届いた約 1ms 後に前のトラックと同一内容の CUE が届き、その約 1ms 後に CUE がクリアされてから新しいトラックの値に更新された。受信した CUE を直前の Metrics の trackID と即座に関連付けると、前のトラックの CUE を一瞬だけ新しいトラックのものとして扱う。2026-10-12 の観測では、トラック切替後の最初の CUE が前のトラックと同じ内容だったのは 25 回中 2 回だった。

### Time

2026-10-11 の観測では、`currentTimeMillis` と `beatMarker` には非ゼロの値が入り、`totalTimeMillis` だけが全 layer で常に 0 だった。トラックの長さは Metrics の `trackLength` から取得する。以前の記録では 3 つのフィールドがすべて 0 とされていたが、再検証した結果と異なる。2026-10-12 の観測 (CDJ-3000) でも `totalTimeMillis` は常に 0 だった。Windows 版の Bridge では、Time の送信が 2〜4 秒止まる場合もある (Status の nodeCount を参照)。

### SmallWaveForm

2026-10-11 の観測では、SmallWaveForm (DataType 16) の要求 23 件すべてに応答がなかった。2026-10-12 の観測 (CDJ-3000) では、要求 27 件すべてに応答があった。応答しないのは CDJ-3000X と組み合わせたときだけの可能性がある。

### トラック読み込み直後の送信

Bridge はトラックの読み込み直後、要求がなくても CUE、BeatGrid、SmallWaveForm、BigWaveForm、Artwork、MetaData を送る。この送信の最中に同じデータを要求すると、Bridge は同じデータをもう 1 回送って応答する。2026-10-12 の観測では、1 時間の要求 234 件すべてに応答があった。MetaData と BigWaveForm の応答は、要求から最大約 1 秒遅れる。

node-tcnet は要求に対応しない分割データ (BeatGrid、BigWaveForm、Artwork) を破棄するため、これらの要求なしの送信は `data` イベントに現れない。

### CDJ からのデータ取得

Bridge は PRO DJ LINK の UDP 50002 番で CDJ にトラックのデータを要求し (type 0x55)、CDJ はデータを chunk に分けて返す (type 0x56)。2026-10-12 の観測では TCP の通信はなかった。同じ観測で確認した type 0x56 の構成を示す。

| byte | 内容 |
|------|------|
| 37 | データ種別 (2 = Artwork、4 = 波形、6 = BeatGrid など) |
| 48-49 | chunk 番号 (big endian) |
| 51 | chunk の総数 |
| 52- | データ (1 chunk あたり CDJ-3000 は最大 1368 バイト、CDJ-3000X は最大 1106 バイト) |

type 0x55 の byte 0x28 も同じデータ種別を表す。トラックの読み込みごとに、Bridge は種別 5、2、6、4、3、1、2 の順に要求する。BeatGrid のデータは 8 バイトのヘッダの後に拍ごとの 8 バイトのレコード (小節内の位置、テンポ、時刻。big endian) が並び、Bridge は拍番号を付けて TCNet の形式に変換する。

### BeatGrid と Artwork の破損

Bridge V1.1.8 は CDJ から分割して届くデータを、chunk ごとに 1368 バイト間隔の固定位置へ配置して TCNet に出力する。CDJ-3000 の chunk は 1368 バイトなので隙間なく連結される。CDJ-3000X の chunk は 1106 バイトなので各 chunk の後ろに 262 バイトのゼロが挟まり、BeatGrid と Artwork の内容が破損する。

2026-10-11 の PCAP 解析で、この配置を再現するモデルが CDJ-3000X の BeatGrid 47 転送の拍番号と時刻、Artwork 41 転送の全バイトと一致した。2026-10-12 には CDJ-3000 2 台で、CDJ から Bridge への分割転送 (PRO DJ LINK の type 0x56) の chunk が 1368 バイトであることを確かめた。このとき Bridge の出力は破損せず、BeatGrid は全拍の拍番号が連続し、Artwork は CDJ の入力とバイト単位で一致した。Bridge V1.1.8 (2024-11 公開) は CDJ-3000X (2025-09 発売) より前に公開されており、CDJ-3000X の chunk 長に対応していないと考えられる。Bridge 内部の実装は確認していない。

CDJ-3000X での破損の内容を示す。

- BeatGrid: 先頭 137 エントリは CDJ の入力と一致する。その後は 33 エントリ分がゼロになり、以降は 8 バイトのレコード境界がずれた値 (時刻の逆行やトラック長を超える値) になる。時刻の上位バイトが失われるため、ずれた部分は復元できない
- Artwork: JPEG の途中にゼロが挟まり、デコードはできるが画像が横帯状に破損する。全体の長さが 1368 の倍数になり、各 1368 バイトの先頭 1106 バイトをつなぐと CDJ の入力と同じ JPEG に戻る

CDJ を経由しない Artwork (同じ解析では 5702 バイトの画像 26 件。後述の代わりの画像) はこの配置にならず、破損しない。CDJ-3000 の Artwork も出力長は 1368 の倍数で、末尾はゼロで埋められる。長さだけでは破損を判定できないため、各 1368 バイトの 1106 バイト目以降がゼロかどうかで判定する。node-tcnet は受信したデータをそのまま返すため、破損の検出と復元は利用側で行う。

#### CDJ-3000 の chunk の順序による欠け

2026-10-12 の観測では、CDJ-3000 は分割転送の chunk を番号順に送らないことが多かった (BeatGrid は 25 転送中 14、Artwork は 22 転送中 14)。順序の入れ替わりにより、Bridge の出力には次の 2 種類の欠けが生じた。欠けた chunk の範囲はゼロで埋められ、それ以外の範囲は CDJ の入力と一致した。

- chunk 0 より前に届いた chunk は失われ、再要求しても戻らない (BeatGrid 4 曲、Artwork 1 曲)
- トラック読み込み直後の要求なしの送信では、一部の chunk がゼロのことがある (BeatGrid 2 件、Artwork 6 件)。欠けた chunk の多くは、番号が最大の chunk より後に届いたものだった。その後の要求への応答には、この欠けはない

BeatGrid では 1 chunk が 171 拍に当たる。CDJ-3000X の破損と異なり、欠けた区間の後ろの拍は正しいため、前後の拍から欠けた区間を補間できる。

### Artwork の代わりの画像

Bridge は CDJ からアートワークを受け取れなかったとき、灰色の円盤を描いた 200x200 の代わりの画像を Artwork として返す。トラックを取り出したときにも同じ画像を送る。画像のバイト列は Windows 版 (2454 バイト) と Mac 版 (5702 バイト) で異なる。

2026-10-12 の観測では、アートワークのある曲でも代わりの画像になることがあった (読み込み 25 回中 3 回、すべて rekordbox から読み込んだ曲)。Bridge は読み込み中、トラック ID 0 のまま CDJ に種別 1 の要求を出すことがある。その応答が新しい曲の要求の後に届くと、Bridge は最後に出す種別 1 と 2 回目の Artwork の要求を省略し、CDJ から画像を受け取らない。rekordbox から読み込んだ曲は読み込みに時間がかかる (中央値約 0.6 秒、USB は約 0.25 秒) ため、この要求が出やすい。要求し直しても同じ画像が返るため、利用側では代わりの画像をアートワークなしとして扱う。

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

2026-10-11 に同一マシン上の Bridge で計測した Time の間隔は、中央値 20.0ms、99 パーセンタイル 23.8ms (約 50 回/sec) で、上表の値と異なる。2026-10-12 に Windows 上の Bridge で計測した Time の間隔は中央値 31.3ms で、上表の値と一致した。この差が CDJ の機種によるものか、Bridge の OS によるものかは確認していない。

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
