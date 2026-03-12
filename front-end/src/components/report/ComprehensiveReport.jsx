import React, { useRef, useState, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { exportToPdf } from '../../lib/pdfExport';

/**
 * 综合评估报告组件
 * 将一组历史评估记录（握力、起坐、站立、步态）汇总为一份综合报告
 */

/* ─── 常量 ─── */
const ASSESSMENT_LABELS = {
  grip: '握力评估',
  sitstand: '五次起坐评估',
  standing: '静态站立评估',
  gait: '行走步态评估',
};

const ASSESSMENT_ORDER = ['grip', 'sitstand', 'standing', 'gait'];

const C = {
  blue: '#0066CC',
  green: '#059669',
  amber: '#D97706',
  red: '#DC2626',
  cyan: '#0891B2',
  purple: '#7C3AED',
};

/* ─── 工具函数 ─── */
function getArchType(ai) {
  if (ai == null) return '-';
  if (ai < 0.21) return '高弓足';
  if (ai <= 0.26) return '正常足弓';
  return '扁平足';
}

function evalGripLevel(totalForce, gender) {
  // EWGSOP2 标准：男性 <27kg，女性 <16kg 为低握力
  // 这里用 N 做近似（1kg ≈ 9.8N）
  const kg = totalForce / 9.8;
  if (gender === '男') {
    if (kg >= 27) return { text: '正常', color: C.green, bg: '#ECFDF5' };
    if (kg >= 20) return { text: '偏低', color: C.amber, bg: '#FFFBEB' };
    return { text: '低握力', color: C.red, bg: '#FEF2F2' };
  }
  if (kg >= 16) return { text: '正常', color: C.green, bg: '#ECFDF5' };
  if (kg >= 12) return { text: '偏低', color: C.amber, bg: '#FFFBEB' };
  return { text: '低握力', color: C.red, bg: '#FEF2F2' };
}

function evalSitStandLevel(totalDur) {
  if (totalDur > 0 && totalDur < 12) return { text: '优秀', color: C.green, bg: '#ECFDF5' };
  if (totalDur <= 15) return { text: '正常', color: C.cyan, bg: '#E0F7FA' };
  if (totalDur <= 20) return { text: '偏慢', color: C.amber, bg: '#FFFBEB' };
  return { text: '异常', color: C.red, bg: '#FEF2F2' };
}

function evalGaitLevel(walkSpeed) {
  if (walkSpeed >= 1.0) return { text: '正常', color: C.green, bg: '#ECFDF5' };
  if (walkSpeed >= 0.8) return { text: '正常偏低', color: C.cyan, bg: '#E0F7FA' };
  if (walkSpeed >= 0.6) return { text: '偏慢', color: C.amber, bg: '#FFFBEB' };
  return { text: '异常', color: C.red, bg: '#FEF2F2' };
}

function evalStandingLevel(archIndex) {
  if (archIndex == null) return { text: '-', color: C.blue, bg: '#E8F2FF' };
  if (archIndex >= 0.21 && archIndex <= 0.26) return { text: '正常', color: C.green, bg: '#ECFDF5' };
  if (archIndex < 0.21) return { text: '高弓足', color: C.amber, bg: '#FFFBEB' };
  return { text: '扁平足', color: C.amber, bg: '#FFFBEB' };
}

/* ─── 数据提取 ─── */
function extractGripSummary(reportData) {
  if (!reportData) return null;
  const left = reportData.left || {};
  const right = reportData.right || {};
  return {
    leftTotalForce: left.totalForce ?? 0,
    rightTotalForce: right.totalForce ?? 0,
    leftFingers: left.fingers || [],
    rightFingers: right.fingers || [],
    activeHand: reportData.activeHand || '左手',
  };
}

function extractSitStandSummary(reportData) {
  if (!reportData) return null;
  const ds = reportData.duration_stats || {};
  return {
    totalDuration: ds.total_duration || 0,
    numCycles: ds.num_cycles || 0,
    avgDuration: ds.avg_duration || 0,
    cycleDurations: ds.cycle_durations || [],
    standPeaks: reportData.stand_peaks || 0,
  };
}

function extractStandingSummary(reportData) {
  if (!reportData) return null;
  const isBackend = !!(reportData.additional_data || reportData.arch_features || reportData.cop_time_series);
  if (isBackend) {
    const af = reportData.arch_features || {};
    const ad = reportData.additional_data || {};
    const leftArchF = af.left_foot || {};
    const rightArchF = af.right_foot || {};
    const leftArea = ad.left_area || {};
    const rightArea = ad.right_area || {};
    const leftPres = ad.left_pressure || {};
    const rightPres = ad.right_pressure || {};
    return {
      leftArchIndex: leftArchF.area_index,
      rightArchIndex: rightArchF.area_index,
      leftTotalArea: leftArea.total_area_cm2 || 0,
      rightTotalArea: rightArea.total_area_cm2 || 0,
      leftPressure: { forefoot: (leftPres['前足'] || 0) * 100, midfoot: (leftPres['中足'] || 0) * 100, hindfoot: (leftPres['后足'] || 0) * 100 },
      rightPressure: { forefoot: (rightPres['前足'] || 0) * 100, midfoot: (rightPres['中足'] || 0) * 100, hindfoot: (rightPres['后足'] || 0) * 100 },
    };
  }
  // 前端格式
  const left = reportData.left || {};
  const right = reportData.right || {};
  return {
    leftArchIndex: left.archIndex,
    rightArchIndex: right.archIndex,
    leftTotalArea: left.totalArea || 0,
    rightTotalArea: right.totalArea || 0,
    leftPressure: left.regionPressure || {},
    rightPressure: right.regionPressure || {},
  };
}

function extractGaitSummary(reportData) {
  if (!reportData) return null;
  const gp = reportData.gaitParams || {};
  return {
    walkingSpeed: parseFloat(gp.walkingSpeed) || 0,
    leftStepTime: parseFloat(gp.leftStepTime) || 0,
    rightStepTime: parseFloat(gp.rightStepTime) || 0,
    leftStepLength: parseFloat(gp.leftStepLength) || 0,
    rightStepLength: parseFloat(gp.rightStepLength) || 0,
    stepWidth: parseFloat(gp.stepWidth) || 0,
    leftFPA: parseFloat(gp.leftFPA) || 0,
    rightFPA: parseFloat(gp.rightFPA) || 0,
    doubleContactTime: parseFloat(gp.doubleContactTime) || 0,
  };
}

/* ─── 综合风险评估 ─── */
function computeOverallRisk(grip, sitstand, standing, gait, gender) {
  const findings = [];
  let riskScore = 0; // 0-100, higher = more risk

  if (grip) {
    const maxForce = Math.max(grip.leftTotalForce, grip.rightTotalForce);
    const kg = maxForce / 9.8;
    const threshold = gender === '男' ? 27 : 16;
    if (kg < threshold) {
      findings.push({ text: `最大握力 ${kg.toFixed(1)} kg，低于 EWGSOP2 标准 (${threshold} kg)`, level: 'warning', category: '握力' });
      riskScore += 25;
    } else {
      findings.push({ text: `最大握力 ${kg.toFixed(1)} kg，达标`, level: 'success', category: '握力' });
    }
  }

  if (sitstand) {
    if (sitstand.totalDuration > 15) {
      findings.push({ text: `五次起坐总时长 ${sitstand.totalDuration.toFixed(1)}s，超过 EWGSOP2 标准 (15s)`, level: 'warning', category: '起坐' });
      riskScore += 25;
    } else {
      findings.push({ text: `五次起坐总时长 ${sitstand.totalDuration.toFixed(1)}s，达标 (<15s)`, level: 'success', category: '起坐' });
    }
  }

  if (gait) {
    if (gait.walkingSpeed < 0.8) {
      findings.push({ text: `行走速度 ${gait.walkingSpeed.toFixed(2)} m/s，低于正常参考值 (≥0.8 m/s)`, level: 'warning', category: '步态' });
      riskScore += 25;
    } else {
      findings.push({ text: `行走速度 ${gait.walkingSpeed.toFixed(2)} m/s，达标 (≥0.8 m/s)`, level: 'success', category: '步态' });
    }
    if (Math.abs(gait.leftStepTime - gait.rightStepTime) > 0.15) {
      findings.push({ text: `左右脚步长时间不对称 (差异 ${Math.abs(gait.leftStepTime - gait.rightStepTime).toFixed(3)}s)`, level: 'info', category: '步态' });
    }
  }

  if (standing) {
    const leftType = getArchType(standing.leftArchIndex);
    const rightType = getArchType(standing.rightArchIndex);
    if (leftType !== '正常足弓' || rightType !== '正常足弓') {
      findings.push({ text: `足弓异常：左脚${leftType}，右脚${rightType}`, level: 'info', category: '站立' });
      riskScore += 10;
    } else {
      findings.push({ text: '双脚足弓形态正常', level: 'success', category: '站立' });
    }
  }

  // 综合肌少症风险判定
  let overallLevel;
  if (riskScore >= 50) {
    overallLevel = { text: '高风险', color: C.red, bg: '#FEF2F2', desc: '建议进一步进行 DXA 或 BIA 检查以确认肌少症诊断' };
  } else if (riskScore >= 25) {
    overallLevel = { text: '中风险', color: C.amber, bg: '#FFFBEB', desc: '部分指标异常，建议定期复查并加强运动干预' };
  } else {
    overallLevel = { text: '低风险', color: C.green, bg: '#ECFDF5', desc: '各项指标基本正常，建议保持良好的运动习惯' };
  }

  return { findings, riskScore, overallLevel };
}

/* ─── 雷达图配置 ─── */
function makeRadarOption(grip, sitstand, standing, gait, gender) {
  const indicators = [];
  const values = [];

  if (grip) {
    const maxForce = Math.max(grip.leftTotalForce, grip.rightTotalForce);
    const kg = maxForce / 9.8;
    const threshold = gender === '男' ? 27 : 16;
    indicators.push({ name: '握力', max: 100 });
    values.push(Math.min(100, (kg / threshold) * 80));
  }

  if (sitstand) {
    indicators.push({ name: '起坐能力', max: 100 });
    // 15s 以下为正常，分数越高越好
    const score = sitstand.totalDuration > 0 ? Math.max(0, Math.min(100, (1 - (sitstand.totalDuration - 8) / 20) * 100)) : 0;
    values.push(score);
  }

  if (standing) {
    indicators.push({ name: '足弓健康', max: 100 });
    const leftOk = standing.leftArchIndex >= 0.21 && standing.leftArchIndex <= 0.26;
    const rightOk = standing.rightArchIndex >= 0.21 && standing.rightArchIndex <= 0.26;
    values.push((leftOk ? 50 : 25) + (rightOk ? 50 : 25));
  }

  if (gait) {
    indicators.push({ name: '步态速度', max: 100 });
    values.push(Math.min(100, (gait.walkingSpeed / 1.2) * 100));

    indicators.push({ name: '步态对称', max: 100 });
    const asymmetry = Math.abs(gait.leftStepTime - gait.rightStepTime);
    values.push(Math.max(0, Math.min(100, (1 - asymmetry / 0.3) * 100)));
  }

  return {
    tooltip: {},
    radar: {
      indicator: indicators,
      shape: 'circle',
      splitNumber: 4,
      axisName: { color: '#666', fontSize: 12 },
      splitLine: { lineStyle: { color: '#E5E7EB' } },
      splitArea: { areaStyle: { color: ['#fff', '#F9FAFB', '#F3F4F6', '#E5E7EB'] } },
    },
    series: [{
      type: 'radar',
      data: [{
        value: values,
        name: '综合评估',
        areaStyle: { color: 'rgba(0,102,204,0.15)' },
        lineStyle: { color: C.blue, width: 2 },
        itemStyle: { color: C.blue },
      }],
    }],
  };
}

/* ─── MetricCard ─── */
function MetricCard({ label, value, unit, color, sub, icon }) {
  return (
    <div className="zeiss-card p-4 flex flex-col items-center text-center">
      {icon && <div className="mb-2">{icon}</div>}
      <div className="text-2xl font-bold" style={{ color }}>{value}<span className="text-sm font-normal ml-1">{unit}</span></div>
      <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{label}</div>
      {sub && <div className="text-[10px] mt-0.5 px-2 py-0.5 rounded-full" style={{ background: color + '15', color }}>{sub}</div>}
    </div>
  );
}

/* ─── 评估状态徽章 ─── */
function StatusBadge({ completed }) {
  return completed ? (
    <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full" style={{ background: '#ECFDF5', color: C.green }}>
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
      已完成
    </span>
  ) : (
    <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>未完成</span>
  );
}

/* ═══════════════════════════════════════════════════
   主组件
   ═══════════════════════════════════════════════════ */
export default function ComprehensiveReport({ record, onClose }) {
  const contentRef = useRef(null);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [activeSection, setActiveSection] = useState('overview');

  const patientInfo = useMemo(() => ({
    name: record?.patientName || '未知',
    gender: record?.patientGender || '',
    age: record?.patientAge || '',
    weight: record?.patientWeight || '',
  }), [record]);

  const assessments = record?.assessments || {};
  const completedTypes = ASSESSMENT_ORDER.filter(k => assessments[k]?.completed);
  const completedCount = completedTypes.length;

  // 提取各评估摘要
  const gripData = useMemo(() => extractGripSummary(assessments.grip?.report?.reportData), [assessments]);
  const sitstandData = useMemo(() => extractSitStandSummary(assessments.sitstand?.report?.reportData), [assessments]);
  const standingData = useMemo(() => extractStandingSummary(assessments.standing?.report?.reportData), [assessments]);
  const gaitData = useMemo(() => extractGaitSummary(assessments.gait?.report?.reportData), [assessments]);

  // 综合风险评估
  const risk = useMemo(() => computeOverallRisk(gripData, sitstandData, standingData, gaitData, patientInfo.gender), [gripData, sitstandData, standingData, gaitData, patientInfo.gender]);

  // 雷达图
  const radarOption = useMemo(() => makeRadarOption(gripData, sitstandData, standingData, gaitData, patientInfo.gender), [gripData, sitstandData, standingData, gaitData, patientInfo.gender]);

  const sections = [
    { id: 'overview', title: '综合概览' },
    ...(gripData ? [{ id: 'grip', title: '握力评估' }] : []),
    ...(sitstandData ? [{ id: 'sitstand', title: '起坐评估' }] : []),
    ...(standingData ? [{ id: 'standing', title: '站立评估' }] : []),
    ...(gaitData ? [{ id: 'gait', title: '步态评估' }] : []),
    { id: 'conclusion', title: '综合结论' },
  ];

  const scrollToSection = (id) => {
    document.getElementById(`comp-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveSection(id);
  };

  const handlePdfExport = async () => {
    if (pdfExporting) return;
    setPdfExporting(true);
    try {
      await exportToPdf(contentRef?.current, `${patientInfo.name}_综合评估报告`, { title: '综合评估报告' });
    } finally {
      setPdfExporting(false);
    }
  };

  const reportTime = useMemo(() => {
    const d = record?.updatedAt || record?.date;
    return d ? new Date(d).toLocaleString('zh-CN') : new Date().toLocaleString('zh-CN');
  }, [record]);

  if (completedCount === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <svg className="w-16 h-16 mb-4" style={{ color: 'var(--border-light)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <p className="text-base font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>暂无已完成的评估</p>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>请先完成至少一项评估</p>
        {onClose && <button onClick={onClose} className="mt-4 px-4 py-2 rounded-lg text-sm text-white" style={{ background: 'var(--zeiss-blue)' }}>返回</button>}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* 顶部栏 */}
      <div className="shrink-0 px-4 md:px-6 py-2 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-light)', background: 'var(--bg-secondary)' }}>
        <h2 className="text-sm md:text-base font-bold" style={{ color: 'var(--text-primary)' }}>
          {patientInfo.name} 的综合评估报告
        </h2>
        <div className="flex items-center gap-2">
          <button onClick={handlePdfExport} disabled={pdfExporting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
            style={{ color: pdfExporting ? 'var(--text-muted)' : '#DC2626', background: pdfExporting ? 'var(--bg-tertiary)' : '#FEF2F2', border: '1px solid #FCA5A530', cursor: pdfExporting ? 'wait' : 'pointer' }}>
            {pdfExporting ? (
              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            )}
            {pdfExporting ? '导出中...' : '导出 PDF'}
          </button>
          {onClose && (
            <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors" style={{ color: 'var(--text-muted)' }}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* 侧边导航 */}
        <nav className="w-48 shrink-0 p-3 overflow-y-auto hidden lg:block" style={{ borderRight: '1px solid var(--border-light)' }}>
          {sections.map(s => (
            <button key={s.id} onClick={() => scrollToSection(s.id)}
              className={`w-full text-left px-3 py-2 text-xs rounded-lg mb-1 transition-colors ${activeSection === s.id ? 'font-semibold' : ''}`}
              style={{ background: activeSection === s.id ? 'var(--zeiss-blue-light)' : 'transparent', color: activeSection === s.id ? 'var(--zeiss-blue)' : 'var(--text-muted)' }}>
              {s.title}
            </button>
          ))}
        </nav>

        {/* 主内容 */}
        <div ref={contentRef} className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">

          {/* ═══ 1. 综合概览 ═══ */}
          <section id="comp-overview">
            <div className="zeiss-section-title">综合概览</div>

            {/* 患者信息 + 风险等级 */}
            <div className="zeiss-card p-5 mb-4">
              <div className="flex flex-col md:flex-row md:items-start gap-6">
                {/* 患者信息 */}
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold text-white" style={{ background: `linear-gradient(135deg, ${C.blue}, ${C.cyan})` }}>
                      {patientInfo.name?.charAt(0) || '?'}
                    </div>
                    <div>
                      <div className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>{patientInfo.name}</div>
                      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {patientInfo.gender} · {patientInfo.age}岁 · {patientInfo.weight}kg
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="p-2.5 rounded-lg" style={{ background: 'var(--bg-tertiary)' }}>
                      <span style={{ color: 'var(--text-muted)' }}>评估日期</span>
                      <div className="font-semibold mt-0.5" style={{ color: 'var(--text-primary)' }}>{record?.dateStr || '-'}</div>
                    </div>
                    <div className="p-2.5 rounded-lg" style={{ background: 'var(--bg-tertiary)' }}>
                      <span style={{ color: 'var(--text-muted)' }}>评估机构</span>
                      <div className="font-semibold mt-0.5" style={{ color: 'var(--text-primary)' }}>{record?.institution || '-'}</div>
                    </div>
                    <div className="p-2.5 rounded-lg" style={{ background: 'var(--bg-tertiary)' }}>
                      <span style={{ color: 'var(--text-muted)' }}>完成项目</span>
                      <div className="font-semibold mt-0.5" style={{ color: 'var(--text-primary)' }}>{completedCount} / 4</div>
                    </div>
                    <div className="p-2.5 rounded-lg" style={{ background: 'var(--bg-tertiary)' }}>
                      <span style={{ color: 'var(--text-muted)' }}>报告生成时间</span>
                      <div className="font-semibold mt-0.5" style={{ color: 'var(--text-primary)' }}>{reportTime}</div>
                    </div>
                  </div>
                </div>

                {/* 风险等级 */}
                <div className="w-full md:w-64 shrink-0">
                  <div className="p-5 rounded-xl text-center" style={{ background: risk.overallLevel.bg, border: `2px solid ${risk.overallLevel.color}30` }}>
                    <div className="text-xs font-medium mb-2" style={{ color: 'var(--text-muted)' }}>肌少症风险评级</div>
                    <div className="text-3xl font-black mb-1" style={{ color: risk.overallLevel.color }}>{risk.overallLevel.text}</div>
                    <div className="text-[11px] leading-relaxed" style={{ color: risk.overallLevel.color }}>{risk.overallLevel.desc}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* 评估完成状态 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              {ASSESSMENT_ORDER.map(key => {
                const completed = assessments[key]?.completed;
                return (
                  <div key={key} className="zeiss-card p-3 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: completed ? 'var(--zeiss-blue-light)' : 'var(--bg-tertiary)', color: completed ? 'var(--zeiss-blue)' : 'var(--text-muted)' }}>
                      {completed ? (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      )}
                    </div>
                    <div>
                      <div className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{ASSESSMENT_LABELS[key]}</div>
                      <StatusBadge completed={completed} />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 雷达图 */}
            <div className="zeiss-card p-4">
              <h4 className="text-xs font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>能力雷达图</h4>
              <div className="flex justify-center">
                <ReactECharts option={radarOption} style={{ width: '100%', maxWidth: 420, height: 300 }} />
              </div>
            </div>
          </section>

          {/* ═══ 2. 握力评估摘要 ═══ */}
          {gripData && (
            <section id="comp-grip">
              <div className="zeiss-section-title">握力评估摘要</div>
              <div className="zeiss-card p-5">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  <MetricCard label="左手总握力" value={(gripData.leftTotalForce).toFixed(1)} unit="N" color={C.blue}
                    sub={evalGripLevel(gripData.leftTotalForce, patientInfo.gender).text} />
                  <MetricCard label="右手总握力" value={(gripData.rightTotalForce).toFixed(1)} unit="N" color={C.cyan}
                    sub={evalGripLevel(gripData.rightTotalForce, patientInfo.gender).text} />
                  <MetricCard label="最大握力" value={Math.max(gripData.leftTotalForce, gripData.rightTotalForce).toFixed(1)} unit="N" color={C.green} />
                  <MetricCard label="等效公斤" value={(Math.max(gripData.leftTotalForce, gripData.rightTotalForce) / 9.8).toFixed(1)} unit="kg" color={C.purple}
                    sub={evalGripLevel(Math.max(gripData.leftTotalForce, gripData.rightTotalForce), patientInfo.gender).text} />
                </div>
                {/* 各指力量对比 */}
                {(gripData.leftFingers.length > 0 || gripData.rightFingers.length > 0) && (
                  <div>
                    <h5 className="text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>各指力量分布</h5>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="zeiss-table-header">
                            <th className="px-3 py-2 text-left" style={{ color: 'var(--text-tertiary)' }}>手指</th>
                            <th className="px-3 py-2 text-center" style={{ color: 'var(--text-tertiary)' }}>左手力量 (N)</th>
                            <th className="px-3 py-2 text-center" style={{ color: 'var(--text-tertiary)' }}>右手力量 (N)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(gripData.leftFingers.length >= gripData.rightFingers.length ? gripData.leftFingers : gripData.rightFingers).map((f, i) => (
                            <tr key={i} className="zeiss-table-row">
                              <td className="px-3 py-2 font-medium" style={{ color: 'var(--text-primary)' }}>{f.name || gripData.leftFingers[i]?.name || `指${i+1}`}</td>
                              <td className="px-3 py-2 text-center" style={{ color: C.blue }}>{gripData.leftFingers[i]?.force != null ? parseFloat(gripData.leftFingers[i].force).toFixed(2) : '-'}</td>
                              <td className="px-3 py-2 text-center" style={{ color: C.cyan }}>{gripData.rightFingers[i]?.force != null ? parseFloat(gripData.rightFingers[i].force).toFixed(2) : '-'}</td>
                            </tr>
                          ))}
                          <tr className="zeiss-table-row font-bold">
                            <td className="px-3 py-2" style={{ color: 'var(--text-primary)' }}>合计</td>
                            <td className="px-3 py-2 text-center" style={{ color: C.blue }}>{gripData.leftTotalForce.toFixed(2)}</td>
                            <td className="px-3 py-2 text-center" style={{ color: C.cyan }}>{gripData.rightTotalForce.toFixed(2)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* ═══ 3. 起坐评估摘要 ═══ */}
          {sitstandData && (
            <section id="comp-sitstand">
              <div className="zeiss-section-title">五次起坐评估摘要</div>
              <div className="zeiss-card p-5">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  <MetricCard label="总时长" value={sitstandData.totalDuration.toFixed(1)} unit="s" color={C.blue}
                    sub={evalSitStandLevel(sitstandData.totalDuration).text} />
                  <MetricCard label="完成周期数" value={sitstandData.numCycles} unit="次" color={C.green} />
                  <MetricCard label="平均周期时长" value={sitstandData.avgDuration.toFixed(2)} unit="s" color={C.cyan} />
                  <MetricCard label="检测峰值数" value={sitstandData.standPeaks || '-'} unit="" color={C.purple} />
                </div>
                {/* 各周期时长 */}
                {sitstandData.cycleDurations.length > 0 && (
                  <div>
                    <h5 className="text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>各周期时长</h5>
                    <div className="flex items-end gap-2 h-24">
                      {sitstandData.cycleDurations.map((d, i) => {
                        const maxD = Math.max(...sitstandData.cycleDurations);
                        const h = maxD > 0 ? (d / maxD) * 80 : 0;
                        return (
                          <div key={i} className="flex-1 flex flex-col items-center">
                            <span className="text-[10px] font-semibold mb-1" style={{ color: C.blue }}>{d.toFixed(1)}s</span>
                            <div className="w-full rounded-t" style={{ height: h, background: `linear-gradient(180deg, ${C.blue}, ${C.blue}40)`, minHeight: 4 }} />
                            <span className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>第{i+1}次</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div className="mt-3 p-3 rounded-lg text-xs" style={{ background: evalSitStandLevel(sitstandData.totalDuration).bg }}>
                  <span style={{ color: evalSitStandLevel(sitstandData.totalDuration).color }}>
                    依据 EWGSOP2 标准，五次起坐测试 &lt;15s 为正常。受试者总时长 <b>{sitstandData.totalDuration.toFixed(1)}s</b>，
                    评级为 <b>{evalSitStandLevel(sitstandData.totalDuration).text}</b>。
                  </span>
                </div>
              </div>
            </section>
          )}

          {/* ═══ 4. 站立评估摘要 ═══ */}
          {standingData && (
            <section id="comp-standing">
              <div className="zeiss-section-title">静态站立评估摘要</div>
              <div className="zeiss-card p-5">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  <MetricCard label="左脚足弓指数" value={standingData.leftArchIndex?.toFixed(3) || '-'} unit="" color={C.blue}
                    sub={getArchType(standingData.leftArchIndex)} />
                  <MetricCard label="右脚足弓指数" value={standingData.rightArchIndex?.toFixed(3) || '-'} unit="" color={C.cyan}
                    sub={getArchType(standingData.rightArchIndex)} />
                  <MetricCard label="左脚接触面积" value={standingData.leftTotalArea?.toFixed(1) || '-'} unit="cm²" color={C.green} />
                  <MetricCard label="右脚接触面积" value={standingData.rightTotalArea?.toFixed(1) || '-'} unit="cm²" color={C.purple} />
                </div>
                {/* 压力分布 */}
                <div>
                  <h5 className="text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>足底压力分布</h5>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="zeiss-table-header">
                          <th className="px-3 py-2 text-left" style={{ color: 'var(--text-tertiary)' }}>区域</th>
                          <th className="px-3 py-2 text-center" style={{ color: 'var(--text-tertiary)' }}>左脚 (%)</th>
                          <th className="px-3 py-2 text-center" style={{ color: 'var(--text-tertiary)' }}>右脚 (%)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {['forefoot', 'midfoot', 'hindfoot'].map((region, i) => (
                          <tr key={region} className="zeiss-table-row">
                            <td className="px-3 py-2 font-medium" style={{ color: 'var(--text-primary)' }}>{['前足', '中足', '后足'][i]}</td>
                            <td className="px-3 py-2 text-center" style={{ color: C.blue }}>{standingData.leftPressure?.[region]?.toFixed(1) || '-'}</td>
                            <td className="px-3 py-2 text-center" style={{ color: C.cyan }}>{standingData.rightPressure?.[region]?.toFixed(1) || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* ═══ 5. 步态评估摘要 ═══ */}
          {gaitData && (
            <section id="comp-gait">
              <div className="zeiss-section-title">行走步态评估摘要</div>
              <div className="zeiss-card p-5">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  <MetricCard label="行走速度" value={gaitData.walkingSpeed.toFixed(2)} unit="m/s" color={C.blue}
                    sub={evalGaitLevel(gaitData.walkingSpeed).text} />
                  <MetricCard label="左脚步长时间" value={gaitData.leftStepTime.toFixed(3)} unit="s" color={C.green} />
                  <MetricCard label="右脚步长时间" value={gaitData.rightStepTime.toFixed(3)} unit="s" color={C.cyan} />
                  <MetricCard label="步宽" value={gaitData.stepWidth.toFixed(1)} unit="cm" color={C.purple} />
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  <MetricCard label="左脚步长" value={gaitData.leftStepLength.toFixed(1)} unit="cm" color={C.blue} />
                  <MetricCard label="右脚步长" value={gaitData.rightStepLength.toFixed(1)} unit="cm" color={C.cyan} />
                  <MetricCard label="左脚FPA" value={gaitData.leftFPA.toFixed(1)} unit="°" color={C.amber} />
                  <MetricCard label="右脚FPA" value={gaitData.rightFPA.toFixed(1)} unit="°" color={C.amber} />
                </div>
                {/* 步态对称性分析 */}
                <div className="p-3 rounded-lg text-xs" style={{ background: evalGaitLevel(gaitData.walkingSpeed).bg }}>
                  <span style={{ color: evalGaitLevel(gaitData.walkingSpeed).color }}>
                    行走速度 <b>{gaitData.walkingSpeed.toFixed(2)} m/s</b>，
                    {gaitData.walkingSpeed >= 0.8 ? '达到正常参考值 (≥0.8 m/s)' : '低于正常参考值 (≥0.8 m/s)'}。
                    左右脚步长时间差异 <b>{Math.abs(gaitData.leftStepTime - gaitData.rightStepTime).toFixed(3)}s</b>
                    {Math.abs(gaitData.leftStepTime - gaitData.rightStepTime) <= 0.15 ? '，对称性良好' : '，存在不对称'}。
                  </span>
                </div>
              </div>
            </section>
          )}

          {/* ═══ 6. 综合结论 ═══ */}
          <section id="comp-conclusion">
            <div className="zeiss-section-title">综合结论与建议</div>
            <div className="zeiss-card p-5">
              {/* 风险评级 */}
              <div className="flex items-center gap-4 mb-5 p-4 rounded-xl" style={{ background: risk.overallLevel.bg, border: `1px solid ${risk.overallLevel.color}20` }}>
                <div className="w-16 h-16 rounded-full flex items-center justify-center shrink-0" style={{ background: risk.overallLevel.color + '20' }}>
                  <span className="text-2xl font-black" style={{ color: risk.overallLevel.color }}>
                    {risk.riskScore}
                  </span>
                </div>
                <div>
                  <div className="text-lg font-bold" style={{ color: risk.overallLevel.color }}>
                    肌少症风险评级：{risk.overallLevel.text}
                  </div>
                  <div className="text-sm mt-1" style={{ color: risk.overallLevel.color }}>
                    {risk.overallLevel.desc}
                  </div>
                </div>
              </div>

              {/* 各项发现 */}
              <h5 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>评估发现</h5>
              <div className="space-y-2 mb-5">
                {risk.findings.map((f, i) => (
                  <div key={i} className="flex items-start gap-2 p-2.5 rounded-lg text-xs"
                    style={{
                      background: f.level === 'warning' ? '#FEF3C7' : f.level === 'success' ? '#ECFDF5' : '#EFF6FF',
                      color: f.level === 'warning' ? '#92400E' : f.level === 'success' ? '#065F46' : '#1E40AF',
                    }}>
                    <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      {f.level === 'warning' ? (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                      ) : f.level === 'success' ? (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      ) : (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      )}
                    </svg>
                    <span><b>[{f.category}]</b> {f.text}</span>
                  </div>
                ))}
              </div>

              {/* EWGSOP2 标准说明 */}
              <div className="p-4 rounded-lg" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-light)' }}>
                <h6 className="text-xs font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>参考标准 (EWGSOP2)</h6>
                <div className="text-[11px] leading-relaxed space-y-1" style={{ color: 'var(--text-secondary)' }}>
                  <p>本报告依据欧洲老年人肌少症工作组 (EWGSOP2) 2019 年修订标准进行综合评估：</p>
                  <p>1. <b>握力</b>：男性 &lt;27kg / 女性 &lt;16kg 提示低肌力</p>
                  <p>2. <b>五次起坐测试</b>：&gt;15 秒提示下肢肌力不足</p>
                  <p>3. <b>步态速度</b>：&lt;0.8 m/s 提示肌肉功能下降</p>
                  <p>4. <b>足弓指数</b>：正常范围 0.21-0.26，异常可能影响平衡和步态</p>
                  <p className="mt-2 font-medium" style={{ color: 'var(--text-muted)' }}>注：本报告仅供参考，最终诊断请结合临床医生意见。</p>
                </div>
              </div>
            </div>
          </section>

          {/* 页脚 */}
          <div className="text-center py-4 text-[10px]" style={{ color: 'var(--text-muted)' }}>
            <p>肌少症/老年人评估及监测系统 · 综合评估报告</p>
            <p>powered by 矩侨工业</p>
          </div>
        </div>
      </div>
    </div>
  );
}
