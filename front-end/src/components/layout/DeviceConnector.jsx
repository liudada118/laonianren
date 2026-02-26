import React, { useState, useCallback } from 'react';
import { serialService } from '../../lib/SerialService';

const DEVICE_NAMES = {
  grip: '握力传感器手套',
  sitstand: '起坐能力传感器',
  standing: '足底压力传感器',
  gait: '步态分析传感器'
};

/**
 * 设备连接弹窗 - 真实 Web Serial API 连接
 * 点击"连接设备"会弹出浏览器串口选择对话框
 */
export default function DeviceConnector({ deviceType, onConnected, onSkip }) {
  const [status, setStatus] = useState('idle'); // idle | connecting | connected | error | unsupported
  const [errorMsg, setErrorMsg] = useState('');
  const [logs, setLogs] = useState([]);

  const addLog = useCallback((msg, type = 'info') => {
    setLogs(prev => [...prev.slice(-8), { msg, type, time: new Date().toLocaleTimeString() }]);
  }, []);

  const handleConnect = async () => {
    // 检查浏览器支持
    if (!('serial' in navigator)) {
      setStatus('unsupported');
      setErrorMsg('当前浏览器不支持 Web Serial API，请使用 Chrome 89+ 或 Edge 89+');
      return;
    }

    setStatus('connecting');
    setErrorMsg('');
    addLog('正在请求串口访问权限...', 'info');

    try {
      // 注册日志回调
      serialService.setOnLog((message, type) => {
        addLog(message, type);
      });

      // 调用真实串口连接 - 会弹出浏览器串口选择对话框
      const success = await serialService.connect();

      if (success) {
        setStatus('connected');
        addLog('设备连接成功！', 'info');
        // 延迟一下让用户看到成功状态
        setTimeout(() => {
          if (onConnected) onConnected({ mode: 'serial' });
        }, 800);
      } else {
        setStatus('error');
        setErrorMsg('连接失败，请检查设备是否正确连接');
        addLog('连接失败', 'error');
      }
    } catch (error) {
      setStatus('error');
      if (error.name === 'NotFoundError') {
        setErrorMsg('未选择串口设备，请重试');
        addLog('用户取消了串口选择', 'error');
      } else {
        setErrorMsg(`连接错误: ${error.message}`);
        addLog(`错误: ${error.message}`, 'error');
      }
    }
  };

  const handleSimulate = () => {
    setStatus('connected');
    addLog('已进入模拟模式', 'info');
    setTimeout(() => {
      if (onSkip) onSkip();
    }, 500);
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 zeiss-overlay animate-fadeIn">
      <div className="zeiss-dialog p-8 w-[520px] max-w-[90vw] animate-scaleIn">
        <h3 className="text-xl font-bold text-center mb-6" style={{ color: 'var(--text-primary)' }}>连接设备</h3>

        {/* 设备图标 */}
        <div className="flex justify-center mb-6">
          <div className="w-24 h-24 rounded-full flex items-center justify-center transition-all"
            style={{
              background: status === 'connected' ? 'var(--success-light)' :
                status === 'connecting' ? 'var(--zeiss-blue-light)' :
                status === 'error' || status === 'unsupported' ? 'var(--danger-light)' : 'var(--bg-tertiary)'
            }}>
            {status === 'connected' ? (
              <svg className="w-12 h-12" style={{ color: 'var(--success)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : status === 'error' || status === 'unsupported' ? (
              <svg className="w-12 h-12" style={{ color: 'var(--danger)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            ) : status === 'connecting' ? (
              <div className="w-12 h-12 flex items-center justify-center">
                <div className="w-10 h-10 rounded-full border-3 border-t-transparent animate-spin"
                  style={{ borderColor: 'var(--zeiss-blue)', borderTopColor: 'transparent' }} />
              </div>
            ) : (
              <svg className="w-12 h-12" style={{ color: 'var(--text-muted)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
              </svg>
            )}
          </div>
        </div>

        <p className="text-center text-lg font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
          {DEVICE_NAMES[deviceType] || '传感器设备'}
        </p>
        <p className="text-center text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
          {status === 'idle' && '请确保设备已通过 USB 连接到电脑，点击连接后选择对应串口'}
          {status === 'connecting' && '请在浏览器弹出的对话框中选择串口设备...'}
          {status === 'connected' && '设备已成功连接！'}
          {status === 'error' && errorMsg}
          {status === 'unsupported' && errorMsg}
        </p>

        {/* 串口配置信息 */}
        <div className="mb-4 p-3 rounded-lg text-xs" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-light)' }}>
          <div className="grid grid-cols-3 gap-2">
            <div className="text-center">
              <div style={{ color: 'var(--text-muted)' }}>波特率</div>
              <div className="font-mono font-bold" style={{ color: 'var(--zeiss-blue)' }}>3,000,000</div>
            </div>
            <div className="text-center">
              <div style={{ color: 'var(--text-muted)' }}>矩阵尺寸</div>
              <div className="font-mono font-bold" style={{ color: 'var(--zeiss-blue)' }}>64 × 64</div>
            </div>
            <div className="text-center">
              <div style={{ color: 'var(--text-muted)' }}>帧尾标识</div>
              <div className="font-mono font-bold" style={{ color: 'var(--zeiss-blue)' }}>AA 55 03 99</div>
            </div>
          </div>
        </div>

        {/* 日志区域 */}
        {logs.length > 0 && (
          <div className="mb-4 p-3 rounded-lg max-h-[100px] overflow-y-auto font-mono text-[11px]"
            style={{ background: '#F8F9FA', border: '1px solid var(--border-light)' }}>
            {logs.map((log, i) => (
              <div key={i} className="flex gap-2 py-0.5">
                <span style={{ color: 'var(--text-muted)' }}>{log.time}</span>
                <span style={{ color: log.type === 'error' ? 'var(--danger)' : log.type === 'data' ? 'var(--success)' : 'var(--text-secondary)' }}>
                  {log.msg}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex gap-3 justify-center">
          {(status === 'idle' || status === 'error' || status === 'unsupported') && (
            <>
              {status !== 'unsupported' && (
                <button onClick={handleConnect} className="zeiss-btn-primary px-8 py-3">
                  <span className="flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    {status === 'error' ? '重新连接' : '连接设备'}
                  </span>
                </button>
              )}
              <button onClick={handleSimulate} className="zeiss-btn-secondary px-8 py-3">
                <span className="flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  模拟模式
                </span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
