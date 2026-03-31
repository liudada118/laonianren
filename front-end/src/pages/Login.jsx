import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAssessment } from '../contexts/AssessmentContext';
import { fetchLlmConfig } from '../lib/gripPythonApi';

export default function Login() {
  const [secretKey, setSecretKey] = useState('');
  const [institution, setInstitution] = useState('');
  const [llmApiKey, setLlmApiKey] = useState('');
  const [showLlmApiKey, setShowLlmApiKey] = useState(false);
  const { login } = useAssessment();
  const navigate = useNavigate();
  const [currentVersion, setCurrentVersion] = useState('2.0.0');

  useEffect(() => {
    // 从 Electron 获取实际版本号
    if (window.electronAPI && window.electronAPI.getAppVersion) {
      window.electronAPI.getAppVersion().then(info => {
        if (info && info.version) setCurrentVersion(info.version);
      }).catch(() => {});
    }
  }, []);

  const handleCheckUpdate = () => {
    if (window.electronAPI && window.electronAPI.checkForUpdate) {
      window.electronAPI.checkForUpdate();
    }
  };

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const configRes = await fetchLlmConfig();
      if (cancelled || !configRes?.success || !configRes?.data) {
        return;
      }

      const serverApiKey = (configRes.data.api_key || '').trim();
      if (serverApiKey) {
        setLlmApiKey(serverApiKey);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const isValid = secretKey.trim().length > 0;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!isValid) return;
    login(secretKey.trim(), institution.trim(), llmApiKey.trim());
    navigate('/dashboard');
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center relative overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #F5F6F8 0%, #E8ECF0 50%, #F0F4F8 100%)' }}
    >
      <div
        className="absolute top-[-15%] right-[-8%] w-[500px] h-[500px] rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(0,102,204,0.04) 0%, transparent 70%)' }}
      />
      <div
        className="absolute bottom-[-10%] left-[-5%] w-[400px] h-[400px] rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(0,102,204,0.03) 0%, transparent 70%)' }}
      />

      <div className="z-10 animate-slideUp" style={{ width: 480, maxWidth: '90vw' }}>
        <div className="zeiss-card p-10" style={{ boxShadow: 'var(--shadow-xl)' }}>
          <div className="text-center mb-9">
            <img
              src="/logo1.png"
              alt="系统Logo"
              className="mx-auto mb-5"
              style={{ width: 64, height: 64, borderRadius: 14, objectFit: 'contain' }}
            />
            <p className="text-sm font-medium mb-1.5 tracking-wide" style={{ color: 'var(--text-tertiary)' }}>
              欢迎使用
            </p>
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              肌少症评估与监测系统
            </h1>
            <p className="text-xs mt-2.5 tracking-[0.2em]" style={{ color: 'var(--text-muted)' }}>
              SARCOPENIA ASSESSMENT & MONITORING SYSTEM
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-tertiary)' }}>
                系统密钥
              </label>
              <input
                type="text"
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
                placeholder="请输入系统登录密钥"
                className="zeiss-input"
                style={{ padding: '12px 16px' }}
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-tertiary)' }}>
                机构名称
              </label>
              <input
                type="text"
                value={institution}
                onChange={(e) => setInstitution(e.target.value)}
                placeholder="请输入机构名称（可选）"
                className="zeiss-input"
                style={{ padding: '12px 16px' }}
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-tertiary)' }}>
                大模型的API-key
              </label>
              <div className="relative">
                <input
                  type={showLlmApiKey ? 'text' : 'password'}
                  value={llmApiKey}
                  onChange={(e) => setLlmApiKey(e.target.value)}
                  placeholder="请输入调用大模型的API-key（非必填）"
                  className="zeiss-input pr-20"
                  style={{ padding: '12px 72px 12px 16px' }}
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-md"
                  style={{ color: 'var(--zeiss-blue)' }}
                  onClick={() => setShowLlmApiKey((prev) => !prev)}
                  aria-label={showLlmApiKey ? '隐藏 API key' : '显示 API key'}
                  title={showLlmApiKey ? '隐藏' : '显示'}
                >
                  {showLlmApiKey ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3l18 18" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.58 10.58A2 2 0 0012 14a2 2 0 001.42-.58" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.88 5.09A10.94 10.94 0 0112 4.91c5 0 9.27 3.11 11 7.5a11.67 11.67 0 01-4.29 5.37M6.61 6.61A11.65 11.65 0 001 12.41a11.66 11.66 0 004.29 5.37A10.94 10.94 0 0012 20.09c1.76 0 3.42-.41 4.91-1.09" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
                      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth={2} />
                    </svg>
                  )}
                </button>
              </div>
            </div>

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

        <div className="flex justify-between items-center mt-5 px-1">
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>powered by 矩侨工业</span>
          <div className="flex items-center gap-2">
            {window.electronAPI && window.electronAPI.checkForUpdate && (
              <button
                onClick={handleCheckUpdate}
                className="text-xs px-2 py-0.5 rounded-md transition-colors duration-150"
                style={{ color: 'var(--zeiss-blue)', background: 'transparent' }}
                onMouseEnter={e => e.target.style.background = 'var(--zeiss-blue-light)'}
                onMouseLeave={e => e.target.style.background = 'transparent'}
              >
                检查更新
              </button>
            )}
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>v{currentVersion}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
