import React, { useState } from 'react';

export default function ReportViewer({ 
  patientName, 
  assessmentType, 
  staticReportUrl, 
  dynamicReportUrl,
  onClose,
  rightPanel
}) {
  const [mode, setMode] = useState('static');

  const TYPE_NAMES = {
    grip: '握力评估',
    sitstand: '起坐能力评估',
    standing: '静态站立评估',
    gait: '行走步态评估'
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col" style={{ background: 'var(--bg-primary)' }}>
      {/* 顶部信息栏 */}
      <div className="h-14 flex items-center justify-between px-6 shrink-0"
        style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-light)', boxShadow: 'var(--shadow-xs)' }}>
        <div />
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
            {patientName}的{TYPE_NAMES[assessmentType] || '评估'}{mode === 'static' ? '静态' : '动态'}报告
          </h2>
          <div className="flex items-center gap-1 p-1 rounded-lg" style={{ background: 'var(--bg-tertiary)' }}>
            <button onClick={() => setMode('static')}
              className={`px-4 py-1.5 text-xs rounded-md transition-all font-medium ${mode === 'static' ? 'zeiss-btn-primary' : ''}`}
              style={mode !== 'static' ? { color: 'var(--text-muted)', background: 'transparent' } : { padding: '6px 16px', fontSize: '12px' }}>
              静态报告
            </button>
            <button onClick={() => setMode('dynamic')}
              className={`px-4 py-1.5 text-xs rounded-md transition-all font-medium ${mode === 'dynamic' ? 'zeiss-btn-primary' : ''}`}
              style={mode !== 'dynamic' ? { color: 'var(--text-muted)', background: 'transparent' } : { padding: '6px 16px', fontSize: '12px' }}>
              动态报告
            </button>
          </div>
        </div>
        <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
          style={{ color: 'var(--text-muted)' }}>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* 报告内容 */}
      <div className="flex-1 flex overflow-hidden">
        {mode === 'static' ? (
          <div className="flex-1 m-4 zeiss-card overflow-hidden">
            <iframe
              src={staticReportUrl || '/assets/grip_report.pdf'}
              className="w-full h-full border-0"
              title="静态报告"
            />
          </div>
        ) : (
          <div className="flex-1 flex">
            <div className="flex-1 flex flex-col items-center justify-center m-4 model-container rounded-xl relative">
              <div className="flex-1 w-full flex items-center justify-center">
                <video
                  src={dynamicReportUrl || '/assets/dynamic_report.mp4'}
                  controls
                  className="max-w-full max-h-full rounded-lg"
                  style={{ maxHeight: '70vh', boxShadow: 'var(--shadow-lg)' }}
                >
                  您的浏览器不支持视频播放
                </video>
              </div>
            </div>
            {rightPanel && (
              <div className="w-80 flex flex-col gap-3 p-4 overflow-y-auto">
                {rightPanel}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="h-8 flex items-center px-6 shrink-0">
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>powered by 矩侨工业</span>
      </div>
    </div>
  );
}
