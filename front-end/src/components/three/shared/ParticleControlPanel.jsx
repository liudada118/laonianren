/**
 * ParticleControlPanel - 粒子系统参数调节面板
 *
 * 分两组：
 *   1. 数据处理（共用）：高斯模糊、过滤阈值、平滑系数、颜色范围、高度缩放
 *   2. 空间变换（独立）：X/Y/Z 位置、粒子大小、整体缩放
 *
 * Props:
 *   - params: 共用数据处理参数
 *   - onChange: (key, value) => void  共用参数变更
 *   - onReset: () => void  重置共用参数
 *   - transform: 空间变换参数
 *   - onTransformChange: (key, value) => void
 *   - onTransformReset: () => void
 *   - showHeatmap / onHeatmapChange: 热力图开关（可选）
 *   - extra: 额外的控件
 */
import React, { useState } from 'react';
import { SHARED_RANGES, TRANSFORM_RANGES } from './particleConfig';

const SHARED_KEYS = ['gaussSigma', 'filterThreshold', 'initValue', 'colorRange', 'heightScale'];
const TRANSFORM_KEYS = ['posX', 'posY', 'posZ', 'rotX', 'rotY', 'rotZ', 'particleSize', 'scale'];

function SliderRow({ paramKey, range, value, onChange }) {
  return (
    <div>
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
        onChange={e => onChange(paramKey, Number(e.target.value))}
        className="w-full h-1 rounded-full appearance-none cursor-pointer"
        style={{ background: 'var(--border-light, #e5e7eb)' }}
      />
    </div>
  );
}

export default function ParticleControlPanel({
  params,
  onChange,
  onReset,
  transform,
  onTransformChange,
  onTransformReset,
  showHeatmap,
  onHeatmapChange,
  extra,
}) {
  const [collapsed, setCollapsed] = useState(true);

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
          className="rounded-b-lg px-3 py-2.5 space-y-2"
          style={{
            background: 'rgba(255,255,255,0.92)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255,255,255,0.5)',
            borderTop: 'none',
            boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
            maxHeight: '70vh',
            overflowY: 'auto',
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

          {/* 数据处理（共用） */}
          <div>
            <div
              className="text-[10px] font-semibold mb-1.5 pb-0.5"
              style={{ color: 'var(--text-secondary, #4a5568)', borderBottom: '1px solid rgba(0,0,0,0.06)' }}
            >
              数据处理（共用）
            </div>
            <div className="space-y-2">
              {SHARED_KEYS.map(key => {
                const range = SHARED_RANGES[key];
                return (
                  <SliderRow key={key} paramKey={key} range={range} value={params[key] ?? range.min} onChange={onChange} />
                );
              })}
            </div>
            <button
              onClick={onReset}
              className="w-full text-[10px] py-1 mt-1.5 rounded-md transition-colors font-medium"
              style={{
                color: 'var(--text-muted, #9ca3af)',
                background: 'var(--bg-tertiary, #f3f4f6)',
                border: '1px solid var(--border-light, #e5e7eb)',
              }}
              onMouseEnter={e => { e.target.style.background = 'var(--bg-secondary, #e5e7eb)'; }}
              onMouseLeave={e => { e.target.style.background = 'var(--bg-tertiary, #f3f4f6)'; }}
            >
              重置数据参数
            </button>
          </div>

          {/* 空间变换（独立） */}
          {transform && onTransformChange && (
            <div>
              <div
                className="text-[10px] font-semibold mb-1.5 pb-0.5"
                style={{ color: 'var(--text-secondary, #4a5568)', borderBottom: '1px solid rgba(0,0,0,0.06)' }}
              >
                空间变换（独立）
              </div>
              <div className="space-y-2">
                {TRANSFORM_KEYS.map(key => {
                  const range = TRANSFORM_RANGES[key];
                  return (
                    <SliderRow key={key} paramKey={key} range={range} value={transform[key] ?? range.min} onChange={onTransformChange} />
                  );
                })}
              </div>
              {onTransformReset && (
                <button
                  onClick={onTransformReset}
                  className="w-full text-[10px] py-1 mt-1.5 rounded-md transition-colors font-medium"
                  style={{
                    color: 'var(--text-muted, #9ca3af)',
                    background: 'var(--bg-tertiary, #f3f4f6)',
                    border: '1px solid var(--border-light, #e5e7eb)',
                  }}
                  onMouseEnter={e => { e.target.style.background = 'var(--bg-secondary, #e5e7eb)'; }}
                  onMouseLeave={e => { e.target.style.background = 'var(--bg-tertiary, #f3f4f6)'; }}
                >
                  重置空间参数
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
