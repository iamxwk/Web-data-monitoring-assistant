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
    const importExportModal = document.getElementById('importExportModal');
    const importExportTitle = document.getElementById('importExportTitle');
    const importExportText = document.getElementById('importExportText');
    const doImportExportBtn = document.getElementById('doImportExportBtn');

    // 添加用于显示变化任务数量的元素引用
    const headerElement = document.querySelector('header');
    let changedTasksIndicator = null;

    // 全局变量
    let tasks = [];
    let taskToDelete = null;
    let importMode = false;

    // 初始化
    loadTasks();

    // 事件监听
    addTaskBtn.addEventListener('click', () => {
        // 打开新标签页添加任务
        chrome.tabs.create({ url: chrome.runtime.getURL('task-editor.html') });
    });

    importBtn.addEventListener('click', () => {
        importMode = true;
        importExportTitle.textContent = '导入配置';
        doImportExportBtn.textContent = '导入';
        importExportText.value = '';
        importExportModal.style.display = 'flex';
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

        showNotification('配置已下载');
    });

    doImportExportBtn.addEventListener('click', () => {
        if (importMode) {
            // 导入配置
            try {
                const importedTasks = JSON.parse(importExportText.value);
                if (Array.isArray(importedTasks)) {
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

                    chrome.storage.sync.set({ tasks: newTasks }, () => {
                        tasks = newTasks;
                        renderTaskList();
                        importExportModal.style.display = 'none';
                        showNotification('配置导入成功');
                    });
                } else {
                    showNotification('导入失败：配置格式不正确', true);
                }
            } catch (error) {
                showNotification(`导入失败：${error.message}`, true);
            }
        }
    });

    markAllReadBtn.addEventListener('click', () => {
        const updatedTasks = tasks.map(task => ({
            ...task,
            hasChanges: false
        }));

        chrome.storage.sync.set({ tasks: updatedTasks }, () => {
            tasks = updatedTasks;
            renderTaskList();
            showNotification('所有任务已标记为已读');
            // 更新徽章文本
            updateBadgeText();
        });
    });

    refreshAllBtn.addEventListener('click', () => {
        showNotification('正在刷新所有任务...');
        let completed = 0;

        tasks.forEach(task => {
            chrome.runtime.sendMessage({
                action: 'checkTask',
                taskId: task.id
            }, (response) => {
                completed++;
                if (completed === tasks.length) {
                    loadTasks();
                    showNotification('所有任务已刷新');
                }
            });
        });
    });

    cancelDeleteBtn.addEventListener('click', () => {
        deleteModal.style.display = 'none';
        taskToDelete = null;
    });

    confirmDeleteBtn.addEventListener('click', () => {
        if (taskToDelete) {
            // 清除alarm
            chrome.runtime.sendMessage({
                action: 'removeAlarm',
                taskId: taskToDelete
            });

            // 删除任务
            const updatedTasks = tasks.filter(task => task.id !== taskToDelete);
            chrome.storage.sync.set({ tasks: updatedTasks }, () => {
                tasks = updatedTasks;
                renderTaskList();
                deleteModal.style.display = 'none';
                taskToDelete = null;
                showNotification('任务已删除');
            });
        }
    });

    // 加载任务列表
    function loadTasks() {
        chrome.storage.sync.get('tasks', (result) => {
            tasks = result.tasks || [];
            renderTaskList();
            updateChangedTasksIndicator(); // 更新变化任务指示器
        });
    }

    // 渲染任务列表
    function renderTaskList() {
        if (tasks.length === 0) {
            taskListElement.innerHTML = '<div class="no-tasks">暂无监控任务，点击"添加任务"创建新任务</div>';
            return;
        }

        taskListElement.innerHTML = '';

        tasks.forEach(task => {
            const taskElement = document.createElement('div');
            taskElement.className = `task-item ${task.hasChanges ? 'has-changes' : ''}`;
            taskElement.dataset.id = task.id;

            // 格式化上次检查时间
            const lastChecked = task.lastChecked ?
                new Date(task.lastChecked).toLocaleString() :
                '从未检查';

            // 构建任务HTML
            taskElement.innerHTML = `
                <div class="drag-handle">
                    <i class="fas fa-grip-vertical"></i>
                </div>
                <div class="task-content">
                    <h3 class="task-title">${escapeHtml(task.title)}&nbsp;<small>${lastChecked}</small></h3>
                    
                    
                    <div class="task-info">
<!--                        <span>周期: ${task.frequency.value} ${task.frequency.unit === 'minute' ? '分钟' : '小时'}</span>-->
                        <span>${task.currentValue.content}</span>
                        ${task.hasChanges ? '<span style="color: #e74c3c;">有变化</span>' : ''}
                    </div>
                </div>
                <div class="task-actions">
                    <button class="task-btn edit-btn" title="编辑">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="task-btn delete-btn" title="删除">
                        <i class="fas fa-trash"></i>
                    </button>
                    <button class="task-btn refresh-btn" title="刷新">
                        <i class="fas fa-sync"></i>
                    </button>
                </div>
            `;

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
                showNotification(`正在刷新 "${task.title}"...`);
                chrome.runtime.sendMessage({
                    action: 'checkTask',
                    taskId: task.id
                }, (response) => {
                    if (response && response.success) {
                        loadTasks();
                        showNotification(`已刷新 "${task.title}"`);
                    } else {
                        showNotification(`刷新失败: ${response.error}`, true);
                    }
                });
            });

            taskListElement.appendChild(taskElement);
        });

        // 初始化拖拽功能
        initDragAndDrop();
        updateChangedTasksIndicator(); // 更新变化任务指示器
    }

    // 更新变化任务指示器
    function updateChangedTasksIndicator() {
        // 移除现有的指示器
        if (changedTasksIndicator) {
            changedTasksIndicator.remove();
        }

        // 计算变化的任务数量
        const changedTasksCount = tasks.filter(task => task.hasChanges && task.enabled !== false).length;

        // 如果没有变化的任务，则不显示指示器
        if (changedTasksCount === 0) {
            // 更新徽章文本
            updateBadgeText();
            return;
        }

        // 创建并添加新的指示器
        changedTasksIndicator = document.createElement('div');
        changedTasksIndicator.className = 'changed-tasks-indicator';
        changedTasksIndicator.innerHTML = `
            <span class="changed-count">${changedTasksCount}</span>
            <span class="changed-label">个任务有变化</span>
        `;

        // 将指示器添加到header中
        headerElement.appendChild(changedTasksIndicator);

        // 更新徽章文本
        updateBadgeText();
    }

    // 更新徽章文本的辅助函数
    function updateBadgeText() {
        const changedTasksCount = tasks.filter(task => task.hasChanges && task.enabled !== false).length;

        if (changedTasksCount > 0) {
            chrome.action.setBadgeText({ text: changedTasksCount.toString() });
            chrome.action.setBadgeBackgroundColor({ color: '#FF0000' }); // 红色背景
        } else {
            chrome.action.setBadgeText({ text: '' });
        }
    }

    // 初始化拖拽排序
    function initDragAndDrop() {
        const taskItems = document.querySelectorAll('.task-item');
        let draggedItem = null;

        taskItems.forEach(item => {
            item.setAttribute('draggable', true);

            item.addEventListener('dragstart', () => {
                draggedItem = item;
                setTimeout(() => item.classList.add('dragging'), 0);
            });

            item.addEventListener('dragend', () => {
                draggedItem = null;
                item.classList.remove('dragging');

                // 更新任务顺序
                const taskIds = Array.from(document.querySelectorAll('.task-item'))
                    .map(item => item.dataset.id);

                const reorderedTasks = taskIds.map(id =>
                    tasks.find(task => task.id === id)
                );

                chrome.storage.sync.set({ tasks: reorderedTasks }, () => {
                    tasks = reorderedTasks;
                    showNotification('任务顺序已更新');
                });
            });

            item.addEventListener('dragover', (e) => {
                e.preventDefault();
                const afterElement = getDragAfterElement(taskListElement, e.clientY);
                const draggable = document.querySelector('.dragging');
                if (afterElement == null) {
                    taskListElement.appendChild(draggable);
                } else {
                    taskListElement.insertBefore(draggable, afterElement);
                }
            });
        });
    }

    // 辅助函数：确定拖拽后元素的位置
    function getDragAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('.task-item:not(.dragging)')];

        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    // 设置任务定时
    function setupTaskAlarm(task) {
        chrome.runtime.sendMessage({
            action: 'setupAlarm',
            task: task
        });
    }

    // 生成唯一ID
    function generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    }

    // 显示通知
    function showNotification(message, isError = false) {
        // 创建临时通知元素
        const notification = document.createElement('div');
        notification.textContent = message;
        notification.style.position = 'fixed';
        notification.style.bottom = '20px';
        notification.style.right = '20px';
        notification.style.padding = '10px 15px';
        notification.style.borderRadius = '4px';
        notification.style.color = 'white';
        notification.style.backgroundColor = isError ? '#e74c3c' : '#2ecc71';
        notification.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
        notification.style.zIndex = '1000';
        notification.style.transition = 'opacity 0.3s';

        document.body.appendChild(notification);

        // 3秒后自动消失
        setTimeout(() => {
            notification.style.opacity = '0';
            setTimeout(() => {
                document.body.removeChild(notification);
            }, 300);
        }, 3000);
    }

    // HTML转义
    function escapeHtml(unsafe) {
        if (!unsafe) return '';
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
});
