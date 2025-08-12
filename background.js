browser.browserAction.onClicked.addListener(() => {
  // Всегда обновляем панель перед открытием
  browser.sidebarAction.setPanel({ panel: "popup.html" });
  
  // Открываем sidebar без проверки состояния
  browser.sidebarAction.open();
});

// Обновление содержимого sidebar из popup.js
browser.runtime.onMessage.addListener((message) => {
  if (message.action === "updateSidebar") {
    browser.sidebarAction.setPanel({ panel: message.url });
  }
});

// Инициализация при установке
browser.runtime.onInstalled.addListener(() => {
  console.log('Polination AI Chat for Firefox extension installed');
});
