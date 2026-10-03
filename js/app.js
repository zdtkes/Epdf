// === 方案二：貼上 Google Drive 連結邏輯 ===

// 1. 綁定按鈕點擊事件
document.getElementById('btn-load-url').addEventListener('click', () => {
  const urlInput = document.getElementById('gdrive-url-input').value.trim();
  if (urlInput) {
    loadPdfFromDriveLink(urlInput);
  } else {
    alert('請先貼上 Google Drive 分享連結！');
  }
});

// 2. 支援在輸入框按下 Enter 鍵直接執行
document.getElementById('gdrive-url-input').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    document.getElementById('btn-load-url').click();
  }
});

/**
 * 解析 Google Drive 分享連結並下載 PDF
 */
async function loadPdfFromDriveLink(shareUrl) {
  // 正則表達式：自動抓取各式 Google Drive 連結中的 File ID
  let fileId = null;
  const regD = /\/d\/([a-zA-Z0-9_-]+)/;
  const regId = /[?&]id=([a-zA-Z0-9_-]+)/;

  if (regD.test(shareUrl)) {
    fileId = shareUrl.match(regD)[1];
  } else if (regId.test(shareUrl)) {
    fileId = shareUrl.match(regId)[1];
  }

  if (!fileId) {
    alert("無法辨識此網址！請確認您輸入的是正確的 Google Drive 分享連結。");
    return;
  }

  // 切換 UI 至載入畫面
  bookTitle.textContent = "Google Drive 雲端電子書";
  uploadView.classList.remove('active');
  readerView.classList.add('active');
  loadingOverlay.style.display = 'flex';
  loadingText.textContent = "⚡ 正在從 Google 雲端下載並生成 3D 電子書...";

  // 構造 Google 直連下載 URL (使用 Google Content CDN 能大幅避免跨域 CORS 限制)
  const downloadUrls = [
    `https://lh3.googleusercontent.com/d/${fileId}`,
    `https://docs.google.com/uc?export=download&id=${fileId}`
  ];

  let arrayBuffer = null;
  let fetchSuccess = false;

  // 嘗試獲取檔案內容
  for (const url of downloadUrls) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        arrayBuffer = await response.arrayBuffer();
        // 簡易檢查：確定有抓到合理的檔案大小
        if (arrayBuffer.byteLength > 1000) {
          fetchSuccess = true;
          break;
        }
      }
    } catch (err) {
      console.warn("嘗試直連網址失敗，切換備用網址...", err);
    }
  }

  if (fetchSuccess && arrayBuffer) {
    // 成功下載！傳遞給第一階段寫好的 3D 翻頁繪製函式
    renderFlipbook(new Uint8Array(arrayBuffer));
  } else {
    alert("讀取失敗！請確認：\n1. 該 Google Drive 檔案已開啟『知道連結的人皆可查看』權限。\n2. 該連結確實為 PDF 格式檔案。");
    loadingOverlay.style.display = 'none';
  }
}
