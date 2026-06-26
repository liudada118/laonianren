import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAssessment } from '../contexts/AssessmentContext';
import { backendBridge } from '../lib/BackendBridge';

export default function Login() {
  const [secretKey, setSecretKey] = useState('');
  const [institution, setInstitution] = useState('');
  const { login } = useAssessment();
  const navigate = useNavigate();
  const location = useLocation();
  const editMode = location.state?.editMode === true;
  const [currentVersion, setCurrentVersion] = useState('2.0.0');
  // loading: 正在检查缓存, ready: 显示表单, auto: 自动登录中
  const [pageState, setPageState] = useState(editMode ? 'loading-edit' : 'loading');
  const autoLoginDone = useRef(false);

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

  // 启动时从后端读取 serial.txt 缓存
  useEffect(() => {
    if (autoLoginDone.current) return;
    let cancelled = false;

    (async () => {
      try {
        // 获取 serial.txt 缓存
        const cacheRes = await fetch(`${backendBridge.httpUrl}/serialCache`)
          .then(r => r.json())
          .catch(() => null);

        if (cancelled) return;

        if (cacheRes && cacheRes.code === 0 && cacheRes.data && cacheRes.data.hasCache) {
          const cached = cacheRes.data;
          const cachedKey = cached.key || '';
          const cachedOrg = cached.orgName || '';

          setSecretKey(cachedKey);
          setInstitution(cachedOrg);

          if (editMode) {
            // 编辑模式：预填数据，显示表单让用户修改
            setPageState('ready');
          } else {
            // 有缓存，自动登录
            autoLoginDone.current = true;
            setPageState('auto');
            setTimeout(() => {
              if (!cancelled) {
                login(cachedKey, cachedOrg);
                navigate('/dashboard');
              }
            }, 600);
          }
        } else {
          // 无缓存，显示表单
          setPageState('ready');
        }
      } catch {
        setPageState('ready');
      }
    })();

    return () => { cancelled = true; };
  }, [login, navigate, editMode]);

  const isValid = secretKey.trim().length > 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isValid) return;

    const trimmedKey = secretKey.trim();
    const trimmedOrg = institution.trim();

    // 保存到 serial.txt
    try {
      await fetch(`${backendBridge.httpUrl}/serialCache`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: trimmedKey, orgName: trimmedOrg }),
      });
    } catch {
      // 保存失败不阻塞登录
    }

    login(trimmedKey, trimmedOrg);
    navigate('/dashboard');
  };

  // 加载中 / 自动登录中
  if (pageState === 'loading' || pageState === 'loading-edit' || pageState === 'auto') {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: 'linear-gradient(135deg, #F5F6F8 0%, #E8ECF0 50%, #F0F4F8 100%)' }}
      >
        <div className="text-center animate-slideUp">
          <img
            src="/logo1.png"
            alt="系统Logo"
            className="mx-auto mb-5"
            style={{ width: 64, height: 64, borderRadius: 14, objectFit: 'contain' }}
          />
          <p className="text-sm font-medium" style={{ color: 'var(--text-tertiary)' }}>
            {pageState === 'auto' ? '正在自动登录...' : pageState === 'loading-edit' ? '正在加载配置...' : '正在检查登录信息...'}
          </p>
        </div>
      </div>
    );
  }

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
              {editMode ? '修改系统配置' : '欢迎使用'}
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
              {editMode ? '保存并返回' : '进入系统'}
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
