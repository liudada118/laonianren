import React from 'react';
import InfoTooltip from './InfoTooltip';

function breakdownColor(score, max) {
  const pct = max > 0 ? score / max : 0;
  if (pct >= 0.8) return '#059669';
  if (pct >= 0.5) return '#D97706';
  return '#DC2626';
}

function scoreBand(score, maxScore) {
  const pct = maxScore > 0 ? score / maxScore : 0;
  if (pct >= 0.8) return { label: '表现较好', color: '#059669', bg: '#ECFDF5' };
  if (pct >= 0.6) return { label: '轻度关注', color: '#D97706', bg: '#FFFBEB' };
  if (pct >= 0.4) return { label: '中度关注', color: '#D97706', bg: '#FFF7ED' };
  return { label: '重点关注', color: '#DC2626', bg: '#FEF2F2' };
}

export function BasisNote() {
  // 依据说明已按客户要求移除（保留导出避免各报告 import 报错）
  return null;
}

export default function ReportSummaryCard({
  scoreResult,
  title = '评分概览',
  aiLoading = false,
  aiIntro = '',
  children,
}) {
  // 评分块（项目评分/等级/评分明细/描述）已按客户要求整体移除，报告只保留采集数据与图表
  return null;

  /* eslint-disable no-unreachable */
  if (!scoreResult) return null;

  const band = scoreBand(scoreResult.score, scoreResult.maxScore || 25);
  const redFlags = scoreResult.redFlags || [];
  const breakdown = Array.isArray(scoreResult.breakdown) ? scoreResult.breakdown : [];

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
                {scoreResult.summary}
              </p>
            </div>
          </div>


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
