// code-executor.js

// 监听来自 offscreen.js 的 postMessage
window.addEventListener('message', (event) => {
  // 注意：在实际产品中，你可能想验证 event.origin 来增加安全性

  const request = event.data;
  if(request.action === 'executeCodeInSandbox'){
    try{
      // 现在 new Function 不会再报错了，因为它运行在沙箱里
      const functionBody = `
      try {
        ${request.code}
      } catch(e) {
        return { __error: e.message }; 
      }
 `;
      //return (${request.code})(${request.paramName});
      // 注意：这里的 new Function 构造方式稍有不同，以适应通用性
      // (request.code) 是用户的代码字符串，我们把它包在一个函数里
      // 然后我们调用这个函数，并传入参数
      const handlerFunction = new Function(request.paramName, functionBody);
      const result = handlerFunction(request.paramValue);

      if(result && result.__error){
        throw new Error(result.__error);
      }

      // 通过 postMessage 将结果发回给 offscreen.js
      window.parent.postMessage({success: true, result: result}, '*');

    }catch(error){
      window.parent.postMessage({success: false, error: error.message}, '*');
    }
  }
});
