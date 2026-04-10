import React from 'react';
import { useAssessment } from '../../contexts/AssessmentContext';

/**
 * 全局设备断开提示覆盖层
 * 当设备突然断开连接时，在屏幕右上角显示红色提示条
 */
export default function DeviceAlertOverlay() {
  const { deviceAlerts, dismissDeviceAlert } = useAssessment();

  if (!deviceAlerts || deviceAlerts.length === 0) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 16,
      right: 16,
      zIndex: 99999,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      maxWidth: 360,
    }}>
      {deviceAlerts.map(alert => (
        <div
          key={alert.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 16px',
            backgroundColor: '#FEF2F2',
            border: '1px solid #FECACA',
            borderLeft: '4px solid #EF4444',
            borderRadius: 8,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            animation: 'slideInRight 0.3s ease-out',
          }}
        >
          {/* 警告图标 */}
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0 }}>
            <path d="M10 2L18 17H2L10 2Z" stroke="#EF4444" strokeWidth="1.5" fill="#FEE2E2" />
            <path d="M10 8V11M10 13.5V14" stroke="#EF4444" strokeWidth="1.5" strokeLinecap="round" />
          </svg>

          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#991B1B' }}>
              设备断开连接
            </div>
            <div style={{ fontSize: 12, color: '#B91C1C', marginTop: 2 }}>
              {alert.deviceName} 已断开 ({alert.time})
            </div>
          </div>

          {/* 关闭按钮 */}
          <button
            onClick={() => dismissDeviceAlert(alert.id)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 4,
              color: '#B91C1C',
              fontSize: 16,
              lineHeight: 1,
              flexShrink: 0,
            }}
          >
            &times;
          </button>
        </div>
      ))}

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
