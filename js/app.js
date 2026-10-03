pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbzi7xUsWCMSDul7rMNiO-chdg78gmqkCCRaZN_Xw6HSQY4J5lSCciNDbMIT89qahJky/exec";
const CF_WORKER_URL = "https://pdf-proxy.zd-81c.workers.dev/"; // 👈 請替換為您的 Cloudflare Worker 網址

let currentPageFlip = null;
let currentPdfDoc = null;
let currentBlobUrls = [];
let totalPagesCount = 0;
let currentLoadingTaskId = 0;

// ⚡ 效能狀態管控
let isUserInteracting = false; // 是否正在翻頁動畫中
const renderedPages = new Set(); // 已繪製頁面紀錄

// ⚡ 1. 記憶體快取 (RAM Cache)
const pdfMemoryCache = new Map();

// 💾 2. IndexedDB 本地永久磁碟
const DB_NAME = 'PDFBookOfflineDB';
const STORE_NAME = 'pdf_files';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getCachedPDFFromDisk(fileId) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(fileId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    return null;
  }
}

async function saveCachedPDFToDisk(fileId, uint8Data) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(uint8Data, fileId);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (e) {
    return false;
  }
}

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
 * 🚀 極速直連載入器
 */
async function loadDrivePDF(fileId) {
  const taskId = ++currentLoadingTaskId;

  if (pdfMemoryCache.has(fileId)) {
    showLoading('⚡ 從記憶體秒開電子書...');
    await renderFlipbook(pdfMemoryCache.get(fileId), taskId);
    return;
  }

  showLoading('💾 檢查本地磁碟暫存...');
  const localDiskData = await getCachedPDFFromDisk(fileId);
  if (localDiskData) {
    pdfMemoryCache.set(fileId, localDiskData);
    showLoading('⚡ 從本機磁碟秒開電子書...');
    if (taskId === currentLoadingTaskId) {
      await renderFlipbook(localDiskData, taskId);
    }
    return;
  }

  try {
    showLoading('⚡ 正在透過高速代理連線...');
    const proxyUrl = `${CF_WORKER_URL}/?id=${fileId}`;
    const res = await fetch(proxyUrl);

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const contentLength = res.headers.get('content-length');
    const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
    const totalMB = totalBytes ? (totalBytes / (1024 * 1024)).toFixed(1) : '?';

    const reader = res.body.getReader();
    let loadedBytes = 0;
    const chunks = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      if (taskId !== currentLoadingTaskId) return;

      chunks.push(value);
      loadedBytes += value.length;

      const loadedMB = (loadedBytes / (1024 * 1024)).toFixed(1);
      if (totalBytes > 0) {
        const percent = Math.round((loadedBytes / totalBytes) * 100);
        showLoading(`🚀 直連極速下載中 (${loadedMB} / ${totalMB} MB - ${percent}%)...`);
      } else {
        showLoading(`🚀 直連極速下載中 (${loadedMB} MB)...`);
      }
    }

    const finalBuffer = new Uint8Array(loadedBytes);
    let offset = 0;
    for (const chunk of chunks) {
      finalBuffer.set(chunk, offset);
      offset += chunk.length;
    }

    if (taskId === currentLoadingTaskId) {
      pdfMemoryCache.set(fileId, finalBuffer);
      await saveCachedPDFToDisk(fileId, finalBuffer);
      await renderFlipbook(finalBuffer, taskId);
    }

  } catch (err) {
    console.error("Cloudflare 直連失敗，轉用 GAS 備援傳輸...", err);
    if (taskId === currentLoadingTaskId) {
      await loadDrivePDFSafeGAS(fileId, taskId);
    }
  }
}

async function loadDrivePDFSafeGAS(fileId, taskId) {
  try {
    showLoading('⚡ 轉用 GAS 雲端傳輸...');
    const res = await fetch(`${GAS_WEB_APP_URL}?id=${fileId}`);
    const data = await res.json();

    if (taskId !== currentLoadingTaskId) return;

    if (data.status === "success" && data.data) {
      const binaryStr = window.atob(data.data);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

      pdfMemoryCache.set(fileId, bytes);
      await saveCachedPDFToDisk(fileId, bytes);
      await renderFlipbook(bytes, taskId);
    }
  } catch (err) {
    if (taskId === currentLoadingTaskId) {
      alert("開啟 PDF 失敗：" + err.message);
      hideLoading();
    }
  }
}

/**
 * 📖 3D 電子書極速順暢渲染引擎
 */
async function renderFlipbook(pdfData, taskId) {
  showLoading('⚡ 正在排版 3D 電子書...');
  resetZoom();
  renderedPages.clear();

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
    const pdfDataCopy = pdfData.slice(0);
    const loadingTask = pdfjsLib.getDocument({ data: pdfDataCopy });
    
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error("PDF 解析超時")), 12000)
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

    // 💡 監聽狀態：只要使用者正在觸控、拖曳或播放動畫，100% 凍結背景渲染
    pageFlip.on('changeState', (e) => {
      isUserInteracting = (e.data !== 'read');
    });

    pageFlip.on('flip', (e) => {
      const currentPageNum = e.data + 1;
      updatePageNumDisplay(currentPageNum, totalPagesCount);
    });

    const renderScale = Math.min(window.devicePixelRatio || 1, 1.25);

    async function renderSinglePage(pageNum) {
      if (taskId !== currentLoadingTaskId || renderedPages.has(pageNum)) return;
      
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: renderScale });

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      await page.render({ canvasContext: context, viewport: viewport }).promise;

      // 使用稍微提高壓縮率的 jpeg，繪製速度快上數倍
      const imgBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.75));
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
        renderedPages.add(pageNum);
      }
    }

    showLoading('⚡ 正在產生前幾頁...');
    // 首要優先：立刻繪製前 3 頁供閱讀
    const initPages = [1, 2, 3].filter(p => p <= totalPagesCount);
    await Promise.all(initPages.map(p => renderSinglePage(p)));
    
    if (taskId === currentLoadingTaskId) {
      hideLoading();
    }

    // 💡 智慧背景排程：優先繪製「使用者正在看護的視窗周圍」，且使用 requestIdleCallback 在瀏覽器完全空閒時才繪製
    const pendingPages = new Set();
    for (let p = 1; p <= totalPagesCount; p++) {
      if (!renderedPages.has(p)) pendingPages.add(p);
    }

    async function processQueue() {
      while (pendingPages.size > 0) {
        if (taskId !== currentLoadingTaskId) break;

        // 1. 若正在翻頁/操作，暫停背景繪製
        if (isUserInteracting) {
          await new Promise(r => setTimeout(r, 200));
          continue;
        }

        // 2. 智慧挑選：優先找當前頁面前後 3 頁內尚未繪製的頁面
        const currentIdx = currentPageFlip ? (currentPageFlip.getCurrentPageIndex() + 1) : 1;
        let targetPage = null;

        for (let offset = -2; offset <= 3; offset++) {
          const nearPage = currentIdx + offset;
          if (pendingPages.has(nearPage)) {
            targetPage = nearPage;
            break;
          }
        }

        // 順序後補
        if (!targetPage) {
          targetPage = pendingPages.values().next().value;
        }

        pendingPages.delete(targetPage);

        // 3. 利用空閒時間繪製
        await new Promise((resolve) => {
          const runTask = async () => {
            if (!isUserInteracting && taskId === currentLoadingTaskId) {
              await renderSinglePage(targetPage);
            } else if (taskId === currentLoadingTaskId) {
              pendingPages.add(targetPage); // 被中斷則放回隊列
            }
            resolve();
          };

          if ('requestIdleCallback' in window) {
            requestIdleCallback(() => runTask(), { timeout: 800 });
          } else {
            setTimeout(runTask, 100);
          }
        });

        await new Promise(r => setTimeout(r, 80));
      }
    }

    processQueue();

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

  document.addEventListener('fullscreenchange', () => {
    resetZoom();
    if (currentPageFlip) {
      setTimeout(() => {
        currentPageFlip.update();
      }, 150);
    }
  });
});
