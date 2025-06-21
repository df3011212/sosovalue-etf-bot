// bot.js — 比特幣現貨ETF淨流入 ➜ Telegram 推播
import 'dotenv/config';
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import FormData from 'form-data';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import cron from 'node-cron';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

// —— 設定區 —— //
const URL = 'https://sosovalue.com/tc/dashboard/total-crypto-spot-etf-fund-flow';
const CANVAS_SEL = 'canvas[data-zr-dom-id]';
const SHOT_DIR   = path.join(__dirname, 'screenshots');
const LAST_FILE  = path.join(__dirname, 'last_etf.txt');

const TG_TOKEN   = process.env.TELEGRAM_TOKEN;
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
if (!TG_TOKEN || !TG_CHAT_ID) {
  console.error('⛔️ TELEGRAM_TOKEN / TELEGRAM_CHAT_ID 尚未設定於 .env');
  process.exit(1);
}

// —— 工具函式 —— //
const readLast  = () => (fs.existsSync(LAST_FILE) ? fs.readFileSync(LAST_FILE, 'utf8') : null);
const writeLast = v  => fs.writeFileSync(LAST_FILE, v);

async function sendTelegramPhoto(caption, filePath) {
  const url  = `https://api.telegram.org/bot${TG_TOKEN}/sendPhoto`;
  const form = new FormData();
  form.append('chat_id', TG_CHAT_ID);
  form.append('caption', caption);
  form.append('parse_mode', 'Markdown');
  form.append('photo', fs.createReadStream(filePath));
  await axios.post(url, form, { headers: form.getHeaders() });
}

// —— 資金狀態評估 —— //
function evaluate(flowText) {
  const n = Number(flowText.replace(/[^0-9.-]/g, ''));
  if (n >= 500_000_000) return { level:'🚀 強力資金流入', advice:'主力進場，留意做多機會' };
  if (n <= -500_000_000) return { level:'⚠️ 大量贖回',   advice:'資金撤出，注意回調風險' };
  if (n > 0)  return { level:'🟢 小幅流入', advice:'市場偏多但不明顯' };
  if (n < 0)  return { level:'🔴 小幅流出', advice:'市場偏空但未明確轉弱' };
  return { level:'⏸ 無顯著變化', advice:'觀望為主' };
}

// —— 核心任務 —— //
async function runTask() {
  console.log('\n🚀 [ETF 任務啟動] ', new Date().toLocaleString('zh-TW'));

  const browser = await puppeteer.launch({
    headless: 'new',
    defaultViewport: { width: 1280, height: 900 },
    args: ['--no-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.goto(URL, { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 5000)); // 等待數據載入

    // ① 抓數據
    const flowText  = await page.$eval(
      'div.items-center.justify-center.rounded-sm:nth-of-type(1) .text-neutral-fg-1-rest.font-bold',
      el => el.innerText.trim()
    );
    const flowDate  = await page.$eval(
      'div.items-center.justify-center.rounded-sm:nth-of-type(1) .text-neutral-fg-4-rest',
      el => el.innerText.trim()
    );
    const assetText = await page.$eval(
      'div.items-center.justify-center.rounded-sm:nth-of-type(2) .text-neutral-fg-1-rest.font-bold',
      el => el.innerText.trim()
    );
    const priceText = await page.$eval(
      'div.items-center.justify-center.rounded-sm:nth-of-type(3) .text-neutral-fg-1-rest.font-bold',
      el => el.innerText.trim()
    );

    // ② 生成建議
    const { level, advice } = evaluate(flowText);

    // ③ 截圖
    if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR);
    const shotName = `etf-${new Date().toISOString().split('T')[0]}.png`;
    const shotPath = path.join(SHOT_DIR, shotName);
    const chart = await page.$(CANVAS_SEL);
    if (!chart) throw new Error('找不到 chart canvas');
    await chart.screenshot({ path: shotPath });

    // ④ 組文字（你的格式）
    const textMsg =
`📊 *比特幣現貨 ETF 總淨流入（${flowDate}）*
🕛 當日變化：\`${flowText}\`
📦 ETF 淨資產：\`${assetText}\`
₿ 比特幣價格：\`${priceText}\`

資金狀態：${level}
📌 建議：${advice}`;

    // ⑤ 傳送 Telegram（圖片＋文字）
    await sendTelegramPhoto(textMsg, shotPath);
    console.log('✅ 已推送至 Telegram');

    // ⑥ 寫入今日金額
    writeLast(flowText);

  } catch (err) {
    console.error('❌ 發生錯誤：', err.message);
  } finally {
    await browser.close();
  }
}

// 🕰 每天中午 12:05 定時推播（台灣時間）
cron.schedule('5 12 * * *', runTask, { timezone: 'Asia/Taipei' });

// 🚀 啟動時立即執行一次
runTask();
