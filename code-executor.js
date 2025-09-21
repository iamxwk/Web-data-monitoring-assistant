// 监听来自background的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'executeCode') {
    try {
      // 创建一个安全的执行环境
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      document.body.appendChild(iframe);

      // 在 iframe 中创建函数执行环境
      const iframeWindow = iframe.contentWindow;
      const iframeDocument = iframe.contentDocument;

      // 在 iframe 中直接定义函数
      iframeWindow.executeUserCode = function(paramName, paramValue, code) {
        try {
          // 创建函数体
          const functionBody = "try { " + code + " } catch(e) { return { error: e.message }; }";
          const handlerFunction = new Function(paramName, functionBody);
          const result = handlerFunction(paramValue);
          return { success: true, result: result };
        } catch (e) {
          return { success: false, error: e.message };
        }
      };

      // 执行代码
      const result = iframeWindow.executeUserCode(request.paramName, request.paramValue, request.code);

      // 清理 iframe
      document.body.removeChild(iframe);

      // 返回执行结果
      sendResponse(result);
    } catch (error) {
      sendResponse({
        success: false,
        error: error.message
      });
    }
    // 保持消息通道开放
    return true;
  }
});