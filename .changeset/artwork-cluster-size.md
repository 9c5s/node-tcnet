---
"@9c5s/node-tcnet": patch
---

fix: アートワーク取得の信頼性改善とクラスタサイズ0対応

- FileパケットのclusterSize=0対応とアートワークデータ抽出の修正
- CUEデータパーサーのbyte offset修正とloopOutTime削除(byte重複)
- ソケット共有設計のサブネットフィルタリングとlongest prefix match
- JPEG SOIマーカー検証、fileChunksメモリ上限、requestTimeout上限の追加
- ipToNumber入力検証強化とgetClusterEndユーティリティ統一

BREAKING CHANGE: CueData.loopOutTimeを削除(byte 46-49がCUE 1と重複し信頼できない値のため)
