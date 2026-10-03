pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbzi7xUsWCMSDul7rMNiO-chdg78gmqkCCRaZN_Xw6HSQY4J5lSCciNDbMIT89qahJky/exec";

let currentPageFlip = null;
let currentPdfDoc = null;
let currentBlobUrls = [];
let totalPagesCount = 0;
let currentLoadingTaskId = 0; // 用於追蹤最新載入任務，避免快速切換檔案時衝突

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
 * ⚡ 雙管道載入 PDF (直連優先，失敗走控頻分段下載)
 */
async function loadDrivePDF(fileId) {
  const taskId = ++currentLoadingTaskId;
  showLoading('⚡ 正在從雲端載入 PDF...');

  // 1. 嘗試直連 CDN
  const cdnUrl = `https://lh3.googleusercontent.com/d/${fileId}`;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    const res = await fetch(cdnUrl, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (res.ok) {
      const buf = await res.arrayBuffer();
      const bytes = new Uint8Array(buf);
      if (bytes[0] === 0x25 && bytes[1] === 0x50) { // 確保為 %PDF
        if (taskId === currentLoadingTaskId) {
          await renderFlipbook(bytes, taskId);
        }
        return;
      }
    }
  } catch (e) {
    console.warn("CDN 直連不可用，切換至 GAS 安全管道...");
  }

  // 2. 備用：GAS 控頻安全下載
  if (taskId === currentLoadingTaskId) {
    await loadDrivePDFSafeGAS(fileId, taskId);
  }
}

/**
 * 🛡️ GAS 控頻下載引擎 (限制 Max 2 併發，避免 429 被 Google 阻擋)
 */
async function loadDrivePDFSafeGAS(fileId, taskId) {
  try {
    const metaRes = await fetch(`${GAS_WEB_APP_URL}?id=${fileId}&action=meta`);
    const meta = await metaRes.json();
    if (meta.status === "error") throw new Error(meta.message);

    const totalSize = meta.size;
    const chunkSize = 2 * 1024 * 1024; // 每區塊 2MB
    const totalChunks = Math.ceil(totalSize / chunkSize);
    const finalBuffer = new Uint8Array(totalSize);

    // 單一區塊下載 (含 3 次失敗自動重試)
    async function fetchChunkWithRetry(start, length, retries = 3) {
      for (let attempt = 0; attempt < retries; attempt++) {
        try {
          const r = await fetch(`${GAS_WEB_APP_URL}?id=${fileId}&start=${start}&length=${length}`);
          const json = await r.json();
          if (json.status === "success") return json;
        } catch (e) {
          console.warn(`區塊 ${start} 下載重試 (${attempt + 1}/${retries})...`);
        }
        await new Promise(res => setTimeout(res, 500));
      }
      throw new Error(`雲端資料區塊 (${start}) 傳輸失敗`);
    }

    // 控頻隊列 (最多同時 2 個連線)
    let completedChunks = 0;
    const poolLimit = 2;
    const tasks = [];

    for (let i = 0; i < totalChunks; i++) {
      tasks.push(async () => {
        if (taskId !== currentLoadingTaskId) return; // 任務已過期
        const start = i * chunkSize;
        const chunkJson = await fetchChunkWithRetry(start, chunkSize);
        
        const binaryStr = window.atob(chunkJson.data);
        for (let j = 0; j < binaryStr.length; j++) {
          finalBuffer[start + j] = binaryStr.charCodeAt(j);
        }

        completedChunks++;
        const percent = Math.round((completedChunks / totalChunks) * 100);
        showLoading(`⚡ 雲端傳輸中 (${percent}%)...`);
      });
    }

    // 執行控頻池
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
      await renderFlipbook(finalBuffer, taskId);
    }

  } catch (err) {
    console.error("下載失敗:", err);
    if (taskId === currentLoadingTaskId) {
      alert("開啟雲端 PDF 失敗：" + err.message);
      hideLoading();
    }
  }
}

/**
 * 📖 3D 電子書渲染引擎 (含完整重置與防卡死保護)
 */
async function renderFlipbook(pdfData, taskId) {
  showLoading('⚡ 正在排版 3D 電子書...');

  // 隱藏上傳區
  const dropzoneSection = document.getElementById('dropzone-section');
  if (dropzoneSection) dropzoneSection.style.display = 'none';

  // 1. 徹底銷毀舊 PDF.js 實體與 3D 物件
  if (currentPdfDoc) {
    try { currentPdfDoc.destroy(); } catch (e) {}
    currentPdfDoc = null;
  }
  if (currentPageFlip) {
    try { currentPageFlip.destroy(); } catch (e) {}
    currentPageFlip = null;
  }
  
  // 釋放舊圖片記憶體
  currentBlobUrls.forEach(url => URL.revokeObjectURL(url));
  currentBlobUrls = [];

  // 2. 重置並建立全新的 DOM 容器
  const viewportContainer = document.querySelector('.flipbook-viewport');
  if (!viewportContainer) return;

  let oldFlipbook = document.getElementById('flipbook');
  if (oldFlipbook) oldFlipbook.remove();

  const flipbookContainer = document.createElement('div');
  flipbookContainer.id = 'flipbook';
  viewportContainer.appendChild(flipbookContainer);

  try {
    // 3. 解析 PDF 文件 (加入 12 秒超時防護)
    const loadingTask = pdfjsLib.getDocument({ data: pdfData });
    
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error("PDF 解析超時")), 12000)
    );

    const pdf = await Promise.race([loadingTask.promise, timeoutPromise]);
    if (taskId !== currentLoadingTaskId) return;

    currentPdfDoc = pdf;
    totalPagesCount = pdf.numPages;

    updateSliderUI(1, totalPagesCount);

    // 4. 計算滿版排版尺寸
    const firstPage = await pdf.getPage(1);
    const unscaledViewport = firstPage.getViewport({ scale: 1.0 });
    const pdfAspectRatio = unscaledViewport.width / unscaledViewport.height;

    const availHeight = Math.max(320, window.innerHeight - 106);
    const availWidth = Math.max(300, window.innerWidth - 16);
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

    // 5. 建立頁面節點
    const pageElements = [];
    for (let i = 1; i <= totalPagesCount; i++) {
      const pageDiv = document.createElement('div');
      pageDiv.className = 'my-page';
      pageDiv.id = `page-node-${i}`;
      pageDiv.innerHTML = `<div style="color:#aaa; font-size:12px;">📄 第 ${i} 頁...</div>`;
      pageElements.push(pageDiv);
    }

    // 6. 初始化 3D 翻頁組件
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

    const renderScale = Math.min(window.devicePixelRatio || 1, 1.5);

    // 7. 非阻塞式頁面渲染 Helper (使用 toBlob)
    async function renderSinglePage(pageNum) {
      if (taskId !== currentLoadingTaskId) return;
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: renderScale });

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      await page.render({ canvasContext: context, viewport: viewport }).promise;

      const imgBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
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

    // 8. 秒開：繪製第 1 頁與第 2 頁，完成立刻開書
    showLoading('⚡ 正在產生封面...');
    await renderSinglePage(1);
    if (totalPagesCount >= 2) {
      await renderSinglePage(2);
    }
    
    if (taskId === currentLoadingTaskId) {
      hideLoading();
    }

    // 9. 背景靜默繪製剩餘頁面
    (async () => {
      for (let p = 3; p <= totalPagesCount; p++) {
        if (taskId !== currentLoadingTaskId) break; // 若已切換新檔案則終止
        await renderSinglePage(p);
        await new Promise(r => setTimeout(r, 15));
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

/**
 * 自動抓取雲端書庫清單
 */
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

    // 預設開啟首份雙週報
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
  const folderMatch = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch) {
    showLoading("📁 讀取資料夾...");
    fetchDrivePDFList().then(() => {
      hideLoading();
      alert("已更新雲端書單！");
    });
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

// 初始化事件綁定
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
        reader.onload = function() { 
          const taskId = ++currentLoadingTaskId;
          renderFlipbook(new Uint8Array(this.result), taskId); 
        };
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
