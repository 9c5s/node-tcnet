/**
 * changeset ファイルの検証スクリプトである
 *
 * pre-commit フックから呼び出され、ステージされた .changeset/*.md ファイルを検証する
 * 検証失敗時は exit 1 でコミットをブロックする
 */

import { readFileSync } from "fs";
import parse from "@changesets/parse";

const PACKAGE_NAME = "@9c5s/node-tcnet";
const VALID_TYPES = ["patch", "minor", "major"] as const;

/**
 * 1つの changeset ファイルを検証する
 * 検証失敗時は stderr にエラーを出力し、false を返す
 */
function validateChangeset(filePath: string): boolean {
    let content: string;
    try {
        content = readFileSync(filePath, "utf-8");
    } catch (err) {
        process.stderr.write(`ERROR [${filePath}]: ファイルを読み込めなかった: ${err}\n`);
        return false;
    }

    let parsed: ReturnType<typeof parse>;
    try {
        parsed = parse(content);
    } catch (err) {
        process.stderr.write(`ERROR [${filePath}]: frontmatter のパースに失敗した: ${err}\n`);
        return false;
    }

    // パッケージ名の検証
    const release = parsed.releases.find((r) => r.name === PACKAGE_NAME);
    if (release === undefined) {
        process.stderr.write(
            `ERROR [${filePath}]: パッケージ名 "${PACKAGE_NAME}" が見つからなかった\n` +
                `  releases: ${JSON.stringify(parsed.releases)}\n`,
        );
        return false;
    }

    // バージョン種別の検証 (none は不許可)
    const validTypes: ReadonlyArray<string> = VALID_TYPES;
    if (!validTypes.includes(release.type)) {
        process.stderr.write(
            `ERROR [${filePath}]: バージョン種別 "${release.type}" は不正である\n` +
                `  許可されている種別: ${VALID_TYPES.join(", ")}\n`,
        );
        return false;
    }

    // 説明文の検証 (空白・改行のみは不許可)
    if (parsed.summary.trim() === "") {
        process.stderr.write(`ERROR [${filePath}]: 説明文が空白・改行のみである\n`);
        return false;
    }

    // major の場合は警告を出力するが、コミットはブロックしない
    if (release.type === "major") {
        process.stderr.write(`WARNING [${filePath}]: major バージョンアップが指定されている\n`);
    }

    return true;
}

/**
 * メイン処理
 * コマンドライン引数で受け取った各ファイルを検証し、1つでも失敗したら exit 1 する
 */
function main(): void {
    const files = process.argv.slice(2);

    if (files.length === 0) {
        // 対象ファイルなし - 正常終了
        process.exit(0);
    }

    let allPassed = true;
    for (const file of files) {
        const passed = validateChangeset(file);
        if (!passed) {
            allPassed = false;
        }
    }

    if (!allPassed) {
        process.exit(1);
    }
}

main();
