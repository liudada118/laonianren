import React, { useState, useEffect, useRef, useCallback } from 'react';
import { gloveService } from '../../lib/GloveSerialService';

/**
 * 串口日志调试面板
 * 显示实时串口数据、解析帧、压力矩阵等调试信息
 * 支持模拟模式和真实串口模式
 * 可通过按钮或快捷键 Ctrl+D 切换显示/隐藏
 */
export default function SerialLogPanel({ visible = false, onToggle, simulationLogs = [] }) {
  const [logs, setLogs] = useState([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState('all'); // all | info | data | error
  const [showMatrix, setShowMatrix] = useState(false);
  const [lastLeftMatrix, setLastLeftMatrix] = useState(null);
  const [lastRightMatrix, setLastRightMatrix] = useState(null);
  const [stats, setStats] = useState({ leftFrames: 0, rightFrames: 0, leftFps: 0, rightFps: 0 });
  const logContainerRef = useRef(null);
  const maxLogs = 500;
  const statsRef = useRef(stats);
  statsRef.current = stats;

  // 添加日志
  const addLog = useCallback((message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString('zh-CN', {
      hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3
    });
    setLogs(prev => {
      const next = [...prev, { id: Date.now() + Math.random(), timestamp, message, type }];
      return next.length > maxLogs ? next.slice(-maxLogs) : next;
    });
  }, []);

  // 接收来自父组件的模拟日志
  useEffect(() => {
    if (simulationLogs.length > 0) {
      const latest = simulationLogs[simulationLogs.length - 1];
      if (latest) {
        addLog(latest.message, latest.type || 'data');
      }
    }
  }, [simulationLogs.length, addLog]);

  // 注册 gloveService 事件监听器
  useEffect(() => {
    // 日志事件
    const unsubLog = gloveService.on('log', (message, type) => {
      addLog(message, type);
    });

    // 左手数据事件
    const unsubLeft = gloveService.on('leftData', (sensorArray) => {
      const prev = statsRef.current;
      const newLeftFrames = prev.leftFrames + 1;
      setStats(s => ({
        ...s,
        leftFrames: newLeftFrames,
        leftFps: gloveService.leftFps,
        rightFps: gloveService.rightFps
      }));
      setLastLeftMatrix(sensorArray.slice(0, 256));

      // 每50帧记录一次数据摘要
      if (newLeftFrames % 50 === 0) {
        const max = Math.max(...sensorArray);
        const sum = sensorArray.reduce((a, b) => a + b, 0);
        const avg = (sum / sensorArray.length).toFixed(1);
        addLog(`左手数据 #${newLeftFrames}: max=${max}, avg=${avg}, sum=${sum}`, 'data');
      }
    });

    // 右手数据事件
    const unsubRight = gloveService.on('rightData', (sensorArray) => {
      const prev = statsRef.current;
      const newRightFrames = prev.rightFrames + 1;
      setStats(s => ({
        ...s,
        rightFrames: newRightFrames,
        leftFps: gloveService.leftFps,
        rightFps: gloveService.rightFps
      }));
      setLastRightMatrix(sensorArray.slice(0, 256));

      if (newRightFrames % 50 === 0) {
        const max = Math.max(...sensorArray);
        const sum = sensorArray.reduce((a, b) => a + b, 0);
        const avg = (sum / sensorArray.length).toFixed(1);
        addLog(`右手数据 #${newRightFrames}: max=${max}, avg=${avg}, sum=${sum}`, 'data');
      }
    });

    // 快捷键 Ctrl+D 切换面板
    const handleKeyDown = (e) => {
      if (e.ctrlKey && e.key === 'd') {
        e.preventDefault();
        if (onToggle) onToggle();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      unsubLog();
      unsubLeft();
      unsubRight();
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [addLog, onToggle]);

  // 自动滚动
  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  if (!visible) return null;

  const filteredLogs = filter === 'all' ? logs : logs.filter(l => l.type === filter);

  const typeColors = {
    info: '#60A5FA',
    data: '#34D399',
    error: '#F87171',
    warn: '#FBBF24',
    sim: '#A78BFA'
  };

  // 渲染 16x16 矩阵的小型可视化
  const renderMiniMatrix = (matrix) => {
    if (!matrix || matrix.length < 256) return null;
    const maxVal = Math.max(...matrix.slice(0, 256), 1);
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(16, 1fr)', gap: '1px', width: '160px', height: '160px' }}>
        {matrix.slice(0, 256).map((val, i) => {
          const intensity = Math.round((val / maxVal) * 255);
          return (
            <div key={i} style={{
              background: `rgb(${intensity}, ${Math.round(intensity * 0.3)}, ${Math.round(intensity * 0.1)})`,
              width: '100%',
              height: '100%',
              borderRadius: '1px'
            }} title={`[${Math.floor(i / 16)},${i % 16}]=${val}`} />
          );
        })}
      </div>
    );
  };

  return (
    <div style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      height: showMatrix ? '380px' : '240px',
      background: 'rgba(15, 23, 42, 0.95)',
      backdropFilter: 'blur(8px)',
      borderTop: '1px solid rgba(100, 116, 139, 0.3)',
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column',
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      fontSize: '11px',
      color: '#CBD5E1'
    }}>
      {/* 工具栏 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '4px 12px',
        borderBottom: '1px solid rgba(100, 116, 139, 0.2)',
        background: 'rgba(30, 41, 59, 0.8)',
        flexShrink: 0
      }}>
        <span style={{ color: '#94A3B8', fontWeight: 600, fontSize: '11px' }}>串口调试</span>
        <span style={{ color: '#475569' }}>|</span>

        {/* 状态指示 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <div style={{
            width: '6px', height: '6px', borderRadius: '50%',
            background: gloveService.connected ? '#34D399' : '#64748B'
          }} />
          <span style={{ color: gloveService.connected ? '#34D399' : '#64748B', fontSize: '10px' }}>
            {gloveService.connected ? '已连接' : '未连接'}
          </span>
        </div>

        {/* 统计 */}
        <span style={{ color: '#64748B', fontSize: '10px' }}>
          L:{stats.leftFrames} R:{stats.rightFrames} FPS:L{stats.leftFps}/R{stats.rightFps}
        </span>

        <span style={{ color: '#475569' }}>|</span>

        {/* 过滤器 */}
        {['all', 'info', 'data', 'error'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{
              padding: '1px 6px',
              borderRadius: '3px',
              border: 'none',
              cursor: 'pointer',
              fontSize: '10px',
              background: filter === f ? 'rgba(59, 130, 246, 0.3)' : 'transparent',
              color: filter === f ? '#60A5FA' : '#64748B'
            }}>
            {f === 'all' ? '全部' : f}
          </button>
        ))}

        <span style={{ color: '#475569' }}>|</span>

        {/* 矩阵可视化切换 */}
        <button onClick={() => setShowMatrix(!showMatrix)}
          style={{
            padding: '1px 6px', borderRadius: '3px', border: 'none', cursor: 'pointer', fontSize: '10px',
            background: showMatrix ? 'rgba(52, 211, 153, 0.2)' : 'transparent',
            color: showMatrix ? '#34D399' : '#64748B'
          }}>
          矩阵
        </button>

        <div style={{ flex: 1 }} />

        {/* 自动滚动 */}
        <button onClick={() => setAutoScroll(!autoScroll)}
          style={{
            padding: '1px 6px', borderRadius: '3px', border: 'none', cursor: 'pointer', fontSize: '10px',
            background: autoScroll ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
            color: autoScroll ? '#60A5FA' : '#64748B'
          }}>
          {autoScroll ? '自动滚动' : '手动滚动'}
        </button>

        {/* 清除 */}
        <button onClick={() => { setLogs([]); setStats({ leftFrames: 0, rightFrames: 0, leftFps: 0, rightFps: 0 }); }}
          style={{ padding: '1px 6px', borderRadius: '3px', border: 'none', cursor: 'pointer', fontSize: '10px', color: '#64748B', background: 'transparent' }}>
          清除
        </button>

        {/* 关闭 */}
        <button onClick={onToggle}
          style={{ padding: '1px 6px', borderRadius: '3px', border: 'none', cursor: 'pointer', fontSize: '10px', color: '#94A3B8', background: 'transparent' }}>
          ✕
        </button>
      </div>

      {/* 内容区 */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* 日志列表 */}
        <div ref={logContainerRef} style={{
          flex: 1,
          overflowY: 'auto',
          padding: '4px 12px'
        }}>
          {filteredLogs.length === 0 ? (
            <div style={{ color: '#475569', padding: '20px', textAlign: 'center' }}>
              暂无日志 · 连接手套或开始模拟后将显示数据
              <br />
              <span style={{ fontSize: '10px' }}>快捷键 Ctrl+D 切换面板</span>
            </div>
          ) : (
            filteredLogs.map(log => (
              <div key={log.id} style={{ display: 'flex', gap: '8px', padding: '1px 0', lineHeight: '16px' }}>
                <span style={{ color: '#475569', flexShrink: 0 }}>{log.timestamp}</span>
                <span style={{
                  color: typeColors[log.type] || '#CBD5E1',
                  padding: '0 3px',
                  borderRadius: '2px',
                  background: `${typeColors[log.type] || '#CBD5E1'}15`,
                  flexShrink: 0,
                  fontSize: '10px',
                  lineHeight: '16px'
                }}>
                  {log.type}
                </span>
                <span style={{ color: '#E2E8F0', wordBreak: 'break-all' }}>{log.message}</span>
              </div>
            ))
          )}
        </div>

        {/* 矩阵可视化 */}
        {showMatrix && (
          <div style={{
            width: '380px',
            borderLeft: '1px solid rgba(100, 116, 139, 0.2)',
            padding: '8px',
            display: 'flex',
            gap: '8px',
            flexShrink: 0,
            overflowY: 'auto'
          }}>
            <div>
              <div style={{ color: '#60A5FA', fontSize: '10px', fontWeight: 600, marginBottom: '4px', textAlign: 'center' }}>左手 16×16</div>
              {lastLeftMatrix ? renderMiniMatrix(lastLeftMatrix) : (
                <div style={{ width: '160px', height: '160px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', fontSize: '10px', border: '1px dashed #334155', borderRadius: '4px' }}>
                  无数据
                </div>
              )}
            </div>
            <div>
              <div style={{ color: '#34D399', fontSize: '10px', fontWeight: 600, marginBottom: '4px', textAlign: 'center' }}>右手 16×16</div>
              {lastRightMatrix ? renderMiniMatrix(lastRightMatrix) : (
                <div style={{ width: '160px', height: '160px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', fontSize: '10px', border: '1px dashed #334155', borderRadius: '4px' }}>
                  无数据
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
