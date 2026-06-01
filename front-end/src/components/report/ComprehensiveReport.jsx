import React, { useRef, useState, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { exportToPdf } from '../../lib/pdfExport';
import ReportSummaryCard, { BasisNote } from './ReportSummaryCard';
import { buildComprehensiveScoreResult } from '../../lib/assessmentScoring';

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
  // AWGS 2019 / 社区筛查共识：男性 <28kg，女性 <18kg 提示低肌力
  // 这里用 N 做近似（1kg ≈ 9.8N）
  const kg = totalForce / 9.8;
  if (gender === '男') {
    if (kg >= 28) return { text: '正常', color: C.green, bg: '#ECFDF5' };
    if (kg >= 22) return { text: '偏低', color: C.amber, bg: '#FFFBEB' };
    return { text: '低握力', color: C.red, bg: '#FEF2F2' };
  }
  if (kg >= 18) return { text: '正常', color: C.green, bg: '#ECFDF5' };
  if (kg >= 14) return { text: '偏低', color: C.amber, bg: '#FFFBEB' };
  return { text: '低握力', color: C.red, bg: '#FEF2F2' };
}

function evalSitStandLevel(totalDur) {
  if (totalDur > 0 && totalDur < 12) return { text: '优秀', color: C.green, bg: '#ECFDF5' };
  if (totalDur <= 15) return { text: '需关注', color: C.amber, bg: '#FFFBEB' };
  if (totalDur <= 20) return { text: '偏慢', color: C.amber, bg: '#FFFBEB' };
  return { text: '明显偏慢', color: C.red, bg: '#FEF2F2' };
}

function evalGaitLevel(walkSpeed) {
  if (walkSpeed >= 1.0) return { text: '正常', color: C.green, bg: '#ECFDF5' };
  if (walkSpeed >= 0.45) return { text: '需关注', color: C.amber, bg: '#FFFBEB' };
  if (walkSpeed > 0) return { text: '明显偏慢', color: C.red, bg: '#FEF2F2' };
  return { text: '数据不足', color: C.blue, bg: '#E8F2FF' };
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

/* ─── 雷达图配置 ─── */
function makeRadarOption(grip, sitstand, standing, gait, gender) {
  const indicators = [];
  const values = [];

  if (grip) {
    const maxForce = Math.max(grip.leftTotalForce, grip.rightTotalForce);
    const kg = maxForce / 9.8;
    const threshold = gender === '男' ? 28 : 18;
    indicators.push({ name: '握力', max: 100 });
    values.push(Math.min(100, (kg / threshold) * 80));
  }

  if (sitstand) {
    indicators.push({ name: '起坐能力', max: 100 });
    // 12s 以下为正常参考，分数越高越好
    const score = sitstand.totalDuration > 0 ? Math.max(0, Math.min(100, (1 - (sitstand.totalDuration - 8) / 16) * 100)) : 0;
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

  // 综合评分评估
  const comprehensiveScore = useMemo(
    () => buildComprehensiveScoreResult(assessments, patientInfo),
    [assessments, patientInfo],
  );
  const itemScoreMap = useMemo(
    () => Object.fromEntries((comprehensiveScore.itemResults || []).map(item => [item.type, item])),
    [comprehensiveScore],
  );
  // 雷达图
  const radarOption = useMemo(() => makeRadarOption(gripData, sitstandData, standingData, gaitData, patientInfo.gender), [gripData, sitstandData, standingData, gaitData, patientInfo.gender]);

  const sections = [
    { id: 'overview', title: '综合概览' },
    ...(gripData ? [{ id: 'grip', title: '握力评估' }] : []),
    ...(sitstandData ? [{ id: 'sitstand', title: '起坐评估' }] : []),
    ...(standingData ? [{ id: 'standing', title: '站立评估' }] : []),
    ...(gaitData ? [{ id: 'gait', title: '步态评估' }] : []),
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

            <ReportSummaryCard
              scoreResult={comprehensiveScore}
              title="综合得分"
            />

            {/* 患者信息 + 风险等级 */}
            <div className="zeiss-card p-5 my-4">
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
                  <div className="p-5 rounded-xl text-center" style={{ background: comprehensiveScore.bg, border: `2px solid ${comprehensiveScore.color}30` }}>
                    <div className="text-xs font-medium mb-2" style={{ color: 'var(--text-muted)' }}>综合等级</div>
                    <div className="text-3xl font-black mb-1" style={{ color: comprehensiveScore.color }}>{comprehensiveScore.level}</div>
                    <div className="text-[11px] leading-relaxed" style={{ color: comprehensiveScore.color }}>{comprehensiveScore.levelDesc}</div>
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
                {itemScoreMap.grip && (
                  <div className="mb-4 p-3 rounded-lg text-xs font-semibold"
                    style={{ background: itemScoreMap.grip.bg, color: itemScoreMap.grip.color }}>
                    握力评分：{itemScoreMap.grip.score}/25 · {itemScoreMap.grip.level}
                  </div>
                )}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  <MetricCard label="左手总握力" value={(gripData.leftTotalForce).toFixed(1)} unit="N" color={C.blue}
                    sub={itemScoreMap.grip ? `${itemScoreMap.grip.score}/25` : evalGripLevel(gripData.leftTotalForce, patientInfo.gender).text} />
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
                {itemScoreMap.sitstand && (
                  <div className="mb-4 p-3 rounded-lg text-xs font-semibold"
                    style={{ background: itemScoreMap.sitstand.bg, color: itemScoreMap.sitstand.color }}>
                    起坐评分：{itemScoreMap.sitstand.score}/25 · {itemScoreMap.sitstand.level}
                  </div>
                )}
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
                    依据 AWGS 2019 及社区筛查共识，五次起坐测试 ≥12s 提示身体功能需关注。总时长 <b>{sitstandData.totalDuration.toFixed(1)}s</b>，
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
                {itemScoreMap.standing && (
                  <div className="mb-4 p-3 rounded-lg text-xs font-semibold"
                    style={{ background: itemScoreMap.standing.bg, color: itemScoreMap.standing.color }}>
                    静态站立评分：{itemScoreMap.standing.score}/25 · {itemScoreMap.standing.level}
                  </div>
                )}
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
                {itemScoreMap.gait && (
                  <div className="mb-4 p-3 rounded-lg text-xs font-semibold"
                    style={{ background: itemScoreMap.gait.bg, color: itemScoreMap.gait.color }}>
                    步态评分：{itemScoreMap.gait.score}/25 · {itemScoreMap.gait.level}
                  </div>
                )}
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
                    {gaitData.walkingSpeed >= 1.0 ? '达到身体功能参考值 (≥1.0 m/s)' : gaitData.walkingSpeed > 0 ? '低于身体功能参考值 (≥1.0 m/s)，建议作为需关注项观察' : '暂未形成有效速度结果，建议复核步道数据'}。
                    左右脚步长时间差异 <b>{Math.abs(gaitData.leftStepTime - gaitData.rightStepTime).toFixed(3)}s</b>
                    {Math.abs(gaitData.leftStepTime - gaitData.rightStepTime) <= 0.2 ? '，对称性尚可' : '，存在不对称倾向'}。
                  </span>
                </div>
              </div>
            </section>
          )}

          {/* 页脚 */}
          <div className="text-center py-4 text-[10px]" style={{ color: 'var(--text-muted)' }}>
            <BasisNote className="mb-2" />
            <p>肌少症/老年人评估及监测系统 · 综合评估报告</p>
            <p>powered by 矩侨工业</p>
          </div>
        </div>
      </div>
    </div>
  );
}
