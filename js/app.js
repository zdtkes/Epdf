pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let currentPageFlip = null;

// 渲染 PDF 函數（標準 A4 比例）
async function loadPDF(pdfData) {
  const flipbookContainer = document.getElementById('flipbook');
  const loadingTip = document.getElementById('loading-tip');
  
  if (loadingTip) {
    loadingTip.style.display = 'block';
    loadingTip.textContent = '📄 PDF 處理中，請稍候...';
  }

  // 1. 清除舊實例與容器內容
  if (currentPageFlip) {
    try {
      currentPageFlip.destroy();
    } catch (e) {
      console.warn('銷毀舊實例:', e);
    }
    currentPageFlip = null;
  }
  flipbookContainer.innerHTML = '';

  try {
    const loadingTask = pdfjsLib.getDocument(pdfData);
    const pdf = await loadingTask.promise;

    // 2. 初始化 PageFlip（標準 A4 寬高比 550 x 778）
    const pageFlip = new St.PageFlip(flipbookContainer, {
      width: 550,          // A4 頁面寬度
      height: 778,         // A4 頁面高度 (550 * 1.414)
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

    // 3. 逐頁渲染 PDF 畫面
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      if (loadingTip) {
        loadingTip.textContent = `📄 正在轉換頁面 (${pageNum}/${pdf.numPages})...`;
      }

      const page = await pdf.getPage(pageNum);
      // scale: 1.5 可維持 A4 清晰度並避免記憶體溢出
      const viewport = page.getViewport({ scale: 1.5 });

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      await page.render({ canvasContext: context, viewport: viewport }).promise;

      const img = document.createElement('img');
      img.src = canvas.toDataURL('image/jpeg', 0.85);
      img.style.width = '100%';
      img.style.height = '100%';
      
      const pageDiv = document.createElement('div');
      pageDiv.className = 'my-page';
      pageDiv.appendChild(img);
      
      pageElements.push(pageDiv);

      // 釋放 UI 執行緒，防止瀏覽器畫面凍結
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    pageFlip.loadFromHTML(pageElements);
  } catch (err) {
    console.error("PDF 載入失敗:", err);
    if (typeof pdfData === 'string') {
      // 預設檔案不存在時不跳出彈窗，改為靜態提示
      if (loadingTip) {
        loadingTip.style.display = 'block';
        loadingTip.textContent = '💡 請點擊左上方「📁 上傳 PDF 電子書」選擇檔案';
      }
      return;
    }
    alert("PDF 載入失敗，請確認檔案是否損壞。");
  } finally {
    if (currentPageFlip && loadingTip) {
      loadingTip.style.display = 'none';
    }
  }
}

// 初始化與事件監聽
document.addEventListener('DOMContentLoaded', () => {
  // 嘗試載入預設 PDF，若不存在會自動顯示上傳提示
  loadPDF('./pdf/book.pdf');

  // 上傳 PDF 檔案監聽
  const pdfInput = document.getElementById('pdf-upload');
  const fileNameDisplay = document.getElementById('file-name');

  if (pdfInput) {
    pdfInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file && file.type === 'application/pdf') {
        if (fileNameDisplay) fileNameDisplay.textContent = `目前檔案：${file.name}`;
        
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
        bgAudio.play();
        btnToggle.textContent = '⏸ 暫停音樂';
      } else {
        bgAudio.pause();
        btnToggle.textContent = '▶ 播放音樂';
      }
    });
  }

  if (musicSelect && bgAudio) {
    musicSelect.addEventListener('change', (e) => {
      bgAudio.src = e.target.value;
      bgAudio.play();
      if (btnToggle) btnToggle.textContent = '⏸ 暫停音樂';
    });
  }
});
