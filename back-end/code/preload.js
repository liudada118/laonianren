// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getPath: (file) => file.path,

  // ====== 自动更新 API ======
  // 检查更新
  checkForUpdate: () => ipcRenderer.invoke('check-for-update'),
  // 下载更新
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  // 安装更新并重启
  installUpdate: () => ipcRenderer.invoke('install-update'),
  // 获取当前版本信息
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  // 确保本地 Python AI 服务已启动
  ensurePythonAi: () => ipcRenderer.invoke('ensure-python-ai'),
  // 监听更新状态
  onUpdateStatus: (callback) => {
    const handler = (_event, data) => callback(data)
    ipcRenderer.on('update-status', handler)
    // 返回取消监听函数
    return () => ipcRenderer.removeListener('update-status', handler)
  }
});
