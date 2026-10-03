pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let currentPageFlip = null;
let currentBlobUrls = [];
let totalPagesCount = 0;

// === DOM 元素綁定 ===
const uploadView = document.getElementById('upload-view');
const readerView = document.getElementById('reader-view');
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const bookTitle = document.getElementById('book-title');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');

// === 拖曳上傳 (Drag and Drop) 邏輯 ===
['dragenter', 'dragover'].forEach(eventName => {
  dropzone.addEventListener(eventName, (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });
});

['dragleave', 'drop'].forEach(eventName => {
  dropzone.addEventListener(eventName, (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
  });
});

dropzone.addEventListener('drop', (e) => {
  const files = e.dataTransfer.files;
  if (files.length > 0 && files[0].type === 'application/pdf') {
    handlePDFFile(files[0]);
  } else {
    alert("請上傳有效的 PDF 檔案！");
  }
});

fileInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) {
    handlePDFFile(e.target.files[0]);
  }
});

/**
 * 處理並讀取本地 PDF 檔案
 */
function handlePDFFile(file) {
  bookTitle.textContent = file.name;
  
  // 切換視圖至閱讀器
  uploadView.classList.remove('active');
  readerView.classList.add('active');
  loadingOverlay.style.display = 'flex';
  loadingText.textContent = "⚡ 正在解析 PDF 檔案...";

  const reader = new FileReader();
  reader.onload = function () {
    const pdfData = new Uint8Array(this.result);
    renderFlipbook(pdfData);
  };
  reader.readAsArrayBuffer(file);
}

/**
 * 將 PDF 轉換為 3D 電子書的核心函式
 */
async function renderFlipbook(pdfData) {
  // 1. 銷毀舊實例與清理記憶體
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

    // 2. 算出無裁切的最佳邊界 (扣除 Header 50px + Footer 56px)
    const firstPage = await pdf.getPage(1);
    const unscaledViewport = firstPage.getViewport({ scale: 1.0 });
    const pdfAspectRatio = unscaledViewport.width / unscaledViewport.height;

    const availHeight = Math.max(300, window.innerHeight - 116);
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

    // 3. 建立 DOM 占位節點
    const pageElements = [];
    for (let i = 1; i <= totalPagesCount; i++) {
      const pageDiv = document.createElement('div');
      pageDiv.className = 'my-page';
      pageDiv.id = `page-node-${i}`;
      pageDiv.innerHTML = `<div style="color:#aaa; font-size:13px;">📄 第 ${i} 頁...</div>`;
      pageElements.push(pageDiv);
    }

    // 4. 初始化 PageFlip 3D
    const pageFlip = new St.PageFlip(flipbookContainer, {
      width: pageW,
      height: pageH,
      size: "fixed",
      showCover: true,
      usePortrait: true, // 手機直立自動變單頁
      clickToFlip: true
    });

    currentPageFlip = pageFlip;
    pageFlip.loadFromHTML(pageElements);

    // 監聽翻頁更新進度條
    pageFlip.on('flip', (e) => {
      const current = e.data + 1;
      updatePageNumDisplay(current, totalPagesCount);
    });

    // 5. 漸進式渲染圖片 (Retina 2.0x 高畫質)
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

      // 秒開：前兩頁繪製完畢立刻隱藏讀取動畫，開始享受閱讀！
      if (pageNum === 2 || pageNum === totalPagesCount) {
        loadingOverlay.style.display = 'none';
      }

      await new Promise(resolve => setTimeout(resolve, 10));
    }

  } catch (err) {
    console.error("PDF 解析失敗:", err);
    alert("無法讀取此 PDF 檔案，請確認檔案未損毀。");
    loadingOverlay.style.display = 'none';
  }
}

// === 導覽控制與快捷鍵 ===
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

// 換一本檔案（返回上傳頁）
document.getElementById('btn-reupload').addEventListener('click', () => {
  readerView.classList.remove('active');
  uploadView.classList.add('active');
  fileInput.value = '';
});

// 翻頁按鈕
document.getElementById('btn-prev').addEventListener('click', () => {
  if (currentPageFlip) currentPageFlip.flipPrev();
});

document.getElementById('btn-next').addEventListener('click', () => {
  if (currentPageFlip) currentPageFlip.flipNext();
});

// Slider 滑動跳頁
document.getElementById('page-slider').addEventListener('input', (e) => {
  const pageIndex = parseInt(e.target.value, 10) - 1;
  if (currentPageFlip) currentPageFlip.turnToPage(pageIndex);
});

// 全螢幕切換
document.getElementById('btn-fullscreen').addEventListener('click', () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen();
  } else {
    if (document.exitFullscreen) document.exitFullscreen();
  }
});

// 鍵盤方向鍵快捷鍵
document.addEventListener('keydown', (e) => {
  if (!readerView.classList.contains('active')) return;
  if (e.key === 'ArrowLeft' && currentPageFlip) {
    currentPageFlip.flipPrev();
  } else if (e.key === 'ArrowRight' && currentPageFlip) {
    currentPageFlip.flipNext();
  } else if (e.key === 'f' || e.key === 'F') {
    document.getElementById('btn-fullscreen').click();
  }
});
