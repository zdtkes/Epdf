// 設定 PDF.js Worker 資源路徑
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// 您已部署好的 Google Apps Script Web App 網址
const GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbycy5pkeglcKjmMye9WLE76mn6uNiBqqTJDky4Et3Pta5cKNowiwkpt6MvXPz4fEgA6oQ/exec";

let currentPageFlip = null;
let currentBlobUrls = [];

/**
 * 將 Base64 字串轉為 Uint8Array (供 PDF.js 解析)
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
 * 透過 Google Apps Script 從雲端讀取 PDF 內容
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
    alert("雲端 PDF 下載失敗，請確認該檔案大小與 Google Drive 的檢視權限。");
    if (loadingTip) loadingTip.style.display = 'none';
  }
}

/**
 * 高速、防裁切且支援行動裝置的 PDF 3D 渲染核心
 */
async function loadPDF(pdfSource) {
  const flipbookContainer = document.getElementById('flipbook');
  const loadingTip = document.getElementById('loading-tip');
  
  if (loadingTip) {
    loadingTip.style.display = 'block';
    loadingTip.textContent = '⚡ 電子書準備中...';
  }

  // 銷毀舊實例與釋放舊記憶體
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

    // 1. 動態計算 PDF 第一頁的真實寬高比 (避免硬寫死導致裁切)
    const firstPage = await pdf.getPage(1);
    const unscaledViewport = firstPage.getViewport({ scale: 1.0 });
    const pdfAspectRatio = unscaledViewport.width / unscaledViewport.height;

    // 2. 判斷設備（手機 vs 平板/電腦）與寬度計算
    const isMobile = window.innerWidth <= 768;
    const baseHeight = isMobile ? Math.min(window.innerHeight * 0.65, 550) : 700;
    const baseWidth = Math.round(baseHeight * pdfAspectRatio);

    // 3. 初始化 PageFlip (自動切換單/雙頁)
    const pageFlip = new St.PageFlip(flipbookContainer, {
      width: baseWidth,                // 計算出的精準單頁寬度
      height: baseHeight,              // 計算出的精準頁面高度
      size: "stretch",
      minWidth: 260,
      maxWidth: 900,
      minHeight: 350,
      maxHeight: 1200,
      maxShadowOpacity: 0.4,
      showCover: true,                 // 第一頁做為封面
      usePortrait: true,               // 💡 直立螢幕(手機)自動切換為「單頁模式」
      mobileScrollSupport: false,      // 防止手機滑動時與翻頁手勢衝突
      clickToFlip: true                // 點擊邊緣即可翻頁
    });

    currentPageFlip = pageFlip;
    const pageElements = [];

    // 4. 提高渲染畫質 (Retina 螢幕清晰度優化，固定用 scale: 2.0)
    const renderScale = window.devicePixelRatio && window.devicePixelRatio > 1 ? 2.0 : 1.5;

    // 逐頁渲染
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

      // 轉為的高速 Blob URL
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

      // 釋放 UI 執行緒
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    // 5. 將頁面載入 3D 翻頁組件
    pageFlip.loadFromHTML(pageElements);

  } catch (err) {
    console.error("PDF 渲染失敗:", err);
    alert("PDF 載入失敗，請確認檔案格式是否正確或是否有 main.pdf 檔案。");
  } finally {
    if (loadingTip) loadingTip.style.display = 'none';
  }
}

/**
 * 讀取 Google Drive 資料夾內的 PDF 清單
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

// 初始化綁定
document.addEventListener('DOMContentLoaded', () => {
  // 1. 預設秒開本地 main.pdf
  loadPDF('main.pdf');

  // 2. 抓取雲端書庫
  fetchDrivePDFList();

  // 3. 下拉選單切換電子書
  const gdriveSelect = document.getElementById('gdrive-select');
  if (gdriveSelect) {
    gdriveSelect.addEventListener('change', (e) => {
      if (e.target.value) {
        loadDrivePDF(e.target.value);
      }
    });
  }

  // 4. 本地檔案上傳監聽
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

  // 5. 背景音樂播放控制
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
