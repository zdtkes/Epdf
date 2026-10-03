pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let currentPageFlip = null;

// 渲染 PDF 函數（支援路徑或 ArrayBuffer）
async function loadPDF(pdfData) {
  const flipbookContainer = document.getElementById('flipbook');
  const loadingTip = document.getElementById('loading-tip');
  
  loadingTip.style.display = 'block';
  flipbookContainer.innerHTML = ''; // 清空上一本電子書的內容

  // 如果已有舊的翻頁實例，進行銷毀
  if (currentPageFlip) {
    try {
      currentPageFlip.destroy();
    } catch (e) {
      console.log('銷毀舊實例', e);
    }
    currentPageFlip = null;
  }

  try {
    const loadingTask = pdfjsLib.getDocument(pdfData);
    const pdf = await loadingTask.promise;

    // 建立 PageFlip 實例
    const pageFlip = new St.PageFlip(flipbookContainer, {
      width: 550,
      height: 733,
      size: "stretch",
      minWidth: 315,
      maxWidth: 1000,
      minHeight: 420,
      maxHeight: 1350,
      maxShadowOpacity: 0.5,
      showCover: true,
      mobileScrollSupport: false
    });

    currentPageFlip = pageFlip;
    const pageElements = [];

    // 逐頁渲染 PDF 為圖片
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.8 }); // 調整解析度與效能平衡

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
    }

    pageFlip.loadFromHTML(pageElements);
  } catch (err) {
    alert("PDF 載入失敗，請確認檔案格式是否正確。");
    console.error(err);
  } finally {
    loadingTip.style.display = 'none';
  }
}

// 事件監聽與初始化
document.addEventListener('DOMContentLoaded', () => {
  // 1. 預設載入伺服器上的 PDF（若無可留空）
  loadPDF('./pdf/book.pdf');

  // 2. 監聽使用者選擇本地 PDF 檔案
  const pdfInput = document.getElementById('pdf-upload');
  const fileNameDisplay = document.getElementById('file-name');

  pdfInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file && file.type === 'application/pdf') {
      fileNameDisplay.textContent = `目前檔案：${file.name}`;
      
      const fileReader = new FileReader();
      fileReader.onload = function () {
        const typedarray = new Uint8Array(this.result);
        loadPDF(typedarray); // 傳入讀取後的二進位資料渲染電子書
      };
      fileReader.readAsArrayBuffer(file);
    } else {
      alert("請選擇有效的 PDF 檔案！");
    }
  });

  // 3. 背景音樂播放邏輯
  const bgAudio = document.getElementById('bg-audio');
  const btnToggle = document.getElementById('btn-toggle-music');
  const musicSelect = document.getElementById('music-select');

  btnToggle.addEventListener('click', () => {
    if (bgAudio.paused) {
      bgAudio.play();
      btnToggle.textContent = '⏸ 暫停音樂';
    } else {
      bgAudio.pause();
      btnToggle.textContent = '▶ 播放音樂';
    }
  });

  musicSelect.addEventListener('change', (e) => {
    bgAudio.src = e.target.value;
    bgAudio.play();
    btnToggle.textContent = '⏸ 暫停音樂';
  });
});
