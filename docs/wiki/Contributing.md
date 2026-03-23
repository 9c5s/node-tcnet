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
| `npm run format:fix` | Prettier (ts, json, jsonc, html, css) |
| `npm run format:check` | Prettierチェックのみ |
| `npm run mdlint` | markdownlint-cli2 |
| `npm run mdlint:fix` | markdownlint自動修正 |
| `npm run textlint` | textlint (docs/wiki配下) |
| `npm run textlint:fix` | textlint自動修正 |

## lefthook

Git hookをlefthookで管理している。`npx lefthook install`で有効化される。

### pre-commit

以下のジョブが並列実行される。

| ジョブ | 対象 | 内容 |
| --- | --- | --- |
| protect-branch | - | メインブランチへの直接コミットを禁止する |
| ignored-files | - | .gitignore対象ファイルのステージングを検出する |
| format | `**/*.{ts,json,jsonc,html,css}` | Prettierによる自動整形 |
| lint | `**/*.ts` (`.d.ts`除外) | ESLint |
| typecheck | - | `tsc --noEmit` |
| test | `**/*.ts` (`.d.ts`除外) | vitest実行 |
| build | - | tsupビルド |
| markdownlint | `**/*.{md,MD}` (`CHANGELOG.md`除外) | markdownlint |
| textlint | `docs/wiki/**/*.md` | textlint |
| actionlint | `.github/workflows/*.{yml,yaml}` | GitHub Actionsのlint |
| zizmor | `.github/{workflows,dependabot.yml}` | GitHub Actionsのセキュリティチェック |
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

## PR作成

このリポジトリは`chdxD1/node-tcnet`のフォークに当たる。
`gh pr create`のデフォルトはupstreamの`chdxD1/node-tcnet`に向くため、必ず`--repo`を指定する。

```bash
gh pr create --repo 9c5s/node-tcnet
```

## Windows環境の注意事項

lefthookをWindows環境で使用する場合、以下の制約がある。

- `run`値にダブルクォート(`"`)を含めるとコマンドパーサーが壊れる
- glob: `*.ts`はルートディレクトリのみにマッチする。サブディレクトリを含めるには`**/*.ts`を使用する
- 複数行スクリプトは`>`(fold)と`;`または`&&`で1行にまとめる。`|`(literal block)内の`$()`は動作しない
