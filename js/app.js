// 設定 PDF.js Worker 資源路徑
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// 您更新後的 Google Apps Script Web App 網址
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
 * 高速渲染 PDF 並轉為 3D 翻頁電子書
 */
async function loadPDF(pdfSource) {
  const flipbookContainer = document.getElementById('flipbook');
  const loadingTip = document.getElementById('loading-tip');
  
  if (loadingTip) {
    loadingTip.style.display = 'block';
    loadingTip.textContent = '⚡ 電子書準備中...';
  }

  // 銷毀舊實例
  if (currentPageFlip) {
    try { currentPageFlip.destroy(); } catch (e) {}
    currentPageFlip = null;
  }
  
  // 釋放先前產生的 Blob 記憶體
  currentBlobUrls.forEach(url => URL.revokeObjectURL(url));
  currentBlobUrls = [];

  if (flipbookContainer) flipbookContainer.innerHTML = '';

  try {
    const loadingTask = pdfjsLib.getDocument(pdfSource);
    const pdf = await loadingTask.promise;

    // 初始化 PageFlip 實例（A4 比例）
    const pageFlip = new St.PageFlip(flipbookContainer, {
      width: 530,
      height: 750,
      size: "stretch",
      minWidth: 300,
      maxWidth: 800,
      minHeight: 424,
      maxHeight: 1131,
      maxShadowOpacity: 0.5,
      showCover: true,
      mobileScrollSupport: false
    });

    currentPageFlip = pageFlip;
    const pageElements = [];

    // 逐頁渲染畫面
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      if (loadingTip) {
        loadingTip.textContent = `📄 轉換頁面 (${pageNum}/${pdf.numPages})...`;
      }

      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.3 });

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      await page.render({ canvasContext: context, viewport: viewport }).promise;

      // 使用 Blob URL 優化記憶體與渲染速度
      const imgUrl = await new Promise(resolve => {
        canvas.toBlob(blob => {
          const url = URL.createObjectURL(blob);
          currentBlobUrls.push(url);
          resolve(url);
        }, 'image/jpeg', 0.85);
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
      opt.value = pdf.id; // 使用檔案 ID 進行存取
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
  // 1. 抓取雲端書庫清單
  fetchDrivePDFList();

  // 2. 切換雲端電子書
  const gdriveSelect = document.getElementById('gdrive-select');
  if (gdriveSelect) {
    gdriveSelect.addEventListener('change', (e) => {
      if (e.target.value) {
        loadDrivePDF(e.target.value);
      }
    });
  }

  // 3. 本地上傳 PDF 監聽
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

  // 4. 背景音樂播放控制
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
