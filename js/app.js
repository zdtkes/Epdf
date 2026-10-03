// 設定 PDF.js Worker 資源路徑
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Google Apps Script Web App 網址
const GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbycy5pkeglcKjmMye9WLE76mn6uNiBqqTJDky4Et3Pta5cKNowiwkpt6MvXPz4fEgA6oQ/exec";

let currentPageFlip = null;
let currentBlobUrls = [];

/**
 * 將 Base64 字串轉為 Uint8Array
 */
function base64ToUint8Array(base64) {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * 從 Google Drive 下載 PDF
 */
async function loadDrivePDF(fileId) {
  const loadingTip = document.getElementById('loading-tip');
  if (loadingTip) {
    loadingTip.style.display = 'block';
    loadingTip.textContent = '☁️ 正在從 Google Drive 下載 PDF...';
  }

  try {
    const res = await fetch(`${GAS_WEB_APP_URL}?id=${fileId}`);
    const result = await res.json();

    if (result.status === "success" && result.data) {
      const pdfBytes = base64ToUint8Array(result.data);
      await loadPDF(pdfBytes);
    } else {
      throw new Error(result.message || "無法取得檔案內容");
    }
  } catch (err) {
    console.error("下載雲端 PDF 失敗:", err);
    alert("雲端 PDF 下載失敗，請確認該檔案大小與權限。");
    if (loadingTip) loadingTip.style.display = 'none';
  }
}

/**
 * 自動計算螢幕空間，完美防裁切渲染 PDF
 */
async function loadPDF(pdfSource) {
  const flipbookContainer = document.getElementById('flipbook');
  const loadingTip = document.getElementById('loading-tip');
  
  if (loadingTip) {
    loadingTip.style.display = 'block';
    loadingTip.textContent = '⚡ 電子書準備中...';
  }

  // 1. 銷毀舊實例與釋放記憶體
  if (currentPageFlip) {
    try { currentPageFlip.destroy(); } catch (e) {}
    currentPageFlip = null;
  }
  
  currentBlobUrls.forEach(url => URL.revokeObjectURL(url));
  currentBlobUrls = [];

  if (flipbookContainer) flipbookContainer.innerHTML = '';

  try {
    const loadingTask = pdfjsLib.getDocument(pdfSource);
    const pdf = await loadingTask.promise;

    // 2. 取得 PDF 原始寬高比
    const firstPage = await pdf.getPage(1);
    const unscaledViewport = firstPage.getViewport({ scale: 1.0 });
    const pdfAspectRatio = unscaledViewport.width / unscaledViewport.height; // 單頁寬高比

    // 3. 精確計算「當前螢幕可用扣除空間」
    const navBarHeight = 55; // 頂部列高度 + 邊距
    const availHeight = Math.max(300, window.innerHeight - navBarHeight - 20); // 可用高度
    const availWidth = Math.max(300, window.innerWidth - 40);                   // 可用總寬度

    const isMobile = window.innerWidth <= 768;
    let pageW, pageH;

    if (isMobile) {
      // 手機直立 (單頁模式)：受限於可用高度或寬度
      if (availWidth / availHeight > pdfAspectRatio) {
        pageH = availHeight;
        pageW = Math.floor(pageH * pdfAspectRatio);
      } else {
        pageW = availWidth;
        pageH = Math.floor(pageW / pdfAspectRatio);
      }
    } else {
      // 電腦/平板 (雙頁展開模式)：雙頁總寬度比例 = 2 * pdfAspectRatio
      const spreadRatio = 2 * pdfAspectRatio;
      if (availWidth / availHeight > spreadRatio) {
        // 螢幕夠寬，限制高度為 main 邊界，算出精準頁寬
        pageH = availHeight;
        pageW = Math.floor(pageH * pdfAspectRatio);
      } else {
        // 螢幕較窄，限制寬度
        pageW = Math.floor((availWidth / 2));
        pageH = Math.floor(pageW / pdfAspectRatio);
      }
    }

    // 4. 以「固定精確像素 (size: "fixed")」初始化 PageFlip，保證 100% 滿版不超出螢幕
    const pageFlip = new St.PageFlip(flipbookContainer, {
      width: pageW,
      height: pageH,
      size: "fixed",                   // 💡 關鍵：固定精確計算的尺寸，絕不溢出裁切
      minWidth: 200,
      maxWidth: 1200,
      minHeight: 300,
      maxHeight: 1400,
      maxShadowOpacity: 0.4,
      showCover: true,
      usePortrait: true,               // 手機直立自動轉單頁
      mobileScrollSupport: false,
      clickToFlip: true
    });

    currentPageFlip = pageFlip;
    const pageElements = [];

    // 5. 渲染頁面 (使用 Retina 2.0 倍高清畫質)
    const renderScale = (window.devicePixelRatio && window.devicePixelRatio > 1) ? 2.0 : 1.5;

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      if (loadingTip) {
        loadingTip.textContent = `📄 轉換頁面 (${pageNum}/${pdf.numPages})...`;
      }

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

      const img = document.createElement('img');
      img.src = imgUrl;
      img.alt = `第 ${pageNum} 頁`;
      
      const pageDiv = document.createElement('div');
      pageDiv.className = 'my-page';
      pageDiv.appendChild(img);
      
      pageElements.push(pageDiv);

      await new Promise(resolve => setTimeout(resolve, 0));
    }

    pageFlip.loadFromHTML(pageElements);

  } catch (err) {
    console.error("PDF 渲染失敗:", err);
    alert("PDF 載入失敗，請確認檔案格式是否正確。");
  } finally {
    if (loadingTip) loadingTip.style.display = 'none';
  }
}

/**
 * 讀取 Google Drive PDF 清單
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

    gdriveSelect.innerHTML = '<option value="">-- 請選擇雲端電子書 --</option>';
    pdfList.forEach(pdf => {
      const opt = document.createElement('option');
      opt.value = pdf.id;
      opt.textContent = pdf.name;
      gdriveSelect.appendChild(opt);
    });
  } catch (err) {
    console.error("讀取 Google Drive 列表失敗:", err);
    gdriveSelect.innerHTML = '<option value="">雲端書單讀取失敗</option>';
  }
}

// 頁面初始化
document.addEventListener('DOMContentLoaded', () => {
  // 預設秒開 main.pdf
  loadPDF('main.pdf');

  // 背景抓取雲端書庫
  fetchDrivePDFList();

  // 下拉選單監聽
  const gdriveSelect = document.getElementById('gdrive-select');
  if (gdriveSelect) {
    gdriveSelect.addEventListener('change', (e) => {
      if (e.target.value) {
        loadDrivePDF(e.target.value);
      }
    });
  }

  // 本地檔案上傳監聽
  const pdfInput = document.getElementById('pdf-upload');
  if (pdfInput) {
    pdfInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file && file.type === 'application/pdf') {
        const fileReader = new FileReader();
        fileReader.onload = function () {
          const typedarray = new Uint8Array(this.result);
          loadPDF(typedarray);
        };
        fileReader.readAsArrayBuffer(file);
      } else {
        alert("請選擇有效的 PDF 檔案！");
      }
    });
  }

  // 背景音樂控制
  const bgAudio = document.getElementById('bg-audio');
  const btnToggle = document.getElementById('btn-toggle-music');
  const musicSelect = document.getElementById('music-select');

  if (btnToggle && bgAudio) {
    btnToggle.addEventListener('click', () => {
      if (bgAudio.paused) {
        bgAudio.play().then(() => {
          btnToggle.textContent = '⏸ 暫停音樂';
        }).catch(err => {
          alert("音樂播放失敗，請確認 audio/ 資料夾中是否存在該 MP3 檔案。");
        });
      } else {
        bgAudio.pause();
        btnToggle.textContent = '▶ 播放音樂';
      }
    });
  }

  if (musicSelect && bgAudio) {
    musicSelect.addEventListener('change', (e) => {
      bgAudio.src = e.target.value;
      bgAudio.play().catch(err => console.error(err));
      if (btnToggle) btnToggle.textContent = '⏸ 暫停音樂';
    });
  }
});
