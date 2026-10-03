pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let currentPageFlip = null;

async function loadPDF(pdfData) {
  const flipbookContainer = document.getElementById('flipbook');
  const loadingTip = document.getElementById('loading-tip');
  
  loadingTip.style.display = 'block';
  flipbookContainer.innerHTML = '';

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

    // 1. 抓取第一頁的原始尺寸 (若為 A4，預設點數比例約為 595 x 842)
    const firstPage = await pdf.getPage(1);
    const originalViewport = firstPage.getViewport({ scale: 1.0 });
    
    // 計算比例，預設基底寬度設為 595 (標準 A4 點數寬度)
    const baseWidth = 595;
    const baseHeight = Math.round(baseWidth * (originalViewport.height / originalViewport.width));

    // 2. 初始化 PageFlip（設定為原始 PDF / A4 比例）
    const pageFlip = new St.PageFlip(flipbookContainer, {
      width: baseWidth,    // A4 寬度
      height: baseHeight,  // A4 高度
      size: "stretch",     // 自動縮放符合螢幕
      minWidth: 300,
      maxWidth: 900,
      minHeight: 424,
      maxHeight: 1273,
      maxShadowOpacity: 0.5,
      showCover: true,
      mobileScrollSupport: false
    });

    currentPageFlip = pageFlip;
    const pageElements = [];

    // 3. 逐頁渲染畫面
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      
      // 使用 scale: 2.0 保持 A4 高解析度清晰度
      const viewport = page.getViewport({ scale: 2.0 });

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      await page.render({ canvasContext: context, viewport: viewport }).promise;

      const img = document.createElement('img');
      img.src = canvas.toDataURL('image/jpeg', 0.9);
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
