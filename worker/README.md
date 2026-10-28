# PortalDots リリース情報サーバー (Cloudflare Workers 版)

`https://releases.portaldots.com/` を Cloudflare Workers で動かすための実装です。リポジトリ直下の PHP (Laravel) 版と同じ URL・同じレスポンスを返します。PHP 版は切り戻し用にそのまま残してあります。

## エンドポイント

| パス | 内容 |
| --- | --- |
| `GET /` | `https://github.com/portaldots/downloads` へ 301 |
| `GET /releases?current_major_version=N[&includes_prerelease=1]` | HTML 一覧 |
| `GET /releases.json?current_major_version=N[&includes_prerelease=1]` | リリースの JSON 配列(降順) |
| `GET /releases/latest.json?major_version=N[&includes_prerelease=1]` | 最新 1 件。該当なしは `{}` |
| `GET /downloads/latest.zip?major_version=N` | 最新版 ZIP へ 302。該当なしは 404 |
| `GET /downloads/PortalDots-{version}.zip` | SemVer なら GitHub の ZIP へ 302、不正なら 404 |

全レスポンスに `Access-Control-Allow-Origin: *` と `X-Robots-Tag: noindex` を付けます。

GitHub Releases API は 100 件ずつ最大 10 ページ取得し、`PortalDots.zip` という名前の成果物を選びます(成果物が 1 つだけの旧リリースはその成果物を使います)。結果は Cache API に 120 秒保持します。GitHub への取得が失敗したときは、期限切れでもキャッシュがあればそれを返し、なければ空配列を返します(失敗はキャッシュしません)。

## ローカルで確認する

Node.js 20 以上が必要です。

```bash
cd worker
npm install
npm test
npm run typecheck
npm run dev      # http://127.0.0.1:8787 で起動
```

認証なしの GitHub API は 1 時間 60 回までのため、ローカルで多く試すときは `worker/.dev.vars` に読み取り専用の token を書くと使われます(`.gitignore` 済み)。

```
GITHUB_TOKEN=github_pat_xxxxx
```

### 旧サーバーとの比較

`wrangler dev` を起動した状態で、旧サーバーと同じリクエストを送って結果を比べます。

```bash
scripts/compare.sh https://releases.portaldots.com http://127.0.0.1:8787
```

HTTP ステータス、リダイレクト先、CORS と noindex のヘッダー、JSON の中身(キー順は無視)、HTML を比較し、差があれば `DIFF` として表示して終了コード 1 を返します。旧サーバーが古いコードのまま動いている間は、次の差が出ます。

- `https://github.com/portal-dots/...` と `https://github.com/portaldots/...`(旧サーバーは古い組織名を参照している)
- `PortalDots-1.0.zip` や `PortalDots-latest.zip` など不正なバージョンで、旧サーバーは 302、新しい実装は 404
- v6 の成果物がある場合、旧サーバーは 500、新しい実装は正しく処理

## デプロイ

Cloudflare へのログインやデプロイは、アカウントの持ち主が行います。

1. ログインします。

   ```bash
   cd worker
   npx wrangler login
   ```

2. GitHub の読み取り専用 token を Secret に登録します。公開リポジトリの読み取りだけで足りるので、権限を何も付けない fine-grained personal access token で構いません。

   ```bash
   npx wrangler secret put GITHUB_TOKEN
   ```

   Secret を登録する前に `wrangler deploy` すると Worker が作られるので、先に登録したい場合は一度 `npx wrangler deploy` してから実行してください。

3. まず `workers.dev` で確認します。

   ```bash
   npx wrangler deploy
   scripts/compare.sh https://releases.portaldots.com https://portaldots-releases.<アカウント名>.workers.dev
   ```

   `workers.dev` では Cache API が効かないため、この確認中は毎回 GitHub に取りに行きます。Token を登録していても、連続して叩きすぎないでください。

## `releases.portaldots.com` を Route 53 から Workers へ向ける

Workers のカスタムドメインにするには、`portaldots.com` のゾーンが Cloudflare 上にある必要があります。DNS は現在 Route 53 なので、次のどちらかを選びます。

### A. ゾーンごと Cloudflare に移す

1. Cloudflare に `portaldots.com` を追加し、Route 53 の既存レコードがすべて取り込まれていることを確認します(MX、TXT、他のサブドメインを漏らさない)。
2. ドメインレジストラで、ネームサーバーを Cloudflare の指定するものに変更します。
3. 反映後、`wrangler.toml` の `routes` のコメントを外してデプロイします。

   ```toml
   routes = [
     { pattern = "releases.portaldots.com", custom_domain = true }
   ]
   ```

   `custom_domain = true` にすると、Cloudflare が `releases` の DNS レコードと証明書を自動で作ります。旧サーバーを指す既存の `releases` レコードがあると作成に失敗するので、先に削除します。

### B. ゾーンは Route 53 のまま、`releases` だけ Cloudflare に委任する

Workers のカスタムドメインはゾーンが Cloudflare 上にあることが前提なので、この方法には Cloudflare のパートナー向け CNAME セットアップが要ります。通常は A を使います。

### 切り替え前の確認

DNS を切り替える前に、`workers.dev` の URL に対して `scripts/compare.sh` を実行し、差分が上記の想定内であることを確認します。Route 53 の TTL を事前に 60 秒程度まで下げておくと、切り戻しが速くなります。

## 切り戻し

1. Cloudflare 側で `releases` のカスタムドメインを削除する(または `routes` を消して再デプロイする)。
2. DNS を旧サーバーの向き先に戻す。A の場合は、旧サーバーの IP アドレスまたは CNAME を `releases` レコードとして追加し直します。切り替え前に旧サーバーの値を控えておきます。
3. 旧サーバー(PHP 版)は切り替え後もしばらく停止せずに残します。

## Secret

`GITHUB_TOKEN` は Secret にだけ置き、`wrangler.toml` やコードには書きません。Token を変えるときは `npx wrangler secret put GITHUB_TOKEN` をもう一度実行します。
