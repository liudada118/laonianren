/**
 * threeUtil1 - Three.js 辅助工具函数
 * 用于坐标计算和矩形交叉检测
 */
import * as THREE from 'three';

/**
 * 获取粒子系统在屏幕上的投影坐标范围
 */
export function getPointCoordinate({ particles, camera, position }) {
  if (!particles || !camera) return [{ x: 0, y: 0 }, { x: 0, y: 0 }];

  const box = new THREE.Box3().setFromObject(particles);
  const min = box.min.clone();
  const max = box.max.clone();

  // 加上 group 偏移
  min.x += position.x;
  min.y += position.y;
  min.z += position.z;
  max.x += position.x;
  max.y += position.y;
  max.z += position.z;

  const minScreen = toScreenPosition(min, camera);
  const maxScreen = toScreenPosition(max, camera);

  return [
    { x: Math.min(minScreen.x, maxScreen.x), y: Math.min(minScreen.y, maxScreen.y) },
    { x: Math.max(minScreen.x, maxScreen.x), y: Math.max(minScreen.y, maxScreen.y) }
  ];
}

export function getPointCoordinateback({ particles, camera, position }) {
  return getPointCoordinate({ particles, camera, position });
}

function toScreenPosition(position, camera) {
  const vector = position.clone().project(camera);
  return {
    x: (vector.x * 0.5 + 0.5) * window.innerWidth,
    y: (-vector.y * 0.5 + 0.5) * window.innerHeight
  };
}

/**
 * 检查两个矩形是否相交
 */
export function checkRectangleIntersection(rect1, rect2) {
  const [l1, t1, r1, b1] = rect1;
  const [l2, t2, r2, b2] = rect2;

  if (r1 < l2 || r2 < l1 || b1 < t2 || b2 < t1) {
    return null;
  }

  return [
    Math.max(l1, l2),
    Math.max(t1, t2),
    Math.min(r1, r2),
    Math.min(b1, b2)
  ];
}

/**
 * 根据矩形交叉区域计算选中的索引范围
 */
export function checkRectIndex(matrix, intersection, amountX, amountY) {
  if (!intersection || !matrix) return [0, 0, 0, 0];

  const [ml, mt, mr, mb] = matrix;
  const [il, it, ir, ib] = intersection;

  const width = mr - ml || 1;
  const height = mb - mt || 1;

  const startX = Math.floor(((il - ml) / width) * amountX);
  const endX = Math.ceil(((ir - ml) / width) * amountX);
  const startY = Math.floor(((it - mt) / height) * amountY);
  const endY = Math.ceil(((ib - mt) / height) * amountY);

  return [
    Math.max(0, Math.min(startX, amountX)),
    Math.max(0, Math.min(endX, amountX)),
    Math.max(0, Math.min(startY, amountY)),
    Math.max(0, Math.min(endY, amountY))
  ];
}
