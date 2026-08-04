# Google Drive 雲端同步設定

本版本只保留 Google Drive 同步。資料仍以瀏覽器本機儲存為主，Google Drive 保存一份 App 專屬 JSON。

## 部署條件

- 雲端登入必須使用固定的 HTTPS 網址，例如 GitHub Pages。
- 直接雙擊 HTML（`file://`）仍可記帳與匯入／匯出 JSON，但不能使用 Google OAuth。

## Google Cloud 設定

1. 建立 Google Cloud 專案。
2. 啟用 **Google Drive API**。
3. 在 Google Auth Platform 完成 Branding、Audience 與 Contact information。
4. 若狀態是 Testing，把實際登入用的 Gmail 加入 Test users。
5. 建立 OAuth Client，類型選 **Web application**。
6. 將 App 顯示的 **Authorized JavaScript origin** 加入 Client。
7. 將 Web Client ID 貼回 App，按「連線 Google」。
8. 權限只需 `https://www.googleapis.com/auth/drive.appdata`。

App 使用 Drive 的 `appDataFolder` 隱藏空間，因此同步檔不會出現在一般「我的雲端硬碟」介面。

## 同步原則

- 只有本機變更：上傳。
- 只有雲端變更：載入。
- 兩邊都變更：停止自動覆蓋並顯示衝突選擇。
- 載入雲端前會保留可復原快照。

## OneDrive 移除說明

本版已移除 OneDrive 的 UI、OAuth 與 Microsoft Graph 程式碼。舊版曾保存的 Microsoft Client ID、OneDrive 狀態及暫存登入資料會在新版首次載入時清除；Google Drive 的設定與同步紀錄不受影響。
