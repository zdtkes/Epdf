// 設定 PDF.js Worker 資源路徑
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let ytPlayer;
let isPlaying = false;

// 1. 初始化 YouTube 播放器
function onYouTubeIframeAPIReady() {
  ytPlayer = new YT.Player('youtube-player', {
    height: '0',
    width: '0',
    videoId: 'DWcjZJyZu4U', // 預設音樂 ID
    playerVars: {
      autoplay: 0,
      loop: 1,
      playlist: 'DWcjZJyZu4U'
    }
  });
}

// 2. 渲染 PDF 並建立翻頁效果
async function loadPDF(url) {
  const loadingTask = pdfjsLib.getDocument(url);
  const pdf = await loadingTask.promise;
  const flipbookContainer = document.getElementById('flipbook');

  // 初始化 PageFlip 實例
  const pageFlip = new St.PageFlip(flipbookContainer, {
    width: 550, // 單頁寬度
    height: 733, // 單頁高度
    size: "stretch",
    minWidth: 315,
    maxWidth: 1000,
    minHeight: 420,
    maxHeight: 1350,
    maxShadowOpacity: 0.5,
    showCover: true,
    mobileScrollSupport: false
  });

  const pageElements = [];

  // 將 PDF 每頁渲染為 Image 元素
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 2.0 }); // 提升清晰度

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    await page.render({ canvasContext: context, viewport: viewport }).promise;

    const img = document.createElement('img');
    img.src = canvas.toDataURL('image/jpeg', 0.85);
    img.className = 'page-img';
    
    const pageDiv = document.createElement('div');
    pageDiv.className = 'my-page';
    pageDiv.appendChild(img);
    
    pageElements.push(pageDiv);
  }

  // 將頁面加載至翻頁套件中
  pageFlip.loadFromHTML(pageElements);
}

// 3. 事件監聽 (音樂播放控管)
document.addEventListener('DOMContentLoaded', () => {
  loadPDF('./pdf/book.pdf'); // 載入你上傳的 PDF 檔案

  const btnToggle = document.getElementById('btn-toggle-music');
  const musicSelect = document.getElementById('music-select');

  btnToggle.addEventListener('click', () => {
    if (!ytPlayer) return;
    if (isPlaying) {
      ytPlayer.pauseVideo();
      btnToggle.textContent = '▶ 播放音樂';
    } else {
      ytPlayer.playVideo();
      btnToggle.textContent = '⏸ 暫停音樂';
    }
    isPlaying = !isPlaying;
  });

  musicSelect.addEventListener('change', (e) => {
    const newVideoId = e.target.value;
    if (ytPlayer) {
      ytPlayer.loadVideoById(newVideoId);
      isPlaying = true;
      btnToggle.textContent = '⏸ 暫停音樂';
    }
  });
});
