// Spotify Daily Top Songs + Weekly Top Artists 爬蟲
// Daily 與 Weekly 各自獨立偵測「目前最新可用日期」，並各自用自己的週期回推補漏
import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const MARKETS = {
  global: "Global",
  tw: "Taiwan",
  jp: "Japan",
  kr: "South Korea",
  vn: "Vietnam",
  th: "Thailand",
  id: "Indonesia",
  in: "India",
  sg: "Singapore",
  my: "Malaysia",
};

const DAILY_BACKFILL_DAYS = 5;
const WEEKLY_BACKFILL_WEEKS = 4;
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function toCsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map((row) => headers.map((h) => escape(row[h])).join(","))].join("\n");
}

function writeCsvWithBom(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!rows.length) return;
  fs.writeFileSync(filePath, "\uFEFF" + toCsv(rows), "utf8");
}

function addDaysUTC(dateStr, delta) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

async function debugCapture(page, label) {
  fs.mkdirSync("debug", { recursive: true });
  await page.screenshot({ path: `debug/${label}.png`, fullPage: true }).catch(() => null);
  fs.writeFileSync(`debug/${label}.html`, await page.content().catch(() => ""), "utf8");
}

async function getLatestPublishedDate(page, url) {
  await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
  const text = await page.evaluate(() => document.body.innerText).catch(() => "");
  const matches = [...text.matchAll(/([A-Z][a-z]+) (\d{1,2})(?:\s*-\s*(\d{1,2}))?,\s*(\d{4})/g)];
  const last = matches[matches.length - 1];
  // Spotify 頁面顯示的是縮寫月份（Jul、Aug），但 MONTH_NAMES 存的是完整月份名稱（July、August），
  // 用 indexOf 精確比對永遠對不上，導致這個判斷永遠走到「讀不到」那個分支，這是原本的 bug
  const monthIdx = last ? MONTH_NAMES.findIndex(m => m.slice(0, 3).toLowerCase() === last[1].slice(0, 3).toLowerCase()) : -1;
  if (!last || monthIdx === -1) {
    console.warn(`[warn] 讀不到 ${url} 的最新日期文字，改用「2 天前」當保守估計。`);
    return addDaysUTC(new Date().toISOString().slice(0, 10), -2);
  }
  const day = last[3] || last[2]; // 有範圍（週榜）就取結束日，否則取單一日期
  const d = new Date(Date.UTC(Number(last[4]), monthIdx, Number(day)));
  return d.toISOString().slice(0, 10);
}

function findMissingDates(anchorDate, count, stepDays, filePrefix) {
  const missing = [];
  for (let i = 0; i < count; i++) {
    const dateStr = addDaysUTC(anchorDate, -i * stepDays);
    if (!fs.existsSync(`data/${filePrefix}_${dateStr}.csv`)) missing.push(dateStr);
  }
  return missing;
}

async function extractSongs(page, url, ctx) {
  await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
  const found = await page.waitForSelector("table tbody tr", { timeout: 25000 }).then(() => true).catch(() => false);
  if (!found) {
    await debugCapture(page, `${ctx.date}_${ctx.cc}_songs`);
    return [];
  }
  return page.$$eval("table tbody tr", (rows, ctx) =>
    rows.map((r) => {
      const cells = r.querySelectorAll("td");
      if (cells.length < 3) return null;
      const rankSpans = cells[1]?.querySelectorAll("span") || [];
      const titleEl = cells[2]?.querySelector('span[class*="StyledTruncatedTitle"]');
      const artistEls = cells[2]?.querySelectorAll('a[class*="StyledHyperlink"]') || [];
      const trackLink = cells[2]?.querySelector('a[href*="/track/"]');
      const img = cells[2]?.querySelector("img");
      return {
        captured_date: ctx.date,
        market: ctx.cc,
        market_name: ctx.marketName,
        rank: rankSpans[0]?.textContent.trim() || "",
        rank_change: rankSpans[1]?.textContent.trim() || "",
        track_name: titleEl ? titleEl.textContent.trim() : "",
        artist_names: Array.from(artistEls).map((a) => a.textContent.trim()).join("; "),
        artist_spotify_ids: Array.from(artistEls)
          .map((a) => (a.getAttribute("href") || "").match(/\/artist\/([A-Za-z0-9]+)/)?.[1] || "")
          .filter(Boolean).join("; "),
        track_spotify_id: (trackLink?.getAttribute("href") || "").match(/\/track\/([A-Za-z0-9]+)/)?.[1] || "",
        image_url: img ? img.src : "",
      };
    }).filter(Boolean), ctx
  );
}

async function extractArtists(page, url, ctx) {
  await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
  const found = await page.waitForSelector("table tbody tr", { timeout: 25000 }).then(() => true).catch(() => false);
  if (!found) {
    await debugCapture(page, `${ctx.date}_${ctx.cc}_artists`);
    return [];
  }
  return page.$$eval("table tbody tr", (rows, ctx) =>
    rows.map((r) => {
      const cells = r.querySelectorAll("td");
      if (cells.length < 3) return null;
      const rankSpans = cells[1]?.querySelectorAll("span") || [];
      // 這個儲存格裡其實有兩個 /artist/ 連結：一個是播放按鈕（沒有文字），
        // 一個才是顯示真正名字的連結，要挑「有文字內容」的那個，不能只抓第一個
        const artistLinkCandidates = Array.from(cells[2]?.querySelectorAll('a[href*="/artist/"]') || []);
        const artistLink = artistLinkCandidates.find((a) => a.textContent.trim() !== "") || artistLinkCandidates[0];
        const img = cells[2]?.querySelector("img");
        return {
          captured_week_end: ctx.date,
          market: ctx.cc,
          market_name: ctx.marketName,
          rank: rankSpans[0]?.textContent.trim() || "",
          rank_change: rankSpans[1]?.textContent.trim() || "",
          artist_name: artistLink ? artistLink.textContent.trim() : "",
          artist_spotify_id: (artistLink?.getAttribute("href") || "").match(/\/artist\/([A-Za-z0-9]+)/)?.[1] || "",
          image_url: img ? img.src : "",
        };
    }).filter(Boolean), ctx
  );
}

async function humanPause() {
  const base = 3000 + Math.random() * 4000;
  const distracted = Math.random() < 0.15 ? 5000 + Math.random() * 10000 : 0;
  return base + distracted;
}

async function main() {
  const browser = await chromium.launch({ headless: false, channel: "chrome" });
  const context = await browser.newContext({
    storageState: "auth.json",
    viewport: { width: 1366, height: 900 },
    locale: "en-US",
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  const page = await context.newPage();

  // ---- Daily Songs ----
  const dailyAnchor = await getLatestPublishedDate(page, "https://charts.spotify.com/charts/view/regional-global-daily/latest");
  console.log(`Daily 最新可用日期：${dailyAnchor}`);
  const missingDaily = findMissingDates(dailyAnchor, DAILY_BACKFILL_DAYS, 1, "spotify_daily_songs");

  if (!missingDaily.length) {
    console.log("Daily Songs 近幾天資料都齊全。");
  } else {
    console.log(`Daily Songs 需要補的日期：${missingDaily.join(", ")}`);
    for (const date of missingDaily) {
      const allSongs = [];
      for (const [cc, marketName] of shuffle(Object.entries(MARKETS))) {
        try {
          allSongs.push(...(await extractSongs(page, `https://charts.spotify.com/charts/view/regional-${cc}-daily/${date}`, { date, cc, marketName })));
        } catch (e) {
          console.warn(`[warn] ${date} ${cc} songs 抓取失敗：${e.message}`);
        }
        await page.waitForTimeout(await humanPause());
      }
      writeCsvWithBom(`data/spotify_daily_songs_${date}.csv`, allSongs);
      console.log(`[${date}] Songs 寫入 ${allSongs.length} 筆`);
    }
  }

  // ---- Weekly Artists ----
  const weeklyAnchor = await getLatestPublishedDate(page, "https://charts.spotify.com/charts/view/artist-global-weekly/latest");
  console.log(`Weekly 最新可用日期：${weeklyAnchor}`);
  const missingWeekly = findMissingDates(weeklyAnchor, WEEKLY_BACKFILL_WEEKS, 7, "spotify_weekly_artists");

  if (!missingWeekly.length) {
    console.log("Weekly Artists 近幾週資料都齊全。");
  } else {
    console.log(`Weekly Artists 需要補的日期：${missingWeekly.join(", ")}`);
    for (const date of missingWeekly) {
      const allArtists = [];
      for (const [cc, marketName] of shuffle(Object.entries(MARKETS))) {
        try {
          allArtists.push(...(await extractArtists(page, `https://charts.spotify.com/charts/view/artist-${cc}-weekly/${date}`, { date, cc, marketName })));
        } catch (e) {
          console.warn(`[warn] ${date} ${cc} artists 抓取失敗：${e.message}`);
        }
        await page.waitForTimeout(await humanPause());
      }
      writeCsvWithBom(`data/spotify_weekly_artists_${date}.csv`, allArtists);
      console.log(`[${date}] Artists 寫入 ${allArtists.length} 筆`);
    }
  }

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
