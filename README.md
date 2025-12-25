# KarmaDescent App

FastAPI（バックエンド）と React Native / Expo（フロントエンド）を組み合わせた、徳（Karma）を可視化するアプリケーションのプロトタイプです。

## 🛠 プロジェクト構成
- **KarmaDescentAPI**: FastAPI を使用した REST API。Firebase Authentication との連携機能を実装中。
- **KarmaDescentApp**: React Native (Expo) によるモバイルフロントエンド。

## 🚧 現在の状態 (Work In Progress)
現在はプロトタイプ段階であり、以下の技術検証をメインに行っています。
- 非同期処理におけるスレッド制御 (`run_in_threadpool`)
- Firebase Auth を用いたユーザー認証基盤の構築
- API とフロントエンドの統合テスト