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
  const requestBodyInput = document.getElementById('requestBody'); // 隐藏字段
  const responseHandlerInput = document.getElementById('responseHandler');
  const testRequestBtn = document.getElementById('testRequestBtn');
  const testHandlerBtn = document.getElementById('testHandlerBtn');
  const cancelBtn = document.getElementById('cancelBtn');
  const pageTitleElement = document.getElementById('pageTitle');

  // 新增导出相关元素
  const exportBtn = document.getElementById('exportBtn');
  const exportConfigModal = document.getElementById('exportConfigModal');
  const exportConfigTextarea = document.getElementById('exportConfigTextarea');
  const closeExportModal = document.getElementById('closeExportModal');
  const closeExportBtn = document.getElementById('closeExportBtn');

  // 新增历史记录相关元素
  const historyBtn = document.getElementById('historyBtn');
  const historyModal = document.getElementById('historyModal');
  const closeHistoryModal = document.getElementById('closeHistoryModal');
  const closeHistoryBtn = document.getElementById('closeHistoryBtn');
  const historyTableBody = document.getElementById('historyTableBody');
  const maxHistoryCountInput = document.getElementById('maxHistoryCount');
  const clearHistoryBtn = document.getElementById('clearHistoryBtn');

  // 新增的请求配置元素
  const requestTypeSelect = document.getElementById('requestType');
  const requestDataTypeSelect = document.getElementById('requestDataType');
  const requestTimeoutInput = document.getElementById('requestTimeout');
  const requestUrlInput = document.getElementById('requestUrl');
  // 新增的header和body元素
  const requestHeadersInput = document.getElementById('requestHeaders');
  const requestBodyEditorInput = document.getElementById('requestBodyEditor');

  // 测试结果模态框元素
  const testResultModal = document.getElementById('testResultModal');
  const resultTitleElement = document.getElementById('resultTitle');
  const resultContentElement = document.getElementById('resultContent');
  const closeResultModal = document.getElementById('closeResultModal');
  const closeResultBtn = document.getElementById('closeResultBtn');

  var codeMirrors = [];

  // 当前编辑的任务
  let currentTask = null;

  // 初始化国际化
  i18nInit();

  // 初始化
  init();

  setTimeout(function(){
    initCodemirror();
  }, 100)

  // 初始化函数
  function init(){
    // 检查URL参数，确定是新增还是编辑任务
    const urlParams = new URLSearchParams(window.location.search);
    const taskId = urlParams.get('id');

    if(taskId){
      // 编辑现有任务
      pageTitleElement.setAttribute('data-i18n', 'edit_task');
      pageTitleElement.textContent = chrome.i18n.getMessage('edit_task');
      loadTaskForEditing(taskId);
    }else{
      // 新增任务
      historyBtn.remove();
      exportBtn.remove();

      pageTitleElement.setAttribute('data-i18n', 'add_new_task');
      pageTitleElement.textContent = chrome.i18n.getMessage('add_new_task');
      // 设置默认请求配置
      requestTypeSelect.value = 'get';
      requestDataTypeSelect.value = 'json';
      requestTimeoutInput.value = 5000;
      requestUrlInput.value = 'https://api.example.com/data';

      updateRequestBody(); // 初始化请求体

      // 设置默认处理代码示例
      responseHandlerInput.value = `return {
  "content": taskData.content,
  "notify": taskData.content != taskData.prevContent,
  "extra": {}
};`;
    }

    // 事件监听
    taskForm.addEventListener('submit', saveTask);
    cancelBtn.addEventListener('click', () => window.close());
    testRequestBtn.addEventListener('click', testRequest);
    testHandlerBtn.addEventListener('click', testHandler);
    closeResultModal.addEventListener('click', () => testResultModal.style.display = 'none');
    closeResultBtn.addEventListener('click', () => testResultModal.style.display = 'none');

    // 导出配置相关事件监听
    exportBtn.addEventListener('click', exportConfig);
    closeExportModal.addEventListener('click', () => exportConfigModal.style.display = 'none');
    closeExportBtn.addEventListener('click', () => exportConfigModal.style.display = 'none');

    // 历史记录相关事件监听
    historyBtn.addEventListener('click', showHistory);
    closeHistoryModal.addEventListener('click', () => historyModal.style.display = 'none');
    closeHistoryBtn.addEventListener('click', () => historyModal.style.display = 'none');
    clearHistoryBtn.addEventListener('click', clearHistory);

    // 监听请求配置字段的变化
    requestTypeSelect.addEventListener('change', updateRequestBody);
    requestDataTypeSelect.addEventListener('change', updateRequestBody);
    requestTimeoutInput.addEventListener('input', updateRequestBody);
    requestUrlInput.addEventListener('input', updateRequestBody);
    requestHeadersInput.addEventListener('input', updateRequestBody);
    requestBodyEditorInput.addEventListener('input', updateRequestBody);
  }

  function initCodemirror(){
    document.querySelectorAll('.code-editor').forEach(editorElement => {
      const editor = CodeMirror.fromTextArea(editorElement, {
        lineNumbers: true,
        mode: 'javascript',
        lineWrapping: true
      })
      codeMirrors.push(editor);
    })
  }

  function saveCodeMirror(){
    codeMirrors.forEach(editor => {
      editor.save();
    })
  }

  // 根据表单字段更新请求体
  function updateRequestBody(){
    const requestBody = {
      type: requestTypeSelect.value,
      url: requestUrlInput.value,
      dataType: requestDataTypeSelect.value,
      timeout: parseInt(requestTimeoutInput.value, 10)
    };

    // 添加headers（如果存在）
    if(requestHeadersInput.value.trim()){
      try{
        requestBody.headers = JSON.parse(requestHeadersInput.value);
      }catch(e){
        // 如果headers不是有效的JSON，就忽略
        console.warn('Headers不是有效的JSON格式');
      }
    }

    // 添加body（如果存在且请求方法不是GET）
    if(requestBodyEditorInput.value.trim() && requestTypeSelect.value.toLowerCase() !== 'get'){
      // 尝试解析为JSON，如果失败则作为普通字符串处理
      try{
        requestBody.data = JSON.parse(requestBodyEditorInput.value);
      }catch(e){
        requestBody.data = requestBodyEditorInput.value;
      }
    }

    requestBodyInput.value = JSON.stringify(requestBody);
  }

  // 加载任务用于编辑
  function loadTaskForEditing(taskId){
    chrome.storage.local.get('tasks', (result) => {
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

        // 解析请求体配置到表单字段
        if(currentTask.requestBody){
          const requestBody = typeof currentTask.requestBody === 'string'
            ? JSON.parse(currentTask.requestBody)
            : currentTask.requestBody;

          requestTypeSelect.value = requestBody.type || 'get';
          requestDataTypeSelect.value = requestBody.dataType || 'json';
          requestTimeoutInput.value = requestBody.timeout || 7000;
          requestUrlInput.value = requestBody.url || '';

          // 加载headers和body
          if(requestBody.headers){
            requestHeadersInput.value = JSON.stringify(requestBody.headers, null, 2);
          }

          if(requestBody.data){
            // 如果data是对象，则转换为格式化的JSON字符串
            if(typeof requestBody.data === 'object'){
              requestBodyEditorInput.value = JSON.stringify(requestBody.data, null, 2);
            }else{
              requestBodyEditorInput.value = requestBody.data;
            }
          }
        }

        updateRequestBody(); // 更新隐藏字段
        responseHandlerInput.value = currentTask.responseHandler;

        // 加载历史记录设置
        loadHistorySettings(taskId);
      }else{
        showError('未找到指定的任务');
        setTimeout(() => window.close(), 2000);
      }
    });
  }

  // 显示历史记录
  function showHistory(){
    if(!currentTask && !taskIdInput.value){
      showError('请先保存任务');
      return;
    }

    // 清空历史记录表格
    historyTableBody.innerHTML = '';

    // 获取任务的历史记录
    const taskId = currentTask ? currentTask.id : taskIdInput.value;
    const historyKey = `taskHistory_${taskId}`;
    chrome.storage.local.get(historyKey, (result) => {
      const history = result[historyKey] || [];

      // 填充历史记录表格
      if(history.length === 0){
        const row = document.createElement('tr');
        row.innerHTML = '<td colspan="2" style="text-align: center;" data-i18n="no_history">暂无历史记录</td>';
        historyTableBody.appendChild(row);
      }else{
        history.forEach((record,idx) => {
          const row = document.createElement('tr');
          const time = new Date(record.timestamp).toLocaleString();
          const resultText = record.error ? record.error : record.result.content;

          row.innerHTML = `
            <td>${idx+1}</td>
            <td>${time}</td>
            <td>${resultText}</td>
          `;
          historyTableBody.appendChild(row);
        });
      }

      // 显示模态框
      historyModal.style.display = 'flex';
      // 初始化国际化
      i18nInit();
    });
  }

  // 加载历史记录设置
  function loadHistorySettings(taskId){
    // maxHistoryCount 现在从任务配置中加载，而不是单独的设置
    if(currentTask && currentTask.maxHistoryCount !== undefined){
      maxHistoryCountInput.value = currentTask.maxHistoryCount;
    }else{
      maxHistoryCountInput.value = 10; // 默认值
    }
  }

  // 清空历史记录
  function clearHistory(){
    if(!currentTask) return;

    if(confirm(chrome.i18n.getMessage('confirm_clear_history') || '确定要清空历史记录吗？')){
      const historyKey = `taskHistory_${currentTask.id}`;
      chrome.storage.local.remove(historyKey, () => {
        // 重新显示历史记录（将为空）
        showHistory();
      });
    }
  }

  // 将图片URL转换为base64编码
  function convertImageToBase64(url){
    return new Promise((resolve, reject) => {
      //暂时不再使用base64
      resolve(null);
      return;

      // 如果URL为空或不是有效的URL，则直接resolve空值
      if(!url || !url.trim()){
        resolve(null);
        return;
      }

      // 创建一个图片元素
      const img = new Image();
      img.crossOrigin = 'Anonymous'; // 处理跨域问题

      img.onload = () => {
        try{
          // 创建canvas元素
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');

          // 设置canvas尺寸与图片一致
          canvas.width = img.width;
          canvas.height = img.height;

          // 将图片绘制到canvas上
          ctx.drawImage(img, 0, 0);

          // 将canvas转换为base64字符串
          const base64 = canvas.toDataURL('image/png');
          resolve(base64);
        }catch(error){
          reject(new Error('图像转换失败: ' + error.message));
        }
      };

      img.onerror = () => {
        reject(new Error('图像加载失败'));
      };

      // 开始加载图片
      img.src = url;
    });
  }

  // 保存任务
  function saveTask(e){
    e.preventDefault();

    try{
      saveCodeMirror();

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
        !responseHandlerInput.value.includes('content')
        || !responseHandlerInput.value.includes('notify')
      ){
        showError(`返回值处理代码需返回 content 和 notify'`);
        return;
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
        maxHistoryCount: parseInt(maxHistoryCountInput.value) || 10,
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
      chrome.storage.local.get('tasks', (result) => {
        let tasks = result.tasks || [];

        // 转换图标为base64并保存
        convertImageToBase64(iconUrlInput.value.trim())
          .then(iconBase64 => {
            // 如果转换成功，添加到任务数据中
            if(iconBase64){
              taskData.iconBase64 = iconBase64;
            }
          })
          .catch(error => {
            // 即使图标转换失败，也要继续保存任务
            console.warn('图标转换失败:', error.message);
          })
          .finally(() => {
            // 无论图标转换成功与否，都要保存任务
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

            // 保存任务和历史记录设置
            const settings = {
              tasks: tasks
            };

            // 移除单独的历史记录设置保存逻辑
            // maxHistoryCount 现在作为任务属性统一保存

            chrome.storage.local.set(settings, () => {
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
      });

    }catch(error){
      showError(`保存失败: ${error.message}`);
    }
  }

  // 导出配置
  function exportConfig(){
    try{
      if(!currentTask.id){
        showError('Save task first');
        return;
      }

      delete currentTask.currentValue;
      delete currentTask.hasChanges;
      delete currentTask.lastChecked;

      // 显示配置在文本区域中
      exportConfigTextarea.value = '[' + JSON.stringify(currentTask, null, 2) + ']';
      exportConfigModal.style.display = 'flex';
    }catch(error){
      showError(`导出配置失败: ${error.message}`);
    }
  }

  // 测试请求
  function testRequest(){
    try{
      saveCodeMirror();

      // 解析请求配置
      const requestConfig = JSON.parse(requestBodyInput.value);

      // 发送测试请求
      chrome.runtime.sendMessage({
        action: 'testRequest',
        requestConfig: requestConfig
      }, (response) => {
        if(chrome.runtime.lastError){
          showTestResult(false, '' + chrome.runtime.lastError.message);
          return;
        }

        if(response.success){
          showTestResult(true, '', response.result);
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
      saveCodeMirror();

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
          showTestResult(false, '' + chrome.runtime.lastError.message);
          return;
        }

        if(response.success){
          showTestResult(true, '', response.result);
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
    resultTitleElement.textContent = success ? chrome.i18n.getMessage('test_successful') : chrome.i18n.getMessage('test_failed');
    resultTitleElement.style.color = success ? '#2ecc71' : '#e74c3c';

    let content = message;
    if(result !== null){
      content += JSON.stringify(result, null, 2);
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

// 监听来自background的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if(request.action === 'languageChanged'){
    // 重新加载页面以应用新语言
    location.reload();
    sendResponse({success: true});
  }
  return true;
});
