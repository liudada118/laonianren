/**
 * FootpadSceneReact.jsx - React 封装的足底压力3D场景组件
 * 
 * 对 FootpadScene 的 React 封装，方便在 React 项目中直接使用。
 * 
 * 依赖：react >= 18.0.0, three >= 0.150.0
 * 
 * @example
 * import FootpadSceneReact from './FootpadSceneReact';
 * 
 * function App() {
 *   const [sensorData, setSensorData] = useState({});
 *   return (
 *     <FootpadSceneReact
 *       sensorCount={4}
 *       showHeatmap={true}
 *       depthScale={0.15}
 *       smoothness={0.5}
 *       sensorData={sensorData}
 *       style={{ width: '100%', height: '600px' }}
 *     />
 *   );
 * }
 */

import { useRef, useEffect } from 'react';
import { FootpadScene } from './FootpadScene.js';

export default function FootpadSceneReact({
  sensorCount = 4,
  showHeatmap = true,
  depthScale = 0,
  smoothness = 0.5,
  sensorData = {},
  baseColor = '#f0f0f0',
  backgroundColor = '#e0dcd8',
  padSize = 0.8,
  showFloor = true,
  showBasePlate = true,
  cameraPosition = [0, 3.2, 2.8],
  style = {},
  className = '',
  onSceneReady = null,
}) {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);

  // 初始化场景
  useEffect(() => {
    if (!containerRef.current) return;

    const scene = new FootpadScene(containerRef.current, {
      sensorCount,
      padSize,
      showHeatmap,
      depthScale,
      smoothness,
      baseColor,
      backgroundColor,
      showFloor,
      showBasePlate,
      cameraPosition,
    });

    sceneRef.current = scene;
    if (onSceneReady) onSceneReady(scene);

    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, [sensorCount]); // 仅在传感器数量变化时重建场景

  // 更新参数
  useEffect(() => {
    if (!sceneRef.current) return;
    sceneRef.current.setShowHeatmap(showHeatmap);
  }, [showHeatmap]);

  useEffect(() => {
    if (!sceneRef.current) return;
    sceneRef.current.setDepthScale(depthScale);
  }, [depthScale]);

  useEffect(() => {
    if (!sceneRef.current) return;
    sceneRef.current.setSmoothness(smoothness);
  }, [smoothness]);

  // 更新传感器数据
  useEffect(() => {
    if (!sceneRef.current) return;
    sceneRef.current.updateAllSensorData(sensorData);
  }, [sensorData]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        background: `linear-gradient(135deg, #d4d0cc 0%, ${backgroundColor} 50%, #d8d4d0 100%)`,
        ...style,
      }}
    />
  );
}
