// 設定 PDF.js Worker 資源路徑
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// 您已部署好的 Google Apps Script Web App 網址
const GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycby-jnWDKo6ctErnZgjvLS32eN8v_MsRmTwT5XxTjEPD-jRYHPodVigOoE2XSaJjGG6LEg/exec";

let currentPageFlip = null;
let currentBlobUrls = []; // 用於記錄產生的 Blob URL，以便釋放記憶體

/**
 * 載入並渲染 PDF 電子書
 * @param {string|Uint8Array} pdfSource - PDF 檔案網址或 Uint8Array 資料
 */
async function loadPDF(pdfSource) {
  const flipbookContainer = document.getElementById('flipbook');
  const loadingTip = document.getElementById('loading-tip');
  
  if (loadingTip) {
    loadingTip.style.display = 'block';
    loadingTip.textContent = '⚡ 電子書準備中...';
  }

  // 1. 銷毀舊的 PageFlip 實例與釋放舊 Blob URL
  if (currentPageFlip) {
    try {
      currentPageFlip.destroy();
    } catch (e) {
      console.warn("銷毀舊 PageFlip 實例:", e);
    }
    currentPageFlip = null;
  }
  
  // 釋放記憶體中的舊圖片網址
  currentBlobUrls.forEach(url => URL.revokeObjectURL(url));
  currentBlobUrls = [];

  if (flipbookContainer) {
    flipbookContainer.innerHTML = '';
  }

  try {
    // 2. 讀取 PDF 文件
    const loadingTask = pdfjsLib.getDocument(pdfSource);
    const pdf = await loadingTask.promise;

    // 3. 初始化 PageFlip（標準 A4 比例 530 x 750）
    const pageFlip = new St.PageFlip(flipbookContainer, {
      width: 530,          // 單頁寬度
      height: 750,         // 單頁高度 (符合 A4 比例)
      size: "stretch",
      minWidth: 300,
      maxWidth: 800,
      minHeight: 424,
      maxHeight: 1131,
      maxShadowOpacity: 0.5,
      showCover: true,     // 顯示封面
      mobileScrollSupport: false
    });

    currentPageFlip = pageFlip;
    const pageElements = [];

    // 4. 逐頁渲染畫面
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      if (loadingTip) {
        loadingTip.textContent = `📄 轉換頁面 (${pageNum}/${pdf.numPages})...`;
      }

      const page = await pdf.getPage(pageNum);
      // scale: 1.3 兼顧高清晰度與渲染速度
      const viewport = page.getViewport({ scale: 1.3 });

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      await page.render({ canvasContext: context, viewport: viewport }).promise;

      // 使用 Blob URL 替代 Base64，提升 3~5 倍渲染速度並防卡頓
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

      // 釋放 UI 執行緒，確保瀏覽器不凍結
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    // 5. 載入所有頁面至電子書
    pageFlip.loadFromHTML(pageElements);
  } catch (err) {
    console.error("PDF 載入失敗:", err);
    alert("PDF 載入失敗，請確認檔案格式或 Google Drive 存取權限。");
  } finally {
    if (loadingTip) {
      loadingTip.style.display = 'none';
    }
  }
}

/**
 * 自動抓取 Google Drive 資料夾內的 PDF 列表
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
      opt.value = pdf.url;
      opt.textContent = pdf.name;
      gdriveSelect.appendChild(opt);
    });
  } catch (err) {
    console.error("讀取 Google Drive 列表失敗:", err);
    gdriveSelect.innerHTML = '<option value="">雲端書單讀取失敗</option>';
  }
}

// 頁面元素載入完成後初始化事件
document.addEventListener('DOMContentLoaded', () => {
  // 1. 自動抓取 Google Drive PDF 列表
  fetchDrivePDFList();

  // 2. 切換 Google Drive 電子書選單
  const gdriveSelect = document.getElementById('gdrive-select');
  if (gdriveSelect) {
    gdriveSelect.addEventListener('change', (e) => {
      if (e.target.value) {
        loadPDF(e.target.value);
      }
    });
  }

  // 3. 本地 PDF 檔案上傳監聽
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

  // 4. 背景音樂控制邏輯
  const bgAudio = document.getElementById('bg-audio');
  const btnToggle = document.getElementById('btn-toggle-music');
  const musicSelect = document.getElementById('music-select');

  if (btnToggle && bgAudio) {
    btnToggle.addEventListener('click', () => {
      if (bgAudio.paused) {
        bgAudio.play().then(() => {
          btnToggle.textContent = '⏸ 暫停音樂';
        }).catch(err => {
          console.error("音樂播放失敗:", err);
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
      bgAudio.play().then(() => {
        if (btnToggle) btnToggle.textContent = '⏸ 暫停音樂';
      }).catch(err => {
        console.error("切換音樂失敗:", err);
      });
    });
  }
});
