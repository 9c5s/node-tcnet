---
"@9c5s/node-tcnet": minor
---

全DataPacketタイプの専用パケットクラスを実装し、SmallWaveFormData/CUEData等のリクエストタイムアウトを修正

- TCNetDataPacketCUE: CUEデータのパース (436B)
- TCNetDataPacketSmallWaveForm: 小波形データのパース (2442B)
- TCNetDataPacketBigWaveForm: 大波形データのパース (可変長, マルチパケット対応)
- TCNetDataPacketBeatGrid: ビートグリッドデータのパース (2442B, マルチパケット対応)
- TCNetDataPacketMixer: ミキサーデータのパース (270B)
- MultiPacketAssembler: マルチパケット組み立てクラス
- receiveUnicastのマルチパケットアセンブリ対応
