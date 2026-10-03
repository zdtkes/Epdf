async function fetchLargePdfAsArrayBuffer(gasAppUrl, fileId, onProgress) {
  // Step 1: 詢問檔案總大小
  const metaRes = await fetch(`${gasAppUrl}?id=${fileId}&action=meta`);
  const meta = await metaRes.json();
  if (meta.error) throw new Error(meta.error);

  const totalSize = meta.size;
  const chunkSize = 5 * 1024 * 1024; // 每次抓 5MB
  const finalBuffer = new Uint8Array(totalSize);
  let loadedBytes = 0;

  // Step 2: 分段下載並合併
  while (loadedBytes < totalSize) {
    const chunkRes = await fetch(
      `${gasAppUrl}?id=${fileId}&action=chunk&start=${loadedBytes}&length=${chunkSize}`
    );
    const chunkJson = await chunkRes.json();
    if (chunkJson.error) throw new Error(chunkJson.error);

    // 將 Base64 解碼為 Uint8Array
    const binaryStr = atob(chunkJson.data);
    const chunkBytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      chunkBytes[i] = binaryStr.charCodeAt(i);
    }

    // 填入最終的 Buffer 位置
    finalBuffer.set(chunkBytes, loadedBytes);
    loadedBytes += chunkBytes.length;

    // 進度通知（可連結進度條 UI）
    if (onProgress) {
      onProgress((loadedBytes / totalSize) * 100);
    }
  }

  return finalBuffer.buffer;
}

// === 呼叫範例（整合 Flipbook / PDF.js） ===
const GAS_URL = "https://script.google.com/macros/s/你的網址/exec";
const FILE_ID = "你的GoogleDrive檔案ID";

fetchLargePdfAsArrayBuffer(GAS_URL, FILE_ID, (percent) => {
  console.log(`PDF 下載進度：${percent.toFixed(1)}%`);
}).then((arrayBuffer) => {
  // 將 arrayBuffer 丟給 PDF.js 或 Flipbook 初始化
  // 範例 (DearFlip / PDF.js)：
  // option.pdf = arrayBuffer;
  // $('#flipbook').flipBook(arrayBuffer, option);
}).catch(err => console.error("下載 PDF 失敗:", err));
