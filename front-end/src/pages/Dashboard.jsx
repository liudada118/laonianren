import React, { useMemo, useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAssessment } from '../contexts/AssessmentContext';
import ComprehensiveReport from '../components/report/ComprehensiveReport';
import { buildComprehensiveScoreResult } from '../lib/assessmentScoring';
import { parseRosterFile } from '../lib/rosterImport';
import { deriveStatusMap } from '../lib/rosterService';
import { getHistory } from '../lib/historyService';
import { getDeviceRegion, getStoredDeviceRegion, setDeviceRegion, REGION_LABEL } from '../lib/deviceRegion';
import { backendBridge } from '../lib/BackendBridge';

/* ─── 评估项目配置 ─── */
const ASSESSMENTS = [
  {
    key: 'gait',
    num: '1',
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
  },
  {
    key: 'standing',
    num: '2',
    title: '静态站立评估',
    subtitle: 'Static Standing',
    desc: '通过足底压力传感器分析站立时的重心分布和平衡稳定性',
    path: '/assessment/standing',
    accent: '#7C3AED',
    accentBg: '#F3EEFF',
    iconColor: '#BEB0D8',
    icon: '/icons/footprint.png',
    iconBg: 'linear-gradient(135deg, #F3EEFF 0%, #E8DEFF 100%)',
    devices: ['foot1'],
  },
  {
    key: 'grip',
    num: '3',
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
    num: '4',
    title: '起坐能力评估',
    subtitle: 'Sit-to-Stand',
    desc: '评估从坐到站的运动能力，分析起坐过程中的力量和平衡',
    path: '/assessment/sitstand',
    accent: '#059669',
    accentBg: '#ECFDF5',
    iconColor: '#A8C8B8',
    icon: '/icons/sit-stand.png',
    iconBg: 'linear-gradient(135deg, #ECFDF5 0%, #D1FAE5 100%)',
    devices: ['sit', 'foot1'],
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

/* ─── 切换/补填评估对象弹窗（名单模式）─── */
function PatientSwitchDialog({ open, patient, onClose, onConfirm }) {
  const [gender, setGender] = useState('');
  const [age, setAge] = useState('');

  useEffect(() => {
    if (open && patient) {
      setGender(patient.gender || '');
      setAge(patient.age != null && patient.age !== '' ? String(patient.age) : '');
    }
  }, [open, patient]);

  if (!open || !patient) return null;

  const info = [patient.id && `编号 ${patient.id}`, patient.region].filter(Boolean).join('   ·   ') || '—';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center zeiss-overlay animate-fadeIn">
      <div className="zeiss-dialog p-8 w-[460px] max-w-[90vw] animate-scaleIn">
        <h3 className="text-lg font-bold mb-1" style={{ color: 'var(--text-primary)' }}>当前评估对象</h3>
        <p className="text-sm mb-5" style={{ color: 'var(--text-tertiary)' }}>请核对对象信息，并补充性别 / 年龄（可留空）</p>

        {/* 只读信息卡 */}
        <div className="rounded-xl p-4 mb-5 flex items-center gap-3" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-light)' }}>
          <div className="w-12 h-12 rounded-full flex items-center justify-center text-white text-lg font-bold shrink-0" style={{ background: 'var(--zeiss-blue)' }}>
            {(patient.name || '?')[0]}
          </div>
          <div className="min-w-0">
            <div className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>{patient.name || '（未命名）'}</div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{info}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-tertiary)' }}>性别</label>
            <select value={gender} onChange={e => setGender(e.target.value)} className="zeiss-select">
              <option value="">未填</option>
              <option value="男">男</option>
              <option value="女">女</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-tertiary)' }}>年龄</label>
            <input type="number" min="0" max="120" value={age} onChange={e => setAge(e.target.value)}
              placeholder="可留空" className="zeiss-input" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mt-7">
          <button onClick={onClose} className="zeiss-btn-secondary py-3">取消</button>
          <button
            onClick={() => onConfirm({ gender: gender || '', age: age === '' ? '' : (Number(age) || '') })}
            className="py-3 rounded-[10px] font-semibold text-sm text-white border-none cursor-pointer transition-all"
            style={{ background: 'var(--zeiss-blue)' }}>
            进入评估
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── 名单导入弹窗 ─── */
const DETECT_LABELS = { id: '编号', name: '姓名', region: '地区', gender: '性别', age: '年龄', weight: '体重' };
function RosterImportDialog({ open, hasExisting, onClose, onImported }) {
  const [parsing, setParsing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (open) { setParsing(false); setResult(null); setError(''); }
  }, [open]);

  if (!open) return null;

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParsing(true); setError(''); setResult(null);
    try {
      const r = await parseRosterFile(file);
      if (!r.list.length) setError('未解析到有效名单行，请检查表格是否有“姓名 / 编号”列。');
      else setResult(r);
    } catch (err) {
      setError('解析失败：' + (err?.message || String(err)));
    } finally {
      setParsing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center zeiss-overlay animate-fadeIn">
      <div className="zeiss-dialog p-8 w-[560px] max-w-[92vw] animate-scaleIn">
        <h3 className="text-lg font-bold mb-1" style={{ color: 'var(--text-primary)' }}>导入评估名单</h3>
        <p className="text-sm mb-5" style={{ color: 'var(--text-tertiary)' }}>
          选择 Excel 文件（.xlsx），自动识别 编号 / 姓名 / 地点 等列{hasExisting ? '；将追加到现有名单（同编号自动去重，不会覆盖之前导入的）' : ''}
        </p>

        <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={handleFile} className="hidden" id="roster-file-input" />
        <label htmlFor="roster-file-input"
          className="block rounded-xl border-2 border-dashed p-6 text-center cursor-pointer mb-4 transition-all"
          style={{ borderColor: 'var(--border-light)', background: 'var(--bg-tertiary)' }}>
          <span className="text-sm font-medium" style={{ color: 'var(--zeiss-blue)' }}>点击选择 Excel 文件</span>
        </label>

        {parsing && <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>解析中…</p>}
        {error && <p className="text-sm" style={{ color: '#DC2626' }}>{error}</p>}

        {result && (
          <div className="rounded-xl p-4 mb-4" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-light)' }}>
            <div className="text-sm font-semibold mb-2 flex flex-wrap items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
              共 {result.total} 人 · 识别列：
              {Object.keys(result.detected).map(k => (
                <span key={k} className="px-2 py-0.5 rounded text-[11px]" style={{ background: '#E8F2FF', color: '#0066CC' }}>
                  {DETECT_LABELS[k] || k}={result.detected[k]}
                </span>
              ))}
            </div>
            <div className="text-xs max-h-32 overflow-y-auto" style={{ color: 'var(--text-tertiary)' }}>
              {result.list.slice(0, 5).map((p, i) => (
                <div key={i} className="py-0.5">
                  {[p.id, p.name, p.region, p.gender, p.age && `${p.age}岁`].filter(Boolean).join(' · ')}
                </div>
              ))}
              {result.total > 5 && <div className="py-0.5 opacity-60">…… 其余 {result.total - 5} 人</div>}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 mt-2">
          <button onClick={onClose} className="zeiss-btn-secondary py-3">取消</button>
          <button onClick={() => result && onImported(result.list)} disabled={!result}
            className="py-3 rounded-[10px] font-semibold text-sm transition-all border-none"
            style={{ background: result ? 'var(--zeiss-blue)' : '#E8ECF0', color: result ? 'white' : 'var(--text-muted)', cursor: result ? 'pointer' : 'not-allowed' }}>
            确认导入{result ? `（${result.total}）` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── 名单管理面板 ─── */
/* ─── 临时加入新用户弹窗 ─── */
function AddPatientDialog({ open, roster, defaultRegion, onClose, onConfirm }) {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [gender, setGender] = useState('');
  const [age, setAge] = useState('');
  const [region, setRegion] = useState('');
  const [otherRegion, setOtherRegion] = useState('');
  const [error, setError] = useState('');
  const regions = useMemo(() => [...new Set((roster || []).map(p => p.region).filter(Boolean))], [roster]);

  useEffect(() => {
    if (open) {
      setId(''); setName(''); setGender(''); setAge('');
      setRegion(defaultRegion || (regions.length ? regions[0] : '__other__'));
      setOtherRegion(''); setError('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultRegion]);

  if (!open) return null;

  const submit = () => {
    const tid = id.trim();
    const tname = name.trim();
    const finalRegion = (region === '__other__' ? otherRegion : region).trim();
    if (!tid) { setError('请填写编号(ID)'); return; }
    if (!tname) { setError('请填写姓名'); return; }
    if (roster.some(p => String(p.id) === tid)) { setError(`编号 ${tid} 已存在，请使用唯一编号`); return; }
    onConfirm({ id: tid, name: tname, region: finalRegion, gender, age: age === '' ? '' : (Number(age) || ''), weight: '' });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center zeiss-overlay animate-fadeIn">
      <div className="zeiss-dialog p-8 w-[440px] max-w-[90vw] animate-scaleIn">
        <h3 className="text-lg font-bold mb-1" style={{ color: 'var(--text-primary)' }}>临时加入新用户</h3>
        <p className="text-sm mb-5" style={{ color: 'var(--text-tertiary)' }}>现场临时人员，编号必须唯一</p>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-tertiary)' }}>编号 (ID) *</label>
            <input value={id} onChange={e => { setId(e.target.value); setError(''); }} placeholder="请输入唯一编号" className="zeiss-input" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-tertiary)' }}>姓名 *</label>
            <input value={name} onChange={e => { setName(e.target.value); setError(''); }} placeholder="请输入姓名" className="zeiss-input" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-tertiary)' }}>性别</label>
              <select value={gender} onChange={e => setGender(e.target.value)} className="zeiss-select">
                <option value="">未填</option>
                <option value="男">男</option>
                <option value="女">女</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-tertiary)' }}>年龄</label>
              <input type="number" min="0" max="120" value={age} onChange={e => setAge(e.target.value)} placeholder="可留空" className="zeiss-input" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-tertiary)' }}>地区</label>
            <select value={region} onChange={e => setRegion(e.target.value)} className="zeiss-select">
              {regions.map(r => <option key={r} value={r}>{r}</option>)}
              <option value="__other__">其它（手动输入新地区）</option>
            </select>
            {region === '__other__' && (
              <input value={otherRegion} onChange={e => setOtherRegion(e.target.value)} placeholder="输入新地区名称" className="zeiss-input mt-2" />
            )}
          </div>
        </div>
        {error && <p className="text-sm mt-3" style={{ color: '#DC2626' }}>{error}</p>}
        <div className="grid grid-cols-2 gap-3 mt-7">
          <button onClick={onClose} className="zeiss-btn-secondary py-3">取消</button>
          <button onClick={submit} className="py-3 rounded-[10px] font-semibold text-sm text-white border-none cursor-pointer transition-all" style={{ background: 'var(--zeiss-blue)' }}>加入并开始</button>
        </div>
      </div>
    </div>
  );
}

function RosterPanel({ open, roster, currentId, onClose, onPick, onClear, onAddPatient }) {
  const [keyword, setKeyword] = useState('');
  const [sortBy, setSortBy] = useState('id');
  const [statusFilter, setStatusFilter] = useState('all');
  const [regionFilter, setRegionFilter] = useState('all');
  const statusMap = useMemo(() => deriveStatusMap(roster, getHistory()), [roster, open]);

  if (!open) return null;

  const catOf = (p) => {
    const c = statusMap[p.id]?.completed || 0;
    return c === 4 ? 'done' : c > 0 ? 'partial' : 'notStarted';
  };
  const doneCount = roster.filter(p => catOf(p) === 'done').length;
  const partialCount = roster.filter(p => catOf(p) === 'partial').length;
  const notStartedCount = roster.filter(p => catOf(p) === 'notStarted').length;

  const regions = [...new Set(roster.map(p => p.region).filter(Boolean))];
  const filtered = roster.filter(p => {
    if (keyword && !((p.name || '').includes(keyword) || String(p.id || '').includes(keyword))) return false;
    if (statusFilter !== 'all' && catOf(p) !== statusFilter) return false;
    if (regionFilter !== 'all' && p.region !== regionFilter) return false;
    return true;
  });
  const items = [...filtered].sort((a, b) => {
    if (sortBy === 'name') return (a.name || '').localeCompare(b.name || '', 'zh');
    if (sortBy === 'status') return (statusMap[b.id]?.completed || 0) - (statusMap[a.id]?.completed || 0);
    return String(a.id || '').localeCompare(String(b.id || ''), 'zh', { numeric: true });
  });

  return (
    <div className="fixed inset-0 z-50 flex justify-end zeiss-overlay animate-fadeIn" onClick={onClose}>
      <div className="h-full w-[420px] max-w-[92vw] flex flex-col" style={{ background: 'var(--bg-secondary)' }} onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b shrink-0" style={{ borderColor: 'var(--border-light)' }}>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>评估名单 · {roster.length} 人</h3>
            <button onClick={onClose} className="zeiss-btn-ghost text-xs">关闭</button>
          </div>
          <div className="flex items-center gap-3 text-xs mb-2">
            <span style={{ color: 'var(--success)' }}>已完成 {doneCount}</span>
            <span style={{ color: '#D97706' }}>部分未完成 {partialCount}</span>
            <span style={{ color: 'var(--text-muted)' }}>未开始 {notStartedCount}</span>
          </div>
          <input value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="按姓名 / 编号搜索" className="zeiss-input mb-2" />
          {regions.length > 1 && (
            <div className="flex items-center gap-1.5 text-xs mb-2 flex-wrap">
              <span style={{ color: 'var(--text-tertiary)' }}>地区：</span>
              <button onClick={() => setRegionFilter('all')} className="px-2 py-1 rounded transition-all"
                style={{ background: regionFilter === 'all' ? '#E8F2FF' : 'transparent', color: regionFilter === 'all' ? '#0066CC' : 'var(--text-tertiary)' }}>全部</button>
              {regions.map(r => (
                <button key={r} onClick={() => setRegionFilter(r)} className="px-2 py-1 rounded transition-all"
                  style={{ background: regionFilter === r ? '#E8F2FF' : 'transparent', color: regionFilter === r ? '#0066CC' : 'var(--text-tertiary)' }}>{r}</button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-1.5 text-xs mb-2 flex-wrap">
            <span style={{ color: 'var(--text-tertiary)' }}>状态：</span>
            {[['all', '全部'], ['notStarted', '未开始'], ['partial', '部分未完成'], ['done', '已完成']].map(([k, label]) => (
              <button key={k} onClick={() => setStatusFilter(k)} className="px-2 py-1 rounded transition-all"
                style={{ background: statusFilter === k ? '#E8F2FF' : 'transparent', color: statusFilter === k ? '#0066CC' : 'var(--text-tertiary)' }}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span style={{ color: 'var(--text-tertiary)' }}>排序：</span>
            {[['id', '编号'], ['name', '姓名'], ['status', '状态']].map(([k, label]) => (
              <button key={k} onClick={() => setSortBy(k)} className="px-2 py-1 rounded transition-all"
                style={{ background: sortBy === k ? '#E8F2FF' : 'transparent', color: sortBy === k ? '#0066CC' : 'var(--text-tertiary)' }}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {items.map((p) => {
            const st = statusMap[p.id] || { completed: 0, total: 4 };
            const isCurrent = p.id === currentId && currentId != null;
            const statusColor = st.completed === 4 ? 'var(--success)' : st.completed > 0 ? '#D97706' : 'var(--text-muted)';
            const statusText = st.completed === 4 ? '已完成' : st.completed > 0 ? `进行中 ${st.completed}/4` : '未开始';
            return (
              <button key={p.id || p.name} onClick={() => onPick(p)}
                className="w-full px-5 py-3 flex items-center justify-between border-b text-left transition-all hover:opacity-80"
                style={{ borderColor: 'var(--border-light)', background: isCurrent ? '#E8F2FF' : 'transparent' }}>
                <div className="min-w-0">
                  <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {p.name}{isCurrent && <span className="text-[10px] ml-1.5" style={{ color: '#0066CC' }}>· 当前</span>}
                  </div>
                  <div className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{[p.id, p.region].filter(Boolean).join(' · ')}</div>
                </div>
                <span className="text-[11px] font-medium shrink-0 ml-2" style={{ color: statusColor }}>{statusText}</span>
              </button>
            );
          })}
          {!items.length && <div className="px-5 py-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>无匹配对象</div>}
        </div>

        <div className="px-5 py-3 border-t shrink-0 flex justify-between items-center" style={{ borderColor: 'var(--border-light)' }}>
          <button onClick={onAddPatient} className="text-sm font-bold px-5 py-2.5 rounded-lg flex items-center gap-2 transition-all"
            style={{ color: 'white', background: 'var(--zeiss-blue)', border: 'none', boxShadow: '0 2px 8px rgba(0,102,204,0.25)' }}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
            加入用户
          </button>
          <button onClick={onClear} className="text-xs font-medium" style={{ color: '#DC2626' }}>清空名单</button>
        </div>
      </div>
    </div>
  );
}

/* ─── 一键连接按钮组件 ─── */
function ConnectButton({ status, onConnect, onDisconnect, onRescan, rescanLoading, deviceOnlineMap, macInfo }) {
  const isConnected = status === 'connected';
  const isConnecting = status === 'connecting';
  const isError = status === 'error';

  // 统计在线设备数
  const allDevices = ['HL', 'HR', 'sit', 'foot1', 'foot2', 'foot3', 'foot4'];
  const onlineCount = allDevices.filter(d => deviceOnlineMap[d] === 'online').length;
  const hasOffline = isConnected && onlineCount < allDevices.length && onlineCount > 0;

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
        <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg"
          style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-light)' }}>
          <span className="text-[10px] font-medium" style={{ color: 'var(--text-tertiary)' }}>在线设备</span>
          {allDevices.map(d => (
            <div key={d} className="flex items-center gap-0.5" title={`${DEVICE_LABELS[d]}: ${deviceOnlineMap[d] === 'online' ? '在线' : '离线'}`}>
              <div className="w-1.5 h-1.5 rounded-full transition-colors"
                style={{ background: deviceOnlineMap[d] === 'online' ? '#22c55e' : '#d1d5db' }} />
            </div>
          ))}
          <span className="text-[10px] ml-0.5 tabular-nums" style={{ color: 'var(--text-tertiary)' }}>
            {onlineCount}/{allDevices.length}
          </span>
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

      {/* 重新扫描按钮（已连接且有设备离线时显示） */}
      {isConnected && (
        <button
          onClick={onRescan}
          disabled={rescanLoading}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all"
          style={{
            background: hasOffline ? '#FEF3C7' : 'var(--bg-tertiary)',
            color: hasOffline ? '#D97706' : 'var(--text-tertiary)',
            border: hasOffline ? '1px solid #F59E0B40' : '1px solid var(--border-light)',
            cursor: rescanLoading ? 'wait' : 'pointer',
            opacity: rescanLoading ? 0.7 : 1,
          }}
          title="重新扫描串口，连接掉线设备"
        >
          {rescanLoading ? (
            <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          )}
          {rescanLoading ? '连接中...' : '重新连接'}
        </button>
      )}
    </div>
  );
}

/* ─── Dashboard 主页 ─── */
export default function Dashboard() {
  const navigate = useNavigate();
  const {
    institution, patientInfo, setPatientInfo, assessments, resetAssessment, startNewSession,
    deviceConnStatus, deviceOnlineMap, macInfo, connectAllDevices, disconnectAllDevices,
    rescanDevices, rescanLoading,
    sessionId, roster, rosterCurrentId, importRoster, switchToPatient, updateCurrentExtra, clearRoster,
  } = useAssessment();
  const [showResetConfirm, setShowResetConfirm] = useState(null);
  const [showGripTip, setShowGripTip] = useState(false);
  const [gripTipPath, setGripTipPath] = useState('');
  const [showSitStandTip, setShowSitStandTip] = useState(false);
  const [sitStandTipPath, setSitStandTipPath] = useState('');
  const [showComprehensiveReport, setShowComprehensiveReport] = useState(false);
  // 名单相关
  const [showImport, setShowImport] = useState(false);
  const [showRosterPanel, setShowRosterPanel] = useState(false);
  const [showAddPatient, setShowAddPatient] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [deviceRegion, setDeviceRegionState] = useState(getDeviceRegion());
  const [switchTarget, setSwitchTarget] = useState(null);
  const [showNextConfirm, setShowNextConfirm] = useState(null);
  const nextPromptedRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const storedRegion = getStoredDeviceRegion();
    backendBridge.getDeviceRegion()
      .then((resp) => {
        if (cancelled) return;
        const serverRegion = resp?.data?.deviceRegion;
        if (!storedRegion && (serverRegion === 'beijing' || serverRegion === 'guangzhou')) {
          const next = setDeviceRegion(serverRegion);
          setDeviceRegionState(next);
          return;
        }
        backendBridge.setDeviceRegion(getDeviceRegion()).catch((e) => {
          console.warn('[Dashboard] 同步设备地区到后端失败:', e);
        });
      })
      .catch((e) => {
        console.warn('[Dashboard] 读取后端设备地区失败:', e);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleDeviceRegionChange = (region) => {
    const next = setDeviceRegion(region);
    setDeviceRegionState(next);
    backendBridge.setDeviceRegion(next).catch((e) => {
      console.warn('[Dashboard] 持久化设备地区到后端失败:', e);
    });
  };

  const handleStart = (path) => {
    if (!patientInfo) {
      // 未选定评估对象：引导去名单选择（无名单则去导入）
      if (roster.length > 0) setShowRosterPanel(true);
      else setShowImport(true);
      return;
    }
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
  };

  const confirmReset = () => {
    const key = showResetConfirm;
    resetAssessment(key);
    setShowResetConfirm(null);
    const a = ASSESSMENTS.find(x => x.key === key);
    if (a) navigate(a.path);
  };

  const completedCount = Object.values(assessments).filter(a => a.completed).length;
  const comprehensiveReady = completedCount === 4;

  // ─── 名单导入 / 切换 ───
  const handleImported = (list) => {
    importRoster(list);
    setShowImport(false);
    // 导入后不自动选人：停在首页，由操作员用搜索框搜要测的对象（第一个不一定是表里第一个）
  };

  const handlePickPatient = (p) => {
    setShowRosterPanel(false);
    setSwitchTarget(p);
  };

  const handleAddPatient = (newPatient) => {
    importRoster([newPatient]); // 追加到名单（编号唯一已在弹窗校验）
    setShowAddPatient(false);
    setShowRosterPanel(false);
    switchToPatient(newPatient); // 信息已在弹窗填全，直接设为当前对象（不再弹切换窗）
  };

  const handleSwitchConfirm = ({ gender, age }) => {
    const p = switchTarget;
    if (!p) return;
    switchToPatient({ ...p, gender: gender || '', age });
    updateCurrentExtra({ gender: gender || '', age });
    setSwitchTarget(null);
  };

  // 切到名单中相对当前对象的下一位（dir=1）/上一位（dir=-1），弹切换窗确认
  const goAdjacentPatient = (dir) => {
    if (!roster.length) return;
    const idx = rosterCurrentId != null ? roster.findIndex(r => r.id === rosterCurrentId) : -1;
    const target = roster[idx + dir];
    if (target) setSwitchTarget(target);
  };

  // 做满四项后，名单模式自动提示切换下一位（同一会话只提示一次）
  useEffect(() => {
    if (completedCount === 4 && rosterCurrentId != null && roster.length) {
      if (nextPromptedRef.current === sessionId) return;
      nextPromptedRef.current = sessionId;
      const idx = roster.findIndex(r => r.id === rosterCurrentId);
      const next = idx >= 0 && idx + 1 < roster.length ? roster[idx + 1] : null;
      setShowNextConfirm({ currentName: patientInfo?.name || '', next });
    }
  }, [completedCount, rosterCurrentId, sessionId, roster]);
  const currentRecord = useMemo(() => {
    if (!patientInfo) return null;
    const now = new Date();
    return {
      id: 'current-session',
      sessionId: 'current-session',
      patientName: patientInfo.name,
      patientGender: patientInfo.gender,
      patientAge: patientInfo.age,
      patientWeight: patientInfo.weight,
      institution: institution || '',
      assessments,
      date: now.toISOString(),
      dateStr: `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`,
      updatedAt: now.toISOString(),
    };
  }, [patientInfo, institution, assessments]);
  const comprehensiveScore = useMemo(
    () => currentRecord ? buildComprehensiveScoreResult(assessments, patientInfo || {}) : null,
    [currentRecord, assessments, patientInfo],
  );
  // 名单中尚未完成四项筛查的人（缺检提醒）
  const pendingPatients = useMemo(() => {
    if (!roster.length) return [];
    const statusMap = deriveStatusMap(roster, getHistory());
    return roster.filter(p => (statusMap[p.id]?.completed || 0) < 4);
  }, [roster, assessments]);

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
          {/* ─── 一键连接按钮 ─── */}
          <ConnectButton
            status={deviceConnStatus}
            onConnect={connectAllDevices}
            onDisconnect={disconnectAllDevices}
            onRescan={rescanDevices}
            rescanLoading={rescanLoading}
            deviceOnlineMap={deviceOnlineMap}
            macInfo={macInfo}
          />

          {institution && (
            <span className="text-sm font-medium hidden lg:inline" style={{ color: 'var(--text-secondary)' }}>{institution}</span>
          )}
          {/* 导入名单 / 名单管理 */}
          <button onClick={() => setShowImport(true)}
            className="flex items-center gap-1.5 md:gap-2 text-xs md:text-sm px-3 py-1.5 rounded-lg font-semibold transition-all"
            style={{ color: '#0066CC', background: '#E8F2FF', border: '1px solid #0066CC30' }}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
            </svg>
            <span className="hidden sm:inline">导入名单</span>
          </button>
          {roster.length > 0 && (
            <button onClick={() => setShowRosterPanel(true)}
              className="flex items-center gap-1.5 md:gap-2 text-xs md:text-sm px-3 py-1.5 rounded-lg font-semibold transition-all"
              style={{ color: '#7C3AED', background: '#F3EEFF', border: '1px solid #7C3AED30' }}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
              </svg>
              <span className="hidden sm:inline">名单 {roster.length}</span>
            </button>
          )}
          <button onClick={() => navigate('/history')}
            className="zeiss-btn-ghost flex items-center gap-1.5 md:gap-2 text-xs md:text-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="hidden sm:inline">历史记录</span>
          </button>
          <div className="flex items-center rounded-full p-0.5 shrink-0"
            style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-light)' }}
            title="切换设备地区（线序/预处理：广州 / 北京），进入评估时按该地区处理">
            {['guangzhou', 'beijing'].map(r => (
              <button key={r}
                onClick={() => handleDeviceRegionChange(r)}
                className="px-3 py-1 rounded-full text-xs font-semibold transition-all"
                style={deviceRegion === r
                  ? { background: '#059669', color: 'white' }
                  : { background: 'transparent', color: 'var(--text-muted)' }}>
                {REGION_LABEL[r]}
              </button>
            ))}
          </div>
          <button onClick={() => navigate('/', { state: { editMode: true } })}
            className="zeiss-btn-ghost flex items-center gap-1.5 md:gap-2 text-xs md:text-sm"
            title="修改登录信息">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="hidden sm:inline">设置</span>
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
          {completedCount > 0 && (
            <button
              onClick={() => {
                const completedTypes = Object.entries(assessments).filter(([,v]) => v.completed).map(([k]) => k);
                const first = completedTypes[0];
                if (first) navigate(`/assessment/${first === 'grip' ? 'grip' : first === 'sitstand' ? 'sitstand' : first === 'standing' ? 'standing' : 'gait'}`, { state: { viewReport: true } });
              }}
              className="mt-3 inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold transition-all"
              style={{ color: '#DC2626', background: '#FEF2F2', border: '1px solid #FCA5A530' }}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              查看已完成报告
            </button>
          )}
        </div>

        {/* 当前测试者 / 搜索选人 + 缺检提醒 */}
        {roster.length > 0 && (
          <div className="mb-5 w-full max-w-[680px] rounded-2xl px-7 py-5"
            style={{ background: '#EFF6FF', border: '1px solid #0066CC33' }}>
            {patientInfo ? (
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4 min-w-0">
                  <div className="w-14 h-14 rounded-full flex items-center justify-center text-white text-xl font-bold shrink-0"
                    style={{ background: 'var(--zeiss-blue)' }}>
                    {(patientInfo.name || '?')[0]}
                  </div>
                  <div className="min-w-0">
                    <div className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>当前：{patientInfo.name}</div>
                    <div className="text-xs mt-1 truncate" style={{ color: 'var(--text-tertiary)' }}>
                      {[patientInfo.id && `编号 ${patientInfo.id}`, patientInfo.region].filter(Boolean).join(' · ') || '—'}
                      <span className="ml-2 font-medium" style={{ color: pendingPatients.length ? '#D97706' : '#059669' }}>
                        · {pendingPatients.length ? `名单还有 ${pendingPatients.length} 人未完成` : '名单已全部完成'}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => goAdjacentPatient(1)}
                    className="text-sm px-4 py-2 rounded-lg font-semibold"
                    style={{ color: 'white', background: 'var(--zeiss-blue)', border: 'none', cursor: 'pointer' }}>
                    下一位 ›
                  </button>
                  <button onClick={() => setShowRosterPanel(true)}
                    className="text-sm px-4 py-2 rounded-lg font-semibold"
                    style={{ color: 'var(--zeiss-blue)', background: '#DBEAFE', border: '1px solid #0066CC33', cursor: 'pointer' }}>
                    查看名单
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-3">
                  <svg className="w-5 h-5 shrink-0" fill="none" stroke="var(--zeiss-blue)" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input type="text" value={searchKeyword} onChange={e => setSearchKeyword(e.target.value)}
                    placeholder="输入姓名或编号，搜索评估对象" className="zeiss-input flex-1" autoFocus />
                  <span className="text-xs shrink-0 font-medium" style={{ color: pendingPatients.length ? '#D97706' : '#059669' }}>
                    {pendingPatients.length ? `还有 ${pendingPatients.length} 人未完成` : '已全部完成'}
                  </span>
                  <button onClick={() => setShowRosterPanel(true)}
                    className="text-sm px-4 py-2 rounded-lg font-semibold shrink-0"
                    style={{ color: 'var(--zeiss-blue)', background: '#DBEAFE', border: '1px solid #0066CC33', cursor: 'pointer' }}>
                    查看名单
                  </button>
                </div>
                {searchKeyword.trim() && (() => {
                  const kw = searchKeyword.trim();
                  const matched = roster.filter(p => (p.name || '').includes(kw) || String(p.id || '').includes(kw)).slice(0, 8);
                  return (
                    <div className="mt-3 rounded-lg overflow-hidden" style={{ border: '1px solid #0066CC22' }}>
                      {matched.length ? matched.map(p => (
                        <button key={p.id || p.name}
                          onClick={() => { setSearchKeyword(''); setShowRosterPanel(false); setSwitchTarget(p); }}
                          className="w-full px-4 py-2.5 flex items-center justify-between text-left border-b hover:opacity-80 transition-all"
                          style={{ borderColor: '#0066CC11', background: 'white' }}>
                          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{p.name}</span>
                          <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{[p.id, p.region].filter(Boolean).join(' · ')}</span>
                        </button>
                      )) : (
                        <div className="px-4 py-3 text-sm text-center" style={{ color: 'var(--text-muted)', background: 'white' }}>无匹配对象</div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        )}

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

      {/* 名单导入弹窗 */}
      <RosterImportDialog open={showImport} hasExisting={roster.length > 0}
        onClose={() => setShowImport(false)} onImported={handleImported} />

      {/* 名单管理面板 */}
      <RosterPanel open={showRosterPanel} roster={roster} currentId={rosterCurrentId}
        onClose={() => setShowRosterPanel(false)} onPick={handlePickPatient}
        onAddPatient={() => setShowAddPatient(true)}
        onClear={() => { if (window.confirm('确认清空当前名单？')) { clearRoster(); setShowRosterPanel(false); } }} />

      <AddPatientDialog open={showAddPatient} roster={roster}
        defaultRegion={roster.find(p => p.region)?.region || ''}
        onClose={() => setShowAddPatient(false)} onConfirm={handleAddPatient} />

      {/* 切换/补填评估对象弹窗 */}
      <PatientSwitchDialog open={!!switchTarget} patient={switchTarget}
        onClose={() => setSwitchTarget(null)} onConfirm={handleSwitchConfirm} />

      {/* 做满四项后自动提示切换下一位 */}
      {showNextConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center zeiss-overlay animate-fadeIn">
          <div className="zeiss-dialog p-8 w-[440px] max-w-[90vw] animate-scaleIn text-center">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full flex items-center justify-center" style={{ background: '#ECFDF5' }}>
              <svg className="w-6 h-6" style={{ color: '#059669' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-lg font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
              {showNextConfirm.currentName} 四项评估已完成
            </h3>
            {showNextConfirm.next ? (
              <>
                <p className="text-sm mb-6" style={{ color: 'var(--text-tertiary)' }}>
                  是否切换到下一位：<span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{showNextConfirm.next.name}</span>
                  {showNextConfirm.next.id ? `（编号 ${showNextConfirm.next.id}）` : ''}？
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <button onClick={() => setShowNextConfirm(null)} className="zeiss-btn-secondary py-3 text-sm">留在当前</button>
                  <button onClick={() => { const n = showNextConfirm.next; setShowNextConfirm(null); setSwitchTarget(n); }}
                    className="py-3 rounded-[10px] text-sm font-semibold text-white border-none cursor-pointer" style={{ background: '#059669' }}>
                    切换到下一位
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm mb-6" style={{ color: 'var(--text-tertiary)' }}>名单已是最后一位，全部筛查完成。</p>
                <button onClick={() => setShowNextConfirm(null)} className="zeiss-btn-primary w-full py-3 text-sm">知道了</button>
              </>
            )}
          </div>
        </div>
      )}

      {/* 握力评估手套提示弹窗 */}
      {showGripTip && (
        <div className="fixed inset-0 z-50 flex items-center justify-center zeiss-overlay animate-fadeIn">
          <div className="zeiss-dialog p-8 w-[460px] max-w-[90vw] animate-scaleIn text-center">
            <div className="w-16 h-16 mx-auto mb-5 rounded-full flex items-center justify-center"
              style={{ background: '#E8F2FF' }}>
              <svg className="w-8 h-8" style={{ color: '#0066CC' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-bold mb-2" style={{ color: 'var(--text-primary)' }}>握力评估准备</h3>
            <p className="text-sm leading-relaxed mb-6" style={{ color: 'var(--text-tertiary)' }}>
              请确保被评估者已<span className="font-semibold" style={{ color: '#0066CC' }}>戴好手套</span>，并保持<span className="font-semibold" style={{ color: '#0066CC' }}>指尖贴合</span>，<span className="font-semibold" style={{ color: '#0066CC' }}>手掌朝上展开五指</span>，以确保数据采集的准确性。
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setShowGripTip(false)} className="zeiss-btn-secondary py-3 text-sm">取消</button>
              <button
                onClick={() => { setShowGripTip(false); navigate(gripTipPath); }}
                className="py-3 rounded-[10px] font-semibold text-sm text-white border-none cursor-pointer transition-all"
                style={{ background: 'var(--zeiss-blue)' }}>
                开始评估
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
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-bold mb-2" style={{ color: 'var(--text-primary)' }}>起坐能力评估准备</h3>
            <p className="text-sm leading-relaxed mb-6" style={{ color: 'var(--text-tertiary)' }}>
              请被评估者坐在椅子上，<span className="font-semibold" style={{ color: '#059669' }}>双手交叉放于胸前</span>。
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setShowSitStandTip(false)} className="zeiss-btn-secondary py-3 text-sm">取消</button>
              <button
                onClick={() => { setShowSitStandTip(false); navigate(sitStandTipPath); }}
                className="py-3 rounded-[10px] font-semibold text-sm text-white border-none cursor-pointer transition-all"
                style={{ background: '#059669' }}>
                开始评估
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
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
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

      {showComprehensiveReport && currentRecord && (
        <div className="fixed inset-0 z-40" style={{ background: 'var(--bg-primary)' }}>
          <ComprehensiveReport record={currentRecord} onClose={() => setShowComprehensiveReport(false)} />
        </div>
      )}
    </div>
  );
}
