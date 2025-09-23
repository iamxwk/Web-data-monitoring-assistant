// 国际化处理函数
async function i18nInit() {
  // 初始化语言管理器
  await languageManager.init();
  
  // 处理所有带有data-i18n属性的元素
  const elements = document.querySelectorAll('[data-i18n]');
  elements.forEach(element => {
    const key = element.getAttribute('data-i18n');
    const message = languageManager.getMessage(key);
    
    if (message) {
      if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
        element.placeholder = message;
      } else if (element.tagName === 'SELECT' || element.tagName === 'OPTION') {
        element.textContent = message;
      } else {
        element.textContent = message;
      }
    }
  });
  
  // 处理带有data-i18n-placeholder属性的元素
  const placeholderElements = document.querySelectorAll('[data-i18n-placeholder]');
  placeholderElements.forEach(element => {
    const key = element.getAttribute('data-i18n-placeholder');
    const message = languageManager.getMessage(key);
    
    if (message) {
      element.placeholder = message;
    }
  });
  
  // 处理带有data-i18n-title属性的元素
  const titleElements = document.querySelectorAll('[data-i18n-title]');
  titleElements.forEach(element => {
    const key = element.getAttribute('data-i18n-title');
    const message = languageManager.getMessage(key);
    
    if (message) {
      element.title = message;
    }
  });
}

// 获取国际化消息的辅助函数
function getMessage(key, substitutions) {
  return languageManager.getMessage(key, substitutions);
}

// 如果在popup或选项页面中使用
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', i18nInit);
}

// 监听语言更改消息
if (typeof chrome !== 'undefined' && chrome.runtime) {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'languageChanged') {
      // 重新初始化国际化
      i18nInit().then(() => {
        // 如果在设置页面，更新通知
        if (document.getElementById('settingsForm')) {
          const notification = document.getElementById('notification');
          if (notification) {
            notification.textContent = languageManager.getMessage('settings_saved') || 'Settings saved';
            notification.className = 'notification success';
            notification.style.display = 'block';
            
            setTimeout(() => {
              notification.style.display = 'none';
              window.close();
            }, 1000);
          }
        }
        
        sendResponse({success: true});
      });
    }
    return true;
  });
}

// 导出函数供其他脚本使用
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { i18nInit, getMessage };
} else if (typeof window !== 'undefined') {
  window.i18nInit = i18nInit;
  window.getMessage = getMessage;
}