pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// 您已部署好且包含資料夾 ID 的 GAS 網址
const GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbycy5pkeglcKjmMye9WLE76mn6uNiBqqTJDky4Et3Pta5cKNowiwkpt6MvXPz4fEgA6oQ/exec";

let currentPageFlip = null;
let currentBlobUrls = [];
let totalPagesCount = 0;

const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');

/**
 * 分段讀取雲端 PDF (支援 >25MB 大檔案)
 */
async function loadDrivePDF(fileId) {
  showLoading('☁️ 正在連接 Google Drive...');
  try {
    const metaRes = await fetch(`${GAS_WEB_APP_URL}?id=${fileId}&action=meta`);
    const meta = await metaRes.json();
    if (meta.status === "error") throw new Error(meta.message);

    const totalSize = meta.size;
    const chunkSize = 3 * 1024 * 1024; // 3MB chunk
    const finalBuffer = new Uint8Array(totalSize);
    let loadedBytes = 0;

    while (loadedBytes < totalSize) {
      const percent = Math.round((loadedBytes / totalSize) * 100);
      showLoading(`☁️ 下載雲端 PDF (${percent}%)...`);

      const chunkRes = await fetch(`${GAS_WEB_APP_URL}?id=${fileId}&start=${loadedBytes}&length=${chunkSize}`);
      const chunkJson = await chunkRes.json();
      if (chunkJson.status === "error") throw new Error(chunkJson.message);

      const binaryStr = window.atob(chunkJson.data);
      for (let i = 0; i < binaryStr.length; i++) {
        finalBuffer[loadedBytes + i] = binaryStr.charCodeAt(i);
      }
      loadedBytes += chunkJson.fetched;
    }

    await renderFlipbook(finalBuffer);
  } catch (err) {
    alert("雲端 PDF 開啟失敗：" + err.message);
    hideLoading();
  }
}

/**
 * 智慧解析輸入框網址（支援資料夾或單檔）
 */
async function handleUrlInput(url) {
  // 1. 判斷是否為「資料夾」網址
  const folderMatch = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch) {
    showLoading("📁 讀取 Google Drive 資料夾內容...");
    // 重新觸發雲端書單抓取
    fetchDrivePDFList();
    hideLoading();
    alert("已自動載入資料夾內的 PDF 書單！請從右上角「雲端書庫」選單切換閱讀。");
    return;
  }

  // 2. 判斷是否為「單一檔案」網址
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

  if (currentPageFlip) {
    try { currentPageFlip.destroy(); } catch (e) {}
    currentPageFlip = null;
  }
  
  currentBlobUrls.forEach(url => URL.revokeObjectURL(url));
  currentBlobUrls = [];

  const flipbookContainer = document.getElementById('flipbook');
  flipbookContainer.innerHTML = '';

  try {
    const loadingTask = pdfjsLib.getDocument({ data: pdfData });
    const pdf = await loadingTask.promise;
    totalPagesCount = pdf.numPages;

    updateSliderUI(1, totalPagesCount);

    const firstPage = await pdf.getPage(1);
    const unscaledViewport = firstPage.getViewport({ scale: 1.0 });
    const pdfAspectRatio = unscaledViewport.width / unscaledViewport.height;

    const navAndDropHeight = document.querySelector('.dropzone-box').offsetHeight + 105;
    const availHeight = Math.max(300, window.innerHeight - navAndDropHeight);
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
    console.error("PDF 載入失敗:", err);
    alert("PDF 檔案解析失敗。");
    hideLoading();
  }
}

/**
 * 自動抓取 Google Drive 資料夾清單
 */
async function fetchDrivePDFList() {
  const gdriveSelect = document.getElementById('gdrive-select');
  if (!gdriveSelect) return;

  try {
    const res = await fetch(GAS_WEB_APP_URL);
    const pdfList = await res.json();

    if (!Array.isArray(pdfList) || pdfList.length === 0) {
      gdriveSelect.innerHTML = '<option value="">資料夾內無 PDF 檔案</option>';
      return;
    }

    gdriveSelect.innerHTML = '<option value="">-- 選擇雙週報電子書 --</option>';
    pdfList.forEach(pdf => {
      const opt = document.createElement('option');
      opt.value = pdf.id;
      opt.textContent = pdf.name;
      gdriveSelect.appendChild(opt);
    });
  } catch (err) {
    console.error("讀取雲端清單失敗:", err);
    gdriveSelect.innerHTML = '<option value="">雲端書單讀取失敗</option>';
  }
}

function showLoading(msg) {
  loadingOverlay.style.display = 'flex';
  loadingText.textContent = msg;
}

function hideLoading() {
  loadingOverlay.style.display = 'none';
}

function updatePageNumDisplay(current, total) {
  document.getElementById('page-num').textContent = `${current} / ${total}`;
  document.getElementById('page-slider').value = current;
}

function updateSliderUI(current, total) {
  const slider = document.getElementById('page-slider');
  slider.min = 1;
  slider.max = total;
  slider.value = current;
  updatePageNumDisplay(current, total);
}

// 事件綁定
document.addEventListener('DOMContentLoaded', () => {
  fetchDrivePDFList();

  // 1. 雲端選單切換
  document.getElementById('gdrive-select').addEventListener('change', (e) => {
    if (e.target.value) loadDrivePDF(e.target.value);
  });

  // 2. 貼上網址讀取
  document.getElementById('btn-load-url').addEventListener('click', () => {
    const url = document.getElementById('gdrive-url-input').value.trim();
    if (url) handleUrlInput(url);
  });

  // 3. 本地上傳
  document.getElementById('file-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file && file.type === 'application/pdf') {
      const reader = new FileReader();
      reader.onload = function() { renderFlipbook(new Uint8Array(this.result)); };
      reader.readAsArrayBuffer(file);
    }
  });

  // 4. 閱讀介面控制 (上一頁 / 下一頁 / 滑動條 / 全螢幕)
  document.getElementById('btn-prev').addEventListener('click', () => {
    if (currentPageFlip) currentPageFlip.flipPrev();
  });

  document.getElementById('btn-next').addEventListener('click', () => {
    if (currentPageFlip) currentPageFlip.flipNext();
  });

  document.getElementById('page-slider').addEventListener('input', (e) => {
    const index = parseInt(e.target.value, 10) - 1;
    if (currentPageFlip) currentPageFlip.turnToPage(index);
  });

  document.getElementById('btn-fullscreen').addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      if (document.exitFullscreen) document.exitFullscreen();
    }
  });
});
