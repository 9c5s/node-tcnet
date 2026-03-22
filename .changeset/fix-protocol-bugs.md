---
"@9c5s/node-tcnet": patch
---

プロトコル実装のバグを修正

- OptInパケットのwriteUInt8引数順序を修正 (バージョン情報が正しく送信されなかった)
- Windows環境でブロードキャストアドレスが正しく計算されるよう修正
- デフォルトユニキャストポートを仕様準拠の65023に修正
- requestData()の0-based layer indexを1-basedワイヤフォーマットに正しく変換するよう修正
- sendServer()でbroadcastSocketを使用するよう修正 (BridgeはUDPポート60000からのリクエストのみ受付)
- receiveBroadcast()でMasterのOptIn検出を復元 (c2c1b7fで削除されていた)
- Requestタイムアウト管理を追加 (未応答リクエストによるメモリリークを防止)
- disconnect時にtimestampSocketを適切にクローズするよう修正
- exampleのpacket.layer参照を0-based APIに合わせて修正
