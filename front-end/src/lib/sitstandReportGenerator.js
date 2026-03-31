const DEFAULT_INTERVAL_SEC = 0.1;
const DEFAULT_DISPLAY_INTERVAL_SEC = 0.3;
const DEFAULT_MAX_DISPLAY_POINTS = 48;

function roundTo(value, digits = 2) {
  return Number(Number(value || 0).toFixed(digits));
}

function buildRelativeTimes(length, timestamps = [], fallbackIntervalSec = DEFAULT_INTERVAL_SEC) {
  if (
    Array.isArray(timestamps) &&
    timestamps.length === length &&
    timestamps.every((value) => Number.isFinite(Number(value)))
  ) {
    const normalized = timestamps.map((value) => Number(value));
    const base = normalized[0];
    return normalized.map((value) => roundTo(Math.max(0, (value - base) / 1000), 2));
  }

  return Array.from({ length }, (_, index) => roundTo(index * fallbackIntervalSec, 2));
}

function getAverageIntervalSec(times, fallbackIntervalSec = DEFAULT_INTERVAL_SEC) {
  if (!Array.isArray(times) || times.length < 2) {
    return fallbackIntervalSec;
  }

  const diffs = [];
  for (let i = 1; i < times.length; i++) {
    const diff = Number(times[i]) - Number(times[i - 1]);
    if (Number.isFinite(diff) && diff > 0) {
      diffs.push(diff);
    }
  }

  if (!diffs.length) {
    return fallbackIntervalSec;
  }

  return diffs.reduce((sum, value) => sum + value, 0) / diffs.length;
}

function downsampleSeries(
  times,
  values,
  { displayIntervalSec = DEFAULT_DISPLAY_INTERVAL_SEC, maxDisplayPoints = DEFAULT_MAX_DISPLAY_POINTS } = {},
) {
  const length = Math.min(times.length, values.length);
  if (length <= 1) {
    return {
      times: times.slice(0, length),
      values: values.slice(0, length),
    };
  }

  const avgIntervalSec = getAverageIntervalSec(times, DEFAULT_INTERVAL_SEC);
  let step = Math.max(1, Math.round(displayIntervalSec / Math.max(avgIntervalSec, 0.001)));

  if (maxDisplayPoints > 0) {
    step = Math.max(step, Math.ceil(length / maxDisplayPoints));
  }

  if (step === 1) {
    return {
      times: times.slice(0, length),
      values: values.slice(0, length),
    };
  }

  const sampledTimes = [];
  const sampledValues = [];

  for (let index = 0; index < length; index += step) {
    sampledTimes.push(times[index]);
    sampledValues.push(values[index]);
  }

  if (sampledTimes[sampledTimes.length - 1] !== times[length - 1]) {
    sampledTimes.push(times[length - 1]);
    sampledValues.push(values[length - 1]);
  }

  return {
    times: sampledTimes,
    values: sampledValues,
  };
}

function pickPeakTimes(times, peaks) {
  return peaks
    .filter((index) => index >= 0 && index < times.length)
    .map((index) => times[index]);
}

/**
 * Generate fallback sit-stand report data.
 *
 * The analysis always runs on the full-resolution series.
 * Display curves are downsampled separately to keep the report light.
 */
export function generateSitStandReportData(
  seatPressureHistory = [],
  footpadPressureHistory = [],
  seatStats = null,
  footpadStats = null,
  seatCoP = null,
  footpadCoP = null,
  timer = 0,
  options = {},
) {
  const seatTimes = buildRelativeTimes(
    seatPressureHistory.length,
    options.seatTimestamps,
    DEFAULT_INTERVAL_SEC,
  );
  const standTimes = buildRelativeTimes(
    footpadPressureHistory.length,
    options.footpadTimestamps,
    DEFAULT_INTERVAL_SEC,
  );
  const sitForce = seatPressureHistory.map((value) => roundTo(value, 1));
  const standForce = footpadPressureHistory.map((value) => roundTo(value, 1));

  const sitIntervalSec = getAverageIntervalSec(seatTimes, DEFAULT_INTERVAL_SEC);
  const minPeakDistance = Math.max(4, Math.round(2 / Math.max(sitIntervalSec, 0.001)));
  const peaks = detectPeaks(sitForce, minPeakDistance);
  const peakTimes = pickPeakTimes(seatTimes, peaks);

  const cycleDurations = [];
  for (let i = 0; i < peakTimes.length - 1; i++) {
    cycleDurations.push(roundTo(peakTimes[i + 1] - peakTimes[i], 2));
  }

  const numCycles = Math.max(peaks.length, 0);
  const avgDuration = numCycles > 0
    ? roundTo(Math.max(
      timer / 10,
      standTimes[standTimes.length - 1] || 0,
      seatTimes[seatTimes.length - 1] || 0,
    ) / numCycles, 2)
    : 0;
  const minCycleDuration = cycleDurations.length > 0 ? Math.min(...cycleDurations) : 0;
  const maxCycleDuration = cycleDurations.length > 0 ? Math.max(...cycleDurations) : 0;
  const totalDuration = roundTo(Math.max(
    timer / 10,
    standTimes[standTimes.length - 1] || 0,
    seatTimes[seatTimes.length - 1] || 0,
  ), 2);

  const cyclePeakForces = peaks.map((index) => standForce[index]);

  const footMax = standForce.length > 0 ? Math.max(...standForce) : 0;
  const footAvg = standForce.length > 0 ? standForce.reduce((a, b) => a + b, 0) / standForce.length : 0;
  const sitMax = sitForce.length > 0 ? Math.max(...sitForce) : 0;
  const sitAvg = sitForce.length > 0 ? sitForce.reduce((a, b) => a + b, 0) / sitForce.length : 0;

  const footDiffs = [];
  for (let i = 1; i < standForce.length; i++) {
    footDiffs.push(Math.abs(standForce[i] - standForce[i - 1]));
  }
  const sitDiffs = [];
  for (let i = 1; i < sitForce.length; i++) {
    sitDiffs.push(Math.abs(sitForce[i] - sitForce[i - 1]));
  }
  const maxFootRate = footDiffs.length > 0 ? Math.max(...footDiffs) : 0;
  const maxSitRate = sitDiffs.length > 0 ? Math.max(...sitDiffs) : 0;

  const displayStand = downsampleSeries(standTimes, standForce, options);
  const displaySit = downsampleSeries(seatTimes, sitForce, options);
  const cycles = detectCycles(footpadPressureHistory);

  return {
    test_date: new Date().toLocaleString('zh-CN'),
    duration_stats: {
      total_duration: totalDuration,
      num_cycles: numCycles,
      avg_duration: avgDuration,
      cycle_durations: cycleDurations,
      min_cycle_duration: roundTo(minCycleDuration, 2),
      max_cycle_duration: roundTo(maxCycleDuration, 2),
    },
    stand_frames: footpadPressureHistory.length,
    sit_frames: seatPressureHistory.length,
    stand_peaks: peaks.length,
    sit_peaks: peaks.length,
    pressure_stats: {
      foot_max: Math.round(footMax),
      foot_avg: Math.round(footAvg),
      sit_max: Math.round(sitMax),
      sit_avg: Math.round(sitAvg),
      max_foot_change_rate: roundTo(maxFootRate, 1),
      max_sit_change_rate: roundTo(maxSitRate, 1),
    },
    cycle_peak_forces: cyclePeakForces,
    seat_stats: seatStats ? {
      max_pressure: seatStats.max || 0,
      mean_pressure: seatStats.mean || 0,
      total_pressure: seatStats.totalPressure || 0,
      contact_area: seatStats.contactArea || 0,
    } : null,
    footpad_stats: footpadStats ? {
      max_pressure: footpadStats.max || 0,
      mean_pressure: footpadStats.mean || 0,
      total_pressure: footpadStats.totalPressure || 0,
      contact_area: footpadStats.contactArea || 0,
    } : null,
    seat_cop: seatCoP ? { x: seatCoP.x, y: seatCoP.y } : null,
    footpad_cop: footpadCoP ? { x: footpadCoP.x, y: footpadCoP.y } : null,
    seat_force_curve: { times: displaySit.times, values: displaySit.values },
    footpad_force_curve: { times: displayStand.times, values: displayStand.values },
    force_curves: {
      stand_times: standTimes,
      stand_force: standForce,
      sit_times: seatTimes,
      sit_force: sitForce,
      stand_peaks_idx: peaks,
      stand_peak_times: peakTimes,
      sit_peaks_idx: peaks,
      sit_peak_times: peakTimes,
    },
    display_force_curves: {
      stand_times: displayStand.times,
      stand_force: displayStand.values,
      sit_times: displaySit.times,
      sit_force: displaySit.values,
      stand_peak_times: peakTimes,
      sit_peak_times: peakTimes,
    },
    images: {
      stand_evolution: [],
      stand_cop_left: null,
      stand_cop_right: null,
      sit_evolution: [],
      sit_cop: null,
    },
    cycles,
    _generated: true,
  };
}

function detectPeaks(values, minDistance = 20) {
  if (values.length < 3) return [];

  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const std = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
  const threshold = mean + 0.5 * std;

  const peaks = [];
  for (let i = 1; i < values.length - 1; i++) {
    if (values[i] >= threshold && values[i] >= values[i - 1] && values[i] >= values[i + 1]) {
      if (peaks.length === 0 || (i - peaks[peaks.length - 1]) >= minDistance) {
        peaks.push(i);
      }
    }
  }
  return peaks;
}

function detectCycles(pressureHistory) {
  if (pressureHistory.length < 20) {
    return [{ start: 0, end: Math.max(pressureHistory.length - 1, 0) }];
  }

  const smoothed = smoothArray(pressureHistory, 5);
  const mean = smoothed.reduce((a, b) => a + b, 0) / smoothed.length;
  const threshold = mean * 0.5;

  const cycles = [];
  let inCycle = false;
  let cycleStart = 0;

  for (let i = 1; i < smoothed.length; i++) {
    if (!inCycle && smoothed[i] > threshold && smoothed[i - 1] <= threshold) {
      inCycle = true;
      cycleStart = i;
    } else if (inCycle && smoothed[i] <= threshold && smoothed[i - 1] > threshold) {
      inCycle = false;
      cycles.push({ start: cycleStart, end: i });
    }
  }

  if (inCycle) {
    cycles.push({ start: cycleStart, end: smoothed.length - 1 });
  }

  return cycles.length > 0 ? cycles : [{ start: 0, end: pressureHistory.length - 1 }];
}

function smoothArray(arr, windowSize) {
  const result = [];
  for (let i = 0; i < arr.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - windowSize); j <= Math.min(arr.length - 1, i + windowSize); j++) {
      sum += arr[j];
      count++;
    }
    result.push(sum / count);
  }
  return result;
}
