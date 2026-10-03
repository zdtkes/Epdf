// 設定 PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

let pageFlip;
let player;
let isPlaying = false;

// 1. 初始化 PageFlip
function initFlipBook() {
  const container = document.getElementById('flipbook');
  pageFlip = new St.PageFlip(container, {
    width: 400, // 單頁寬度
    height: 600, // 單頁高度
    size: 'fixed',
    minWidth: 300,
    maxWidth: 1000,
    minHeight: 400,
    maxHeight: 1200,
    showCover: true
  });

  document.getElementById('prev-btn').addEventListener('click', () => pageFlip.flipPrev());
  document.getElementById('next-btn').addEventListener('click', () => pageFlip.flipNext());
}

// 2. 將 PDF 繪製並載入 FlipBook
async function loadPDF(urlOrArrayBuffer) {
  const loadingTask = pdfjsLib.getDocument(urlOrArrayBuffer);
  const pdf = await loadingTask.promise;
  
  const pagesContainer = document.createElement('div');
  
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.5 });

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    await page.render({ canvasContext: context, viewport: viewport }).promise;

    const pageDiv = document.createElement('div');
    pageDiv.className = 'page';
    pageDiv.appendChild(canvas);
    pagesContainer.appendChild(pageDiv);
  }

  // 載入頁面至 pageFlip
  const pages = pagesContainer.querySelectorAll('.page');
  pageFlip.loadFromHTML(pages);
}

// 3. YouTube Music API 設定
function onYouTubeIframeAPIReady() {
  player = new YT.Player('youtube-player', {
    height: '0',
    width: '0',
    videoId: 'jfKfPfyJRdk', // 替換為你喜歡的 YouTube 輕音樂影片 ID (例如 Lofi Girl)
    playerVars: {
      'autoplay': 0,
      'controls': 0,
      'loop': 1,
      'playlist': 'jfKfPfyJRdk' // loop 需要指定同個 videoId
    }
  });
}

// 音樂控制開關
document.getElementById('music-btn').addEventListener('click', () => {
  if (!player || !player.playVideo) return;
  if (isPlaying) {
    player.pauseVideo();
    document.getElementById('music-btn').innerText = '🎵 播放輕音樂';
  } else {
    player.playVideo();
    document.getElementById('music-btn').innerText = '⏸️ 暫停輕音樂';
  }
  isPlaying = !isPlaying;
});

// 4. 事件監聽 (自訂上傳 PDF)
document.getElementById('pdf-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file && file.type === 'application/pdf') {
    const reader = new FileReader();
    reader.onload = function(evt) {
      loadPDF(new Uint8Array(evt.target.result));
    };
    reader.readAsArrayBuffer(file);
  }
});

// 頁面初始化
window.addEventListener('DOMContentLoaded', () => {
  initFlipBook();
  // 預設可載入同目錄下的 sample.pdf，若無上傳檔案則顯示預設檔
  loadPDF('./sample.pdf').catch(() => {
    console.log('請選擇 PDF 檔案以開啟電子書');
  });
});
