// 语言管理器，支持运行时语言切换
class LanguageManager {
  constructor() {
    this.currentLanguage = 'default';
    this.languageData = {};
    this.supportedLanguages = ['en', 'zh_CN', 'zh_TW'];
  }

  // 初始化语言管理器
  async init() {
    const result = await chrome.storage.local.get('settings');
    const settings = result.settings || {};
    this.currentLanguage = settings.language || 'default';

    if (this.currentLanguage !== 'default') {
      await this.loadLanguage(this.currentLanguage);
    }
  }

  // 加载指定语言包
  async loadLanguage(language) {
    if (!this.supportedLanguages.includes(language)) {
      console.warn(`Unsupported language: ${language}`);
      return;
    }

    try {
      const response = await fetch(`/_locales/${language}/messages.json`);
      this.languageData[language] = await response.json();
    } catch (error) {
      console.error(`Failed to load language file for ${language}:`, error);
    }
  }

  // 获取消息文本
  getMessage(key, substitutions = []) {
    // 如果使用默认语言，使用Chrome的i18n API
    if (this.currentLanguage === 'default') {
      return chrome.i18n.getMessage(key, substitutions);
    }

    // 使用自定义语言包
    const langData = this.languageData[this.currentLanguage];
    if (!langData || !langData[key] || !langData[key].message) {
      // 回退到Chrome的i18n API
      return chrome.i18n.getMessage(key, substitutions);
    }

    let message = langData[key].message;

    // 处理替换变量
    if (Array.isArray(substitutions)) {
      substitutions.forEach((substitution, index) => {
        message = message.replace(`$${index + 1}`, substitution);
      });
    } else if (substitutions) {
      message = message.replace('$1', substitutions);
    }

    return message;
  }

  // 设置当前语言
  async setLanguage(language) {
    this.currentLanguage = language;

    if (language !== 'default') {
      await this.loadLanguage(language);
    }

    // 保存到存储
    await chrome.storage.local.set({
      settings: { language: language }
    });
  }

  // 获取当前语言
  getCurrentLanguage() {
    return this.currentLanguage;
  }
}

// 创建语言管理器实例
const languageManager = new LanguageManager();

// 导出供其他模块使用
if (typeof module !== 'undefined' && module.exports) {
  module.exports = languageManager;
} else if (typeof window !== 'undefined') {
  window.languageManager = languageManager;
}
