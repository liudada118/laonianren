import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { saveAssessmentSession } from '../lib/historyService';
import { backendBridge } from '../lib/BackendBridge';
import { setRuntimeLlmApiKey } from '../lib/gripPythonApi';

const AssessmentContext = createContext(null);

function generateSessionId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
}

const INITIAL_STATE = {
  // 登录信息
  secretKey: '',
  institution: '',
  llmApiKey: '',
  isLoggedIn: false,
  
  // 当前评估对象（全局共享，只输入一次）
  patientInfo: null,

  // 当前评估会话 ID（区分同名患者的不同评估）
  sessionId: generateSessionId(),
  
  // 四个评估的完成状态和数据
  assessments: {
    grip: { completed: false, report: null, data: null },
    sitstand: { completed: false, report: null, data: null },
    standing: { completed: false, report: null, data: null },
    gait: { completed: false, report: null, data: null }
  }
};

export function AssessmentProvider({ children }) {
  const [state, setState] = useState(INITIAL_STATE);

  // ─── 全局设备连接状态 ───
  // 'disconnected' | 'connecting' | 'connected' | 'error'
  const [deviceConnStatus, setDeviceConnStatus] = useState('disconnected');
  // 各设备在线状态 { HL: 'online', HR: 'offline', sit: 'online', foot1: 'online', ... }
  const [deviceOnlineMap, setDeviceOnlineMap] = useState({});
  // WebSocket 连接状态
  const [wsConnected, setWsConnected] = useState(false);
  // MAC 地址信息 { '/dev/ttyXXX': { uniqueId, version }, ... }
  const [macInfo, setMacInfo] = useState({});

  // 监听 BackendBridge 的设备状态事件
  useEffect(() => {
    const offStatus = backendBridge.on('deviceStatus', ({ type, status }) => {
      setDeviceOnlineMap(prev => ({ ...prev, [type]: status }));
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
  }, []);

  const login = useCallback((secretKey, institution, llmApiKey = '') => {
    const normalizedApiKey = (llmApiKey || '').trim();
    setRuntimeLlmApiKey(normalizedApiKey);

    setState(prev => ({
      ...prev,
      secretKey,
      institution,
      llmApiKey: normalizedApiKey,
      isLoggedIn: true
    }));
  }, []);

  const logout = useCallback(() => {
    disconnectAllDevices();
    setRuntimeLlmApiKey('');
    setState(INITIAL_STATE);
  }, [disconnectAllDevices]);

  const setPatientInfo = useCallback((info) => {
    setState(prev => ({ ...prev, patientInfo: info }));
  }, []);

  const completeAssessment = useCallback((type, report, data, assessmentId) => {
    setState(prev => {
      const assessments = { ...prev.assessments };
      assessments[type] = { completed: true, report, data, assessmentId };

      // 自动保存到后端数据库历史记录
      // 注意：只发送 completed 和 report，过滤掉 data 字段（原始传感器数据可能非常大，会导致请求体超过限制）
      if (prev.patientInfo) {
        const assessmentsForSave = {};
        for (const [key, val] of Object.entries(assessments)) {
          assessmentsForSave[key] = {
            completed: val.completed,
            report: val.report,
            assessmentId: val.assessmentId || null,
            // 不发送 data 字段（原始传感器数据）
          };
        }
        try {
          saveAssessmentSession(prev.patientInfo, prev.institution, assessmentsForSave, prev.sessionId);
        } catch (e) {
          console.error('自动保存历史记录失败:', e);
        }
      }

      return { ...prev, assessments };
    });
  }, []);

  const updateAssessmentAiReport = useCallback((type, aiReport, assessmentId = null) => {
    setState(prev => {
      const current = prev.assessments?.[type];
      if (!current?.completed || !current?.report?.reportData) {
        return prev;
      }

      // 防止旧请求回写覆盖新一次评估结果
      if (
        assessmentId &&
        current.assessmentId &&
        String(current.assessmentId) !== String(assessmentId)
      ) {
        return prev;
      }

      const nextReport = {
        ...(current.report || {}),
        reportData: {
          ...(current.report?.reportData || {}),
          aiReport,
        },
      };

      const assessments = {
        ...prev.assessments,
        [type]: {
          ...current,
          report: nextReport,
        },
      };

      if (prev.patientInfo) {
        const assessmentsForSave = {};
        for (const [key, val] of Object.entries(assessments)) {
          assessmentsForSave[key] = {
            completed: val.completed,
            report: val.report,
            assessmentId: val.assessmentId || null,
          };
        }
        try {
          saveAssessmentSession(prev.patientInfo, prev.institution, assessmentsForSave, prev.sessionId);
        } catch (e) {
          console.error('自动保存历史记录失败:', e);
        }
      }

      return { ...prev, assessments };
    });
  }, []);

  const resetAssessment = useCallback((type) => {
    setState(prev => {
      const assessments = { ...prev.assessments };
      assessments[type] = { completed: false, report: null, data: null };
      return { ...prev, assessments };
    });
  }, []);

  // 开始新的一次评估：重置所有评估状态和患者信息，生成新 sessionId，保留登录和设备连接
  const startNewSession = useCallback(() => {
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
    }));
  }, []);

  const value = {
    ...state,
    login,
    logout,
    setPatientInfo,
    completeAssessment,
    updateAssessmentAiReport,
    resetAssessment,
    startNewSession,
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
