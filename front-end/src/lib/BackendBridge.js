/**
 * BackendBridge - 后端 WebSocket 桥接服务
 * 
 * 连接后端 serialServer 的 WebSocket (端口19999)，
 * 接收实时传感器数据并转换为前端各组件期望的格式。
 * 
 * 后端推送格式：
 *   手套模式: { data: { HL: { status, arr[256], stamp, HZ }, HR: {...} } }
 *   高频模式: { sitData: { foot1: { status, arr[4096], stamp, HZ }, sit: {...}, ... } }
 *   MAC信息: { macInfo: { ... } }
 * 
 * 前端期望格式：
 *   手套: 256个值的数组 (16x16矩阵)
 *   脚垫: 4096个值的数组 (64x64矩阵)
 *   坐垫: 1024个值的数组 (32x32矩阵)
 */

class BackendBridge {
  constructor() {
    this.ws = null;
    this.isConnected = false;
    this.reconnectTimer = null;
    // 动态确定后端地址
    // 在沙盒测试环境中，通过暴露的公网端口直接连接后端
    // 在本地开发中，直接使用 localhost
    const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      this.backendUrl = 'ws://localhost:19999';
      this.httpUrl = 'http://localhost:19245';
    } else {
      // 沙盒环境：使用暴露的端口域名
      // 从当前hostname推导后端地址（替换端口前缀）
      const baseHost = hostname.replace(/^\d+-/, '');
      this.backendUrl = `wss://19999-${baseHost}`;
      this.httpUrl = `https://19245-${baseHost}`;
    }
    
    // 事件监听器
    this._listeners = {
      connect: [],
      disconnect: [],
      error: [],
      // 手套数据
      leftHandData: [],   // (arr256) => void
      rightHandData: [],  // (arr256) => void
      // 脚垫数据
      foot1Data: [],      // (arr4096) => void
      foot2Data: [],      // (arr4096) => void
      foot3Data: [],      // (arr4096) => void
      foot4Data: [],      // (arr4096) => void
      // 坐垫数据
      sitData: [],        // (arr1024) => void
      // 设备状态
      deviceStatus: [],   // ({ type, status }) => void
      // MAC信息
      macInfo: [],        // (macInfo) => void
      // 原始数据（用于调试）
      rawData: [],        // (data) => void
    };

    // 设备在线状态
    this.deviceOnline = {};
    
    // FPS统计
    this.frameCount = {};
    this.lastFpsTime = Date.now();
    this.fps = {};
  }

  /* ─── 事件系统 ─── */
  on(event, callback) {
    if (this._listeners[event]) {
      this._listeners[event].push(callback);
    }
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (this._listeners[event]) {
      this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
    }
  }

  _emit(event, ...args) {
    if (this._listeners[event]) {
      this._listeners[event].forEach(cb => {
        try { cb(...args); } catch (e) { console.error(`[BackendBridge] listener error:`, e); }
      });
    }
  }

  /* ─── 连接管理 ─── */
  connect(url) {
    if (url) this.backendUrl = url;
    
    if (this.ws) {
      this.disconnect();
    }

    try {
      console.log(`[BackendBridge] Connecting to ${this.backendUrl}...`);
      this.ws = new WebSocket(this.backendUrl);

      this.ws.onopen = () => {
        this.isConnected = true;
        console.log('[BackendBridge] Connected');
        this._emit('connect');
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this._handleMessage(msg);
        } catch (e) {
          // 可能是非JSON数据
          console.warn('[BackendBridge] Non-JSON message:', event.data?.substring(0, 100));
        }
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        console.log('[BackendBridge] Disconnected');
        this._emit('disconnect');
        // 自动重连
        this.reconnectTimer = setTimeout(() => this.connect(), 3000);
      };

      this.ws.onerror = (error) => {
        console.error('[BackendBridge] Error:', error);
        this._emit('error', error);
      };
    } catch (e) {
      console.error('[BackendBridge] Connection failed:', e);
      this.reconnectTimer = setTimeout(() => this.connect(), 3000);
    }
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null; // 防止触发重连
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this._emit('disconnect');
  }

  /* ─── HTTP API 调用 ─── */
  async getPort() {
    const res = await fetch(`${this.httpUrl}/getPort`);
    return res.json();
  }

  async connPort() {
    const res = await fetch(`${this.httpUrl}/connPort`);
    return res.json();
  }

  async setActiveMode(mode) {
    const res = await fetch(`${this.httpUrl}/setActiveMode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
    return res.json();
  }

  async startCol({ name, assessmentId, sampleType, date, colName }) {
    const res = await fetch(`${this.httpUrl}/startCol`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, assessmentId, sample_type: sampleType, date, colName }),
    });
    return res.json();
  }

  async endCol() {
    const res = await fetch(`${this.httpUrl}/endCol`);
    return res.json();
  }

  async getColHistory() {
    const res = await fetch(`${this.httpUrl}/getColHistory`);
    return res.json();
  }

  /* ─── 报告生成 API ─── */

  /**
   * 获取握力报告数据
   * @param {object} params - { timestamp, collectName, leftAssessmentId, rightAssessmentId }
   * @returns {Promise<object>} { code, data: { render_data: { left, right, activeHand } }, msg }
   */
  async getGripReport(params = {}) {
    const res = await fetch(`${this.httpUrl}/getHandPdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return res.json();
  }

  /**
   * 获取站立评估报告数据
   * @param {object} params - { timestamp, assessmentId, fps, threshold_ratio }
   * @returns {Promise<object>} { code, data: { render_data }, msg }
   */
  async getStandingReport(params = {}) {
    const res = await fetch(`${this.httpUrl}/getDbHeatmap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return res.json();
  }

  /**
   * 获取步态评估报告数据
   * @param {object} params - { timestamp, assessmentId, collectName, body_weight_kg }
   * @returns {Promise<object>} { code, data: { render_data }, msg }
   */
  async getGaitReport(params = {}) {
    const res = await fetch(`${this.httpUrl}/getFootPdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return res.json();
  }

  /**
   * 获取起坐评估报告数据
   * @param {object} params - { timestamp, assessmentId, collectName }
   * @returns {Promise<object>} { code, data: { render_data }, msg }
   */
  async getSitStandReport(params = {}) {
    const res = await fetch(`${this.httpUrl}/getSitAndFootPdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return res.json();
  }

  /**
   * 导出采集数据为CSV文件
   * @param {object} params - { assessmentId, assessmentIds, sampleType }
   * @returns {Promise<object>} { code, data: { fileName, filePath, rowCount, dataKeys }, msg }
   */
  async exportCsv(params = {}) {
    const res = await fetch(`${this.httpUrl}/exportCsv`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return res.json();
  }

  /**
   * 获取CSV文件下载URL
   * @param {string} fileName - CSV文件名
   * @returns {string} 下载URL
   */
  getCsvDownloadUrl(fileName) {
    return `${this.httpUrl}/downloadCsvFile/${encodeURIComponent(fileName)}`;
  }

  async bindKey(key) {
    const res = await fetch(`${this.httpUrl}/bindKey`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    });
    return res.json();
  }

  /* ─── 消息处理 ─── */
  _handleMessage(msg) {
    // 触发原始数据事件
    this._emit('rawData', msg);

    // 手套模式数据: { data: { HL: {...}, HR: {...} } }
    if (msg.data && typeof msg.data === 'object') {
      this._processGloveData(msg.data);
    }

    // 高频模式数据: { sitData: { foot1: {...}, sit: {...}, ... } }
    if (msg.sitData && typeof msg.sitData === 'object') {
      this._processHighHZData(msg.sitData);
    }

    // MAC信息: { macInfo: {...} }
    if (msg.macInfo) {
      this._emit('macInfo', msg.macInfo);
    }
  }

  _processGloveData(data) {
    // 处理HL（左手）
    if (data.HL) {
      const status = data.HL.status;
      this._updateDeviceStatus('HL', status);
      if (status === 'online' && Array.isArray(data.HL.arr) && data.HL.arr.length === 256) {
        this._emit('leftHandData', data.HL.arr);
        this._countFrame('HL');
      }
    }

    // 处理HR（右手）
    if (data.HR) {
      const status = data.HR.status;
      this._updateDeviceStatus('HR', status);
      if (status === 'online' && Array.isArray(data.HR.arr) && data.HR.arr.length === 256) {
        this._emit('rightHandData', data.HR.arr);
        this._countFrame('HR');
      }
    }
  }

  _processHighHZData(data) {
    // 在高频模式下，后端可能也会包含HL/HR手套数据
    // 处理HL（左手）
    if (data.HL) {
      const status = data.HL.status;
      this._updateDeviceStatus('HL', status);
      if (status === 'online' && Array.isArray(data.HL.arr) && data.HL.arr.length === 256) {
        this._emit('leftHandData', data.HL.arr);
        this._countFrame('HL');
      }
    }

    // 处理HR（右手）
    if (data.HR) {
      const status = data.HR.status;
      this._updateDeviceStatus('HR', status);
      if (status === 'online' && Array.isArray(data.HR.arr) && data.HR.arr.length === 256) {
        this._emit('rightHandData', data.HR.arr);
        this._countFrame('HR');
      }
    }

    // 处理脚垫
    ['foot1', 'foot2', 'foot3', 'foot4'].forEach(type => {
      if (data[type]) {
        const status = data[type].status;
        this._updateDeviceStatus(type, status);
        if (status === 'online' && Array.isArray(data[type].arr)) {
          this._emit(`${type}Data`, data[type].arr);
          this._countFrame(type);
        }
      }
    });

    // 处理坐垫
    if (data.sit) {
      const status = data.sit.status;
      this._updateDeviceStatus('sit', status);
      if (status === 'online' && Array.isArray(data.sit.arr)) {
        this._emit('sitData', data.sit.arr);
        this._countFrame('sit');
      }
    }
  }

  _updateDeviceStatus(type, status) {
    const prev = this.deviceOnline[type];
    this.deviceOnline[type] = status;
    if (prev !== status) {
      this._emit('deviceStatus', { type, status });
    }
  }

  _countFrame(type) {
    if (!this.frameCount[type]) this.frameCount[type] = 0;
    this.frameCount[type]++;
    
    const now = Date.now();
    if (now - this.lastFpsTime >= 1000) {
      this.fps = { ...this.frameCount };
      this.frameCount = {};
      this.lastFpsTime = now;
    }
  }

  getFps() {
    return { ...this.fps };
  }

  getDeviceStatus() {
    return { ...this.deviceOnline };
  }
}

// 导出单例
export const backendBridge = new BackendBridge();
export default BackendBridge;
