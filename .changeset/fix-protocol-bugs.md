---
"@9c5s/node-tcnet": patch
---

プロトコル実装のバグを修正

- OptInパケットのwriteUInt8引数順序を修正 (バージョン情報が正しく送信されなかった)
- Windows環境でブロードキャストアドレスが正しく計算されるよう修正
- デフォルトユニキャストポートを仕様準拠の65023に修正
- requestData()の0-based layer indexを1-basedワイヤフォーマットに正しく変換するよう修正
- exampleのpacket.layer参照を0-based APIに合わせて修正
