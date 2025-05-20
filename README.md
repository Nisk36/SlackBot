# Confluenceページ更新 → Slack自動通知Bot

## 概要

このプロジェクトは、**Confluence上の特定ページ**を定期的に監視し、ページが更新された際に**Slackの指定チャンネルへBotとして自動で通知**するシステムです。

- 通知内容にはページタイトル・URL・編集者・編集日時・サマリのほか、
- ページ内容の差分抜粋や**テーブル（表）の新規追加行**も分かりやすく含めることができます。

---

## システム全体の流れ

1. **node-cron**でConfluence REST APIからページ内容（最新バージョン）を取得
2. **ローカルファイル**に前回取得したバージョンや本文を保存
3. ページのバージョンが進んでいれば
    - 文章の差分抜粋を作成
    - テーブル内の**新規追加行**（「項目: 値」形式）も抽出
4. **Slack Bot**（@slack/web-api）で指定チャンネルに通知

---

## 必要パッケージ

```bash
npm install axios @slack/web-api node-cron diff html-to-text cheerio dotenv
```

