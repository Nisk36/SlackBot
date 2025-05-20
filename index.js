require('dotenv').config();
const axios = require('axios');
const { WebClient } = require('@slack/web-api');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const jsdiff = require('diff');
const { htmlToText } = require('html-to-text');
const cheerio = require('cheerio');

const CONFLUENCE_BASE_URL = process.env.CONFLUENCE_BASE_URL;
const PAGE_ID = process.env.PAGE_ID;
const CONFLUENCE_EMAIL = process.env.CONFLUENCE_EMAIL;
const CONFLUENCE_API_TOKEN = process.env.CONFLUENCE_API_TOKEN;

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID;

const slackClient = new WebClient(SLACK_BOT_TOKEN);

const LAST_STATE_FILE = path.join(__dirname, 'lastState.json');
console.log(PAGE_ID)
console.log(CONFLUENCE_BASE_URL)

// ローカルファイルに状態保存/読込
function saveLastState(version, body) {
    fs.writeFileSync(LAST_STATE_FILE, JSON.stringify({ version, body }));
}

function loadLastState() {
    try {
        const data = fs.readFileSync(LAST_STATE_FILE);
        return JSON.parse(data);
    } catch (e) {
        return { version: null, body: null };
    }
}

async function getLatestPage() {
    const res = await axios.get(
        `${CONFLUENCE_BASE_URL}/rest/api/content/${PAGE_ID}?expand=version,body.storage`,
        {
            auth: {
                username: CONFLUENCE_EMAIL,
                password: CONFLUENCE_API_TOKEN
            }
        }
    );
    console.log(res);
    return res.data;
}

function tableRowsAsKeyedStrings(html) {
    const $ = cheerio.load(html);
    let rows = [];
    $('table').each((i, table) => {
        const headers = [];
        $(table).find('tr').first().find('th,td').each((i, th) => {
            headers.push($(th).text().trim());
        });
        $(table).find('tr').slice(1).each((i, tr) => {
            const cells = [];
            $(tr).find('td').each((i, td) => {
                cells.push($(td).text().trim());
            });
            if (cells.length > 0) {
                // 「項目: 値」形式で1行ずつ文字列化
                let line = '';
                headers.forEach((h, idx) => {
                    line += `${h}: ${cells[idx] ?? ''}\n`;
                });
                rows.push(line.trim());
            }
        });
    });
    return rows;
}

// チェック間隔：10秒ごと（テスト用）
cron.schedule('*/10 * * * * *', async () => {
    try {
        const lastState = loadLastState();
        const page = await getLatestPage();

        const version = page.version.number;
        const body = page.body.storage.value;
        const title = page.title;
        const url = `${CONFLUENCE_BASE_URL}${page._links.webui}`;
        const slackUrl = `<${url}>`;
        const editor = page.version.by.displayName;
        const editedAt = page.version.when;
        const message = page.version.message || '（コメントなし）';
        console.log(url);

        // 初回はバージョン・本文保存だけして終了
        if (lastState.version === null) {
            saveLastState(version, body);
            return;
        }

        if (version > lastState.version) {
            // HTML→テキスト変換
            const oldText = htmlToText(lastState.body || '', { wordwrap: false });
            const newText = htmlToText(body || '', { wordwrap: false });
            // 差分抽出
            const diff = jsdiff.diffWordsWithSpace(oldText, newText);

            // 旧・新テーブルから「項目: 値」行リスト取得
            const oldTableRows = tableRowsAsKeyedStrings(lastState.body || '');
            const newTableRows = tableRowsAsKeyedStrings(body || '');   
            // 追加行だけを抽出（厳密には「新にあって旧にない」すべてを抜き出す）
            const addedRows = newTableRows.filter(row => !oldTableRows.includes(row));

            // 追加・削除部分だけを抜粋し、強調
            let diffSummary = '';
            diff.forEach(part => {
                if (part.added) {
                    diffSummary += `*追加*:${part.value}`;
                } else if (part.removed) {
                    diffSummary += `*削除*:${part.value}`;
                }
                // 変更ない部分は抜粋に含めない（含めたい場合は else に diffSummary += part.value; 追加）
            });

            // 長すぎる場合は先頭300文字だけに
            if (diffSummary.length > 300) {
                diffSummary = diffSummary.slice(0, 300) + ' ...';
            }

            let tableBlock = '';
            if (addedRows.length > 0) {
                tableBlock = `\n【追加された表の行】\n` +
                    addedRows.map((row, idx) => `【新行${idx + 1}】\n${row}`).join('\n---\n');
            }

            await slackClient.chat.postMessage({
                channel: SLACK_CHANNEL_ID,
                text: `:page_facing_up: *Confluenceページ更新*\n` +
                `*タイトル*: ${title}\n` +
                `*URL*: ${slackUrl}\n` +
                `*編集者*: ${editor}\n` +
                `*日時*: ${editedAt}\n` +
                `*サマリ*: ${message}\n` +
                `*差分抜粋*:\n${diffSummary || '（差分が小さいかありません）'}${tableBlock}`
            });
            console.log('Slackに通知を送信しました');

            saveLastState(version, body);
        }
    } catch (err) {
        console.error('エラー:', err.message);
    }
});