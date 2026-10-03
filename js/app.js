pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let ytPlayer = null;
let isPlayerReady = false;
let isPlaying = false;

// 將 onYouTubeIframeAPIReady 明確掛載至全域 window 物件
window.onYouTubeIframeAPIReady = function() {
  console.log("YouTube API 初始化中...");
  ytPlayer = new YT.Player('youtube-player', {
    height: '0',
    width: '0',
    videoId: 'DWcjZJyZu4U',
    playerVars: {
      autoplay: 0,
      loop: 1,
      playlist: 'DWcjZJyZu4U',
      origin: window.location.origin
    },
    events: {
      'onReady': onPlayerReady,
      'onError': onPlayerError
    }
  });
};

function onPlayerReady(event) {
  console.log("YouTube 播放器準備就緒！");
  isPlayerReady = true;
}

function onPlayerError(event) {
  console.error("YouTube 播放器錯誤，代碼：", event.data);
  alert("音樂載入失敗（代碼 " + event.data + "），該影片可能限制第三方嵌入播放，請嘗試更換影片 ID。");
}

// PDF 載入
async function loadPDF(url) {
  try {
    const loadingTask = pdfjsLib.getDocument(url);
    const pdf = await loadingTask.promise;
    const flipbookContainer = document.getElementById('flipbook');

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

    const pageElements = [];

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: 2.0 });

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

    pageFlip.loadFromHTML(pageElements);
  } catch (err) {
    console.error("PDF 載入失敗:", err);
  }
}

// 按鈕事件處理
document.addEventListener('DOMContentLoaded', () => {
  loadPDF('./pdf/book.pdf');

  const btnToggle = document.getElementById('btn-toggle-music');
  const musicSelect = document.getElementById('music-select');

  btnToggle.addEventListener('click', () => {
    if (!ytPlayer || !isPlayerReady) {
      alert("音樂播放器還在載入中，請稍候 2 秒再試！");
      return;
    }

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
    if (ytPlayer && isPlayerReady) {
      ytPlayer.loadVideoById({
        videoId: newVideoId
      });
      isPlaying = true;
      btnToggle.textContent = '⏸ 暫停音樂';
    }
  });
});
