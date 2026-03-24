# Contributing

## 開発環境

- Node.js 24.x
- npm

## セットアップ

```bash
git clone https://github.com/9c5s/node-tcnet.git
cd node-tcnet
npm install
npx lefthook install
```

## ビルド

tsupでビルドする。

```bash
npm run build
```

## lint / format

| コマンド | 内容 |
| --- | --- |
| `npm run lint` | ESLint (TypeScript) |
| `npm run format:fix` | Prettier (ts, js, mjs, json, jsonc) |
| `npm run format:check` | Prettierチェックのみ |
| `npm run mdlint` | markdownlint-cli2 |
| `npm run mdlint:fix` | markdownlint自動修正 |
| `npm run textlint` | textlint (docs/wiki配下) |
| `npm run textlint:fix` | textlint自動修正 |
| `npm run docs` | TypeDocでAPIドキュメントを生成 |
| `npm run docs:watch` | TypeDoc (ファイル監視モード) |

## lefthook

Git hookをlefthookで管理している。`npx lefthook install`で有効化される。

### pre-commit

以下のジョブが実行される。stage_fixedを持つジョブの競合を防ぐため、code-styleグループ (format → lint) とci-lintグループ (zizmor → actionlint) はグループ内で逐次実行される。その他のジョブは並列実行される。

| ジョブ | 対象 | 内容 |
| --- | --- | --- |
| protect-branch | - | メインブランチへの直接コミットを禁止する |
| ignored-files | - | .gitignore対象ファイルのステージングを検出する |
| **code-style** (group, 逐次実行) | | |
| ├ format | `**/*.{ts,js,mjs,json,jsonc}` | Prettierによる自動整形 |
| └ lint | `**/*.ts` (`.d.ts`除外) | ESLint |
| typecheck | `**/*.ts`, `tsconfig.json` | `tsc --noEmit` |
| test | `**/*.ts` (`.d.ts`除外) | vitest実行 (ユニットテストのみ、E2E除外) |
| build | `**/*.ts`, `tsconfig.json` | tsupビルド |
| markdownlint | `**/*.{md,MD}` (`CHANGELOG.md`除外) | markdownlint |
| textlint | `docs/wiki/**/*.md`, `README.MD` | textlint |
| **ci-lint** (group, 逐次実行) | | |
| ├ zizmor | `.github/{workflows/*.{yml,yaml},dependabot.yml}` | GitHub Actionsのセキュリティチェック |
| └ actionlint | `.github/workflows/*.{yml,yaml}` | GitHub Actionsのlint |
| lefthook | `lefthook.yml` | lefthook設定のバリデーション |
| changeset-validate | `.changeset/*.md` | changesetファイルのバリデーション |

### commit-msg

| ジョブ | 内容 |
| --- | --- |
| commitlint | Conventional Commitsへの準拠チェック |

## コミット規約

[Conventional Commits v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)に準拠する。

commitlintで自動検証される。`subject-case`ルールは無効化しているため、subjectの大文字/小文字は問わない。

```text
feat: 新機能の説明
fix: バグ修正の説明
docs: ドキュメント変更の説明
```

## changeset

リリースノートの管理に[changesets](https://github.com/changesets/changesets)を使用する。

```bash
npx changeset
```

対話形式でパッケージとバージョン種別を選択する。

| 種別 | 用途 |
| --- | --- |
| patch | バグ修正、軽微な変更 |
| minor | 後方互換性のある機能追加 |
| major | 破壊的変更 |

## テスト

### ユニットテスト

```bash
npm run test
```

モックベースのユニットテストを実行する。pre-commitフックで自動実行される。

### E2Eテスト (実機テスト)

```bash
npm run test:e2e
```

実機のPro DJ Link Bridgeとネットワーク接続を使用するE2Eテストを実行する。テストスクリプトがBridgeの起動・停止を自動制御する。

#### 前提条件

- [Pro DJ Link Bridge](https://www.pioneerdj.com/ja-jp/landing/pro-dj-link-bridge/)がインストール済みであること。
- TCNet対応機器(CDJ等)がネットワーク上に存在すること。
- テスト実行前にBridgeが停止していること(テストが自動起動する)。

#### 設定カスタマイズ

プロジェクトルートに`.env.e2e`ファイルを作成して設定を上書きできる。`.env.e2e.example`をテンプレートとして参照。

| 設定項目 | デフォルト値 | 説明 |
| --- | --- | --- |
| `TCNET_BRIDGE_PATH` | `C:\Program Files\AlphaTheta\PRO DJ LINK Bridge\PRO DJ LINK Bridge.exe` | Bridge実行ファイルのパス |
| `TCNET_TEST_INTERFACE` | (自動検出) | テスト対象のネットワークインターフェース名 |

#### CIでの実行

E2EテストはネットワークアダプタとPro DJ Link Bridgeに依存するため、CI環境では実行できない。ローカル環境でのみ実行する。

#### トラブルシューティング

| 症状 | 対処 |
| --- | --- |
| Bridge起動タイムアウト | Bridgeのインストールパスを確認する。`.env.e2e`で`TCNET_BRIDGE_PATH`を設定する |
| ポート競合 | 他のTCNetアプリケーションが起動していないか確認する |
| アダプタ検出失敗 | `.env.e2e`で`TCNET_TEST_INTERFACE`を明示指定する |

## PR作成

```bash
gh pr create
```

## Windows環境の注意事項

lefthookをWindows環境で使用する場合、以下の制約がある。

- `run`値にダブルクォート(`"`)を含めるとコマンドパーサーが壊れる
- glob: `*.ts`はルートディレクトリのみにマッチする。サブディレクトリを含めるには`**/*.ts`を使用する
- 複数行スクリプトは`>`(fold)と`;`または`&&`で1行にまとめる。`|`(literal block)内の`$()`は動作しない
- `glob_matcher: doublestar`を設定している。`**`は0個以上のディレクトリにマッチする (デフォルトの`gobwas`では1個以上)
