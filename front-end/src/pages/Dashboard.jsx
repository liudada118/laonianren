import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAssessment } from '../contexts/AssessmentContext';

/* ─── 图标组件 ─── */

// 通用图标组件 - 加载外部PNG图标文件，支持颜色染色
const IconImage = ({ src, alt, tintColor }) => (
  <img 
    src={src} 
    alt={alt} 
    className="w-full h-full object-contain" 
    style={{ 
      filter: tintColor ? undefined : 'brightness(0) saturate(100%) opacity(0.15)',
    }} 
  />
);

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
  }
];

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

/* ─── Dashboard 主页 ─── */
export default function Dashboard() {
  const navigate = useNavigate();
  const { institution, patientInfo, setPatientInfo, assessments, resetAssessment } = useAssessment();
  const [showDialog, setShowDialog] = useState(false);
  const [pendingPath, setPendingPath] = useState('');
  const [showResetConfirm, setShowResetConfirm] = useState(null);

  const handleStart = (path) => {
    if (patientInfo) {
      navigate(path);
    } else {
      setPendingPath(path);
      setShowDialog(true);
    }
  };

  const handleConfirm = (info) => {
    setPatientInfo(info);
    setShowDialog(false);
    navigate(pendingPath);
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
                      style={{ 
                        opacity: 0.18,
                      }} 
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
                      style={{ background: 'var(--zeiss-blue-light)', color: 'var(--zeiss-blue)', border: 'none', cursor: 'pointer' }}>
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
