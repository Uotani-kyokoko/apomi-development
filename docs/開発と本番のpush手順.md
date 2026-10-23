# Apomy：開発と本番の push 手順

| 項目 | 内容 |
|------|------|
| 文書名 | 開発と本番の push 手順 |
| 対象 | Apomy（みんつく／プレジデントメイト含む共通リポジトリ） |
| 日付 | 2026-10-23 |
| 目的 | 画面コードを開発／本番 GitHub へ載せるときに必要な情報を残す |

**この文書にトークンやパスワードは書かない。** 認証情報は環境変数・GitHub の設定画面だけで扱う。

---

## 1. 全体像（2系統ある）

| 系統 | 何が変わるか | 何で反映するか |
|------|----------------|----------------|
| **画面（フロント）** | `index.html` / `js/` / `css/` など | GitHub へ push → GitHub Pages |
| **裏側（GAS）** | `gas/Code.gs` の処理 | **本番／開発それぞれの** スプレッドシートに紐づく Apps Script を **再デプロイ** |

Git に push しただけでは GAS は自動では変わらない。`Code.gs` を直したら必ず再デプロイする。

接続先（スプシ ID・GAS URL・Google クライアント ID など）は次で切り替える。

| 環境 | フロント | GAS ENV |
|------|----------|---------|
| 開発 | `js/env.dev.js` → `js/env.js` | `gas/env.dev.gs` を `Code.gs` の ENV ブロックへ |
| 本番 | `js/env.prod.js` → `js/env.js` | `gas/env.prod.gs` を `Code.gs` の ENV ブロックへ |

スクリプトがこの切替を行う（手で `env.js` を本番のままコミットしない）。

---

## 2. リポジトリと remote

| 呼び方 | GitHub リポジトリ | ローカル remote 名 | 用途 |
|--------|-------------------|--------------------|------|
| **開発** | `Uotani-kyokoko/apomi-development` | `origin` | 試し打ち・開発確認 |
| **本番** | `fortunatunabiz/Apomy` | `prod` | お客様が使う本番 Pages |

確認:

```powershell
cd e:\cursor\06_apomy
git remote -v
```

本番 URL の例（Pages）:

- Apomy: `https://fortunatunabiz.github.io/Apomy/`
- みんつく入口: `https://fortunatunabiz.github.io/Apomy/mintuku/index.html?r=（地方トークン）`
- プレジデントメイト: `https://fortunatunabiz.github.io/Apomy/president/index.html`

---

## 3. 開発への push に必要なもの

| 必要 | 内容 |
|------|------|
| 権限 | `apomi-development` に **push** できる GitHub アカウント |
| 認証の例 | `gh auth login`（例: アカウント `Uotani-kyokoko`） |
| 作業ツリー | 反映したい変更を commit 済み（または `push-dev.ps1` が env 同期 commit する） |
| スクリプト | `scripts/push-dev.ps1` |

手順:

```powershell
cd e:\cursor\06_apomy
gh auth switch --user Uotani-kyokoko   # 開発用アカウント
gh auth setup-git
powershell -ExecutionPolicy Bypass -File scripts/push-dev.ps1
```

または通常の開発フロー:

```powershell
git add （変更ファイル）
git commit -m "メッセージ"
git push origin HEAD:main
```

開発 push 後も、**開発用スプシ**側の GAS を変えたなら、開発 Apps Script の再デプロイが必要。

---

## 4. 本番への push に必要なもの

| 必要 | 内容 |
|------|------|
| 権限 | `fortunatunabiz/Apomy` に **push** できる認証 |
| 推奨 | 環境変数 **`PROD_GITHUB_TOKEN`**（classic PAT 等。リポジトリ write） |
| 注意 | 開発用 `gh` アカウントだけでは足りないことが多い（pull のみで 403 になる） |
| 作業ツリー | **クリーン**であること（未コミットがあると `push-prod.ps1` は中断） |
| スクリプト | `scripts/push-prod.ps1`（本番 env に一時切替 → push → 開発 env に戻す） |

### 4.1 トークンの扱い（重要）

- チャット・ドキュメント・リポジトリに **トークンを貼らない**
- 使うときだけ、自分のターミナルでセットする:

```powershell
$env:PROD_GITHUB_TOKEN = '（GitHub で発行した本番用 PAT）'
```

- 権限の目安: `repo`（または Fine-grained で `fortunatunabiz/Apomy` の Contents: Read and write）
- 漏れた・共有チャットに出た場合は **すぐ GitHub で revoke して再発行**する

### 4.2 実行

```powershell
cd e:\cursor\06_apomy
git status   # 何も出ない（クリーン）こと
$env:PROD_GITHUB_TOKEN = '（本番用 PAT）'
powershell -ExecutionPolicy Bypass -File scripts/push-prod.ps1
```

スクリプトの動き:

1. `js/env.prod.js` と `gas/env.prod.gs` を適用  
2. 一時 commit（`chore: temporary prod env for customer release`）  
3. `prod`（`fortunatunabiz/Apomy`）の `main` へ push  
4. 一時 commit を消し、ローカルを **開発 env に戻す**

別名: トークン必須の簡易版 `scripts/push-prod-now.ps1`（force-with-lease あり。常用は `push-prod.ps1` を推奨）。

### 4.3 push 後に必須：本番 GAS 再デプロイ

1. **本番**スプレッドシートを開く  
2. 拡張機能 → Apps Script  
3. 最新の `gas/Code.gs`（本番 ENV 入り）を反映  
4. デプロイ → ウェブアプリ → **新バージョン**で再デプロイ  

フロントだけ Pages に載っても、課金判定・掲載停止連動などは GAS が古いと動かない。

---

## 5. よくある失敗

| 症状 | 原因と対処 |
|------|------------|
| `Permission ... denied` / 403 | 開発アカウントで本番へ push している。`PROD_GITHUB_TOKEN` を使う |
| `未コミットの変更があります` | `git status` で残差分を commit / 破棄してから `push-prod` |
| `push-prod.ps1` が文字化けで落ちる | スクリプト内の日本語が環境で壊れている場合あり。同等手順を手動で行うか、スクリプトを UTF-8 BOM 付きで直す |
| `non-fast-forward` / rejected | 本番 `main` は一時 prod-env commit の名残で履歴が分岐しやすい。確定したリリースを載せるときは `push-prod-now.ps1`（`--force-with-lease`）を使う |
| 画面は新しいが挙動が古い | **GAS 未再デプロイ**。本番 Apps Script を更新 |
| ローカルが本番 env のまま | `push-prod` の finally が失敗した可能性。`js/env.dev.js` を `js/env.js` に戻し、`gas/env.dev.gs` を Code.gs の ENV に戻す |

---

## 6. チェックリスト（短縮）

### 開発

- [ ] 変更を commit  
- [ ] `origin`（`apomi-development`）へ push  
- [ ] （GAS 変更時）開発 GAS 再デプロイ  

### 本番

- [ ] 作業ツリーがクリーン  
- [ ] `PROD_GITHUB_TOKEN` をセット（チャットに貼らない）  
- [ ] `scripts/push-prod.ps1` 実行成功  
- [ ] 本番 GAS 再デプロイ  
- [ ] 本番 URL で動作確認  
- [ ] ローカルが開発 env に戻っていることを確認  

---

## 7. 関連ファイル

| パス | 役割 |
|------|------|
| `scripts/push-dev.ps1` | 開発 env 適用＋`origin` push |
| `scripts/push-prod.ps1` | 本番 env 一時適用＋`prod` push＋開発へ復帰 |
| `scripts/push-prod-now.ps1` | トークン必須の本番 push（上級） |
| `js/env.dev.js` / `js/env.prod.js` | フロント接続先 |
| `gas/env.dev.gs` / `gas/env.prod.gs` | GAS 接続先（Code.gs の ENV ブロック） |
| `docs/Apomy仕様書.md` | 全体仕様 |

---

## 変更履歴

| 版 | 日付 | 内容 |
|----|------|------|
| 1.0 | 2026-10-23 | 初版。開発／本番 remote・認証・スクリプト・GAS 再デプロイを整理 |
