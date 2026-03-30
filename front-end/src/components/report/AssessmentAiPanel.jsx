import React from 'react';

function getLevelStyle(levelText = '') {
  if (/(优秀|正常|良好)/.test(levelText)) {
    return { background: '#ECFDF5', color: '#059669' };
  }
  if (/(偏慢|偏低|需关注|一般)/.test(levelText)) {
    return { background: '#FFFBEB', color: '#D97706' };
  }
  return { background: '#FEF2F2', color: '#DC2626' };
}

export default function AssessmentAiPanel({
  aiLoading,
  aiError,
  aiReport,
  sections = [],
  loadingText = 'AI 正在分析评估数据...',
  emptyText = '暂无 AI 分析数据',
}) {
  if (aiLoading) {
    return (
      <div className="py-4">
        <div className="flex items-center gap-3 mb-3">
          <svg className="w-4 h-4 animate-spin" style={{ color: 'var(--zeiss-blue)' }} fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{loadingText}</span>
        </div>
      </div>
    );
  }

  if (aiError) {
    return (
      <div className="text-center py-6">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>AI 分析暂不可用</p>
        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{aiError}</p>
      </div>
    );
  }

  if (!aiReport) {
    return (
      <div className="text-center py-6">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{emptyText}</p>
      </div>
    );
  }

  const visibleSections = sections.filter(section => aiReport[section.key]);

  return (
    <>
      {aiReport.eval_level && (
        <div className="flex items-center gap-3 mb-5 pb-4" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <div
            className="px-4 py-2 rounded-lg text-sm font-bold"
            style={getLevelStyle(aiReport.eval_level.text)}
          >
            评估等级: {aiReport.eval_level.text}
          </div>
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {aiReport.eval_level.standard}
          </div>
        </div>
      )}

      <div className="space-y-3">
        {aiReport.data_quality && !aiReport.data_quality.is_valid && (
          <div className="p-4 rounded-lg" style={{ background: '#FEF2F2', border: '1px solid #FECACA' }}>
            <h5 className="text-xs font-bold mb-2 flex items-center gap-1.5" style={{ color: '#DC2626' }}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              数据质量提醒
            </h5>
            {Array.isArray(aiReport.data_quality.issues) && aiReport.data_quality.issues.length > 0 && (
              <ul className="text-sm leading-relaxed mb-2 space-y-1" style={{ color: '#991B1B' }}>
                {aiReport.data_quality.issues.map((issue, index) => (
                  <li key={index} className="flex items-start gap-1.5">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: '#DC2626' }} />
                    {issue}
                  </li>
                ))}
              </ul>
            )}
            {aiReport.data_quality.suggestion && (
              <p className="text-sm font-medium" style={{ color: '#B91C1C' }}>
                {aiReport.data_quality.suggestion}
              </p>
            )}
          </div>
        )}

        {visibleSections.map(section => (
          <div key={section.key} className="p-4 rounded-lg" style={{ background: 'var(--bg-hover, #f8f9fa)' }}>
            <h5 className="text-xs font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
              {section.label}
            </h5>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              {aiReport[section.key]}
            </p>
          </div>
        ))}

        {aiReport.disclaimer && (
          <div className="text-center pt-3">
            <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
              {aiReport.disclaimer}
            </p>
          </div>
        )}
      </div>
    </>
  );
}
