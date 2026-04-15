import React, { useState, useEffect, useRef } from 'react'

/**
 * 版本历史记录组件
 * 紫色按钮悬浮在右下角（更新按钮上方），点击展示硬编码的所有历史版本更新记录
 */

const VERSION_HISTORY = [
  {
    version: '1.0.1',
    date: '2026-04-14',
    highlights: [
      '修复 Windows 打包后 @mapbox/node-pre-gyp 模块缺失',
      '修复脚垫 MAC 映射与 serial.txt 识别链路',
      '修复 serial.txt 登录缓存与 MAC 映射覆盖问题',
      '修复设置页保存后 serial.txt 未同步更新',
      '简化 MAC 映射格式为 MAC:foot1,MAC:foot2,...',
      '前端"系统密钥"改为"设备映射"',
      'Windows 安装器改为向导模式，支持自定义安装目录',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-03-24',
    highlights: [
      '首个正式发布版本',
      '支持握力、起坐、静态站立、步态四种评估模式',
      '串口设备自动识别与连接',
      '3D 脚垫压力可视化',
      '评估报告生成与导出',
      '在线自动更新功能',
    ],
  },
]

export { VERSION_HISTORY }

export default function VersionHistory() {
  const [showDialog, setShowDialog] = useState(false)
  const [appVersion, setAppVersion] = useState('')
  const dialogRef = useRef(null)

  useEffect(() => {
    if (window.electronAPI && window.electronAPI.getAppVersion) {
      window.electronAPI.getAppVersion().then(info => {
        if (info && info.version) setAppVersion(info.version)
      }).catch(() => {})
    }
  }, [])

  // 点击遮罩关闭
  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) setShowDialog(false)
  }

  return (
    <>
      {/* 紫色历史按钮 - 固定在右下角，更新按钮上方 */}
      <button
        onClick={() => setShowDialog(true)}
        className="fixed z-[100] flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-medium transition-all duration-200 shadow-lg"
        style={{
          right: 20,
          bottom: 68,
          background: 'linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%)',
          color: 'white',
          boxShadow: '0 4px 14px rgba(124,58,237,0.35)',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.transform = 'scale(1.05)'
          e.currentTarget.style.boxShadow = '0 6px 20px rgba(124,58,237,0.45)'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.transform = 'scale(1)'
          e.currentTarget.style.boxShadow = '0 4px 14px rgba(124,58,237,0.35)'
        }}
        title="版本历史"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>历史版本</span>
      </button>

      {/* 版本历史弹窗 */}
      {showDialog && (
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center"
          onClick={handleBackdropClick}
        >
          {/* 遮罩 */}
          <div
            className="fixed inset-0 animate-fadeIn"
            style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}
            onClick={() => setShowDialog(false)}
          />

          {/* 弹窗内容 */}
          <div
            ref={dialogRef}
            className="relative z-10 w-[520px] max-w-[90vw] max-h-[80vh] rounded-2xl animate-scaleIn flex flex-col"
            style={{
              background: 'var(--bg-secondary)',
              boxShadow: 'var(--shadow-xl)',
            }}
          >
            {/* 标题栏 */}
            <div className="flex items-center justify-between p-6 pb-4 border-b" style={{ borderColor: 'var(--border-light)' }}>
              <div className="flex items-center gap-3">
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{ background: 'linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%)' }}
                >
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>版本历史</h3>
                  {appVersion && (
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      当前版本: v{appVersion}
                    </p>
                  )}
                </div>
              </div>
              <button
                onClick={() => setShowDialog(false)}
                className="p-1.5 rounded-lg transition-colors duration-150"
                style={{ color: 'var(--text-muted)' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* 版本列表 - 可滚动 */}
            <div className="flex-1 overflow-y-auto p-6 pt-4 space-y-5">
              {VERSION_HISTORY.map((release, idx) => {
                const isCurrent = appVersion && release.version === appVersion
                return (
                  <div key={release.version} className="relative">
                    {/* 时间线连接线 */}
                    {idx < VERSION_HISTORY.length - 1 && (
                      <div
                        className="absolute left-[15px] top-[36px] bottom-[-20px] w-[2px]"
                        style={{ background: 'var(--border-light)' }}
                      />
                    )}

                    <div className="flex gap-4">
                      {/* 时间线圆点 */}
                      <div className="flex-shrink-0 mt-1">
                        <div
                          className="w-[30px] h-[30px] rounded-full flex items-center justify-center"
                          style={{
                            background: isCurrent
                              ? 'linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%)'
                              : 'var(--bg-primary)',
                            border: isCurrent ? 'none' : '2px solid var(--border-light)',
                          }}
                        >
                          {isCurrent ? (
                            <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                            </svg>
                          ) : (
                            <div className="w-2 h-2 rounded-full" style={{ background: 'var(--text-muted)' }} />
                          )}
                        </div>
                      </div>

                      {/* 版本内容 */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                            v{release.version}
                          </span>
                          {isCurrent && (
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                              style={{
                                background: 'rgba(124,58,237,0.1)',
                                color: '#7C3AED',
                              }}
                            >
                              当前
                            </span>
                          )}
                          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                            {release.date}
                          </span>
                        </div>

                        <div
                          className="rounded-xl p-3 space-y-1"
                          style={{
                            background: 'var(--bg-primary)',
                            border: '1px solid var(--border-light)',
                          }}
                        >
                          {release.highlights.map((item, i) => (
                            <div key={i} className="flex items-start gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                              <span className="mt-1 flex-shrink-0 w-1 h-1 rounded-full" style={{ background: 'var(--text-muted)' }} />
                              <span>{item}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* 底部 */}
            <div className="p-4 pt-3 border-t flex justify-end" style={{ borderColor: 'var(--border-light)' }}>
              <button
                onClick={() => setShowDialog(false)}
                className="px-5 py-2 rounded-xl text-sm font-semibold transition-all duration-150"
                style={{
                  background: 'linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%)',
                  color: 'white',
                  boxShadow: '0 4px 14px rgba(124,58,237,0.25)',
                }}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
