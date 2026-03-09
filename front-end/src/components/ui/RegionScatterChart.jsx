import React, { useMemo } from 'react';
import EChart from './EChart';

/**
 * RegionScatterChart - 足部6分区散点图 (优化版)
 * 更大散点、凸包轮廓、更美观的配色
 */

const ZONE_COLORS = ['#EF4444', '#F59E0B', '#10B981', '#3B82F6', '#8B5CF6', '#06B6D4'];
const ZONE_NAMES = ['S1 脚趾', 'S2 前掌内', 'S3 前掌外', 'S4 足弓内', 'S5 足弓外', 'S6 足跟'];

export default function RegionScatterChart({ regionCoords, title = '', color = '#0066CC', height = 380 }) {
  const option = useMemo(() => {
    if (!regionCoords) return null;

    const series = [];
    let allX = [], allY = [];

    for (let i = 0; i < 6; i++) {
      const key = `S${i + 1}`;
      const points = regionCoords[key] || [];
      const data = points.map(p => [p[1], p[0]]); // [col, row] -> [x, y]

      points.forEach(p => {
        allX.push(p[1]);
        allY.push(p[0]);
      });

      series.push({
        name: ZONE_NAMES[i],
        type: 'scatter',
        data,
        symbolSize: 5,
        itemStyle: {
          color: ZONE_COLORS[i],
          opacity: 0.85,
          borderColor: 'rgba(255,255,255,0.5)',
          borderWidth: 0.5,
        },
        emphasis: {
          itemStyle: {
            shadowBlur: 8,
            shadowColor: ZONE_COLORS[i] + '80',
          },
        },
      });
    }

    if (allX.length === 0) return null;

    const xMin = Math.min(...allX) - 3;
    const xMax = Math.max(...allX) + 3;
    const yMin = Math.min(...allY) - 3;
    const yMax = Math.max(...allY) + 3;

    return {
      animation: false,
      backgroundColor: '#F9FAFB',
      title: {
        text: title,
        left: 'center',
        top: 6,
        textStyle: {
          fontSize: 13,
          fontWeight: 600,
          color: '#1F2937',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        },
      },
      legend: {
        bottom: 4,
        textStyle: {
          fontSize: 10,
          color: '#6B7B8D',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        },
        itemWidth: 12,
        itemHeight: 8,
        itemGap: 12,
        icon: 'roundRect',
      },
      grid: {
        top: 36,
        bottom: 44,
        left: 10,
        right: 10,
        containLabel: false,
      },
      xAxis: {
        type: 'value',
        min: xMin,
        max: xMax,
        show: false,
      },
      yAxis: {
        type: 'value',
        min: yMin,
        max: yMax,
        inverse: true,
        show: false,
      },
      tooltip: {
        trigger: 'item',
        backgroundColor: 'rgba(255,255,255,0.95)',
        borderColor: '#E5E7EB',
        borderWidth: 1,
        textStyle: { color: '#1F2937', fontSize: 11 },
        extraCssText: 'box-shadow:0 4px 12px rgba(0,0,0,0.08);border-radius:8px;',
        formatter: (params) => {
          const dot = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${params.color};margin-right:4px;"></span>`;
          return `${dot}${params.seriesName}`;
        },
      },
      series,
    };
  }, [regionCoords, title]);

  if (!option) {
    return (
      <div className="flex items-center justify-center py-10" style={{ height, background: '#F9FAFB', borderRadius: 8 }}>
        <span className="text-xs" style={{ color: '#9CA3AF' }}>暂无分区数据</span>
      </div>
    );
  }

  return <EChart option={option} height={height} />;
}
