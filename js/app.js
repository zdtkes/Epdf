pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbzi7xUsWCMSDul7rMNiO-chdg78gmqkCCRaZN_Xw6HSQY4J5lSCciNDbMIT89qahJky/exec";
const CF_WORKER_URL = "https://pdf-proxy.zd-81c.workers.dev/"; 

let currentPageFlip = null;
let currentPdfDoc = null;
let totalPagesCount = 0;
let currentLoadingTaskId = 0;
let rawPdfBuffer = null;

// ⚡ 核心狀態與永久圖片快取
const renderedImageCache = new Map(); 
const renderingPagesSet = new Set();  
let isFlipAnimating = false;         

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

// 🔍 全域縮放與平移狀態
let currentZoomScale = 1.0;
let panX = 0;
let panY = 0;
const MIN_ZOOM = 0.7;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.15;

function updateTransform() {
  const flipbook = document.getElementById('flipbook');
  const zoomText = document.getElementById('zoom-level-text');
  
  if (flipbook) {
    flipbook.style.transform = `translate(${panX}px, ${panY}px) scale(${currentZoomScale})`;
    if (currentZoomScale > 1.0) {
      flipbook.classList.add('is-zoomed');
    } else {
      flipbook.classList.remove('is-zoomed', 'is-dragging');
    }
  }
  if (zoomText) {
    zoomText.textContent = `${Math.round(currentZoomScale * 100)}%`;
  }
}

function applyZoom(scale) {
  currentZoomScale = Math.min(Math.max(scale, MIN_ZOOM), MAX_ZOOM);
  if (currentZoomScale <= 1.0) {
    panX = 0;
    panY = 0;
  }
  updateTransform();
}

function resetZoom() {
  panX = 0;
  panY = 0;
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
    rawPdfBuffer = pdfMemoryCache.get(fileId);
    await renderFlipbook(rawPdfBuffer, taskId);
    return;
  }

  showLoading('💾 檢查本地磁碟暫存...');
  const localDiskData = await getCachedPDFFromDisk(fileId);
  if (localDiskData) {
    pdfMemoryCache.set(fileId, localDiskData);
    rawPdfBuffer = localDiskData;
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
        const totalMB = (totalBytes / (1024 * 1024)).toFixed(1);
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
      rawPdfBuffer = finalBuffer;
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
      rawPdfBuffer = bytes;
      await saveCachedPDFToDisk(fileId, bytes);
      await renderFlipbook(bytes, taskId);
    } else {
      throw new Error(data.message || "未知錯誤");
    }
  } catch (err) {
    if (taskId === currentLoadingTaskId) {
      alert("開啟 PDF 失敗：" + err.message);
      hideLoading();
    }
  }
}

/**
 * ⚡ 單頁 Canvas 繪製器
 */
async function renderPageToCache(pageNum, taskId) {
  if (pageNum < 1 || pageNum > totalPagesCount) return;
  
  if (renderedImageCache.has(pageNum)) {
    const imgUrl = renderedImageCache.get(pageNum);
    const targetDiv = document.getElementById(`page-node-${pageNum}`);
    if (targetDiv && !targetDiv.querySelector('img')) {
      targetDiv.innerHTML = `<img src="${imgUrl}" alt="第 ${pageNum} 頁" />`;
    }
    return;
  }

  if (renderingPagesSet.has(pageNum)) return;
  renderingPagesSet.add(pageNum);

  try {
    const page = await currentPdfDoc.getPage(pageNum);
    const renderScale = Math.min(window.devicePixelRatio || 1, 1.2);
    const pageViewport = page.getViewport({ scale: renderScale });

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { alpha: false });
    canvas.height = pageViewport.height;
    canvas.width = pageViewport.width;

    await page.render({ canvasContext: context, viewport: pageViewport }).promise;

    const imgBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8));
    if (!imgBlob || taskId !== currentLoadingTaskId) return;

    const imgUrl = URL.createObjectURL(imgBlob);
    renderedImageCache.set(pageNum, imgUrl);

    const targetDiv = document.getElementById(`page-node-${pageNum}`);
    if (targetDiv) {
      targetDiv.innerHTML = `<img src="${imgUrl}" alt="第 ${pageNum} 頁" />`;
    }
  } catch (e) {
    console.error(`第 ${pageNum} 頁繪製失敗`, e);
  } finally {
    renderingPagesSet.delete(pageNum);
  }
}

/**
 * 🧠 智慧背景排程佇列
 */
async function startBackgroundQueue(taskId) {
  while (renderedImageCache.size < totalPagesCount) {
    if (taskId !== currentLoadingTaskId) break;

    if (isFlipAnimating) {
      await new Promise(r => setTimeout(r, 150));
      continue;
    }

    const currentIdx = currentPageFlip ? (currentPageFlip.getCurrentPageIndex() + 1) : 1;
    let targetPage = null;

    const priorityCandidates = [
      currentIdx, currentIdx + 1, currentIdx + 2, currentIdx + 3,
      currentIdx + 4, currentIdx - 1, currentIdx - 2
    ];

    for (const p of priorityCandidates) {
      if (p >= 1 && p <= totalPagesCount && !renderedImageCache.has(p) && !renderingPagesSet.has(p)) {
        targetPage = p;
        break;
      }
    }

    if (!targetPage) {
      for (let p = 1; p <= totalPagesCount; p++) {
        if (!renderedImageCache.has(p) && !renderingPagesSet.has(p)) {
          targetPage = p;
          break;
        }
      }
    }

    if (targetPage) {
      await renderPageToCache(targetPage, taskId);
    }

    await new Promise(r => setTimeout(r, 60));
  }
}

/**
 * 📖 3D 電子書渲染主引擎（支援橫式單頁自動偵測與全螢幕滿版）
 */
async function renderFlipbook(pdfData, taskId) {
  showLoading('⚡ 正在排版 3D 電子書...');
  resetZoom();

  renderedImageCache.forEach(url => URL.revokeObjectURL(url));
  renderedImageCache.clear();
  renderingPagesSet.clear();

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

  const containerViewport = document.querySelector('.flipbook-viewport');
  if (!containerViewport) return;

  let oldFlipbook = document.getElementById('flipbook');
  if (oldFlipbook) oldFlipbook.remove();

  const flipbookContainer = document.createElement('div');
  flipbookContainer.id = 'flipbook';
  containerViewport.appendChild(flipbookContainer);

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

    // 📐 自動判斷：手機端 OR 橫式 PDF 均啟用單頁全螢幕滿版
    const isMobile = window.innerWidth <= 768;
    const isLandscape = pdfAspectRatio > 1.1; // 長寬比 > 1.1 判定為橫式
    const forceSinglePage = isMobile || isLandscape;

    const availHeight = Math.max(300, (window.innerHeight || document.documentElement.clientHeight) - 120);
    const availWidth = Math.max(280, (window.innerWidth || document.documentElement.clientWidth) - 20);

    let pageW, pageH;
    if (forceSinglePage) {
      // 單頁滿版極限尺寸計算
      if (availWidth / availHeight > pdfAspectRatio) {
        pageH = Math.floor(availHeight);
        pageW = Math.floor(pageH * pdfAspectRatio);
      } else {
        pageW = Math.floor(availWidth);
        pageH = Math.floor(pageW / pdfAspectRatio);
      }
    } else {
      // 直式 PDF 桌面端雙頁展書
      const spreadRatio = 2 * pdfAspectRatio;
      if (availWidth / availHeight > spreadRatio) {
        pageH = Math.floor(availHeight);
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
      pageDiv.innerHTML = `<div class="page-skeleton">📄 第 ${i} 頁</div>`;
      pageElements.push(pageDiv);
    }

    const pageFlip = new St.PageFlip(flipbookContainer, {
      width: pageW,
      height: pageH,
      size: "fixed",
      showCover: !isLandscape, // 橫式單頁時不強制雙頁封面
      usePortrait: forceSinglePage, // 強制單頁呈現
      clickToFlip: true,
      maxShadowOpacity: isMobile ? 0.2 : 0.5
    });

    currentPageFlip = pageFlip;
    pageFlip.loadFromHTML(pageElements);

    pageFlip.on('changeState', (e) => {
      isFlipAnimating = (e.data !== 'read');
    });

    pageFlip.on('flip', (e) => {
      resetZoom(); // 翻頁時自動重置縮放與平移
      const currentPageNum = e.data + 1;
      updatePageNumDisplay(currentPageNum, totalPagesCount);
    });

    showLoading('⚡ 正在產生封面與前幾頁...');
    const initPages = [1, 2, 3].filter(p => p <= totalPagesCount);
    await Promise.all(initPages.map(p => renderPageToCache(p, taskId)));

    if (taskId === currentLoadingTaskId) {
      hideLoading();
    }

    startBackgroundQueue(taskId);

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
    showLoading('☁️️ 搜尋雲端書庫...');
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

// 📱 視窗 resize 自動校正
let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (rawPdfBuffer && currentLoadingTaskId) {
      renderFlipbook(rawPdfBuffer, currentLoadingTaskId);
    }
  }, 300);
});

// 🚀 DOM 載入完成後的事件總綁定
document.addEventListener('DOMContentLoaded', () => {
  fetchDrivePDFList();

  const btnZoomIn = document.getElementById('btn-zoom-in');
  const btnZoomOut = document.getElementById('btn-zoom-out');
  const btnZoomReset = document.getElementById('btn-zoom-reset');

  if (btnZoomIn) btnZoomIn.addEventListener('click', () => applyZoom(currentZoomScale + ZOOM_STEP));
  if (btnZoomOut) btnZoomOut.addEventListener('click', () => applyZoom(currentZoomScale - ZOOM_STEP));
  if (btnZoomReset) btnZoomReset.addEventListener('click', resetZoom);

  // 🖱️ 🤏 畫面拖拽平移 (Pan) 與觸控手勢整合
  const activeViewport = document.querySelector('.flipbook-viewport');
  let isDragging = false;
  let startX = 0;
  let startY = 0;

  if (activeViewport) {
    // 1. 電腦滑鼠拖曳 (MouseDown / Move / Up)
    activeViewport.addEventListener('mousedown', (e) => {
      if (currentZoomScale > 1.0) {
        isDragging = true;
        startX = e.clientX - panX;
        startY = e.clientY - panY;
        const flipbook = document.getElementById('flipbook');
        if (flipbook) flipbook.classList.add('is-dragging');
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (isDragging && currentZoomScale > 1.0) {
        e.preventDefault();
        panX = e.clientX - startX;
        panY = e.clientY - startY;
        updateTransform();
      }
    });

    window.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        const flipbook = document.getElementById('flipbook');
        if (flipbook) flipbook.classList.remove('is-dragging');
      }
    });

    // 2. 電腦滾輪 Ctrl + Wheel 縮放
    activeViewport.addEventListener('wheel', (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
        if (e.deltaY < 0) applyZoom(currentZoomScale + 0.1);
        else applyZoom(currentZoomScale - 0.1);
      }
    }, { passive: false });

    // 3. 📱 手機端觸控手勢 (雙指捏合縮放 + 單指放大後平移拖曳 + 雙擊放大)
    let initialPinchDistance = null;
    let initialScale = 1.0;
    let lastTapTime = 0;

    activeViewport.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        // 雙指捏合
        initialPinchDistance = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        initialScale = currentZoomScale;
      } else if (e.touches.length === 1) {
        // 單指放大後平移準備
        if (currentZoomScale > 1.0) {
          isDragging = true;
          startX = e.touches[0].clientX - panX;
          startY = e.touches[0].clientY - panY;
        }

        // 雙擊放大/還原
        const now = Date.now();
        if (now - lastTapTime < 300) {
          e.preventDefault();
          if (currentZoomScale > 1.0) {
            resetZoom();
          } else {
            applyZoom(1.6);
          }
        }
        lastTapTime = now;
      }
    }, { passive: false });

    activeViewport.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2 && initialPinchDistance) {
        // 雙指捏合中
        e.preventDefault();
        const currentDistance = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        const factor = currentDistance / initialPinchDistance;
        applyZoom(initialScale * factor);
      } else if (e.touches.length === 1 && isDragging && currentZoomScale > 1.0) {
        // 單指放大後拖曳畫面中
        e.preventDefault();
        panX = e.touches[0].clientX - startX;
        panY = e.touches[0].clientY - startY;
        updateTransform();
      }
    }, { passive: false });

    activeViewport.addEventListener('touchend', (e) => {
      if (e.touches.length < 2) {
        initialPinchDistance = null;
      }
      if (e.touches.length === 0) {
        isDragging = false;
      }
    });
  }

  // 4. 其餘介面按鈕綁定
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
          rawPdfBuffer = new Uint8Array(this.result);
          renderFlipbook(rawPdfBuffer, taskId); 
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
      if (currentPageFlip) {
        currentPageFlip.turnToPage(index);
      }
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
