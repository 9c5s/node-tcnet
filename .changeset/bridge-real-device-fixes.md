---
"@9c5s/node-tcnet": minor
---

Bridge 実機の挙動に合わせてマルチパケットの受信と Metrics の型を修正

- 最終パケットで clusterSize と実バッファ長が一致しない分割データを受け入れる
- BigWaveForm の末尾のゼロ埋めを削除し、byte 順を SmallWaveForm と逆にする
- unicast で届く Master の OptIn でもアダプタ検出が収束するようにする
- 要求待ちのない分割パケットを断片のまま `data` イベントで公開しないようにする
- `TCNetLayerStatus` に Bridge が転送する `LOADING` (2) と `ENDED` (17) を追加する

BREAKING CHANGE: `MetricsData.syncMaster` の型を `number` に変更
