# UI/UX 健康診断カルテ

URL を 1 つ入力するだけで、HTML/CSS/HTTP ヘッダを材料にした自動診断カルテを返す、Cloudflare Workers 向けの軽量アプリです。

## できること

- URL 入力 → 自動診断 → 健康診断カルテ風レポート表示
- 生成AI API 不使用
- DB 不使用
- 印刷 / PDF保存に対応
- JSON エクスポートに対応
- Cloudflare Worker 1 本で静的 UI と API をまとめて公開可能

## アーキテクチャ

- `public/index.html`
  - UI 本体
- `public/app.js`
  - 入力、API 呼び出し、進行表示、JSON保存、印刷
- `public/analyzer.js`
  - HTML/CSS/HTTP ヘッダからの自動評価ロジック
- `public/render.js`
  - 診断カルテの描画
- `src/worker.js`
  - Cloudflare Worker。静的アセット配信 + `/api/analyze` API
- `wrangler.jsonc`
  - Workers の設定

## ローカル起動

```bash
npm install
npm run dev
```

## デプロイ

```bash
npm install
npm run deploy
```

初回だけ Cloudflare にログインし、`*.workers.dev` サブドメインに公開してください。

## 仕様上の注意

この実装は **HTML/CSS/HTTP ヘッダで自動観測できる範囲** を診断対象にしています。そのため、以下は制限があります。

- JavaScript 実行後にのみ描画される UI は一部未計測
- ログイン必須ページは未対応
- Bot 対策 / CAPTCHA / robots.txt 拒否ページは未対応
- Lighthouse のような実ブラウザレンダリング計測は未実装

## 公開先のおすすめ

この要件なら、最も現実的に安く済む公開先は **Cloudflare Workers Free** です。

理由:

- 静的 UI と API を 1 プロジェクトで出せる
- 静的アセットは無料で配信できる
- Free プランでも 1 日 100,000 リクエストまで使える
- CORS 回避のための取得プロキシを同じドメインで持てる
- `wrangler deploy` だけで公開できる

## 拡張候補

- Browser Rendering 連携でスクリーンショット判定を追加
- PDF 出力テンプレートを追加
- ドメイン別の傾向比較
- 多言語レポート
