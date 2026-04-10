# @9c5s/node-tcnet

## 0.9.0

### Minor Changes

- 1dccc2c: fix: アートワーク取得の信頼性改善とクラスタサイズ0対応

    BREAKING CHANGE: CueData.loopOutTimeを削除(byte 46-49がCUE 1と重複し信頼できない値のため)

- 559f137: fix: Bridgeの再認証要求(cmd=1)に応答して認証セッションを継続維持する

### Patch Changes

- b6748a6: fix: Windows BridgeのXTEA暗号文バイトリバースに対応
- 0595019: fix: PitchBendの型をInt16LEからUInt16LEに修正し、波形データのバイト順を仕様に準拠させる
- 01ab150: fix: pending状態のcmd=1にも反応型プロトコルで応答し初回認証を高速化

## 0.8.0

### Minor Changes

- 6eb8cdb: TCNASDP 認証プロトコルと Artwork データ受信の実装
    - FNV-1a Int32 ハッシュによる認証ペイロード生成 (`generateAuthPayload`)
    - `xteaCiphertext` 設定時に TCNASDP 認証を自動実行し、全 8 データタイプの受信を有効化
    - File (Type=204) / Artwork (DataType=128) パケットのマルチパケット受信対応
    - Error (Type=13) / ApplicationData (Type=30) パケットの実装
    - 認証パケットの送信元 IP 検証、認証シーケンス中断時の状態リセット

## 0.7.0

### Minor Changes

- 8e46d2d: ネットワークアダプタ自動検出・手動切り替え機能を追加
    - `connect()` が全 non-internal IPv4 アダプタで listen 開始し即 resolve するよう変更 (破壊的変更)
    - Master OptIn 検出で自動的にアダプタに収束
    - `switchAdapter()` によるリトライ付き手動アダプタ切り替え
    - `listNetworkAdapters()` / `findIPv4Address()` ヘルパー関数
    - `selectedAdapter` / `isConnected` プロパティ
    - `adapterSelected` / `detectionTimeout` イベント

- 9ec051b: TypeScript 5.x モダナイゼーション: strict: true 移行、enum → as const オブジェクト変換、satisfies 適用
- b92e449: TypeDoc による API ドキュメント自動生成を導入

### Patch Changes

- a2a6c07: test: 実機テストの開発フローへの組み込み (#33)
- b891db8: デフォルトの nodeName/vendorName/appName を現オーナー向けに修正
- b1e4c6a: ESLint 9 flat config 移行と eslint-plugin-jsdoc による JSDoc カバレッジ自動検証を導入

## 0.6.0

### Minor Changes

- 31a2597: 全 DataPacket タイプの専用パケットクラスを実装し、SmallWaveFormData/CUEData 等のリクエストタイムアウトを修正
    - TCNetDataPacketCUE: CUE データのパース (436B)
    - TCNetDataPacketSmallWaveForm: 小波形データのパース (2442B)
    - TCNetDataPacketBigWaveForm: 大波形データのパース (可変長, マルチパケット対応)
    - TCNetDataPacketBeatGrid: ビートグリッドデータのパース (2442B, マルチパケット対応)
    - TCNetDataPacketMixer: ミキサーデータのパース (270B)
    - MultiPacketAssembler: マルチパケット組み立てクラス
    - receiveUnicast のマルチパケットアセンブリ対応

- bd8b681: `TCNetConfiguration.brodcastListeningAddress` を
  `broadcastListeningAddress` にリネーム (タイポ修正)

    `broadcastListeningAddress` のデフォルト値を `broadcastAddress` から `"0.0.0.0"` に変更

### Patch Changes

- 090bc6a: プロトコル実装のバグを修正
    - OptIn パケットの writeUInt8 引数順序を修正 (バージョン情報が正しく送信されなかった)
    - Windows 環境でブロードキャストアドレスが正しく計算されるよう修正
    - デフォルトユニキャストポートを仕様準拠の 65023 に修正
    - requestData()の 0-based layer index を 1-based ワイヤフォーマットに正しく変換するよう修正
    - sendServer()で broadcastSocket を使用するよう修正 (Bridge は UDP ポート 60000 からのリクエストのみ受付)
    - receiveBroadcast()で Master の OptIn 検出を復元 (c2c1b7f で削除されていた)
    - Request タイムアウト管理を追加 (未応答リクエストによるメモリリークを防止)
    - disconnect 時に timestampSocket を適切にクローズするよう修正
    - example の packet.layer 参照を 0-based API に合わせて修正

## 0.5.1

### Patch Changes

- 663a2a9: Allow simpler logger implementations

## 0.5.0

### Minor Changes

- ffac14f: Make shutdown return a Promise

    More cleanly wait for the client's connections to shut-down by returning a
    promise that only resolves once the connection is closed.

- e15a550: Improve parsing of TCNetTimePackets
- d4179de: Remove pioneer module

    Removing the pioneer module and related exports as package should remain
    vendor-agnostic,
    and we don't want to keep this module maintained with the more
    disruptive changes we're making.

- f8a2730: Improve interface for TCNetDataPacketMetrics
- bc54603: Improve parsing of TCNetStatusPacket
- 81c75e4: Improve parsing of TCNetDataPacketMetadata
- 15e2ed3: Consistently use 0-based indexing for layer ID
- db2eb59: Always emit data and broadcast events

    Ensure that data and broadcast packets are always accessible to listeners,
    even when the library hasn't added specific handling for it,
    or when we're receiving packets that aren't part of a request we've made.

## 0.4.0

### Minor Changes

- Update build process and dependencies

## 0.3.1

### Patch Changes

- Fix peer dependency version for pino

## 0.3.0

### Minor Changes

- 0212908: Remove usage of console, and introduce logging config using pino

## 0.2.0

First release independent of upstream

### Minor Changes

- Allow for specifying a custom broadcast listening address
