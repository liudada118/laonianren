/**
 * 3D 鞋垫场景容器 - 基于 huisheng-sdk Scene.tsx
 * 使用 React Three Fiber Canvas + OrbitControls + 环境光
 * 
 * 数据传递方案：
 * - 方式1（推荐）：传入 externalDataRef（外部 useRef），直接修改 ref.current 即可更新3D，无需触发重渲染
 * - 方式2（兼容）：传入 realtimeData prop，通过 useEffect 更新内部 ref
 * 
 * 两种方式都通过 InsoleDataContext 将 ref 传递给 InsoleModel，
 * InsoleModel 在 useFrame 中读取 ref.current 更新纹理。
 */
import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Environment, ContactShadows } from '@react-three/drei';
import InsoleModel from './InsoleModel';
import { Suspense, memo, useRef, useEffect, createContext, useContext } from 'react';

// 用 Context 传递数据 ref，避免 prop 变化导致 Canvas 重建
export const InsoleDataContext = createContext({ current: null });

function InsoleSceneInner({ showHeatmap, enableClipping, clipLevel, depthScale, smoothness }) {
  const dataRef = useContext(InsoleDataContext);
  return (
    <InsoleModel
      showHeatmap={showHeatmap}
      enableClipping={enableClipping}
      clipLevel={clipLevel}
      depthScale={depthScale}
      smoothness={smoothness}
      dataRef={dataRef}
    />
  );
}

function InsoleScene({
  showHeatmap = true,
  enableClipping = false,
  clipLevel = 0.5,
  depthScale = 0.3,
  smoothness = 0.5,
  realtimeData = null,
  externalDataRef = null  // 外部传入的 ref，优先使用
}) {
  // 内部 ref 作为 fallback
  const internalRef = useRef(null);
  
  // 优先使用外部 ref，否则用内部 ref
  const dataRef = externalDataRef || internalRef;
  
  // 如果使用内部 ref + realtimeData prop 模式，同步更新
  // 注意：由于 memo 排除了 realtimeData，这个 useEffect 在 memo 模式下不会触发
  // 所以推荐使用 externalDataRef 方式
  useEffect(() => {
    if (!externalDataRef) {
      internalRef.current = realtimeData;
    }
  }, [realtimeData, externalDataRef]);

  return (
    <InsoleDataContext.Provider value={dataRef}>
      <div className="w-full h-full relative" style={{ background: 'linear-gradient(to bottom, #f8f9fa, #e5e7eb)' }}>
        <Canvas shadows dpr={[1, 2]} frameloop="always">
          <PerspectiveCamera makeDefault position={[0, 4, 4]} fov={50} />
          <OrbitControls
            enablePan={true}
            minPolarAngle={0}
            maxPolarAngle={Math.PI / 2}
            target={[0, 0, 0]}
          />

          <ambientLight intensity={0.4} />
          <spotLight position={[10, 10, 10]} angle={0.15} penumbra={1} intensity={0.8} castShadow />
          <pointLight position={[-10, 5, -10]} intensity={0.5} />

          <Suspense fallback={null}>
            <Environment preset="studio" />
            <group position={[0, 0, 0]}>
              <InsoleSceneInner
                showHeatmap={showHeatmap}
                enableClipping={enableClipping}
                clipLevel={clipLevel}
                depthScale={depthScale}
                smoothness={smoothness}
              />
            </group>
            <ContactShadows position={[0, -0.1, 0]} opacity={0.4} scale={10} blur={2} far={4} />
          </Suspense>
        </Canvas>

        <div className="absolute bottom-3 left-3 text-[10px] pointer-events-none" style={{ color: 'var(--text-muted, #999)' }}>
          <p>左键拖拽: 旋转 | 右键拖拽: 平移 | 滚轮: 缩放</p>
        </div>
      </div>
    </InsoleDataContext.Provider>
  );
}

// memo 比较中排除 realtimeData 和 externalDataRef — 它们通过 ref 传递，不需要触发重渲染
export default memo(InsoleScene, (prev, next) => {
  return prev.showHeatmap === next.showHeatmap
    && prev.enableClipping === next.enableClipping
    && prev.clipLevel === next.clipLevel
    && prev.depthScale === next.depthScale
    && prev.smoothness === next.smoothness;
});
