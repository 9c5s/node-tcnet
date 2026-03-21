# PRO DJ LINK Bridge

PRO DJ LINK Bridgeは、Pioneer DJのCDJ/XDJをTCNetネットワークに接続するブリッジアプリケーションである。
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

以下のフィールドが0で返される。

- `BPM`
- `trackLength`
- `currentPosition`
- `speed`
- `beatNumber`
- `pitchBend`

### Time

以下のフィールドが0で返される。

- `currentTimeMillis`
- `totalTimeMillis`
- `beatMarker`

Metricsのbyte 45(RESERVED領域)に`0x1e`(=30)が入ることもある。SMPTEモード値と推測される。

## パケットタイミング

仕様値とBridgeの実測値の比較を示す。

| パケット | 仕様 | 実測 | 備考 |
|---------|------|------|------|
| OptIn | 1000ms毎 | 1000.0ms | 一致 |
| Status | 1000ms毎 | 約293ms(約3.4回/sec) | 仕様より高頻度 |
| Time | 1-40ms毎 | 約31ms(約25.6回/sec) | SMPTE 30fps相当 |
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

- Metricsの主要フィールド(BPM, speed等)はBridgeでは0が返される。これはBridge固有の制限であり、バグではない
- MetaDataのtrackID/trackKeyが0なのも同様である。トラックの識別にはStatusパケットのtrackIDを使用する
