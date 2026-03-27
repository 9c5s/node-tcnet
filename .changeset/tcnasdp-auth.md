---
"@9c5s/node-tcnet": minor
---

TCNASDP認証プロトコルとArtworkデータ受信の実装

- FNV-1a Int32ハッシュによる認証ペイロード生成 (`generateAuthPayload`)
- `xteaCiphertext` 設定時にTCNASDP認証を自動実行し、全8データタイプの受信を有効化
- File (Type=204) / Artwork (DataType=128) パケットのマルチパケット受信対応
- Error (Type=13) / ApplicationData (Type=30) パケットの実装
- 認証パケットの送信元IP検証、認証シーケンス中断時の状態リセット
