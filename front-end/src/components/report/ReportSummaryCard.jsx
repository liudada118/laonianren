import React from 'react';

function scoreBand(score, maxScore) {
  const pct = maxScore > 0 ? score / maxScore : 0;
  if (pct >= 0.8) return { label: '表现较好', color: '#059669', bg: '#ECFDF5' };
  if (pct >= 0.6) return { label: '轻度关注', color: '#D97706', bg: '#FFFBEB' };
  if (pct >= 0.4) return { label: '中度关注', color: '#D97706', bg: '#FFF7ED' };
  return { label: '重点关注', color: '#DC2626', bg: '#FEF2F2' };
}

export function BasisNote({ className = '' }) {
  return (
    <p className={`text-[10px] leading-relaxed ${className}`} style={{ color: 'var(--text-muted)' }}>
      依据说明：本报告依据《亚洲肌少症工作组（AWGS）2019 共识》及《社区老年人肌肉减少症筛查专家共识》构建早筛路径；握力、步速、5次坐站等阈值用于功能风险提示，静态站立结合 CDC STEADI、SPPB 和本设备压力/COP轨迹长度指标，不作为疾病诊断。
    </p>
  );
}

export default function ReportSummaryCard({
  scoreResult,
  title = '评分概览',
  aiLoading = false,
  aiIntro = '',
  children,
}) {
  if (!scoreResult) return null;

  const band = scoreBand(scoreResult.score, scoreResult.maxScore || 25);
  const indicators = scoreResult.indicators || [];
  const redFlags = scoreResult.redFlags || [];

  return (
    <section className="zeiss-card p-5" style={{ borderTop: `3px solid ${scoreResult.color || band.color}` }}>
      <div className="flex flex-col lg:flex-row gap-5 lg:items-stretch">
        <div className="shrink-0 w-full lg:w-48 rounded-lg p-4 flex lg:flex-col items-center justify-between lg:justify-center"
          style={{ background: scoreResult.bg || band.bg, border: `1px solid ${(scoreResult.color || band.color)}22` }}>
          <div>
            <div className="text-xs font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>{title}</div>
            <div className="text-4xl font-black tabular-nums" style={{ color: scoreResult.color || band.color }}>
              {scoreResult.score}
              <span className="text-base font-bold ml-1">/{scoreResult.maxScore || 25}</span>
            </div>
          </div>
          <div className="px-3 py-1 rounded-full text-xs font-bold mt-0 lg:mt-3"
            style={{ background: '#FFFFFFAA', color: scoreResult.color || band.color }}>
            {scoreResult.level || band.label}
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div>
              <h3 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>
                {scoreResult.title || title}
              </h3>
              <p className="text-sm leading-relaxed mt-1" style={{ color: 'var(--text-secondary)' }}>
                {aiIntro || scoreResult.summary}
              </p>
            </div>
            {aiLoading && (
              <div className="hidden md:flex items-center gap-2 text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>
                <span className="w-3 h-3 rounded-full border-2 animate-spin" style={{ borderColor: 'var(--border-light)', borderTopColor: 'var(--zeiss-blue)' }} />
                AI综合评估生成中
              </div>
            )}
          </div>

          {indicators.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
              {indicators.map((item, index) => (
                <div key={`${item.label}-${index}`} className="rounded-lg px-3 py-2" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-light)' }}>
                  <div className="text-[10px] mb-0.5" style={{ color: 'var(--text-muted)' }}>{item.label}</div>
                  <div className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{item.value}</div>
                </div>
              ))}
            </div>
          )}

          {redFlags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {redFlags.slice(0, 4).map((flag, index) => (
                <span key={`${flag}-${index}`} className="px-2.5 py-1 rounded-full text-[11px] font-medium"
                  style={{ background: '#FEF2F2', color: '#B91C1C', border: '1px solid #FECACA' }}>
                  {flag}
                </span>
              ))}
            </div>
          )}

          {children}
        </div>
      </div>
    </section>
  );
}
