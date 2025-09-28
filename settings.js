document.addEventListener('DOMContentLoaded', () => {
  const settingsForm = document.getElementById('settingsForm');
  const languageSelect = document.getElementById('language');
  const cancelBtn = document.getElementById('cancelBtn');
  const notification = document.getElementById('notification');
  const tasksContainer = document.getElementById('tasksContainer');
  const deleteModal = document.getElementById('deleteModal');
  const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
  const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');

  // 添加清空所有任务相关元素
  const clearAllModal = document.getElementById('clearAllModal');
  const cancelClearAllBtn = document.getElementById('cancelClearAllBtn');
  const confirmClearAllBtn = document.getElementById('confirmClearAllBtn');
  const confirmText = document.getElementById('confirmText');

  // 全局变量
  let tasks = [];
  let taskToDelete = null;

  i18nInit();

  // 加载当前设置
  loadSettings();

  // 事件监听
  settingsForm.addEventListener('submit', saveSettings);
  cancelBtn.addEventListener('click', () => window.close());
  cancelDeleteBtn.addEventListener('click', () => {
    deleteModal.style.display = 'none';
    taskToDelete = null;
  });

  confirmDeleteBtn.addEventListener('click', () => {
    if(taskToDelete){
      deleteTask(taskToDelete);
      setTimeout(() => {
        deleteModal.style.display = 'none';
        taskToDelete = null;
      });
    }
  });

  // 添加清空所有任务的事件监听
  cancelClearAllBtn.addEventListener('click', () => {
    clearAllModal.style.display = 'none';
    confirmText.value = '';
    confirmClearAllBtn.disabled = true;
  });

  confirmText.addEventListener('input', () => {
    confirmClearAllBtn.disabled = confirmText.value !== 'DELETE';
  });

  confirmClearAllBtn.addEventListener('click', () => {
    if (confirmText.value === 'DELETE') {
      clearAllTasks();
      clearAllModal.style.display = 'none';
      confirmText.value = '';
      confirmClearAllBtn.disabled = true;
    }
  });

  // 加载设置
  function loadSettings(){
    chrome.storage.local.get(['settings', 'tasks'], (result) => {
      const settings = result.settings || {};

      tasks = result.tasks.sort((a, b) => {
        // 如果一个任务有变化而另一个没有，则有变化的排在前面
        // 这里不处理是否变化影响排序
        // if(a.hasChanges && !b.hasChanges) return -1;
        // if(!a.hasChanges && b.hasChanges) return 1;

        // 如果一个任务被禁用而另一个没有，则未禁用的排在前面
        if(a.enabled !== false && b.enabled === false) return -1;
        if(a.enabled === false && b.enabled !== false) return 1;

        // 如果两个任务都有变化或都没有变化，且启用状态相同，则保持原有顺序
        return 0;
      });

      if(settings.language){
        languageSelect.value = settings.language;
      }

      renderTasksTable();
    });
  }

  // 保存设置
  function saveSettings(e){
    e.preventDefault();

    const settings = {
      language: languageSelect.value
    };

    chrome.storage.local.set({settings}, () => {
      showNotification(chrome.i18n.getMessage('settings_saved') || '设置已保存', 'success');

      // 发送消息通知其他部分语言设置已更改
      chrome.runtime.sendMessage({
        action: 'languageChanged',
        language: settings.language
      });

      // 广播消息到所有tabs，通知它们更新语言
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, {
            action: 'languageChanged',
            language: settings.language
          }, () => {
            // 忽略错误，因为不是所有tabs都有内容脚本
          });
        });
      });

      // 延迟关闭页面，让用户看到通知
      setTimeout(() => window.close(), 1000);
    });
  }

  // 渲染任务表格
  function renderTasksTable(){
    if(tasks.length === 0){
      tasksContainer.innerHTML = '<div class="no-tasks" data-i18n="no_tasks">暂无监控任务</div>';
      i18nInit();
      return;
    }

    let tableHTML = `
      <table class="tasks-table">
        <thead>
          <tr>
            <th></th>
            <th data-i18n="task_id">任务ID</th>
            <th data-i18n="task_title">任务标题</th>
            <th data-i18n="last_run_time">上次运行时间</th>
            <th data-i18n="next_run_time">下次运行时间</th>
            <th data-i18n="actions">操作</th>
          </tr>
        </thead>
        <tbody>
    `;

    tasks.forEach((task, index) => {
      // 格式化上次运行时间
      const lastRunTime = task.lastChecked
        ? new Date(task.lastChecked).toLocaleString()
        : (languageManager.getMessage('never_ran') || '从未运行');

      tableHTML += `
        <tr data-task-id="${task.id}">
          <td>${index + 1}</td>
          <td>${escapeHtml(task.id)}</td>
          <td>${escapeHtml(task.title)}</td>
          <td>${lastRunTime}</td>
          <td class="next-run-time" data-i18n="loading">加载中...</td>
          <td class="action-buttons">
            <button class="edit-btn" data-task-id="${task.id}">
              <i class="fas fa-edit"></i> <span data-i18n="edit">编辑</span>
            </button>
            <button class="delete-btn" data-task-id="${task.id}">
              <i class="fas fa-trash"></i> <span data-i18n="delete">删除</span>
            </button>
          </td>
        </tr>
      `;
    });

    // 添加清空所有任务按钮
    tableHTML += `
        </tbody>
      </table>
      <div style="margin-top: 20px; text-align: center;">
        <button type="button" id="clearAllTasksBtn" style="background-color: #e74c3c; color: white; padding: 10px 20px;">
          <i class="fas fa-trash-alt"></i> <span data-i18n="clear_all_tasks">清空所有任务</span>
        </button>
      </div>
    `;

    tasksContainer.innerHTML = tableHTML;

    // 获取所有任务的下次运行时间
    tasks.forEach(task => {
      getNextRunTime(task.id);
    });

    // 添加编辑和删除按钮事件监听器
    document.querySelectorAll('.edit-btn').forEach(button => {
      button.addEventListener('click', (e) => {
        const taskId = e.currentTarget.getAttribute('data-task-id');
        editTask(taskId);
      });
    });

    document.querySelectorAll('.delete-btn').forEach(button => {
      button.addEventListener('click', (e) => {
        taskToDelete = e.currentTarget.getAttribute('data-task-id');
        deleteModal.style.display = 'flex';
      });
    });

    // 添加清空所有任务按钮事件监听器
    const clearAllTasksBtn = document.getElementById('clearAllTasksBtn');
    if (clearAllTasksBtn) {
      clearAllTasksBtn.addEventListener('click', () => {
        clearAllModal.style.display = 'flex';
      });
    }

    i18nInit();
  }

  // 获取任务的下次运行时间
  function getNextRunTime(taskId){
    chrome.alarms.get(`task_${taskId}`, (alarm) => {
      const nextRunCell = document.querySelector(`tr[data-task-id="${taskId}"] .next-run-time`);

      const taskIndex = tasks.findIndex(t => t.id === taskId);
      const task = tasks[taskIndex];
      if(task.enabled){
        if(chrome.runtime.lastError){
          nextRunCell.textContent = languageManager.getMessage('calculation_error') || '计算错误';
          return;
        }

        if(alarm && alarm.scheduledTime){
          const nextRunTime = new Date(alarm.scheduledTime);
          nextRunCell.textContent = nextRunTime.toLocaleString();
        }else{
          nextRunCell.textContent = languageManager.getMessage('not_scheduled') || '未安排';
        }
      }else{
        nextRunCell.textContent = '-';
      }
    });
  }

  // 编辑任务
  function editTask(taskId){
    chrome.tabs.create({
      url: `${chrome.runtime.getURL('task-editor.html')}?id=${taskId}`
    });
  }

  // 删除任务
  function deleteTask(taskId){
    // 清除alarm
    chrome.runtime.sendMessage({
      action: 'removeAlarm',
      taskId: taskId
    });

    // 删除任务
    const updatedTasks = tasks.filter(task => task.id !== taskId);
    chrome.storage.local.set({tasks: updatedTasks}, () => {
      tasks = updatedTasks;
      renderTasksTable();
      showNotification(languageManager.getMessage('task_deleted') || '任务已删除', 'success');
    });
  }

  // 清空所有任务
  function clearAllTasks(){
    // 清除所有alarm
    chrome.runtime.sendMessage({
      action: 'removeAllAlarm'
    });

    // 清空任务列表
    chrome.storage.local.set({tasks: []}, () => {
      tasks = [];
      renderTasksTable();
      showNotification(languageManager.getMessage('all_tasks_cleared') || '所有任务已清空', 'success');
    });
  }

  // 显示通知
  function showNotification(message, type){
    notification.textContent = message;
    notification.className = `notification ${type}`;
    notification.style.display = 'block';

    setTimeout(() => {
      notification.style.display = 'none';
    }, 2000);
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
