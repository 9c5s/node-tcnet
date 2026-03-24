---
"@9c5s/node-tcnet": minor
---

ネットワークアダプタ自動検出・手動切り替え機能を追加

- `connect()` が全non-internal IPv4アダプタでlisten開始し即resolveするよう変更 (破壊的変更)
- Master OptIn検出で自動的にアダプタに収束
- `switchAdapter()` によるリトライ付き手動アダプタ切り替え
- `listNetworkAdapters()` / `findIPv4Address()` ヘルパー関数
- `selectedAdapter` / `isConnected` プロパティ
- `adapterSelected` / `detectionTimeout` イベント
