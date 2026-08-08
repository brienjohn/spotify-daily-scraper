// 一次性登入設定：手動登入後把 session 存起來，之後排程就不用再登入
import { chromium } from "playwright";
import readline from "readline";

async function waitForEnter(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(prompt, () => { rl.close(); resolve(); }));
}

async function main() {
  const browser = await chromium.launch({ headless: false, channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  await page.goto("https://charts.spotify.com/home");

  await waitForEnter(
    "請在剛跳出的視窗裡按「Log in with Spotify」，完成登入、確定能看到榜單資料後，回到這裡按 Enter 繼續..."
  );

  await context.storageState({ path: "auth.json" });
  console.log("登入狀態已存成 auth.json，之後排程會自動沿用這個狀態。");
  await browser.close();
}

main();
