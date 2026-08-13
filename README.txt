財務追蹤 App｜GitHub 空白部署 + 歷史合併版

正確資料流：
1. GitHub Pages 只部署此壓縮檔內的 App 程式；index.html 不內建任何個人記帳資料。
2. 開啟 App 後，先從 Google Drive 載入/比較並載入目前的 2026 資料。
3. 再從 App 的匯入功能選擇「財務追蹤App_2019-2025歷史資料合併包.json」。
4. 匯入預覽應顯示「歷史合併匯入」，只替換 2019–2025，保留 2026 既有資料。
5. 確認歷史年度正常後，如希望之後其他裝置也直接取得完整年度，可再將合併後帳本同步/上傳覆蓋到 Google Drive。

注意：
- 不要把 2019–2025 歷史 JSON 上傳到 GitHub repository。
- 本版以 2026-08-12 的「財務追蹤App_空白雲端同步版」為基底。
- 原有篩選、排序、版面、Google Drive 同步與 UI storage key 均保留；只增加 history-merge 匯入處理。
