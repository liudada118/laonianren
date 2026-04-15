import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAssessment } from '../contexts/AssessmentContext';
import { fetchLlmConfig } from '../lib/gripPythonApi';
import { backendBridge } from '../lib/BackendBridge';
import { VERSION_HISTORY } from '../components/ui/VersionHistory';

export default function Login() {
  const [deviceMapping, setDeviceMapping] = useState('');
  const [institution, setInstitution] = useState('');
  const [llmApiKey, setLlmApiKey] = useState('');
  const [showLlmApiKey, setShowLlmApiKey] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { login } = useAssessment();
  const navigate = useNavigate();
  const location = useLocation();
  const editMode = location.state?.editMode === true;
  const [currentVersion, setCurrentVersion] = useState('2.0.0');
  // loading: 正在检查缓存, ready: 显示表单, auto: 自动登录中
  const [pageState, setPageState] = useState(editMode ? 'loading-edit' : 'loading');
  const autoLoginDone = useRef(false);

  // 版本历史弹窗
  const [showVersionHistory, setShowVersionHistory] = useState(false);

  // 更新弹窗
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);
  const [updateState, setUpdateState] = useState({
    status: 'idle',       // idle | checking | available | downloading | downloaded | error | not-available
    message: '',
    version: '',
    percent: 0,
    releaseNotes: '',
    releaseDate: '',
    bytesPerSecond: 0,
  });

  const isElectron = typeof window !== 'undefined' && window.electronAPI && window.electronAPI.onUpdateStatus;

  useEffect(() => {
    // 从 Electron 获取实际版本号
    if (window.electronAPI && window.electronAPI.getAppVersion) {
      window.electronAPI.getAppVersion().then(info => {
        if (info && info.version) setCurrentVersion(info.version);
      }).catch(() => {});
    }
  }, []);

  // 监听更新事件
  useEffect(() => {
    if (!isElectron) return;

    const unsubscribe = window.electronAPI.onUpdateStatus((data) => {
      setUpdateState(prev => ({ ...prev, ...data }));

      if (data.status === 'available' || data.status === 'downloaded') {
        setShowUpdateDialog(true);
      }
    });

    return () => { if (unsubscribe) unsubscribe(); };
  }, [isElectron]);

  // 启动时从后端读取 serial.txt 缓存
  useEffect(() => {
    if (autoLoginDone.current) return;
    let cancelled = false;

    (async () => {
      try {
        // 同时获取 serial.txt 缓存和 LLM 配置
        const [cacheRes, configRes] = await Promise.all([
          fetch(`${backendBridge.httpUrl}/serialCache`).then(r => r.json()).catch(() => null),
          fetchLlmConfig().catch(() => null),
        ]);

        if (cancelled) return;

        // 从服务器获取 LLM API key 作为默认值
        const serverApiKey = configRes?.success && configRes?.data?.api_key
          ? configRes.data.api_key.trim()
          : '';

        if (cacheRes && cacheRes.code === 0 && cacheRes.data && cacheRes.data.hasCache) {
          const cached = cacheRes.data;
          const cachedKey = cached.key || '';
          const cachedOrg = cached.orgName || '';
          const cachedLlm = cached.llmApiKey || serverApiKey || '';

          setDeviceMapping(cachedKey);
          setInstitution(cachedOrg);
          setLlmApiKey(cachedLlm);

          if (editMode) {
            // 编辑模式：预填数据，显示表单让用户修改
            setPageState('ready');
          } else {
            // 有缓存，自动登录
            autoLoginDone.current = true;
            setPageState('auto');
            setTimeout(() => {
              if (!cancelled) {
                login(cachedKey, cachedOrg, cachedLlm);
                navigate('/dashboard');
              }
            }, 600);
          }
        } else {
          // 无缓存，显示表单
          if (serverApiKey) setLlmApiKey(serverApiKey);
          setPageState('ready');
        }
      } catch {
        setPageState('ready');
      }
    })();

    return () => { cancelled = true; };
  }, [login, navigate, editMode]);

  const isValid = deviceMapping.trim().length > 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isValid || submitting) return;

    const trimmedKey = deviceMapping.trim();
    const trimmedOrg = institution.trim();
    const trimmedLlm = llmApiKey.trim();
    setSubmitError('');
    setSubmitting(true);

    // 保存到 serial.txt
    try {
      const response = await fetch(`${backendBridge.httpUrl}/serialCache`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: trimmedKey, orgName: trimmedOrg, llmApiKey: trimmedLlm }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result || result.code !== 0) {
        throw new Error(result?.message || '保存 serial.txt 失败');
      }
    } catch (err) {
      setSubmitError(err?.message || '保存 serial.txt 失败，请检查文件权限后重试');
      setSubmitting(false);
      return;
    }

    login(trimmedKey, trimmedOrg, trimmedLlm);
    navigate('/dashboard');
  };

  // 检查更新
  const handleCheckUpdate = useCallback(async () => {
    if (!isElectron) return;
    setUpdateState(prev => ({ ...prev, status: 'checking', message: '正在检查更新...' }));
    setShowUpdateDialog(true);
    try {
      await window.electronAPI.checkForUpdate();
    } catch (err) {
      setUpdateState(prev => ({
        ...prev,
        status: 'error',
        message: '检查更新失败: ' + (err.message || '未知错误')
      }));
    }
  }, [isElectron]);

  const handleDownload = useCallback(async () => {
    if (!isElectron) return;
    try {
      await window.electronAPI.downloadUpdate();
    } catch (err) {
      setUpdateState(prev => ({
        ...prev,
        status: 'error',
        message: '下载更新失败: ' + (err.message || '未知错误')
      }));
    }
  }, [isElectron]);

  const handleInstall = useCallback(async () => {
    if (!isElectron) return;
    try {
      await window.electronAPI.installUpdate();
    } catch (err) {
      console.error('安装更新失败:', err);
    }
  }, [isElectron]);

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

  // 更新弹窗的状态图标
  const spinnerSvg = (
    <svg className="w-5 h-5 animate-spin" style={{ color: 'var(--zeiss-blue)' }} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
  const infoSvg = (
    <svg className="w-5 h-5" style={{ color: 'var(--zeiss-blue)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
  const successSvg = (
    <svg className="w-5 h-5" style={{ color: 'var(--success, #10B981)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );

  const statusConfig = {
    idle:           { icon: infoSvg, title: '软件更新' },
    checking:       { icon: spinnerSvg, title: '检查更新' },
    available:      { icon: infoSvg, title: '发现新版本' },
    downloading:    { icon: spinnerSvg, title: '正在下载' },
    downloaded:     { icon: successSvg, title: '下载完成' },
    error:          { icon: infoSvg, title: '更新失败' },
    'not-available': { icon: successSvg, title: '已是最新' },
  };

  const cfg = statusConfig[updateState.status] || statusConfig.idle;

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
                设备映射
              </label>
              <input
                type="text"
                value={deviceMapping}
                onChange={(e) => setDeviceMapping(e.target.value)}
                placeholder="MAC:foot1,MAC:foot2,MAC:foot3,MAC:foot4"
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

            {submitError && (
              <div
                className="rounded-lg px-3 py-2 text-sm"
                style={{
                  color: '#B42318',
                  background: '#FEF3F2',
                  border: '1px solid #FECACA',
                }}
              >
                {submitError}
              </div>
            )}

            <button
              type="submit"
              disabled={!isValid || submitting}
              className="w-full py-3.5 rounded-[10px] font-semibold text-[15px] transition-all duration-200 mt-2"
              style={{
                background: isValid && !submitting ? 'var(--zeiss-blue)' : '#E8ECF0',
                color: isValid && !submitting ? 'white' : 'var(--text-muted)',
                cursor: isValid && !submitting ? 'pointer' : 'not-allowed',
                boxShadow: isValid && !submitting ? '0 4px 14px rgba(0,102,204,0.25)' : 'none',
                border: 'none',
              }}
            >
              {editMode ? '保存并返回' : '进入系统'}
            </button>
          </form>
        </div>

        {/* 底部：左侧 powered by，右侧版本号（可点击）+ 检查更新 */}
        <div className="flex justify-between items-center mt-5 px-1">
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>powered by 矩侨工业</span>
          <div className="flex items-center gap-3">
            <span
              className="text-xs cursor-pointer transition-colors duration-150"
              style={{ color: 'var(--text-muted)' }}
              onClick={() => setShowVersionHistory(true)}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--text-secondary)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
              title="查看版本历史"
            >
              v{currentVersion}
            </span>
            {isElectron && (
              <>
                <span className="text-xs" style={{ color: 'var(--border-light)' }}>|</span>
                <span
                  className="text-xs cursor-pointer font-medium transition-opacity duration-150"
                  style={{ color: 'var(--zeiss-blue)' }}
                  onClick={handleCheckUpdate}
                  onMouseEnter={e => e.currentTarget.style.opacity = '0.7'}
                  onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                  title="检查软件更新"
                >
                  检查更新
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ===== 版本历史弹窗 ===== */}
      {showVersionHistory && (
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center"
          onClick={(e) => { if (e.target === e.currentTarget) setShowVersionHistory(false); }}
        >
          <div
            className="fixed inset-0 animate-fadeIn"
            style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}
            onClick={() => setShowVersionHistory(false)}
          />
          <div
            className="relative z-10 w-[520px] max-w-[90vw] max-h-[80vh] rounded-2xl animate-scaleIn flex flex-col"
            style={{ background: 'var(--bg-secondary)', boxShadow: 'var(--shadow-xl)' }}
          >
            {/* 标题栏 */}
            <div className="flex items-center justify-between p-6 pb-4 border-b" style={{ borderColor: 'var(--border-light)' }}>
              <div className="flex items-center gap-3">
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{ background: 'linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%)' }}
                >
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>版本历史</h3>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    当前版本: v{currentVersion}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowVersionHistory(false)}
                className="p-1.5 rounded-lg transition-colors duration-150"
                style={{ color: 'var(--text-muted)' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* 版本列表 */}
            <div className="flex-1 overflow-y-auto p-6 pt-4 space-y-5">
              {VERSION_HISTORY.map((release, idx) => {
                const isCurrent = release.version === currentVersion;
                return (
                  <div key={release.version} className="relative">
                    {idx < VERSION_HISTORY.length - 1 && (
                      <div
                        className="absolute left-[15px] top-[36px] bottom-[-20px] w-[2px]"
                        style={{ background: 'var(--border-light)' }}
                      />
                    )}
                    <div className="flex gap-4">
                      <div className="flex-shrink-0 mt-1">
                        <div
                          className="w-[30px] h-[30px] rounded-full flex items-center justify-center"
                          style={{
                            background: isCurrent
                              ? 'linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%)'
                              : 'var(--bg-primary)',
                            border: isCurrent ? 'none' : '2px solid var(--border-light)',
                          }}
                        >
                          {isCurrent ? (
                            <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                            </svg>
                          ) : (
                            <div className="w-2 h-2 rounded-full" style={{ background: 'var(--text-muted)' }} />
                          )}
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                            v{release.version}
                          </span>
                          {isCurrent && (
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                              style={{ background: 'rgba(124,58,237,0.1)', color: '#7C3AED' }}
                            >
                              当前
                            </span>
                          )}
                          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                            {release.date}
                          </span>
                        </div>
                        <div
                          className="rounded-xl p-3 space-y-1"
                          style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-light)' }}
                        >
                          {release.highlights.map((item, i) => (
                            <div key={i} className="flex items-start gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                              <span className="mt-1 flex-shrink-0 w-1 h-1 rounded-full" style={{ background: 'var(--text-muted)' }} />
                              <span>{item}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="p-4 pt-3 border-t flex justify-end" style={{ borderColor: 'var(--border-light)' }}>
              <button
                onClick={() => setShowVersionHistory(false)}
                className="px-5 py-2 rounded-xl text-sm font-semibold transition-all duration-150"
                style={{
                  background: 'linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%)',
                  color: 'white',
                  boxShadow: '0 4px 14px rgba(124,58,237,0.25)',
                }}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 更新弹窗 ===== */}
      {showUpdateDialog && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center">
          <div
            className="fixed inset-0 animate-fadeIn"
            style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}
            onClick={updateState.status !== 'downloading' ? () => setShowUpdateDialog(false) : undefined}
          />
          <div
            className="relative z-10 w-[460px] max-w-[90vw] rounded-2xl p-7 animate-scaleIn"
            style={{ background: 'var(--bg-secondary)', boxShadow: 'var(--shadow-xl)' }}
          >
            {/* 标题栏 */}
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2.5">
                {cfg.icon}
                <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                  {cfg.title}
                </h3>
              </div>
              {updateState.status !== 'downloading' && (
                <button
                  onClick={() => setShowUpdateDialog(false)}
                  className="p-1 rounded-lg transition-colors duration-150"
                  style={{ color: 'var(--text-muted)' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            {/* 版本信息 */}
            <div className="mb-4 text-sm" style={{ color: 'var(--text-tertiary)' }}>
              当前版本: v{currentVersion}
              {updateState.version && updateState.status !== 'not-available' && (
                <span className="ml-3">
                  <span style={{ color: 'var(--text-muted)' }}>&rarr;</span>
                  <span className="ml-1 font-semibold" style={{ color: 'var(--zeiss-blue)' }}>v{updateState.version}</span>
                </span>
              )}
            </div>

            {/* 状态消息 */}
            <p className="text-sm mb-5" style={{ color: 'var(--text-secondary)' }}>
              {updateState.message}
            </p>

            {/* 下载进度条 */}
            {updateState.status === 'downloading' && (
              <div className="mb-5">
                <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${updateState.percent || 0}%`,
                      background: 'linear-gradient(90deg, var(--zeiss-blue) 0%, #0077EE 100%)',
                    }}
                  />
                </div>
                <div className="flex justify-between mt-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                  <span>{updateState.percent || 0}%</span>
                  {updateState.bytesPerSecond > 0 && (
                    <span>{formatBytes(updateState.bytesPerSecond)}/s</span>
                  )}
                </div>
              </div>
            )}

            {/* 更新说明 */}
            {updateState.releaseNotes && (updateState.status === 'available' || updateState.status === 'downloaded') && (
              <div
                className="mb-5 p-4 rounded-xl text-sm max-h-48 overflow-y-auto"
                style={{
                  background: 'var(--bg-primary)',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-light)',
                }}
              >
                <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-tertiary)' }}>
                  更新说明
                </p>
                {typeof updateState.releaseNotes === 'string' ? (
                  <div
                    className="release-notes-content space-y-1"
                    dangerouslySetInnerHTML={{ __html: formatReleaseNotes(updateState.releaseNotes) }}
                  />
                ) : (
                  <div className="release-notes-content space-y-1">
                    {updateState.releaseNotes}
                  </div>
                )}
              </div>
            )}

            {/* 操作按钮 */}
            <div className="flex gap-3 justify-end">
              {updateState.status === 'available' && (
                <>
                  <button
                    onClick={() => setShowUpdateDialog(false)}
                    className="px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-150"
                    style={{
                      background: 'var(--bg-primary)',
                      color: 'var(--text-secondary)',
                      border: '1px solid var(--border-light)',
                    }}
                  >
                    稍后更新
                  </button>
                  <button
                    onClick={handleDownload}
                    className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-150"
                    style={{
                      background: 'var(--zeiss-blue)',
                      color: 'white',
                      boxShadow: '0 4px 14px rgba(0,102,204,0.25)',
                    }}
                  >
                    立即下载
                  </button>
                </>
              )}

              {updateState.status === 'downloading' && (
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  请勿关闭应用...
                </span>
              )}

              {updateState.status === 'downloaded' && (
                <>
                  <button
                    onClick={() => setShowUpdateDialog(false)}
                    className="px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-150"
                    style={{
                      background: 'var(--bg-primary)',
                      color: 'var(--text-secondary)',
                      border: '1px solid var(--border-light)',
                    }}
                  >
                    稍后安装
                  </button>
                  <button
                    onClick={handleInstall}
                    className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-150"
                    style={{
                      background: 'var(--success, #10B981)',
                      color: 'white',
                      boxShadow: '0 4px 14px rgba(16,185,129,0.25)',
                    }}
                  >
                    立即安装并重启
                  </button>
                </>
              )}

              {updateState.status === 'error' && (
                <>
                  <button
                    onClick={() => setShowUpdateDialog(false)}
                    className="px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-150"
                    style={{
                      background: 'var(--bg-primary)',
                      color: 'var(--text-secondary)',
                      border: '1px solid var(--border-light)',
                    }}
                  >
                    关闭
                  </button>
                  <button
                    onClick={handleCheckUpdate}
                    className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-150"
                    style={{
                      background: 'var(--zeiss-blue)',
                      color: 'white',
                      boxShadow: '0 4px 14px rgba(0,102,204,0.25)',
                    }}
                  >
                    重试
                  </button>
                </>
              )}

              {(updateState.status === 'not-available' || updateState.status === 'idle') && (
                <button
                  onClick={() => setShowUpdateDialog(false)}
                  className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-150"
                  style={{
                    background: 'var(--zeiss-blue)',
                    color: 'white',
                    boxShadow: '0 4px 14px rgba(0,102,204,0.25)',
                  }}
                >
                  确定
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 将 Markdown 格式的 releaseNotes 转为简单 HTML
 */
function formatReleaseNotes(text) {
  if (!text) return '';
  return text
    .replace(/^### (.+)$/gm, '<p style="font-weight:600;margin-top:8px;margin-bottom:4px;">$1</p>')
    .replace(/^## (.+)$/gm, '<p style="font-weight:700;font-size:14px;margin-top:8px;margin-bottom:4px;">$1</p>')
    .replace(/^- (.+)$/gm, '<div style="display:flex;align-items:flex-start;gap:6px;"><span style="margin-top:6px;width:4px;height:4px;border-radius:50%;background:currentColor;flex-shrink:0;"></span><span>$1</span></div>')
    .replace(/\n{2,}/g, '<div style="height:8px;"></div>')
    .replace(/\n/g, '');
}

/**
 * 格式化字节数
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
