import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getRecord } from '../lib/historyService';
import GripReport from '../components/report/GripReport';
import StandingReport from '../components/report/StandingReport';
import SitStandReport from '../components/report/SitStandReport';
import { GaitReportContent } from './assessment/GaitAssessment';

const TYPE_LABELS = {
  grip: '握力评估',
  sitstand: '起坐能力评估',
  standing: '静态站立评估',
  gait: '行走步态评估',
};


/* ─── 历史报告查看页面 ─── */
export default function HistoryReportView() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const recordId = searchParams.get('id');
  const assessmentType = searchParams.get('type');

  // 从后端数据库获取记录
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(true);

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

  const patientName = record?.patientName || '未知';
  const patientInfo = record ? {
    name: record.patientName,
    gender: record.patientGender,
    age: record.patientAge,
    weight: record.patientWeight,
  } : { name: '未知' };

  // 从历史记录中提取报告数据
  const assessmentData = record?.assessments?.[assessmentType];
  const reportData = assessmentData?.report?.reportData || null;

  const handleBack = () => navigate('/history');

  const renderReport = () => {
    if (loading) {
      return (
        <div className="flex-1 flex items-center justify-center">
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
        <div className="flex-1 flex items-center justify-center">
          <p style={{ color: 'var(--text-muted)' }}>未找到对应的记录</p>
        </div>
      );
    }

    if (!reportData) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <svg className="w-12 h-12 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'var(--text-muted)' }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>该评估记录没有保存报告数据</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>请重新进行评估以生成完整报告</p>
          </div>
        </div>
      );
    }

    switch (assessmentType) {
      case 'grip':
        return <GripReport patientName={patientName} onClose={handleBack} reportData={reportData} />;
      case 'standing':
        return <StandingReport patientInfo={patientInfo} onClose={handleBack} reportData={reportData} />;
      case 'sitstand':
        return <SitStandReport patientInfo={patientInfo} reportData={reportData} />;
      case 'gait':
        return <GaitReportContent patientInfo={patientInfo} reportData={reportData} />;
      default:
        return (
          <div className="flex-1 flex items-center justify-center">
            <p style={{ color: 'var(--text-muted)' }}>未找到对应的报告数据</p>
          </div>
        );
    }
  };

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
            {patientName} 的{TYPE_LABELS[assessmentType] || '评估'}报告
          </h1>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs px-3 py-1 rounded-full" style={{ background: 'var(--zeiss-blue-light)', color: 'var(--zeiss-blue)' }}>
            历史记录
          </span>
          {record?.dateStr && (
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{record.dateStr}</span>
          )}
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
        {renderReport()}
      </main>

      <div className="h-6 flex items-center px-6 shrink-0 z-10">
        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>powered by 矩侨工业</span>
      </div>
    </div>
  );
}
