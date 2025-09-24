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
  } else if (request.action === 'ajaxRequest') {
    // 这是从 background.js 转发过来的 ajax 请求
    // 我们需要将其发送到沙箱 iframe 中
    // 注意：这个逻辑假设你有一个持久化的 iframe，
    // 但当前实现是每次都创建新的。
    // 为了实现 $.ajax，我们需要修改 executeInSandbox 的逻辑
    // 让它能处理双向通信。
    // 下面的修改将把 ajax 逻辑整合到 executeInSandbox 的消息监听器中。
    // 因此，这里不需要做任何事，因为 background 会直接调用 fetch。
    // 我们只需要确保 background 能处理这个请求。
    // 为了清晰起见，我们让 background 直接处理 ajax 请求，
    // offscreen.js 只负责沙箱代码执行的通信。
    // 因此，这个 else if 分支可以移除，我们专注于修改下面的 executeInSandbox

    return true; // 保持异步
  }
}

// 在沙箱 iframe 中执行代码
function executeInSandbox(request) {
  return new Promise((resolve, reject) => {
    const sandboxIframe = document.createElement('iframe');
    sandboxIframe.src = 'code-executor.html';
    // 为了调试，可以暂时显示 iframe
    sandboxIframe.style.display = 'none';
    document.body.appendChild(sandboxIframe);

    // 监听来自沙箱的返回结果
    window.addEventListener('message', function handler(event) {
      // 验证消息来源是否是我们的 iframe
      if (event.source !== sandboxIframe.contentWindow) {
        return;
      }
      
      const message = event.data;

      switch (message.action) {
        case 'sandboxReady':
          // 沙箱准备好了，现在可以发送代码去执行
          sandboxIframe.contentWindow.postMessage(request, '*');
          break;

        case 'makeAjaxRequest':
          // 沙箱发起了 ajax 请求，转发给 background script
          chrome.runtime.sendMessage({
            action: 'ajaxRequest', // 使用一个新的 action
            options: message.options
          }, (response) => {
            // background 处理完后，将结果发回沙箱
            if (sandboxIframe.contentWindow) {
              sandboxIframe.contentWindow.postMessage({
                action: 'ajaxResponse',
                promiseId: message.promiseId,
                ...response
              }, '*');
            }
          });
          break;

        default:
          // 默认认为是代码执行的最终结果
          // 清理 iframe 和监听器
          window.removeEventListener('message', handler);
          if (document.body.contains(sandboxIframe)) {
            document.body.removeChild(sandboxIframe);
          }
          // 将结果传递出去
          resolve(message);
          break;
      }
    });
  });
}
