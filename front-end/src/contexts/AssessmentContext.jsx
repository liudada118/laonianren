import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { saveAssessmentSession } from '../lib/historyService';
import { backendBridge } from '../lib/BackendBridge';
import { getDeviceRegion } from '../lib/deviceRegion';
import * as rosterService from '../lib/rosterService';

const AssessmentContext = createContext(null);

function generateSessionId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
}

// 设备类型中文名映射
const DEVICE_NAME_MAP = {
  HL: '左手手套',
  HR: '右手手套',
  foot1: '脚垫1',
  foot2: '脚垫2',
  foot3: '脚垫3',
  foot4: '脚垫4',
  sit: '坐垫',
};

const INITIAL_STATE = {
  // 登录信息
  secretKey: '',
  institution: '',
  isLoggedIn: false,
  
  // 当前评估对象（全局共享，只输入一次）
  patientInfo: null,

  // 导入的评估名单与当前对象编号（街道快速采集）
  roster: [],
  rosterCurrentId: null,

  // 当前评估会话 ID（区分同名患者的不同评估）
  sessionId: generateSessionId(),
  
  // 四个评估的完成状态和数据
  assessments: {
    grip: { completed: false, report: null, data: null },
    sitstand: { completed: false, report: null, data: null },
    standing: { completed: false, report: null, data: null },
    gait: { completed: false, report: null, data: null }
  },

  // 报告延后生成的状态：采集阶段只入队不算，采完4项回首页统一生成。
  // 取值：idle(未采) | queued(已采待生成) | generating(生成中) | done(已完成) | failed(生成失败) | skipped(跳过)
  reportStatuses: {
    grip: 'idle', sitstand: 'idle', standing: 'idle', gait: 'idle',
  },
};

export function AssessmentProvider({ children }) {
  const [state, setState] = useState(() => ({
    ...INITIAL_STATE,
    roster: rosterService.getRoster(),
    rosterCurrentId: rosterService.getCurrentId(),
  }));

  // ─── 全局设备连接状态 ───
  // 'disconnected' | 'connecting' | 'connected' | 'error'
  const [deviceConnStatus, setDeviceConnStatus] = useState('disconnected');
  // 各设备在线状态 { HL: 'online', HR: 'offline', sit: 'online', foot1: 'online', ... }
  const [deviceOnlineMap, setDeviceOnlineMap] = useState({});
  // WebSocket 连接状态
  const [wsConnected, setWsConnected] = useState(false);
  // MAC 地址信息 { '/dev/ttyXXX': { uniqueId, version }, ... }
  const [macInfo, setMacInfo] = useState({});

  // 设备断开提示消息队列
  const [deviceAlerts, setDeviceAlerts] = useState([]);

  // 用 ref 跟踪上一次的设备状态，避免闭包问题
  const prevDeviceStatusRef = useRef({});
  // 设备离线防抖定时器：设备必须连续 offline 超过 5 秒才弹提示，避免报告计算阻塞导致误报
  const offlineTimersRef = useRef({});

  // 监听 BackendBridge 的设备状态事件
  useEffect(() => {
    const offStatus = backendBridge.on('deviceStatus', ({ type, status }) => {
      setDeviceOnlineMap(prev => ({ ...prev, [type]: status }));

      const prevStatus = prevDeviceStatusRef.current[type];

      if (prevStatus === 'online' && status === 'offline') {
        // 设备从 online 变为 offline，启动防抖定时器，5秒后若仍然 offline 才弹提示
        if (!offlineTimersRef.current[type]) {
          offlineTimersRef.current[type] = setTimeout(() => {
            offlineTimersRef.current[type] = null;
            // 5秒后再次检查设备是否仍然 offline
            const currentStatus = backendBridge.deviceOnline[type];
            if (currentStatus === 'offline' || currentStatus === undefined) {
              const deviceName = DEVICE_NAME_MAP[type] || type;
              const alertMsg = { id: Date.now() + '_' + type, type, deviceName, time: new Date().toLocaleTimeString() };
              setDeviceAlerts(prev => [...prev, alertMsg]);
              console.warn(`[设备断开] ${deviceName} 已断开连接`);
              // 不自动消失：需用户在弹窗里手动点「知道了」确认后才关闭
            }
          }, 5000);
        }
      } else if (status === 'online') {
        // 设备回到 online，取消防抖定时器（避免误报）
        if (offlineTimersRef.current[type]) {
          clearTimeout(offlineTimersRef.current[type]);
          offlineTimersRef.current[type] = null;
        }
      }
      prevDeviceStatusRef.current[type] = status;
    });
    const offConnect = backendBridge.on('connect', () => {
      setWsConnected(true);
    });
    const offDisconnect = backendBridge.on('disconnect', () => {
      setWsConnected(false);
    });
    const offMacInfo = backendBridge.on('macInfo', (info) => {
      console.log('[AssessmentContext] 收到MAC信息:', info);
      setMacInfo(info);
    });
    return () => {
      offStatus();
      offConnect();
      offDisconnect();
      offMacInfo();
    };
  }, []);

  // 清除设备断开提示
  const dismissDeviceAlert = useCallback((alertId) => {
    setDeviceAlerts(prev => prev.filter(a => a.id !== alertId));
  }, []);

  // ─── 一键连接后端设备 ───
  const connectAllDevices = useCallback(async () => {
    try {
      setDeviceConnStatus('connecting');

      // 1. 先连接 WebSocket，确保能接收到 macInfo 等实时消息
      if (!backendBridge.isConnected) {
        backendBridge.connect();
        // 等待 WebSocket 连接成功（最多3秒）
        await new Promise((resolve) => {
          if (backendBridge.isConnected) { resolve(); return; }
          const off = backendBridge.on('connect', () => { off(); resolve(); });
          setTimeout(() => { off(); resolve(); }, 3000);
        });
        console.log('[一键连接] WebSocket 已连接');
      }

      // 2. 调用后端 connPort 连接所有串口设备（MAC信息会通过 WebSocket 推送）
      const connResult = await backendBridge.connPort();
      console.log('[一键连接] connPort result:', connResult);

      // 同步当前地区给后端（决定垫子线序 foot1/foot4 与数据翻转）
      try { await backendBridge.setRegion(getDeviceRegion()); } catch (e) { console.warn('[一键连接] 同步地区失败:', e?.message || e); }

      setDeviceConnStatus('connected');
      return { success: true, data: connResult };
    } catch (err) {
      console.error('[一键连接] 失败:', err);
      setDeviceConnStatus('error');
      return { success: false, error: err.message };
    }
  }, []);

  // ─── 重新扫描串口（掉线重连）───
  const [rescanLoading, setRescanLoading] = useState(false);
  const rescanDevices = useCallback(async () => {
    try {
      setRescanLoading(true);
      console.log('[重新扫描] 开始...');

      // 清空设备在线状态，等待后端重新推送
      setDeviceOnlineMap({});
      backendBridge.deviceOnline = {};
      prevDeviceStatusRef.current = {};

      // 确保 WebSocket 已连接
      if (!backendBridge.isConnected) {
        backendBridge.connect();
        await new Promise((resolve) => {
          if (backendBridge.isConnected) { resolve(); return; }
          const off = backendBridge.on('connect', () => { off(); resolve(); });
          setTimeout(() => { off(); resolve(); }, 3000);
        });
      }

      const result = await backendBridge.rescanPort();
      console.log('[重新扫描] 结果:', result);
      setRescanLoading(false);
      return { success: true, data: result };
    } catch (err) {
      console.error('[重新扫描] 失败:', err);
      setRescanLoading(false);
      return { success: false, error: err.message };
    }
  }, []);

  // ─── 断开所有设备 ───
  const disconnectAllDevices = useCallback(() => {
    backendBridge.disconnect();
    setDeviceConnStatus('disconnected');
    setDeviceOnlineMap({});
    setWsConnected(false);
    prevDeviceStatusRef.current = {};
  }, []);

  const login = useCallback((secretKey, institution) => {
    setState(prev => ({
      ...prev,
      secretKey,
      institution,
      isLoggedIn: true
    }));
  }, []);

  const logout = useCallback(() => {
    disconnectAllDevices();
    // 退出登录保留已导入的名单（持久化在 localStorage）
    setState(prev => ({ ...INITIAL_STATE, roster: prev.roster, rosterCurrentId: prev.rosterCurrentId }));
  }, [disconnectAllDevices]);

  const setPatientInfo = useCallback((info) => {
    setState(prev => ({ ...prev, patientInfo: info }));
  }, []);

  // 把当前会话写入历史（本地 + 后端双写）。只发送 completed/report/assessmentId，
  // 过滤 data（原始传感器数据太大）。只要采到数据就写，哪怕报告还没生成，历史里就能看到这个人。
  const persistAssessments = (patientInfo, institution, assessments, sessionId) => {
    if (!patientInfo) return;
    const assessmentsForSave = {};
    for (const [key, val] of Object.entries(assessments)) {
      assessmentsForSave[key] = {
        completed: val.completed,
        report: val.report,
        assessmentId: val.assessmentId || null,
      };
    }
    try {
      saveAssessmentSession(patientInfo, institution, assessmentsForSave, sessionId);
    } catch (e) {
      console.error('自动保存历史记录失败:', e);
    }
    try {
      backendBridge.saveHistory({ patientInfo, institution, assessments: assessmentsForSave })
        .catch(e => console.warn('后端历史保存失败:', e?.message || e));
    } catch (e) {
      console.warn('后端历史保存异常:', e);
    }
  };

  const completeAssessment = useCallback((type, report, data, assessmentId) => {
    setState(prev => {
      const assessments = { ...prev.assessments };
      assessments[type] = { completed: true, report, data, assessmentId };
      persistAssessments(prev.patientInfo, prev.institution, assessments, prev.sessionId);
      const reportStatuses = { ...prev.reportStatuses, [type]: 'done' };
      return { ...prev, assessments, reportStatuses };
    });
  }, []);

  const resetAssessment = useCallback((type) => {
    setState(prev => {
      const assessments = { ...prev.assessments };
      assessments[type] = { completed: false, report: null, data: null };
      const reportStatuses = { ...prev.reportStatuses, [type]: 'idle' };
      return { ...prev, assessments, reportStatuses };
    });
  }, []);

  // ─── 报告延后生成：队列 + 顺序执行（采集只入队，采完4项回首页统一生成）───
  const reportQueueRef = useRef([]);        // [{ type, thunk, assessmentId }]
  const reportDrainingRef = useRef(false);

  const setReportStatus = useCallback((type, status) => {
    setState(prev => ({ ...prev, reportStatuses: { ...prev.reportStatuses, [type]: status } }));
  }, []);

  // 采集结束时调用：把"生成这份报告的动作"打包入队，不立即执行。
  // 同时把该项标记为 completed（采完即算做完，report 待队列后填）——
  // 这样换页导航/「全部完成」判断/历史都认它；并立即写入历史（有原始数据就有这个人）。
  const enqueueReport = useCallback((type, thunk, assessmentId) => {
    reportQueueRef.current = reportQueueRef.current.filter(it => it.type !== type);
    reportQueueRef.current.push({ type, thunk, assessmentId });
    setState(prev => {
      const assessments = { ...prev.assessments };
      assessments[type] = { ...(assessments[type] || {}), completed: true, report: null, assessmentId };
      persistAssessments(prev.patientInfo, prev.institution, assessments, prev.sessionId);
      const reportStatuses = { ...prev.reportStatuses, [type]: 'queued' };
      return { ...prev, assessments, reportStatuses };
    });
  }, []);

  // 顺序执行队列（首页触发）：一次只跑一个报告，避免并发抢 CPU
  const runReportQueue = useCallback(async () => {
    if (reportDrainingRef.current) return;
    reportDrainingRef.current = true;
    try {
      while (reportQueueRef.current.length > 0) {
        const item = reportQueueRef.current.shift();
        if (!item) continue;
        setReportStatus(item.type, 'generating');
        try {
          const report = await item.thunk();
          if (report) {
            // completeAssessment 内会把 reportStatus 置为 done 并写入历史
            completeAssessment(item.type, { completed: true, reportData: report }, null, item.assessmentId);
          } else {
            setReportStatus(item.type, 'failed');
          }
        } catch (e) {
          console.error(`[报告队列] ${item.type} 生成失败:`, e);
          setReportStatus(item.type, 'failed');
        }
      }
    } finally {
      reportDrainingRef.current = false;
    }
  }, [setReportStatus, completeAssessment]);

  // 失败项：跳过（标记 skipped=未测/生成失败，可补测，允许放行下一位）
  const skipReport = useCallback((type) => {
    reportQueueRef.current = reportQueueRef.current.filter(it => it.type !== type);
    setReportStatus(type, 'skipped');
  }, [setReportStatus]);

  // 失败项：重测（清空该项，回去重新采集）
  const retryReport = useCallback((type) => {
    reportQueueRef.current = reportQueueRef.current.filter(it => it.type !== type);
    resetAssessment(type);
  }, [resetAssessment]);

  // 开始新的一次评估：重置所有评估状态和患者信息，生成新 sessionId，保留登录和设备连接
  const startNewSession = useCallback(() => {
    reportQueueRef.current = [];
    setState(prev => ({
      ...prev,
      patientInfo: null,
      sessionId: generateSessionId(),
      assessments: {
        grip: { completed: false, report: null, data: null },
        sitstand: { completed: false, report: null, data: null },
        standing: { completed: false, report: null, data: null },
        gait: { completed: false, report: null, data: null },
      },
      reportStatuses: { grip: 'idle', sitstand: 'idle', standing: 'idle', gait: 'idle' },
    }));
  }, []);

  // ─── 名单导入与依次筛查（街道快速采集）───
  // 追加合并导入：保留已有名单，按编号(无编号则姓名+地区)去重，新导入覆盖同一人
  const importRoster = useCallback((list) => {
    setState(prev => {
      const keyOf = (p) => (p.id ? `id:${p.id}` : `nm:${p.name || ''}|${p.region || ''}`);
      const byKey = new Map((prev.roster || []).map(p => [keyOf(p), p]));
      for (const p of (list || [])) {
        byKey.set(keyOf(p), { ...byKey.get(keyOf(p)), ...p });
      }
      const merged = Array.from(byKey.values());
      rosterService.saveRoster(merged);
      return { ...prev, roster: merged };
    });
  }, []);

  const clearRoster = useCallback(() => {
    rosterService.clearRoster();
    setState(prev => ({ ...prev, roster: [], rosterCurrentId: null }));
  }, []);

  // 切换到名单中的某个对象：设置 patientInfo + 新会话 + 重置评估
  const switchToPatient = useCallback((p) => {
    if (!p) return;
    rosterService.setCurrentId(p.id || null);
    reportQueueRef.current = [];
    setState(prev => ({
      ...prev,
      patientInfo: {
        name: p.name || '',
        id: p.id || '',
        region: p.region || '',
        gender: p.gender || '',
        age: (p.age ?? '') === '' ? '' : p.age,
        weight: (p.weight ?? '') === '' ? '' : p.weight,
      },
      rosterCurrentId: p.id || null,
      sessionId: generateSessionId(),
      assessments: {
        grip: { completed: false, report: null, data: null },
        sitstand: { completed: false, report: null, data: null },
        standing: { completed: false, report: null, data: null },
        gait: { completed: false, report: null, data: null },
      },
      reportStatuses: { grip: 'idle', sitstand: 'idle', standing: 'idle', gait: 'idle' },
    }));
  }, []);

  // 切换弹窗里补填性别/年龄/体重，并同步到名单项
  const updateCurrentExtra = useCallback(({ gender, age, weight }) => {
    setState(prev => {
      if (!prev.patientInfo) return prev;
      const updated = { ...prev.patientInfo };
      if (gender !== undefined) updated.gender = gender;
      if (age !== undefined) updated.age = age;
      if (weight !== undefined) updated.weight = weight;
      let roster = prev.roster;
      if (updated.id) {
        roster = prev.roster.map(r =>
          r.id === updated.id
            ? { ...r, gender: updated.gender, age: updated.age, weight: updated.weight }
            : r
        );
        rosterService.saveRoster(roster);
      }
      return { ...prev, patientInfo: updated, roster };
    });
  }, []);

  // 从历史记录恢复一次评估会话（用于历史记录里单项补测：沿用同一 sessionId，补测完成后写回同一条记录）
  const resumeSession = useCallback((record) => {
    if (!record) return;
    const KEYS = ['grip', 'sitstand', 'standing', 'gait'];
    const assessments = {};
    for (const k of KEYS) {
      const a = record.assessments?.[k];
      assessments[k] = a?.completed
        ? { completed: true, report: a.report, data: null, assessmentId: a.assessmentId || null }
        : { completed: false, report: null, data: null };
    }
    setState(prev => ({
      ...prev,
      patientInfo: {
        name: record.patientName || '',
        id: record.patientId || '',
        region: record.patientRegion || '',
        gender: record.patientGender || '',
        age: (record.patientAge ?? '') === '' ? '' : record.patientAge,
        weight: (record.patientWeight ?? '') === '' ? '' : record.patientWeight,
      },
      sessionId: record.sessionId || generateSessionId(),
      assessments,
      rosterCurrentId: record.patientId || prev.rosterCurrentId,
    }));
  }, []);

  const value = {
    ...state,
    login,
    logout,
    setPatientInfo,
    completeAssessment,
    resetAssessment,
    // 报告延后生成
    enqueueReport,
    runReportQueue,
    skipReport,
    retryReport,
    startNewSession,
    importRoster,
    clearRoster,
    switchToPatient,
    updateCurrentExtra,
    resumeSession,
    // 设备连接相关
    deviceConnStatus,
    deviceOnlineMap,
    wsConnected,
    macInfo,
    connectAllDevices,
    disconnectAllDevices,
    rescanDevices,
    rescanLoading,
    backendBridge, // 暴露 backendBridge 实例供各页面使用
    // 设备断开提示
    deviceAlerts,
    dismissDeviceAlert,
  };

  return (
    <AssessmentContext.Provider value={value}>
      {children}
    </AssessmentContext.Provider>
  );
}

export function useAssessment() {
  const context = useContext(AssessmentContext);
  if (!context) {
    throw new Error('useAssessment must be used within AssessmentProvider');
  }
  return context;
}

export default AssessmentContext;
