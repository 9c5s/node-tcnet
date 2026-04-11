---
"@9c5s/node-tcnet": patch
---

pitchBendを符号付き16bitで読み取るよう修正

`readUInt16LE`を`readInt16LE`に変更し、負のピッチ値が正しく負の数値として返されるようにした。
