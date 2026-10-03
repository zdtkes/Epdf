pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// GAS Web App 部署網址
const GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbx3SATCw9BdhW50U78iOypUJlUhgqiQkLPCrvYyeeDLbpyg1C1UbTpA3CPAtPQWBXTExA/exec";

let currentPageFlip = null;
let currentBlobUrls = [];
let totalPagesCount = 0;

/**
 * 安全顯示/隱藏載入提示
 */
function showLoading(msg) {
  const loadingOverlay = document.getElementById('loading-overlay');
  const loadingText = document.getElementById('loading-text');
  if (loadingOverlay) loadingOverlay.style.display = 'flex';
  if (loadingText) loadingText.textContent = msg;
}

function hideLoading() {
  const loadingOverlay = document.getElementById('loading-overlay');
  if (loadingOverlay) loadingOverlay.style.display = 'none';
}

/**
 * ⚡ 讀取雲端 PDF 檔案 (經由 GAS 全速打包)
 */
async function loadDrivePDF(fileId) {
  showLoading('⚡ 正在從雲端載入 PDF 檔案...');

  try {
    const res = await fetch(`${GAS_WEB_APP_URL}?id=${fileId}`);
    if (!res.ok) throw new Error(`HTTP 狀態碼 ${res.status}`);

    const result = await res.json();
    if (result.status === "error") throw new Error(result.message);

    // 將 Base64 轉換為 Uint8Array 陣列
    const binaryStr = window.atob(result.data);
    const len = binaryStr.length;
    const pdfBytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      pdfBytes[i] = binaryStr.charCodeAt(i);
    }

    // 開始渲染 3D 電子書
    await renderFlipbook(pdfBytes);

  } catch (err) {
    console.error("載入失敗:", err);
    alert("開啟雲端 PDF 失敗，原因：" + err.message);
    hideLoading();
  }
}

/**
 * 解析網址輸入
 */
async function handleUrlInput(url) {
  const folderMatch = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch) {
    showLoading("📁 讀取 Google Drive 資料夾內容...");
    await fetchDrivePDFList();
    hideLoading();
    alert("已載入資料夾內的 PDF 書單！請從右上角「雲端書庫」選單選擇閱讀。");
    return;
  }

  let fileId = null;
  const regD = /\/d\/([a-zA-Z0-9_-]+)/;
  const regId = /[?&]id=([a-zA-Z0-9_-]+)/;

  if (regD.test(url)) fileId = url.match(regD)[1];
  else if (regId.test(url)) fileId = url.match(regId)[1];

  if (fileId) {
    loadDrivePDF(fileId);
  } else {
    alert("無法辨識此網址！請確認您貼上的是 Google Drive 的檔案或資料夾分享連結。");
  }
}

/**
 * 將 PDF 數據渲染為 3D 翻頁電子書
 */
async function renderFlipbook(pdfData) {
  showLoading('⚡ 正在排版 3D 電子書...');

  // 自動隱藏拖曳上傳區塊
  const dropzoneSection = document.getElementById('dropzone-section');
  if (dropzoneSection) {
    dropzoneSection.style.display = 'none';
  }

  // 銷毀舊選單與釋放記憶體
  if (currentPageFlip) {
    try { currentPageFlip.destroy(); } catch (e) {}
    currentPageFlip = null;
  }
  
  currentBlobUrls.forEach(url => URL.revokeObjectURL(url));
  currentBlobUrls = [];

  const flipbookContainer = document.getElementById('flipbook');
  if (!flipbookContainer) {
    console.error("找不到 id='flipbook' 的容器");
    hideLoading();
    return;
  }
  flipbookContainer.innerHTML = '';

  try {
    const loadingTask = pdfjsLib.getDocument({ data: pdfData });
    const pdf = await loadingTask.promise;
    totalPagesCount = pdf.numPages;

    updateSliderUI(1, totalPagesCount);

    const firstPage = await pdf.getPage(1);
    const unscaledViewport = firstPage.getViewport({ scale: 1.0 });
    const pdfAspectRatio = unscaledViewport.width / unscaledViewport.height;

    // 計算視窗剩餘高度
    const navHeight = 50;
    const footerHeight = 52;
    const availHeight = Math.max(300, window.innerHeight - navHeight - footerHeight - 20);
    const availWidth = Math.max(300, window.innerWidth - 30);
    const isMobile = window.innerWidth <= 768;

    let pageW, pageH;
    if (isMobile) {
      if (availWidth / availHeight > pdfAspectRatio) {
        pageH = availHeight;
        pageW = Math.floor(pageH * pdfAspectRatio);
      } else {
        pageW = availWidth;
        pageH = Math.floor(pageW / pdfAspectRatio);
      }
    } else {
      const spreadRatio = 2 * pdfAspectRatio;
      if (availWidth / availHeight > spreadRatio) {
        pageH = availHeight;
        pageW = Math.floor(pageH * pdfAspectRatio);
      } else {
        pageW = Math.floor(availWidth / 2);
        pageH = Math.floor(pageW / pdfAspectRatio);
      }
    }

    const pageElements = [];
    for (let i = 1; i <= totalPagesCount; i++) {
      const pageDiv = document.createElement('div');
      pageDiv.className = 'my-page';
      pageDiv.id = `page-node-${i}`;
      pageDiv.innerHTML = `<div style="color:#aaa; font-size:12px;">📄 第 ${i} 頁...</div>`;
      pageElements.push(pageDiv);
    }

    const pageFlip = new St.PageFlip(flipbookContainer, {
      width: pageW,
      height: pageH,
      size: "fixed",
      showCover: true,
      usePortrait: true,
      clickToFlip: true
    });

    currentPageFlip = pageFlip;
    pageFlip.loadFromHTML(pageElements);

    pageFlip.on('flip', (e) => {
      updatePageNumDisplay(e.data + 1, totalPagesCount);
    });

    const renderScale = (window.devicePixelRatio && window.devicePixelRatio > 1) ? 2.0 : 1.5;

    for (let pageNum = 1; pageNum <= totalPagesCount; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: renderScale });

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      await page.render({ canvasContext: context, viewport: viewport }).promise;

      const imgUrl = await new Promise(resolve => {
        canvas.toBlob(blob => {
          const url = URL.createObjectURL(blob);
          currentBlobUrls.push(url);
          resolve(url);
        }, 'image/jpeg', 0.88);
      });

      const targetDiv = document.getElementById(`page-node-${pageNum}`);
      if (targetDiv) {
        targetDiv.innerHTML = '';
        const img = document.createElement('img');
        img.src = imgUrl;
        img.alt = `第 ${pageNum} 頁`;
        targetDiv.appendChild(img);
      }

      if (pageNum === 2 || pageNum === totalPagesCount) {
        hideLoading();
      }

      await new Promise(resolve => setTimeout(resolve, 10));
    }

  } catch (err) {
    console.error("PDF 解析失敗:", err);
    alert("PDF 檔案解析失敗，原因：" + err.message);
    hideLoading();
  }
}

/**
 * 讀取 Google Drive 資料夾內的 PDF 清單，並自動開啟第一本
 */
async function fetchDrivePDFList() {
  const gdriveSelect = document.getElementById('gdrive-select');
  if (!gdriveSelect) return;

  try {
    showLoading('☁️ 正在搜尋雲端書庫...');
    const res = await fetch(GAS_WEB_APP_URL);
    if (!res.ok) throw new Error(`HTTP 狀態碼: ${res.status}`);

    const pdfList = await res.json();

    if (!Array.isArray(pdfList) || pdfList.length === 0) {
      gdriveSelect.innerHTML = '<option value="">資料夾內無 PDF 檔案</option>';
      hideLoading();
      return;
    }

    gdriveSelect.innerHTML = '<option value="">-- 選擇雙週報電子書 --</option>';
    pdfList.forEach(pdf => {
      const opt = document.createElement('option');
      opt.value = pdf.id;
      opt.textContent = pdf.name;
      gdriveSelect.appendChild(opt);
    });

    // 頁面打開後自動加載第一個檔案
    if (pdfList.length > 0) {
      const firstFileId = pdfList[0].id;
      gdriveSelect.value = firstFileId;
      loadDrivePDF(firstFileId);
    }

  } catch (err) {
    console.error("讀取雲端清單失敗:", err);
    if (gdriveSelect) gdriveSelect.innerHTML = '<option value="">雲端書單讀取失敗</option>';
    hideLoading();
  }
}

function updatePageNumDisplay(current, total) {
  const pNum = document.getElementById('page-num');
  const pSlider = document.getElementById('page-slider');
  if (pNum) pNum.textContent = `${current} / ${total}`;
  if (pSlider) pSlider.value = current;
}

function updateSliderUI(current, total) {
  const slider = document.getElementById('page-slider');
  if (slider) {
    slider.min = 1;
    slider.max = total;
    slider.value = current;
  }
  updatePageNumDisplay(current, total);
}

// 事件初始化綁定
document.addEventListener('DOMContentLoaded', () => {
  fetchDrivePDFList();

  const btnToggleUpload = document.getElementById('btn-toggle-upload');
  if (btnToggleUpload) {
    btnToggleUpload.addEventListener('click', () => {
      const dropzoneSection = document.getElementById('dropzone-section');
      if (dropzoneSection) {
        dropzoneSection.style.display = (dropzoneSection.style.display === 'none') ? 'flex' : 'none';
      }
    });
  }

  const gdriveSelect = document.getElementById('gdrive-select');
  if (gdriveSelect) {
    gdriveSelect.addEventListener('change', (e) => {
      if (e.target.value) loadDrivePDF(e.target.value);
    });
  }

  const btnLoadUrl = document.getElementById('btn-load-url');
  if (btnLoadUrl) {
    btnLoadUrl.addEventListener('click', () => {
      const urlInput = document.getElementById('gdrive-url-input');
      if (urlInput && urlInput.value.trim()) handleUrlInput(urlInput.value.trim());
    });
  }

  const fileInput = document.getElementById('file-input');
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file && file.type === 'application/pdf') {
        const reader = new FileReader();
        reader.onload = function() { renderFlipbook(new Uint8Array(this.result)); };
        reader.readAsArrayBuffer(file);
      }
    });
  }

  const btnPrev = document.getElementById('btn-prev');
  if (btnPrev) {
    btnPrev.addEventListener('click', () => {
      if (currentPageFlip) currentPageFlip.flipPrev();
    });
  }

  const btnNext = document.getElementById('btn-next');
  if (btnNext) {
    btnNext.addEventListener('click', () => {
      if (currentPageFlip) currentPageFlip.flipNext();
    });
  }

  const pageSlider = document.getElementById('page-slider');
  if (pageSlider) {
    pageSlider.addEventListener('input', (e) => {
      const index = parseInt(e.target.value, 10) - 1;
      if (currentPageFlip) currentPageFlip.turnToPage(index);
    });
  }

  const btnFullscreen = document.getElementById('btn-fullscreen');
  if (btnFullscreen) {
    btnFullscreen.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
      } else {
        if (document.exitFullscreen) document.exitFullscreen();
      }
    });
  }
});
