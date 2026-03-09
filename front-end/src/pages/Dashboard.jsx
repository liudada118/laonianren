import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAssessment } from '../contexts/AssessmentContext';

/* ─── 评估项目配置 ─── */
const ASSESSMENTS = [
  {
    key: 'grip',
    num: '1',
    title: '握力评估',
    subtitle: 'Grip Strength',
    desc: '通过传感器采集手部握力数据，分析各手指力量分布和抓握模式',
    path: '/assessment/grip',
    accent: '#0066CC',
    accentBg: '#E8F2FF',
    iconColor: '#B8CBE0',
    icon: '/icons/hand.png',
    iconBg: 'linear-gradient(135deg, #E8F2FF 0%, #D6E8FA 100%)',
    devices: ['HL', 'HR'],
  },
  {
    key: 'sitstand',
    num: '2',
    title: '起坐能力评估',
    subtitle: 'Sit-to-Stand',
    desc: '评估从坐到站的运动能力，分析起坐过程中的力量和平衡',
    path: '/assessment/sitstand',
    accent: '#059669',
    accentBg: '#ECFDF5',
    iconColor: '#A8C8B8',
    icon: '/icons/sit-stand.png',
    iconBg: 'linear-gradient(135deg, #ECFDF5 0%, #D1FAE5 100%)',
    devices: ['sit', 'foot1', 'foot2', 'foot3', 'foot4'],
  },
  {
    key: 'standing',
    num: '3',
    title: '静态站立评估',
    subtitle: 'Static Standing',
    desc: '通过足底压力传感器分析站立时的重心分布和平衡稳定性',
    path: '/assessment/standing',
    accent: '#7C3AED',
    accentBg: '#F3EEFF',
    iconColor: '#BEB0D8',
    icon: '/icons/footprint.png',
    iconBg: 'linear-gradient(135deg, #F3EEFF 0%, #E8DEFF 100%)',
    devices: ['foot1', 'foot2', 'foot3', 'foot4'],
  },
  {
    key: 'gait',
    num: '4',
    title: '行走步态评估',
    subtitle: 'Gait Analysis',
    desc: '分析行走过程中的步态参数，评估步频、步幅和足底压力变化',
    path: '/assessment/gait',
    accent: '#D97706',
    accentBg: '#FFFBEB',
    iconColor: '#D4C4A0',
    icon: '/icons/walking.png',
    iconBg: 'linear-gradient(135deg, #FFFBEB 0%, #FEF3C7 100%)',
    devices: ['foot1', 'foot2', 'foot3', 'foot4'],
  }
];

/* ─── 设备名称映射 ─── */
const DEVICE_LABELS = {
  HL: '左手套',
  HR: '右手套',
  sit: '坐垫',
  foot1: '脚垫1',
  foot2: '脚垫2',
  foot3: '脚垫3',
  foot4: '脚垫4',
};

/* ─── 患者信息弹窗 ─── */
function PatientDialog({ open, onClose, onConfirm }) {
  const [name, setName] = useState('');
  const [gender, setGender] = useState('男');
  const [age, setAge] = useState('65');
  const [weight, setWeight] = useState('70');

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center zeiss-overlay animate-fadeIn">
      <div className="zeiss-dialog p-8 w-[480px] max-w-[90vw] animate-scaleIn">
        <h3 className="text-lg font-bold mb-1" style={{ color: 'var(--text-primary)' }}>评估对象信息</h3>
        <p className="text-sm mb-6" style={{ color: 'var(--text-tertiary)' }}>请输入被评估者的基本信息</p>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-tertiary)' }}>姓名 *</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="请输入姓名"
              className="zeiss-input" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-tertiary)' }}>性别</label>
              <select value={gender} onChange={e => setGender(e.target.value)} className="zeiss-select">
                <option value="男">男</option>
                <option value="女">女</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-tertiary)' }}>年龄</label>
              <select value={age} onChange={e => setAge(e.target.value)} className="zeiss-select">
                {Array.from({ length: 61 }, (_, i) => i + 40).map(a => (
                  <option key={a} value={a}>{a}岁</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-tertiary)' }}>体重(kg)</label>
              <select value={weight} onChange={e => setWeight(e.target.value)} className="zeiss-select">
                {Array.from({ length: 81 }, (_, i) => i + 30).map(w => (
                  <option key={w} value={w}>{w}kg</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="flex gap-3 mt-8">
          <button onClick={onClose} className="zeiss-btn-secondary flex-1 py-3">取消</button>
          <button
            onClick={() => { if (name.trim()) onConfirm({ name: name.trim(), gender, age: +age, weight: +weight }); }}
            disabled={!name.trim()}
            className="flex-1 py-3 rounded-[10px] font-semibold text-sm transition-all"
            style={{
              background: name.trim() ? 'var(--zeiss-blue)' : '#E8ECF0',
              color: name.trim() ? 'white' : 'var(--text-muted)',
              cursor: name.trim() ? 'pointer' : 'not-allowed',
              border: 'none',
            }}>
            开始评估
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── 一键连接按钮组件 ─── */
function ConnectButton({ status, onConnect, onDisconnect, deviceOnlineMap, macInfo }) {
  const isConnected = status === 'connected';
  const isConnecting = status === 'connecting';
  const isError = status === 'error';

  // 统计在线设备数
  const allDevices = ['HL', 'HR', 'sit', 'foot1', 'foot2', 'foot3', 'foot4'];
  const onlineCount = allDevices.filter(d => deviceOnlineMap[d] === 'online').length;

  // 解析 MAC 信息：将端口路径映射的 macInfo 转为简洁显示
  const macEntries = macInfo ? Object.entries(macInfo) : [];

  const handleClick = () => {
    if (isConnected || isError) {
      onDisconnect();
    } else if (!isConnecting) {
      onConnect();
    }
  };

  return (
    <div className="flex items-center gap-3">
      {/* 设备状态指示器 */}
      {isConnected && (
        <div className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
          style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-light)' }}>
          {allDevices.map(d => (
            <div key={d} className="flex items-center gap-1" title={`${DEVICE_LABELS[d]}: ${deviceOnlineMap[d] === 'online' ? '在线' : '离线'}`}>
              <div className="w-1.5 h-1.5 rounded-full transition-colors"
                style={{ background: deviceOnlineMap[d] === 'online' ? '#22c55e' : '#d1d5db' }} />
            </div>
          ))}
          <span className="text-[10px] ml-1 tabular-nums" style={{ color: 'var(--text-tertiary)' }}>
            {onlineCount}/{allDevices.length}
          </span>
        </div>
      )}

      {/* MAC 地址信息显示 */}
      {isConnected && macEntries.length > 0 && (
        <div className="hidden lg:flex flex-col gap-0.5 px-2 py-1 rounded-lg text-[9px] max-w-[280px]"
          style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-light)', color: 'var(--text-tertiary)' }}>
          {macEntries.map(([port, info]) => (
            <div key={port} className="flex items-center gap-1 truncate">
              <span className="font-mono">{info.uniqueId ? info.uniqueId.slice(-8) : 'N/A'}</span>
              <span style={{ color: 'var(--text-muted)' }}>{info.version || ''}</span>
            </div>
          ))}
        </div>
      )}

      {/* 连接按钮 */}
      <button
        onClick={handleClick}
        disabled={isConnecting}
        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all"
        style={{
          background: isConnected ? '#059669' : isConnecting ? '#6B7B8D' : isError ? '#DC2626' : 'var(--zeiss-blue)',
          color: 'white',
          border: 'none',
          cursor: isConnecting ? 'wait' : 'pointer',
          opacity: isConnecting ? 0.8 : 1,
        }}
      >
        {/* 图标 */}
        {isConnecting ? (
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        ) : isConnected ? (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        )}
        {isConnecting ? '连接中...' : isConnected ? '已连接' : isError ? '重新连接' : '一键连接'}
      </button>
    </div>
  );
}

/* ─── Dashboard 主页 ─── */
export default function Dashboard() {
  const navigate = useNavigate();
  const {
    institution, patientInfo, setPatientInfo, assessments, resetAssessment,
    deviceConnStatus, deviceOnlineMap, macInfo, connectAllDevices, disconnectAllDevices,
  } = useAssessment();
  const [showDialog, setShowDialog] = useState(false);
  const [pendingPath, setPendingPath] = useState('');
  const [showResetConfirm, setShowResetConfirm] = useState(null);
  const [showGripTip, setShowGripTip] = useState(false);
  const [gripTipPath, setGripTipPath] = useState('');
  const [showSitStandTip, setShowSitStandTip] = useState(false);
  const [sitStandTipPath, setSitStandTipPath] = useState('');

  const handleStart = (path) => {
    if (patientInfo) {
      // 握力评估需要先提示用户带好手套
      if (path === '/assessment/grip') {
        setGripTipPath(path);
        setShowGripTip(true);
      } else if (path === '/assessment/sitstand') {
        setSitStandTipPath(path);
        setShowSitStandTip(true);
      } else {
        navigate(path);
      }
    } else {
      setPendingPath(path);
      setShowDialog(true);
    }
  };

  const handleConfirm = (info) => {
    setPatientInfo(info);
    setShowDialog(false);
    // 握力评估需要先提示用户带好手套
    if (pendingPath === '/assessment/grip') {
      setGripTipPath(pendingPath);
      setShowGripTip(true);
    } else if (pendingPath === '/assessment/sitstand') {
      setSitStandTipPath(pendingPath);
      setShowSitStandTip(true);
    } else {
      navigate(pendingPath);
    }
  };

  const confirmReset = () => {
    const key = showResetConfirm;
    resetAssessment(key);
    setShowResetConfirm(null);
    const a = ASSESSMENTS.find(x => x.key === key);
    if (a) navigate(a.path);
  };

  const completedCount = Object.values(assessments).filter(a => a.completed).length;

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
      {/* Header */}
      <header className="h-14 md:h-16 flex items-center justify-between px-4 md:px-8 shrink-0 z-20"
        style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-light)', boxShadow: 'var(--shadow-xs)' }}>
        <div className="flex items-center gap-2.5 md:gap-3.5 min-w-0">
          <img src="/logo1.png" alt="Logo" className="w-8 h-8 md:w-9 md:h-9 rounded-lg object-contain shrink-0" />
          <div className="min-w-0">
            <h1 className="text-[13px] md:text-[15px] font-bold tracking-tight truncate" style={{ color: 'var(--text-primary)' }}>
              肌少症/老年人评估及监测系统
            </h1>
            <p className="text-[10px] tracking-[0.15em] hidden md:block" style={{ color: 'var(--text-muted)' }}>
              SARCOPENIA ASSESSMENT & MONITORING SYSTEM
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 md:gap-5 shrink-0">
          {patientInfo && (
            <div className="hidden md:flex items-center gap-2.5 px-4 py-1.5 rounded-lg"
              style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-light)' }}>
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold"
                style={{ background: 'var(--zeiss-blue)' }}>
                {patientInfo.name[0]}
              </div>
              <div>
                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{patientInfo.name}</div>
                <div className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                  {patientInfo.gender} · {patientInfo.age}岁 · {patientInfo.weight}kg
                </div>
              </div>
            </div>
          )}

          {/* ─── 一键连接按钮 ─── */}
          <ConnectButton
            status={deviceConnStatus}
            onConnect={connectAllDevices}
            onDisconnect={disconnectAllDevices}
            deviceOnlineMap={deviceOnlineMap}
            macInfo={macInfo}
          />

          {institution && (
            <span className="text-sm font-medium hidden lg:inline" style={{ color: 'var(--text-secondary)' }}>{institution}</span>
          )}
          <button onClick={() => navigate('/history')}
            className="zeiss-btn-ghost flex items-center gap-1.5 md:gap-2 text-xs md:text-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="hidden sm:inline">历史记录</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 md:px-8 z-10 overflow-y-auto">
        {/* 进度概览 */}
        <div className="mb-6 md:mb-10 text-center animate-slideUp">
          <h2 className="text-responsive-lg font-bold mb-2" style={{ color: 'var(--text-primary)' }}>选择评估项目</h2>
          <p style={{ color: 'var(--text-tertiary)' }}>
            已完成 <span className="font-bold" style={{ color: 'var(--zeiss-blue)' }}>{completedCount}</span> / <span className="font-semibold" style={{ color: 'var(--text-secondary)' }}>4</span> 项评估
            {completedCount === 4 && <span style={{ color: 'var(--success)' }} className="ml-2 font-medium">· 全部完成</span>}
          </p>
        </div>

        {/* 四个评估卡片 */}
        <div className="dashboard-grid px-2">
          {ASSESSMENTS.map((item, idx) => {
            const completed = assessments[item.key]?.completed;
            // 检查该评估所需设备的在线状态
            const requiredDevices = item.devices || [];
            const onlineDevices = requiredDevices.filter(d => deviceOnlineMap[d] === 'online');
            const allDevicesOnline = requiredDevices.length > 0 && onlineDevices.length === requiredDevices.length;
            const someDevicesOnline = onlineDevices.length > 0;

            return (
              <div key={item.key}
                className="zeiss-card zeiss-card-interactive p-4 md:p-6 flex flex-col items-center text-center cursor-pointer relative animate-slideUp"
                style={{ animationDelay: `${idx * 80}ms` }}
                onClick={() => !completed && handleStart(item.path)}
              >
                {/* 完成标记 */}
                {completed && (
                  <div className="absolute top-4 right-4 w-6 h-6 rounded-full flex items-center justify-center"
                    style={{ background: 'var(--success)' }}>
                    <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                )}

                {/* 设备状态指示（仅在已连接时显示） */}
                {deviceConnStatus === 'connected' && !completed && (
                  <div className="absolute top-4 right-4 flex items-center gap-1 px-2 py-0.5 rounded-full"
                    style={{
                      background: allDevicesOnline ? 'rgba(34,197,94,0.1)' : someDevicesOnline ? 'rgba(217,119,6,0.1)' : 'rgba(107,123,141,0.1)',
                      border: `1px solid ${allDevicesOnline ? 'rgba(34,197,94,0.3)' : someDevicesOnline ? 'rgba(217,119,6,0.3)' : 'rgba(107,123,141,0.2)'}`,
                    }}>
                    <div className="w-1.5 h-1.5 rounded-full"
                      style={{ background: allDevicesOnline ? '#22c55e' : someDevicesOnline ? '#D97706' : '#9ca3af' }} />
                    <span className="text-[9px] font-medium"
                      style={{ color: allDevicesOnline ? '#059669' : someDevicesOnline ? '#D97706' : '#6B7B8D' }}>
                      {onlineDevices.length}/{requiredDevices.length}
                    </span>
                  </div>
                )}

                {/* 序号标题 */}
                <h3 className="text-[14px] md:text-[18px] font-bold mb-2 md:mb-3 self-start" style={{ color: 'var(--text-primary)' }}>
                  {item.num}.{item.title}
                </h3>

                {/* 大尺寸图标区域 */}
                <div className="w-full aspect-square flex items-center justify-center mb-2 md:mb-4 rounded-2xl"
                  style={{ background: item.iconBg }}>
                  <div className="w-[55%] h-[55%]">
                    <img 
                      src={item.icon} 
                      alt={item.title} 
                      className="w-full h-full object-contain"
                      style={{ opacity: 0.18 }} 
                    />
                  </div>
                </div>

                {/* 描述 */}
                <p className="text-xs leading-relaxed mb-4 flex-1" style={{ color: 'var(--text-tertiary)' }}>
                  {item.desc}
                </p>

                {/* 按钮 */}
                {completed ? (
                  <div className="flex gap-2 w-full">
                    <button onClick={(e) => { e.stopPropagation(); navigate(item.path, { state: { viewReport: true } }); }}
                      className="flex-1 py-2.5 rounded-[10px] text-xs font-semibold transition-all"
                      style={{ background: item.accentBg, color: item.accent, border: `1px solid ${item.accent}30` }}>
                      查看报告
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); setShowResetConfirm(item.key); }}
                      className="zeiss-btn-ghost flex-1 py-2.5 text-xs">
                      重新评估
                    </button>
                  </div>
                ) : (
                  <button className="zeiss-btn-primary w-full py-2.5 text-sm">
                    开始评估
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </main>

      {/* Footer */}
      <footer className="h-8 md:h-10 flex items-center justify-between px-4 md:px-8 shrink-0 z-10">
        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>powered by 矩侨工业</span>
        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>v2.0.0</span>
      </footer>

      {/* 患者信息弹窗 */}
      <PatientDialog open={showDialog} onClose={() => setShowDialog(false)} onConfirm={handleConfirm} />

      {/* 握力评估手套提示弹窗 */}
      {showGripTip && (
        <div className="fixed inset-0 z-50 flex items-center justify-center zeiss-overlay animate-fadeIn">
          <div className="zeiss-dialog p-8 w-[460px] max-w-[90vw] animate-scaleIn text-center">
            <div className="w-16 h-16 mx-auto mb-5 rounded-full flex items-center justify-center"
              style={{ background: '#E8F2FF' }}>
              <svg className="w-8 h-8" style={{ color: '#0066CC' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11" />
              </svg>
            </div>
            <h3 className="text-lg font-bold mb-2" style={{ color: 'var(--text-primary)' }}>握力评估准备</h3>
            <p className="text-sm leading-relaxed mb-6" style={{ color: 'var(--text-tertiary)' }}>
              请确保被评估者已<span className="font-semibold" style={{ color: '#0066CC' }}>带好手套</span>，并且<span className="font-semibold" style={{ color: '#0066CC' }}>手指平铺</span>在传感器上，以确保数据采集的准确性。
            </p>
            <div className="flex gap-3">
              <button onClick={() => setShowGripTip(false)} className="zeiss-btn-secondary flex-1 py-3 text-sm">取消</button>
              <button
                onClick={() => { setShowGripTip(false); navigate(gripTipPath); }}
                className="flex-1 py-3 rounded-[10px] font-semibold text-sm text-white border-none cursor-pointer transition-all"
                style={{ background: 'var(--zeiss-blue)' }}>
                已准备好，开始评估
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 起坐评估提示弹窗 */}
      {showSitStandTip && (
        <div className="fixed inset-0 z-50 flex items-center justify-center zeiss-overlay animate-fadeIn">
          <div className="zeiss-dialog p-8 w-[460px] max-w-[90vw] animate-scaleIn text-center">
            <div className="w-16 h-16 mx-auto mb-5 rounded-full flex items-center justify-center"
              style={{ background: '#ECFDF5' }}>
              <svg className="w-8 h-8" style={{ color: '#059669' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
            </div>
            <h3 className="text-lg font-bold mb-2" style={{ color: 'var(--text-primary)' }}>起坐能力评估准备</h3>
            <p className="text-sm leading-relaxed mb-6" style={{ color: 'var(--text-tertiary)' }}>
              请被评估者坐在椅子上，双手交叉放于胸前。<br/>
              评估开始后，请用最快速度完成<span className="font-semibold" style={{ color: '#059669' }}>起坐 5 次</span>。
            </p>
            <div className="flex gap-3">
              <button onClick={() => setShowSitStandTip(false)} className="zeiss-btn-secondary flex-1 py-3 text-sm">取消</button>
              <button
                onClick={() => { setShowSitStandTip(false); navigate(sitStandTipPath); }}
                className="flex-1 py-3 rounded-[10px] font-semibold text-sm text-white border-none cursor-pointer transition-all"
                style={{ background: '#059669' }}>
                已准备好，开始评估
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 重新评估确认弹窗 */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center zeiss-overlay animate-fadeIn">
          <div className="zeiss-dialog p-8 w-[420px] animate-scaleIn text-center">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full flex items-center justify-center"
              style={{ background: 'var(--warning-light)' }}>
              <svg className="w-6 h-6" style={{ color: 'var(--warning)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <p className="text-base mb-6" style={{ color: 'var(--text-primary)' }}>重新评估会覆盖现有报告，确认继续？</p>
            <div className="flex gap-3">
              <button onClick={() => setShowResetConfirm(null)} className="zeiss-btn-secondary flex-1 py-3 text-sm">取消</button>
              <button onClick={confirmReset}
                className="flex-1 py-3 rounded-[10px] text-sm font-semibold text-white border-none cursor-pointer"
                style={{ background: 'var(--warning)' }}>
                确认重新评估
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
