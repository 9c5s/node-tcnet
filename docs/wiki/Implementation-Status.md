# Implementation Status

node-tcnetにおけるTCNet V3.5.1B仕様の実装状況をまとめる。

## 実装済みメッセージ

| Type | 名称 | サイズ | 備考 |
|------|------|--------|------|
| 2 | OptIn | 68 | 送受信対応 |
| 3 | OptOut | 28 | 送受信対応 |
| 5 | Status | 300 | 受信のみ |
| 20 | Request | 26 | 送信のみ |
| 200 | Data | 可変 | 受信のみ(DataTypeによる) |
| 13 | Error/Notification | 30 | 受信のみ。TCNASDP認証応答の判定に使用 |
| 30 | Application Specific Data | 可変 | 送受信対応。TCNASDP認証のハンドシェイクに使用 |
| 204 | File | 可変 | 受信のみ。Artwork(JPEG)のファイル転送。マルチパケット対応 |
| 254 | Time | 154/162 | 受信のみ。OnAirセクション(V3.3.3+)の有無を自動判定する |

## 未実装メッセージ

| Type | 名称 | サイズ | 備考 |
|------|------|--------|------|
| 10 | Time Sync | 32 | ノード間タイムシンク |
| 101 | Control | 42+DataSize | レイヤー制御コマンド |
| 128 | Text Data | 42+DataSize | テキストデータ |
| 132 | Keyboard Data | 44 | キーボード入力 |

## 実装済みDataPacketタイプ

| DataType | 名称 | サイズ | 備考 |
|----------|------|--------|------|
| 2 | Metrics Data | 122 | BPM, Speed, Position等 |
| 4 | Meta Data | 548 | Artist, Title, TrackID。V3.5.0+のUTF-16LEに対応 |
| 8 | Beat Grid Data | 2442 | マルチパケット。MultiPacketAssemblerで自動組み立て |
| 12 | CUE Data | 436 | 最大18キュー、Loop In/Out Time |
| 16 | Small Wave Form | 2442 | 1200バーの波形データ |
| 32 | Big Wave Form | 可変 | マルチパケット。MultiPacketAssemblerで自動組み立て |
| 128 | Artwork Data | 可変 | マルチパケット。JPEG形式。MultiPacketAssemblerで自動組み立て |
| 150 | Mixer Data | 270 | 6チャンネル対応 |

## 未実装DataPacketタイプ

なし (全DataPacketタイプを実装済み)

## 仕様との既知の差異

| 項目 | 仕様 | 実装 | 影響 |
|------|------|------|------|
| MetaData V3.4以前 | UTF-8(256文字) | 未対応(パケット破棄) | V3.5.0未満のノードからMetaDataを受信できない |
| Pitch Bend | UInt16LE(0-65535, 32768=100%) | Int16LE(符号付き) | 32768以上の値が負数として解釈される |
| Timeパケットサイズ | 162バイト(V3.3.3+) | 154または162バイト | buffer.lengthで自動判定しており、OnAir未対応ノードも正常に処理できる |

## TCNASDP認証

CUE/BeatGrid/BigWaveForm/Artwork等のデータ取得に必要なTCNASDP認証を実装している。

### 認証フロー

1. `xteaCiphertext`を設定して`connect()`を呼ぶと、OptInの`nodeOptions`が`0x0007`に設定される
2. MasterからAppData cmd=1でセッショントークンを受信する
3. cmd=0 (hello) をブロードキャスト送信する
4. cmd=2 (認証) でFNV-1a認証ペイロードとXTEA暗号文を送信する
5. Error/Notificationパケットで認証成否を判定する

### 設定項目

| プロパティ | デフォルト | 説明 |
|------------|-----------|------|
| `TCNetConfiguration.xteaCiphertext` | `undefined` | XTEA暗号文 (16桁hex文字列)。設定時にTCNASDP認証を実行する。環境変数`TCNET_XTEA_CIPHERTEXT`で上書き可能 |

### 認証状態

`TCNetClient.authenticationState`プロパティで認証状態を取得できる。

| 状態 | 説明 |
|------|------|
| `none` | 認証未開始 |
| `pending` | 認証シーケンス送信済み、応答待ち |
| `authenticated` | 認証成功 |
| `refreshing` | 認証リフレッシュ中 (再認証シーケンスを実行中) |
| `failed` | 認証失敗 |

### 認証イベント

| イベント | 説明 |
|----------|------|
| `authenticated` | TCNASDP認証が成功した時に発火する |
| `authFailed` | TCNASDP認証が失敗した時に発火する |
| `reauthenticated` | 認証リフレッシュが成功した時に発火する |
| `reauthFailed` | 認証リフレッシュが失敗した時に発火する |

### 認証の自動リフレッシュ

Bridgeは認証セッションに約100秒の有効期限を設けている。`autoReauth`を有効にすると（デフォルトで有効）、ライブラリが自動的に認証を更新して`LICENSE: EXT`を維持する。

```typescript
const config = new TCNetConfiguration();
config.xteaCiphertext = "your-xtea-ciphertext";
config.autoReauth = true;        // デフォルト: true
config.reauthInterval = 60_000;  // デフォルト: 60000ms (60秒)
```

手動で認証を更新する場合は`reauth()`メソッドを使用する。

```typescript
await client.reauth();
```

## 関連ページ

Bridge固有の制限は[[PRO DJ LINK Bridge]]を参照。
