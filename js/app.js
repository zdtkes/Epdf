pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbzi7xUsWCMSDul7rMNiO-chdg78gmqkCCRaZN_Xw6HSQY4J5lSCciNDbMIT89qahJky/exec";

let currentPageFlip = null;
let currentBlobUrls = [];
let totalPagesCount = 0;

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
 * ⚡ 極速下載：先試 CDN 直連，失敗則啟用「多線程並行下載」
 */
async function loadDrivePDF(fileId) {
  showLoading('⚡ 正在從雲端極速下載 PDF...');

  // 1. 嘗試 CDN 直連
  const cdnUrl = `https://lh3.googleusercontent.com/d/${fileId}`;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000); // 2秒無回應自動切換

    const res = await fetch(cdnUrl, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (res.ok) {
      const buf = await res.arrayBuffer();
      const bytes = new Uint8Array(buf);
      if (bytes[0] === 0x25 && bytes[1] === 0x50) { // 確定為 %PDF
        await renderFlipbook(bytes);
        return;
      }
    }
  } catch (e) {
    console.warn("CDN 直連不可用，開啟 GAS 多線程並行下載...");
  }

  // 2. 啟用 GAS 多線程並行下載 (Parallel Chunk Fetching)
  await loadDrivePDFParallelGAS(fileId);
}

/**
 * ⚡ GAS 多線程並行下載引擎 (速度提升 5~10 倍)
 */
async function loadDrivePDFParallelGAS(fileId) {
  try {
    // A. 先取檔案大小 Meta
    const metaRes = await fetch(`${GAS_WEB_APP_URL}?id=${fileId}&action=meta`);
    const meta = await metaRes.json();
    if (meta.status === "error") throw new Error(meta.message);

    const totalSize = meta.size;
    const chunkSize = 2 * 1024 * 1024; // 每塊 2MB
    const totalChunks = Math.ceil(totalSize / chunkSize);
    const finalBuffer = new Uint8Array(totalSize);

    let completedChunks = 0;

    // B. 同時發起所有小區塊的下載請求 (Parallel Requests)
    const chunkPromises = [];
    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const length = chunkSize;

      const promise = fetch(`${GAS_WEB_APP_URL}?id=${fileId}&start=${start}&length=${length}`)
        .then(r => r.json())
        .then(chunkJson => {
          if (chunkJson.status === "error") throw new Error(chunkJson.message);

          const binaryStr = window.atob(chunkJson.data);
          for (let j = 0; j < binaryStr.length; j++) {
            finalBuffer[start + j] = binaryStr.charCodeAt(j);
          }

          completedChunks++;
          const percent = Math.round((completedChunks / totalChunks) * 100);
          showLoading(`⚡ 極速下載中 (${percent}%)...`);
        });

      chunkPromises.push(promise);
    }

    // 等待所有線程並行完成
    await Promise.all(chunkPromises);

    // C. 開始繪製電子書
    await renderFlipbook(finalBuffer);

  } catch (err) {
    console.error("並行下載失敗:", err);
    alert("開啟雲端 PDF 失敗：" + err.message);
    hideLoading();
  }
}

/**
 * 📖 0.3秒首頁秒開引擎
 */
async function renderFlipbook(pdfData) {
  showLoading('⚡ 正在排版 3D 電子書...');

  const dropzoneSection = document.getElementById('dropzone-section');
  if (dropzoneSection) dropzoneSection.style.display = 'none';

  if (currentPageFlip) {
    try { currentPageFlip.destroy(); } catch (e) {}
    currentPageFlip = null;
  }
  currentBlobUrls.forEach(url => URL.revokeObjectURL(url));
  currentBlobUrls = [];

  const flipbookContainer = document.getElementById('flipbook');
  if (!flipbookContainer) return;
  flipbookContainer.innerHTML = '';

  try {
    const loadingTask = pdfjsLib.getDocument({ data: pdfData });
    const pdf = await loadingTask.promise;
    totalPagesCount = pdf.numPages;

    updateSliderUI(1, totalPagesCount);

    // 視窗尺寸最大化計算
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

    // 適中渲染倍數 (兼顧清晰度與繪製速度)
    const renderScale = Math.min(window.devicePixelRatio || 1, 1.4);

    async function renderSinglePage(pageNum) {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: renderScale });

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      await page.render({ canvasContext: context, viewport: viewport }).promise;

      const imgUrl = canvas.toDataURL('image/jpeg', 0.85);

      const targetDiv = document.getElementById(`page-node-${pageNum}`);
      if (targetDiv) {
        targetDiv.innerHTML = '';
        const img = document.createElement('img');
        img.src = imgUrl;
        img.alt = `第 ${pageNum} 頁`;
        targetDiv.appendChild(img);
      }
    }

    // 🔥 核心關鍵：優先繪製第 1 頁（0.3秒），完成立刻開啟閱讀器！
    showLoading('⚡ 正在產生封面...');
    await renderSinglePage(1);
    
    // 立即讓使用者開始看書！
    hideLoading();

    // 背景靜默非同步繪製剩餘頁面
    (async () => {
      for (let p = 2; p <= totalPagesCount; p++) {
        await renderSinglePage(p);
        await new Promise(r => setTimeout(r, 10));
      }
    })();

  } catch (err) {
    console.error("PDF 解析失敗:", err);
    alert("PDF 檔案解析失敗：" + err.message);
    hideLoading();
  }
}

/**
 * 自動抓取雲端書單並載入首本
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

    // 頁面開啟立刻加載第一個檔案
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

// 初始化綁定
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
