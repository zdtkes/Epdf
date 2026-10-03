pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbyqYy4ZrQLvYxLuFN3cRFtxi1GpBmOVCQGVa8pQEUY3_WUxjKH1zQM9AQsOrMebrsvp/exec";

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
 * ⚡ 雙下載管道：直連 CDN 優先，備用走 GAS
 */
async function loadDrivePDF(fileId) {
  showLoading('⚡ 下載雲端 PDF 中...');
  
  // 嘗試 CDN 直連
  const cdnUrl = `https://lh3.googleusercontent.com/d/${fileId}`;
  try {
    const response = await fetch(cdnUrl);
    if (!response.ok) throw new Error("CDN 直連失敗");
    const arrayBuffer = await response.arrayBuffer();
    const pdfBytes = new Uint8Array(arrayBuffer);
    
    // 驗證是否為合法 PDF 標頭 (%PDF)
    if (pdfBytes[0] === 0x25 && pdfBytes[1] === 0x50) {
      await renderFlipbook(pdfBytes);
      return;
    }
    throw new Error("非有效 PDF");
  } catch (e) {
    console.warn("CDN 下載受限，自動切換至 GAS 串流管道...");
    await loadDrivePDFviaGAS(fileId);
  }
}

async function loadDrivePDFviaGAS(fileId) {
  try {
    const res = await fetch(`${GAS_WEB_APP_URL}?id=${fileId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const result = await res.json();
    if (result.status === "error") throw new Error(result.message);

    const binaryStr = window.atob(result.data);
    const len = binaryStr.length;
    const pdfBytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      pdfBytes[i] = binaryStr.charCodeAt(i);
    }

    await renderFlipbook(pdfBytes);
  } catch (err) {
    console.error("載入失敗:", err);
    alert("開啟雲端 PDF 失敗：" + err.message);
    hideLoading();
  }
}

/**
 * ⚡ 秒開 3D 電子書（繪製完前兩頁即打開，剩餘頁面背景異步繪製）
 */
async function renderFlipbook(pdfData) {
  showLoading('⚡ 正在準備排版...');

  // 1. 自動隱藏拖曳上傳區，呈現最大空間
  const dropzoneSection = document.getElementById('dropzone-section');
  if (dropzoneSection) dropzoneSection.style.display = 'none';

  // 2. 清理舊記憶體與元件
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

    // 3. 電腦版/手機版滿版尺寸計算算式
    const firstPage = await pdf.getPage(1);
    const unscaledViewport = firstPage.getViewport({ scale: 1.0 });
    const pdfAspectRatio = unscaledViewport.width / unscaledViewport.height;

    // 扣除 Header (48px) + Footer (48px) + 邊距 10px
    const availHeight = Math.max(320, window.innerHeight - 106);
    const availWidth = Math.max(300, window.innerWidth - 16);
    const isMobile = window.innerWidth <= 768;

    let pageW, pageH;
    if (isMobile) {
      // 手機單頁：儘可能放大
      if (availWidth / availHeight > pdfAspectRatio) {
        pageH = availHeight;
        pageW = Math.floor(pageH * pdfAspectRatio);
      } else {
        pageW = availWidth;
        pageH = Math.floor(pageW / pdfAspectRatio);
      }
    } else {
      // 電腦雙頁展開：佔滿螢幕 90% 以上高度
      const spreadRatio = 2 * pdfAspectRatio;
      if (availWidth / availHeight > spreadRatio) {
        pageH = availHeight;
        pageW = Math.floor(pageH * pdfAspectRatio);
      } else {
        pageW = Math.floor(availWidth / 2);
        pageH = Math.floor(pageW / pdfAspectRatio);
      }
    }

    // 4. 建立頁面佔位 DOM
    const pageElements = [];
    for (let i = 1; i <= totalPagesCount; i++) {
      const pageDiv = document.createElement('div');
      pageDiv.className = 'my-page';
      pageDiv.id = `page-node-${i}`;
      pageDiv.innerHTML = `<div style="color:#aaa; font-size:12px;">📄 第 ${i} 頁...</div>`;
      pageElements.push(pageDiv);
    }

    // 5. 初始化 3D 翻頁組件
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

    // 6. 關鍵：異步漸進式繪製 (Render Helper)
    async function renderSinglePage(pageNum) {
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
    }

    // 7. 🔥 秒開優化：優先繪製前 2 頁，完成後立刻開書！
    showLoading('⚡ 正在渲染頁面...');
    await renderSinglePage(1);
    if (totalPagesCount >= 2) {
      await renderSinglePage(2);
    }
    
    // 立即關閉遮罩，使用者開始閱讀！
    hideLoading();

    // 8. 剩餘頁面在背景靜默渲染 (不卡頓 UI)
    (async () => {
      for (let p = 3; p <= totalPagesCount; p++) {
        await renderSinglePage(p);
        await new Promise(r => setTimeout(r, 15)); // 給予主線程喘息時間
      }
    })();

  } catch (err) {
    console.error("PDF 解析失敗:", err);
    alert("PDF 檔案解析失敗：" + err.message);
    hideLoading();
  }
}

/**
 * 讀取 Google Drive 資料夾清單，並自動開啟第一本
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

    // 自動加載第一個檔案
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

// 事件初始化
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
