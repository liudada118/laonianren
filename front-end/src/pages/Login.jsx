import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAssessment } from '../contexts/AssessmentContext';

export default function Login() {
  const [secretKey, setSecretKey] = useState('');
  const [institution, setInstitution] = useState('');
  const { login } = useAssessment();
  const navigate = useNavigate();

  const isValid = secretKey.trim().length > 0;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!isValid) return;
    login(secretKey.trim(), institution.trim());
    navigate('/dashboard');
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #F5F6F8 0%, #E8ECF0 50%, #F0F4F8 100%)' }}>

      {/* 微妙的装饰圆 */}
      <div className="absolute top-[-15%] right-[-8%] w-[500px] h-[500px] rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(0,102,204,0.04) 0%, transparent 70%)' }} />
      <div className="absolute bottom-[-10%] left-[-5%] w-[400px] h-[400px] rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(0,102,204,0.03) 0%, transparent 70%)' }} />

      {/* 主卡片 */}
      <div className="z-10 animate-slideUp" style={{ width: 480, maxWidth: '90vw' }}>
        <div className="zeiss-card p-10" style={{ boxShadow: 'var(--shadow-xl)' }}>
          {/* Logo */}
          <div className="text-center mb-9">
            <img
              src="/logo1.png"
              alt="矩侨工业"
              className="mx-auto mb-5"
              style={{ width: 64, height: 64, borderRadius: 14, objectFit: 'contain' }}
            />
            <p className="text-sm font-medium mb-1.5 tracking-wide" style={{ color: 'var(--text-tertiary)' }}>欢迎使用</p>
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              肌少症/老年人评估及监测系统
            </h1>
            <p className="text-xs mt-2.5 tracking-[0.2em]" style={{ color: 'var(--text-muted)' }}>
              SARCOPENIA ASSESSMENT & MONITORING SYSTEM
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* 密钥 */}
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-tertiary)' }}>密钥</label>
              <div className="relative">
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }}>
                  <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                  </svg>
                </div>
                <input
                  type="text"
                  value={secretKey}
                  onChange={(e) => setSecretKey(e.target.value)}
                  placeholder="请输入密钥"
                  className="zeiss-input pl-11"
                  style={{ padding: '12px 16px 12px 44px' }}
                />
              </div>
            </div>

            {/* 机构 */}
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-tertiary)' }}>机构名称</label>
              <div className="relative">
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }}>
                  <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                </div>
                <input
                  type="text"
                  value={institution}
                  onChange={(e) => setInstitution(e.target.value)}
                  placeholder="请输入机构名称（非必填）"
                  className="zeiss-input pl-11"
                  style={{ padding: '12px 16px 12px 44px' }}
                />
              </div>
            </div>

            {/* 提交 */}
            <button
              type="submit"
              disabled={!isValid}
              className="w-full py-3.5 rounded-[10px] font-semibold text-[15px] transition-all duration-200 mt-2"
              style={{
                background: isValid ? 'var(--zeiss-blue)' : '#E8ECF0',
                color: isValid ? 'white' : 'var(--text-muted)',
                cursor: isValid ? 'pointer' : 'not-allowed',
                boxShadow: isValid ? '0 4px 14px rgba(0,102,204,0.25)' : 'none',
                border: 'none',
              }}
            >
              进入系统
            </button>
          </form>
        </div>

        {/* 底部信息 */}
        <div className="flex justify-between items-center mt-5 px-1">
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>powered by 矩侨工业</span>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>v2.0.0</span>
        </div>
      </div>
    </div>
  );
}
