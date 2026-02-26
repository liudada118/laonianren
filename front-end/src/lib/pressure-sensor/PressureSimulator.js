/**
 * 压力数据模拟器
 * 
 * 在无真实传感器时生成模拟压力数据。
 * 支持模式：static（静态站立）、dynamic（动态行走）、sitting（静态坐姿）
 */

export class PressureSimulator {
  /**
   * @param {number} size - 矩阵尺寸（32 或 64）
   * @param {'static'|'dynamic'|'sitting'} mode - 模拟模式
   */
  constructor(size = 32, mode = 'sitting') {
    this.size = size;
    this.mode = mode;
    this.time = 0;
  }

  setMode(mode) {
    this.mode = mode;
  }

  /**
   * 生成一帧模拟数据
   * @param {number} dt - 时间增量（秒）
   * @returns {number[][]} 压力矩阵（值范围 0-255）
   */
  update(dt) {
    this.time += dt;

    const matrix = [];
    for (let r = 0; r < this.size; r++) {
      matrix.push(new Array(this.size).fill(0));
    }

    switch (this.mode) {
      case 'static':
        this.simulateStaticFoot(matrix);
        break;
      case 'dynamic':
        this.simulateWalkingCycle(matrix);
        break;
      case 'sitting':
        this.simulateSitting(matrix);
        break;
    }

    return matrix;
  }

  simulateSitting(matrix) {
    const s = this.size;
    const cx = s / 2;
    const cy = s / 2;

    // 左臀
    this.addPressurePoint(matrix, cy - s * 0.15, cx - s * 0.15, 200, s * 0.2);
    // 右臀
    this.addPressurePoint(matrix, cy - s * 0.15, cx + s * 0.15, 200, s * 0.2);
    // 大腿前部
    this.addPressurePoint(matrix, cy + s * 0.15, cx - s * 0.1, 120, s * 0.15);
    this.addPressurePoint(matrix, cy + s * 0.15, cx + s * 0.1, 120, s * 0.15);
    // 尾骨区域
    this.addPressurePoint(matrix, cy - s * 0.3, cx, 150, s * 0.12);

    // 微小呼吸波动
    const breathFactor = 1.0 + 0.03 * Math.sin(this.time * 2.0);
    for (let r = 0; r < s; r++) {
      for (let c = 0; c < s; c++) {
        matrix[r][c] = Math.min(255, Math.round(matrix[r][c] * breathFactor));
      }
    }
  }

  simulateStaticFoot(matrix) {
    const s = this.size;
    const half = s / 2;

    // 左脚
    this.addPressurePoint(matrix, s * 0.78, half * 0.5, 180, s * 0.08);
    this.addPressurePoint(matrix, s * 0.3, half * 0.3, 140, s * 0.06);
    this.addPressurePoint(matrix, s * 0.25, half * 0.7, 200, s * 0.06);

    // 右脚
    this.addPressurePoint(matrix, s * 0.78, half * 1.5, 180, s * 0.08);
    this.addPressurePoint(matrix, s * 0.3, half * 1.3, 200, s * 0.06);
    this.addPressurePoint(matrix, s * 0.25, half * 1.7, 140, s * 0.06);
  }

  simulateWalkingCycle(matrix) {
    const t = (this.time % 2.0) / 2.0;
    const s = this.size;
    const half = s / 2;

    this.simulateSingleFootStep(matrix, t, 0, half);
    this.simulateSingleFootStep(matrix, (t + 0.5) % 1.0, half, s);
  }

  simulateSingleFootStep(matrix, t, colStart, colEnd) {
    const s = this.size;
    const cols = colEnd - colStart;
    const centerCol = colStart + cols / 2;

    const centerRow = s * 0.85 - t * s * 0.7;
    const intensity = Math.sin(t * Math.PI) * 220;

    for (let r = 0; r < s; r++) {
      for (let c = colStart; c < colEnd; c++) {
        const dist = Math.sqrt(
          Math.pow(r - centerRow, 2) + Math.pow(c - centerCol, 2)
        );
        const val = intensity * Math.exp(-(dist * dist) / (s * 0.5));
        matrix[r][c] = Math.min(255, Math.round(matrix[r][c] + Math.max(0, val)));
      }
    }
  }

  addPressurePoint(matrix, row, col, intensity, radius) {
    const s = this.size;
    for (let r = 0; r < s; r++) {
      for (let c = 0; c < s; c++) {
        const dist = Math.sqrt(Math.pow(r - row, 2) + Math.pow(c - col, 2));
        const val = intensity * Math.exp(-(dist * dist) / (2 * radius * radius));
        matrix[r][c] = Math.min(255, Math.round(matrix[r][c] + Math.max(0, val)));
      }
    }
  }
}
