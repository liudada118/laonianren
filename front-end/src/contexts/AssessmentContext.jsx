import React, { createContext, useContext, useState, useCallback } from 'react';
import { saveAssessmentSession } from '../lib/historyService';

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

  const login = useCallback((secretKey, institution) => {
    setState(prev => ({
      ...prev,
      secretKey,
      institution,
      isLoggedIn: true
    }));
  }, []);

  const logout = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

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
    resetAssessment
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
