pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ⚡ 已替換為最新的 GAS Web App 網址
const GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbzi7xUsWCMSDul7rMNiO-chdg78gmqkCCRaZN_Xw6HSQY4J5lSCciNDbMIT89qahJky/exec";

let currentPageFlip = null;
let currentPdfDoc = null;
let currentBlobUrls = [];
let totalPagesCount = 0;
let currentLoadingTaskId = 0;

// ⚡ 1. 記憶體秒開快取 (File ID -> Uint8Array)
const pdfMemoryCache = new Map();

// 全域縮放狀態
let currentZoomScale = 1.0;
const MIN_ZOOM = 0.7;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.15;

function applyZoom(scale) {
  currentZoomScale = Math.min(Math.max(scale, MIN_ZOOM), MAX_ZOOM);
  const flipbook = document.getElementById('flipbook');
  const zoomText = document.getElementById('zoom-level-text');
  
  if (flipbook) {
    flipbook.style.transform = `scale(${currentZoomScale})`;
  }
  if (zoomText) {
    zoomText.textContent = `${Math.round(currentZoomScale * 100)}%`;
  }
}

function resetZoom() {
  applyZoom(1.0);
}

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
 * ⚡ 極速 PDF 載入器 (快取優先 + 單次直傳 + 控頻備援)
 */
async function loadDrivePDF(fileId) {
  const taskId = ++currentLoadingTaskId;

  // 檢查記憶體快取：若已看過，0 秒瞬間開啟
  if (pdfMemoryCache.has(fileId)) {
    showLoading('⚡ 從快取秒開電子書...');
    await renderFlipbook(pdfMemoryCache.get(fileId), taskId);
    return;
  }

  showLoading('⚡ 正在載入 PDF...');

  // 1. CDN 直連嘗試
  const cdnUrl = `https://lh3.googleusercontent.com/d/${fileId}`;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1800);

    const res = await fetch(cdnUrl, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (res.ok) {
      const buf = await res.arrayBuffer();
      const bytes = new Uint8Array(buf);
      if (bytes[0] === 0x25 && bytes[1] === 0x50) { // %PDF
        pdfMemoryCache.set(fileId, bytes); // 存入快取
        if (taskId === currentLoadingTaskId) {
          await renderFlipbook(bytes, taskId);
        }
        return;
      }
    }
  } catch (e) {
    console.warn("CDN 直連失敗，轉用 GAS 極速下載...");
  }

  // 2. GAS 下載
  if (taskId === currentLoadingTaskId) {
    await loadDrivePDFSafeGAS(fileId, taskId);
  }
}

/**
 * 🚀 GAS 傳輸引擎 (優先單次整檔傳輸，避免多回合 HTTP 延遲)
 */
async function loadDrivePDFSafeGAS(fileId, taskId) {
  try {
    // 優先嘗試單次全檔下載
    showLoading('⚡ 雲端傳輸中...');
    const res = await fetch(`${GAS_WEB_APP_URL}?id=${fileId}`);
    const data = await res.json();

    if (taskId !== currentLoadingTaskId) return;

    if (data.status === "success" && data.data) {
      const binaryStr = window.atob(data.data);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      pdfMemoryCache.set(fileId, bytes); // 存入快取
      await renderFlipbook(bytes, taskId);
      return;
    }

    // 若檔案過大，自動退回分段控頻下載
    if (data.status === "error" && data.message && data.message.includes("meta")) {
      await loadDrivePDFChunkedGAS(fileId, taskId);
    } else {
      throw new Error(data.message || "檔案讀取失敗");
    }

  } catch (err) {
    // 備用：分段控頻池下載
    if (taskId === currentLoadingTaskId) {
      await loadDrivePDFChunkedGAS(fileId, taskId);
    }
  }
}

/**
 * 🛡️ 大檔案分段傳輸備援
 */
async function loadDrivePDFChunkedGAS(fileId, taskId) {
  try {
    const metaRes = await fetch(`${GAS_WEB_APP_URL}?id=${fileId}&action=meta`);
    const meta = await metaRes.json();
    if (meta.status === "error") throw new Error(meta.message);

    const totalSize = meta.size;
    const chunkSize = 2 * 1024 * 1024;
    const totalChunks = Math.ceil(totalSize / chunkSize);
    const finalBuffer = new Uint8Array(totalSize);

    async function fetchChunkWithRetry(start, length) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const r = await fetch(`${GAS_WEB_APP_URL}?id=${fileId}&start=${start}&length=${length}`);
          const json = await r.json();
          if (json.status === "success") return json;
        } catch (e) {}
        await new Promise(res => setTimeout(res, 300));
      }
      throw new Error(`區塊 (${start}) 傳輸失敗`);
    }

    let completedChunks = 0;
    const tasks = [];

    for (let i = 0; i < totalChunks; i++) {
      tasks.push(async () => {
        if (taskId !== currentLoadingTaskId) return;
        const start = i * chunkSize;
        const chunkJson = await fetchChunkWithRetry(start, chunkSize);
        
        const binaryStr = window.atob(chunkJson.data);
        for (let j = 0; j < binaryStr.length; j++) {
          finalBuffer[start + j] = binaryStr.charCodeAt(j);
        }

        completedChunks++;
        const percent = Math.round((completedChunks / totalChunks) * 100);
        showLoading(`⚡ 分段下載中 (${percent}%)...`);
      });
    }

    const poolLimit = 2;
    const executing = [];
    for (const task of tasks) {
      if (taskId !== currentLoadingTaskId) return;
      const p = task().then(() => executing.splice(executing.indexOf(p), 1));
      executing.push(p);
      if (executing.length >= poolLimit) {
        await Promise.race(executing);
      }
    }
    await Promise.all(executing);

    if (taskId === currentLoadingTaskId) {
      pdfMemoryCache.set(fileId, finalBuffer); // 存入快取
      await renderFlipbook(finalBuffer, taskId);
    }

  } catch (err) {
    console.error("下載失敗:", err);
    if (taskId === currentLoadingTaskId) {
      alert("開啟 PDF 失敗：" + err.message);
      hideLoading();
    }
  }
}

/**
 * 📖 3D 電子書渲染引擎
 */
async function renderFlipbook(pdfData, taskId) {
  showLoading('⚡ 正在排版 3D 電子書...');
  resetZoom();

  const dropzoneSection = document.getElementById('dropzone-section');
  if (dropzoneSection) dropzoneSection.style.display = 'none';

  if (currentPdfDoc) {
    try { currentPdfDoc.destroy(); } catch (e) {}
    currentPdfDoc = null;
  }
  if (currentPageFlip) {
    try { currentPageFlip.destroy(); } catch (e) {}
    currentPageFlip = null;
  }
  
  currentBlobUrls.forEach(url => URL.revokeObjectURL(url));
  currentBlobUrls = [];

  const viewportContainer = document.querySelector('.flipbook-viewport');
  if (!viewportContainer) return;

  let oldFlipbook = document.getElementById('flipbook');
  if (oldFlipbook) oldFlipbook.remove();

  const flipbookContainer = document.createElement('div');
  flipbookContainer.id = 'flipbook';
  viewportContainer.appendChild(flipbookContainer);

  try {
    const loadingTask = pdfjsLib.getDocument({ data: pdfData });
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error("PDF 解析超時")), 10000)
    );

    const pdf = await Promise.race([loadingTask.promise, timeoutPromise]);
    if (taskId !== currentLoadingTaskId) return;

    currentPdfDoc = pdf;
    totalPagesCount = pdf.numPages;

    updateSliderUI(1, totalPagesCount);

    const firstPage = await pdf.getPage(1);
    const unscaledViewport = firstPage.getViewport({ scale: 1.0 });
    const pdfAspectRatio = unscaledViewport.width / unscaledViewport.height;

    const availHeight = Math.max(320, window.innerHeight - 105);
    const availWidth = Math.max(300, window.innerWidth - 20);
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

    const renderScale = Math.min(window.devicePixelRatio || 1, 1.25);

    async function renderSinglePage(pageNum) {
      if (taskId !== currentLoadingTaskId) return;
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: renderScale });

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      await page.render({ canvasContext: context, viewport: viewport }).promise;

      const imgBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8));
      if (!imgBlob || taskId !== currentLoadingTaskId) return;

      const imgUrl = URL.createObjectURL(imgBlob);
      currentBlobUrls.push(imgUrl);

      const targetDiv = document.getElementById(`page-node-${pageNum}`);
      if (targetDiv) {
        targetDiv.innerHTML = '';
        const img = document.createElement('img');
        img.src = imgUrl;
        img.alt = `第 ${pageNum} 頁`;
        targetDiv.appendChild(img);
      }
    }

    // ⏩ 雙頁並行同時繪製
    showLoading('⚡ 正在產生封面...');
    const initPageTasks = [renderSinglePage(1)];
    if (totalPagesCount >= 2) {
      initPageTasks.push(renderSinglePage(2));
    }
    await Promise.all(initPageTasks);
    
    if (taskId === currentLoadingTaskId) {
      hideLoading();
    }

    // 背景靜默繪製剩餘頁面
    (async () => {
      for (let p = 3; p <= totalPagesCount; p++) {
        if (taskId !== currentLoadingTaskId) break;
        await renderSinglePage(p);
        await new Promise(r => setTimeout(r, 10));
      }
    })();

  } catch (err) {
    console.error("PDF 解析失敗:", err);
    if (taskId === currentLoadingTaskId) {
      alert("電子書排版失敗，原因：" + err.message);
      hideLoading();
    }
  }
}

async function fetchDrivePDFList() {
  const gdriveSelect = document.getElementById('gdrive-select');
  if (!gdriveSelect) return;

  try {
    showLoading('☁️ 搜尋雲端書庫...');
    const res = await fetch(GAS_WEB_APP_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const pdfList = await res.json();

    if (!Array.isArray(pdfList) || pdfList.length === 0) {
      gdriveSelect.innerHTML = '<option value="">無 PDF 檔案</option>';
      hideLoading();
      return;
    }

    gdriveSelect.innerHTML = '<option value="">-- 選擇雙週報 --</option>';
    pdfList.forEach(pdf => {
      const opt = document.createElement('option');
      opt.value = pdf.id;
      opt.textContent = pdf.name;
      gdriveSelect.appendChild(opt);
    });

    if (pdfList.length > 0) {
      const firstFileId = pdfList[0].id;
      gdriveSelect.value = firstFileId;
      loadDrivePDF(firstFileId);
    }

  } catch (err) {
    console.error("讀取雲端清單失敗:", err);
    if (gdriveSelect) gdriveSelect.innerHTML = '<option value="">書單讀取失敗</option>';
    hideLoading();
  }
}

function handleUrlInput(url) {
  let fileId = null;
  const regD = /\/d\/([a-zA-Z0-9_-]+)/;
  const regId = /[?&]id=([a-zA-Z0-9_-]+)/;

  if (regD.test(url)) fileId = url.match(regD)[1];
  else if (regId.test(url)) fileId = url.match(regId)[1];

  if (fileId) {
    loadDrivePDF(fileId);
  } else {
    alert("無法辨識此網址！");
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

// 事件綁定
document.addEventListener('DOMContentLoaded', () => {
  fetchDrivePDFList();

  const btnZoomIn = document.getElementById('btn-zoom-in');
  const btnZoomOut = document.getElementById('btn-zoom-out');
  const btnZoomReset = document.getElementById('btn-zoom-reset');

  if (btnZoomIn) btnZoomIn.addEventListener('click', () => applyZoom(currentZoomScale + ZOOM_STEP));
  if (btnZoomOut) btnZoomOut.addEventListener('click', () => applyZoom(currentZoomScale - ZOOM_STEP));
  if (btnZoomReset) btnZoomReset.addEventListener('click', resetZoom);

  const viewport = document.querySelector('.flipbook-viewport');
  if (viewport) {
    viewport.addEventListener('wheel', (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
        if (e.deltaY < 0) applyZoom(currentZoomScale + 0.1);
        else applyZoom(currentZoomScale - 0.1);
      }
    }, { passive: false });
  }

  const btnToggleUpload = document.getElementById('btn-toggle-upload');
  if (btnToggleUpload) {
    btnToggleUpload.addEventListener('click', () => {
      const dropzoneSection = document.getElementById('dropzone-section');
      if (dropzoneSection) {
        dropzoneSection.style.display = (dropzoneSection.style.display === 'none') ? 'block' : 'none';
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
        reader.onload = function() { 
          const taskId = ++currentLoadingTaskId;
          renderFlipbook(new Uint8Array(this.result), taskId); 
        };
        reader.readAsArrayBuffer(file);
      }
    });
  }

  const btnPrev = document.getElementById('btn-prev');
  if (btnPrev) btnPrev.addEventListener('click', () => { if (currentPageFlip) currentPageFlip.flipPrev(); });

  const btnNext = document.getElementById('btn-next');
  if (btnNext) btnNext.addEventListener('click', () => { if (currentPageFlip) currentPageFlip.flipNext(); });

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
