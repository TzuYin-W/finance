財務追蹤 App — GitHub Pages 安全部署版

此版本的 index.html 不內嵌任何個人記帳資料。
GitHub repository 根目錄應直接包含：
- index.html
- manifest.webmanifest
- sw.js
- icons/

不要將任何個人財務 JSON 備份檔上傳到公開 repository。
若之前曾把含個人資料的 index.html push 到 GitHub，僅覆蓋目前檔案不足以清除 Git 歷史；請另行清理 repository history。
