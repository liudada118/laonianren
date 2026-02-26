import { useRef, useEffect, useState, useMemo } from 'react';
import * as echarts from 'echarts';
import InteractiveArchChart from './InteractiveArchChart';
import InteractiveCOPChart from './InteractiveCOPChart';

/* ─── 蔡司风格 EChart 封装（增量更新，避免闪烁） ─── */
function EChart({ option, height = 280 }) {
  const ref = useRef(null);
  const chartRef = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    if (!chartRef.current) {
      chartRef.current = echarts.init(ref.current);
    }
    chartRef.current.setOption(option, { notMerge: false });
    const ro = new ResizeObserver(() => chartRef.current?.resize());
    ro.observe(ref.current);
    return () => { ro.disconnect(); };
  }, [option]);
  useEffect(() => {
    return () => { chartRef.current?.dispose(); chartRef.current = null; };
  }, []);
  return <div ref={ref} style={{ width: '100%', height }} />;
}

/* ─── 报告目录 ─── */
const SECTIONS = [
  { id: 'overview', label: '基本信息与足弓指标' },
  { id: 'arch-zones', label: '足弓区域分布图' },
  { id: 'pressure', label: '区域压力分布' },
  { id: 'cop-heatmap', label: 'COP 压力中心轨迹' },
  { id: 'cop-trajectory', label: 'COP 轨迹' },
  { id: 'cop-ellipse', label: 'COP 置信椭圆' },
  { id: 'cop-velocity', label: 'COP 速度时间序列' },
  { id: 'cop-params', label: 'COP 参数表' },
  { id: 'annotation', label: '参数说明' },
  { id: 'summary', label: '综合评估' },
];

export default function StandingReport({ reportData, patientInfo, onClose }) {
  const [activeSection, setActiveSection] = useState('overview');
  const contentRef = useRef(null);
  const data = useMemo(() => {
    if (!reportData) return generateMockReport();
    // 将 generateFootReport 输出转换为报告组件期望的格式
    const r = reportData;
    const leftArch = r.left?.archAnalysis || {};
    const rightArch = r.right?.archAnalysis || {};
    const leftFoot = r.left?.footData || {};
    const rightFoot = r.right?.footData || {};
    const leftRegion = r.left?.regionPressure || {};
    const rightRegion = r.right?.regionPressure || {};
    const bil = r.bilateral || {};
    const copTraj = bil.copTrajectory || [];
    const copMet = bil.copMetrics || {};

    // COP 轨迹转换
    const leftCop = [], rightCop = [];
    copTraj.forEach(p => {
      if (p.y < 32) leftCop.push([p.x, p.y]);
      else rightCop.push([p.x, p.y]);
    });
    // 如果没有分离左右，全部放到两边
    if (leftCop.length === 0 && rightCop.length === 0) {
      copTraj.forEach(p => {
        leftCop.push([p.x, p.y]);
        rightCop.push([p.x, p.y]);
      });
    }

    // 速度序列
    const velocitySeries = [];
    const timePoints = [];
    for (let i = 1; i < copTraj.length; i++) {
      const dx = (copTraj[i].x - copTraj[i-1].x) * 7.0;
      const dy = (copTraj[i].y - copTraj[i-1].y) * 7.0;
      const dist = Math.sqrt(dx*dx + dy*dy);
      const dt = 0.05; // ~20fps
      velocitySeries.push(dist / dt);
      timePoints.push(i * dt);
    }

    // 置信椭圆计算
    const calcEllipse = (pts) => {
      if (pts.length < 3) return { center: [0,0], width: 0, height: 0, angle: 0, area_cm2: 0 };
      const cx = pts.reduce((s,p) => s+p[0], 0) / pts.length;
      const cy = pts.reduce((s,p) => s+p[1], 0) / pts.length;
      const dx = pts.map(p => (p[0]-cx)*7.0);
      const dy = pts.map(p => (p[1]-cy)*7.0);
      const n = pts.length;
      const covXX = dx.reduce((s,x) => s+x*x, 0)/n;
      const covYY = dy.reduce((s,y) => s+y*y, 0)/n;
      const covXY = dx.reduce((s,x,i) => s+x*dy[i], 0)/n;
      const trace = covXX + covYY;
      const det = covXX*covYY - covXY*covXY;
      const disc = Math.sqrt(Math.max(0, trace*trace/4 - det));
      const l1 = trace/2 + disc, l2 = trace/2 - disc;
      const chi = 5.991;
      const w = 2*Math.sqrt(chi*Math.max(l1,l2));
      const h = 2*Math.sqrt(chi*Math.min(l1,l2));
      const angle = covXY !== 0 ? Math.atan2(2*covXY, covXX-covYY)*90/Math.PI : 0;
      return { center: [cx, cy], width: w/7, height: h/7, angle, area_cm2: Math.PI*w*h/4/100 };
    };

    return {
      left: {
        archIndex: leftArch.archIndex,
        length: r.left?.length || 0,
        width: r.left?.width || 0,
        totalArea: leftFoot.area || 0,
        forefootArea: leftRegion.forefoot?.area || 0,
        midfootArea: leftRegion.midfoot?.area || 0,
        hindfootArea: leftRegion.hindfoot?.area || 0,
        forefootPressure: leftRegion.forefoot?.percent || 0,
        midfootPressure: leftRegion.midfoot?.percent || 0,
        hindfootPressure: leftRegion.hindfoot?.percent || 0,
        regionPressure: {
          forefoot: leftRegion.forefoot?.percent || 0,
          midfoot: leftRegion.midfoot?.percent || 0,
          hindfoot: leftRegion.hindfoot?.percent || 0,
        },
      },
      right: {
        archIndex: rightArch.archIndex,
        length: r.right?.length || 0,
        width: r.right?.width || 0,
        totalArea: rightFoot.area || 0,
        forefootArea: rightRegion.forefoot?.area || 0,
        midfootArea: rightRegion.midfoot?.area || 0,
        hindfootArea: rightRegion.hindfoot?.area || 0,
        forefootPressure: rightRegion.forefoot?.percent || 0,
        midfootPressure: rightRegion.midfoot?.percent || 0,
        hindfootPressure: rightRegion.hindfoot?.percent || 0,
        regionPressure: {
          forefoot: rightRegion.forefoot?.percent || 0,
          midfoot: rightRegion.midfoot?.percent || 0,
          hindfoot: rightRegion.hindfoot?.percent || 0,
        },
      },
      bilateral: {
        leftPressureRatio: bil.leftPressureRatio || 50,
        rightPressureRatio: bil.rightPressureRatio || 50,
      },
      copData: { leftCop, rightCop },
      ellipseData: {
        left: calcEllipse(leftCop),
        right: calcEllipse(rightCop),
      },
      copTimeSeries: {
        velocitySeries, timePoints,
        pathLength: copMet.pathLength || 0,
        contactArea: copMet.ellipseArea || 0,
        lsRatio: copMet.majorAxis && copMet.minorAxis ? (copMet.majorAxis / Math.max(0.01, copMet.minorAxis)) : 0,
        eccentricity: copMet.majorAxis ? Math.sqrt(1 - Math.pow(Math.min(copMet.minorAxis, copMet.majorAxis) / Math.max(0.01, copMet.majorAxis), 2)) : 0,
        deltaY: copMet.rangeY || 0,
        deltaX: copMet.rangeX || 0,
        majorAxis: copMet.majorAxis || 0,
        minorAxis: copMet.minorAxis || 0,
        maxDisplacement: copMet.maxDisplacement || 0,
        minDisplacement: 0,
        avgVelocity: copMet.avgVelocity || 0,
        rmsDisplacement: copMet.stdX ? Math.sqrt(copMet.stdX*copMet.stdX + copMet.stdY*copMet.stdY) : 0,
        stdY: copMet.stdY || 0,
        stdX: copMet.stdX || 0,
      },
      // 原始数据（用于Canvas图表）
      rawData: {
        leftSectionCoords: r.left?.sectionCoords || null,
        rightSectionCoords: r.right?.sectionCoords || null,
        leftCopTrajectory: bil.leftCopTrajectory || [],
        rightCopTrajectory: bil.rightCopTrajectory || [],
        peakFrameFlat: bil.peakFrameFlat || [],
      },
      additionalData: {
        copResults: {
          distLeftToBoth: leftFoot.cop && rightFoot.cop ? Math.sqrt(Math.pow((leftFoot.cop.x - (leftFoot.cop.x + rightFoot.cop.x)/2)*7/10, 2) + Math.pow((leftFoot.cop.y - (leftFoot.cop.y + rightFoot.cop.y)/2)*7/10, 2)) : 0,
          distRightToBoth: leftFoot.cop && rightFoot.cop ? Math.sqrt(Math.pow((rightFoot.cop.x - (leftFoot.cop.x + rightFoot.cop.x)/2)*7/10, 2) + Math.pow((rightFoot.cop.y - (leftFoot.cop.y + rightFoot.cop.y)/2)*7/10, 2)) : 0,
          leftForward: leftFoot.cop && rightFoot.cop ? (leftFoot.cop.x - rightFoot.cop.x)*7/10 : 0,
        }
      }
    };
  }, [reportData]);

  const scrollToSection = (id) => {
    const el = document.getElementById(`standing-${id}`);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); setActiveSection(id); }
  };

  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;
    const handleScroll = () => {
      const sections = SECTIONS.map(s => document.getElementById(`standing-${s.id}`)).filter(Boolean);
      for (let i = sections.length - 1; i >= 0; i--) {
        if (sections[i].getBoundingClientRect().top <= 200) { setActiveSection(SECTIONS[i].id); break; }
      }
    };
    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  /* ─── 图表样式 ─── */
  const chartText = '#6B7B8D';
  const gridLine = '#EDF0F4';
  const tooltipStyle = { backgroundColor: '#fff', borderColor: '#E5E9EF', textStyle: { color: '#1A2332' }, extraCssText: 'box-shadow:0 4px 20px rgba(0,0,0,0.08);border-radius:8px;' };

  /* ─── 区域压力饼图 ─── */
  const regionPieOption = (side, rd) => ({
    tooltip: { trigger: 'item', formatter: '{b}: {c}%', ...tooltipStyle },
    legend: { bottom: 5, textStyle: { fontSize: 11, color: chartText } },
    series: [{
      type: 'pie', radius: ['38%', '68%'], center: ['50%', '45%'],
      itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 3 },
      label: { show: true, formatter: '{b}\n{d}%', fontSize: 11, color: chartText },
      data: [
        { value: rd.forefoot.toFixed(1), name: '前足', itemStyle: { color: '#0066CC' } },
        { value: rd.midfoot.toFixed(1), name: '中足', itemStyle: { color: '#059669' } },
        { value: rd.hindfoot.toFixed(1), name: '后足', itemStyle: { color: '#D97706' } }
      ]
    }]
  });

  /* ─── COP 轨迹图（左脚+右脚） ─── */
  const copTrajectoryOption = useMemo(() => {
    const leftPts = (data.copData?.leftCop || []).map((p, i) => [p[1], p[0]]);
    const rightPts = (data.copData?.rightCop || []).map((p, i) => [p[1], p[0]]);
    return {
      tooltip: tooltipStyle,
      legend: { data: ['左脚', '右脚'], bottom: 5, textStyle: { color: chartText } },
      grid: { top: 30, bottom: 50, left: 60, right: 30 },
      xAxis: { name: '左右摆动', type: 'value', nameLocation: 'center', nameGap: 30, nameTextStyle: { color: chartText }, axisLabel: { color: chartText }, splitLine: { lineStyle: { color: gridLine } } },
      yAxis: { name: '前后摆动', type: 'value', nameLocation: 'center', nameGap: 40, nameTextStyle: { color: chartText }, axisLabel: { color: chartText }, splitLine: { lineStyle: { color: gridLine } } },
      visualMap: [{
        show: true, dimension: 2, min: 0, max: Math.max(leftPts.length, rightPts.length),
        inRange: { color: ['#440154', '#31688e', '#35b779', '#fde725'] },
        orient: 'vertical', right: 0, top: 30, bottom: 60,
        text: ['后', '先'], textStyle: { color: chartText, fontSize: 10 },
        calculable: false
      }],
      series: [
        {
          name: '左脚', type: 'scatter',
          data: leftPts.map((p, i) => [...p, i]),
          symbolSize: 4, encode: { x: 0, y: 1 }
        },
        {
          name: '右脚', type: 'scatter',
          data: rightPts.map((p, i) => [...p, i]),
          symbolSize: 4, encode: { x: 0, y: 1 }
        }
      ]
    };
  }, [data]);

  /* ─── COP 置信椭圆图 ─── */
  const copEllipseOption = useMemo(() => {
    const leftPts = (data.copData?.leftCop || []).map(p => [p[1], p[0]]);
    const rightPts = (data.copData?.rightCop || []).map(p => [p[1], p[0]]);
    const ellipseLeft = data.ellipseData?.left;
    const ellipseRight = data.ellipseData?.right;

    const series = [];
    if (leftPts.length > 0) {
      series.push({
        name: '左脚COP', type: 'scatter', data: leftPts,
        symbolSize: 3, itemStyle: { color: '#0066CC', opacity: 0.5 }
      });
    }
    if (rightPts.length > 0) {
      series.push({
        name: '右脚COP', type: 'scatter', data: rightPts,
        symbolSize: 3, itemStyle: { color: '#DC2626', opacity: 0.5 }
      });
    }

    // 用参数方程绘制椭圆
    const drawEllipse = (ellipse, color, name) => {
      if (!ellipse) return;
      const { center, width, height, angle } = ellipse;
      const cx = center[1], cy = center[0];
      const a = width / 2, b = height / 2;
      const rad = (angle || 0) * Math.PI / 180;
      const pts = [];
      for (let t = 0; t <= 2 * Math.PI; t += 0.05) {
        const x = a * Math.cos(t);
        const y = b * Math.sin(t);
        const rx = cx + x * Math.cos(rad) - y * Math.sin(rad);
        const ry = cy + x * Math.sin(rad) + y * Math.cos(rad);
        pts.push([rx, ry]);
      }
      pts.push(pts[0]);
      series.push({
        name, type: 'line', data: pts, showSymbol: false,
        lineStyle: { color, width: 2, type: 'solid' },
        areaStyle: { color: color + '20' }
      });
      // 中心点
      series.push({
        type: 'scatter', data: [[cx, cy]], symbolSize: 10,
        itemStyle: { color, borderColor: '#fff', borderWidth: 2 }
      });
    };

    drawEllipse(ellipseLeft, '#0066CC', '左脚椭圆');
    drawEllipse(ellipseRight, '#DC2626', '右脚椭圆');

    return {
      tooltip: tooltipStyle,
      legend: { data: ['左脚COP', '右脚COP', '左脚椭圆', '右脚椭圆'], bottom: 5, textStyle: { color: chartText } },
      grid: { top: 30, bottom: 50, left: 60, right: 30 },
      xAxis: { name: '左右摆动', type: 'value', nameLocation: 'center', nameGap: 30, nameTextStyle: { color: chartText }, axisLabel: { color: chartText }, splitLine: { lineStyle: { color: gridLine } } },
      yAxis: { name: '前后摆动', type: 'value', nameLocation: 'center', nameGap: 40, nameTextStyle: { color: chartText }, axisLabel: { color: chartText }, splitLine: { lineStyle: { color: gridLine } } },
      series
    };
  }, [data]);

  /* ─── COP 速度时间序列 ─── */
  const copVelocityOption = useMemo(() => {
    const velocity = data.copTimeSeries?.velocitySeries || [];
    const timePoints = data.copTimeSeries?.timePoints || [];
    const chartData = velocity.map((v, i) => [timePoints[i] || i * 0.024, v]);
    return {
      tooltip: { trigger: 'axis', ...tooltipStyle, formatter: (p) => `时间: ${p[0]?.value?.[0]?.toFixed(2)}s<br/>速度: ${p[0]?.value?.[1]?.toFixed(2)} mm/s` },
      grid: { top: 30, bottom: 40, left: 60, right: 20 },
      xAxis: { name: '时间 (s)', type: 'value', nameLocation: 'center', nameGap: 25, nameTextStyle: { color: chartText }, axisLabel: { color: chartText }, splitLine: { lineStyle: { color: gridLine } } },
      yAxis: { name: '速度 (mm/s)', type: 'value', nameLocation: 'center', nameGap: 40, nameTextStyle: { color: chartText }, axisLabel: { color: chartText }, splitLine: { lineStyle: { color: gridLine } } },
      series: [{
        type: 'line', data: chartData, showSymbol: false,
        lineStyle: { color: '#0066CC', width: 1.5 },
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: '#0066CC30' }, { offset: 1, color: '#0066CC05' }]) }
      }]
    };
  }, [data]);

  /* ─── 平衡柱状图 ─── */
  const balanceBarOption = useMemo(() => ({
    tooltip: tooltipStyle,
    grid: { top: 30, bottom: 30, left: 50, right: 20 },
    xAxis: { type: 'category', data: ['左脚', '右脚'], axisLabel: { color: chartText, fontSize: 12 }, axisLine: { lineStyle: { color: gridLine } } },
    yAxis: { type: 'value', max: 100, axisLabel: { formatter: '{value}%', color: chartText }, splitLine: { lineStyle: { color: gridLine } } },
    series: [{
      type: 'bar', barWidth: '40%',
      data: [
        { value: data.bilateral.leftPressureRatio.toFixed(1), itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: '#0066CC' }, { offset: 1, color: '#0066CC30' }]), borderRadius: [8, 8, 0, 0] } },
        { value: data.bilateral.rightPressureRatio.toFixed(1), itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: '#DC2626' }, { offset: 1, color: '#DC262630' }]), borderRadius: [8, 8, 0, 0] } }
      ],
      label: { show: true, position: 'top', formatter: '{c}%', fontWeight: 'bold', color: chartText }
    }]
  }), [data]);

  /* ─── COP 参数表数据 ─── */
  const copParams = useMemo(() => {
    const ts = data.copTimeSeries || {};
    return [
      { name: '压力中心轨迹长度', value: ts.pathLength, unit: 'mm' },
      { name: '压力中心活动总面积', value: ts.contactArea, unit: 'mm²' },
      { name: '压力中心摆动稳定系数', value: ts.lsRatio, unit: '' },
      { name: '压力中心摆动均匀系数', value: ts.eccentricity, unit: '' },
      { name: '压力中心左右摆动幅度系数', value: ts.deltaY, unit: 'mm' },
      { name: '压力中心前后摆动幅度系数', value: ts.deltaX, unit: 'mm' },
      { name: '压力中心最大摆幅', value: ts.majorAxis, unit: 'mm' },
      { name: '压力中心稳定摆幅', value: ts.minorAxis, unit: 'mm' },
      { name: '压力中心最大离心', value: ts.maxDisplacement, unit: 'mm' },
      { name: '压力中心最小离心', value: ts.minDisplacement, unit: 'mm' },
      { name: '压力中心偏移平均速度', value: ts.avgVelocity, unit: 'mm/s' },
      { name: '压力中心摆动强度', value: ts.rmsDisplacement, unit: 'mm' },
      { name: '压力中心左右方向标准差', value: ts.stdY, unit: 'mm' },
      { name: '压力中心前后方向标准差', value: ts.stdX, unit: 'mm' },
    ];
  }, [data]);

  /* ─── 12项足弓指标 ─── */
  const archMetrics = useMemo(() => {
    const left = data.left;
    const right = data.right;
    const add = data.additionalData || {};
    const cop = add.copResults || {};

    const getArchType = (ai) => {
      if (ai == null) return '-';
      if (ai < 0.20) return '高足弓';
      if (ai < 0.21) return '正常偏高';
      if (ai <= 0.26) return '正常足弓';
      if (ai <= 0.27) return '正常偏扁';
      return '扁平足';
    };

    return [
      { label: '足弓指数(AI)', leftVal: left.archIndex?.toFixed(3) || '-', rightVal: right.archIndex?.toFixed(3) || '-', leftExtra: getArchType(left.archIndex), rightExtra: getArchType(right.archIndex) },
      { label: '足长(cm)', leftVal: left.length?.toFixed(2) || '-', rightVal: right.length?.toFixed(2) || '-' },
      { label: '足宽(cm)', leftVal: left.width?.toFixed(2) || '-', rightVal: right.width?.toFixed(2) || '-' },
      { label: '全足面积(cm²)', leftVal: left.totalArea?.toFixed(2) || '-', rightVal: right.totalArea?.toFixed(2) || '-' },
      { label: '前足面积(cm²)', leftVal: left.forefootArea?.toFixed(2) || '-', rightVal: right.forefootArea?.toFixed(2) || '-' },
      { label: '中足面积(cm²)', leftVal: left.midfootArea?.toFixed(2) || '-', rightVal: right.midfootArea?.toFixed(2) || '-' },
      { label: '后足面积(cm²)', leftVal: left.hindfootArea?.toFixed(2) || '-', rightVal: right.hindfootArea?.toFixed(2) || '-' },
      { label: '前足压力(%)', leftVal: left.forefootPressure?.toFixed(1) || '-', rightVal: right.forefootPressure?.toFixed(1) || '-' },
      { label: '中足压力(%)', leftVal: left.midfootPressure?.toFixed(1) || '-', rightVal: right.midfootPressure?.toFixed(1) || '-' },
      { label: '后足压力(%)', leftVal: left.hindfootPressure?.toFixed(1) || '-', rightVal: right.hindfootPressure?.toFixed(1) || '-' },
      { label: 'COP距整体中心(cm)', leftVal: cop.distLeftToBoth?.toFixed(2) || '-', rightVal: cop.distRightToBoth?.toFixed(2) || '-' },
      { label: '左右脚前后差(cm)', leftVal: cop.leftForward?.toFixed(2) || '-', rightVal: '-' },
    ];
  }, [data]);

  /* ─── 参数注释 ─── */
  const paramAnnotations = [
    { name: '足弓指数(AI)', desc: '中足面积/(前足+中足+后足面积)。数值越大表示中足接触面积越大，足弓越低。', normal: '正常值: 0.21~0.26，>0.26 提示高平足。' },
    { name: '足长', desc: '足印最前端到最后端的直线距离。用于评估左右对称性、选择鞋码、定制鞋垫。' },
    { name: '足宽', desc: '足印最宽处的横向距离。配合足长评估足型(宽型/窄型)，指导鞋槽选择。' },
    { name: '总面积', desc: '整个足底接触面积。面积越大提示足弓越低或体重越大。', normal: '左右差异>15%需关注。' },
    { name: '前/中/后足面积', desc: '脚掌不同部分和地面接触的面积大小。前足大：前脚掌负荷重；中足大：足弓低；后足大：后跟承重多。' },
    { name: '前/中/后足压力', desc: '各区域压力占总压力百分比。', normal: '正常前足40~50%，中足5~10%，后足40~50%。' },
    { name: 'COP距整体中心', desc: '单脚压力中心到双脚总压力中心的距离。距离越小，该脚承重越接近身体重心。' },
    { name: '左右脚前后差', desc: '左脚COP相对右脚的前后位置差。正值：左脚靠前；负值：右脚靠前。', normal: '绝对值>2cm提示站姿不对称。' },
    { name: '压力中心轨迹长度', desc: 'COP移动的总路径长度。数值越大说明身体摆动越频繁，平衡控制越差。', normal: '正常站立30秒内<1000mm。' },
    { name: '压力中心活动总面积', desc: 'COP活动范围的面积。数值越大说明摆动幅度越大，姿势稳定性越差。', normal: '老年人通常比年轻人大20~30%。' },
    { name: '压力中心摆动幅度系数', desc: 'COP椭圆的长轴与短轴之比。比值越大说明摆动方向性越明显。' },
    { name: '压力中心摆动均匀系数', desc: '椭圆偏离圆形的程度(0~1)。越接近1说明摆动越呈线性，越接近0说明各方向摆动均匀。' },
    { name: '压力中心左右摆动幅度系数', desc: '左右方向最大摆动幅度。数值越大说明左右稳定性越差。' },
    { name: '压力中心前后摆动幅度系数', desc: '前后方向最大摆动幅度。数值越大说明前后稳定性越差。' },
    { name: '压力中心最大摆幅', desc: 'COP椭圆的最大直径。代表主要摆动方向的幅度。配合长/短轴比判断摆动模式。' },
    { name: '压力中心稳定摆幅', desc: 'COP椭圆的最小直径。代表次要摆动方向的幅度。数值越小说明该方向控制越好。' },
    { name: '压力中心最大离心', desc: 'COP到COP均值点的最大距离，反映极端摆动情况。突然增大可能提示失去平衡。' },
    { name: '压力中心最小离心', desc: 'COP到COP均值点的最小距离。数值越小说明能够回到中心位置的能力越好。' },
    { name: '压力中心偏移平均速度', desc: 'COP移动的平均速度。速度越快说明姿势调节越频繁。' },
    { name: '压力中心摆动强度', desc: '压力中心点偏移的均方根(RMS)，综合反映摆动强度。比平均值更敏感，临床常用。' },
    { name: '压力中心左右方向标准差', desc: '左右方向位置离散度。数值越大说明左右摆动越不规律。' },
    { name: '压力中心前后方向标准差', desc: '前后方向位置离散度。数值越大说明前后摆动越不规律。' },
  ];

  /* ─── 综合评估 ─── */
  const diff = Math.abs(data.bilateral.leftPressureRatio - data.bilateral.rightPressureRatio);
  const balanceStatus = diff < 5 ? '优秀' : diff < 10 ? '良好' : diff < 20 ? '一般' : '较差';
  const balanceColor = diff < 5 ? '#059669' : diff < 10 ? '#0066CC' : diff < 20 ? '#D97706' : '#DC2626';

  return (
    <div className="h-full w-full flex flex-col" style={{ background: 'var(--bg-primary)' }}>
      {/* 顶部栏 */}
      <div className="px-4 md:px-6 py-3 flex items-center justify-between shrink-0"
        style={{ borderBottom: '1px solid var(--border-light)', background: 'var(--bg-secondary)' }}>
        <h2 className="text-base md:text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
          {patientInfo?.name || '---'} 的静态站立评估报告
        </h2>
        <div className="flex items-center gap-2 md:gap-3 text-xs md:text-sm" style={{ color: 'var(--text-tertiary)' }}>
          <span className="hidden sm:inline">性别：{patientInfo?.gender || '---'}</span>
          <span className="hidden sm:inline">年龄：{patientInfo?.age || '---'}</span>
          <span className="hidden md:inline">评估时间：{new Date().toLocaleString()}</span>
          {onClose && (
            <button onClick={onClose} className="ml-2 w-8 h-8 flex items-center justify-center rounded-lg" style={{ color: 'var(--text-muted)' }}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* 侧边目录 */}
        <nav className="w-44 md:w-52 shrink-0 py-4 overflow-y-auto hidden md:block" style={{ borderRight: '1px solid var(--border-light)', background: 'var(--bg-secondary)' }}>
          <h3 className="text-[10px] font-semibold uppercase tracking-widest px-4 mb-3" style={{ color: 'var(--text-muted)' }}>报告目录</h3>
          {SECTIONS.map((s) => (
            <button key={s.id} onClick={() => scrollToSection(s.id)}
              className="w-full text-left px-4 py-2.5 text-xs md:text-sm flex items-center gap-2 transition-all"
              style={{
                borderLeft: `3px solid ${activeSection === s.id ? 'var(--zeiss-blue)' : 'transparent'}`,
                background: activeSection === s.id ? 'var(--zeiss-blue-light)' : 'transparent',
                color: activeSection === s.id ? 'var(--zeiss-blue)' : 'var(--text-tertiary)',
                fontWeight: activeSection === s.id ? 600 : 400,
              }}>
              {s.label}
            </button>
          ))}
        </nav>

        {/* 滚动内容 */}
        <div ref={contentRef} className="flex-1 overflow-y-auto p-4 md:p-6 scroll-smooth" style={{ background: 'var(--bg-primary)' }}>
          <div className="max-w-[1100px] mx-auto space-y-8">

            {/* ═══════════ 第1页：基本信息与足弓指标 ═══════════ */}
            <section id="standing-overview">
              <SectionHeader title="基本信息与足弓指标" subtitle="OneStep Report" />

              {/* 12项指标胶囊卡片 */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {archMetrics.map((m, i) => (
                  <MetricCapsule key={i} index={i + 1} label={m.label}
                    leftVal={m.leftVal} rightVal={m.rightVal}
                    leftExtra={m.leftExtra} rightExtra={m.rightExtra} />
                ))}
              </div>
            </section>

            {/* ═══════════ 足弓区域分布图 ═══════════ */}
            <section id="standing-arch-zones">
              <SectionHeader title="足弓区域分布图" subtitle="Arch Zone Distribution" />
              <div className="zeiss-card p-4">
                {data.rawData?.leftSectionCoords || data.rawData?.rightSectionCoords ? (
                  <InteractiveArchChart
                    leftSectionCoords={data.rawData.leftSectionCoords}
                    rightSectionCoords={data.rawData.rightSectionCoords}
                  />
                ) : (
                  <div className="text-center py-12 text-sm" style={{ color: 'var(--text-muted)' }}>
                    暂无足弓区域分布数据，请采集数据后查看
                  </div>
                )}
              </div>
            </section>

            {/* ═══════════ 区域压力分布 ═══════════ */}
            <section id="standing-pressure">
              <SectionHeader title="区域压力分布" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="zeiss-card p-4">
                  <div className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>左脚区域压力</div>
                  <EChart option={regionPieOption('左脚', data.left.regionPressure)} height={260} />
                </div>
                <div className="zeiss-card p-4">
                  <div className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>右脚区域压力</div>
                  <EChart option={regionPieOption('右脚', data.right.regionPressure)} height={260} />
                </div>
              </div>
              {/* 平衡分析 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                <div className="zeiss-card p-4">
                  <EChart option={balanceBarOption} height={260} />
                </div>
                <div className="zeiss-card p-5 space-y-3">
                  <div className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>平衡分析</div>
                  <DataRow label="左脚压力占比" value={`${data.bilateral.leftPressureRatio.toFixed(1)}%`} />
                  <DataRow label="右脚压力占比" value={`${data.bilateral.rightPressureRatio.toFixed(1)}%`} />
                  <DataRow label="左右差异" value={`${diff.toFixed(1)}%`} />
                  <div className="flex justify-between items-center py-1.5">
                    <span className="text-sm" style={{ color: 'var(--text-muted)' }}>平衡评级</span>
                    <span className="text-sm font-bold" style={{ color: balanceColor }}>{balanceStatus}</span>
                  </div>
                </div>
              </div>
            </section>

            {/* ═══════════ COP 压力中心轨迹（热力图+轨迹） ═══════════ */}
            <section id="standing-cop-heatmap">
              <SectionHeader title="COP 压力中心轨迹" subtitle="COP Trajectory with Heatmap" />
              <div className="zeiss-card p-4">
                {(data.rawData?.leftCopTrajectory?.length > 0 || data.rawData?.rightCopTrajectory?.length > 0) ? (
                  <InteractiveCOPChart
                    leftCopRaw={data.rawData.leftCopTrajectory}
                    rightCopRaw={data.rawData.rightCopTrajectory}
                    peakFrameData={data.rawData.peakFrameFlat}
                    leftSectionCoords={data.rawData.leftSectionCoords}
                    rightSectionCoords={data.rawData.rightSectionCoords}
                  />
                ) : (
                  <div className="text-center py-12 text-sm" style={{ color: 'var(--text-muted)' }}>
                    暂无COP轨迹数据，请采集数据后查看
                  </div>
                )}
              </div>
            </section>

            {/* ═══════════ 第2页：COP 轨迹 ═══════════ */}
            <section id="standing-cop-trajectory">
              <SectionHeader title="COP 轨迹" subtitle="COP trajectory" />
              <div className="zeiss-card p-4">
                <EChart option={copTrajectoryOption} height={400} />
              </div>
            </section>

            {/* ═══════════ COP 置信椭圆 ═══════════ */}
            <section id="standing-cop-ellipse">
              <SectionHeader title="COP 置信椭圆" subtitle="COP confidence ellipse" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="zeiss-card p-4">
                  <EChart option={copEllipseOption} height={380} />
                </div>
                <div className="zeiss-card p-5">
                  <div className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>椭圆参数</div>
                  <div className="space-y-2">
                    <DataRow label="左脚95%面积" value={`${(data.ellipseData?.left?.area_cm2 || 0).toFixed(4)} cm²`} />
                    <DataRow label="右脚95%面积" value={`${(data.ellipseData?.right?.area_cm2 || 0).toFixed(4)} cm²`} />
                    <DataRow label="左脚椭圆宽度" value={`${(data.ellipseData?.left?.width || 0).toFixed(2)}`} />
                    <DataRow label="左脚椭圆高度" value={`${(data.ellipseData?.left?.height || 0).toFixed(2)}`} />
                    <DataRow label="右脚椭圆宽度" value={`${(data.ellipseData?.right?.width || 0).toFixed(2)}`} />
                    <DataRow label="右脚椭圆高度" value={`${(data.ellipseData?.right?.height || 0).toFixed(2)}`} />
                  </div>
                  {/* 风险等级色条 */}
                  <div className="mt-4 p-3 rounded-lg" style={{ background: 'var(--bg-tertiary)' }}>
                    <div className="text-xs font-medium mb-2" style={{ color: 'var(--text-muted)' }}>风险预警</div>
                    <div className="h-3 rounded-full" style={{ background: 'linear-gradient(to right, #87CEEB, #003366)' }} />
                    <div className="flex justify-between mt-1">
                      <span className="text-[10px] font-medium" style={{ color: '#87CEEB' }}>低风险</span>
                      <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>椭圆面积 (cm²)</span>
                      <span className="text-[10px] font-medium" style={{ color: '#003366' }}>风险预警</span>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* ═══════════ COP 速度时间序列 ═══════════ */}
            <section id="standing-cop-velocity">
              <SectionHeader title="COP 速度时间序列" subtitle="COP velocity time series" />
              <div className="zeiss-card p-4">
                <EChart option={copVelocityOption} height={320} />
              </div>
            </section>

            {/* ═══════════ 第3页：COP 参数表 ═══════════ */}
            <section id="standing-cop-params">
              <SectionHeader title="COP 参数表" subtitle="OneStep Report - 参数" />
              <div className="zeiss-card overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className="px-4 md:px-6 py-3 text-left text-sm font-bold" style={{ background: '#1A2332', color: '#fff' }}>参数</th>
                      <th className="px-4 md:px-6 py-3 text-center text-sm font-bold" style={{ background: '#1A2332', color: '#fff' }}>数值（单位）</th>
                    </tr>
                  </thead>
                  <tbody>
                    {copParams.map((p, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border-light)', background: i % 2 === 0 ? 'var(--bg-primary)' : 'var(--bg-secondary)' }}>
                        <td className="px-4 md:px-6 py-3 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                          <div className="inline-block px-3 py-1 rounded-full text-xs" style={{ border: '1px solid var(--border-medium)', color: 'var(--text-secondary)' }}>
                            {p.name}
                          </div>
                        </td>
                        <td className="px-4 md:px-6 py-3 text-center text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                          {p.value != null ? `${Number(p.value).toFixed(2)} ${p.unit}` : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* ═══════════ 第4页：参数说明 ═══════════ */}
            <section id="standing-annotation">
              <SectionHeader title="参数说明" subtitle="Annotation" />
              <div className="zeiss-card p-5">
                <div className="space-y-4">
                  {paramAnnotations.map((a, i) => (
                    <div key={i} className="flex gap-4 pb-3" style={{ borderBottom: i < paramAnnotations.length - 1 ? '1px solid var(--border-light)' : 'none' }}>
                      <div className="shrink-0 w-48 md:w-56">
                        <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>【{a.name}】</span>
                      </div>
                      <div className="flex-1">
                        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{a.desc}</span>
                        {a.normal && <span className="text-sm font-medium ml-1" style={{ color: 'var(--zeiss-blue)' }}>{a.normal}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* ═══════════ 综合评估 ═══════════ */}
            <section id="standing-summary">
              <SectionHeader title="综合评估" />
              <AssessmentSummary data={data} diff={diff} />
            </section>

            <div className="h-8" />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════ 辅助组件 ═══════════ */

function SectionHeader({ title, subtitle }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="w-1 h-6 rounded-full" style={{ background: 'linear-gradient(to bottom, var(--zeiss-blue), #0891B2)' }} />
      <div>
        <h3 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>{title}</h3>
        {subtitle && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{subtitle}</span>}
      </div>
    </div>
  );
}

function DataRow({ label, value, badge }) {
  const badgeColors = {
    green: { bg: '#ECFDF5', color: '#059669' },
    red: { bg: '#FEF2F2', color: '#DC2626' },
    yellow: { bg: '#FFFBEB', color: '#D97706' }
  };
  return (
    <div className="flex justify-between items-center py-1.5" style={{ borderBottom: '1px solid var(--border-light)' }}>
      <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{label}</span>
      {badge ? (
        <span className="text-sm font-medium px-2 py-0.5 rounded-md" style={{ background: badgeColors[badge]?.bg, color: badgeColors[badge]?.color }}>{value}</span>
      ) : (
        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{value}</span>
      )}
    </div>
  );
}

/* ─── 指标胶囊卡片（仿PDF第1页右侧样式） ─── */
function MetricCapsule({ index, label, leftVal, rightVal, leftExtra, rightExtra }) {
  return (
    <div className="zeiss-card p-3 flex items-center gap-3">
      {/* 序号 */}
      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-xs font-bold"
        style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
        {index}
      </div>
      {/* 标签 */}
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{label}</div>
        {leftExtra && (
          <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            L: {leftExtra} {rightExtra ? `/ R: ${rightExtra}` : ''}
          </div>
        )}
      </div>
      {/* L/R 数值 */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="text-center">
          <div className="text-[9px] font-medium px-2 py-0.5 rounded-full mb-0.5" style={{ background: '#0066CC15', color: '#0066CC' }}>L</div>
          <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{leftVal}</div>
        </div>
        <div className="w-px h-8" style={{ background: 'var(--border-light)' }} />
        <div className="text-center">
          <div className="text-[9px] font-medium px-2 py-0.5 rounded-full mb-0.5" style={{ background: '#DC262615', color: '#DC2626' }}>R</div>
          <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{rightVal}</div>
        </div>
      </div>
    </div>
  );
}

function AssessmentSummary({ data, diff }) {
  const leftAI = data.left.archIndex;
  const rightAI = data.right.archIndex;
  const getType = (ai) => ai == null ? '-' : ai < 0.20 ? '高足弓' : ai <= 0.26 ? '正常足弓' : '扁平足';
  const leftType = getType(leftAI);
  const rightType = getType(rightAI);

  const findings = [];
  if (leftType !== '正常足弓') findings.push(`左脚${leftType}`);
  if (rightType !== '正常足弓') findings.push(`右脚${rightType}`);
  if (diff > 15) findings.push('左右脚压力不平衡');
  const ts = data.copTimeSeries || {};
  if (ts.contactArea && ts.contactArea > 500) findings.push('站立稳定性偏低');
  if (ts.pathLength && ts.pathLength > 1000) findings.push('COP轨迹长度偏高，平衡控制较差');

  const scores = {
    arch: leftType === '正常足弓' && rightType === '正常足弓' ? 90 : 60,
    balance: diff < 5 ? 95 : diff < 10 ? 80 : diff < 20 ? 60 : 40,
    stability: ts.contactArea ? (ts.contactArea < 300 ? 90 : ts.contactArea < 500 ? 70 : 50) : 75,
  };
  scores.total = Math.round((scores.arch * 0.35 + scores.balance * 0.3 + scores.stability * 0.35));

  return (
    <div className="zeiss-card p-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        {[
          { label: '足弓健康', score: scores.arch },
          { label: '压力平衡', score: scores.balance },
          { label: '站立稳定', score: scores.stability },
          { label: '综合评分', score: scores.total },
        ].map((item, i) => {
          const color = item.score >= 80 ? '#059669' : item.score >= 60 ? '#D97706' : '#DC2626';
          const bg = item.score >= 80 ? '#ECFDF5' : item.score >= 60 ? '#FFFBEB' : '#FEF2F2';
          return (
            <div key={i} className="rounded-xl p-4 text-center" style={{ background: bg }}>
              <div className="text-3xl font-bold" style={{ color }}>{item.score}</div>
              <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{item.label}</div>
            </div>
          );
        })}
      </div>
      {findings.length > 0 && (
        <div className="mt-4 p-4 rounded-xl" style={{ background: 'var(--bg-tertiary)' }}>
          <h5 className="font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>发现问题</h5>
          <ul className="space-y-1.5">
            {findings.map((f, i) => (
              <li key={i} className="text-sm flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#D97706' }} />{f}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ═══════════ 模拟报告数据 ═══════════ */
function generateMockReport() {
  // 模拟COP轨迹
  const leftCop = [], rightCop = [];
  for (let i = 0; i < 300; i++) {
    leftCop.push([29 + Math.sin(i * 0.08) * 2 + (Math.random() - 0.5) * 1.5, 49 + Math.cos(i * 0.12) * 1.5 + (Math.random() - 0.5) * 1]);
    rightCop.push([30 + Math.sin(i * 0.06) * 1.8 + (Math.random() - 0.5) * 1.2, 20 + Math.cos(i * 0.1) * 1.2 + (Math.random() - 0.5) * 0.8]);
  }

  // 模拟速度序列
  const velocitySeries = [];
  const timePoints = [];
  for (let i = 0; i < 300; i++) {
    timePoints.push(i * 0.024);
    velocitySeries.push(Math.abs(Math.sin(i * 0.05) * 20 + Math.random() * 15));
  }

  return {
    left: {
      archIndex: 0.235, length: 24.60, width: 20.40,
      totalArea: 142.59, forefootArea: 87.71, midfootArea: 26.95, hindfootArea: 27.93,
      forefootPressure: 64.8, midfootPressure: 14.8, hindfootPressure: 20.5,
      regionPressure: { forefoot: 64.8, midfoot: 14.8, hindfoot: 20.5 },
    },
    right: {
      archIndex: 0.265, length: 25.30, width: 14.80,
      totalArea: 147.00, forefootArea: 72.03, midfootArea: 32.34, hindfootArea: 42.63,
      forefootPressure: 45.5, midfootPressure: 16.3, hindfootPressure: 38.2,
      regionPressure: { forefoot: 45.5, midfoot: 16.3, hindfoot: 38.2 },
    },
    bilateral: {
      leftPressureRatio: 48.6, rightPressureRatio: 51.4,
    },
    copData: { leftCop, rightCop },
    ellipseData: {
      left: { center: [29, 49], width: 4.5, height: 2.8, angle: 35, area_cm2: 1.0187 },
      right: { center: [30, 20], width: 2.1, height: 1.5, angle: -20, area_cm2: 0.0103 },
    },
    copTimeSeries: {
      velocitySeries, timePoints,
      pathLength: 628.31, contactArea: 54.23,
      lsRatio: 36.33, eccentricity: 1.00,
      deltaY: 3.04, deltaX: 43.20,
      majorAxis: 2.18, minorAxis: 0.06,
      maxDisplacement: 2.46, minDisplacement: 0.01,
      avgVelocity: 9.34, rmsDisplacement: 1.09,
      stdY: 0.68, stdX: 10.87,
    },
    rawData: {
      leftSectionCoords: null,
      rightSectionCoords: null,
      leftCopTrajectory: [],
      rightCopTrajectory: [],
      peakFrameFlat: [],
    },
    additionalData: {
      copResults: { distLeftToBoth: 9.95, distRightToBoth: 10.49, leftForward: 2.37 }
    }
  };
}
