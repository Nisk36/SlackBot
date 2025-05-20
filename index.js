require('dotenv').config();
const axios = require('axios');
const { WebClient } = require('@slack/web-api');
const cron = require('node-cron');

//TODO: 各種トークンの env による隠ぺい
const CONFLUENCE_BASE_URL = process.env.CONFLUENCE_BASE_URL;
const PAGE_ID = process.env.PAGE_ID; // 監視対象ページID
const CONFLUENCE_EMAIL = process.env.CONFLUENCE_EMAIL;
const CONFLUENCE_API_TOKEN = process.env.CONFLUENCE_API_TOKEN;

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN; // 取得済み
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID;

const slackClient = new WebClient(SLACK_BOT_TOKEN);

let lastVersion = null;

// 1分ごとにチェック（cron形式: "* * * * *"）
cron.schedule('* * * * *', async () => {
    try {
        // Confluence REST APIでページ情報取得
        const res = await axios.get(
            `${CONFLUENCE_BASE_URL}/rest/api/content/${PAGE_ID}?expand=version,history`
            , {
                auth: {
                    username: CONFLUENCE_EMAIL,
                    password: CONFLUENCE_API_TOKEN
                }
            }
        );
        const page = res.data;
        const title = page.title;
        const url = `${CONFLUENCE_BASE_URL}${page._links.webui}`;
        const version = page.version.number;
        const editor = page.version.by.displayName;
        const editedAt = page.version.when;
        const message = page.version.message || '（コメントなし）';

        // 初回実行時は記録のみ
        if (lastVersion === null) {
            lastVersion = version;
            return;
        }

        // 前回からバージョンが上がっていたらSlack通知
        if (version > lastVersion) {
            lastVersion = version;

            await slackClient.chat.postMessage({
                channel: SLACK_CHANNEL_ID,
                text: `:page_facing_up: *Confluenceページ更新*\n*タイトル*: ${title}\n*URL*: ${url}\n*編集者*: ${editor}\n*日時*: ${editedAt}\n*サマリ*: ${message}`,
            });
            console.log('Slackに通知を送信しました');
        }
    } catch (err) {
        console.error('エラー:', err.message);
    }
});