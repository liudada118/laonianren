# 点击测试 Bug 根因分析

## 核心发现

从截图 T03b 可以看到：握力评估页面顶部显示"后端模式 断开"。
这里的"断开"按钮实际上是一个断开连接的操作按钮，不是状态显示。
但关键问题是：按钮的显示条件。

### 按钮显示条件分析

1. 开始采集按钮显示条件: `phase.includes('idle') && deviceStatus === 'connected'`
2. 请先连接传感器显示条件: `phase.includes('idle') && deviceStatus !== 'connected'`

### deviceStatus 的初始化

```javascript
const isGlobalConnected = deviceConnStatus === 'connected';
const [deviceStatus, setDeviceStatus] = useState(isGlobalConnected ? 'connected' : 'disconnected');
```

### 问题

从截图看，页面显示了"开始采集左手"按钮（而非"请先连接传感器"），说明 deviceStatus === 'connected'。
但点击后 startRecording 没有正确执行或页面没有正确更新。

### 真正的问题

回看截图：T04 和 T05 的截图与 T03b 完全相同，说明：
1. 按钮确实被点击了（没有报错）
2. startRecording 函数确实执行了
3. phase 确实从 'left-idle' 变为 'left-recording'
4. 但截图没有变化 → 可能是 Playwright 截图时机问题，或者 UI 渲染延迟

### 重新分析

T06 失败的真正原因是：locator('span:has-text("结束采集左手")') 找不到。
但从代码看，当 phase === 'left-recording' 时，应该显示"结束采集左手"。

可能的原因：
1. 按钮的 span 文本是"结束采集左手"，但它在一个 button 内部
2. Playwright 的 locator 可能需要更精确的选择器
3. 或者 phase 没有真正切换到 recording

### 最终结论

从截图 T05 看，页面仍然显示"开始采集左手"，说明 startRecording 虽然被调用了，但 setPhase 没有生效，或者 UI 没有重新渲染。

这可能是因为：在后端模式下，startRecording 调用了 backendBridge.setActiveMode(handMode) 和 backendBridge.startCol()，
如果这些异步调用失败或超时，可能导致状态没有正确更新。

但从代码看，setPhase 是在异步调用之前执行的：
```javascript
setPhase(isLeft ? 'left-recording' : 'right-recording');
```

所以 phase 应该已经切换了。问题可能是 Playwright 的 span 选择器不匹配。
