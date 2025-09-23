document.addEventListener('DOMContentLoaded', () => {
  // 元素引用
  const taskListElement = document.getElementById('taskList');
  const addTaskBtn = document.getElementById('addTaskBtn');
  const importBtn = document.getElementById('importBtn');
  const exportBtn = document.getElementById('exportBtn');
  const markAllReadBtn = document.getElementById('markAllReadBtn');
  const refreshAllBtn = document.getElementById('refreshAllBtn');
  const deleteModal = document.getElementById('deleteModal');
  const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
  const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');

  // 添加用于显示变化任务数量的元素引用
  const headerElement = document.querySelector('header');
  let changedTasksIndicator = null;

  // 全局变量
  let tasks = [];
  let taskToDelete = null;
  let importMode = false;

  // 初始化
  loadTasks();
  i18nInit();

  // 事件监听
  addTaskBtn.addEventListener('click', () => {
    // 打开新标签页添加任务
    chrome.tabs.create({url: chrome.runtime.getURL('task-editor.html')});
  });

  importBtn.addEventListener('click', () => {
    // 创建文件输入元素
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'application/json';

    // 监听文件选择事件
    fileInput.addEventListener('change', (event) => {
      const file = event.target.files[0];
      if(file){
        const reader = new FileReader();
        reader.onload = (e) => {
          try{
            const importedTasks = JSON.parse(e.target.result);
            if(Array.isArray(importedTasks)){
              // 为导入的任务生成新ID并设置alarm
              const newTasks = importedTasks.map(task => {
                const newTask = {
                  ...task,
                  id: generateId(),
                  currentValue: null,
                  hasChanges: false,
                  lastChecked: null
                };
                setupTaskAlarm(newTask);
                return newTask;
              });

              chrome.storage.local.set({tasks: newTasks}, () => {
                tasks = newTasks;
                renderTaskList();
                showNotification(chrome.i18n.getMessage('config_import_success') || '配置导入成功');
              });
            }else{
              showNotification(chrome.i18n.getMessage('import_failed_format') || '导入失败：配置格式不正确', true);
            }
          }catch(error){
            showNotification(`${chrome.i18n.getMessage('import_failed') || '导入失败'}：${error.message}`, true);
          }
        };
        reader.readAsText(file);
      }
    });

    // 触发文件选择对话框
    fileInput.click();
  });

  exportBtn.addEventListener('click', () => {
    // 直接下载配置文件
    const dataStr = JSON.stringify(tasks, null, 2);
    const dataBlob = new Blob([dataStr], {type: 'application/json'});

    const exportFileName = `Web-data-monitoring-assistant-config-${new Date().toISOString().slice(0, 10)}.json`;

    // 创建下载链接
    const downloadLink = document.createElement('a');
    downloadLink.href = URL.createObjectURL(dataBlob);
    downloadLink.download = exportFileName;

    // 添加到页面并触发下载
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);

    showNotification(chrome.i18n.getMessage('config_downloaded') || '配置已下载');
  });

  markAllReadBtn.addEventListener('click', () => {
    const updatedTasks = tasks.map(task => ({
      ...task,
      hasChanges: false
    }));

    chrome.storage.local.set({tasks: updatedTasks}, () => {
      tasks = updatedTasks;
      renderTaskList();
      showNotification(chrome.i18n.getMessage('all_marked_read') || '所有任务已标记为已读');
      // 更新徽章文本
      updateBadgeText();
    });
  });

  refreshAllBtn.addEventListener('click', () => {
    showNotification(chrome.i18n.getMessage('refreshing_all_tasks') || '正在刷新所有任务...');

    // 使用async/await按顺序刷新任务
    async function refreshTasksSequentially(){
      for(const task of tasks){
        try{
          await new Promise((resolve, reject) => {
            showNotification(chrome.i18n.getMessage('refreshing_task', [task.title]) || `正在刷新 "${task.title}"...`);
            chrome.runtime.sendMessage({
              action: 'checkTask',
              taskId: task.id
            }, (response) => {
              if(chrome.runtime.lastError){
                reject(chrome.runtime.lastError);
              }else{
                resolve(response);
              }
            });
          });
        }catch(error){
          console.error(chrome.i18n.getMessage('refresh_task_failed', [task.title]) || `刷新任务 "${task.title}" 失败:`, error);
        }
      }

      loadTasks();
      showNotification(chrome.i18n.getMessage('all_tasks_refreshed') || '所有任务已刷新');
    }

    // 开始按顺序刷新任务
    refreshTasksSequentially();
  });

  cancelDeleteBtn.addEventListener('click', () => {
    deleteModal.style.display = 'none';
    taskToDelete = null;
  });

  confirmDeleteBtn.addEventListener('click', () => {
    if(taskToDelete){
      // 清除alarm
      chrome.runtime.sendMessage({
        action: 'removeAlarm',
        taskId: taskToDelete
      });

      // 删除任务
      const updatedTasks = tasks.filter(task => task.id !== taskToDelete);
      chrome.storage.local.set({tasks: updatedTasks}, () => {
        tasks = updatedTasks;
        renderTaskList();
        deleteModal.style.display = 'none';
        taskToDelete = null;
        showNotification(chrome.i18n.getMessage('task_deleted') || '任务已删除');
      });
    }
  });

  // 监听语言更改消息
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'languageChanged') {
      // 重新加载任务列表以应用新语言
      loadTasks();
      i18nInit();
      sendResponse({success: true});
    }
    return true;
  });

  // 加载任务列表
  function loadTasks(){
    chrome.storage.local.get('tasks', (result) => {
      tasks = result.tasks || [];
      renderTaskList();
      updateChangedTasksIndicator(); // 更新变化任务指示器
    });
  }

  // 渲染任务列表
  function renderTaskList() {
    if (tasks.length === 0) {
      taskListElement.innerHTML = '<div class="no-tasks" data-i18n="no_tasks">暂无监控任务，点击"添加任务"创建新任务</div>';
      i18nInit();
      return;
    }

    taskListElement.innerHTML = '';

    // 对任务进行排序，将有变化的任务排在最前面
    const sortedTasks = [...tasks].sort((a, b) => {
      // 如果一个任务有变化而另一个没有，则有变化的排在前面
      if (a.hasChanges && !b.hasChanges) return -1;
      if (!a.hasChanges && b.hasChanges) return 1;

      // 如果两个任务都有变化或都没有变化，则保持原有顺序
      return 0;
    });

    sortedTasks.forEach(task => {
      const taskElement = document.createElement('div');
      // 根据任务是否启用添加disabled类
      taskElement.className = `task-item ${task.hasChanges ? 'has-changes' : ''} ${task.enabled === false ? 'disabled' : ''}`;
      taskElement.dataset.id = task.id;

      // 格式化上次检查时间
      const lastChecked = task.lastChecked ?
        new Date(task.lastChecked).toLocaleString() :
        chrome.i18n.getMessage('never_checked');

      // 选择图标源：优先使用base64图标，其次使用URL图标，最后使用默认图标
      const iconSource = task.iconBase64 || task.iconUrl || 'icon/icon.png';

      // 构建任务HTML
      taskElement.innerHTML = `
        <div class="drag-handle">
          <i class="fas fa-bars"></i>
        </div>
        <div class="task-icon">
          <img src="${iconSource}" alt="Task Icon" width="24" height="24" loading="lazy">
        </div>
        <div class="task-content">
          <h3 class="task-title">${escapeHtml(task.title)}&nbsp;<small>${lastChecked}</small></h3>
          
          <div class="task-info">
<!--            <span>周期: ${task.frequency.value} ${task.frequency.unit === 'minute' ? '分钟' : '小时'}</span>-->
            <span>${task.currentValue ? task.currentValue.content : ''}</span>
<!--                        ${task.hasChanges ? '<span style="color: #e74c3c;">有变化</span>' : ''}-->
          </div>
        </div>
        <div class="task-actions">
          <button class="task-btn edit-btn" data-i18n-title="edit_task" title="编辑">
            <i class="fas fa-edit"></i>
          </button>
          <button class="task-btn delete-btn" data-i18n-title="delete_task" title="删除">
            <i class="fas fa-trash"></i>
          </button>
          <button class="task-btn refresh-btn" data-i18n-title="refresh_task" title="刷新">
            <i class="fas fa-sync"></i>
          </button>
        </div>
      `;

      // 添加点击任务标题跳转到编辑页面并标记为已读的事件监听
      const taskTitleElement = taskElement.querySelector('.task-title');
      taskTitleElement.addEventListener('click', () => {
        // 如果任务有变化，则标记为已读
        if (task.hasChanges) {
          markTaskAsRead(task.id);
        }

        // 跳转到编辑页面
        setTimeout(function () {
          chrome.tabs.create({
            url: `${task.pageUrl}`
          });
        },100)
      });

      // 添加事件监听
      taskElement.querySelector('.edit-btn').addEventListener('click', () => {
        chrome.tabs.create({
          url: `${chrome.runtime.getURL('task-editor.html')}?id=${task.id}`
        });
      });

      taskElement.querySelector('.delete-btn').addEventListener('click', () => {
        taskToDelete = task.id;
        deleteModal.style.display = 'flex';
      });

      taskElement.querySelector('.refresh-btn').addEventListener('click', () => {
        showNotification(chrome.i18n.getMessage("refreshing_task", [task.title]) || `正在刷新 "${task.title}"...`);
        chrome.runtime.sendMessage({
          action: 'checkTask',
          taskId: task.id
        }, (response) => {
          if (response && response.success) {
            loadTasks();
            showNotification(chrome.i18n.getMessage("refreshed_task", [task.title]) || `已刷新 "${task.title}"`);
          } else {
            showNotification(chrome.i18n.getMessage("refresh_failed", [response ? response.error : 'Unknown error']) || `刷新失败: ${response ? response.error : 'Unknown error'}`, true);
          }
        });
      });

      taskListElement.appendChild(taskElement);
    });

    // 初始化拖拽功能
    initDragAndDrop();
    updateChangedTasksIndicator(); // 更新变化任务指示器
    i18nInit();
  }

  // 标记任务为已读
  function markTaskAsRead(taskId){
    // 更新任务列表中的任务状态
    const updatedTasks = tasks.map(task => {
      if(task.id === taskId){
        return {
          ...task,
          hasChanges: false
        };
      }
      return task;
    });

    // 保存更新后的任务列表
    chrome.storage.local.set({tasks: updatedTasks}, () => {
      tasks = updatedTasks;
      renderTaskList();
      showNotification(chrome.i18n.getMessage('task_marked_read') || '任务已标记为已读');
      updateBadgeText();
      // chrome.runtime.sendMessage({
      //   action: 'updateBadge'
      // });
    });
  }

  // 更新变化任务指示器
  function updateChangedTasksIndicator(){
    // 移除现有的指示器
    if(changedTasksIndicator){
      changedTasksIndicator.remove();
    }

    // 计算变化的任务数量
    const changedTasksCount = tasks.filter(task => task.hasChanges && task.enabled !== false).length;

    // 如果没有变化的任务，则不显示指示器
    if(changedTasksCount === 0){
      // 更新徽章文本
      updateBadgeText();
      return;
    }

    // 创建并添加新的指示器
    changedTasksIndicator = document.createElement('div');
    changedTasksIndicator.className = 'changed-tasks-indicator';
    changedTasksIndicator.innerHTML = `
            <span class="changed-count">${changedTasksCount}</span>
            <span class="changed-label" data-i18n="changed_tasks">个任务有变化</span>
        `;

    // 将指示器添加到header中
    headerElement.appendChild(changedTasksIndicator);

    // 更新徽章文本
    updateBadgeText();
    i18nInit();
  }

  // 更新徽章文本的辅助函数
  function updateBadgeText(){
    const changedTasksCount = tasks.filter(task => task.hasChanges && task.enabled !== false).length;

    if(changedTasksCount > 0){
      chrome.action.setBadgeText({text: changedTasksCount.toString()});
      chrome.action.setBadgeBackgroundColor({color: '#FF0000'}); // 红色背景
    }else{
      chrome.action.setBadgeText({text: ''});
    }
  }

  // 初始化拖拽排序
  function initDragAndDrop(){
    const taskItems = document.querySelectorAll('.task-item');
    let draggedItem = null;

    taskItems.forEach(item => {
      // 获取拖拽手柄元素
      const dragHandle = item.querySelector('.drag-handle');

      // 为拖拽手柄设置可拖拽属性
      dragHandle.setAttribute('draggable', true);

      // 在拖拽手柄上监听拖拽事件
      dragHandle.addEventListener('dragstart', (e) => {
        draggedItem = item;
        setTimeout(() => item.classList.add('dragging'), 0);
        // 设置拖拽效果
        e.dataTransfer.effectAllowed = 'move';
      });

      dragHandle.addEventListener('dragend', () => {
        if (draggedItem) {
          draggedItem.classList.remove('dragging');
          draggedItem = null;

          // 更新任务顺序
          const taskIds = Array.from(document.querySelectorAll('.task-item'))
            .map(item => item.dataset.id);

          const reorderedTasks = taskIds.map(id =>
            tasks.find(task => task.id === id)
          );

          chrome.storage.local.set({tasks: reorderedTasks}, () => {
            tasks = reorderedTasks;
            showNotification(chrome.i18n.getMessage('task_order_updated') || '任务顺序已更新');
          });
        }
      });

      // 在整个项目上监听dragover事件，以便确定放置位置
      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (!draggedItem) return;

        e.dataTransfer.dropEffect = 'move';
        const afterElement = getDragAfterElement(taskListElement, e.clientY);
        const draggable = document.querySelector('.dragging');
        if(afterElement == null){
          taskListElement.appendChild(draggable);
        }else{
          taskListElement.insertBefore(draggable, afterElement);
        }
      });
    });
  }

  // 辅助函数：确定拖拽后元素的位置
  function getDragAfterElement(container, y){
    const draggableElements = [...container.querySelectorAll('.task-item:not(.dragging)')];

    return draggableElements.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if(offset < 0 && offset > closest.offset){
        return {offset: offset, element: child};
      }else{
        return closest;
      }
    }, {offset: Number.NEGATIVE_INFINITY}).element;
  }

  // 设置任务定时
  function setupTaskAlarm(task){
    chrome.runtime.sendMessage({
      action: 'setupAlarm',
      task: task
    });
  }

  // 显示通知
  var tim;
  function showNotification(message, isError = false){
    // 创建临时通知元素
    $('.div_notification').remove();
    clearTimeout(tim);

    const $notification = $('<div>')
      .text(message)
      .css({
        position: 'fixed',
        top: '10px',
        right: '10px',
        padding: '10px 15px',
        borderRadius: '4px',
        color: 'white',
        backgroundColor: isError ? '#e74c3c' : '#2ecc71',
        boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
        zIndex: 1000
      })
      .addClass('div_notification');
    $('body').append($notification);

    tim = setTimeout(() => {
      $notification.stop(true, true).fadeOut(function(){
        $(this).remove();
      });
    }, 1000);
  }

  // 生成唯一ID
  function generateId(){
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  }

  // 转义HTML特殊字符
  function escapeHtml(text){
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };

    return text.replace(/[&<>"']/g, (m) => map[m]);
  }
});

// 监听来自background的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'languageChanged') {
    // 重新加载页面以应用新语言
    location.reload();
    sendResponse({success: true});
  }
  return true;
});
