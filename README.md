<h1 align="center">
  <img src="assets/Shirakawa-logo.png" width="480" alt="Shirakawa">
</h1>

<p align="center">
  Xのタイムラインを自分の言葉で整えるブラウザー拡張機能
</p>

<p align="center">
  <a href="https://github.com/midorisawa/Shirakawa/actions/workflows/release.yml"><img src="https://github.com/midorisawa/Shirakawa/actions/workflows/release.yml/badge.svg?branch=main" alt="Build and test"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-6b7785.svg" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/version-0.1.3-506b82.svg" alt="Version 0.1.3">
</p>

Shirakawaは、投稿の表示条件を自然な言葉でルール化し、Xのタイムラインを自分好みに調整できるChrome／Edge拡張機能です。Jevが投稿本文と設定したルールを照らし合わせ、条件に合う投稿を自動で非表示にします。

## 表示の変化

| ルール適用前 | ルール適用後 |
|:---:|:---:|
| ![ルール適用前のXタイムライン](assets/screenshots/store-filter-off.png) | ![ルール適用後のXタイムライン](assets/screenshots/store-filter-on.png) |

## できること

- **言葉で表示条件を指定** — 「特定の人物への誹謗中傷を非表示」「趣味の話題は表示」のように、自然な文章で表示・非表示の条件を設定できます。
- **判定の微調整** — ルールごとに有効・無効や判定のしきい値を設定できるほか、判定理由とスコアを確認できます。
- **利用量の管理** — APIの使用量や概算費用を確認し、期間ごとの利用上限を設定できます。
- **判定結果のキャッシュ** — 判定結果を最大30日間キャッシュし、同じ投稿に対する無駄な再判定を減らします。
- **ルールの持ち運び** — 設定したルールをJSON形式でエクスポートし、別の環境へ手軽に引き継げます。

## はじめかた

### 1. APIキーを用意する

投稿の判定にはJevを使用します。接続先として[TypeSafe AI](https://typesafe.ai)または[OpenRouter](https://openrouter.ai/)を選択し、各サービスでAPIキーを取得してください。利用料金は各サービスの規定に従います。

### 2. Shirakawaをインストールする

[GitHub Releases](https://github.com/midorisawa/Shirakawa/releases)からZIPファイルをダウンロードして展開します。ChromeまたはEdgeの拡張機能管理画面で開発者モードを有効にし、「パッケージ化されていない拡張機能を読み込む」から、`manifest.json`が含まれるフォルダーを選択してください。

### 3. APIキーとルールを設定する

拡張機能の設定画面を開き、APIの接続先とキーを登録した上で、表示・非表示にしたい投稿の条件を追加します。設定を保存すると、Xのタイムライン上で自動判定が始まります。

## 設定画面

接続先、ルール、使用量、判定キャッシュをタブごとに管理できます。

<p align="center">
  <img src="assets/screenshots/window_rule-tab.png" width="49%" alt="ルール設定画面">
  <img src="assets/screenshots/window_usage-tab.png" width="49%" alt="API使用量の確認画面">
</p>

## 開発者向け

Node.jsとpnpmを用意して、以下を実行します。

```sh
git clone https://github.com/midorisawa/Shirakawa.git
cd Shirakawa
pnpm install
pnpm test
pnpm build
```

ビルド後は、拡張機能管理画面から`dist`フォルダーを読み込むことで利用できます。

## ライセンス

本体のコードは[MIT License](LICENSE)のもとで提供されます。サードパーティ製素材の権利表示およびライセンス条件は[THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt)をご確認ください。

---
- 判定の対象は投稿本文のみです。画像・動画やリンク先の内容は判定されません。
- 判定のため、投稿本文、設定した条件、APIキー、選択したモデル情報がブラウザーから各APIサービスへ直接送信されます。開発者のサーバーを経由することはありません。
- APIキーやルール、判定結果、使用量データはブラウザー内に保存されます。詳細は[プライバシーポリシー](docs/PRIVACY.md)をご確認ください。
- AIによる判定は必ずしも完全ではありません。必要に応じて条件やしきい値を調整してください。
---