<div align="center">

# ⚡ PageFlow AI

**コピペ業務、ゼロへ。** Chrome の右上から 1 クリックで、社内システムへの泥臭い転記・経費入力・予定確保を自動化する Manifest V3 拡張機能です。

[![tests](https://img.shields.io/badge/tests-25%20passed-brightgreen)](tests/run_tests.js)
[![manifest](https://img.shields.io/badge/Manifest-V3-blue)](PageFlowAI/manifest.json)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)

</div>

---

## できること

| 機能 | 概要 |
|---|---|
| ⚡ **SmartFormMapper** | 議事録テキストを貼り付けると、開いているページのフォーム（input/textarea/select）のラベルを DOM 解析で判別し、1 クリックで一括入力 |
| 🧾 **ExpensePilot** | 領収書 PDF / 画像をドラッグ＆ドロップ → 日付・金額・支払先を抽出、勘定科目を文脈推定してドロップダウンを自動選択 |
| 🛠 **DevCleanShortcut** | ボタン 1 つでローカルのポート衝突・Docker ゾンビ・古いキャッシュをクリーンアップ（127.0.0.1 のローカルエージェント経由） |
| 📅 **CalendarBlocker** | 今日のタスクと見積もり時間から空き時間を探索し、Google カレンダーに「作業時間」を 1 クリックでブロック確保 |

- 🌙 Tailwind 風のモダン UI（ダークモード対応）
- 🔒 Manifest V3 準拠 / インラインスクリプト・`eval`・リモートコードなし / 権限は最小構成
- 🧩 ビルド不要 — フォルダを読み込むだけで動作

## インストール

1. このリポジトリを Clone または ZIP ダウンロード
2. Chrome で `chrome://extensions` を開き、右上の **デベロッパー モード** を ON
3. **「パッケージ化されていない拡張機能を読み込む」** → `PageFlowAI` フォルダを選択

詳しい使い方・デモ用サンプルテキスト・ローカルエージェントの起動方法は **[CHROME_EXTENSION_GUIDE.md](CHROME_EXTENSION_GUIDE.md)** を参照してください。

## AI 解析（任意）

画像・スキャン PDF の領収書を解析する場合のみ、⚙️ 設定タブに [Anthropic API キー](https://console.anthropic.com/) を登録します。
キーは **この端末の拡張ストレージ（`chrome.storage.local`）にのみ保存**され、`api.anthropic.com` 以外には送信されません。キー未設定でも他のすべての機能は利用できます。

## 開発・テスト

```bash
node tests/run_tests.js   # 25 テスト: manifest 整合性 / CSP 静的検査 / 解析ロジック
```

## ライセンス

[MIT](LICENSE) © 2026 NagaYu
