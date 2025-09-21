const OFFSCREEN_DOCUMENT_PATH = '/offscreen.html';

// 帮助函数，用于创建和检查 Offscreen Document
async function setupOffscreenDocument() {
  // 检查是否已有 Offscreen Document
  if (await chrome.offscreen.hasDocument()) {
    console.log("Offscreen document already exists.");
    return;
  }

  console.log("Creating offscreen document...");
  // 创建 Offscreen Document
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: [chrome.offscreen.Reason.DOM_PARSER],
    justification: 'To execute user code in a secure sandbox environment.',
  });
}

// 封装的执行用户代码的核心函数
function executeUserCode(codePayload, sendResponse) {
  // 1. 确保 Offscreen Document 存在
  setupOffscreenDocument().then(() => {
    // 2. 向 Offscreen Document 发送消息来执行代码
    chrome.runtime.sendMessage(codePayload, (result) => {
      // 检查 chrome.runtime.lastError，这是处理异步响应的重要步骤
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: '代码执行失败: ' + chrome.runtime.lastError.message });
        return;
      }

      // 3. 将从 offscreen document 收到的结果通过 sendResponse 回传
      sendResponse(result);
    });
  });
}

// 当扩展安装或更新时
chrome.runtime.onInstalled.addListener(() => {
  // 初始化存储
  chrome.storage.sync.get('tasks', (result) => {
    if(!result.tasks){
      chrome.storage.sync.set({tasks: []});
    }else{
      // 为已存在的任务设置alarm
      result.tasks.forEach(task => {
        setupTaskAlarm(task);
      });
    }
  });
});

// 监听alarm触发
chrome.alarms.onAlarm.addListener((alarm) => {
  if(alarm.name.startsWith('task_')){
    const taskId = alarm.name.split('task_')[1];
    checkTask(taskId);
  }
});

// 监听来自popup和task-editor的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch(request.action){
    case 'checkTask':
      if(request.taskId){
        checkTask(request.taskId, sendResponse);
        return true; // 保持消息通道开放
      }
      break;

    case 'setupAlarm':
      if(request.task){
        setupTaskAlarm(request.task);
        sendResponse({success: true});
      }
      break;

    case 'removeAlarm':
      if(request.taskId){
        chrome.alarms.clear(`task_${request.taskId}`);
        sendResponse({success: true});
      }
      break;

    case 'testRequest':
      testRequest(request.requestConfig, sendResponse);
      return true;
      break;

    case 'testHandler':
      testHandler(request.requestConfig, request.handlerCode, sendResponse);
      return true;
      break;
  }
});

// 设置定时任务
function setupTaskAlarm(task){
  // 计算间隔时间（分钟）
  const intervalInMinutes = task.frequency.unit === 'hour'
    ? task.frequency.value * 60
    : task.frequency.value;

  // 创建或更新alarm
  chrome.alarms.create(`task_${task.id}`, {
    periodInMinutes: intervalInMinutes
  });
}

// 检查任务的API变化
function checkTask(taskId, sendResponse = null){
  chrome.storage.sync.get('tasks', (result) => {
    const tasks = result.tasks || [];
    const taskIndex = tasks.findIndex(t => t.id === taskId);

    if(taskIndex === -1){
      if(sendResponse) sendResponse({success: false, error: '任务不存在'});
      return;
    }

    const task = tasks[taskIndex];

    // 执行请求并处理响应
    executeTaskRequest(task)
      .then(processedValue => {
        // 保存上次的值
        const lastValue = task.currentValue ? task.currentValue.content : null;
        const newValue = processedValue;

        // 检查是否有变化
        const hasChanges = !isEqual(lastValue, newValue?.content) && lastValue !== null;

        // 更新任务信息
        tasks[taskIndex] = {
          ...task,
          lastValue: task.currentValue ? {...task.currentValue} : null,
          currentValue: newValue,
          hasChanges: hasChanges || task.hasChanges,
          lastChecked: new Date().toISOString()
        };

        // 如果有变化且需要弹窗提醒，显示通知
        if(hasChanges && task.popupNotification){
          showNotification(task);
          tasks[taskIndex].hasChanges = true;
        }

        // 保存更新
        chrome.storage.sync.set({tasks}, () => {
          if(sendResponse) sendResponse({success: true});
        });
      })
      .catch(error => {
        console.error('任务检查失败:', error);
        if(sendResponse) sendResponse({success: false, error: error.message});
      });
  });
}

// 执行任务请求
function executeTaskRequest(task){
  return new Promise((resolve, reject) => {
    try{
      const requestConfig = task.requestBody;
      const fetchOptions = {
        method: requestConfig.type || 'get',
        headers: requestConfig.headers || {},
        timeout: requestConfig.timeout || 7000
      };

      if(['post', 'put', 'patch'].includes(fetchOptions.method.toLowerCase()) && requestConfig.data){
        fetchOptions.body = typeof requestConfig.data === 'object'
          ? JSON.stringify(requestConfig.data)
          : requestConfig.data;

        if(!fetchOptions.headers['Content-Type'] && !fetchOptions.headers['content-type']){
          fetchOptions.headers['Content-Type'] = 'application/json';
        }
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), fetchOptions.timeout);

      fetch(requestConfig.url, {
        ...fetchOptions,
        signal: controller.signal
      })
        .then(response => {
          clearTimeout(timeoutId);
          return requestConfig.dataType === 'json' ? response.json() : response.text();
        })
        .then(response => {
          // 创建一个隐藏的沙箱标签页来执行代码
          const payload = {
            action: 'executeCodeInSandbox',
            paramName: 'response',
            paramValue: response,
            code: task.responseHandler
          };

          // 执行代码并处理最终结果
          executeUserCode(payload, (result) => {
            if (result.success) {
              resolve(result.result);
              console.log("✅ 代码执行成功! 最终结果:", result.result);
              // 在实际应用中，你可能会用这个结果更新UI或存储它
            } else {
              reject(new Error('处理代码执行错误: ' + result.error));

              console.error("❌ 代码执行失败! 错误信息:", result.error);
            }
          });
          /*
          chrome.tabs.create({
            url: chrome.runtime.getURL('code-executor.html'),
            active: false,
            pinned: false
          }, (tab) => {
            // 等待页面加载完成
            setTimeout(() => {
              // 向沙箱页面发送消息，执行处理代码
              chrome.tabs.sendMessage(tab.id, {
                action: 'executeCode',
                paramName: 'response',
                paramValue: response,
                code: task.responseHandler
              }, (result) => {
                // 关闭沙箱标签页
                chrome.tabs.remove(tab.id);

                if(chrome.runtime.lastError){
                  reject(new Error('代码执行失败: ' + chrome.runtime.lastError.message));
                  return;
                }

                if(result.success){
                  // 验证返回格式
                  if(result.result && typeof result.result === 'object' &&
                    'content' in result.result && 'extra' in result.result){
                    resolve(result.result);
                  }else{
                    reject(new Error('返回值处理代码必须返回包含content和extra的对象'));
                  }
                }else{
                  reject(new Error('处理代码执行错误: ' + result.error));
                }
              });
            }, 1000);
          });
           */
        })
        .catch(error => {
          clearTimeout(timeoutId);
          if(error.name === 'AbortError'){
            reject(new Error(`请求超时（${fetchOptions.timeout}ms）`));
          }else{
            reject(new Error('请求失败: ' + error.message));
          }
        });
    }catch(error){
      reject(error);
    }
  });
}

// 测试请求
function testRequest(requestConfig, sendResponse){
  try{
    // 使用fetch API替代XMLHttpRequest
    const fetchOptions = {
      method: requestConfig.type || 'get',
      headers: requestConfig.headers || {},
      timeout: requestConfig.timeout || 7000
    };

    // 添加请求体（适用于POST等方法）
    if(['post', 'put', 'patch'].includes(fetchOptions.method.toLowerCase()) && requestConfig.data){
      fetchOptions.body = typeof requestConfig.data === 'object'
        ? JSON.stringify(requestConfig.data)
        : requestConfig.data;

      // 如果没有设置Content-Type，添加默认值
      if(!fetchOptions.headers['Content-Type'] && !fetchOptions.headers['content-type']){
        fetchOptions.headers['Content-Type'] = 'application/json';
      }
    }

    // 设置超时机制
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), fetchOptions.timeout);

    fetch(requestConfig.url, {
      ...fetchOptions,
      signal: controller.signal
    })
      .then(response => {
        clearTimeout(timeoutId);

        // 根据dataType处理响应
        if(requestConfig.dataType === 'json'){
          return response.json();
        }else if(requestConfig.dataType === 'text'){
          return response.text();
        }else if(requestConfig.dataType === 'blob'){
          return response.blob();
        }
        // 默认返回文本
        return response.text();
      })
      .then(result => {
        sendResponse({success: true, result: result});
      })
      .catch(error => {
        clearTimeout(timeoutId);
        if(error.name === 'AbortError'){
          sendResponse({success: false, error: `请求超时（${fetchOptions.timeout}ms）`});
        }else{
          sendResponse({success: false, error: error.message});
        }
      });
  }catch(error){
    sendResponse({success: false, error: error.message});
  }
}

// 测试处理代码
function testHandler(requestConfig, handlerCode, sendResponse){
  try{
    // 先执行请求
    const fetchOptions = {
      method: requestConfig.type || 'get',
      headers: requestConfig.headers || {},
      timeout: requestConfig.timeout || 7000
    };

    if(['post', 'put', 'patch'].includes(fetchOptions.method.toLowerCase()) && requestConfig.data){
      fetchOptions.body = typeof requestConfig.data === 'object'
        ? JSON.stringify(requestConfig.data)
        : requestConfig.data;

      if(!fetchOptions.headers['Content-Type'] && !fetchOptions.headers['content-type']){
        fetchOptions.headers['Content-Type'] = 'application/json';
      }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), fetchOptions.timeout);

    fetch(requestConfig.url, {
      ...fetchOptions,
      signal: controller.signal
    })
      .then(response => {
        clearTimeout(timeoutId);
        return requestConfig.dataType === 'json' ? response.json() : response.text();
      })
      .then(response => {
        // 创建一个隐藏的沙箱标签页来执行代码

        const payload = {
          action: 'executeCodeInSandbox',
          paramName: 'response',
          paramValue: response,
          code: handlerCode
        };

        // 执行代码并处理最终结果
        executeUserCode(payload, (result) => {
          if (result.success) {
            sendResponse({success: true, result: result.result});
            console.log("✅ 代码执行成功! 最终结果:", result.result);
            // 在实际应用中，你可能会用这个结果更新UI或存储它
          } else {
            sendResponse({success: false, error: `处理代码执行错误: ${result.error}`});

            console.error("❌ 代码执行失败! 错误信息:", result.error);
          }
        });
        /*
        chrome.tabs.create({
          url: chrome.runtime.getURL('code-executor.html'),
          active: false,
          pinned: false
        }, (tab) => {
          // 等待页面加载完成
          setTimeout(() => {
            // 向沙箱页面发送消息，执行处理代码
            chrome.tabs.sendMessage(tab.id, {
              action: 'executeCode',
              paramName: 'response',
              paramValue: response,
              code: handlerCode
            }, (result) => {
              // 关闭沙箱标签页
              chrome.tabs.remove(tab.id);

              if(chrome.runtime.lastError){
                sendResponse({success: false, error: '代码执行失败: ' + chrome.runtime.lastError.message});
                return;
              }

              if(result.success){
                // 验证返回格式
                if(result.result && typeof result.result === 'object' &&
                  'content' in result.result && 'extra' in result.result){
                  sendResponse({success: true, result: result.result});
                }else{
                  sendResponse({success: false, error: '处理代码必须返回包含content和extra的对象'});
                }
              }else{
                sendResponse({success: false, error: `处理代码执行错误: ${result.error}`});
              }
            });
          }, 1000);
        });
        */
      })
      .catch(error => {
        clearTimeout(timeoutId);
        if(error.name === 'AbortError'){
          sendResponse({success: false, error: `请求超时（${fetchOptions.timeout}ms）`});
        }else{
          sendResponse({success: false, error: error.message});
        }
      });
  }catch(error){
    sendResponse({success: false, error: error.message});
  }
}

// 显示通知
function showNotification(task){
  chrome.notifications.create(`task_${task.id}_notification`, {
    type: 'basic',
    iconUrl: 'res/icon.png',
    title: '数据变化提醒',
    message: `任务 "${task.title}" 检测到数据变化`,
    priority: 2
  });

  // 点击通知打开插件弹窗
  chrome.notifications.onClicked.addListener((notificationId) => {
    if(notificationId === `task_${task.id}_notification`){
      chrome.action.openPopup();
    }
  });
}

// 深度比较两个值是否相等
function isEqual(a, b){
  // 处理null和undefined
  if(a === null || a === undefined || b === null || b === undefined){
    return a === b;
  }

  // 如果是日期对象，比较时间戳
  if(a instanceof Date && b instanceof Date){
    return a.getTime() === b.getTime();
  }

  // 如果是对象，递归比较
  if(typeof a === 'object' && typeof b === 'object'){
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);

    if(keysA.length !== keysB.length) return false;

    for(const key of keysA){
      if(!keysB.includes(key) || !isEqual(a[key], b[key])){
        return false;
      }
    }

    return true;
  }

  // 基本类型直接比较
  return a === b;
}
