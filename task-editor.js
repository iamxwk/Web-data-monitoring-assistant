document.addEventListener('DOMContentLoaded', () => {
  // 元素引用
  const taskForm = document.getElementById('taskForm');
  const taskIdInput = document.getElementById('taskId');
  const taskTitleInput = document.getElementById('taskTitle');
  const pageUrlInput = document.getElementById('pageUrl');
  const iconUrlInput = document.getElementById('iconUrl');
  const frequencyValueInput = document.getElementById('frequencyValue');
  const frequencyUnitSelect = document.getElementById('frequencyUnit');
  const popupNotificationInput = document.getElementById('popupNotification');
  const enabledInput = document.getElementById('enabled');
  const requestBodyInput = document.getElementById('requestBody');
  const responseHandlerInput = document.getElementById('responseHandler');
  const testRequestBtn = document.getElementById('testRequestBtn');
  const testHandlerBtn = document.getElementById('testHandlerBtn');
  const cancelBtn = document.getElementById('cancelBtn');
  const pageTitleElement = document.getElementById('pageTitle');

  // 测试结果模态框元素
  const testResultModal = document.getElementById('testResultModal');
  const resultTitleElement = document.getElementById('resultTitle');
  const resultContentElement = document.getElementById('resultContent');
  const closeResultModal = document.getElementById('closeResultModal');
  const closeResultBtn = document.getElementById('closeResultBtn');

  // 当前编辑的任务
  let currentTask = null;

  // 初始化
  init();

  // 初始化函数
  function init(){
    // 检查URL参数，确定是新增还是编辑任务
    const urlParams = new URLSearchParams(window.location.search);
    const taskId = urlParams.get('id');

    if(taskId){
      // 编辑现有任务
      pageTitleElement.textContent = '编辑任务';
      loadTaskForEditing(taskId);
    }else{
      // 新增任务
      pageTitleElement.textContent = '添加新任务';
      // 设置默认请求体示例
      requestBodyInput.value = `{
  "type": "get",
  "url": "https://api.example.com/data",
  "dataType": "json",
  "timeout": 7000
}`;

      // 设置默认处理代码示例
      responseHandlerInput.value = `return {
  "content": response.value,
  "extra": {
    "timestamp": new Date().toISOString(),
    "source": "API"
  }
};`;
    }

    // 事件监听
    taskForm.addEventListener('submit', saveTask);
    cancelBtn.addEventListener('click', () => window.close());
    testRequestBtn.addEventListener('click', testRequest);
    testHandlerBtn.addEventListener('click', testHandler);
    closeResultModal.addEventListener('click', () => testResultModal.style.display = 'none');
    closeResultBtn.addEventListener('click', () => testResultModal.style.display = 'none');
  }

  // 加载任务用于编辑
  function loadTaskForEditing(taskId){
    chrome.storage.sync.get('tasks', (result) => {
      const tasks = result.tasks || [];
      currentTask = tasks.find(task => task.id === taskId);

      if(currentTask){
        taskIdInput.value = currentTask.id;
        taskTitleInput.value = currentTask.title;
        pageUrlInput.value = currentTask.pageUrl;
        iconUrlInput.value = currentTask.iconUrl || '';
        frequencyValueInput.value = currentTask.frequency.value;
        frequencyUnitSelect.value = currentTask.frequency.unit;
        popupNotificationInput.checked = currentTask.popupNotification;
        enabledInput.checked = currentTask.enabled !== false; // 默认为启用
        requestBodyInput.value = typeof currentTask.requestBody === 'string'
          ? currentTask.requestBody
          : JSON.stringify(currentTask.requestBody, null, 2);
        responseHandlerInput.value = currentTask.responseHandler;
      }else{
        showError('未找到指定的任务');
        setTimeout(() => window.close(), 2000);
      }
    });
  }

  // 保存任务
  function saveTask(e){
    e.preventDefault();

    try{
      // 验证请求体是否为有效的JSON
      let requestBody;
      try{
        requestBody = JSON.parse(requestBodyInput.value);
        if(!requestBody.type || !requestBody.url){
          throw new Error('请求体必须包含type和url字段');
        }
      }catch(error){
        showError(`请求体格式错误: ${error.message}`);
        return;
      }

      // 基本验证处理代码
      if(!responseHandlerInput.value.includes('return') ||
        !responseHandlerInput.value.includes('content') ||
        !responseHandlerInput.value.includes('extra')){
        if(!confirm('处理代码似乎不完整，可能无法正常工作。是否继续保存？')){
          return;
        }
      }

      // 构建任务对象
      const taskData = {
        title: taskTitleInput.value.trim(),
        pageUrl: pageUrlInput.value.trim(),
        iconUrl: iconUrlInput.value.trim() || undefined,
        frequency: {
          value: parseInt(frequencyValueInput.value, 10),
          unit: frequencyUnitSelect.value
        },
        popupNotification: popupNotificationInput.checked,
        enabled: enabledInput.checked, // 添加启用状态
        requestBody: requestBody,
        responseHandler: responseHandlerInput.value.trim(),
        // 这些字段在新建时初始化，编辑时保留原有值
        currentValue: currentTask ? currentTask.currentValue : null,
        hasChanges: currentTask ? currentTask.hasChanges : false,
        lastChecked: currentTask ? currentTask.lastChecked : null
      };

      // 获取现有任务列表
      chrome.storage.sync.get('tasks', (result) => {
        let tasks = result.tasks || [];

        if(currentTask){
          // 更新现有任务
          taskData.id = currentTask.id;
          const taskIndex = tasks.findIndex(t => t.id === currentTask.id);
          if(taskIndex !== -1){
            tasks[taskIndex] = taskData;
          }
        }else{
          // 添加新任务
          taskData.id = generateId();
          tasks.push(taskData);
        }

        // 保存任务并设置定时
        chrome.storage.sync.set({tasks}, () => {
          // 设置定时任务
          chrome.runtime.sendMessage({
            action: 'setupAlarm',
            task: taskData
          }, () => {
            // 关闭标签页
            window.close();
          });
        });
      });

    }catch(error){
      showError(`保存失败: ${error.message}`);
    }
  }

  // 测试请求
  function testRequest(){
    try{
      // 解析请求配置
      const requestConfig = JSON.parse(requestBodyInput.value);

      // 发送测试请求
      chrome.runtime.sendMessage({
        action: 'testRequest',
        requestConfig: requestConfig
      }, (response) => {
        if(chrome.runtime.lastError){
          showTestResult(false, '请求失败: ' + chrome.runtime.lastError.message);
          return;
        }

        if(response.success){
          showTestResult(true, '请求成功', response.result);
        }else{
          showTestResult(false, response.error);
        }
      });

    }catch(error){
      showTestResult(false, `请求配置错误: ${error.message}`);
    }
  }

  // 测试处理代码
  function testHandler(){
    try{
      // 解析请求配置
      const requestConfig = JSON.parse(requestBodyInput.value);
      const handlerCode = responseHandlerInput.value;
      // 发送测试请求和处理代码
      chrome.runtime.sendMessage({
        action: 'testHandler',
        currentTask: currentTask,
        requestConfig: requestConfig,
        handlerCode: handlerCode
      }, (response) => {
        if(chrome.runtime.lastError){
          showTestResult(false, '处理测试失败: ' + chrome.runtime.lastError.message);
          return;
        }

        if(response.success){
          showTestResult(true, '处理代码执行成功', response.result);
        }else{
          showTestResult(false, response.error);
        }
      });

    }catch(error){
      showTestResult(false, `配置错误: ${error.message}`);
    }
  }

  // 显示测试结果
  function showTestResult(success, message, result = null){
    resultTitleElement.textContent = success ? '测试成功' : '测试失败';
    resultTitleElement.style.color = success ? '#2ecc71' : '#e74c3c';

    let content = message;
    if(result !== null){
      content += '\n\n' + JSON.stringify(result, null, 2);
    }

    resultContentElement.textContent = content;
    resultContentElement.className = `result-container ${success ? 'result-success' : 'result-error'}`;

    testResultModal.style.display = 'flex';
  }

  // 显示错误信息
  function showError(message){
    alert(`错误: ${message}`);
  }

  // 生成唯一ID
  function generateId(){
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  }
});
