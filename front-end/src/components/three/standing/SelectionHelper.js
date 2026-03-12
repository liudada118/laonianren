/**
 * SelectionHelper - 用于在 Three.js 渲染器上进行矩形框选
 * 适配自原始项目的 SelectionHelper
 */
export class SelectionHelper {
  constructor(renderer, controls, cssClass) {
    this.renderer = renderer;
    this.controls = controls;
    this.element = document.createElement('div');
    this.element.classList.add(cssClass || 'selectBox');
    this.element.style.pointerEvents = 'none';
    this.element.style.position = 'fixed';
    this.element.style.border = '2px dashed #0066CC';
    this.element.style.backgroundColor = 'rgba(0, 102, 204, 0.1)';
    this.element.style.display = 'none';
    this.element.style.zIndex = '999';
    document.body.appendChild(this.element);

    this.startPoint = { x: 0, y: 0 };
    this.isShiftPressed = false;
    this.isDown = false;
  }

  onSelectStart(event) {
    if (!this.isShiftPressed) return;
    this.isDown = true;
    this.startPoint.x = event.clientX;
    this.startPoint.y = event.clientY;
    this.element.style.left = event.clientX + 'px';
    this.element.style.top = event.clientY + 'px';
    this.element.style.width = '0px';
    this.element.style.height = '0px';
    this.element.style.display = 'block';
  }

  onSelectMove(event) {
    if (!this.isDown || !this.isShiftPressed) return;
    const x = Math.min(event.clientX, this.startPoint.x);
    const y = Math.min(event.clientY, this.startPoint.y);
    const w = Math.abs(event.clientX - this.startPoint.x);
    const h = Math.abs(event.clientY - this.startPoint.y);
    this.element.style.left = x + 'px';
    this.element.style.top = y + 'px';
    this.element.style.width = w + 'px';
    this.element.style.height = h + 'px';
  }

  onSelectOver() {
    this.isDown = false;
    this.element.style.display = 'none';
  }
}

export default SelectionHelper;
