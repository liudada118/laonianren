import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getRecord } from '../lib/historyService';
import { backendBridge } from '../lib/BackendBridge';
import { exportAssessmentWorkbook } from '../lib/assessmentWorkbookExport';
import ComprehensiveReport from '../components/report/ComprehensiveReport';

/**
 * 历史综合报告查看页面
 * 路由: /history/comprehensive?id=xxx
 */
export default function HistoryComprehensiveView() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const recordId = searchParams.get('id');

  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!recordId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    getRecord(recordId).then(data => {
      if (!cancelled) {
        setRecord(data);
        setLoading(false);
      }
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [recordId]);

  const handleBack = () => navigate('/history');
  const patientName = record?.patientName || '未知';

  const handleExportWorkbook = async () => {
    if (!record || exporting) return;
    setExporting(true);
    try {
      const result = await exportAssessmentWorkbook(record, backendBridge);
      if (result.skipped.length) {
        alert(`已导出 ${result.exported} 个项目。未导出：${result.skipped.join('、')}`);
      }
    } catch (error) {
      console.error('导出四项评估数据失败:', error);
      alert('导出失败: ' + (error?.message || '未知错误'));
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
        <div className="text-center">
          <div className="w-8 h-8 border-2 rounded-full animate-spin mb-4 mx-auto"
            style={{ borderColor: 'var(--border-light)', borderTopColor: 'var(--zeiss-blue)' }} />
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>加载中...</p>
        </div>
      </div>
    );
  }

  if (!record) {
    return (
      <div className="h-screen w-screen flex items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
        <div className="text-center">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>未找到对应的记录</p>
          <button onClick={handleBack} className="mt-4 px-4 py-2 rounded-lg text-sm text-white" style={{ background: 'var(--zeiss-blue)' }}>返回历史记录</button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
      {/* Header */}
      <header className="h-14 flex items-center justify-between px-6 shrink-0 z-20"
        style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-light)', boxShadow: 'var(--shadow-xs)' }}>
        <div className="flex items-center gap-3">
          <button onClick={handleBack} className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <img src="/logo1.png" alt="Logo" className="w-8 h-8 rounded-lg" />
          <h1 className="text-[15px] font-bold" style={{ color: 'var(--text-primary)' }}>
            {patientName} 的综合评估报告
          </h1>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs px-3 py-1 rounded-full font-semibold" style={{ background: 'linear-gradient(135deg, #E8F2FF, #DBEAFE)', color: 'var(--zeiss-blue)' }}>
            综合报告
          </span>
          {record?.dateStr && (
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{record.dateStr}</span>
          )}
          <button
            onClick={handleExportWorkbook}
            disabled={exporting}
            className="text-xs flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-all"
            style={{ color: '#059669', background: '#ECFDF5', border: '1px solid #05966930', opacity: exporting ? 0.6 : 1, cursor: exporting ? 'not-allowed' : 'pointer' }}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            {exporting ? '导出中...' : '导出四项数据'}
          </button>
          <button onClick={handleBack} className="zeiss-btn-ghost text-xs flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 17l-5-5m0 0l5-5m-5 5h12" />
            </svg>
            返回历史记录
          </button>
        </div>
      </header>

      {/* Report Content */}
      <main className="flex-1 min-h-0 overflow-hidden">
        <ComprehensiveReport record={record} onClose={handleBack} />
      </main>

      <div className="h-6 flex items-center px-6 shrink-0 z-10">
        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>powered by 矩侨工业</span>
      </div>
    </div>
  );
}
