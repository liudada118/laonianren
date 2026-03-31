import React, { useState, useEffect, useCallback } from 'react'

/**
 * 应用更新通知组件
 * 通过 Electron preload 暴露的 API 与主进程通信
 * 实现检查更新、下载更新、安装更新的完整流程
 */
export default function UpdateNotification() {
  const [updateState, setUpdateState] = useState({
    status: 'idle',       // idle | checking | available | downloading | downloaded | error | not-available
    message: '',
    version: '',
    percent: 0,
    releaseNotes: '',
  })
  const [showDialog, setShowDialog] = useState(false)
  const [appVersion, setAppVersion] = useState('')
  const [dismissed, setDismissed] = useState(false)

  // 检查是否在 Electron 环境中
  const isElectron = typeof window !== 'undefined' && window.electronAPI && window.electronAPI.onUpdateStatus

  useEffect(() => {
    if (!isElectron) return

    // 获取当前版本
    window.electronAPI.getAppVersion().then(info => {
      if (info && info.version) {
        setAppVersion(info.version)
      }
    }).catch(() => {})

    // 监听更新状态
    const unsubscribe = window.electronAPI.onUpdateStatus((data) => {
      setUpdateState(prev => ({ ...prev, ...data }))

      // 发现新版本时自动弹出提示
      if (data.status === 'available') {
        setShowDialog(true)
        setDismissed(false)
      }

      // 下载完成时弹出安装提示
      if (data.status === 'downloaded') {
        setShowDialog(true)
      }
    })

    return () => {
      if (unsubscribe) unsubscribe()
    }
  }, [isElectron])

  // 手动检查更新
  const handleCheckUpdate = useCallback(async () => {
    if (!isElectron) return
    setUpdateState({ status: 'checking', message: '正在检查更新...', version: '', percent: 0, releaseNotes: '' })
    setShowDialog(true)
    try {
      await window.electronAPI.checkForUpdate()
    } catch (err) {
      setUpdateState(prev => ({
        ...prev,
        status: 'error',
        message: '检查更新失败: ' + (err.message || '未知错误')
      }))
    }
  }, [isElectron])

  // 开始下载
  const handleDownload = useCallback(async () => {
    if (!isElectron) return
    try {
      await window.electronAPI.downloadUpdate()
    } catch (err) {
      setUpdateState(prev => ({
        ...prev,
        status: 'error',
        message: '下载更新失败: ' + (err.message || '未知错误')
      }))
    }
  }, [isElectron])

  // 安装并重启
  const handleInstall = useCallback(async () => {
    if (!isElectron) return
    try {
      await window.electronAPI.installUpdate()
    } catch (err) {
      console.error('安装更新失败:', err)
    }
  }, [isElectron])

  // 关闭弹窗
  const handleDismiss = useCallback(() => {
    setShowDialog(false)
    if (updateState.status === 'available') {
      setDismissed(true)
    }
  }, [updateState.status])

  // 非 Electron 环境不渲染
  if (!isElectron) return null

  // 状态图标
  const statusIcons = {
    checking: (
      <svg className="w-5 h-5 animate-spin" style={{ color: 'var(--zeiss-blue)' }} fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    ),
    available: (
      <svg className="w-5 h-5" style={{ color: 'var(--zeiss-blue)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
      </svg>
    ),
    downloading: (
      <svg className="w-5 h-5 animate-spin" style={{ color: 'var(--zeiss-blue)' }} fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    ),
    downloaded: (
      <svg className="w-5 h-5" style={{ color: 'var(--success)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    error: (
      <svg className="w-5 h-5" style={{ color: 'var(--danger)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    'not-available': (
      <svg className="w-5 h-5" style={{ color: 'var(--success)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  }

  return (
    <>
      {/* 顶部小提示条 - 有新版本且被关闭时显示 */}
      {dismissed && updateState.status === 'available' && (
        <div
          className="fixed top-0 left-0 right-0 z-[200] flex items-center justify-center gap-2 py-1.5 cursor-pointer transition-all duration-300"
          style={{
            background: 'linear-gradient(90deg, var(--zeiss-blue) 0%, #0077EE 100%)',
            color: 'white',
            fontSize: 13,
          }}
          onClick={() => { setShowDialog(true); setDismissed(false) }}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          <span>发现新版本 v{updateState.version}，点击查看</span>
        </div>
      )}

      {/* 更新弹窗 */}
      {showDialog && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center">
          {/* 遮罩 */}
          <div
            className="fixed inset-0 animate-fadeIn"
            style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}
            onClick={updateState.status !== 'downloading' ? handleDismiss : undefined}
          />

          {/* 弹窗内容 */}
          <div
            className="relative z-10 w-[420px] max-w-[90vw] rounded-2xl p-7 animate-scaleIn"
            style={{
              background: 'var(--bg-secondary)',
              boxShadow: 'var(--shadow-xl)',
            }}
          >
            {/* 标题栏 */}
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2.5">
                {statusIcons[updateState.status] || statusIcons.checking}
                <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                  {updateState.status === 'checking' && '检查更新'}
                  {updateState.status === 'available' && '发现新版本'}
                  {updateState.status === 'downloading' && '正在下载'}
                  {updateState.status === 'downloaded' && '下载完成'}
                  {updateState.status === 'error' && '更新失败'}
                  {updateState.status === 'not-available' && '已是最新'}
                  {updateState.status === 'idle' && '软件更新'}
                </h3>
              </div>
              {updateState.status !== 'downloading' && (
                <button
                  onClick={handleDismiss}
                  className="p-1 rounded-lg transition-colors duration-150"
                  style={{ color: 'var(--text-muted)' }}
                  onMouseEnter={e => e.target.style.background = 'var(--bg-hover)'}
                  onMouseLeave={e => e.target.style.background = 'transparent'}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            {/* 版本信息 */}
            {appVersion && (
              <div className="mb-4 text-sm" style={{ color: 'var(--text-tertiary)' }}>
                当前版本: v{appVersion}
                {updateState.version && updateState.status !== 'not-available' && (
                  <span className="ml-3">
                    <span style={{ color: 'var(--text-muted)' }}>&rarr;</span>
                    <span className="ml-1 font-semibold" style={{ color: 'var(--zeiss-blue)' }}>v{updateState.version}</span>
                  </span>
                )}
              </div>
            )}

            {/* 状态消息 */}
            <p className="text-sm mb-5" style={{ color: 'var(--text-secondary)' }}>
              {updateState.message}
            </p>

            {/* 下载进度条 */}
            {updateState.status === 'downloading' && (
              <div className="mb-5">
                <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${updateState.percent || 0}%`,
                      background: 'linear-gradient(90deg, var(--zeiss-blue) 0%, #0077EE 100%)',
                    }}
                  />
                </div>
                <div className="flex justify-between mt-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                  <span>{updateState.percent || 0}%</span>
                  {updateState.bytesPerSecond && (
                    <span>{formatBytes(updateState.bytesPerSecond)}/s</span>
                  )}
                </div>
              </div>
            )}

            {/* 更新说明 */}
            {updateState.releaseNotes && (updateState.status === 'available' || updateState.status === 'downloaded') && (
              <div
                className="mb-5 p-3 rounded-xl text-sm max-h-32 overflow-y-auto"
                style={{
                  background: 'var(--bg-primary)',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-light)',
                }}
              >
                <p className="text-xs font-medium mb-1.5" style={{ color: 'var(--text-tertiary)' }}>更新说明</p>
                <div dangerouslySetInnerHTML={{ __html: updateState.releaseNotes }} />
              </div>
            )}

            {/* 操作按钮 */}
            <div className="flex gap-3 justify-end">
              {/* 检查中 - 无按钮 */}
              {updateState.status === 'checking' && null}

              {/* 发现新版本 - 下载 / 稍后 */}
              {updateState.status === 'available' && (
                <>
                  <button
                    onClick={handleDismiss}
                    className="px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-150"
                    style={{
                      background: 'var(--bg-primary)',
                      color: 'var(--text-secondary)',
                      border: '1px solid var(--border-light)',
                    }}
                  >
                    稍后提醒
                  </button>
                  <button
                    onClick={handleDownload}
                    className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-150"
                    style={{
                      background: 'var(--zeiss-blue)',
                      color: 'white',
                      boxShadow: '0 4px 14px rgba(0,102,204,0.25)',
                    }}
                  >
                    立即下载
                  </button>
                </>
              )}

              {/* 下载中 - 无按钮（不允许关闭） */}
              {updateState.status === 'downloading' && (
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  请勿关闭应用...
                </span>
              )}

              {/* 下载完成 - 安装 / 稍后 */}
              {updateState.status === 'downloaded' && (
                <>
                  <button
                    onClick={handleDismiss}
                    className="px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-150"
                    style={{
                      background: 'var(--bg-primary)',
                      color: 'var(--text-secondary)',
                      border: '1px solid var(--border-light)',
                    }}
                  >
                    稍后安装
                  </button>
                  <button
                    onClick={handleInstall}
                    className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-150"
                    style={{
                      background: 'var(--success)',
                      color: 'white',
                      boxShadow: '0 4px 14px rgba(16,185,129,0.25)',
                    }}
                  >
                    立即安装并重启
                  </button>
                </>
              )}

              {/* 错误 - 重试 */}
              {updateState.status === 'error' && (
                <>
                  <button
                    onClick={handleDismiss}
                    className="px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-150"
                    style={{
                      background: 'var(--bg-primary)',
                      color: 'var(--text-secondary)',
                      border: '1px solid var(--border-light)',
                    }}
                  >
                    关闭
                  </button>
                  <button
                    onClick={handleCheckUpdate}
                    className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-150"
                    style={{
                      background: 'var(--zeiss-blue)',
                      color: 'white',
                      boxShadow: '0 4px 14px rgba(0,102,204,0.25)',
                    }}
                  >
                    重试
                  </button>
                </>
              )}

              {/* 已是最新 / 空闲 - 关闭 */}
              {(updateState.status === 'not-available' || updateState.status === 'idle') && (
                <button
                  onClick={handleDismiss}
                  className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-150"
                  style={{
                    background: 'var(--zeiss-blue)',
                    color: 'white',
                    boxShadow: '0 4px 14px rgba(0,102,204,0.25)',
                  }}
                >
                  确定
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/**
 * 格式化字节数
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}
