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
| 13 | Error/Notification | 30 | 受信のみ。dataType/layerId/code/messageType構造化済み |
| 30 | Application Specific Data | 可変 | 送受信対応。TCNASDP認証のハンドシェイクに使用 |
| 204 | File | 可変 | 受信のみ。Artwork(JPEG)のファイル転送。マルチパケット対応 |
| 254 | Time | 154/162 | 受信のみ。OnAirセクション(V3.3.3+)の有無を自動判定。Timecodeセクション対応 |

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
| 8 | Beat Grid Data | 2442 | マルチパケット。MultiPacketAssemblerで自動組み立て。ヘッダー公開 |
| 12 | CUE Data | 436 | 最大18キュー、Loop In/Out Time |
| 16 | Small Wave Form | 2442 | 1200バーの波形データ。マルチパケットヘッダー公開 |
| 32 | Big Wave Form | 可変 | マルチパケット。MultiPacketAssemblerで自動組み立て。ヘッダー公開 |
| 128 | Artwork Data | 可変 | マルチパケット。JPEG形式。MultiPacketAssemblerで自動組み立て。ヘッダー公開 |
| 150 | Mixer Data | 270 | 6チャンネル対応 |

## 未実装DataPacketタイプ

なし (全DataPacketタイプを実装済み)

## 仕様との既知の差異

| 項目 | 仕様 | 実装 | 影響 |
|------|------|------|------|
| MetaData V3.4以前 | UTF-8(256文字) | 未対応(パケット破棄) | V3.5.0未満のノードからMetaDataを受信できない |
| Timeパケットサイズ | 162バイト(V3.3.3+) | 154または162バイト | buffer.lengthで自動判定しており、OnAir未対応ノードも正常に処理できる。Timecodeセクションは154バイト以上で読み取り |

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
| `failed` | 認証失敗 |

### 認証イベント

| イベント | 説明 |
|----------|------|
| `authenticated` | TCNASDP認証が成功した時に発火する |
| `authFailed` | TCNASDP認証が失敗した時に発火する |

### 認証セッションの維持 (反応型プロトコル)

Bridgeは認証セッションに約100秒の有効期限を設けているが、ライブラリは
ShowKontrolの実測挙動に基づく**反応型プロトコル**でセッションを継続的に
維持する。

動作概要。

1. 初回の認証が完了すると、Bridgeは周期的に`AppData cmd=1`を送って再認証を要求する
2. ライブラリは`authenticated`状態でcmd=1を受信すると、即座に`cmd=2 (auth)`
   のみを返送する (cmd=0 helloは不要)
3. この応答によりBridgeはセッション有効期限を延長する
4. 応答しないとBridgeはcmd=1をフラッドし始め、最終的にlicense timeoutで
   失効する

この仕組みは`xteaCiphertext`が設定されていれば自動的に動作し、
アプリケーション側で再認証のトリガーを管理する必要はない。

#### 検証済みの挙動

ShowKontrolのパケットキャプチャ (`sk-ext-capture.pcapng`, 223秒間) に基づき、
以下の挙動を確認している。

- 正常稼働時、Bridgeは12-90秒間隔でauthenticatedクライアントへcmd=1を送信する
- 223秒のキャプチャで8回の再認証サイクルが観測され、全て同一tokenで完結した
- ShowKontrolは1-10ms以内にcmd=2のみで応答しcmd=0 helloは伴わない
- クライアントが応答しないとBridgeはcmd=1のフラッドを開始し、約100秒後に
  license timeoutでセッションが失効する

#### 反応型プロトコルのフェイルセーフ

反応型プロトコルは単一障害を受け流すためのフェイルセーフを備える。

- `sendAuthCommandOnly`応答が連続2回失敗すると、セッション状態をリセットして
  次回のcmd=1で初回認証フローからやり直す (`AUTH_RESPONSE_FAILURE_THRESHOLD`)。
  このとき Bridge OS 検出結果 (`bridgeIsWindows`) は保持されるため、
  再認証時に無駄な ping を実行しない
- 単発の送信失敗では`authenticated`状態を維持する (瞬断耐性)
- `prepareAuthPayload`のガード失敗 (アダプタ未選択等) で実送信が行われなかった
  場合は、失敗カウンタを増減しない (silent failure 防止)
- Bridgeが想定外の異なるtokenを送信してきた場合、warnログを出力した上で
  防御的にtokenを更新する
- `detectBridgeIsWindows`は並行呼び出し時に in-flight Promise を共有する
  single-flight パターンを採用し、cmd=1 flood 下でも ping プロセスが
  重複起動しない

#### 既知の未検証シナリオ (Future work)

以下のシナリオは実装上の想定はあるが、実環境での検証はまだ行えていない。
追加の実測が得られ次第、仕様として固めていく予定である。

- **Bridge再起動後のtoken再発行**: Bridgeが再起動した際に新tokenを発行する
  タイミングと、クライアント側のリカバリ経路は未検証である
- **ネットワーク分断復旧後のリカバリ**: 短期の分断でcmd=1が途絶した後、
  復旧時にBridgeがどのタイミングでcmd=1送信を再開するかは未検証である
- **古いBridgeバージョン (V3.4以前) での挙動**: 反応型プロトコルを採用する前の
  ファームウェアでcmd=1が送信されるかは確認できていない

## 関連ページ

Bridge固有の制限は[[PRO DJ LINK Bridge]]を参照。
