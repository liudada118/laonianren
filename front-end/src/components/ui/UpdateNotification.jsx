import React, { useState, useEffect, useCallback } from 'react'

/**
 * 应用更新通知组件
 * 右下角悬浮更新按钮，检测到新版本时弹窗显示 releaseNotes（来自服务器 latest.yml）
 */
export default function UpdateNotification() {
  const [updateState, setUpdateState] = useState({
    status: 'idle',       // idle | checking | available | downloading | downloaded | error | not-available
    message: '',
    version: '',
    percent: 0,
    releaseNotes: '',
    releaseDate: '',
  })
  const [showDialog, setShowDialog] = useState(false)
  const [appVersion, setAppVersion] = useState('')
  const [hasNewVersion, setHasNewVersion] = useState(false)

  const isElectron = typeof window !== 'undefined' && window.electronAPI && window.electronAPI.onUpdateStatus

  useEffect(() => {
    if (!isElectron) return

    window.electronAPI.getAppVersion().then(info => {
      if (info && info.version) setAppVersion(info.version)
    }).catch(() => {})

    const unsubscribe = window.electronAPI.onUpdateStatus((data) => {
      setUpdateState(prev => ({ ...prev, ...data }))

      if (data.status === 'available') {
        setHasNewVersion(true)
        setShowDialog(true)
      }

      if (data.status === 'downloaded') {
        setShowDialog(true)
      }

      if (data.status === 'not-available') {
        setHasNewVersion(false)
      }
    })

    return () => { if (unsubscribe) unsubscribe() }
  }, [isElectron])

  const handleCheckUpdate = useCallback(async () => {
    if (!isElectron) return
    setUpdateState(prev => ({ ...prev, status: 'checking', message: '正在检查更新...' }))
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

  const handleInstall = useCallback(async () => {
    if (!isElectron) return
    try {
      await window.electronAPI.installUpdate()
    } catch (err) {
      console.error('安装更新失败:', err)
    }
  }, [isElectron])

  const handleDismiss = useCallback(() => {
    setShowDialog(false)
  }, [])

  if (!isElectron) return null

  // 状态图标
  const spinnerSvg = (
    <svg className="w-5 h-5 animate-spin" style={{ color: 'var(--zeiss-blue)' }} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
  const infoSvg = (
    <svg className="w-5 h-5" style={{ color: 'var(--zeiss-blue)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
  const successSvg = (
    <svg className="w-5 h-5" style={{ color: 'var(--success, #10B981)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )

  const statusConfig = {
    idle:           { icon: infoSvg, title: '软件更新' },
    checking:       { icon: spinnerSvg, title: '检查更新' },
    available:      { icon: infoSvg, title: '发现新版本' },
    downloading:    { icon: spinnerSvg, title: '正在下载' },
    downloaded:     { icon: successSvg, title: '下载完成' },
    error:          { icon: infoSvg, title: '更新失败' },
    'not-available': { icon: successSvg, title: '已是最新' },
  }

  const cfg = statusConfig[updateState.status] || statusConfig.idle

  return (
    <>
      {/* 右下角更新按钮 */}
      <button
        onClick={handleCheckUpdate}
        className="fixed z-[100] flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-medium transition-all duration-200 shadow-lg"
        style={{
          right: 20,
          bottom: 20,
          background: hasNewVersion
            ? 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)'
            : 'linear-gradient(135deg, var(--zeiss-blue) 0%, #0077EE 100%)',
          color: 'white',
          boxShadow: hasNewVersion
            ? '0 4px 14px rgba(245,158,11,0.35)'
            : '0 4px 14px rgba(0,102,204,0.35)',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.transform = 'scale(1.05)'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.transform = 'scale(1)'
        }}
        title={hasNewVersion ? `发现新版本 v${updateState.version}` : '检查更新'}
      >
        {hasNewVersion ? (
          <>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            <span>新版本 v{updateState.version}</span>
            {/* 红点提示 */}
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
          </>
        ) : (
          <>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>v{appVersion || '...'}</span>
          </>
        )}
      </button>

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
            className="relative z-10 w-[460px] max-w-[90vw] rounded-2xl p-7 animate-scaleIn"
            style={{
              background: 'var(--bg-secondary)',
              boxShadow: 'var(--shadow-xl)',
            }}
          >
            {/* 标题栏 */}
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2.5">
                {cfg.icon}
                <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                  {cfg.title}
                </h3>
              </div>
              {updateState.status !== 'downloading' && (
                <button
                  onClick={handleDismiss}
                  className="p-1 rounded-lg transition-colors duration-150"
                  style={{ color: 'var(--text-muted)' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
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

            {/* 更新说明 - 来自服务器 latest.yml 的 releaseNotes */}
            {updateState.releaseNotes && (updateState.status === 'available' || updateState.status === 'downloaded') && (
              <div
                className="mb-5 p-4 rounded-xl text-sm max-h-48 overflow-y-auto"
                style={{
                  background: 'var(--bg-primary)',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-light)',
                }}
              >
                <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-tertiary)' }}>
                  更新说明
                </p>
                {typeof updateState.releaseNotes === 'string' ? (
                  <div
                    className="release-notes-content space-y-1"
                    dangerouslySetInnerHTML={{ __html: formatReleaseNotes(updateState.releaseNotes) }}
                  />
                ) : (
                  <div className="release-notes-content space-y-1">
                    {updateState.releaseNotes}
                  </div>
                )}
              </div>
            )}

            {/* 操作按钮 */}
            <div className="flex gap-3 justify-end">
              {updateState.status === 'checking' && null}

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

              {updateState.status === 'downloading' && (
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  请勿关闭应用...
                </span>
              )}

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
                      background: 'var(--success, #10B981)',
                      color: 'white',
                      boxShadow: '0 4px 14px rgba(16,185,129,0.25)',
                    }}
                  >
                    立即安装并重启
                  </button>
                </>
              )}

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
 * 将 Markdown 格式的 releaseNotes 转为简单 HTML
 */
function formatReleaseNotes(text) {
  if (!text) return ''
  return text
    .replace(/^### (.+)$/gm, '<p style="font-weight:600;margin-top:8px;margin-bottom:4px;">$1</p>')
    .replace(/^## (.+)$/gm, '<p style="font-weight:700;font-size:14px;margin-top:8px;margin-bottom:4px;">$1</p>')
    .replace(/^- (.+)$/gm, '<div style="display:flex;align-items:flex-start;gap:6px;"><span style="margin-top:6px;width:4px;height:4px;border-radius:50%;background:currentColor;flex-shrink:0;"></span><span>$1</span></div>')
    .replace(/\n{2,}/g, '<div style="height:8px;"></div>')
    .replace(/\n/g, '')
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
