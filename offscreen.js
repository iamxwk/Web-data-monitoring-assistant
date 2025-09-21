// offscreen.js

// 监听来自 background.js 的消息
chrome.runtime.onMessage.addListener(handleMessages);

function handleMessages(request, sender, sendResponse) {
  if (request.action === 'executeCodeInSandbox') {
    // 使用 Promise 来处理异步的 postMessage 通信
    executeInSandbox(request)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));

    // 返回 true 表示我们将异步地发送响应
    return true;
  }
}

// 在沙箱 iframe 中执行代码
function executeInSandbox(request) {
  return new Promise((resolve, reject) => {
    const sandboxIframe = document.createElement('iframe');
    sandboxIframe.src = 'code-executor.html';
    sandboxIframe.style.display = 'none';
    document.body.appendChild(sandboxIframe);

    // 等待 iframe 加载完成
    sandboxIframe.onload = () => {
      // 通过 postMessage 向沙箱发送代码
      sandboxIframe.contentWindow.postMessage(request, '*');
    };

    // 监听来自沙箱的返回结果
    window.addEventListener('message', function handler(event) {
      // 验证消息来源是否是我们的 iframe
      if (event.source !== sandboxIframe.contentWindow) {
        return;
      }

      // 清理 iframe 和监听器
      window.removeEventListener('message', handler);
      document.body.removeChild(sandboxIframe);

      // 将结果传递出去
      resolve(event.data);
    }, { once: true }); // 使用 once 选项，事件监听器在触发一次后自动移除
  });
}
