import React, { useMemo } from 'react';
import EChart from './EChart';

/**
 * RegionScatterChart - 足部6分区散点图 (ECharts)
 * 替代 base64 分区点位图片
 *
 * Props:
 *   regionCoords: { S1: [[x,y],...], S2: [...], ..., S6: [...] }
 *   title: string
 *   color: string - 主题色
 *   height: number
 */

const ZONE_COLORS = ['#e74c3c', '#f39c12', '#2ecc71', '#3498db', '#9b59b6', '#1abc9c'];
const ZONE_NAMES = ['S1 脚趾', 'S2 前掌内', 'S3 前掌外', 'S4 足弓内', 'S5 足弓外', 'S6 足跟'];

export default function RegionScatterChart({ regionCoords, title = '', color = '#0066CC', height = 350 }) {
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
        symbolSize: 3,
        itemStyle: {
          color: ZONE_COLORS[i],
          opacity: 0.8,
        },
      });
    }

    if (allX.length === 0) return null;

    const xMin = Math.min(...allX) - 2;
    const xMax = Math.max(...allX) + 2;
    const yMin = Math.min(...allY) - 2;
    const yMax = Math.max(...allY) + 2;

    return {
      animation: false,
      title: {
        text: title,
        left: 'center',
        textStyle: { fontSize: 12, color: '#1A2332' },
      },
      legend: {
        bottom: 0,
        textStyle: { fontSize: 9, color: '#6B7B8D' },
        itemWidth: 10,
        itemHeight: 10,
      },
      grid: {
        top: 30,
        bottom: 50,
        left: 20,
        right: 20,
        containLabel: true,
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
        formatter: (params) => `${params.seriesName}<br/>坐标: (${params.data[0].toFixed(1)}, ${params.data[1].toFixed(1)})`,
      },
      series,
    };
  }, [regionCoords, title]);

  if (!option) return <div className="text-xs text-center py-8" style={{ color: '#9CA3AF' }}>暂无分区数据</div>;

  return <EChart option={option} height={height} />;
}
