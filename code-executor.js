// code-executor.js

// 用于存储 ajax 请求的 resolve/reject 函数
const ajaxPromises = new Map();
let promiseIdCounter = 0;

// 1. 获取由 code-executor.html 引入的原生 jQuery 对象
const $ = window.$;

// 2. 只覆盖我们想要拦截的 ajax 方法
//    现在 $ 仍然是一个可调用的函数，同时拥有所有其他jQuery方法
$.ajax = (options) => {
  const promiseId = promiseIdCounter++;
  const promise = new Promise((resolve, reject) => {
    ajaxPromises.set(promiseId, {resolve, reject});
  });

  // 将 ajax 请求参数发送到父窗口 (offscreen.js)
  // offscreen.js 需要将此消息转发到 background script
  window.parent.postMessage({
    action: 'makeAjaxRequest',
    options: options,
    promiseId: promiseId
  }, '*');

  return promise;
}

// 监听来自父窗口 (offscreen.js) 的消息
window.addEventListener('message', (event) => {
  // 注意：在实际产品中，你可能想验证 event.origin 来增加安全性
  const response = event.data;

  // 处理来自 background 的 ajax 响应
  if(response.action === 'ajaxResponse'){
    const promise = ajaxPromises.get(response.promiseId);
    if(promise){
      if(response.success){
        promise.resolve(response.result);
      }else{
        promise.reject(new Error(response.error));
      }
      ajaxPromises.delete(response.promiseId);
    }
  }

  // 处理执行代码的请求
  if(response.action === 'executeCodeInSandbox'){
    (async() => {
      try{
        // 将用户代码包装在一个异步函数中
        // 注入我们自定义的 $ 对象和用户传入的参数
        const AsyncFunction = Object.getPrototypeOf(async function(){
        }).constructor;
        const handlerFunction = new AsyncFunction(response.paramName, '$', response.code);

        const result = await handlerFunction(response.paramValue, $);

        // 执行成功，将结果发回
        window.parent.postMessage({success: true, result: result}, '*');

      }catch(error){
        // 执行失败，将错误信息发回
        window.parent.postMessage({success: false, error: error.message}, '*');
      }
    })();
  }
});

// 通知父窗口沙箱已准备就绪
window.parent.postMessage({action: 'sandboxReady'}, '*');
