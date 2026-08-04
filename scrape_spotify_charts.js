// Spotify Daily Top Songs + Weekly Top Artists 爬蟲
// 資料來源：charts.spotify.com 官方頁面（不需登入，Playwright 渲染後讀 DOM）
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

const today = new Date().toISOString().slice(0, 10);

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
  if (!rows.length) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "\uFEFF" + toCsv(rows), "utf8");
}

async function scrapeSongs(page, cc, marketName) {
  await page.goto(`https://charts.spotify.com/charts/view/regional-${cc}-daily/latest`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("table tbody tr", { timeout: 20000 }).catch(() => null);

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
        captured_date: ctx.today,
        market: ctx.cc,
        market_name: ctx.marketName,
        rank: rankSpans[0]?.textContent.trim() || "",
        rank_change: rankSpans[1]?.textContent.trim() || "",
        track_name: titleEl ? titleEl.textContent.trim() : "",
        artist_names: Array.from(artistEls).map((a) => a.textContent.trim()).join("; "),
        artist_spotify_ids: Array.from(artistEls)
          .map((a) => (a.getAttribute("href") || "").match(/\/artist\/([A-Za-z0-9]+)/)?.[1] || "")
          .filter(Boolean)
          .join("; "),
        track_spotify_id: (trackLink?.getAttribute("href") || "").match(/\/track\/([A-Za-z0-9]+)/)?.[1] || "",
        image_url: img ? img.src : "",
      };
    }).filter(Boolean), { today, cc, marketName }
  );
}

async function scrapeArtists(page, cc, marketName) {
  await page.goto(`https://charts.spotify.com/charts/view/artist-${cc}-weekly/latest`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("table tbody tr", { timeout: 20000 }).catch(() => null);

  return page.$$eval("table tbody tr", (rows, ctx) =>
    rows.map((r) => {
      const cells = r.querySelectorAll("td");
      if (cells.length < 3) return null;
      const rankSpans = cells[1]?.querySelectorAll("span") || [];
      const artistLink = cells[2]?.querySelector('a[href*="/artist/"]');
      const img = cells[2]?.querySelector("img");
      return {
        captured_week_start: ctx.today,
        market: ctx.cc,
        market_name: ctx.marketName,
        rank: rankSpans[0]?.textContent.trim() || "",
        rank_change: rankSpans[1]?.textContent.trim() || "",
        artist_name: artistLink ? artistLink.textContent.trim() : "",
        artist_spotify_id: (artistLink?.getAttribute("href") || "").match(/\/artist\/([A-Za-z0-9]+)/)?.[1] || "",
        image_url: img ? img.src : "",
      };
    }).filter(Boolean), { today, cc, marketName }
  );
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  });

  const allSongs = [];
  const allArtists = [];

  for (const [cc, marketName] of Object.entries(MARKETS)) {
    try {
      allSongs.push(...(await scrapeSongs(page, cc, marketName)));
    } catch (e) {
      console.warn(`[warn] ${cc} songs 抓取失敗：${e.message}`);
    }
    try {
      allArtists.push(...(await scrapeArtists(page, cc, marketName)));
    } catch (e) {
      console.warn(`[warn] ${cc} artists 抓取失敗：${e.message}`);
    }
    await page.waitForTimeout(1500);
  }

  await browser.close();

  writeCsvWithBom(`data/spotify_daily_songs_${today}.csv`, allSongs);
  writeCsvWithBom(`data/spotify_weekly_artists_${today}.csv`, allArtists);
  console.log(`寫入 ${allSongs.length} 筆歌曲、${allArtists.length} 筆藝人（10 市場合併）`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
