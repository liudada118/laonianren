import React, { useRef, useEffect, useCallback } from 'react';
import * as echarts from 'echarts';

/**
 * 高性能 EChart 组件
 * - 只在挂载时初始化一次 echarts 实例
 * - 数据更新时使用 setOption 增量更新，不销毁重建
 * - 使用 ResizeObserver 自适应容器大小
 * - 支持 notMerge 参数控制合并行为
 */
export default function EChart({ option, height = 220, notMerge = false, className = '' }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const roRef = useRef(null);

  // 初始化 chart 实例（只执行一次）
  useEffect(() => {
    if (!containerRef.current) return;

    // 创建 echarts 实例
    const chart = echarts.init(containerRef.current, null, { renderer: 'canvas' });
    chartRef.current = chart;

    // 监听容器大小变化
    const ro = new ResizeObserver(() => {
      if (chartRef.current && !chartRef.current.isDisposed()) {
        chartRef.current.resize({ animation: { duration: 0 } });
      }
    });
    ro.observe(containerRef.current);
    roRef.current = ro;

    return () => {
      ro.disconnect();
      if (chart && !chart.isDisposed()) {
        chart.dispose();
      }
      chartRef.current = null;
    };
  }, []); // 空依赖，只初始化一次

  // 数据更新时增量更新（不销毁重建）
  useEffect(() => {
    if (!chartRef.current || chartRef.current.isDisposed() || !option) return;
    
    // 使用 setOption 增量更新，关闭动画避免闪烁
    chartRef.current.setOption(option, {
      notMerge,
      lazyUpdate: true,
      silent: true,
    });
  }, [option, notMerge]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: '100%', height }}
    />
  );
}
