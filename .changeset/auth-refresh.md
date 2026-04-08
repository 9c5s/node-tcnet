---
"@9c5s/node-tcnet": minor
---

feat: TCNASDP認証の自動リフレッシュ機能を追加

Bridgeの認証タイムアウト(~100秒)を回避するため、認証シーケンスを定期的に再実行してLICENSE: EXTを維持する。

- `AuthState`型に`"refreshing"`を追加
- `TCNetConfiguration`に`autoReauth`(デフォルト: true)と`reauthInterval`(デフォルト: 60000ms)を追加
- 公開`reauth()`メソッドを追加(手動リフレッシュ用、single-flight保証付き)
- `reauthenticated`/`reauthFailed`イベントを追加
