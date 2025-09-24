const OFFSCREEN_DOCUMENT_PATH = '/offscreen.html';

// 全局任务队列和状态
let taskQueue = []; // [{taskId, sendResponse}, ...]
let isProcessing = false;

// 帮助函数，用于创建和检查 Offscreen Document
async function setupOffscreenDocument() {
  if (await chrome.offscreen.hasDocument()) {
    return;
  }
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: [chrome.offscreen.Reason.DOM_PARSER],
    justification: 'To execute user code in a secure sandbox environment.',
  });
}

// 封装的执行用户代码的核心函数（已改为 Promise）
function executeUserCode(codePayload) {
  return new Promise((resolve, reject) => {
    setupOffscreenDocument().then(() => {
      chrome.runtime.sendMessage(codePayload, (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error('代码执行失败: ' + chrome.runtime.lastError.message));
          return;
        }
        if (result.success) {
          resolve(result.result);
        } else {
          reject(new Error('处理代码执行错误: ' + result.error));
        }
      });
    }).catch(reject);
  });
}

// 任务队列处理器：一次只处理一个任务
async function processTaskQueue() {
  if (isProcessing || taskQueue.length === 0) {
    return;
  }
  isProcessing = true;
  const taskJob = taskQueue.shift(); // 从队列头部取出一个任务

  try {
    await checkTask(taskJob.taskId, taskJob.sendResponse); // 调用任务检查函数
  } catch (error) {
    console.error(`处理任务 ${taskJob.taskId} 时发生错误: `, error);
    if (taskJob.sendResponse) {
      taskJob.sendResponse({ success: false, error: error.message });
    }
  } finally {
    isProcessing = false;
    // 处理完一个任务后，继续处理队列中的下一个
    if (taskQueue.length > 0) {
      processTaskQueue();
    }
  }
}

// 将任务添加到队列中
function addTaskToQueue(taskId, sendResponse) {
  if (!taskQueue.some(job => job.taskId === taskId)) {
    taskQueue.push({ taskId, sendResponse });
    processTaskQueue();
  }
}

async function setupAllTaskAlarm(){
  chrome.alarms.clearAll();
  const result = await chrome.storage.local.get('tasks');
  const tasks = result.tasks || [];
  if (tasks.length === 0) {
    await chrome.storage.local.set({tasks: []});
  } else {
    tasks.forEach(task => {
      setupTaskAlarm(task);
    });
  }
}

// 事件监听器
chrome.runtime.onInstalled.addListener(() => {
  setupAllTaskAlarm();
  updateBadgeText();
});

// 当浏览器启动时检查过期任务
chrome.runtime.onStartup.addListener(() => {
  console.log("Extension started, checking for overdue tasks...");
  checkOverdueTasks();
});

// 监听alarm触发，将任务添加到队列
chrome.alarms.onAlarm.addListener((alarm) => {
  if(alarm.name.startsWith('task_')){
    const taskId = alarm.name.split('task_')[1];
    addTaskToQueue(taskId, null);
  }
});

// 监听电脑状态变化，如果从休眠中恢复，则检查过期任务
chrome.idle.onStateChanged.addListener((newState) => {
  console.log(new Date().toLocaleString() + ' 电脑状态变化为:', newState);
  if(newState === 'active'){
    console.log(new Date().toLocaleString() + ' 电脑已从休眠中恢复，检查过期任务。');
    checkOverdueTasks();
  }
});

// 【修复】将通知点击监听器移动到顶层
chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId.startsWith('task_')) {
    chrome.action.openPopup();
    // 用户点击后，可以选择清除该通知
    chrome.notifications.clear(notificationId);
  }
});


// 监听来自popup和task-editor的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 【修复】为测试功能增加后台繁忙检查
  if (['testRequest', 'testHandler'].includes(request.action)) {
    if (isProcessing) {
      sendResponse({ success: false, error: '后台任务正在运行，请稍后再试。' });
      return; // 同步返回，不需要 return true
    }
  }

  switch(request.action){
    case 'checkTask':
      if(request.taskId){
        addTaskToQueue(request.taskId, sendResponse);
        return true; // 异步响应
      }
      break;
    case 'setupAlarm':
      if(request.task){
        setupTaskAlarm(request.task);
        sendResponse({success: true});
      }
      break;
    case 'setupAllAlarm':
      setupAllTaskAlarm().then(() => sendResponse({success: true}));
      return true; // 异步
      break;
    case 'removeAlarm':
      if(request.taskId){
        chrome.alarms.clear(`task_${request.taskId}`);
        sendResponse({success: true});
      }
      break;
    case 'removeAllAlarm':
      chrome.alarms.clearAll();
      sendResponse({success: true});
      break;
    case 'testRequest':
      testRequest(request.requestConfig, sendResponse);
      return true;
      break;
    case 'testHandler':
      testHandler(request.currentTask, request.requestConfig, request.handlerCode, sendResponse);
      return true;
      break;
    case 'ajaxRequest':
      handleAjaxRequest(request, sender, sendResponse);
      return true;
      break;
    case 'updateBadge':
      updateBadgeText();
      sendResponse({success: true});
      break;
    case 'languageChanged':
      updateBadgeText();
      sendResponse({success: true});
      break;
  }
});

// 设置定时任务
function setupTaskAlarm(task){
  const intervalInMinutes = task.frequency.unit === 'hour'
    ? task.frequency.value * 60
    : task.frequency.value;
  chrome.alarms.create(`task_${task.id}`, {
    periodInMinutes: intervalInMinutes
  });
}

// 检查任务的API变化
async function checkTask(taskId, sendResponse = null) {
  let taskTitle = `Task ID: ${taskId}`;
  try {
    const tasksResult = await chrome.storage.local.get('tasks');
    const tasks = tasksResult.tasks || [];
    const taskIndex = tasks.findIndex(t => t.id === taskId);

    if (taskIndex === -1) {
      if (sendResponse) sendResponse({ success: false, error: '任务不存在' });
      return;
    }

    const task = tasks[taskIndex];
    taskTitle = task.title; // 获取任务标题用于日志

    if (task.enabled === false) {
      if (sendResponse) sendResponse({ success: true, message: '任务已禁用' });
      return;
    }

    console.log(`${new Date().toLocaleString()} ${taskTitle} 开始检查`);

    const processedValue = await executeTaskRequest(task);

    const latestTasksResult = await chrome.storage.local.get('tasks');
    const latestTasks = latestTasksResult.tasks || [];
    const latestTaskIndex = latestTasks.findIndex(t => t.id === taskId);

    if (latestTaskIndex === -1) {
      console.log(`任务 ${taskTitle} 在处理期间被删除，跳过保存。`);
      if (sendResponse) sendResponse({ success: true, message: '任务已被删除' });
      return;
    }

    latestTasks[latestTaskIndex].currentValue = processedValue;
    latestTasks[latestTaskIndex].lastChecked = new Date().toISOString();

    if (processedValue && processedValue.notify === true && task.popupNotification) {
      showNotification(task);
      latestTasks[latestTaskIndex].hasChanges = true;
    } else {
      latestTasks[latestTaskIndex].hasChanges = false;
    }

    await chrome.storage.local.set({ tasks: latestTasks });
    if (sendResponse) sendResponse({ success: true });
    updateBadgeText();

    console.log(`${new Date().toLocaleString()} ${taskTitle} 结束检查`);

  } catch (error) {
    const errorMessage = error.name === 'AbortError'
      ? `请求超时`
      : error.message;

    console.error(`${new Date().toLocaleString()} ${taskTitle} 任务检查失败:`, errorMessage);
    if (sendResponse) sendResponse({ success: false, error: errorMessage });
  }
}

// 带有重试机制的 fetch 请求
async function fetchWithRetry(resource, options = {}){
  const {retries = 3, ...fetchOptions} = options;
  for(let i = 0; i < retries; i++){
    try{
      const response = await fetch(resource, fetchOptions);
      if(response.ok){
        return response;
      }
      throw new Error(`请求失败，状态码: ${response.status}`);
    }catch(error){
      console.warn(`第 ${i + 1} 次尝试失败：`, error.message);
      if(i < retries - 1){
        const delay = Math.pow(2, i) * 1000;
        console.log(`等待 ${delay / 1000} 秒后进行第 ${i + 2} 次重试...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }else{
        console.error('达到最大重试次数，请求最终失败。');
        throw error;
      }
    }
  }
}

// 执行任务请求
async function executeTaskRequest(task) {
  const requestConfig = task.requestBody;
  const fetchOptions = {
    method: requestConfig.type || 'get',
    headers: requestConfig.headers || {},
    timeout: requestConfig.timeout || 7000
  };
  if (['post', 'put', 'patch'].includes(fetchOptions.method.toLowerCase()) && requestConfig.data) {
    fetchOptions.body = typeof requestConfig.data === 'object'
      ? JSON.stringify(requestConfig.data)
      : requestConfig.data;
    if (!fetchOptions.headers['Content-Type'] && !fetchOptions.headers['content-type']) {
      fetchOptions.headers['Content-Type'] = 'application/json';
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), fetchOptions.timeout);

  try {
    const response = await fetchWithRetry(requestConfig.url, {
      ...fetchOptions,
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    const responseData = requestConfig.dataType === 'json' ? await response.json() : await response.text();
    console.log(new Date().toLocaleString() + ' ' + task.title + " fetch 返回:", responseData);

    const taskData = {
      prevContent: task.currentValue ? task.currentValue.content : undefined,
      prevExtra: task.currentValue ? task.currentValue.extra : undefined,
      content: responseData
    };
    const payload = {
      action: 'executeCodeInSandbox',
      paramName: 'taskData',
      paramValue: taskData,
      code: task.responseHandler
    };
    return await executeUserCode(payload);
  } catch (error) {
    clearTimeout(timeoutId);
    console.error(new Date().toLocaleString() + ' ' + task.title + ' 任务执行失败:', error);
    throw error;
  }
}

// 测试请求
function testRequest(requestConfig, sendResponse){
  try{
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
        if(requestConfig.dataType === 'json'){
          return response.json();
        }else if(requestConfig.dataType === 'text'){
          return response.text();
        }else if(requestConfig.dataType === 'blob'){
          return response.blob();
        }
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
function testHandler(currentTask, requestConfig, handlerCode, sendResponse){
  try{
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
        const taskData = {
          prevContent: currentTask && currentTask.currentValue ? currentTask.currentValue.content : undefined,
          prevExtra: currentTask && currentTask.currentValue ? currentTask.currentValue.extra : undefined,
          content: response
        }
        const payload = {
          action: 'executeCodeInSandbox',
          paramName: 'taskData',
          paramValue: taskData,
          code: handlerCode
        };
        executeUserCode(payload).then(result => {
            sendResponse({success: true, result: result});
            console.log("✅ 代码执行成功! 最终结果:", result);
        }).catch(error => {
            sendResponse({success: false, error: `处理代码执行错误: ${error.message}`});
            console.error("❌ 代码执行失败! 错误信息:", error.message);
        });
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
    iconUrl: task.iconUrl || 'icon/icon.png',
    title: '数据变化提醒',
    message: `任务 "${task.title}" 检测到数据变化`,
    priority: 2
  });
}

// 检查过期任务
async function checkOverdueTasks(){
  const result = await chrome.storage.local.get('tasks');
  const tasks = result.tasks || [];
  for(const task of tasks){
    if(task.enabled === false){ continue; }
    if(!task.lastChecked){
      console.log(`Task ${task.title} has never been checked, adding to queue...`);
      addTaskToQueue(task.id, null);
      continue;
    }
    const lastCheckedTime = new Date(task.lastChecked).getTime();
    const intervalInMinutes = task.frequency.unit === 'hour'
      ? task.frequency.value * 60
      : task.frequency.value;
    const intervalInMs = intervalInMinutes * 60 * 1000;
    const expectedNextCheckTime = lastCheckedTime + intervalInMs;
    if(Date.now() >= expectedNextCheckTime){
      console.log(`Task ${task.title} is overdue, adding to queue...`);
      addTaskToQueue(task.id, null);
    }
  }
}

// 更新浏览器图标徽章
function updateBadgeText(){
  chrome.storage.local.get(['tasks', 'settings'], (result) => {
    const tasks = result.tasks || [];
    const settings = result.settings || {};
    const changedTasksCount = tasks.filter(task => task.hasChanges && task.enabled !== false).length;
    if(changedTasksCount > 0){
      chrome.action.setBadgeText({text: changedTasksCount.toString()});
      chrome.action.setBadgeBackgroundColor({color: '#FF0000'});
    }else{
      chrome.action.setBadgeText({text: ''});
    }
    let badgeTitle = 'Web data monitoring assistant';
    if(settings.language){
      switch(settings.language){
        case 'zh_CN':
          badgeTitle = '网页数据监控助手';
          break;
        case 'zh_TW':
          badgeTitle = '網頁數據監控助手';
          break;
        case 'en':
        default:
          badgeTitle = 'Web data monitoring assistant';
      }
    }
    chrome.action.setTitle({title: badgeTitle});
  });
}
