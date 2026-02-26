import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAssessment } from '../../contexts/AssessmentContext';

const ASSESSMENT_TITLES = {
  grip: '1.握力评估',
  sitstand: '2.起坐能力评估',
  standing: '3.静态站立评估',
  gait: '4.行走步态评估'
};

export default function Header({ title, showHistory = true, steps, currentStep }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { patientInfo, institution } = useAssessment();

  const isAssessmentPage = location.pathname.includes('/assessment/');

  return (
    <header className="h-14 flex items-center justify-between px-6 shrink-0 relative z-50"
      style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-light)' }}>
      {/* 左侧标题 */}
      <div className="flex items-center gap-3">
        <img src="/logo1.png" alt="Logo" className="w-8 h-8 rounded-lg object-contain" />
        <h1 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>
          {title || '肌少症/老年人评估及监测系统'}
          {isAssessmentPage && ASSESSMENT_TITLES[location.pathname.split('/').pop()] && (
            <span className="ml-2" style={{ color: 'var(--text-muted)' }}>
              ——{ASSESSMENT_TITLES[location.pathname.split('/').pop()]}
            </span>
          )}
        </h1>
      </div>

      {/* 中间步骤指示器 */}
      {steps && steps.length > 0 && (
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2">
          {steps.map((step, idx) => (
            <React.Fragment key={idx}>
              {idx > 0 && (
                <div className={`zeiss-step-line ${idx <= currentStep ? 'completed' : ''}`} />
              )}
              <div className="flex flex-col items-center">
                <div className={`zeiss-step-circle ${idx < currentStep ? 'completed' : idx === currentStep ? 'active' : 'pending'}`}>
                  {idx < currentStep ? (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    idx + 1
                  )}
                </div>
                <span className="text-[10px] mt-0.5 font-medium"
                  style={{ color: idx <= currentStep ? 'var(--zeiss-blue)' : 'var(--text-muted)' }}>
                  {step}
                </span>
              </div>
            </React.Fragment>
          ))}
        </div>
      )}

      {/* 右侧信息 */}
      <div className="flex items-center gap-4">
        {patientInfo && (
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{patientInfo.name}</span>
        )}
        {institution && (
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{institution}</span>
        )}
        {showHistory && (
          <button onClick={() => navigate('/history')} className="zeiss-btn-ghost text-xs">
            历史记录
          </button>
        )}
      </div>
    </header>
  );
}
