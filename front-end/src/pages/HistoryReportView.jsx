import React, { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getHistory } from '../lib/historyService';
import GripReport from '../components/report/GripReport';
import StandingReport from '../components/report/StandingReport';

const TYPE_LABELS = {
  grip: '握力评估',
  sitstand: '起坐能力评估',
  standing: '静态站立评估',
  gait: '行走步态评估',
};

/* ─── 起坐能力评估简易报告 ─── */
function SitStandReportView({ patientName }) {
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="zeiss-section-title">起坐能力评估报告</div>
        <div className="zeiss-card p-6">
          <h3 className="text-base font-bold mb-4" style={{ color: 'var(--text-primary)' }}>基本信息</h3>
          <div className="grid grid-cols-4 gap-4">
            {[
              { l: '评估对象', v: patientName },
              { l: '评估类型', v: '5次起坐测试' },
              { l: '评估时间', v: new Date().toLocaleString('zh-CN') },
              { l: '总耗时', v: '12.5s' },
            ].map((item, i) => (
              <div key={i} className="zeiss-card-inner p-4 text-center">
                <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>{item.l}</div>
                <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{item.v}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="zeiss-card p-6">
          <h3 className="text-base font-bold mb-4" style={{ color: 'var(--text-primary)' }}>起坐分析结果</h3>
          <div className="grid grid-cols-3 gap-4">
            {[
              { l: '平均单次耗时', v: '2.50s', color: 'var(--zeiss-blue)' },
              { l: '最快单次耗时', v: '2.10s', color: 'var(--success)' },
              { l: '最慢单次耗时', v: '3.05s', color: 'var(--warning)' },
              { l: '左右对称性', v: '92.3%', color: 'var(--zeiss-blue)' },
              { l: '稳定性评分', v: '85.6', color: 'var(--success)' },
              { l: '综合评级', v: '良好', color: 'var(--success)' },
            ].map((item, i) => (
              <div key={i} className="zeiss-card-inner p-4 text-center">
                <div className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>{item.l}</div>
                <div className="text-xl font-bold" style={{ color: item.color }}>{item.v}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="zeiss-card p-6">
          <h3 className="text-base font-bold mb-4" style={{ color: 'var(--text-primary)' }}>评估结论</h3>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            受试者完成5次起坐测试，总耗时12.5秒，平均单次耗时2.50秒。起坐过程中左右对称性良好（92.3%），
            稳定性评分85.6分。根据国际肌少症工作组(EWGSOP2)标准，5次起坐测试时间小于15秒为正常范围，
            该受试者表现良好，起坐能力正常。
          </p>
        </div>
      </div>
    </div>
  );
}

/* ─── 步态评估简易报告 ─── */
function GaitReportView({ patientName }) {
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="zeiss-section-title">行走步态评估报告</div>
        <div className="zeiss-card p-6">
          <h3 className="text-base font-bold mb-4" style={{ color: 'var(--text-primary)' }}>基本信息</h3>
          <div className="grid grid-cols-4 gap-4">
            {[
              { l: '评估对象', v: patientName },
              { l: '评估类型', v: '6米步行测试' },
              { l: '评估时间', v: new Date().toLocaleString('zh-CN') },
              { l: '行走距离', v: '6.0m' },
            ].map((item, i) => (
              <div key={i} className="zeiss-card-inner p-4 text-center">
                <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>{item.l}</div>
                <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{item.v}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="zeiss-card p-6">
          <h3 className="text-base font-bold mb-4" style={{ color: 'var(--text-primary)' }}>步态参数</h3>
          <div className="grid grid-cols-3 gap-4">
            {[
              { l: '步速', v: '1.12 m/s', color: 'var(--zeiss-blue)' },
              { l: '步频', v: '108 步/分', color: 'var(--success)' },
              { l: '步幅', v: '62.3 cm', color: 'var(--warning)' },
              { l: '左右步长比', v: '0.97', color: 'var(--zeiss-blue)' },
              { l: '步态周期', v: '1.11s', color: 'var(--success)' },
              { l: '双支撑相', v: '22.5%', color: '#7C3AED' },
            ].map((item, i) => (
              <div key={i} className="zeiss-card-inner p-4 text-center">
                <div className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>{item.l}</div>
                <div className="text-xl font-bold" style={{ color: item.color }}>{item.v}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="zeiss-card p-6">
          <h3 className="text-base font-bold mb-4" style={{ color: 'var(--text-primary)' }}>评估结论</h3>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            受试者完成6米步行测试，步速1.12m/s，步频108步/分钟，步幅62.3cm。根据EWGSOP2标准，
            步速大于0.8m/s为正常范围。受试者步态参数均在正常范围内，左右步长比接近1.0，
            表明步态对称性良好。双支撑相占比22.5%，处于正常范围（20%-30%），平衡能力正常。
          </p>
        </div>
      </div>
    </div>
  );
}

/* ─── 历史报告查看页面 ─── */
export default function HistoryReportView() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const recordId = searchParams.get('id');
  const assessmentType = searchParams.get('type');

  // 从 localStorage 获取记录
  const record = useMemo(() => {
    const history = getHistory();
    return history.find(r => r.id === recordId);
  }, [recordId]);

  const patientName = record?.patientName || '未知';

  const handleBack = () => navigate('/history');

  const renderReport = () => {
    switch (assessmentType) {
      case 'grip':
        return <GripReport patientName={patientName} onClose={handleBack} />;
      case 'standing':
        return <StandingReport patientInfo={{ name: patientName }} onClose={handleBack} />;
      case 'sitstand':
        return <SitStandReportView patientName={patientName} />;
      case 'gait':
        return <GaitReportView patientName={patientName} />;
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
