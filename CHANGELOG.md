# @9c5s/node-tcnet

## 0.6.0

### Minor Changes

-   bd8b681: BREAKING CHANGE: `TCNetConfiguration.brodcastListeningAddress` を `broadcastListeningAddress` にリネーム (タイポ修正)

    `broadcastListeningAddress` のデフォルト値を `broadcastAddress` から `"0.0.0.0"` に変更

### Patch Changes

-   090bc6a: プロトコル実装のバグを修正

    -   OptIn パケットの writeUInt8 引数順序を修正 (バージョン情報が正しく送信されなかった)
    -   Windows 環境でブロードキャストアドレスが正しく計算されるよう修正
    -   デフォルトユニキャストポートを仕様準拠の 65023 に修正
    -   requestData()の 0-based layer index を 1-based ワイヤフォーマットに正しく変換するよう修正
    -   example の packet.layer 参照を 0-based API に合わせて修正

## 0.5.1

### Patch Changes

-   663a2a9: Allow simpler logger implementations

## 0.5.0

### Minor Changes

-   ffac14f: Make shutdown return a Promise

    More cleanly wait for the client's connections to shut-down by returning a
    promise that only resolves once the connection is closed.

-   e15a550: Improve parsing of TCNetTimePackets
-   d4179de: Remove pioneer module

    Removing the pioneer module and related exports as package should remain
    vendor-agnostic,
    and we don't want to keep this module maintained with the more
    disruptive changes we're making.

-   f8a2730: Improve interface for TCNetDataPacketMetrics
-   bc54603: Improve parsing of TCNetStatusPacket
-   81c75e4: Improve parsing of TCNetDataPacketMetadata
-   15e2ed3: Consistently use 0-based indexing for layer ID
-   db2eb59: Always emit data and broadcast events

    Ensure that data and broadcast packets are always accessible to listeners,
    even when the library hasn't added specific handling for it,
    or when we're receiving packets that aren't part of a request we've made.

## 0.4.0

### Minor Changes

-   Update build process and dependencies

## 0.3.1

### Patch Changes

-   Fix peer dependency version for pino

## 0.3.0

### Minor Changes

-   0212908: Remove usage of console, and introduce logging config using pino

## 0.2.0

First release independent of upstream

### Minor Changes

-   Allow for specifying a custom broadcast listening address
