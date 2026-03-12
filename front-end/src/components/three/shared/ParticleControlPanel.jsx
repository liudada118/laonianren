/**
 * ParticleControlPanel - 粒子系统共用参数调节面板
 *
 * 浮动在 3D 可视化区域右上角，提供以下参数调节：
 *   - 高斯模糊 (gaussSigma)
 *   - 过滤阈值 (filterThreshold)
 *   - 平滑系数 (initValue)
 *   - 颜色范围 (colorRange)
 *   - 高度缩放 (heightScale)
 *
 * Props:
 *   - params: 当前参数对象
 *   - onChange: (key, value) => void
 *   - onReset: () => void
 *   - showHeatmap / onHeatmapChange: 热力图开关（可选）
 *   - extra: 额外的控件（如滤波开关等）
 */
import React, { useState } from 'react';
import { PARAM_RANGES } from './particleConfig';

const PARAM_KEYS = ['gaussSigma', 'filterThreshold', 'initValue', 'colorRange', 'heightScale'];

export default function ParticleControlPanel({
  params,
  onChange,
  onReset,
  showHeatmap,
  onHeatmapChange,
  extra,
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div
      className="absolute top-3 right-3 z-10 flex flex-col gap-0 select-none"
      style={{ minWidth: collapsed ? '36px' : '180px', maxWidth: '220px', transition: 'min-width 0.2s' }}
    >
      {/* 标题栏 */}
      <div
        className="flex items-center justify-between rounded-t-lg px-3 py-2 cursor-pointer"
        style={{
          background: 'rgba(255,255,255,0.92)',
          backdropFilter: 'blur(12px)',
          borderBottom: collapsed ? 'none' : '1px solid rgba(0,0,0,0.06)',
          borderRadius: collapsed ? '8px' : undefined,
        }}
        onClick={() => setCollapsed(!collapsed)}
      >
        {!collapsed && (
          <span className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary, #4a5568)' }}>
            参数调节
          </span>
        )}
        <svg
          className="w-3.5 h-3.5 transition-transform"
          style={{ color: 'var(--text-muted, #9ca3af)', transform: collapsed ? 'rotate(180deg)' : 'none' }}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {/* 参数面板 */}
      {!collapsed && (
        <div
          className="rounded-b-lg px-3 py-2.5 space-y-2.5"
          style={{
            background: 'rgba(255,255,255,0.92)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255,255,255,0.5)',
            borderTop: 'none',
            boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
          }}
        >
          {/* 热力图开关 */}
          {onHeatmapChange && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showHeatmap}
                onChange={e => onHeatmapChange(e.target.checked)}
                className="w-3.5 h-3.5 rounded accent-blue-500"
              />
              <span className="text-[11px] font-medium" style={{ color: 'var(--text-secondary, #4a5568)' }}>
                热力图
              </span>
            </label>
          )}

          {/* 额外控件插槽 */}
          {extra}

          {/* 参数滑块 */}
          {PARAM_KEYS.map(key => {
            const range = PARAM_RANGES[key];
            const value = params[key] ?? range.min;
            return (
              <div key={key}>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[10px] font-medium" style={{ color: 'var(--text-muted, #9ca3af)' }}>
                    {range.label}
                  </span>
                  <span className="text-[10px] tabular-nums font-mono" style={{ color: 'var(--text-muted, #9ca3af)' }}>
                    {typeof value === 'number' ? (Number.isInteger(range.step) ? value : value.toFixed(1)) : value}
                    {range.unit ? ` ${range.unit}` : ''}
                  </span>
                </div>
                <input
                  type="range"
                  min={range.min}
                  max={range.max}
                  step={range.step}
                  value={value}
                  onChange={e => onChange(key, Number(e.target.value))}
                  className="w-full h-1 rounded-full appearance-none cursor-pointer"
                  style={{ background: 'var(--border-light, #e5e7eb)' }}
                />
              </div>
            );
          })}

          {/* 重置按钮 */}
          <button
            onClick={onReset}
            className="w-full text-[10px] py-1.5 rounded-md transition-colors font-medium"
            style={{
              color: 'var(--text-muted, #9ca3af)',
              background: 'var(--bg-tertiary, #f3f4f6)',
              border: '1px solid var(--border-light, #e5e7eb)',
            }}
            onMouseEnter={e => { e.target.style.background = 'var(--bg-secondary, #e5e7eb)'; }}
            onMouseLeave={e => { e.target.style.background = 'var(--bg-tertiary, #f3f4f6)'; }}
          >
            恢复默认
          </button>
        </div>
      )}
    </div>
  );
}
