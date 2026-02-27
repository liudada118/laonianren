import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { saveAssessmentSession } from '../lib/historyService';
import { backendBridge } from '../lib/BackendBridge';

const AssessmentContext = createContext(null);

const INITIAL_STATE = {
  // 登录信息
  secretKey: '',
  institution: '',
  isLoggedIn: false,
  
  // 当前评估对象（全局共享，只输入一次）
  patientInfo: null,
  
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
    return () => {
      offStatus();
      offConnect();
      offDisconnect();
    };
  }, []);

  // ─── 一键连接后端设备 ───
  const connectAllDevices = useCallback(async () => {
    try {
      setDeviceConnStatus('connecting');
      // 1. 调用后端 connPort 连接所有串口设备
      const connResult = await backendBridge.connPort();
      console.log('[一键连接] connPort result:', connResult);

      // 2. 连接 WebSocket 接收实时数据
      backendBridge.connect();

      setDeviceConnStatus('connected');
      return { success: true, data: connResult };
    } catch (err) {
      console.error('[一键连接] 失败:', err);
      setDeviceConnStatus('error');
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
    setState(INITIAL_STATE);
  }, [disconnectAllDevices]);

  const setPatientInfo = useCallback((info) => {
    setState(prev => ({ ...prev, patientInfo: info }));
  }, []);

  const completeAssessment = useCallback((type, report, data) => {
    setState(prev => {
      const assessments = { ...prev.assessments };
      assessments[type] = { completed: true, report, data };

      // 自动保存到 localStorage 历史记录
      if (prev.patientInfo) {
        try {
          saveAssessmentSession(prev.patientInfo, prev.institution, assessments);
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

  const value = {
    ...state,
    login,
    logout,
    setPatientInfo,
    completeAssessment,
    resetAssessment,
    // 设备连接相关
    deviceConnStatus,
    deviceOnlineMap,
    wsConnected,
    connectAllDevices,
    disconnectAllDevices,
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
