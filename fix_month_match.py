import re

path = "scrape_spotify_charts.js"
with open(path, encoding="utf-8") as f:
    content = f.read()

old = '''  const last = matches[matches.length - 1];
  if (!last || !MONTH_NAMES.includes(last[1])) {
    console.warn(`[warn] 讀不到 ${url} 的最新日期文字，改用「2 天前」當保守估計。`);
    return addDaysUTC(new Date().toISOString().slice(0, 10), -2);
  }
  const monthIdx = MONTH_NAMES.indexOf(last[1]);
  const day = last[3] || last[2]; // 有範圍（週榜）就取結束日，否則取單一日期
  const d = new Date(Date.UTC(Number(last[4]), monthIdx, Number(day)));
  return d.toISOString().slice(0, 10);'''

new = '''  const last = matches[matches.length - 1];
  // Spotify 頁面顯示的是縮寫月份（Jul、Aug），但 MONTH_NAMES 存的是完整月份名稱（July、August），
  // 用 indexOf 精確比對永遠對不上，導致這個判斷永遠走到「讀不到」那個分支，這是原本的 bug
  const monthIdx = last ? MONTH_NAMES.findIndex(m => m.slice(0, 3).toLowerCase() === last[1].slice(0, 3).toLowerCase()) : -1;
  if (!last || monthIdx === -1) {
    console.warn(`[warn] 讀不到 ${url} 的最新日期文字，改用「2 天前」當保守估計。`);
    return addDaysUTC(new Date().toISOString().slice(0, 10), -2);
  }
  const day = last[3] || last[2]; // 有範圍（週榜）就取結束日，否則取單一日期
  const d = new Date(Date.UTC(Number(last[4]), monthIdx, Number(day)));
  return d.toISOString().slice(0, 10);'''

if old not in content:
    print("找不到要替換的區塊，檔案內容可能跟預期不一樣，沒有做任何修改。")
else:
    content = content.replace(old, new)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print("修改成功。")
