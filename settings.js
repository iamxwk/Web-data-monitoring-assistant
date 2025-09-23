document.addEventListener('DOMContentLoaded', () => {
  const settingsForm = document.getElementById('settingsForm');
  const languageSelect = document.getElementById('language');
  const cancelBtn = document.getElementById('cancelBtn');
  const notification = document.getElementById('notification');

  // 加载当前设置
  loadSettings();

  // 事件监听
  settingsForm.addEventListener('submit', saveSettings);
  cancelBtn.addEventListener('click', () => window.close());

  // 加载设置
  function loadSettings() {
    chrome.storage.local.get('settings', (result) => {
      const settings = result.settings || {};
      if (settings.language) {
        languageSelect.value = settings.language;
      }
      i18nInit();
    });
  }

  // 保存设置
  function saveSettings(e) {
    e.preventDefault();
    
    const settings = {
      language: languageSelect.value
    };

    chrome.storage.local.set({ settings }, () => {
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

  // 显示通知
  function showNotification(message, type) {
    notification.textContent = message;
    notification.className = `notification ${type}`;
    notification.style.display = 'block';
    
    setTimeout(() => {
      notification.style.display = 'none';
    }, 2000);
  }
});