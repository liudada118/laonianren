import { useState, useEffect, useRef, useCallback } from 'react';

const WS_URL = 'ws://localhost:3001';

export function useWebSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState(null);
  const wsRef = useRef(null);
  const listenersRef = useRef(new Map());
  const reconnectTimerRef = useRef(null);

  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(WS_URL);
      
      ws.onopen = () => {
        setIsConnected(true);
        console.log('WebSocket 已连接');
      };
      
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setLastMessage(data);
          
          // 触发对应类型的监听器
          const typeListeners = listenersRef.current.get(data.type);
          if (typeListeners) {
            typeListeners.forEach(cb => cb(data));
          }
          
          // 触发通配符监听器
          const allListeners = listenersRef.current.get('*');
          if (allListeners) {
            allListeners.forEach(cb => cb(data));
          }
        } catch (e) {
          console.error('WebSocket 消息解析错误:', e);
        }
      };
      
      ws.onclose = () => {
        setIsConnected(false);
        console.log('WebSocket 断开，3秒后重连...');
        reconnectTimerRef.current = setTimeout(connect, 3000);
      };
      
      ws.onerror = (error) => {
        console.error('WebSocket 错误:', error);
      };
      
      wsRef.current = ws;
    } catch (e) {
      console.error('WebSocket 连接失败:', e);
      reconnectTimerRef.current = setTimeout(connect, 3000);
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [connect]);

  const send = useCallback((data) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  const on = useCallback((type, callback) => {
    if (!listenersRef.current.has(type)) {
      listenersRef.current.set(type, new Set());
    }
    listenersRef.current.get(type).add(callback);
    
    return () => {
      const listeners = listenersRef.current.get(type);
      if (listeners) listeners.delete(callback);
    };
  }, []);

  return { isConnected, lastMessage, send, on };
}

export default useWebSocket;
