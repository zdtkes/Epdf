pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbycy5pkeglcKjmMye9WLE76mn6uNiBqqTJDky4Et3Pta5cKNowiwkpt6MvXPz4fEgA6oQ/exec";

let currentPageFlip = null;
let currentBlobUrls = [];

/**
 * 分段下載雲端大型 PDF (支援 > 25MB)
 */
async function loadDrivePDF(fileId) {
  const loadingTip = document.getElementById('loading-tip');
  if (loadingTip) {
    loadingTip.style.display = 'block';
    loadingTip.textContent = '☁️ 讀取雲端檔案資訊...';
  }

  try {
    // 1. 取得檔案大小資訊
    const metaRes = await fetch(`${GAS_WEB_APP_URL}?id=${fileId}&action=meta`);
    const meta = await metaRes.json();
    if (meta.status === "error") throw new Error(meta.message);

    const totalSize = meta.size;
    const chunkSize = 3 * 1024 * 1024; // 每次下載 3MB
    const finalBuffer = new Uint8Array(totalSize);
    let loadedBytes = 0;

    // 2. 分段下載並呈現進度
    while (loadedBytes < totalSize) {
      const percent = Math.round((loadedBytes / totalSize) * 100);
      if (loadingTip) loadingTip.textContent = `☁️ 下載雲端 PDF (${percent}%)...`;

      const chunkRes = await fetch(`${GAS_WEB_APP_URL}?id=${fileId}&start=${loadedBytes}&length=${chunkSize}`);
      const chunkJson = await chunkRes.json();
      if (chunkJson.status === "error") throw new Error(chunkJson.message);

      const binaryStr = window.atob(chunkJson.data);
      for (let i = 0; i < binaryStr.length; i++) {
        finalBuffer[loadedBytes + i] = binaryStr.charCodeAt(i);
      }
      loadedBytes += chunkJson.fetched;
    }

    // 下載完畢，觸發繪製
    await loadPDF(finalBuffer);

  } catch (err) {
    console.error("下載雲端 PDF 失敗:", err);
    alert("雲端 PDF 下載失敗: " + err.message);
    if (loadingTip) loadingTip.style.display = 'none';
  }
}

/**
 * 高速漸進式 (Progressive) PDF 3D 渲染
 */
async function loadPDF(pdfSource) {
  const flipbookContainer = document.getElementById('flipbook');
  const loadingTip = document.getElementById('loading-tip');
  
  if (loadingTip) {
    loadingTip.style.display = 'block';
    loadingTip.textContent = '⚡ 正在解析 PDF...';
  }

  // 1. 銷毀舊實例與釋放舊記憶體
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

    // 2. 計算尺寸
    const firstPage = await pdf.getPage(1);
    const unscaledViewport = firstPage.getViewport({ scale: 1.0 });
    const pdfAspectRatio = unscaledViewport.width / unscaledViewport.height;

    const navBarHeight = 55;
    const availHeight = Math.max(300, window.innerHeight - navBarHeight - 20);
    const availWidth = Math.max(300, window.innerWidth - 40);

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
        pageW = Math.floor((availWidth / 2));
        pageH = Math.floor(pageW / pdfAspectRatio);
      }
    }

    // 3. 建立佔位頁面 DOM 節點
    const pageElements = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const pageDiv = document.createElement('div');
      pageDiv.className = 'my-page';
      pageDiv.id = `page-node-${i}`;
      pageDiv.innerHTML = `<div class="page-loading">📄 第 ${i} 頁載入中...</div>`;
      pageElements.push(pageDiv);
    }

    // 4. 初始化 PageFlip 3D 框架 (立刻呈現書本！)
    const pageFlip = new St.PageFlip(flipbookContainer, {
      width: pageW,
      height: pageH,
      size: "fixed",
      minWidth: 200,
      maxWidth: 1200,
      minHeight: 300,
      maxHeight: 1400,
      maxShadowOpacity: 0.4,
      showCover: true,
      usePortrait: true,
      mobileScrollSupport: false,
      clickToFlip: true
    });

    currentPageFlip = pageFlip;
    pageFlip.loadFromHTML(pageElements);

    // 5. 漸進式渲染 (Prioritized Rendering)
    const renderScale = (window.devicePixelRatio && window.devicePixelRatio > 1) ? 2.0 : 1.5;

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
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
        }, 'image/jpeg', 0.85);
      });

      // 動態將渲染好的圖片放入對應的頁面節點
      const targetDiv = document.getElementById(`page-node-${pageNum}`);
      if (targetDiv) {
        targetDiv.innerHTML = '';
        const img = document.createElement('img');
        img.src = imgUrl;
        img.alt = `第 ${pageNum} 頁`;
        targetDiv.appendChild(img);
      }

      // 💡 關鍵秒開邏輯：第 1~2 頁繪製完成後，立刻關閉全域載入提示，使用者即可開始閱讀！
      if (pageNum === 2 || pageNum === pdf.numPages) {
        if (loadingTip) loadingTip.style.display = 'none';
      }

      // 釋放 UI 執行緒，確保背景繪製時翻頁不卡頓
      await new Promise(resolve => setTimeout(resolve, 10));
    }

  } catch (err) {
    console.error("PDF 渲染失敗:", err);
    alert("PDF 載入失敗，請確認檔案格式是否正確。");
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

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  loadPDF('main.pdf');
  fetchDrivePDFList();

  const gdriveSelect = document.getElementById('gdrive-select');
  if (gdriveSelect) {
    gdriveSelect.addEventListener('change', (e) => {
      if (e.target.value) {
        loadDrivePDF(e.target.value);
      }
    });
  }

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

  const bgAudio = document.getElementById('bg-audio');
  const btnToggle = document.getElementById('btn-toggle-music');
  const musicSelect = document.getElementById('music-select');

  if (btnToggle && bgAudio) {
    btnToggle.addEventListener('click', () => {
      if (bgAudio.paused) {
        bgAudio.play().then(() => {
          btnToggle.textContent = '⏸ 暫停音樂';
        }).catch(err => alert("音樂播放失敗"));
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
