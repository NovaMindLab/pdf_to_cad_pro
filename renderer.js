import * as THREE from './assets/three.module.js';

const layerColorMap = {
  'LINES': '#f3f4f6',
  'RECTS': '#d1d5db',
  'POLYLINES': '#00f2fe',
  'TEXTS': '#10b981',
  'SYMBOLS': '#f59e0b'
};

// --- THREE.JS HIGH-PERFORMANCE CAD VIEWPORT ENGINE ---
class ThreeCadEngine {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.dxfGroup = null;
    this.overlayGroup = null;
    this.textGroup = null;
    
    // Grips / Handles
    this.gripPoints = null;
    
    // Dynamic rubberband for drawing
    this.rubberbandLine = null;
    this.rubberbandRect = null;
    
    // Dynamic hover highlight
    this.hoverLine = null;
    
    // Selected highlight
    this.selectedLine = null;

    this.init();
  }

  init() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    this.renderer.setClearColor(0x05080f, 1);

    this.scene = new THREE.Scene();
    
    // Orthographic Camera (standard 2D CAD projection)
    this.camera = new THREE.OrthographicCamera(-400, 400, 300, -300, 0.1, 2000);
    this.camera.position.set(0, 0, 500);
    this.camera.lookAt(0, 0, 0);

    // Groups
    this.dxfGroup = new THREE.Group();
    this.scene.add(this.dxfGroup);

    this.textGroup = new THREE.Group();
    this.scene.add(this.textGroup);

    this.overlayGroup = new THREE.Group();
    this.overlayGroup.position.z = 10;
    // 多选框 (Bounding Box Drag Selection)
    const boxMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, opacity: 0.2, transparent: true, side: THREE.DoubleSide });
    const boxGeo = new THREE.PlaneGeometry(1, 1);
    this.selectionBoxMesh = new THREE.Mesh(boxGeo, boxMat);
    this.selectionBoxMesh.position.z = 12;
    this.selectionBoxMesh.visible = false;
    this.overlayGroup.add(this.selectionBoxMesh);

    const boxEdgeMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, depthTest: false });
    this.selectionBoxLine = new THREE.LineLoop(boxGeo, boxEdgeMat);
    this.selectionBoxLine.position.z = 13;
    this.selectionBoxLine.visible = false;
    this.overlayGroup.add(this.selectionBoxLine);

    this.scene.add(this.overlayGroup);

    this.initOverlayMeshes();
  }

  initOverlayMeshes() {
    // 1. Rubberband Line for Line Drawing Tool
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0, 0,0,0], 3));
    const lineMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, linewidth: 1 });
    this.rubberbandLine = new THREE.Line(lineGeo, lineMat);
    this.rubberbandLine.visible = false;
    this.overlayGroup.add(this.rubberbandLine);

    // 2. Rubberband Rect for Rect Drawing Tool
    const rectGeo = new THREE.BufferGeometry();
    rectGeo.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0, 0,0,0, 0,0,0, 0,0,0, 0,0,0], 3));
    const rectMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, linewidth: 1 });
    this.rubberbandRect = new THREE.Line(rectGeo, rectMat);
    this.rubberbandRect.visible = false;
    this.overlayGroup.add(this.rubberbandRect);

    // 3. Hover Highlight Line
    const hoverGeo = new THREE.BufferGeometry();
    const hoverMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, linewidth: 2 });
    this.hoverLine = new THREE.LineSegments(hoverGeo, hoverMat);
    this.hoverLine.visible = false;
    this.overlayGroup.add(this.hoverLine);

    // 4. Selection Highlight Line
    const selGeo = new THREE.BufferGeometry();
    const selMat = new THREE.LineBasicMaterial({ color: 0xfacc15, linewidth: 2 });
    this.selectedLine = new THREE.LineSegments(selGeo, selMat);
    this.selectedLine.visible = false;
    this.overlayGroup.add(this.selectedLine);

    // 5. Node Grips (Points / Handles)
    const gripGeo = new THREE.BufferGeometry();
    const gripMat = new THREE.PointsMaterial({ color: 0x38bdf8, size: 8, sizeAttenuation: false });
    this.gripPoints = new THREE.Points(gripGeo, gripMat);
    this.gripPoints.visible = false;
    this.overlayGroup.add(this.gripPoints);

    // 6. Drag Dimension & Leader Lines Group
    this.dragDimensionGroup = new THREE.Group();
    this.dragDimensionGroup.position.z = 15;
    this.dragDimensionGroup.visible = false;
    this.overlayGroup.add(this.dragDimensionGroup);

    // 7. Snap Magnetic Indicator (Green crosshair + ring for nodes and endpoints)
    const snapPositions = [];
    const snapSegs = 20;
    for (let i = 0; i <= snapSegs; i++) {
      const theta = (i / snapSegs) * Math.PI * 2;
      const nextTheta = ((i + 1) / snapSegs) * Math.PI * 2;
      snapPositions.push(Math.cos(theta), Math.sin(theta), 0, Math.cos(nextTheta), Math.sin(nextTheta), 0);
    }
    // Snap crosshairs
    snapPositions.push(-1.4, 0, 0, 1.4, 0, 0, 0, -1.4, 0, 0, 1.4, 0);
    const snapGeo = new THREE.BufferGeometry();
    snapGeo.setAttribute('position', new THREE.Float32BufferAttribute(snapPositions, 3));
    const snapMat = new THREE.LineSegments(snapGeo, new THREE.LineBasicMaterial({ color: 0x4ade80, linewidth: 2 }));
    this.snapIndicator = snapMat;
    this.snapIndicator.position.z = 20;
    this.snapIndicator.visible = false;
    this.overlayGroup.add(this.snapIndicator);
  }

  resize(width, height) {
    if (width <= 0 || height <= 0) return;
    this.renderer.setSize(width, height, false);
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
  }

  updateCamera(viewW, viewH, zoom, offsetX, offsetY, dxfCenterX, dxfCenterY) {
    if (viewW <= 0 || viewH <= 0) return;

    this.camera.left = -viewW / 2;
    this.camera.right = viewW / 2;
    this.camera.top = viewH / 2;
    this.camera.bottom = -viewH / 2;
    this.camera.zoom = zoom;

    // Mathematical 1:1 match with 2D Canvas coordinate mapping
    const camX = dxfCenterX - offsetX / zoom;
    const camY = dxfCenterY + offsetY / zoom;
    this.camera.position.set(camX, camY, 500);
    this.camera.updateProjectionMatrix();
  }

  buildDxfScene(entities) {
    // Clear previous geometries and textures
    while (this.dxfGroup.children.length > 0) {
      const obj = this.dxfGroup.children[0];
      this.dxfGroup.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    }

    while (this.textGroup.children.length > 0) {
      const obj = this.textGroup.children[0];
      this.textGroup.remove(obj);
      if (obj.material && obj.material.map) obj.material.map.dispose();
      if (obj.material) obj.material.dispose();
      if (obj.geometry) obj.geometry.dispose();
    }

    if (!entities || entities.length === 0) return;

    // 1. Group segments by color
    const segmentsByColor = {};
    const textEntities = [];

    const addEntitySegments = (ent, parentColor = null) => {
      if (!ent) return;
      const color = ent.color || parentColor || (layerColorMap[ent.layer] || '#ffffff');
      if (!segmentsByColor[color]) segmentsByColor[color] = [];
      const segs = segmentsByColor[color];

      if (ent.type === 'LINE') {
        segs.push(ent.x0, ent.y0, 0, ent.x1, ent.y1, 0);
      } else if (ent.type === 'LWPOLYLINE') {
        const verts = ent.vertices;
        if (verts && verts.length > 1) {
          for (let i = 0; i < verts.length - 1; i++) {
            segs.push(verts[i].x, verts[i].y, 0, verts[i + 1].x, verts[i + 1].y, 0);
          }
          if (ent.closed && verts.length > 2) {
            segs.push(verts[verts.length - 1].x, verts[verts.length - 1].y, 0, verts[0].x, verts[0].y, 0);
          }
        }
      } else if (ent.type === 'TEXT') {
        textEntities.push(ent);
      } else if (ent.type === 'GROUP' && ent.children) {
        for (let i = 0; i < ent.children.length; i++) {
          addEntitySegments(ent.children[i], ent.color || parentColor);
        }
      }
    };

    for (let i = 0; i < entities.length; i++) {
      addEntitySegments(entities[i]);
    }

    // 2. Create GPU BufferGeometries for line segments (1 draw call per color!)
    for (const colorHex in segmentsByColor) {
      const segs = segmentsByColor[colorHex];
      if (segs.length === 0) continue;

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
      
      const material = new THREE.LineBasicMaterial({
        color: new THREE.Color(colorHex),
        linewidth: 1
      });

      const lineSegments = new THREE.LineSegments(geometry, material);
      this.dxfGroup.add(lineSegments);
    }

    // 3. Build Text Sprites / Planes with high sharpness
    for (let i = 0; i < textEntities.length; i++) {
      const t = textEntities[i];
      if (!t.text) continue;
      const sprite = this.createTextMesh(t);
      if (sprite) this.textGroup.add(sprite);
    }
  }

  createTextMesh(t) {
    const text = t.text || '';
    const height = Math.max(1, t.height || 12);
    const color = t.color || (layerColorMap[t.layer] || '#10b981');

    if (!this._textureCache) this._textureCache = new Map();
    const cacheKey = `${text}_${Math.round(height)}_${color}`;
    let texture = this._textureCache.get(cacheKey);
    let aspect = 1.0;

    if (!texture) {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const fontSize = 64; // High resolution base font size for crisp text
      ctx.font = `${fontSize}px 'Outfit', sans-serif`;
      const metrics = ctx.measureText(text);
      const textW = Math.max(metrics.width, 10);
      const textH = fontSize * 1.3;

      canvas.width = Math.ceil(textW + 16);
      canvas.height = Math.ceil(textH + 16);

      ctx.font = `${fontSize}px 'Outfit', sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.fillStyle = color;
      ctx.fillText(text, 8, canvas.height / 2);

      texture = new THREE.CanvasTexture(canvas);
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      aspect = canvas.width / canvas.height;
      texture.userData = { aspect };
      this._textureCache.set(cacheKey, texture);
    } else {
      aspect = texture.userData ? texture.userData.aspect : 1.0;
    }

    const worldH = height * 1.2;
    const worldW = worldH * aspect;

    const planeGeo = new THREE.PlaneGeometry(worldW, worldH);
    const planeMat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false
    });

    const mesh = new THREE.Mesh(planeGeo, planeMat);
    // Align bottom-left of text with (t.x, t.y) in CAD Y-up
    mesh.position.set(t.x + worldW / 2, t.y + worldH / 2, 0.5);
    return mesh;
  }

  updateHoverHighlight(entity) {
    if (!entity) {
      this.hoverLine.visible = false;
      return;
    }
    const segs = [];
    this.extractEntitySegments(entity, segs);
    if (segs.length > 0) {
      this.hoverLine.geometry.dispose();
      this.hoverLine.geometry = new THREE.BufferGeometry();
      this.hoverLine.geometry.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
      this.hoverLine.visible = true;
    } else {
      this.hoverLine.visible = false;
    }
  }

  updateSelectionHighlight(entities, hoveredNode) {
    if (!entities || (Array.isArray(entities) && entities.length === 0) || (entities instanceof Set && entities.size === 0)) {
      this.selectedLine.visible = false;
      this.gripPoints.visible = false;
      return;
    }
    const segs = [];
    const grips = [];
    
    const entArray = entities instanceof Set ? Array.from(entities) : (Array.isArray(entities) ? entities : [entities]);
    
    for (const ent of entArray) {
      if (ent) this.extractEntitySegments(ent, segs, grips);
    }
    
    if (segs.length > 0) {
      this.selectedLine.geometry.dispose();
      this.selectedLine.geometry = new THREE.BufferGeometry();
      this.selectedLine.geometry.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
      this.selectedLine.visible = true;
    } else {
      this.selectedLine.visible = false;
    }

    if (grips.length > 0) {
      this.gripPoints.geometry.dispose();
      this.gripPoints.geometry = new THREE.BufferGeometry();
      this.gripPoints.geometry.setAttribute('position', new THREE.Float32BufferAttribute(grips, 3));
      this.gripPoints.visible = true;
    } else {
      this.gripPoints.visible = false;
    }
  }

  extractEntitySegments(ent, segs, grips) {
    if (!ent) return;
    if (ent.type === 'LINE') {
      segs.push(ent.x0, ent.y0, 1, ent.x1, ent.y1, 1);
      if (grips) grips.push(ent.x0, ent.y0, 2, ent.x1, ent.y1, 2);
    } else if (ent.type === 'LWPOLYLINE') {
      const verts = ent.vertices;
      if (verts && verts.length > 0) {
        for (let i = 0; i < verts.length; i++) {
          if (grips) grips.push(verts[i].x, verts[i].y, 2);
          if (i < verts.length - 1) {
            segs.push(verts[i].x, verts[i].y, 1, verts[i + 1].x, verts[i + 1].y, 1);
          }
        }
        if (ent.closed && verts.length > 2) {
          segs.push(verts[verts.length - 1].x, verts[verts.length - 1].y, 1, verts[0].x, verts[0].y, 1);
        }
      }
    } else if (ent.type === 'TEXT') {
      const tw = ent.tw || 20;
      const th = ent.th || 10;
      segs.push(
        ent.x, ent.y, 1, ent.x + tw, ent.y, 1,
        ent.x + tw, ent.y, 1, ent.x + tw, ent.y + th, 1,
        ent.x + tw, ent.y + th, 1, ent.x, ent.y + th, 1,
        ent.x, ent.y + th, 1, ent.x, ent.y, 1
      );
      if (grips) grips.push(ent.x, ent.y, 2);
    } else if (ent.type === 'GROUP' && ent.children) {
      for (let i = 0; i < ent.children.length; i++) {
        this.extractEntitySegments(ent.children[i], segs, grips);
      }
    }
  }

  updateDrawingPreview(tool, startDxf, currentDxf) {
    if (tool === 'line') {
      this.rubberbandRect.visible = false;
      const pos = this.rubberbandLine.geometry.attributes.position;
      pos.setXYZ(0, startDxf.x, startDxf.y, 1);
      pos.setXYZ(1, currentDxf.x, currentDxf.y, 1);
      pos.needsUpdate = true;
      this.rubberbandLine.visible = true;
    } else if (tool === 'rect') {
      this.rubberbandLine.visible = false;
      const pos = this.rubberbandRect.geometry.attributes.position;
      const x0 = startDxf.x, y0 = startDxf.y;
      const x1 = currentDxf.x, y1 = currentDxf.y;
      pos.setXYZ(0, x0, y0, 1);
      pos.setXYZ(1, x1, y0, 1);
      pos.setXYZ(2, x1, y1, 1);
      pos.setXYZ(3, x0, y1, 1);
      pos.setXYZ(4, x0, y0, 1);
      pos.needsUpdate = true;
      this.rubberbandRect.visible = true;
    } else {
      this.rubberbandLine.visible = false;
      this.rubberbandRect.visible = false;
    }
  }

  hideDrawingPreview() {
    this.rubberbandLine.visible = false;
    this.rubberbandRect.visible = false;
  }

  drawSelectionBox(startScreen, currentScreen, camera, offsetX, offsetY, zoom, viewW, viewH, dxfCenterX, dxfCenterY) {
    const sDxf = this._screenToDxf(startScreen.x, startScreen.y, offsetX, offsetY, zoom, viewW, viewH, dxfCenterX, dxfCenterY);
    const cDxf = this._screenToDxf(currentScreen.x, currentScreen.y, offsetX, offsetY, zoom, viewW, viewH, dxfCenterX, dxfCenterY);
    
    const minX = Math.min(sDxf.x, cDxf.x);
    const maxX = Math.max(sDxf.x, cDxf.x);
    const minY = Math.min(sDxf.y, cDxf.y);
    const maxY = Math.max(sDxf.y, cDxf.y);
    
    const w = Math.max(maxX - minX, 0.001);
    const h = Math.max(maxY - minY, 0.001);
    
    this.selectionBoxMesh.scale.set(w, h, 1);
    this.selectionBoxMesh.position.set(minX + w/2, minY + h/2, 12);
    this.selectionBoxMesh.visible = true;

    this.selectionBoxLine.scale.set(w, h, 1);
    this.selectionBoxLine.position.set(minX + w/2, minY + h/2, 13);
    this.selectionBoxLine.visible = true;
  }

  hideSelectionBox() {
    this.selectionBoxMesh.visible = false;
    this.selectionBoxLine.visible = false;
  }

  _screenToDxf(screenX, screenY, offsetX, offsetY, zoom, viewW, viewH, dxfCenterX, dxfCenterY) {
    const localX = (screenX - offsetX - viewW / 2) / zoom + dxfCenterX;
    const localY = -(screenY - offsetY - viewH / 2) / zoom + dxfCenterY;
    return { x: localX, y: localY };
  }

  createDimensionBadge(text, x, y, textColor = '#38bdf8', bgColor = 'rgba(15, 23, 42, 0.9)') {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const fontSize = 48;
    ctx.font = `bold ${fontSize}px 'Outfit', sans-serif`;
    const textMetrics = ctx.measureText(text);
    const textWidth = Math.max(textMetrics.width, 20);
    const paddingX = 24;
    const paddingY = 16;
    const canvasW = Math.ceil(textWidth + paddingX * 2);
    const canvasH = Math.ceil(fontSize + paddingY * 2);

    canvas.width = canvasW;
    canvas.height = canvasH;

    // Draw rounded background pill
    ctx.fillStyle = bgColor;
    const radius = 12;
    ctx.beginPath();
    ctx.roundRect(0, 0, canvasW, canvasH, radius);
    ctx.fill();

    ctx.strokeStyle = textColor === '#facc15' ? 'rgba(250, 204, 21, 0.6)' : 'rgba(56, 189, 248, 0.6)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(0, 0, canvasW, canvasH, radius);
    ctx.stroke();

    ctx.font = `bold ${fontSize}px 'Outfit', sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillStyle = textColor;
    ctx.fillText(text, canvasW / 2, canvasH / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;

    // Keep badge visible and legible at various zoom levels
    const curZoom = (this.camera && this.camera.zoom) ? this.camera.zoom : 1.0;
    const worldH = Math.max(8, 16 / curZoom);
    const aspect = canvasW / canvasH;
    const worldW = worldH * aspect;

    const planeGeo = new THREE.PlaneGeometry(worldW, worldH);
    const planeMat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false
    });

    const mesh = new THREE.Mesh(planeGeo, planeMat);
    mesh.position.set(x, y, 1.2);
    return mesh;
  }

  updateDragDimensions(originDxf, currentDxf, connectedLines, targetName) {
    if (!this.dragDimensionGroup) return;
    this.hideDragDimensions();

    const dx = currentDxf.x - originDxf.x;
    const dy = currentDxf.y - originDxf.y;
    const totalDist = Math.hypot(dx, dy);

    if (totalDist < 0.2) return;

    const curZoom = (this.camera && this.camera.zoom) ? this.camera.zoom : 1.0;
    const tick = Math.max(3, 6 / curZoom);

    // 1. Leader line from origin to current position with crosshairs
    const linePositions = [
      originDxf.x, originDxf.y, 0, currentDxf.x, currentDxf.y, 0,
      // Origin crosshair
      originDxf.x - tick, originDxf.y, 0, originDxf.x + tick, originDxf.y, 0,
      originDxf.x, originDxf.y - tick, 0, originDxf.x, originDxf.y + tick, 0,
      // Current crosshair
      currentDxf.x - tick, currentDxf.y, 0, currentDxf.x + tick, currentDxf.y, 0,
      currentDxf.x, currentDxf.y - tick, 0, currentDxf.x, currentDxf.y + tick, 0
    ];

    const dispGeo = new THREE.BufferGeometry();
    dispGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
    const dispMat = new THREE.LineSegments(dispGeo, new THREE.LineBasicMaterial({ color: 0x38bdf8, linewidth: 2 }));
    this.dragDimensionGroup.add(dispMat);

    // 2. Displacement Badge at midpoint
    const dispMidX = (originDxf.x + currentDxf.x) / 2;
    const dispMidY = (originDxf.y + currentDxf.y) / 2;
    const dispBadge = this.createDimensionBadge(
      `Δ ${totalDist.toFixed(2)} (dX: ${dx >= 0 ? '+' : ''}${dx.toFixed(1)}, dY: ${dy >= 0 ? '+' : ''}${dy.toFixed(1)})`,
      dispMidX,
      dispMidY + Math.max(10, 18 / curZoom),
      '#facc15',
      'rgba(15, 23, 42, 0.95)'
    );
    this.dragDimensionGroup.add(dispBadge);

    // 3. Connected Lines Real-time Length Badges
    if (connectedLines && connectedLines.length > 0) {
      connectedLines.forEach((cl) => {
        const line = cl.line || (typeof dxfEntities !== 'undefined' ? dxfEntities[cl.entityIndex] : null);
        if (!line) return;
        const curLen = Math.hypot(line.x1 - line.x0, line.y1 - line.y0);
        const midX = (line.x0 + line.x1) / 2;
        const midY = (line.y0 + line.y1) / 2;
        const delta = cl.initialLen !== undefined ? (curLen - cl.initialLen) : 0;
        const deltaStr = cl.initialLen !== undefined ? ` (Δ${delta >= 0 ? '+' : ''}${delta.toFixed(1)})` : '';
        const lineBadge = this.createDimensionBadge(
          `L: ${curLen.toFixed(1)}${deltaStr}`,
          midX,
          midY + Math.max(6, 12 / curZoom),
          '#38bdf8',
          'rgba(15, 23, 42, 0.9)'
        );
        this.dragDimensionGroup.add(lineBadge);
      });
    }

    this.dragDimensionGroup.visible = true;
  }

  hideDragDimensions() {
    if (!this.dragDimensionGroup) return;
    while (this.dragDimensionGroup.children.length > 0) {
      const obj = this.dragDimensionGroup.children[0];
      this.dragDimensionGroup.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (obj.material.map) obj.material.map.dispose();
        obj.material.dispose();
      }
    }
    this.dragDimensionGroup.visible = false;
  }

  showSnapIndicator(x, y, scale = 1) {
    if (!this.snapIndicator) return;
    const curZoom = (this.camera && this.camera.zoom) ? this.camera.zoom : 1.0;
    const worldR = Math.max(4, 7 / curZoom) * scale;
    this.snapIndicator.scale.set(worldR, worldR, 1);
    this.snapIndicator.position.set(x, y, 20);
    this.snapIndicator.visible = true;
  }

  hideSnapIndicator() {
    if (this.snapIndicator) this.snapIndicator.visible = false;
  }

  render() {
    if (!this.renderer || !this.scene || !this.camera) return;
    this.renderer.render(this.scene, this.camera);
  }
}

let threeCadEngine = null;

// DOM Elements
const btnOpenImport = document.getElementById('btn-open-import');
const btnOpenHistory = document.getElementById('btn-open-history');
const convertModal = document.getElementById('convert-modal');
const historyModal = document.getElementById('history-modal');
const subgraphsModal = document.getElementById('subgraphs-modal');
const btnCloseConvertModal = document.getElementById('btn-close-convert-modal');
const btnCloseHistoryModal = document.getElementById('btn-close-history-modal');
const btnOpenSubgraphs = document.getElementById('btn-open-subgraphs');
const btnCloseSubgraphsModal = document.getElementById('btn-close-subgraphs-modal');

const modalUploadZone = document.getElementById('modal-upload-zone');
const btnCancelConfig = document.getElementById('btn-cancel-config');
const configPanel = document.getElementById('config-panel');
const pdfPathText = document.getElementById('pdf-path-text');
const outputPathInput = document.getElementById('output-path-input');
const btnBrowseOutput = document.getElementById('btn-browse-output');
const btnConvert = document.getElementById('btn-convert');

const statusPanel = document.getElementById('status-panel');
const stateLoading = document.getElementById('state-loading');
const stateSuccess = document.getElementById('state-success');
const stateError = document.getElementById('state-error');
const errorMessage = document.getElementById('error-message');
const modalConfigState = document.getElementById('modal-config-state');

const btnOpenExplorer = document.getElementById('btn-open-explorer');
const btnErrorReset = document.getElementById('btn-error-reset');

// Custom Dialog System
function showCustomDialog(message, title = '提示', isConfirm = false) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('custom-dialog-overlay');
    const titleEl = document.getElementById('custom-dialog-title');
    const messageEl = document.getElementById('custom-dialog-message');
    const btnCancel = document.getElementById('btn-dialog-cancel');
    const btnConfirm = document.getElementById('btn-dialog-confirm');

    if (!overlay) {
      // Fallback if HTML not loaded correctly
      if (isConfirm) resolve(confirm(message));
      else { alert(message); resolve(true); }
      return;
    }

    titleEl.textContent = title;
    messageEl.textContent = message;

    if (isConfirm) {
      btnCancel.style.display = 'inline-flex';
    } else {
      btnCancel.style.display = 'none';
    }

    const cleanup = () => {
      overlay.classList.add('hidden');
      btnCancel.removeEventListener('click', onCancel);
      btnConfirm.removeEventListener('click', onConfirm);
    };

    const onCancel = () => {
      cleanup();
      resolve(false);
    };

    const onConfirm = () => {
      cleanup();
      resolve(true);
    };

    btnCancel.addEventListener('click', onCancel);
    btnConfirm.addEventListener('click', onConfirm);

    overlay.classList.remove('hidden');
  });
}

async function customAlert(message) {
  await showCustomDialog(message, '提示', false);
}

async function customConfirm(message) {
  return await showCustomDialog(message, '确认', true);
}

// App State
let selectedInputPath = '';
let selectedOutputPath = '';
let currentViewMode = 'split';   // 'split' or 'single'
let currentActiveTab = 'dxf';    // 'pdf' or 'dxf'
let currentPdfHash = '';         // Hash of current original PDF

// Helper to replace extension
function getDxfPath(pdfPath) {
  if (!pdfPath) return '';
  return pdfPath.replace(/\.pdf$/i, '.dxf');
}

// Helper to display file configuration inside modal
function displayFileConfig(filePath) {
  selectedInputPath = filePath;
  selectedOutputPath = getDxfPath(filePath);
  
  pdfPathText.textContent = filePath.split(/[\\/]/).pop(); // show only filename
  pdfPathText.title = filePath; // tooltip shows full path
  outputPathInput.value = selectedOutputPath;
  
  if (modalUploadZone) modalUploadZone.classList.add('hidden');
  configPanel.classList.remove('hidden');
  statusPanel.classList.add('hidden');
}

// Reset Modal UI state
function resetModalUI() {
  selectedInputPath = '';
  selectedOutputPath = '';
  
  if (modalUploadZone) modalUploadZone.classList.remove('hidden');
  configPanel.classList.add('hidden');
  statusPanel.classList.add('hidden');
  
  stateLoading.classList.add('hidden');
  stateSuccess.classList.add('hidden');
  stateError.classList.add('hidden');
  
  modalConfigState.classList.remove('hidden');
}

const placeholderView = document.getElementById('preview-placeholder');
const comparisonContainer = document.getElementById('comparison-container');

// Open / Close Modals
btnOpenImport.addEventListener('click', () => {
  resetModalUI();
  convertModal.classList.remove('hidden');
});

btnCloseConvertModal.addEventListener('click', () => {
  convertModal.classList.add('hidden');
});

btnOpenHistory.addEventListener('click', () => {
  loadHistory();
  historyModal.classList.remove('hidden');
});

btnCloseHistoryModal.addEventListener('click', () => {
  historyModal.classList.add('hidden');
});

if (btnOpenSubgraphs) {
  btnOpenSubgraphs.addEventListener('click', () => {
    loadSubgraphs();
    subgraphsModal.classList.remove('hidden');
  });
}

if (btnCloseSubgraphsModal) {
  btnCloseSubgraphsModal.addEventListener('click', () => {
    subgraphsModal.classList.add('hidden');
  });
}

// Click to upload using native file dialog
if (modalUploadZone) {
  modalUploadZone.addEventListener('click', async () => {
    const filePath = await window.api.selectInputPath();
    if (filePath) {
      displayFileConfig(filePath);
    }
  });
}

if (btnCancelConfig) {
  btnCancelConfig.addEventListener('click', resetModalUI);
}

// Browse Output Location
btnBrowseOutput.addEventListener('click', async () => {
  const resultPath = await window.api.selectOutputPath(selectedOutputPath);
  if (resultPath) {
    selectedOutputPath = resultPath;
    outputPathInput.value = selectedOutputPath;
  }
});

// Trigger Conversion
btnConvert.addEventListener('click', async () => {
  if (!selectedInputPath || !selectedOutputPath) return;
  
  // Transition to Loading
  modalConfigState.classList.add('hidden');
  statusPanel.classList.remove('hidden');
  stateLoading.classList.remove('hidden');
  stateSuccess.classList.add('hidden');
  stateError.classList.add('hidden');
  
  // Call Main process converter
  const response = await window.api.convertPdfToDxf(selectedInputPath, selectedOutputPath);
  
  stateLoading.classList.add('hidden');
  
  if (response && response.status === 'success') {
    // Show Success State
    stateSuccess.classList.remove('hidden');
    selectedOutputPath = response.saved_to; // update to exact saved path
    currentPdfHash = response.pdf_hash || ''; // Store the PDF hash
    
    // Load and render side-by-side comparison
    if (response.pdf_pages && response.pdf_pages.length > 0) {
      if (placeholderView) placeholderView.classList.add('hidden');
      if (comparisonContainer) comparisonContainer.classList.remove('hidden');
      loadAndRenderComparison(response.pdf_pages[0], response.saved_to);
    }
    
    // Auto-close modal after 1.5 seconds
    setTimeout(() => {
      convertModal.classList.add('hidden');
    }, 1500);

  } else {
    // Show Error State
    stateError.classList.remove('hidden');
    errorMessage.textContent = response ? response.message : 'Unknown conversion error.';
  }
});

// Open File Location
btnOpenExplorer.addEventListener('click', () => {
  if (selectedOutputPath) {
    window.api.openExplorer(selectedOutputPath);
  }
});

// Reset Listeners
btnErrorReset.addEventListener('click', resetModalUI);

// --- History database loader ---
const historyList = document.getElementById('history-list');
const btnClearHistory = document.getElementById('btn-clear-history');

async function loadHistory() {
  if (!historyList) return;
  try {
    const logs = await window.api.getHistory();
    historyList.innerHTML = '';
    
    if (!logs || logs.length === 0) {
      historyList.innerHTML = '<tr><td colspan="5"><div class="empty-history">暂无历史记录</div></td></tr>';
      return;
    }
    
    logs.forEach(log => {
      const timeStr = log.timestamp ? log.timestamp.substring(5, 16) : '未知';
      const pdfName = log.pdf_path ? log.pdf_path.split(/[\\/]/).pop() : '未知';
      const hasSubgraphs = log.subgraphs && log.subgraphs.length > 0;
      
      const tr = document.createElement('tr');
      tr.dataset.id = log.id;
      
      // --- 展开箭头 ---
      const expandTd = document.createElement('td');
      if (hasSubgraphs) {
        const expandBtn = document.createElement('button');
        expandBtn.className = 'expand-btn';
        expandBtn.innerHTML = '▶';
        expandBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const subRow = tr.nextElementSibling;
          if (subRow && subRow.classList.contains('subgraphs-row')) {
            subRow.style.display = subRow.style.display === 'none' ? '' : 'none';
            expandBtn.classList.toggle('expanded');
          }
        });
        expandTd.appendChild(expandBtn);
      }
      tr.appendChild(expandTd);
      
      // --- 文件名 ---
      const nameTd = document.createElement('td');
      nameTd.className = 'td-filename';
      nameTd.textContent = pdfName;
      nameTd.title = log.pdf_path;
      tr.appendChild(nameTd);
      
      // --- 状态 ---
      const statusTd = document.createElement('td');
      statusTd.className = 'td-status';
      if (log.status === 'success') {
        statusTd.innerHTML = '<span class="dot-badge dot-badge-success">已转换</span>';
      } else {
        statusTd.innerHTML = '<span class="dot-badge dot-badge-error">失败</span>';
      }
      tr.appendChild(statusTd);
      
      // --- 时间 ---
      const timeTd = document.createElement('td');
      timeTd.className = 'td-time';
      timeTd.textContent = timeStr;
      tr.appendChild(timeTd);
      
      // --- 操作 ---
      const actionsTd = document.createElement('td');
      actionsTd.className = 'td-actions';
      if (log.status === 'success') {
        actionsTd.innerHTML = `
          <button class="action-btn btn-open" title="打开文件" data-path="${log.dxf_path}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/></svg>
          </button>
          <button class="action-btn btn-locate" title="定位文件" data-path="${log.dxf_path}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          </button>
        `;
      }
      actionsTd.innerHTML += `
        <button class="action-btn btn-delete" title="删除记录" data-id="${log.id}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      `;
      tr.appendChild(actionsTd);
      
      // --- 主行点击：载入图纸 ---
      tr.addEventListener('click', (e) => {
        if (e.target.closest('.action-btn')) return;
        document.querySelectorAll('#history-list tr.active').forEach(r => r.classList.remove('active'));
        tr.classList.add('active');
        
        if (log.status === 'success') {
          const baseName = log.dxf_path.replace(/\.dxf$/i, '');
          const pageMeta = {
            path: `${baseName}_page_0.png`,
            width: 612,
            height: 792
          };
          currentPdfHash = log.pdf_hash || log.pdf_path || '';
          if (placeholderView) placeholderView.classList.add('hidden');
          if (comparisonContainer) comparisonContainer.classList.remove('hidden');
          loadAndRenderComparison(pageMeta, log.dxf_path);
          historyModal.classList.add('hidden');
        } else {
          customAlert('该文件转换失败，无法载入预览。');
        }
      });
      
      historyList.appendChild(tr);
      
      // --- 子图明细行 ---
      if (hasSubgraphs) {
        const subRow = document.createElement('tr');
        subRow.className = 'subgraphs-row';
        subRow.style.display = 'none';
        const subTd = document.createElement('td');
        subTd.colSpan = 5;
        
        const inner = document.createElement('div');
        inner.className = 'subgraphs-inner';
        
        log.subgraphs.forEach(sub => {
          const subTimeStr = sub.timestamp ? sub.timestamp.substring(5, 16) : '';
          const item = document.createElement('div');
          item.className = 'subgraph-item';
          item.innerHTML = `
            <span class="subgraph-name">${sub.name || '未命名图元'}</span>
            <span class="subgraph-time">${subTimeStr}</span>
          `;
          item.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.subgraph-item').forEach(s => s.classList.remove('active'));
            document.querySelectorAll('#history-list tr.active').forEach(r => r.classList.remove('active'));
            item.classList.add('active');
            tr.classList.add('active');
            
            if (log.status === 'success') {
              const baseName = log.dxf_path.replace(/\.dxf$/i, '');
              const pageMeta = {
                path: `${baseName}_page_0.png`,
                width: 612,
                height: 792
              };
              currentPdfHash = log.pdf_hash || log.pdf_path || '';
              if (placeholderView) placeholderView.classList.add('hidden');
              if (comparisonContainer) comparisonContainer.classList.remove('hidden');
              loadAndRenderComparison(pageMeta, sub.dxf_path);
              historyModal.classList.add('hidden');
            } else {
              customAlert('原文件转换失败，无法载入子图预览。');
            }
          });
          inner.appendChild(item);
        });
        
        subTd.appendChild(inner);
        subRow.appendChild(subTd);
        historyList.appendChild(subRow);
      }
    });
  } catch (error) {
    console.error('Failed to load conversion history:', error);
  }
}

async function loadSubgraphs() {
  const subgraphsList = document.getElementById('subgraphs-list');
  if (!subgraphsList) return;
  subgraphsList.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-muted);">正在加载已存子图...</div>';
  
  try {
    const data = await window.api.listSubgraphs();
    subgraphsList.innerHTML = '';
    
    if (!data || data.length === 0) {
      subgraphsList.innerHTML = '<div class="empty-history">暂无已存子图记录</div>';
      return;
    }
    
    data.forEach(sub => {
      const card = document.createElement('div');
      card.className = 'history-card-item';
      
      const timeStr = sub.timestamp ? sub.timestamp.substring(0, 16) : '未知时间';
      
      card.innerHTML = `
        <div class="history-card-row">
          <span class="history-card-title">${sub.name || '未命名子图'}</span>
          <span class="history-badge success">已保存</span>
        </div>
        <div class="history-card-row-bottom">
          <span class="history-card-time">${timeStr}</span>
          <button class="action-btn success-btn btn-export-dxf" style="background:var(--primary); color:white; border-color:var(--primary);">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            导出 DXF
          </button>
        </div>
      `;
      
      // Bind Export button
      const exportBtn = card.querySelector('.btn-export-dxf');
      exportBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        exportBtn.disabled = true;
        exportBtn.innerHTML = '导出中...';
        
        try {
          const res = await window.api.exportSubgraphToFile(sub.dxf_path);
          if (res.status === 'success') {
            showCustomDialog('提示', '导出成功！\n' + res.path);
          } else if (res.status === 'error') {
            showCustomDialog('错误', '导出失败：' + res.message);
          }
        } catch (err) {
          showCustomDialog('错误', '导出出错：' + err.message);
        } finally {
          exportBtn.disabled = false;
          exportBtn.innerHTML = `
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            导出 DXF
          `;
        }
      });
      
      subgraphsList.appendChild(card);
    });
  } catch (err) {
    subgraphsList.innerHTML = `<div class="empty-history" style="color:#ef4444;">加载失败: ${err.message}</div>`;
  }
}

// Bind action buttons using event delegation on historyList
if (historyList) {
  historyList.addEventListener('click', async (e) => {
    const btnOpen = e.target.closest('.btn-open');
    const btnLocate = e.target.closest('.btn-locate');
    const btnDelete = e.target.closest('.btn-delete');
    
    if (btnDelete) {
      e.stopPropagation();
      const id = btnDelete.dataset.id;
      if (await customConfirm("确定要删除这条记录吗？")) {
        const res = await window.api.deleteHistoryItem(id);
        if (res && res.status === 'success') {
          loadHistory();
        } else {
          customAlert("删除记录失败: " + (res ? res.message : "未知错误"));
        }
      }
      return;
    }
    
    if (btnOpen) {
      const filePath = btnOpen.dataset.path;
      const ok = await window.api.openFile(filePath);
      if (!ok) {
        customAlert("打开文件失败。请确保您的系统上已安装默认 CAD 查看软件。");
      }
    }
    
    if (btnLocate) {
      const filePath = btnLocate.dataset.path;
      window.api.openExplorer(filePath);
    }
  });
}

if (btnClearHistory) {
  btnClearHistory.addEventListener('click', async () => {
    if (await customConfirm("您确定要清空 SQLite 数据库中的所有转换历史记录吗？")) {
      const res = await window.api.clearHistory();
      if (res && res.status === 'success') {
        loadHistory();
      } else {
        customAlert("清空数据库日志失败: " + (res ? res.message : "未知错误"));
      }
    }
  });
}

// Initial history load on startup
document.addEventListener('DOMContentLoaded', loadHistory);
if (document.readyState === 'interactive' || document.readyState === 'complete') {
  loadHistory();
}

// --- DXF & PDF Synchronized Viewer Engine ---
let dxfEntities = [];
let dxfCenterX = 0;
let dxfCenterY = 0;

// Shared viewing transform
let zoom = 1.0;
let offsetX = 0;
let offsetY = 0;

let pdfImage = null;
let pdfPageWidth = 0;
let pdfPageHeight = 0;

const dxfCanvas = document.getElementById('dxf-canvas');
const pdfCanvas = document.getElementById('pdf-canvas');

if (dxfCanvas) {
  try {
    threeCadEngine = new ThreeCadEngine(dxfCanvas);
  } catch (e) {
    console.error("ThreeCadEngine init error:", e);
  }
}

function parseDxf(dxfText) {
  const lines = dxfText.split(/\r?\n/);
  const entities = [];
  let currentEntity = null;
  let groupCode = null;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (i % 2 === 0) {
      groupCode = parseInt(line, 10);
    } else {
      const value = line;
      if (groupCode === 0) {
        if (currentEntity) {
          entities.push(currentEntity);
        }
        if (['LINE', 'LWPOLYLINE', 'TEXT'].includes(value)) {
          currentEntity = { type: value, vertices: [] };
        } else {
          currentEntity = null;
        }
      } else if (currentEntity) {
        if (currentEntity.type === 'LINE') {
          if (groupCode === 10) currentEntity.x0 = parseFloat(value);
          else if (groupCode === 20) currentEntity.y0 = parseFloat(value);
          else if (groupCode === 11) currentEntity.x1 = parseFloat(value);
          else if (groupCode === 21) currentEntity.y1 = parseFloat(value);
          else if (groupCode === 8) currentEntity.layer = value;
        } else if (currentEntity.type === 'LWPOLYLINE') {
          if (groupCode === 10) {
            currentEntity.vertices.push({ x: parseFloat(value), y: 0 });
          } else if (groupCode === 20) {
            if (currentEntity.vertices.length > 0) {
              currentEntity.vertices[currentEntity.vertices.length - 1].y = parseFloat(value);
            }
          } else if (groupCode === 70) {
            currentEntity.closed = parseInt(value, 10) === 1;
          } else if (groupCode === 8) {
            currentEntity.layer = value;
          }
        } else if (currentEntity.type === 'TEXT') {
          if (groupCode === 10) currentEntity.x = parseFloat(value);
          else if (groupCode === 20) currentEntity.y = parseFloat(value);
          else if (groupCode === 40) currentEntity.height = parseFloat(value);
          else if (groupCode === 1) currentEntity.text = value;
          else if (groupCode === 8) currentEntity.layer = value;
        }
      }
    }
  }
  if (currentEntity) {
    entities.push(currentEntity);
  }

  // The converter emits some strokes multiple times; drop duplicate LINEs so
  // clustering and hit-testing don't see redundant overlapping segments.
  const seenLineKeys = new Set();
  const unique = entities.filter(ent => {
    if (ent.type !== 'LINE') return true;
    const q = v => Math.round(v * 100);
    let ax = q(ent.x0), ay = q(ent.y0), bx = q(ent.x1), by = q(ent.y1);
    if (ax > bx || (ax === bx && ay > by)) {
      const tx = ax, ty = ay; ax = bx; ay = by; bx = tx; by = ty;
    }
    const key = ax + ',' + ay + ',' + bx + ',' + by;
    if (seenLineKeys.has(key)) return false;
    seenLineKeys.add(key);
    return true;
  });

  // Pre-calculate cached metrics for high-speed rendering and hit testing
  unique.forEach(ent => {
    if (ent.type === 'TEXT') {
      ent.tw = (ent.text ? ent.text.length : 0) * (ent.height || 12) * 0.6;
      ent.th = (ent.height || 12) * 1.2;
    }
  });

  return unique;
}

function getBoundingBox(entities) {
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;
  let hasGeometry = false;

  entities.forEach(ent => {
    if (ent.type === 'LINE') {
      minX = Math.min(minX, ent.x0, ent.x1);
      maxX = Math.max(maxX, ent.x0, ent.x1);
      minY = Math.min(minY, ent.y0, ent.y1);
      maxY = Math.max(maxY, ent.y0, ent.y1);
      hasGeometry = true;
    } else if (ent.type === 'LWPOLYLINE') {
      ent.vertices.forEach(v => {
        minX = Math.min(minX, v.x);
        maxX = Math.max(maxX, v.x);
        minY = Math.min(minY, v.y);
        maxY = Math.max(maxY, v.y);
      });
      hasGeometry = true;
    } else if (ent.type === 'TEXT') {
      minX = Math.min(minX, ent.x);
      maxX = Math.max(maxX, ent.x);
      minY = Math.min(minY, ent.y);
      maxY = Math.max(maxY, ent.y);
      hasGeometry = true;
    } else if (ent.type === 'GROUP') {
      const gb = getEntityBounds(ent);
      minX = Math.min(minX, gb.minX);
      maxX = Math.max(maxX, gb.maxX);
      minY = Math.min(minY, gb.minY);
      maxY = Math.max(maxY, gb.maxY);
      hasGeometry = true;
    }
  });

  if (!hasGeometry) {
    return { minX: 0, maxX: 100, minY: 0, maxY: 100 };
  }
  return { minX, maxX, minY, maxY };
}

function getEntityBounds(ent) {
  if (ent.bounds) return ent.bounds;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  if (ent.type === 'LINE') {
    minX = Math.min(ent.x0, ent.x1); maxX = Math.max(ent.x0, ent.x1);
    minY = Math.min(ent.y0, ent.y1); maxY = Math.max(ent.y0, ent.y1);
  } else if (ent.type === 'LWPOLYLINE') {
    const verts = ent.vertices;
    for (let i = 0; i < verts.length; i++) {
      const v = verts[i];
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
    }
  } else if (ent.type === 'TEXT') {
    const tw = ent.tw || (ent.text ? ent.text.length * (ent.height || 12) * 0.6 : 0);
    const th = ent.th || ((ent.height || 12) * 1.2);
    minX = ent.x; maxX = ent.x + tw; minY = ent.y; maxY = ent.y + th;
  } else if (ent.type === 'GROUP') {
    const children = ent.children || [];
    for (let i = 0; i < children.length; i++) {
      const b = getEntityBounds(children[i]);
      if (b.minX < minX) minX = b.minX;
      if (b.maxX > maxX) maxX = b.maxX;
      if (b.minY < minY) minY = b.minY;
      if (b.maxY > maxY) maxY = b.maxY;
    }
  }
  const result = { minX, minY, maxX, maxY };
  ent.bounds = result;
  return result;
}

// ============================================================
//  空间哈希网格 — O(1) 均摊碰撞检测
// ============================================================
// 将 DXF 世界空间划分为固定大小的格子，每个实体注册到覆盖的格子。
// hitTest/hitTestNode 时只检查鼠标所在格子附近的实体，而非遍历全部。

let _spatialGrid = null; // global grid instance

class SpatialGrid {
  constructor(cellSize) {
    this.cellSize = cellSize;
    this.cells = new Map(); // key: "cx,cy" -> Set<entityIndex>
  }

  _key(cx, cy) { return cx * 100003 + cy; } // fast integer hash

  clear() { this.cells.clear(); }

  // Register entity index into all cells its bounding box overlaps
  insert(entityIndex, bounds) {
    const cs = this.cellSize;
    const x0 = Math.floor(bounds.minX / cs);
    const y0 = Math.floor(bounds.minY / cs);
    const x1 = Math.floor(bounds.maxX / cs);
    const y1 = Math.floor(bounds.maxY / cs);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const k = this._key(cx, cy);
        let set = this.cells.get(k);
        if (!set) { set = []; this.cells.set(k, set); }
        set.push(entityIndex);
      }
    }
  }

  // Remove entity from all cells (for updates during drag)
  remove(entityIndex, bounds) {
    const cs = this.cellSize;
    const x0 = Math.floor(bounds.minX / cs);
    const y0 = Math.floor(bounds.minY / cs);
    const x1 = Math.floor(bounds.maxX / cs);
    const y1 = Math.floor(bounds.maxY / cs);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const k = this._key(cx, cy);
        const arr = this.cells.get(k);
        if (arr) {
          const idx = arr.indexOf(entityIndex);
          if (idx >= 0) arr.splice(idx, 1);
        }
      }
    }
  }

  // Query: return all entity indices near point (x,y) with margin
  queryPoint(x, y, margin) {
    const cs = this.cellSize;
    const cx0 = Math.floor((x - margin) / cs);
    const cy0 = Math.floor((y - margin) / cs);
    const cx1 = Math.floor((x + margin) / cs);
    const cy1 = Math.floor((y + margin) / cs);
    const result = [];
    const seen = new Set();
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const arr = this.cells.get(this._key(cx, cy));
        if (arr) {
          for (let i = 0; i < arr.length; i++) {
            const idx = arr[i];
            if (!seen.has(idx)) { seen.add(idx); result.push(idx); }
          }
        }
      }
    }
    return result;
  }

  // Query: return all entity indices whose bounds overlap the given bounds + margin
  queryBounds(bounds, margin) {
    const cs = this.cellSize;
    const cx0 = Math.floor((bounds.minX - margin) / cs);
    const cy0 = Math.floor((bounds.minY - margin) / cs);
    const cx1 = Math.floor((bounds.maxX + margin) / cs);
    const cy1 = Math.floor((bounds.maxY + margin) / cs);
    const result = [];
    const seen = new Set();
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const arr = this.cells.get(this._key(cx, cy));
        if (arr) {
          for (let i = 0; i < arr.length; i++) {
            const idx = arr[i];
            if (!seen.has(idx)) { seen.add(idx); result.push(idx); }
          }
        }
      }
    }
    return result;
  }
}

let _layerPath2D = null;

function buildLayerPaths() {
  const paths = {
    'LINES': new Path2D(),
    'RECTS': new Path2D(),
    'POLYLINES': new Path2D(),
    'SYMBOLS': new Path2D()
  };

  function addEntToPath(ent) {
    const targetLayer = ent.layer || 'LINES';
    const p = paths[targetLayer] || paths['LINES'];

    if (ent.type === 'LINE') {
      p.moveTo(ent.x0, ent.y0);
      p.lineTo(ent.x1, ent.y1);
    } else if (ent.type === 'LWPOLYLINE' && ent.vertices && ent.vertices.length > 0) {
      const verts = ent.vertices;
      p.moveTo(verts[0].x, verts[0].y);
      for (let j = 1; j < verts.length; j++) {
        p.lineTo(verts[j].x, verts[j].y);
      }
      if (ent.closed) p.closePath();
    } else if (ent.type === 'GROUP' && ent.children) {
      for (let k = 0; k < ent.children.length; k++) {
        addEntToPath(ent.children[k]);
      }
    }
  }

  for (let i = 0; i < dxfEntities.length; i++) {
    addEntToPath(dxfEntities[i]);
  }

  _layerPath2D = paths;
}

// Build the spatial grid and Three.js GPU scene from current dxfEntities
function buildSpatialGrid() {
  const grid = new SpatialGrid(50);
  for (let i = 0; i < dxfEntities.length; i++) {
    const b = dxfEntities[i].bounds || (dxfEntities[i].bounds = getEntityBounds(dxfEntities[i]));
    grid.insert(i, b);
  }
  _spatialGrid = grid;
  if (threeCadEngine) {
    threeCadEngine.buildDxfScene(dxfEntities);
  }
}

// --- AUTO CLUSTERING ---
function autoClusterEntities(entities) {
  const LINE_EPS  = 3;   // endpoint-match tolerance (px)
  const CORE_MAX  = 40;  // max size for a "substation/plant symbol" core
  const CORE_DIST = 8;   // how close core curve fragments merge

  function bb(ent) { return getEntityBounds(ent); }
  function ptClose(x1, y1, x2, y2) { return Math.hypot(x1 - x2, y1 - y2) <= LINE_EPS; }
  function boxClose(b1, b2, d) {
    return !(b1.maxX + d < b2.minX || b2.maxX + d < b1.minX ||
             b1.maxY + d < b2.minY || b2.maxY + d < b1.minY);
  }
  function inside(cx, cy, b) { return cx >= b.minX && cx <= b.maxX && cy >= b.minY && cy <= b.maxY; }
  function boxDist(b1, b2) {
    const dx = Math.max(0, Math.max(b1.minX - b2.maxX, b2.minX - b1.maxX));
    const dy = Math.max(0, Math.max(b1.minY - b2.maxY, b2.minY - b1.maxY));
    return Math.hypot(dx, dy);
  }

  const grouped = new Set();
  const resultGroups = [];

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Phase 0 ─ Detect the Legend Box ("图例") and Group Each Legend Item
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  let legendBounds = null;
  let bestArea = Infinity;

  entities.forEach((ent) => {
    if (ent.type !== 'LWPOLYLINE') return;
    const b = bb(ent);
    const w = b.maxX - b.minX, h = b.maxY - b.minY;
    if (w < 40 || h < 30 || w > 900 || h > 700) return;
    const area = w * h;
    if (area >= bestArea) return;
    let txtCount = 0;
    entities.forEach(e => {
      if (e.type !== 'TEXT') return;
      const eb = bb(e);
      if (inside((eb.minX + eb.maxX) / 2, (eb.minY + eb.maxY) / 2, b)) txtCount++;
    });
    if (txtCount >= 2) { bestArea = area; legendBounds = b; }
  });

  if (legendBounds) {
    const lb = legendBounds;
    const legendTexts = [];
    const legendSymbols = [];

    entities.forEach((ent, i) => {
      const b = bb(ent);
      const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
      if (!inside(cx, cy, lb)) return;

      if (ent.type === 'LWPOLYLINE') {
        const w = b.maxX - b.minX, h = b.maxY - b.minY;
        const lw = lb.maxX - lb.minX, lh = lb.maxY - lb.minY;
        if (Math.abs(w - lw) < 2 && Math.abs(h - lh) < 2) return;
      }

      if (ent.type === 'TEXT') {
        if (ent.text && ent.text.trim() === '图例') {
          // ignore "图例" title
        } else {
          legendTexts.push({ idx: i, bounds: b, ent });
        }
      } else {
        legendSymbols.push({ idx: i, bounds: b, ent });
      }
    });

    legendTexts.forEach(t => {
      const tb = t.bounds;
      const tcy = (tb.minY + tb.maxY) / 2;
      const members = [t.idx];
      grouped.add(t.idx);

      legendSymbols.forEach(s => {
        if (grouped.has(s.idx)) return;
        const sb = s.bounds;
        const scy = (sb.minY + sb.maxY) / 2;
        const dy = Math.abs(scy - tcy);
        const dx = tb.minX - sb.maxX;
        if (dy <= 12 && dx >= -10 && dx <= 50) {
          members.push(s.idx);
          grouped.add(s.idx);
        }
      });

      if (members.length > 1) {
        resultGroups.push(members);
      }
    });
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Phase 1 ─ Core Symbols in Main Drawing (Substations & Power Plants)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const coreUnits = [];
  entities.forEach((ent, i) => {
    if (grouped.has(i)) return;
    if (ent.type !== 'LWPOLYLINE') return;
    const b = bb(ent);
    const w = b.maxX - b.minX, h = b.maxY - b.minY;
    if (w <= CORE_MAX && h <= CORE_MAX && w >= 1 && h >= 1) {
      coreUnits.push({ indices: [i], bounds: b });
    }
  });

  const shortLines = [];
  entities.forEach((ent, i) => {
    if (grouped.has(i)) return;
    if (ent.type === 'LINE' && Math.hypot(ent.x1 - ent.x0, ent.y1 - ent.y0) <= CORE_MAX) {
      shortLines.push(i);
    }
  });

  const adj = new Map();
  for (let a = 0; a < shortLines.length; a++) {
    const ia = shortLines[a], ea = entities[ia];
    for (let b = a + 1; b < shortLines.length; b++) {
      const ib = shortLines[b], eb = entities[ib];
      if (ptClose(ea.x0, ea.y0, eb.x0, eb.y0) || ptClose(ea.x0, ea.y0, eb.x1, eb.y1) ||
          ptClose(ea.x1, ea.y1, eb.x0, eb.y0) || ptClose(ea.x1, ea.y1, eb.x1, eb.y1)) {
        if (!adj.has(ia)) adj.set(ia, []);
        if (!adj.has(ib)) adj.set(ib, []);
        adj.get(ia).push(ib); adj.get(ib).push(ia);
      }
    }
  }

  const usedLine = new Set();
  for (const idx of shortLines) {
    if (usedLine.has(idx) || !adj.has(idx)) continue;
    const q = [idx], comp = [], vis = new Set([idx]);
    while (q.length) {
      const c = q.shift(); comp.push(c);
      (adj.get(c) || []).forEach(n => { if (!vis.has(n)) { vis.add(n); q.push(n); } });
    }
    // Count geometrically-unique strokes so near-duplicate segments
    // (sub-pixel jitter) cannot inflate the component past the cap.
    const uniqKeys = new Set();
    comp.forEach(ci => {
      const e = entities[ci];
      const q = v => Math.round(v);
      let ax = q(e.x0), ay = q(e.y0), bx = q(e.x1), by = q(e.y1);
      if (ax > bx || (ax === bx && ay > by)) {
        const tx = ax, ty = ay; ax = bx; ay = by; bx = tx; by = ty;
      }
      uniqKeys.add(ax + ',' + ay + ',' + bx + ',' + by);
    });
    if (uniqKeys.size >= 3 && uniqKeys.size <= 12) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      comp.forEach(ci => {
        const e = entities[ci];
        minX = Math.min(minX, e.x0, e.x1); maxX = Math.max(maxX, e.x0, e.x1);
        minY = Math.min(minY, e.y0, e.y1); maxY = Math.max(maxY, e.y0, e.y1);
      });
      if (maxX - minX <= CORE_MAX && maxY - minY <= CORE_MAX) {
        coreUnits.push({ indices: comp, bounds: { minX, minY, maxX, maxY } });
        comp.forEach(ci => usedLine.add(ci));
      }
    }
  }

  const visitedU = new Set();
  const symbolClusters = [];
  for (let i = 0; i < coreUnits.length; i++) {
    if (visitedU.has(i)) continue;
    const q = [i], cluster = [], vis = new Set([i]);
    while (q.length) {
      const cur = q.shift(); cluster.push(cur);
      for (let j = 0; j < coreUnits.length; j++) {
        if (!vis.has(j) && boxClose(coreUnits[cur].bounds, coreUnits[j].bounds, CORE_DIST)) {
          vis.add(j); q.push(j);
        }
      }
    }
    symbolClusters.push(cluster);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Phase 2 ─ Match Substation Names & Power Plant Names
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const ignoreTexts = new Set(['批准', '审核', '校核', '设计', '勘测', '比例', '日期', '图号', '服务承诺', '施工图设计阶段']);
  const nameTexts = [];
  entities.forEach((ent, i) => {
    if (grouped.has(i) || ent.type !== 'TEXT') return;
    const text = ent.text ? ent.text.trim() : '';
    if (!text || ignoreTexts.has(text)) return;
    const isSubstationName = /.+[变站厂]$/.test(text) || /(?:变电站|变|电厂|电站)/.test(text);
    const isLineSpec = /(?:km|\/|\*|芯|光缆|注：|阶段|公司|服务|电话|图|承诺|设计)/i.test(text);
    
    if (isSubstationName && !isLineSpec) {
      nameTexts.push({ idx: i, bounds: bb(ent), text, priority: 2 });
    } else if (!isLineSpec && text.length >= 2 && text.length <= 6 && /[\u4e00-\u9fa5]/.test(text)) {
      nameTexts.push({ idx: i, bounds: bb(ent), text, priority: 1 });
    }
  });

  const clusterList = symbolClusters.map(cluster => {
    const indices = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    cluster.forEach(ui => {
      const u = coreUnits[ui];
      indices.push(...u.indices);
      minX = Math.min(minX, u.bounds.minX); maxX = Math.max(maxX, u.bounds.maxX);
      minY = Math.min(minY, u.bounds.minY); maxY = Math.max(maxY, u.bounds.maxY);
    });
    return { indices, bounds: { minX, minY, maxX, maxY } };
  });

  nameTexts.forEach(nt => {
    if (grouped.has(nt.idx)) return;
    let closestCluster = null;
    let closestDist = 28;

    clusterList.forEach(cl => {
      const d = boxDist(nt.bounds, cl.bounds);
      if (d < closestDist) {
        closestDist = d;
        closestCluster = cl;
      }
    });

    if (closestCluster) {
      const members = [nt.idx, ...closestCluster.indices];
      members.forEach(i => grouped.add(i));
      resultGroups.push(members);
    }
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Phase 3 ─ Build Final Entity List
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const out = [];
  entities.forEach((ent, i) => {
    if (!grouped.has(i)) out.push(ent);
  });

  resultGroups.forEach(members => {
    if (members.length > 1) {
      out.push({
        type: 'GROUP',
        children: members.map(i => entities[i]),
        layer: 'SYMBOLS'
      });
    } else if (members.length === 1) {
      out.push(entities[members[0]]);
    }
  });

  out.forEach(ent => {
    ent.bounds = getEntityBounds(ent);
  });

  return out;
}

// --- ULTRA-FAST RENDERING & ZERO-LAYOUT-THRASHING ENGINE ---

let dxfRect = { width: 800, height: 600, left: 0, top: 0 };
let pdfRect = { width: 800, height: 600, left: 0, top: 0 };

// Cached 2D contexts — avoid repeated getContext() lookups
let dxfCtx = null;
let pdfCtx = null;
function getDxfCtx() { return dxfCtx || (dxfCtx = dxfCanvas ? dxfCanvas.getContext('2d') : null); }
function getPdfCtx() { return pdfCtx || (pdfCtx = pdfCanvas ? pdfCanvas.getContext('2d') : null); }

// Track whether PDF needs redraw (reserved for future use)

function updateCanvasSizes() {
  const dpr = window.devicePixelRatio || 1;
  if (dxfCanvas) {
    const r = dxfCanvas.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      dxfRect = { width: r.width, height: r.height, left: r.left, top: r.top };
      if (threeCadEngine) {
        threeCadEngine.resize(r.width, r.height);
      }
    }
  }
  if (pdfCanvas) {
    const r = pdfCanvas.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      pdfRect = { width: r.width, height: r.height, left: r.left, top: r.top };
      const tw = Math.round(r.width * dpr);
      const th = Math.round(r.height * dpr);
      if (pdfCanvas.width !== tw || pdfCanvas.height !== th) {
        pdfCanvas.width = tw;
        pdfCanvas.height = th;
      }
    }
  }
}

let isDrawScheduled = false;

// Global draw call that renders BOTH canvases in sync with single RAF coalescing
function drawViewports() {
  if (isDrawScheduled) return;
  isDrawScheduled = true;
  requestAnimationFrame(() => {
    isDrawScheduled = false;
    updateZoomSlider();
    const isSingle = typeof currentViewMode !== 'undefined' && currentViewMode === 'single';
    if (!isSingle || (typeof currentActiveTab !== 'undefined' && currentActiveTab === 'dxf')) {
      renderDxfCanvas();
    }
    if (!isSingle || (typeof currentActiveTab !== 'undefined' && currentActiveTab === 'pdf')) {
      renderPdfCanvas();
    }
  });
}

function renderDxfCanvas() {
  if (!threeCadEngine || !dxfCanvas || dxfEntities.length === 0) return;
  const viewW = dxfRect.width;
  const viewH = dxfRect.height;
  if (viewW <= 0 || viewH <= 0) return;

  threeCadEngine.updateCamera(viewW, viewH, zoom, offsetX, offsetY, dxfCenterX, dxfCenterY);

  // Update dynamic hover highlight
  if (typeof hoveredEntityIndex !== 'undefined' && hoveredEntityIndex >= 0 && hoveredEntityIndex < dxfEntities.length) {
    threeCadEngine.updateHoverHighlight(dxfEntities[hoveredEntityIndex]);
  } else {
    threeCadEngine.updateHoverHighlight(null);
  }

  // Update dynamic selection highlight & grips
  if (typeof selectedEntityIndex !== 'undefined' && selectedEntityIndex >= 0 && selectedEntityIndex < dxfEntities.length) {
    threeCadEngine.updateSelectionHighlight(dxfEntities[selectedEntityIndex], hoveredNode || (isMovingNode ? hoveredNode : null));
  } else {
    threeCadEngine.updateSelectionHighlight(null, hoveredNode || (isMovingNode ? hoveredNode : null));
  }

  // Update rubberband drawing preview
  if (isDrawing) {
    threeCadEngine.updateDrawingPreview(currentTool, drawStartDxf, drawPreviewEnd);
  } else {
    threeCadEngine.hideDrawingPreview();
  }

  threeCadEngine.render();
}

let _staticLayerBatches = null;
let _staticTextBatch = null;

// --- DRAG CACHE SYSTEM ---
// Renders all static entities to an offscreen canvas once when drag starts.
// During drag, only the moving entity is redrawn each frame.

let _dragCacheCanvas = null;
let _dragCacheActive = false;
let _dragCacheMovingIndices = null; // indices of connected lines being dragged




function _drawSingleEntity(ctx, ent, color) {
  if (ent.type === 'LINE') {
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(ent.x0, ent.y0);
    ctx.lineTo(ent.x1, ent.y1);
    ctx.stroke();
  } else if (ent.type === 'LWPOLYLINE' && ent.vertices && ent.vertices.length > 0) {
    ctx.strokeStyle = color;
    ctx.beginPath();
    const verts = ent.vertices;
    ctx.moveTo(verts[0].x, verts[0].y);
    for (let j = 1; j < verts.length; j++) {
      ctx.lineTo(verts[j].x, verts[j].y);
    }
    if (ent.closed) ctx.closePath();
    ctx.stroke();
  } else if (ent.type === 'TEXT') {
    const h = ent.height || 12;
    ctx.font = `${h}px 'Outfit', sans-serif`;
    ctx.fillStyle = color;
    ctx.save();
    ctx.translate(ent.x, ent.y);
    ctx.scale(1, -1);
    ctx.fillText(ent.text, 0, 0);
    ctx.restore();
  } else if (ent.type === 'GROUP' && ent.children) {
    for (let k = 0; k < ent.children.length; k++) {
      _drawSingleEntity(ctx, ent.children[k], color);
    }
  }
}

function _buildDragCache(skipIndex, connectedLineIndices) {
  const canvasW = dxfCanvas.width;
  const canvasH = dxfCanvas.height;
  if (canvasW <= 0 || canvasH <= 0) return;

  // Build set of indices to skip (moving entities)
  const skipSet = new Set();
  skipSet.add(skipIndex);
  if (connectedLineIndices) {
    for (let i = 0; i < connectedLineIndices.length; i++) {
      skipSet.add(connectedLineIndices[i].entityIndex);
    }
  }

  // Create or resize offscreen canvas
  if (!_dragCacheCanvas) {
    _dragCacheCanvas = document.createElement('canvas');
  }
  _dragCacheCanvas.width = canvasW;
  _dragCacheCanvas.height = canvasH;
  const offCtx = _dragCacheCanvas.getContext('2d');

  const dpr = window.devicePixelRatio || 1;
  const viewW = dxfRect.width;
  const viewH = dxfRect.height;

  // Clear with background
  offCtx.fillStyle = '#05080f';
  offCtx.fillRect(0, 0, canvasW, canvasH);

  offCtx.save();
  offCtx.scale(dpr, dpr);
  offCtx.translate(offsetX, offsetY);
  offCtx.scale(zoom, zoom);
  offCtx.translate(viewW / 2, viewH / 2);
  offCtx.scale(1, -1);
  offCtx.translate(-dxfCenterX, -dxfCenterY);

  // Viewport culling
  const margin = 80 / zoom;
  const x1 = (0 - offsetX) / zoom - viewW / 2 + dxfCenterX;
  const x2 = (viewW - offsetX) / zoom - viewW / 2 + dxfCenterX;
  const y1v = -((viewH - offsetY) / zoom - viewH / 2) + dxfCenterY;
  const y2v = -((0 - offsetY) / zoom - viewH / 2) + dxfCenterY;
  const vMinX = Math.min(x1, x2) - margin;
  const vMaxX = Math.max(x1, x2) + margin;
  const vMinY = Math.min(y1v, y2v) - margin;
  const vMaxY = Math.max(y1v, y2v) + margin;

  // Batch all static entities
  const strokeBatches = new Map();
  const textBatch = [];

  function getBatch(color) {
    let b = strokeBatches.get(color);
    if (!b) { b = { lines: [], polylines: [] }; strokeBatches.set(color, b); }
    return b;
  }

  function collectStatic(ent, color) {
    const b = ent.bounds || (ent.bounds = getEntityBounds(ent));
    if (b.maxX < vMinX || b.minX > vMaxX || b.maxY < vMinY || b.minY > vMaxY) return;
    if (ent.type === 'LINE') { getBatch(color).lines.push(ent); }
    else if (ent.type === 'LWPOLYLINE' && ent.vertices && ent.vertices.length > 0) { getBatch(color).polylines.push(ent); }
    else if (ent.type === 'TEXT') { textBatch.push({ ent, color }); }
    else if (ent.type === 'GROUP' && ent.children) {
      for (let k = 0; k < ent.children.length; k++) collectStatic(ent.children[k], color);
    }
  }

  for (let i = 0; i < dxfEntities.length; i++) {
    if (skipSet.has(i)) continue; // Skip moving entities
    const ent = dxfEntities[i];
    const color = layerColorMap[ent.layer] || '#ffffff';
    collectStatic(ent, color);
  }

  offCtx.lineWidth = 1.2 / zoom;
  for (const [color, batch] of strokeBatches) {
    offCtx.strokeStyle = color;
    offCtx.beginPath();
    for (let k = 0; k < batch.lines.length; k++) {
      const l = batch.lines[k];
      offCtx.moveTo(l.x0, l.y0);
      offCtx.lineTo(l.x1, l.y1);
    }
    for (let k = 0; k < batch.polylines.length; k++) {
      const poly = batch.polylines[k];
      const verts = poly.vertices;
      offCtx.moveTo(verts[0].x, verts[0].y);
      for (let j = 1; j < verts.length; j++) offCtx.lineTo(verts[j].x, verts[j].y);
      if (poly.closed) offCtx.closePath();
    }
    offCtx.stroke();
  }

  offCtx.textBaseline = 'alphabetic';
  for (let k = 0; k < textBatch.length; k++) {
    const item = textBatch[k];
    const t = item.ent;
    offCtx.font = `${t.height || 12}px 'Outfit', sans-serif`;
    offCtx.fillStyle = item.color;
    offCtx.save();
    offCtx.translate(t.x, t.y);
    offCtx.scale(1, -1);
    offCtx.fillText(t.text, 0, 0);
    offCtx.restore();
  }

  offCtx.restore();

  _dragCacheMovingIndices = connectedLineIndices ? connectedLineIndices.map(cl => cl.entityIndex) : [];
  _dragCacheActive = true;
}

function _invalidateDragCache() {
  _dragCacheActive = false;
}

function renderPdfCanvas() {
  if (!pdfCanvas || !pdfImage) return;
  const viewW = pdfRect.width;
  const viewH = pdfRect.height;
  if (viewW <= 0 || viewH <= 0) return;

  const dpr = window.devicePixelRatio || 1;
  const ctx = getPdfCtx();
  if (!ctx) return;

  ctx.fillStyle = '#05080f';
  ctx.fillRect(0, 0, pdfCanvas.width, pdfCanvas.height);

  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.translate(offsetX + viewW / 2, offsetY + viewH / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-dxfCenterX, -(pdfPageHeight - dxfCenterY));

  ctx.drawImage(pdfImage, 0, 0, pdfPageWidth, pdfPageHeight);
  ctx.restore();
}

async function loadAndRenderComparison(pdfPageData, dxfFilePath) {
  try {
    if (placeholderView) placeholderView.classList.add('hidden');
    if (comparisonContainer) comparisonContainer.classList.remove('hidden');

    // 1. Load and parse DXF
    const dxfText = await window.api.readTextFile(dxfFilePath);
    if (!dxfText) return;
    const parsedEntities = parseDxf(dxfText);
    dxfEntities = autoClusterEntities(parsedEntities);
    buildSpatialGrid();

    // Calculate DXF bounding box and center
    const bounds = getBoundingBox(dxfEntities);
    dxfCenterX = (bounds.minX + bounds.maxX) / 2;
    dxfCenterY = (bounds.minY + bounds.maxY) / 2;

    // 2. Load PDF page image as base64 Data URL
    const pdfPageBase64 = await window.api.readImageBase64(pdfPageData.path);
    if (!pdfPageBase64) return;

    pdfPageWidth = pdfPageData.width;
    pdfPageHeight = pdfPageData.height;

    pdfImage = new Image();
    pdfImage.src = pdfPageBase64;
    pdfImage.onload = () => {
      updateViewModeUI();
      updateCanvasSizes();

      // 激活编辑器（DXF 加载完成后）
      if (typeof activateEditor === 'function') {
        activateEditor(dxfFilePath);
      }

      // 等待 DOM 渲染后获取准确宽高并自适应居中
      setTimeout(() => {
        updateCanvasSizes();
        if (typeof fitViewport === 'function') {
          fitViewport();
        }
      }, 50);
    };
  } catch (error) {
    console.error("Error loading side-by-side comparison view:", error);
  }
}

// --- DIRECT HIGH-PERFORMANCE WHEEL & PAN ENGINE ---

function handleWheelZoom(e) {
  e.preventDefault();
  const canvas = e.currentTarget || dxfCanvas || pdfCanvas;
  if (!canvas) return;

  const r = (canvas.getBoundingClientRect) ? canvas.getBoundingClientRect() : ((canvas === pdfCanvas) ? pdfRect : dxfRect);
  if (r.width <= 0 || r.height <= 0) return;

  // Exact live mouse position relative to this canvas
  const mouseX = e.clientX - r.left;
  const mouseY = e.clientY - r.top;
  const viewW = r.width;
  const viewH = r.height;

  // 1. Exact DXF world coordinate under cursor before zoom
  const worldX = (mouseX - offsetX - viewW / 2) / zoom + dxfCenterX;
  const worldY = -((mouseY - offsetY - viewH / 2) / zoom) + dxfCenterY;

  // 2. Smooth zoom factor
  let factor = 1.0;
  if (Math.abs(e.deltaY) > 50) {
    factor = e.deltaY < 0 ? 1.18 : (1 / 1.18);
  } else {
    factor = Math.pow(1.002, -e.deltaY);
  }

  const newZoom = Math.max(0.01, Math.min(1000, zoom * factor));
  if (newZoom === zoom) return;

  zoom = newZoom;

  // 3. Mathematical pivot: cursor remains pinned to world point
  offsetX = mouseX - (worldX - dxfCenterX) * zoom - viewW / 2;
  offsetY = mouseY + (worldY - dxfCenterY) * zoom - viewH / 2;

  drawViewports();
}

window.triggerZoomAnimation = (targetZ, screenX, screenY) => {
  const canvas = dxfCanvas || pdfCanvas;
  const r = (canvas && canvas.getBoundingClientRect) ? canvas.getBoundingClientRect() : dxfRect;
  const viewW = r.width || 800;
  const viewH = r.height || 600;
  const sx = screenX !== undefined ? screenX : viewW / 2;
  const sy = screenY !== undefined ? screenY : viewH / 2;
  const worldX = (sx - offsetX - viewW / 2) / zoom + dxfCenterX;
  const worldY = -((sy - offsetY - viewH / 2) / zoom) + dxfCenterY;

  zoom = Math.max(0.01, Math.min(1000, targetZ));
  offsetX = sx - (worldX - dxfCenterX) * zoom - viewW / 2;
  offsetY = sy + (worldY - dxfCenterY) * zoom - viewH / 2;

  updateZoomSlider();
  drawViewports();
};

window.cancelZoomAnimation = () => {};
window.getTargetZoom = () => zoom;

// Viewport pan interaction
let isPanning = false;
let panStartX = 0;
let panStartY = 0;
let panStartOffsetX = 0;
let panStartOffsetY = 0;

[pdfCanvas, dxfCanvas].forEach(canvas => {
  if (!canvas) return;

  canvas.addEventListener('wheel', handleWheelZoom, { passive: false });

  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    isPanning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panStartOffsetX = offsetX;
    panStartOffsetY = offsetY;
  });
});

window.addEventListener('mousemove', (e) => {
  if (isPanning) {
    const dx = e.clientX - panStartX;
    const dy = e.clientY - panStartY;
    offsetX = panStartOffsetX + dx;
    offsetY = panStartOffsetY + dy;
    drawViewports();
  }
});

window.addEventListener('mouseup', () => {
  isPanning = false;
});

// Resize handler to redraw both viewports
window.addEventListener('resize', () => {
  updateCanvasSizes();
  if (dxfEntities.length > 0) {
    drawViewports();
  }
});

// --- 缩放与视图控制 (Zoom & Fit Viewport Controls) ---
const zoomSlider = document.getElementById('zoom-slider');
const btnZoomIn = document.getElementById('btn-zoom-in');
const btnZoomOut = document.getElementById('btn-zoom-out');
const btnFitViewport = document.getElementById('btn-fit-viewport');

function updateZoomSlider() {
  if (zoomSlider) {
    const val = Math.round(zoom * 100);
    if (zoomSlider.value !== String(val)) {
      zoomSlider.value = val;
    }
  }
}

if (zoomSlider) {
  zoomSlider.addEventListener('input', () => {
    const val = parseFloat(zoomSlider.value);
    const newZoom = Math.max(0.01, Math.min(1000, val / 100));

    const canvas = dxfCanvas || pdfCanvas;
    const r = (canvas && canvas.getBoundingClientRect) ? canvas.getBoundingClientRect() : dxfRect;
    const viewW = r.width || 800;
    const viewH = r.height || 600;
    const sx = viewW / 2;
    const sy = viewH / 2;
    const worldX = (sx - offsetX - viewW / 2) / zoom + dxfCenterX;
    const worldY = -((sy - offsetY - viewH / 2) / zoom) + dxfCenterY;

    zoom = newZoom;
    offsetX = sx - (worldX - dxfCenterX) * zoom - viewW / 2;
    offsetY = sy + (worldY - dxfCenterY) * zoom - viewH / 2;

    drawViewports();
  });
}

if (btnZoomIn) {
  btnZoomIn.addEventListener('click', () => {
    const canvas = dxfCanvas || pdfCanvas;
    const r = (canvas && canvas.getBoundingClientRect) ? canvas.getBoundingClientRect() : dxfRect;
    const viewW = r.width || 800;
    const viewH = r.height || 600;
    const sx = viewW / 2;
    const sy = viewH / 2;
    const worldX = (sx - offsetX - viewW / 2) / zoom + dxfCenterX;
    const worldY = -((sy - offsetY - viewH / 2) / zoom) + dxfCenterY;

    zoom = Math.min(1000, zoom * 1.25);
    offsetX = sx - (worldX - dxfCenterX) * zoom - viewW / 2;
    offsetY = sy + (worldY - dxfCenterY) * zoom - viewH / 2;
    updateZoomSlider();
    drawViewports();
  });
}

if (btnZoomOut) {
  btnZoomOut.addEventListener('click', () => {
    const canvas = dxfCanvas || pdfCanvas;
    const r = (canvas && canvas.getBoundingClientRect) ? canvas.getBoundingClientRect() : dxfRect;
    const viewW = r.width || 800;
    const viewH = r.height || 600;
    const sx = viewW / 2;
    const sy = viewH / 2;
    const worldX = (sx - offsetX - viewW / 2) / zoom + dxfCenterX;
    const worldY = -((sy - offsetY - viewH / 2) / zoom) + dxfCenterY;

    zoom = Math.max(0.01, zoom / 1.25);
    offsetX = sx - (worldX - dxfCenterX) * zoom - viewW / 2;
    offsetY = sy + (worldY - dxfCenterY) * zoom - viewH / 2;
    updateZoomSlider();
    drawViewports();
  });
}

function fitViewport() {
  if (dxfEntities.length === 0) return;
  updateCanvasSizes();
  const bounds = getBoundingBox(dxfEntities);
  const dxfW = bounds.maxX - bounds.minX;
  const dxfH = bounds.maxY - bounds.minY;

  const rect = dxfRect;
  const padding = 40;
  const scaleX = (rect.width - padding) / (dxfW || 1);
  const scaleY = (rect.height - padding) / (dxfH || 1);

  zoom = Math.min(scaleX, scaleY);
  if (zoom <= 0 || zoom === Infinity) zoom = 1.0;

  offsetX = 0;
  offsetY = 0;

  updateZoomSlider();
  drawViewports();
}

if (btnFitViewport) {
  btnFitViewport.addEventListener('click', fitViewport);
}

// --- 查看模式切换 (Single vs Compare Display Modes) ---
const btnModeSingle = document.getElementById('btn-mode-single');
const btnModeCompare = document.getElementById('btn-mode-compare');
const btnTabPdf = document.getElementById('btn-tab-pdf');
const btnTabDxf = document.getElementById('btn-tab-dxf');
const singleTabsGroup = document.getElementById('single-tabs-group');

const pdfPanel = document.querySelector('.comparison-container .preview-panel:first-child');
const dxfPanel = document.querySelector('.comparison-container .preview-panel:last-child');

function updateViewModeUI() {
  if (!comparisonContainer) return;
  
  if (currentViewMode === 'compare') {
    comparisonContainer.classList.remove('mode-single');
    comparisonContainer.classList.add('mode-compare');
    if (singleTabsGroup) singleTabsGroup.classList.add('hidden');
    
    if (pdfPanel) pdfPanel.classList.remove('hidden-tab');
    if (dxfPanel) dxfPanel.classList.remove('hidden-tab');
    
    if (btnModeCompare) btnModeCompare.classList.add('active');
    if (btnModeSingle) btnModeSingle.classList.remove('active');
  } else {
    comparisonContainer.classList.remove('mode-compare');
    comparisonContainer.classList.add('mode-single');
    if (singleTabsGroup) singleTabsGroup.classList.remove('hidden');
    
    if (btnModeCompare) btnModeCompare.classList.remove('active');
    if (btnModeSingle) btnModeSingle.classList.add('active');
    
    if (currentActiveTab === 'pdf') {
      if (pdfPanel) pdfPanel.classList.remove('hidden-tab');
      if (dxfPanel) dxfPanel.classList.add('hidden-tab');
      
      if (btnTabPdf) btnTabPdf.classList.add('active');
      if (btnTabDxf) btnTabDxf.classList.remove('active');
    } else {
      if (pdfPanel) pdfPanel.classList.add('hidden-tab');
      if (dxfPanel) dxfPanel.classList.remove('hidden-tab');
      
      if (btnTabPdf) btnTabPdf.classList.remove('active');
      if (btnTabDxf) btnTabDxf.classList.add('active');
    }
  }
  
  // Redraw canvases inside animation frame to capture updated client rect sizes
  requestAnimationFrame(() => {
    updateCanvasSizes();
    drawViewports();
  });
}

if (btnModeSingle) {
  btnModeSingle.addEventListener('click', () => {
    currentViewMode = 'single';
    updateViewModeUI();
  });
}

if (btnModeCompare) {
  btnModeCompare.addEventListener('click', () => {
    currentViewMode = 'compare';
    updateViewModeUI();
  });
}

if (btnTabPdf) {
  btnTabPdf.addEventListener('click', () => {
    currentActiveTab = 'pdf';
    updateViewModeUI();
  });
}

if (btnTabDxf) {
  btnTabDxf.addEventListener('click', () => {
    currentActiveTab = 'dxf';
    updateViewModeUI();
  });
}

// ============================================================
//  CAD 二次编辑器模块
// ============================================================

// --- 编辑器状态 ---
let currentTool = 'select';      // 'select' | 'line' | 'rect' | 'text'
let selectedEntityIndex = -1;    // 当前选中图元在 dxfEntities 中的索引
let hoveredEntityIndex = -1;     // 当前鼠标悬停的图元索引
let hoveredNode = null;          // 当前鼠标悬停的节点对象
let isDirty = false;             // 是否有未保存的修改
let currentDxfPath = '';         // 当前加载的 DXF 文件路径

// 多选与框选状态
let selectedEntities = new Set(); // 多选节点索引集合
let isBoxSelecting = false;
let boxSelectStartScreen = { x: 0, y: 0 };
let boxSelectCurrentScreen = { x: 0, y: 0 };

// 拖拽移动状态
let isMovingEntity = false;
let isMovingNode = false;           // 是否正在拖拽节点
let draggedNodes = [];              // 受到联动拖拽的节点集合
let moveStartDxf = { x: 0, y: 0 };  // 拖拽开始时的 DXF 坐标

// 绘制新图元状态
let isDrawing = false;
let drawStartDxf = { x: 0, y: 0 };  // 绘制起点 DXF 坐标
let drawPreviewEnd = { x: 0, y: 0 }; // 绘制预览终点
let hoverRafPending = false;        // RAF 悬停检测防抖锁

// Undo 历史栈（最多 50 步）
const undoStack = [];
const MAX_UNDO = 50;

// --- DOM 引用 ---
const editorToolbar   = document.getElementById('editor-toolbar');
const btnExportEdited = document.getElementById('btn-export-edited');
const btnExportSubgraph = document.getElementById('btn-export-subgraph');
const propPanel       = document.getElementById('prop-panel');
const propPanelTitle  = document.getElementById('prop-panel-title');
const propBody        = document.getElementById('prop-body');
const btnPropClose    = document.getElementById('btn-prop-close');
const inlineTextEditor = document.getElementById('inline-text-editor');
const editorStatusTip  = document.getElementById('editor-status-tip');

// --- 右键上下文菜单 DOM 引用 ---
const contextMenu       = document.getElementById('context-menu');
const ctxHeaderIcon     = document.getElementById('ctx-header-icon');
const ctxHeaderName     = document.getElementById('ctx-header-name');
const ctxBtnEditProp    = document.getElementById('ctx-btn-edit-prop');
const ctxBtnRename      = document.getElementById('ctx-btn-rename');
const ctxBtnDrawLine    = document.getElementById('ctx-btn-draw-line');
const ctxTypeWrapper    = document.getElementById('ctx-type-wrapper');
const ctxBtnDelete      = document.getElementById('ctx-btn-delete');

let contextMenuTargetIndex = -1;

const toolBtns = {
  select: document.getElementById('tool-select'),
  node:   document.getElementById('tool-node'),
  line:   document.getElementById('tool-line'),
  rect:   document.getElementById('tool-rect'),
  text:   document.getElementById('tool-text'),
  delete: document.getElementById('tool-delete'),
  undo:   document.getElementById('tool-undo'),
};

// --- 激活编辑器（DXF 加载成功后调用）---
function activateEditor(dxfFilePath) {
  currentDxfPath = dxfFilePath;
  isDirty = false;
  selectedEntityIndex = -1;
  selectedEntities.clear();
  hoveredEntityIndex = -1;
  hoveredNode = null;
  undoStack.length = 0;
  isDrawing = false;

  if (editorToolbar)   editorToolbar.classList.remove('hidden');
  if (btnExportEdited) btnExportEdited.classList.remove('hidden');
  updateExportButtonVisibility();
  if (propPanel)       propPanel.classList.add('hidden');
  if (editorStatusTip) editorStatusTip.textContent = '点击图元选中 · Del 删除 · 工具栏绘制新图元';
  setActiveTool('select');
}

function updateExportButtonVisibility() {
  if (btnExportSubgraph) {
    if (selectedEntities.size > 0 || selectedEntityIndex >= 0) {
      btnExportSubgraph.classList.remove('hidden');
    } else {
      btnExportSubgraph.classList.add('hidden');
    }
  }
}

// --- 导出编辑后的 DXF (预览弹窗) ---
let previewCadEngine = null;

if (btnExportSubgraph) {
  btnExportSubgraph.addEventListener('click', () => {
    const exportModal = document.getElementById('export-preview-modal');
    if (!exportModal) return;
    
    // 提取需要导出的图元
    const entitiesToExport = [];
    const indexSet = new Set(selectedEntities);
    if (selectedEntityIndex >= 0) indexSet.add(selectedEntityIndex);
    
    if (indexSet.size === 0) return;
    
    for (const idx of indexSet) {
      entitiesToExport.push(dxfEntities[idx]);
    }
    
    // 将连线和附近的描述文本也一起导出
    const additionalLines = new Set();
    const additionalTexts = new Set();
    for (const idx of indexSet) {
      // 1. 获取关联的连线
      const cls = getConnectedExternalLines(idx);
      for (const cl of cls) {
        additionalLines.add(cl.entityIndex);
      }
      
      // 2. 自动捕获该图元周边（特别是下方）的 TEXT 描述
      const ent = dxfEntities[idx];
      let bx = null, by = null, bw = 0, bh = 0;
      if (ent && ent.bounds) {
        bx = ent.bounds.minX;
        by = ent.bounds.minY;
        bw = ent.bounds.maxX - ent.bounds.minX;
        bh = ent.bounds.maxY - ent.bounds.minY;
      } else if (ent && typeof ent.x === 'number' && typeof ent.y === 'number') {
        bx = ent.x; by = ent.y; bw = 0; bh = 0;
      }
      
      if (bx !== null) {
        // 向下适度扩展搜索区域来包容紧贴的文本标签 (避免过大导致吸附无关图元)
        const searchBounds = {
          minX: bx - 20,
          maxX: bx + bw + 20,
          minY: by - 30,
          maxY: by + bh + 20
        };
        const hits = _spatialGrid.queryBounds(searchBounds, 0);
        for (const hit of hits) {
          const hitEnt = dxfEntities[hit];
          if (!hitEnt || hitEnt.type !== 'TEXT') continue;
          // 文本包围盒与搜索区相交即视为该节点的描述（规格文字常横跨节点边缘书写）
          const tb = hitEnt.bounds || getEntityBounds(hitEnt);
          if (tb.maxX >= searchBounds.minX && tb.minX <= searchBounds.maxX &&
              tb.maxY >= searchBounds.minY && tb.minY <= searchBounds.maxY) {
            additionalTexts.add(hit);
          }
        }
      }
    }

    // 2.5 捕获导出连线旁的描述文本（光缆规格等紧贴线段书写的标注）
    const lineTextSources = new Set(additionalLines);
    for (const idx of indexSet) {
      if (dxfEntities[idx] && dxfEntities[idx].type === 'LINE') lineTextSources.add(idx);
    }
    for (const lineIdx of lineTextSources) {
      const le = dxfEntities[lineIdx];
      if (!le || le.type !== 'LINE') continue;
      const lb = {
        minX: Math.min(le.x0, le.x1) - 15,
        maxX: Math.max(le.x0, le.x1) + 15,
        minY: Math.min(le.y0, le.y1) - 15,
        maxY: Math.max(le.y0, le.y1) + 15
      };
      const hits = _spatialGrid.queryBounds(lb, 0);
      for (const hit of hits) {
        if (indexSet.has(hit) || additionalTexts.has(hit)) continue;
        const t = dxfEntities[hit];
        if (!t || t.type !== 'TEXT') continue;
        const tb = t.bounds || getEntityBounds(t);
        if (segToRectDist(le.x0, le.y0, le.x1, le.y1, tb) <= 12) {
          additionalTexts.add(hit);
        }
      }
    }

    for (const lineIdx of additionalLines) {
      if (!indexSet.has(lineIdx)) {
        entitiesToExport.push(dxfEntities[lineIdx]);
      }
    }
    for (const txtIdx of additionalTexts) {
      if (!indexSet.has(txtIdx)) {
        entitiesToExport.push(dxfEntities[txtIdx]);
      }
    }
    
    // 3. 自动捕获整个图纸的边框、图例和底部表单 (Background Frame & Legend)
    let gMinX = Infinity, gMinY = Infinity, gMaxX = -Infinity, gMaxY = -Infinity;
    for (const ent of dxfEntities) {
      if (ent.bounds) {
        gMinX = Math.min(gMinX, ent.bounds.minX); gMinY = Math.min(gMinY, ent.bounds.minY);
        gMaxX = Math.max(gMaxX, ent.bounds.maxX); gMaxY = Math.max(gMaxY, ent.bounds.maxY);
      } else if (ent.x !== undefined && ent.y !== undefined) {
        gMinX = Math.min(gMinX, ent.x); gMinY = Math.min(gMinY, ent.y);
        gMaxX = Math.max(gMaxX, ent.x); gMaxY = Math.max(gMaxY, ent.y);
      }
    }
    const gW = gMaxX - gMinX;
    const gH = gMaxY - gMinY;
    
    for (let i = 0; i < dxfEntities.length; i++) {
      if (indexSet.has(i)) continue;
      const ent = dxfEntities[i];
      if (ent.type === 'GROUP') continue; // 不自动捕获非选中的节点
      
      let isBg = false;
      if (ent.bounds) {
        const w = ent.bounds.maxX - ent.bounds.minX;
        const h = ent.bounds.maxY - ent.bounds.minY;
        // 仅捕获超大边框线 (跨度超过全图 60%)，不再激进地捕获边缘区域的所有图元
        if (w > gW * 0.6 || h > gH * 0.6) {
          isBg = true;
        }
      }
      
      if (isBg) {
        entitiesToExport.push(ent);
      }
    }

    exportModal.classList.remove('hidden');
    
    // 初始化预览画布
    setTimeout(() => {
      const previewCanvas = document.getElementById('preview-canvas');
      if (previewCanvas && !previewCadEngine) {
        previewCadEngine = new ThreeCadEngine(previewCanvas);
      }
      if (previewCadEngine) {
        previewCadEngine.buildDxfScene(entitiesToExport);
        // Compute bounding box for camera
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const ent of entitiesToExport) {
          if (ent.bounds) {
            minX = Math.min(minX, ent.bounds.minX); minY = Math.min(minY, ent.bounds.minY);
            maxX = Math.max(maxX, ent.bounds.maxX); maxY = Math.max(maxY, ent.bounds.maxY);
          } else {
            minX = Math.min(minX, ent.x || 0); minY = Math.min(minY, ent.y || 0);
            maxX = Math.max(maxX, ent.x || 0); maxY = Math.max(maxY, ent.y || 0);
          }
        }
        if (minX !== Infinity) {
          const cx = (minX + maxX) / 2;
          const cy = (minY + maxY) / 2;
          const w = Math.max(maxX - minX, 100);
          const h = Math.max(maxY - minY, 100);
          
          const r = previewCanvas.getBoundingClientRect();
          const zoom = Math.min(r.width / w, r.height / h) * 0.8;
          
          if (r.width > 0 && r.height > 0) {
            previewCadEngine.resize(r.width, r.height);
          }
          
          previewCadEngine.camera.position.set(cx, cy, 500);
          previewCadEngine.camera.lookAt(cx, cy, 0);
          previewCadEngine.camera.zoom = zoom;
          previewCadEngine.camera.updateProjectionMatrix();
          previewCadEngine.renderer.render(previewCadEngine.scene, previewCadEngine.camera);
        }
        
        // Add pan/zoom interactions to the preview canvas
        if (!previewCadEngine._hasControls) {
          previewCadEngine._hasControls = true;
          let isDragging = false;
          let lastX = 0, lastY = 0;
          
          previewCanvas.addEventListener('mousedown', (e) => {
            isDragging = true;
            lastX = e.clientX;
            lastY = e.clientY;
          });
          
          previewCanvas.addEventListener('mousemove', (e) => {
            if (isDragging) {
              const dx = e.clientX - lastX;
              const dy = e.clientY - lastY;
              lastX = e.clientX;
              lastY = e.clientY;
              const zoom = previewCadEngine.camera.zoom;
              previewCadEngine.camera.position.x -= dx / zoom;
              previewCadEngine.camera.position.y += dy / zoom;
              previewCadEngine.camera.updateProjectionMatrix();
              previewCadEngine.renderer.render(previewCadEngine.scene, previewCadEngine.camera);
            }
          });
          
          previewCanvas.addEventListener('mouseup', () => { isDragging = false; });
          previewCanvas.addEventListener('mouseleave', () => { isDragging = false; });
          
          previewCanvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
            previewCadEngine.camera.zoom *= zoomDelta;
            previewCadEngine.camera.updateProjectionMatrix();
            previewCadEngine.renderer.render(previewCadEngine.scene, previewCadEngine.camera);
          }, { passive: false });
        }
      }
      
      // 保存导出数据到模态框
      exportModal.dataset.exportJson = JSON.stringify(entitiesToExport);
    }, 100);
  });
}

const btnCloseExportPreview = document.getElementById('btn-close-export-preview');
const btnCancelExport = document.getElementById('btn-cancel-export');
const btnConfirmExport = document.getElementById('btn-confirm-export');

if (btnCloseExportPreview) btnCloseExportPreview.addEventListener('click', () => document.getElementById('export-preview-modal').classList.add('hidden'));
if (btnCancelExport) btnCancelExport.addEventListener('click', () => document.getElementById('export-preview-modal').classList.add('hidden'));

if (btnConfirmExport) {
  btnConfirmExport.addEventListener('click', async () => {
    const exportModal = document.getElementById('export-preview-modal');
    const jsonStr = exportModal.dataset.exportJson;
    if (!jsonStr) return;
    
    // Read the subgraph name
    const nameInput = document.getElementById('export-subgraph-name');
    let subgraphName = nameInput ? nameInput.value.trim() : '';
    if (!subgraphName) {
      subgraphName = '未命名图元';
    }
    
    // Call IPC to save
    try {
      btnConfirmExport.disabled = true;
      btnConfirmExport.textContent = '正在保存...';
      const res = await window.api.exportDxfSubgraph(jsonStr, subgraphName, currentPdfHash);
      if (res.success !== false) {
        exportModal.classList.add('hidden');
        showCustomDialog('提示', '保存成功！');
        // Auto-refresh lists in the background
        if (typeof loadHistory === 'function') loadHistory();
        if (typeof loadSubgraphs === 'function') loadSubgraphs();
      } else if (res.canceled) {
        // 用户取消保存，无操作 (虽然现在静默保存不会canceled)
      } else {
        showCustomDialog('错误', '保存失败: ' + res.error);
      }
    } catch (e) {
      showCustomDialog('错误', '保存失败: ' + e.message);
    } finally {
      btnConfirmExport.disabled = false;
      btnConfirmExport.textContent = '保存子图';
    }
  });
}

// --- 工具切换 ---
function setActiveTool(tool) {
  currentTool = tool;
  Object.entries(toolBtns).forEach(([name, btn]) => {
    if (!btn) return;
    btn.classList.toggle('active', name === tool);
  });
  // 更新鼠标样式
  if (dxfCanvas) {
    hoveredEntityIndex = -1;
    const cursors = { select: 'default', node: 'crosshair', line: 'crosshair', rect: 'crosshair', text: 'text' };
    dxfCanvas.style.cursor = cursors[tool] || 'default';
  }
  if (threeCadEngine) {
    threeCadEngine.hideSnapIndicator();
  }
  // 取消正在绘制的图元
  if (tool === 'select' || tool === 'delete' || tool === 'node') {
    isDrawing = false;
    drawViewports();
  }
}

if (toolBtns.select) toolBtns.select.addEventListener('click', () => setActiveTool('select'));
if (toolBtns.node)   toolBtns.node.addEventListener('click',   () => setActiveTool('node'));
if (toolBtns.line)   toolBtns.line.addEventListener('click',   () => setActiveTool('line'));
if (toolBtns.rect)   toolBtns.rect.addEventListener('click',   () => setActiveTool('rect'));
if (toolBtns.text)   toolBtns.text.addEventListener('click',   () => setActiveTool('text'));

if (toolBtns.delete) {
  toolBtns.delete.addEventListener('click', () => deleteSelectedEntity());
}
if (toolBtns.undo) {
  toolBtns.undo.addEventListener('click', () => undoAction());
}
if (btnPropClose) {
  btnPropClose.addEventListener('click', () => {
    selectedEntityIndex = -1;
    if (propPanel) propPanel.classList.add('hidden');
    drawViewports();
  });
}

// --- 键盘快捷键 ---
window.addEventListener('keydown', (e) => {
  if (e.target === inlineTextEditor) return; // 文字编辑时不响应
  const tag = document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;

  if (e.key === 'Delete' || e.key === 'Backspace') {
    deleteSelectedEntity();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
    e.preventDefault();
    undoAction();
  }
  if (e.key === 'Escape') {
    isDrawing = false;
    selectedEntityIndex = -1;
    if (propPanel) propPanel.classList.add('hidden');
    setActiveTool('select');
    drawViewports();
  }
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && selectedEntityIndex >= 0) {
    e.preventDefault();
    pushUndoSnapshot();
    const step = (e.shiftKey ? 10 : 1) / zoom;
    let dx = 0, dy = 0;
    if (e.key === 'ArrowUp') dy = step;
    if (e.key === 'ArrowDown') dy = -step;
    if (e.key === 'ArrowLeft') dx = -step;
    if (e.key === 'ArrowRight') dx = step;

    const ent = dxfEntities[selectedEntityIndex];
    if (ent.type === 'LINE') {
      ent.x0 += dx; ent.y0 += dy;
      ent.x1 += dx; ent.y1 += dy;
    } else if (ent.type === 'LWPOLYLINE') {
      ent.vertices.forEach(v => { v.x += dx; v.y += dy; });
    } else if (ent.type === 'TEXT') {
      ent.x += dx; ent.y += dy;
    }
    delete ent.bounds;
    getEntityBounds(ent);
    buildSpatialGrid();
    showPropPanel(selectedEntityIndex); // Update property panel
    drawViewports();
  }

  if (e.key === 'v' || e.key === 'V') setActiveTool('select');
  if (e.key === 'n' || e.key === 'N') setActiveTool('node');
  if (e.key === 'l' || e.key === 'L') setActiveTool('line');
  if (e.key === 'r' || e.key === 'R') setActiveTool('rect');
  if (e.key === 't' || e.key === 'T') setActiveTool('text');
});

// --- 坐标逆变换：屏幕坐标 → DXF 坐标 ---
function screenToDxf(screenX, screenY, canvas) {
  const rect = (canvas === pdfCanvas) ? pdfRect : dxfRect;
  const viewW = rect.width || 800;
  const viewH = rect.height || 600;

  const localX = (screenX - rect.left - offsetX - viewW / 2) / zoom + dxfCenterX;
  const localY = -(screenY - rect.top - offsetY - viewH / 2) / zoom + dxfCenterY;
  return { x: localX, y: localY };
}

// --- Hit-test：判断点 (px,py) DXF 坐标是否命中图元 ---
const HIT_THRESHOLD = 6; // px，与 zoom 无关的屏幕距离阈值

// 检测是否命中图元节点（端点/顶点）
function hitTestNode(dxfX, dxfY) {
  const threshold = HIT_THRESHOLD / zoom;
  let bestNode = null;
  let minDist = threshold;

  // Use spatial grid for O(1) lookup instead of O(N) linear scan
  const candidates = _spatialGrid
    ? _spatialGrid.queryPoint(dxfX, dxfY, threshold)
    : Array.from({length: dxfEntities.length}, (_, i) => i);

  for (let ci = 0; ci < candidates.length; ci++) {
    const i = candidates[ci];
    const ent = dxfEntities[i];
    if (!ent) continue;
    const b = ent.bounds || (ent.bounds = getEntityBounds(ent));
    if (dxfX < b.minX - minDist || dxfX > b.maxX + minDist ||
        dxfY < b.minY - minDist || dxfY > b.maxY + minDist) {
      continue;
    }

    if (ent.type === 'LINE') {
      const d0 = Math.hypot(dxfX - ent.x0, dxfY - ent.y0);
      if (d0 < minDist) { minDist = d0; bestNode = { entityIndex: i, type: 'LINE', nodeIndex: 0, x: ent.x0, y: ent.y0 }; }
      const d1 = Math.hypot(dxfX - ent.x1, dxfY - ent.y1);
      if (d1 < minDist) { minDist = d1; bestNode = { entityIndex: i, type: 'LINE', nodeIndex: 1, x: ent.x1, y: ent.y1 }; }
    } else if (ent.type === 'LWPOLYLINE') {
      const verts = ent.vertices;
      for (let vIdx = 0; vIdx < verts.length; vIdx++) {
        const v = verts[vIdx];
        const d = Math.hypot(dxfX - v.x, dxfY - v.y);
        if (d < minDist) { minDist = d; bestNode = { entityIndex: i, type: 'LWPOLYLINE', nodeIndex: vIdx, x: v.x, y: v.y }; }
      }
    }
  }
  return bestNode;
}

// 获取与给定坐标极其接近的所有关联节点集合
function getConnectedNodes(targetX, targetY) {
  const connected = [];
  const eps = 1e-4; // 坐标容差

  // Use spatial grid for O(1) lookup
  const candidates = _spatialGrid
    ? _spatialGrid.queryPoint(targetX, targetY, 1)
    : Array.from({length: dxfEntities.length}, (_, i) => i);

  for (let ci = 0; ci < candidates.length; ci++) {
    const i = candidates[ci];
    const ent = dxfEntities[i];
    if (!ent) continue;
    if (ent.type === 'LINE') {
      if (Math.hypot(ent.x0 - targetX, ent.y0 - targetY) < eps) connected.push({ ent, type: 'LINE', nodeIndex: 0 });
      if (Math.hypot(ent.x1 - targetX, ent.y1 - targetY) < eps) connected.push({ ent, type: 'LINE', nodeIndex: 1 });
    } else if (ent.type === 'LWPOLYLINE') {
      const verts = ent.vertices;
      for (let vIdx = 0; vIdx < verts.length; vIdx++) {
        if (Math.hypot(verts[vIdx].x - targetX, verts[vIdx].y - targetY) < eps) {
          connected.push({ ent, type: 'LWPOLYLINE', nodeIndex: vIdx });
        }
      }
    }
  }
  return connected;
}

function hitTest(dxfX, dxfY) {
  const threshold = HIT_THRESHOLD / zoom;

  function checkHit(ent) {
    const b = ent.bounds || (ent.bounds = getEntityBounds(ent));
    if (dxfX < b.minX - threshold || dxfX > b.maxX + threshold ||
        dxfY < b.minY - threshold || dxfY > b.maxY + threshold) {
      return false;
    }

    if (ent.type === 'LINE') {
      return distToSegment(dxfX, dxfY, ent.x0, ent.y0, ent.x1, ent.y1) < threshold;
    } else if (ent.type === 'LWPOLYLINE') {
      const verts = ent.vertices;
      for (let j = 0; j < verts.length - 1; j++) {
        if (distToSegment(dxfX, dxfY, verts[j].x, verts[j].y, verts[j+1].x, verts[j+1].y) < threshold) return true;
      }
      if (ent.closed && verts.length > 1) {
        const last = verts[verts.length - 1], first = verts[0];
        if (distToSegment(dxfX, dxfY, last.x, last.y, first.x, first.y) < threshold) return true;
      }
      // Also allow clicking inside small closed or circular symbols
      if (verts.length >= 8 || ent.closed) {
        const w = b.maxX - b.minX, h = b.maxY - b.minY;
        if (w <= 40 && h <= 40 && dxfX >= b.minX && dxfX <= b.maxX && dxfY >= b.minY && dxfY <= b.maxY) {
          return true;
        }
      }
    } else if (ent.type === 'TEXT') {
      const tw = ent.tw || (ent.text ? ent.text.length * (ent.height || 12) * 0.6 : 0);
      const th = ent.th || ((ent.height || 12) * 1.2);
      if (dxfX >= ent.x - 3 && dxfX <= ent.x + tw + 3 &&
          dxfY >= ent.y - 3 && dxfY <= ent.y + th + 3) return true;
    } else if (ent.type === 'GROUP' && ent.children) {
      for (let j = 0; j < ent.children.length; j++) {
        if (checkHit(ent.children[j])) return true;
      }
    }
    return false;
  }

  // Use spatial grid for O(1) lookup instead of O(N) linear scan
  const candidates = _spatialGrid
    ? _spatialGrid.queryPoint(dxfX, dxfY, threshold)
    : Array.from({length: dxfEntities.length}, (_, i) => i);

  // Check candidates in reverse order (top-most first)
  for (let ci = candidates.length - 1; ci >= 0; ci--) {
    const i = candidates[ci];
    if (i >= 0 && i < dxfEntities.length && checkHit(dxfEntities[i])) return i;
  }
  return -1;
}

// 点到线段的最短距离
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// 线段到矩形包围盒的最短距离（0 表示相交），用于吸附线段旁的描述文本
function segToRectDist(ax, ay, bx, by, r) {
  let best = Infinity;
  const len = Math.hypot(bx - ax, by - ay);
  const n = Math.max(2, Math.ceil(len / 4));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const px = ax + (bx - ax) * t, py = ay + (by - ay) * t;
    const dx = Math.max(r.minX - px, px - r.maxX, 0);
    const dy = Math.max(r.minY - py, py - r.maxY, 0);
    const d = Math.hypot(dx, dy);
    if (d < best) best = d;
  }
  const corners = [[r.minX, r.minY], [r.minX, r.maxY], [r.maxX, r.minY], [r.maxX, r.maxY]];
  for (const [cx, cy] of corners) {
    const d = distToSegment(cx, cy, ax, ay, bx, by);
    if (d < best) best = d;
  }
  return best;
}

function getConnectedExternalLines(entityIndex) {
  const SNAP_DIST = 8;
  const connected = [];
  const targetEnt = dxfEntities[entityIndex];
  
  if (!targetEnt || (targetEnt.type !== 'LWPOLYLINE' && targetEnt.type !== 'TEXT' && targetEnt.type !== 'GROUP')) return connected;
  
  const targetGeom = [];
  
  function extractGeom(ent) {
    if (ent.type === 'LWPOLYLINE') {
      const verts = ent.vertices;
      for (let j = 0; j < verts.length - 1; j++) {
        targetGeom.push({ type: 'seg', p1: verts[j], p2: verts[j+1] });
      }
      if (ent.closed && verts.length > 2) {
        targetGeom.push({ type: 'seg', p1: verts[verts.length-1], p2: verts[0] });
      }
      verts.forEach(v => targetGeom.push({ type: 'pt', p: v }));
    } else if (ent.type === 'LINE') {
      targetGeom.push({ type: 'seg', p1: { x: ent.x0, y: ent.y0 }, p2: { x: ent.x1, y: ent.y1 } });
      targetGeom.push({ type: 'pt', p: { x: ent.x0, y: ent.y0 } });
      targetGeom.push({ type: 'pt', p: { x: ent.x1, y: ent.y1 } });
    } else if (ent.type === 'TEXT') {
      targetGeom.push({ type: 'pt', p: { x: ent.x, y: ent.y } });
    } else if (ent.type === 'GROUP') {
      if (ent.cx !== undefined && ent.cy !== undefined) {
        targetGeom.push({ type: 'pt', p: { x: ent.cx, y: ent.cy } });
      }
      ent.children.forEach(c => extractGeom(c));
    }
  }

  extractGeom(targetEnt);

  // Use spatial grid: query candidates near the target entity's bounds
  const targetBounds = targetEnt.bounds || (targetEnt.bounds = getEntityBounds(targetEnt));
  const candidates = _spatialGrid
    ? _spatialGrid.queryBounds(targetBounds, SNAP_DIST)
    : Array.from({length: dxfEntities.length}, (_, i) => i);

  for (let ci = 0; ci < candidates.length; ci++) {
    const i = candidates[ci];
    if (i === entityIndex) continue;
    const ent = dxfEntities[i];
    if (!ent || ent.type !== 'LINE') continue;
    
    let c0 = false;
    let c1 = false;
    
    targetGeom.forEach(g => {
      if (g.type === 'seg') {
        if (distToSegment(ent.x0, ent.y0, g.p1.x, g.p1.y, g.p2.x, g.p2.y) <= SNAP_DIST) c0 = true;
        if (distToSegment(ent.x1, ent.y1, g.p1.x, g.p1.y, g.p2.x, g.p2.y) <= SNAP_DIST) c1 = true;
      } else if (g.type === 'pt') {
        if (Math.hypot(ent.x0 - g.p.x, ent.y0 - g.p.y) <= SNAP_DIST) c0 = true;
        if (Math.hypot(ent.x1 - g.p.x, ent.y1 - g.p.y) <= SNAP_DIST) c1 = true;
      }
    });

    if (c0) connected.push({ entityIndex: i, endpoint: 0 });
    if (c1) connected.push({ entityIndex: i, endpoint: 1 });
  }
  
  return connected;
}

// --- 变电站/设备节点几何辅助生成 ---
function createCircleVertices(cx, cy, r, segments = 24) {
  const verts = [];
  for (let i = 0; i < segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    verts.push({ x: cx + r * Math.cos(theta), y: cy + r * Math.sin(theta) });
  }
  return verts;
}

function createSymbolGeometry(cx, cy, nodeType = '110kV', radius = null) {
  const r = radius !== null ? radius : (nodeType === '220kV' ? 7.5 : nodeType === '500kV' ? 9.0 : nodeType === 'POINT' ? 3.5 : 6.0);

  if (nodeType === '220kV') {
    return [
      { type: 'LWPOLYLINE', vertices: createCircleVertices(cx, cy, r, 24), closed: true, layer: 'SYMBOLS' },
      { type: 'LWPOLYLINE', vertices: createCircleVertices(cx, cy, r * 0.64, 20), closed: true, layer: 'SYMBOLS' }
    ];
  } else if (nodeType === '500kV') {
    return [
      { type: 'LWPOLYLINE', vertices: createCircleVertices(cx, cy, r, 24), closed: true, layer: 'SYMBOLS' },
      { type: 'LWPOLYLINE', vertices: createCircleVertices(cx, cy, r * 0.68, 20), closed: true, layer: 'SYMBOLS' },
      { type: 'LWPOLYLINE', vertices: createCircleVertices(cx, cy, r * 0.38, 16), closed: true, layer: 'SYMBOLS' }
    ];
  } else if (nodeType === 'PLANT') {
    const w = r * 2.2, h = r * 1.5;
    return [{
      type: 'LWPOLYLINE',
      vertices: [
        { x: cx - w/2, y: cy - h/2 }, { x: cx + w/2, y: cy - h/2 },
        { x: cx + w/2, y: cy + h/2 }, { x: cx - w/2, y: cy + h/2 }
      ],
      closed: true,
      layer: 'SYMBOLS'
    }];
  } else if (nodeType === 'DIAMOND') {
    const d = r * 1.2;
    return [{
      type: 'LWPOLYLINE',
      vertices: [
        { x: cx, y: cy - d }, { x: cx + d, y: cy },
        { x: cx, y: cy + d }, { x: cx - d, y: cy }
      ],
      closed: true,
      layer: 'SYMBOLS'
    }];
  } else if (nodeType === 'TRIANGLE') {
    const d = r * 1.2;
    return [{
      type: 'LWPOLYLINE',
      vertices: [
        { x: cx, y: cy + d },
        { x: cx + d * 0.866, y: cy - d * 0.5 },
        { x: cx - d * 0.866, y: cy - d * 0.5 }
      ],
      closed: true,
      layer: 'SYMBOLS'
    }];
  } else if (nodeType === 'POINT') {
    return [{ type: 'LWPOLYLINE', vertices: createCircleVertices(cx, cy, r, 16), closed: true, layer: 'SYMBOLS' }];
  } else {
    // 110kV 单圆
    return [{ type: 'LWPOLYLINE', vertices: createCircleVertices(cx, cy, r, 24), closed: true, layer: 'SYMBOLS' }];
  }
}

function createNodeEntity(cx, cy, name = '新建变电站', nodeType = '110kV', options = {}) {
  const radius = options.radius || (nodeType === '220kV' ? 7.5 : nodeType === '500kV' ? 9.0 : nodeType === 'POINT' ? 3.5 : 6.0);
  const color = options.color || (nodeType === '220kV' ? '#f97316' : nodeType === '500kV' ? '#a855f7' : nodeType === 'PLANT' ? '#eab308' : '#00f2fe');
  const textPos = options.textPos || 'bottom';
  const textH = options.textH || 9.5;
  const textColor = options.textColor || '#38bdf8';

  const symbols = createSymbolGeometry(cx, cy, nodeType, radius);
  symbols.forEach(s => { s.color = color; });

  const textW = name.length * textH * 0.6;
  let tx = cx - textW / 2;
  let ty = cy - radius - textH - 4;

  if (textPos === 'top') {
    tx = cx - textW / 2;
    ty = cy + radius + 4;
  } else if (textPos === 'right') {
    tx = cx + radius + 6;
    ty = cy - textH / 2;
  } else if (textPos === 'left') {
    tx = cx - radius - textW - 6;
    ty = cy - textH / 2;
  } else if (textPos === 'center') {
    tx = cx - textW / 2;
    ty = cy - textH / 2;
  }

  const text = {
    type: 'TEXT',
    text: name,
    x: tx,
    y: ty,
    height: textH,
    color: textColor,
    layer: 'TEXTS'
  };

  const group = {
    type: 'GROUP',
    nodeType: nodeType,
    name: name,
    cx: cx,
    cy: cy,
    radius: radius,
    color: color,
    textPos: textPos,
    textColor: textColor,
    layer: 'SYMBOLS',
    children: [...symbols, text]
  };

  group.bounds = getEntityBounds(group);
  return group;
}

// --- 智能吸附计算 (Snap) ---
function getSnapTarget(dxfX, dxfY, customDist) {
  const snapDist = customDist || (14 / (zoom || 1));
  let bestSnap = null;
  let minDist = snapDist;

  const candidates = _spatialGrid
    ? _spatialGrid.queryPoint(dxfX, dxfY, snapDist)
    : Array.from({length: dxfEntities.length}, (_, i) => i);

  for (let ci = 0; ci < candidates.length; ci++) {
    const i = candidates[ci];
    const ent = dxfEntities[i];
    if (!ent) continue;

    // 1. 如果是 GROUP 节点，吸附其符号中心
    if (ent.type === 'GROUP') {
      let cx = ent.cx, cy = ent.cy;
      if (cx === undefined || cy === undefined) {
        const sym = (ent.children || []).find(c => c.type === 'LWPOLYLINE');
        if (sym) {
          const sb = sym.bounds || getEntityBounds(sym);
          cx = (sb.minX + sb.maxX) / 2;
          cy = (sb.minY + sb.maxY) / 2;
        } else {
          const b = ent.bounds || getEntityBounds(ent);
          cx = (b.minX + b.maxX) / 2;
          cy = (b.minY + b.maxY) / 2;
        }
      }
      const d = Math.hypot(dxfX - cx, dxfY - cy);
      if (d < minDist) {
        minDist = d;
        bestSnap = { x: cx, y: cy, type: 'node', entityIndex: i, ent: ent, name: ent.name || '变电站' };
      }
    } else if (ent.type === 'LINE') {
      // 2. 吸附 LINE 起终点
      const d0 = Math.hypot(dxfX - ent.x0, dxfY - ent.y0);
      if (d0 < minDist) {
        minDist = d0;
        bestSnap = { x: ent.x0, y: ent.y0, type: 'endpoint', entityIndex: i, endpoint: 0, ent: ent };
      }
      const d1 = Math.hypot(dxfX - ent.x1, dxfY - ent.y1);
      if (d1 < minDist) {
        minDist = d1;
        bestSnap = { x: ent.x1, y: ent.y1, type: 'endpoint', entityIndex: i, endpoint: 1, ent: ent };
      }
    } else if (ent.type === 'LWPOLYLINE') {
      const b = ent.bounds || getEntityBounds(ent);
      const w = b.maxX - b.minX, h = b.maxY - b.minY;
      if (w <= 30 && h <= 30) {
        const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
        const d = Math.hypot(dxfX - cx, dxfY - cy);
        if (d < minDist) {
          minDist = d;
          bestSnap = { x: cx, y: cy, type: 'node', entityIndex: i, ent: ent };
        }
      }
    }
  }

  return bestSnap;
}

// --- Undo 栈操作 ---
function pushUndoSnapshot() {
  // Use structuredClone for faster deep copy (avoids JSON string allocation)
  try {
    undoStack.push(structuredClone(dxfEntities));
  } catch(e) {
    undoStack.push(JSON.parse(JSON.stringify(dxfEntities)));
  }
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  isDirty = true;
  updateDirtyIndicator();
}

function undoAction() {
  if (undoStack.length === 0) return;
  dxfEntities = undoStack.pop();
  // Rebuild spatial grid and bounds after undo
  dxfEntities.forEach(ent => { delete ent.bounds; getEntityBounds(ent); });
  buildSpatialGrid();
  selectedEntityIndex = -1;
  if (propPanel) propPanel.classList.add('hidden');
  isDirty = undoStack.length > 0;
  updateDirtyIndicator();
  drawViewports();
}

function updateDirtyIndicator() {
  if (editorStatusTip) {
    editorStatusTip.textContent = isDirty
      ? '● 已修改（未导出）· Ctrl+Z 撤销'
      : '点击图元选中 · Del 删除 · 工具栏绘制新图元';
    editorStatusTip.style.color = isDirty ? '#f59e0b' : '';
  }
}

// --- 删除选中图元 ---
function deleteSelectedEntity() {
  if (selectedEntityIndex < 0 || selectedEntityIndex >= dxfEntities.length) return;
  pushUndoSnapshot();
  dxfEntities.splice(selectedEntityIndex, 1);
  selectedEntityIndex = -1;
  buildSpatialGrid();
  if (propPanel) propPanel.classList.add('hidden');
  drawViewports();
}

// --- 属性面板 ---
function showPropPanel(index) {
  if (!propPanel || !propBody || index < 0) return;
  const ent = dxfEntities[index];
  if (!ent) return;

  const layerOptions = ['SYMBOLS', 'LINES', 'RECTS', 'POLYLINES', 'TEXTS']
    .map(l => `<option value="${l}" ${ent.layer === l ? 'selected' : ''}>${l}</option>`).join('');

  let fieldsHtml = `
    <div class="prop-row">
      <label>图层</label>
      <select class="prop-input" id="prop-layer">${layerOptions}</select>
    </div>`;

  if (ent.type === 'GROUP') {
    const textChild = (ent.children || []).find(c => c.type === 'TEXT');
    const nodeName = textChild ? textChild.text : (ent.name || '变电站');
    const nodeType = ent.nodeType || '110kV';
    const textH = textChild ? (textChild.height || 10) : 10;
    const nodeRadius = ent.radius !== undefined ? ent.radius : (nodeType === '220kV' ? 7.5 : nodeType === '500kV' ? 9.0 : nodeType === 'POINT' ? 3.5 : 6.0);
    const nodeColor = ent.color || (nodeType === '220kV' ? '#f97316' : nodeType === '500kV' ? '#a855f7' : nodeType === 'PLANT' ? '#eab308' : '#00f2fe');
    const textPos = ent.textPos || 'bottom';
    const textColor = ent.textColor || (textChild ? textChild.color : null) || '#38bdf8';

    const b = ent.bounds || getEntityBounds(ent);
    const sym = (ent.children || []).find(c => c.type === 'LWPOLYLINE');
    const sb = sym ? (sym.bounds || getEntityBounds(sym)) : b;
    const cx = ent.cx !== undefined ? ent.cx : (sb.minX + sb.maxX) / 2;
    const cy = ent.cy !== undefined ? ent.cy : (sb.minY + sb.maxY) / 2;

    propPanelTitle.textContent = '节点样式与属性';
    fieldsHtml += `
      <div class="prop-row">
        <label>节点名称</label>
        <input class="prop-input" id="prop-node-name" type="text" value="${nodeName}">
      </div>
      <div class="prop-row">
        <label>节点类型</label>
        <select class="prop-input" id="prop-node-type">
          <option value="110kV" ${nodeType === '110kV' ? 'selected' : ''}>110kV 变电站 (单圆)</option>
          <option value="220kV" ${nodeType === '220kV' ? 'selected' : ''}>220kV 变电站 (双圆)</option>
          <option value="500kV" ${nodeType === '500kV' ? 'selected' : ''}>500kV 变电站 (三圆)</option>
          <option value="PLANT" ${nodeType === 'PLANT' ? 'selected' : ''}>电厂 / 枢纽 (矩形)</option>
          <option value="DIAMOND" ${nodeType === 'DIAMOND' ? 'selected' : ''}>开闭所 (菱形)</option>
          <option value="TRIANGLE" ${nodeType === 'TRIANGLE' ? 'selected' : ''}>发电单元 (三角形)</option>
          <option value="POINT" ${nodeType === 'POINT' ? 'selected' : ''}>普通监测点 (圆点)</option>
        </select>
      </div>
      <div class="prop-row">
        <label>符号尺寸</label>
        <input class="prop-input" id="prop-node-r" type="number" step="0.5" min="2" max="60" value="${nodeRadius.toFixed(1)}">
      </div>
      <div class="prop-row">
        <label>节点颜色</label>
        <input class="prop-input prop-color-input" id="prop-node-color" type="color" value="${nodeColor}">
      </div>
      <div class="prop-row">
        <label>文字方位</label>
        <select class="prop-input" id="prop-node-text-pos">
          <option value="bottom" ${textPos === 'bottom' ? 'selected' : ''}>下方 (Bottom)</option>
          <option value="top" ${textPos === 'top' ? 'selected' : ''}>上方 (Top)</option>
          <option value="right" ${textPos === 'right' ? 'selected' : ''}>右侧 (Right)</option>
          <option value="left" ${textPos === 'left' ? 'selected' : ''}>左侧 (Left)</option>
          <option value="center" ${textPos === 'center' ? 'selected' : ''}>居中 (Center)</option>
        </select>
      </div>
      <div class="prop-row">
        <label>字高</label>
        <input class="prop-input" id="prop-node-h" type="number" step="0.5" value="${textH.toFixed(1)}">
      </div>
      <div class="prop-row">
        <label>文字颜色</label>
        <input class="prop-input prop-color-input" id="prop-node-text-color" type="color" value="${textColor}">
      </div>
      <div class="prop-row">
        <label>中心 X</label>
        <input class="prop-input" id="prop-node-cx" type="number" step="0.1" value="${cx.toFixed(2)}">
      </div>
      <div class="prop-row">
        <label>中心 Y</label>
        <input class="prop-input" id="prop-node-cy" type="number" step="0.1" value="${cy.toFixed(2)}">
      </div>`;
  } else if (ent.type === 'LINE') {
    propPanelTitle.textContent = '直线属性';
    fieldsHtml += `
      <div class="prop-row"><label>起点 X</label><input class="prop-input" id="prop-x0" type="number" value="${ent.x0.toFixed(2)}"></div>
      <div class="prop-row"><label>起点 Y</label><input class="prop-input" id="prop-y0" type="number" value="${ent.y0.toFixed(2)}"></div>
      <div class="prop-row"><label>终点 X</label><input class="prop-input" id="prop-x1" type="number" value="${ent.x1.toFixed(2)}"></div>
      <div class="prop-row"><label>终点 Y</label><input class="prop-input" id="prop-y1" type="number" value="${ent.y1.toFixed(2)}"></div>
      <div class="prop-row"><label>颜色</label><input class="prop-input prop-color-input" id="prop-color" type="color" value="${ent.color || '#ffffff'}"></div>`;
  } else if (ent.type === 'TEXT') {
    propPanelTitle.textContent = '文字属性';
    fieldsHtml += `
      <div class="prop-row"><label>文字内容</label><input class="prop-input" id="prop-text" type="text" value="${ent.text || ''}"></div>
      <div class="prop-row"><label>X</label><input class="prop-input" id="prop-x" type="number" value="${ent.x.toFixed(2)}"></div>
      <div class="prop-row"><label>Y</label><input class="prop-input" id="prop-y" type="number" value="${ent.y.toFixed(2)}"></div>
      <div class="prop-row"><label>字高</label><input class="prop-input" id="prop-h" type="number" value="${(ent.height||10).toFixed(2)}"></div>
      <div class="prop-row"><label>颜色</label><input class="prop-input prop-color-input" id="prop-color" type="color" value="${ent.color || '#10b981'}"></div>`;
  } else if (ent.type === 'LWPOLYLINE') {
    propPanelTitle.textContent = `多段线 (${ent.vertices.length} 顶点)`;
    fieldsHtml += `
      <div class="prop-row"><label>已闭合</label><input type="checkbox" id="prop-closed" ${ent.closed ? 'checked' : ''}></div>
      <div class="prop-row"><label>颜色</label><input class="prop-input prop-color-input" id="prop-color" type="color" value="${ent.color || '#00f2fe'}"></div>`;
  }

  fieldsHtml += `<button class="btn btn-primary btn-small prop-apply-btn" id="btn-prop-apply">应用</button>`;
  propBody.innerHTML = fieldsHtml;
  propPanel.classList.remove('hidden');

  // 绑定应用按钮
  document.getElementById('btn-prop-apply').addEventListener('click', () => {
    pushUndoSnapshot();
    const layer = document.getElementById('prop-layer').value;
    ent.layer = layer;

    if (ent.type === 'GROUP') {
      const nameInput = document.getElementById('prop-node-name');
      const typeInput = document.getElementById('prop-node-type');
      const rInput = document.getElementById('prop-node-r');
      const colorInput = document.getElementById('prop-node-color');
      const textPosInput = document.getElementById('prop-node-text-pos');
      const hInput = document.getElementById('prop-node-h');
      const textColorInput = document.getElementById('prop-node-text-color');
      const cxInput = document.getElementById('prop-node-cx');
      const cyInput = document.getElementById('prop-node-cy');

      if (nameInput && typeInput && cxInput && cyInput) {
        const newName = nameInput.value.trim() || '变电站';
        const newType = typeInput.value;
        const newR = rInput ? (parseFloat(rInput.value) || 6.0) : 6.0;
        const newColor = colorInput ? colorInput.value : '#00f2fe';
        const newTextPos = textPosInput ? textPosInput.value : 'bottom';
        const newH = hInput ? (parseFloat(hInput.value) || 10) : 10;
        const newTextColor = textColorInput ? textColorInput.value : '#38bdf8';
        const newCx = parseFloat(cxInput.value);
        const newCy = parseFloat(cyInput.value);

        const b = ent.bounds || getEntityBounds(ent);
        const sym = (ent.children || []).find(c => c.type === 'LWPOLYLINE');
        const sb = sym ? (sym.bounds || getEntityBounds(sym)) : b;
        const oldCx = ent.cx !== undefined ? ent.cx : (sb.minX + sb.maxX) / 2;
        const oldCy = ent.cy !== undefined ? ent.cy : (sb.minY + sb.maxY) / 2;
        const dx = newCx - oldCx;
        const dy = newCy - oldCy;

        ent.name = newName;
        ent.nodeType = newType;
        ent.radius = newR;
        ent.color = newColor;
        ent.textPos = newTextPos;
        ent.textColor = newTextColor;
        ent.cx = newCx;
        ent.cy = newCy;

        const newSymbols = createSymbolGeometry(newCx, newCy, newType, newR);
        newSymbols.forEach(s => { s.color = newColor; });

        const textW = newName.length * newH * 0.6;
        let tx = newCx - textW / 2;
        let ty = newCy - newR - newH - 4;
        if (newTextPos === 'top') {
          tx = newCx - textW / 2;
          ty = newCy + newR + 4;
        } else if (newTextPos === 'right') {
          tx = newCx + newR + 6;
          ty = newCy - newH / 2;
        } else if (newTextPos === 'left') {
          tx = newCx - newR - textW - 6;
          ty = newCy - newH / 2;
        } else if (newTextPos === 'center') {
          tx = newCx - textW / 2;
          ty = newCy - newH / 2;
        }

        const newText = {
          type: 'TEXT',
          text: newName,
          x: tx,
          y: ty,
          height: newH,
          color: newTextColor,
          layer: 'TEXTS'
        };

        ent.children = [...newSymbols, newText];

        // If position shifted, also move connected external lines
        if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
          const cls = getConnectedExternalLines(index);
          for (let i = 0; i < cls.length; i++) {
            const cl = cls[i];
            const line = dxfEntities[cl.entityIndex];
            if (cl.endpoint === 0) { line.x0 += dx; line.y0 += dy; }
            else { line.x1 += dx; line.y1 += dy; }
            delete line.bounds;
            getEntityBounds(line);
          }
        }
      }
    } else if (ent.type === 'LINE') {
      ent.x0 = parseFloat(document.getElementById('prop-x0').value) || ent.x0;
      ent.y0 = parseFloat(document.getElementById('prop-y0').value) || ent.y0;
      ent.x1 = parseFloat(document.getElementById('prop-x1').value) || ent.x1;
      ent.y1 = parseFloat(document.getElementById('prop-y1').value) || ent.y1;
      const colInput = document.getElementById('prop-color');
      if (colInput) ent.color = colInput.value;
    } else if (ent.type === 'TEXT') {
      ent.text   = document.getElementById('prop-text').value;
      ent.x      = parseFloat(document.getElementById('prop-x').value) || ent.x;
      ent.y      = parseFloat(document.getElementById('prop-y').value) || ent.y;
      ent.height = parseFloat(document.getElementById('prop-h').value) || ent.height;
      const colInput = document.getElementById('prop-color');
      if (colInput) ent.color = colInput.value;
    } else if (ent.type === 'LWPOLYLINE') {
      ent.closed = document.getElementById('prop-closed').checked;
      const colInput = document.getElementById('prop-color');
      if (colInput) ent.color = colInput.value;
    }
    delete ent.bounds;
    getEntityBounds(ent);
    buildSpatialGrid();
    drawViewports();
  });
}

// --- 文字/节点内联编辑器 ---
function showInlineTextEditor(screenX, screenY, index) {
  if (!inlineTextEditor || index < 0 || index >= dxfEntities.length) return;
  const ent = dxfEntities[index];
  let textChild = null;
  let initialText = '';

  if (ent.type === 'GROUP') {
    textChild = (ent.children || []).find(c => c.type === 'TEXT');
    initialText = textChild ? textChild.text : (ent.name || '');
  } else if (ent.type === 'TEXT') {
    initialText = ent.text || '';
  } else {
    return;
  }

  inlineTextEditor.value = initialText;
  inlineTextEditor.style.left = `${screenX}px`;
  inlineTextEditor.style.top  = `${screenY - 30}px`;
  inlineTextEditor.classList.remove('hidden');
  inlineTextEditor.focus();
  inlineTextEditor.select();

  const commitText = () => {
    if (inlineTextEditor.classList.contains('hidden')) return;
    const newText = inlineTextEditor.value.trim();
    if (!newText) {
      inlineTextEditor.classList.add('hidden');
      return;
    }
    pushUndoSnapshot();
    if (ent.type === 'GROUP') {
      ent.name = newText;
      if (textChild) {
        textChild.text = newText;
        const b = ent.bounds || getEntityBounds(ent);
        const cx = ent.cx !== undefined ? ent.cx : (b.minX + b.maxX) / 2;
        const cy = ent.cy !== undefined ? ent.cy : (b.minY + b.maxY) / 2;
        const textW = newText.length * (textChild.height || 10) * 0.6;
        textChild.x = cx - textW / 2;
        textChild.y = cy - 16;
      }
    } else if (ent.type === 'TEXT') {
      ent.text = newText;
    }
    inlineTextEditor.classList.add('hidden');
    delete ent.bounds;
    getEntityBounds(ent);
    buildSpatialGrid();
    showPropPanel(index);
    drawViewports();
  };
  inlineTextEditor.onblur  = commitText;
  inlineTextEditor.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitText(); }
    if (e.key === 'Escape') { inlineTextEditor.classList.add('hidden'); }
  };
}

// --- 右键上下文菜单控制函数 ---
function showContextMenu(screenX, screenY, index) {
  if (!contextMenu || index < 0 || index >= dxfEntities.length) return;
  contextMenuTargetIndex = index;
  const ent = dxfEntities[index];

  if (ent.type === 'GROUP') {
    const textChild = (ent.children || []).find(c => c.type === 'TEXT');
    const name = textChild ? textChild.text : (ent.name || '变电站');
    const nodeType = ent.nodeType || '110kV';
    if (ctxHeaderIcon) ctxHeaderIcon.textContent = '⚡';
    if (ctxHeaderName) ctxHeaderName.textContent = `${name} (${nodeType})`;
    if (ctxTypeWrapper) ctxTypeWrapper.style.display = 'block';
  } else if (ent.type === 'TEXT') {
    if (ctxHeaderIcon) ctxHeaderIcon.textContent = '🏷️';
    if (ctxHeaderName) ctxHeaderName.textContent = `文字: "${ent.text}"`;
    if (ctxTypeWrapper) ctxTypeWrapper.style.display = 'none';
  } else if (ent.type === 'LINE') {
    if (ctxHeaderIcon) ctxHeaderIcon.textContent = '📏';
    if (ctxHeaderName) ctxHeaderName.textContent = `直线 (${Math.hypot(ent.x1-ent.x0, ent.y1-ent.y0).toFixed(1)})`;
    if (ctxTypeWrapper) ctxTypeWrapper.style.display = 'none';
  } else {
    if (ctxHeaderIcon) ctxHeaderIcon.textContent = '📐';
    if (ctxHeaderName) ctxHeaderName.textContent = `${ent.type} 图元`;
    if (ctxTypeWrapper) ctxTypeWrapper.style.display = 'none';
  }

  const menuW = 200;
  const menuH = 220;
  const posX = Math.min(window.innerWidth - menuW - 10, Math.max(10, screenX));
  const posY = Math.min(window.innerHeight - menuH - 10, Math.max(10, screenY));

  contextMenu.style.left = `${posX}px`;
  contextMenu.style.top = `${posY}px`;
  contextMenu.classList.remove('hidden');
}

function hideContextMenu() {
  if (contextMenu) contextMenu.classList.add('hidden');
}

if (ctxBtnEditProp) {
  ctxBtnEditProp.addEventListener('click', () => {
    hideContextMenu();
    if (contextMenuTargetIndex >= 0) {
      showPropPanel(contextMenuTargetIndex);
      setTimeout(() => {
        const firstInput = propBody ? propBody.querySelector('input') : null;
        if (firstInput) { firstInput.focus(); firstInput.select(); }
      }, 50);
    }
  });
}

if (ctxBtnRename) {
  ctxBtnRename.addEventListener('click', () => {
    hideContextMenu();
    if (contextMenuTargetIndex >= 0) {
      const ent = dxfEntities[contextMenuTargetIndex];
      let screenPos = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
      if (ent.type === 'GROUP') {
        const textChild = (ent.children || []).find(c => c.type === 'TEXT');
        if (textChild) {
          const r = dxfCanvas.getBoundingClientRect();
          const sx = (textChild.x - dxfCenterX) * zoom + offsetX + r.width / 2 + r.left;
          const sy = -(textChild.y - dxfCenterY) * zoom + offsetY + r.height / 2 + r.top;
          screenPos = { x: sx, y: sy };
        }
      }
      showInlineTextEditor(screenPos.x, screenPos.y, contextMenuTargetIndex);
    }
  });
}

if (ctxBtnDrawLine) {
  ctxBtnDrawLine.addEventListener('click', () => {
    hideContextMenu();
    if (contextMenuTargetIndex >= 0) {
      const ent = dxfEntities[contextMenuTargetIndex];
      let startPt = { x: 0, y: 0 };
      if (ent.type === 'GROUP') {
        const b = ent.bounds || getEntityBounds(ent);
        startPt = { x: ent.cx !== undefined ? ent.cx : (b.minX + b.maxX) / 2, y: ent.cy !== undefined ? ent.cy : (b.minY + b.maxY) / 2 };
      } else if (ent.type === 'LINE') {
        startPt = { x: ent.x1, y: ent.y1 };
      } else {
        const b = ent.bounds || getEntityBounds(ent);
        startPt = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
      }
      setActiveTool('line');
      drawStartDxf = startPt;
      drawPreviewEnd = startPt;
      isDrawing = true;
      if (threeCadEngine) threeCadEngine.showSnapIndicator(startPt.x, startPt.y);
      drawViewports();
    }
  });
}

if (ctxTypeWrapper && typeof ctxTypeWrapper.querySelectorAll === 'function') {
  const typeBtns = ctxTypeWrapper.querySelectorAll('.context-submenu .context-menu-item');
  typeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const newType = btn.getAttribute('data-type');
      hideContextMenu();
      if (contextMenuTargetIndex >= 0 && newType) {
        const ent = dxfEntities[contextMenuTargetIndex];
        if (ent.type === 'GROUP') {
          pushUndoSnapshot();
          const b = ent.bounds || getEntityBounds(ent);
          const sym = (ent.children || []).find(c => c.type === 'LWPOLYLINE');
          const sb = sym ? (sym.bounds || getEntityBounds(sym)) : b;
          const cx = ent.cx !== undefined ? ent.cx : (sb.minX + sb.maxX) / 2;
          const cy = ent.cy !== undefined ? ent.cy : (sb.minY + sb.maxY) / 2;
          const textChild = (ent.children || []).find(c => c.type === 'TEXT');
          const name = textChild ? textChild.text : (ent.name || '变电站');
          const h = textChild ? (textChild.height || 10) : 10;
          const r = ent.radius !== undefined ? ent.radius : (newType === '220kV' ? 7.5 : newType === '500kV' ? 9.0 : newType === 'POINT' ? 3.5 : 6.0);
          const col = ent.color || (newType === '220kV' ? '#f97316' : newType === '500kV' ? '#a855f7' : newType === 'PLANT' ? '#eab308' : '#00f2fe');
          const textPos = ent.textPos || 'bottom';
          const textCol = ent.textColor || '#38bdf8';

          ent.nodeType = newType;
          ent.radius = r;
          ent.color = col;
          ent.textPos = textPos;
          ent.textColor = textCol;

          const newSymbols = createSymbolGeometry(cx, cy, newType, r);
          newSymbols.forEach(s => { s.color = col; });

          const textW = name.length * h * 0.6;
          let tx = cx - textW / 2;
          let ty = cy - r - h - 4;
          if (textPos === 'top') {
            tx = cx - textW / 2;
            ty = cy + r + 4;
          } else if (textPos === 'right') {
            tx = cx + r + 6;
            ty = cy - h / 2;
          } else if (textPos === 'left') {
            tx = cx - r - textW - 6;
            ty = cy - h / 2;
          } else if (textPos === 'center') {
            tx = cx - textW / 2;
            ty = cy - h / 2;
          }

          const newText = {
            type: 'TEXT',
            text: name,
            x: tx,
            y: ty,
            height: h,
            color: textCol,
            layer: 'TEXTS'
          };
          ent.children = [...newSymbols, newText];
          delete ent.bounds;
          getEntityBounds(ent);
          buildSpatialGrid();
          showPropPanel(contextMenuTargetIndex);
          drawViewports();
        }
      }
    });
  });
}

if (ctxBtnDelete) {
  ctxBtnDelete.addEventListener('click', () => {
    hideContextMenu();
    if (contextMenuTargetIndex >= 0) {
      selectedEntityIndex = contextMenuTargetIndex;
      deleteSelectedEntity();
    }
  });
}

document.addEventListener('click', (e) => {
  if (contextMenu && !contextMenu.contains(e.target)) {
    hideContextMenu();
  }
});

// --- DXF Canvas 编辑器鼠标事件覆盖 ---
// 原有的 [pdfCanvas, dxfCanvas].forEach 已经绑定了 pan/zoom，
// 我们在 dxfCanvas 上额外绑定编辑器事件（不移除原有 pan 事件）

if (dxfCanvas) {
  // 覆盖 mousedown：判断是编辑操作还是平移
  let editorMouseDown = false;
  let editorDragStarted = false;
  let editorDragThreshold = 4;
  let draggedConnectedLines = [];
  let dragOriginDxf = null;
  let dragTargetName = '';
  let initialConnectedLines = [];

  dxfCanvas.addEventListener('mousedown', (e) => {
    // 只有左键且有图元数据时进入编辑模式
    if (e.button !== 0 || dxfEntities.length === 0) return;
    if (currentTool === 'select') {
      const dxf = screenToDxf(e.clientX, e.clientY, dxfCanvas);

      // 优先检测节点拖动
      if (hoveredNode) {
        e.stopImmediatePropagation();
        isMovingNode = true;
        editorDragStarted = false;
        moveStartDxf = dxf;
        dragOriginDxf = { x: dxf.x, y: dxf.y };
        dragTargetName = '节点';
        draggedNodes = getConnectedNodes(hoveredNode.x, hoveredNode.y);
        draggedConnectedLines = [];
        initialConnectedLines = [];
        selectedEntityIndex = hoveredNode.entityIndex;
        showPropPanel(hoveredNode.entityIndex);
        drawViewports();
        return;
      }

      const hit = hitTest(dxf.x, dxf.y);
      if (hit >= 0) {
        // 命中图元 — 准备拖拽移动，阻止原有平移
        e.stopImmediatePropagation();
        selectedEntityIndex = hit;
        isMovingEntity = true;
        editorDragStarted = false;
        moveStartDxf = dxf;
        dragOriginDxf = { x: dxf.x, y: dxf.y };
        
        const targetEnt = dxfEntities[hit];
        if (targetEnt.type === 'GROUP' && targetEnt.children) {
          const textChild = targetEnt.children.find(c => c.type === 'TEXT');
          dragTargetName = textChild ? textChild.text : '组合图元';
        } else if (targetEnt.type === 'TEXT') {
          dragTargetName = targetEnt.text;
        } else {
          dragTargetName = '图元';
        }

        draggedConnectedLines = getConnectedExternalLines(hit);
        initialConnectedLines = draggedConnectedLines.map(cl => {
          const line = dxfEntities[cl.entityIndex];
          return {
            entityIndex: cl.entityIndex,
            initialLen: line ? Math.hypot(line.x1 - line.x0, line.y1 - line.y0) : 0
          };
        });
        
        if (e.shiftKey) {
           selectedEntities.add(hit);
        } else {
           selectedEntities.clear();
           selectedEntities.add(hit);
        }
        updateExportButtonVisibility();

        showPropPanel(hit);
        drawViewports();
      } else {
        // 未命中
        if (e.shiftKey) {
          // 按住 Shift 时在空白处拖拽，进入框选模式，阻止原有平移
          e.stopImmediatePropagation();
          isBoxSelecting = true;
          boxSelectStartScreen = { x: e.clientX, y: e.clientY };
          boxSelectCurrentScreen = { x: e.clientX, y: e.clientY };
        } else {
          // 未命中且没有 Shift — 取消选中，允许原有平移
          selectedEntityIndex = -1;
          selectedEntities.clear();
          updateExportButtonVisibility();
          if (propPanel) propPanel.classList.add('hidden');
          drawViewports();
        }
      }
    } else if (currentTool === 'node') {
      // 点击放置新节点
      e.stopImmediatePropagation();
      const dxf = screenToDxf(e.clientX, e.clientY, dxfCanvas);
      const snap = getSnapTarget(dxf.x, dxf.y);
      const posX = snap ? snap.x : dxf.x;
      const posY = snap ? snap.y : dxf.y;

      pushUndoSnapshot();
      const newNode = createNodeEntity(posX, posY, '新建变电站', '110kV');
      dxfEntities.push(newNode);
      buildSpatialGrid();

      selectedEntityIndex = dxfEntities.length - 1;
      setActiveTool('select');
      showPropPanel(selectedEntityIndex);
      drawViewports();
    } else if (currentTool === 'line' || currentTool === 'rect') {
      e.stopImmediatePropagation();
      const dxf = screenToDxf(e.clientX, e.clientY, dxfCanvas);
      if (!isDrawing) {
        isDrawing = true;
        const snap = (currentTool === 'line') ? getSnapTarget(dxf.x, dxf.y) : null;
        drawStartDxf = snap ? { x: snap.x, y: snap.y } : dxf;
        drawPreviewEnd = drawStartDxf;
      }
    }
  }, true); // 用捕获阶段，先于原有绑定

  // --- HIGH-PERFORMANCE DRAG MOUSEMOVE ---
  // Accumulate raw mouse deltas and flush once per animation frame
  let dragAccumX = 0, dragAccumY = 0;
  let dragRafPending = false;
  let lastDragClientX = 0, lastDragClientY = 0;

  dxfCanvas.addEventListener('mousemove', (e) => {
    if (isBoxSelecting) {
      e.stopImmediatePropagation();
      boxSelectCurrentScreen = { x: e.clientX, y: e.clientY };
      if (!dragRafPending) {
        dragRafPending = true;
        requestAnimationFrame(() => {
          dragRafPending = false;
          if (threeCadEngine) {
            const r = dxfCanvas.getBoundingClientRect();
            threeCadEngine.drawSelectionBox(
              { x: boxSelectStartScreen.x - r.left, y: boxSelectStartScreen.y - r.top },
              { x: boxSelectCurrentScreen.x - r.left, y: boxSelectCurrentScreen.y - r.top },
              threeCadEngine.camera, offsetX, offsetY, zoom, r.width, r.height, dxfCenterX, dxfCenterY
            );
            renderDxfCanvas();
          }
        });
      }
      return;
    }

    if (isMovingNode || (isMovingEntity && selectedEntities.size > 0)) {
      e.stopImmediatePropagation();
      // Only compute DXF coords and accumulate — defer mutations to RAF
      lastDragClientX = e.clientX;
      lastDragClientY = e.clientY;

      if (!dragRafPending) {
        dragRafPending = true;
        requestAnimationFrame(() => {
          dragRafPending = false;
          const dxf = screenToDxf(lastDragClientX, lastDragClientY, dxfCanvas);
          const dx = dxf.x - moveStartDxf.x;
          const dy = dxf.y - moveStartDxf.y;

          if (!editorDragStarted && (Math.abs(dx) > editorDragThreshold || Math.abs(dy) > editorDragThreshold)) {
            pushUndoSnapshot();
            editorDragStarted = true;
          }

          if (!editorDragStarted) return;

          if (isMovingNode) {
            // Apply node mutations
            const nodes = draggedNodes;
            for (let i = 0; i < nodes.length; i++) {
              const node = nodes[i];
              if (node.type === 'LINE') {
                if (node.nodeIndex === 0) { node.ent.x0 += dx; node.ent.y0 += dy; }
                else { node.ent.x1 += dx; node.ent.y1 += dy; }
              } else if (node.type === 'LWPOLYLINE') {
                node.ent.vertices[node.nodeIndex].x += dx;
                node.ent.vertices[node.nodeIndex].y += dy;
              }
            }
            if (hoveredNode) {
              hoveredNode.x += dx;
              hoveredNode.y += dy;
            }
          } else {
            // Entity drag
            const ent = dxfEntities[selectedEntityIndex];
            moveEntity(ent, dx, dy);

            // 联动拉伸连接的线条
            const cls = draggedConnectedLines;
            for (let i = 0; i < cls.length; i++) {
              const cl = cls[i];
              const line = dxfEntities[cl.entityIndex];
              if (cl.endpoint === 0) { line.x0 += dx; line.y0 += dy; }
              else { line.x1 += dx; line.y1 += dy; }
              if (line.bounds) {
                line.bounds.minX = Math.min(line.x0, line.x1);
                line.bounds.maxX = Math.max(line.x0, line.x1);
                line.bounds.minY = Math.min(line.y0, line.y1);
                line.bounds.maxY = Math.max(line.y0, line.y1);
              }
            }
          }

          moveStartDxf = dxf;
          isDrawScheduled = false;
          if (threeCadEngine) {
            threeCadEngine.buildDxfScene(dxfEntities);

            // Update WebGL Three.js Real-time Distance Annotations & Leader Line
            if (dragOriginDxf && typeof threeCadEngine.updateDragDimensions === 'function') {
              threeCadEngine.updateDragDimensions(dragOriginDxf, dxf, initialConnectedLines, dragTargetName);
            }
          }
          renderDxfCanvas();

          // Update DOM Real-time Distance HUD
          if (dragOriginDxf) {
            const totalDx = dxf.x - dragOriginDxf.x;
            const totalDy = dxf.y - dragOriginDxf.y;
            const totalDist = Math.hypot(totalDx, totalDy);

            const hud = document.getElementById('drag-hud');
            if (hud) {
              let linesHtml = '';
              if (initialConnectedLines && initialConnectedLines.length > 0) {
                linesHtml = `<div class="drag-hud-lines-title">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  相连线路实时长度 (${initialConnectedLines.length}条):
                </div>`;
                initialConnectedLines.forEach((cl, i) => {
                  const line = dxfEntities[cl.entityIndex];
                  if (!line) return;
                  const curLen = Math.hypot(line.x1 - line.x0, line.y1 - line.y0);
                  const delta = curLen - cl.initialLen;
                  const deltaClass = delta >= 0 ? '' : 'neg';
                  linesHtml += `
                    <div class="drag-hud-line-item">
                      <span>线路 ${i + 1}</span>
                      <span class="val">${curLen.toFixed(1)}</span>
                      <span class="delta ${deltaClass}">${delta >= 0 ? '+' : ''}${delta.toFixed(1)}</span>
                    </div>
                  `;
                });
              }

              hud.innerHTML = `
                <div class="drag-hud-header">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 3l14 9-7 2-3 7z"/></svg>
                  <span>${dragTargetName}</span>
                  <span class="drag-hud-badge">位移 Δ ${totalDist.toFixed(2)}</span>
                </div>
                <div class="drag-hud-row">
                  <span>dX: <b>${totalDx >= 0 ? '+' : ''}${totalDx.toFixed(2)}</b></span>
                  <span>dY: <b>${totalDy >= 0 ? '+' : ''}${totalDy.toFixed(2)}</b></span>
                </div>
                ${linesHtml}
              `;
              hud.style.left = `${lastDragClientX}px`;
              hud.style.top = `${lastDragClientY}px`;
              hud.classList.remove('hidden');
            }
          }
        });
      }
    } else if (isDrawing) {
      e.stopImmediatePropagation();
      const rawDxf = screenToDxf(e.clientX, e.clientY, dxfCanvas);
      if (currentTool === 'line') {
        const snap = getSnapTarget(rawDxf.x, rawDxf.y);
        drawPreviewEnd = snap ? { x: snap.x, y: snap.y } : rawDxf;
        if (threeCadEngine) {
          if (snap) threeCadEngine.showSnapIndicator(snap.x, snap.y);
          else threeCadEngine.hideSnapIndicator();
        }
      } else {
        drawPreviewEnd = rawDxf;
      }
      drawViewports(); // 触发橡皮筋预览重绘
    } else if ((currentTool === 'line' || currentTool === 'node') && e.buttons === 0) {
      // 移动时展示吸附指示器
      const rawDxf = screenToDxf(e.clientX, e.clientY, dxfCanvas);
      const snap = getSnapTarget(rawDxf.x, rawDxf.y);
      if (threeCadEngine) {
        if (snap) threeCadEngine.showSnapIndicator(snap.x, snap.y);
        else threeCadEngine.hideSnapIndicator();
        threeCadEngine.render();
      }
    } else if (currentTool === 'select' && e.buttons === 0) {
      if (threeCadEngine) threeCadEngine.hideSnapIndicator();
      if (!hoverRafPending) {
        hoverRafPending = true;
        const clientX = e.clientX;
        const clientY = e.clientY;
        requestAnimationFrame(() => {
          hoverRafPending = false;
          const dxf = screenToDxf(clientX, clientY, dxfCanvas);
          const hitNode = hitTestNode(dxf.x, dxf.y);
          let needsRedraw = false;

          if (hitNode) {
            if (!hoveredNode || hoveredNode.entityIndex !== hitNode.entityIndex || hoveredNode.nodeIndex !== hitNode.nodeIndex) {
              hoveredNode = hitNode;
              hoveredEntityIndex = -1;
              dxfCanvas.style.cursor = 'crosshair';
              needsRedraw = true;
            }
          } else {
            if (hoveredNode) {
              hoveredNode = null;
              needsRedraw = true;
            }
            const hitIndex = hitTest(dxf.x, dxf.y);
            if (hitIndex !== hoveredEntityIndex) {
              hoveredEntityIndex = hitIndex;
              dxfCanvas.style.cursor = hoveredEntityIndex >= 0 ? 'move' : 'default';
              needsRedraw = true;
            }
          }

          if (needsRedraw) drawViewports();
        });
      }
    }
  }, true);

  dxfCanvas.addEventListener('mouseup', (e) => {
    if (isBoxSelecting) {
      e.stopImmediatePropagation();
      isBoxSelecting = false;
      if (threeCadEngine) {
        threeCadEngine.hideSelectionBox();
      }
      
      const r = dxfCanvas.getBoundingClientRect();
      const sDxf = screenToDxf(boxSelectStartScreen.x, boxSelectStartScreen.y, dxfCanvas);
      const cDxf = screenToDxf(boxSelectCurrentScreen.x, boxSelectCurrentScreen.y, dxfCanvas);
      
      const minX = Math.min(sDxf.x, cDxf.x);
      const maxX = Math.max(sDxf.x, cDxf.x);
      const minY = Math.min(sDxf.y, cDxf.y);
      const maxY = Math.max(sDxf.y, cDxf.y);
      
      const bounds = { minX, maxX, minY, maxY };
      
      // Select all entities in bounding box
      const hits = _spatialGrid.queryBounds(bounds, 0);
      if (!e.shiftKey) {
        selectedEntities.clear();
      }
      for (const hit of hits) {
        // filter out points inside if we only want nodes or lines, but for now just select all returned
        const ent = dxfEntities[hit];
        if (ent && ent.bounds && ent.bounds.minX >= minX && ent.bounds.maxX <= maxX && ent.bounds.minY >= minY && ent.bounds.maxY <= maxY) {
          selectedEntities.add(hit);
        } else if (ent && (ent.type === 'GROUP' || ent.type === 'TEXT')) {
           // For group/text, if its center is inside, select it (allow partial overlap for nodes)
           const cx = ent.x !== undefined ? ent.x : (ent.bounds ? (ent.bounds.minX + ent.bounds.maxX) / 2 : undefined);
           const cy = ent.y !== undefined ? ent.y : (ent.bounds ? (ent.bounds.minY + ent.bounds.maxY) / 2 : undefined);
           if (cx !== undefined && cy !== undefined && cx >= minX && cx <= maxX && cy >= minY && cy <= maxY) {
               selectedEntities.add(hit);
           }
        }
      }
      
      updateExportButtonVisibility();
      drawViewports();
      return;
    }

    if (threeCadEngine) {
      threeCadEngine.hideSnapIndicator();
    }

    if (isMovingNode || isMovingEntity) {
      if (threeCadEngine && typeof threeCadEngine.hideDragDimensions === 'function') {
        threeCadEngine.hideDragDimensions();
      }
      const hud = document.getElementById('drag-hud');
      if (hud) hud.classList.add('hidden');
      dragOriginDxf = null;
      initialConnectedLines = [];
    }

    if (isMovingNode) {
      isMovingNode = false;
      editorDragStarted = false;
      draggedNodes = [];
      _invalidateDragCache();
      buildSpatialGrid();
      if (selectedEntityIndex >= 0) showPropPanel(selectedEntityIndex);
      drawViewports();
    }
    if (isMovingEntity) {
      isMovingEntity = false;
      editorDragStarted = false;
      _invalidateDragCache();
      buildSpatialGrid();
      if (selectedEntityIndex >= 0) showPropPanel(selectedEntityIndex);
      drawViewports();
    }
    if (isDrawing && (currentTool === 'line' || currentTool === 'rect')) {
      e.stopImmediatePropagation();
      const dxf = screenToDxf(e.clientX, e.clientY, dxfCanvas);
      commitDrawing(dxf);
    }
  }, true);

  // 双击图元/节点 → 内联重命名
  dxfCanvas.addEventListener('dblclick', (e) => {
    if (currentTool !== 'select') return;
    const dxf = screenToDxf(e.clientX, e.clientY, dxfCanvas);
    const hit = hitTest(dxf.x, dxf.y);
    if (hit >= 0 && (dxfEntities[hit].type === 'TEXT' || dxfEntities[hit].type === 'GROUP')) {
      e.stopImmediatePropagation();
      selectedEntityIndex = hit;
      showInlineTextEditor(e.clientX, e.clientY, hit);
    }
  });

  // 右键点击图元/节点 → 上下文快捷编辑菜单
  dxfCanvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();

    const dxf = screenToDxf(e.clientX, e.clientY, dxfCanvas);
    const hit = hitTest(dxf.x, dxf.y);

    if (hit >= 0) {
      selectedEntityIndex = hit;
      showContextMenu(e.clientX, e.clientY, hit);
      showPropPanel(hit);
      drawViewports();
    } else {
      hideContextMenu();
    }
  });

  // 画布点击（用于快速取消选中）
  dxfCanvas.addEventListener('click', (e) => {
    hideContextMenu();
    if (currentTool !== 'select') return;
    if (editorDragStarted) return;
    const dxf = screenToDxf(e.clientX, e.clientY, dxfCanvas);
    const hit = hitTest(dxf.x, dxf.y);
    if (hit < 0 && !hoveredNode) {
      selectedEntityIndex = -1;
      if (propPanel) propPanel.classList.add('hidden');
      drawViewports();
    }
  });
}

function moveEntity(entity, dx, dy) {
  if (entity.type === 'LINE') {
    entity.x0 += dx; entity.y0 += dy;
    entity.x1 += dx; entity.y1 += dy;
  } else if (entity.type === 'LWPOLYLINE') {
    const verts = entity.vertices;
    for (let i = 0; i < verts.length; i++) {
      verts[i].x += dx; verts[i].y += dy;
    }
  } else if (entity.type === 'TEXT') {
    entity.x += dx; entity.y += dy;
  } else if (entity.type === 'GROUP') {
    const children = entity.children || [];
    for (let i = 0; i < children.length; i++) {
      moveEntity(children[i], dx, dy);
    }
  }
  if (entity.bounds) {
    entity.bounds.minX += dx; entity.bounds.maxX += dx;
    entity.bounds.minY += dy; entity.bounds.maxY += dy;
  }
}

// 提交绘制操作（抬起鼠标时）
function commitDrawing(endDxf) {
  const sx = drawStartDxf.x, sy = drawStartDxf.y;
  let ex = endDxf.x, ey = endDxf.y;

  if (currentTool === 'line') {
    const snap = getSnapTarget(ex, ey);
    if (snap) {
      ex = snap.x;
      ey = snap.y;
    }
  }

  if (threeCadEngine) {
    threeCadEngine.hideSnapIndicator();
  }

  const minDist = 2 / zoom;

  if (Math.hypot(ex - sx, ey - sy) < minDist) {
    isDrawing = false;
    drawViewports();
    return;
  }

  pushUndoSnapshot();

  let newEnt = null;
  if (currentTool === 'line') {
    newEnt = { type: 'LINE', x0: sx, y0: sy, x1: ex, y1: ey, layer: 'LINES' };
  } else if (currentTool === 'rect') {
    newEnt = {
      type: 'LWPOLYLINE',
      vertices: [{ x: sx, y: sy }, { x: ex, y: sy }, { x: ex, y: ey }, { x: sx, y: ey }],
      closed: true,
      layer: 'RECTS'
    };
  }

  if (newEnt) {
    newEnt.bounds = getEntityBounds(newEnt);
    dxfEntities.push(newEnt);
    buildSpatialGrid();
  }

  selectedEntityIndex = dxfEntities.length - 1;
  isDrawing = false;
  showPropPanel(selectedEntityIndex);
  drawViewports();
}

// --- 编辑器覆盖层：选中高亮 + 橡皮筋预览（由 renderDxfCanvas 末尾调用）---
function renderEditorOverlay() {
  if (!dxfCanvas) return;
  if (selectedEntityIndex < 0 && !hoveredNode && !isMovingNode && !isDrawing) return;

  const ctx = getDxfCtx();
  if (!ctx) return;
  const dpr  = window.devicePixelRatio || 1;
  const viewW = dxfRect.width;
  const viewH = dxfRect.height;

  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.translate(offsetX, offsetY);
  ctx.scale(zoom, zoom);
  ctx.translate(viewW / 2, viewH / 2);
  ctx.scale(1, -1);
  ctx.translate(-dxfCenterX, -dxfCenterY);

  const drawEntityOutline = (ent) => {
    if (ent.type === 'LINE') {
      ctx.beginPath();
      ctx.moveTo(ent.x0, ent.y0);
      ctx.lineTo(ent.x1, ent.y1);
      ctx.stroke();
    } else if (ent.type === 'LWPOLYLINE' && ent.vertices.length > 0) {
      ctx.beginPath();
      const verts = ent.vertices;
      ctx.moveTo(verts[0].x, verts[0].y);
      for (let vi = 1; vi < verts.length; vi++) {
        ctx.lineTo(verts[vi].x, verts[vi].y);
      }
      if (ent.closed) ctx.closePath();
      ctx.stroke();
    } else if (ent.type === 'TEXT') {
      ctx.save();
      ctx.translate(ent.x, ent.y);
      ctx.scale(1, -1);
      
      let tw = (ent.text ? ent.text.length : 4) * (ent.height || 12) * 0.6;
      if (ent.text) {
        ctx.font = `${ent.height || 12}px 'Outfit', sans-serif`;
        tw = ctx.measureText(ent.text).width;
      }
      
      const th = (ent.height || 12) * 1.3;
      ctx.strokeRect(-2, -th, tw + 4, th + 4);
      ctx.restore();
    }
  };

  // 1. 绘制选中高亮 (亮黄色虚线 + 端点)
  if (selectedEntityIndex >= 0 && selectedEntityIndex < dxfEntities.length) {
    const ent = dxfEntities[selectedEntityIndex];
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth   = 2.5 / zoom;
    ctx.setLineDash([6 / zoom, 3 / zoom]);
    
    drawEntityOutline(ent);

    // 选中状态额外绘制线段端点小圆
    if (ent.type === 'LINE') {
      ctx.setLineDash([]);
      ctx.fillStyle = '#facc15';
      [{ x: ent.x0, y: ent.y0 }, { x: ent.x1, y: ent.y1 }].forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3 / zoom, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }

  // 1.5 绘制悬停或拖拽节点提示 (天蓝色小圆圈)
  if (hoveredNode || isMovingNode) {
    const renderNode = hoveredNode; 
    if (renderNode) {
      ctx.setLineDash([]);
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.5 / zoom;
      ctx.fillStyle = 'rgba(56, 189, 248, 0.4)'; // 半透明天蓝色
      ctx.beginPath();
      ctx.arc(renderNode.x, renderNode.y, 4 / zoom, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  // 2. 绘制橡皮筋预览（绘制工具激活时）
  if (isDrawing) {
    ctx.setLineDash([5 / zoom, 3 / zoom]);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth   = 1.5 / zoom;

    if (currentTool === 'line') {
      ctx.beginPath();
      ctx.moveTo(drawStartDxf.x, drawStartDxf.y);
      ctx.lineTo(drawPreviewEnd.x, drawPreviewEnd.y);
      ctx.stroke();
    } else if (currentTool === 'rect') {
      const sx = drawStartDxf.x, sy = drawStartDxf.y;
      const ex = drawPreviewEnd.x, ey = drawPreviewEnd.y;
      ctx.beginPath();
      ctx.moveTo(sx, sy); ctx.lineTo(ex, sy);
      ctx.lineTo(ex, ey); ctx.lineTo(sx, ey);
      ctx.closePath();
      ctx.stroke();
    }
  }

  ctx.restore();
}

// --- DXF 序列化导出 ---
function serializeDxfToText(entities) {
  // 写入标准 DXF R2004 兼容格式（支持真彩色 420 码）
  const lines = [];

  // HEADER 节（最小化）
  lines.push('0', 'SECTION', '2', 'HEADER');
  lines.push('9', '$ACADVER', '1', 'AC1018');
  lines.push('0', 'ENDSEC');

  // TABLES 节（图层定义）
  lines.push('0', 'SECTION', '2', 'TABLES');
  lines.push('0', 'TABLE', '2', 'LAYER', '70', '5');
  const layerDefs = [
    { name: 'LINES',     color: 7 },
    { name: 'RECTS',     color: 7 },
    { name: 'TEXTS',     color: 3 },
    { name: 'POLYLINES', color: 4 },
    { name: 'SYMBOLS',   color: 4 },
  ];
  layerDefs.forEach(l => {
    lines.push('0', 'LAYER', '2', l.name, '70', '0', '62', String(l.color), '6', 'Continuous');
  });
  lines.push('0', 'ENDTAB');
  lines.push('0', 'ENDSEC');

  // ENTITIES 节
  lines.push('0', 'SECTION', '2', 'ENTITIES');

  function hexToTrueColor(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    return m ? parseInt(m[1], 16) : null;
  }

  function writeEntity(ent) {
    if (!ent) return;
    if (ent.type === 'GROUP' && ent.children) {
      ent.children.forEach(writeEntity);
      return;
    }
    const colorInt = (typeof ent.color === 'string') ? hexToTrueColor(ent.color) : null;

    if (ent.type === 'LINE') {
      lines.push('0', 'LINE');
      lines.push('8', ent.layer || 'LINES');
      if (colorInt !== null) lines.push('420', String(colorInt));
      lines.push('10', ent.x0.toFixed(6));
      lines.push('20', ent.y0.toFixed(6));
      lines.push('30', '0.0');
      lines.push('11', ent.x1.toFixed(6));
      lines.push('21', ent.y1.toFixed(6));
      lines.push('31', '0.0');
    } else if (ent.type === 'LWPOLYLINE') {
      lines.push('0', 'LWPOLYLINE');
      lines.push('8', ent.layer || 'RECTS');
      if (colorInt !== null) lines.push('420', String(colorInt));
      lines.push('90', String(ent.vertices.length));
      lines.push('70', ent.closed ? '1' : '0');
      ent.vertices.forEach(v => {
        lines.push('10', v.x.toFixed(6));
        lines.push('20', v.y.toFixed(6));
      });
    } else if (ent.type === 'TEXT') {
      lines.push('0', 'TEXT');
      lines.push('8', ent.layer || 'TEXTS');
      if (colorInt !== null) lines.push('420', String(colorInt));
      lines.push('10', ent.x.toFixed(6));
      lines.push('20', ent.y.toFixed(6));
      lines.push('30', '0.0');
      lines.push('40', (ent.height || 10).toFixed(6));
      lines.push('1', ent.text || '');
    }
  }

  entities.forEach(writeEntity);
  lines.push('0', 'ENDSEC');
  lines.push('0', 'EOF');

  return lines.join('\r\n');
}

// --- 导出按钮 ---
if (btnExportEdited) {
  btnExportEdited.addEventListener('click', async () => {
    if (dxfEntities.length === 0) {
      customAlert('没有可导出的图元。');
      return;
    }

    // 弹出另存为对话框
    const savePath = await window.api.showSaveDialog(currentDxfPath || '');
    if (!savePath) return;

    const dxfText = serializeDxfToText(dxfEntities);
    const result  = await window.api.saveTextFile(savePath, dxfText);

    if (result && result.status === 'success') {
      isDirty = false;
      updateDirtyIndicator();
      if (editorStatusTip) editorStatusTip.textContent = `✔ 已导出到: ${savePath.split(/[\\/]/).pop()}`;
      setTimeout(() => updateDirtyIndicator(), 3000);
    } else {
      alert('导出失败：' + (result ? result.message : '未知错误'));
    }
  });
}

// ====== 第三方平台对接 ======

// 全局 token 存储
let platformToken = null;

// 初始化时自动登录
(async function initPlatform() {
  try {
    const res = await window.api.platformLogin();
    if (res && res.success && res.token) {
      platformToken = res.token;
      console.log('[平台] 初始化登录成功，token:', res.token.substring(0, 20) + '...');
    } else {
      console.warn('[平台] 初始化登录失败:', res?.error || '未知错误');
    }
  } catch (err) {
    console.warn('[平台] 初始化登录异常（应用继续运行）:', err.message);
  }
})();

// 平台测试按钮：登录 + 调用拓扑列表接口验证 token 传递
const btnPlatformTest = document.getElementById('btn-platform-test');
const platformTestModal = document.getElementById('platform-test-modal');
const platformTestContent = document.getElementById('platform-test-content');
const btnClosePlatformTest = document.getElementById('btn-close-platform-test');

function openPlatformTestModal() {
  if (platformTestModal) platformTestModal.classList.remove('hidden');
}

if (btnClosePlatformTest) {
  btnClosePlatformTest.addEventListener('click', () => {
    platformTestModal.classList.add('hidden');
  });
}

if (platformTestModal) {
  platformTestModal.addEventListener('click', (e) => {
    if (e.target === platformTestModal) platformTestModal.classList.add('hidden');
  });
}

function renderPlatformTestResult({ loginRes, toposRes }) {
  if (!platformTestContent) return;

  const ok = loginRes.success;
  let html = '';

  // --- 登录结果 ---
  html += `
    <div class="pt-section">
      <div class="pt-section-title">1. 登录接口 POST /v1/SignLogin</div>
      ${ok ? `
        <div class="pt-status pt-status-ok">✔ 登录成功</div>
        <div class="pt-kv"><span class="pt-k">用户</span><span class="pt-v">${loginRes.data.user.realname} (${loginRes.data.user.name})</span></div>
        <div class="pt-kv"><span class="pt-k">Token</span><span class="pt-v pt-mono">${loginRes.token.substring(0, 24)}...</span></div>
      ` : `
        <div class="pt-status pt-status-err">✘ 登录失败：${loginRes.error || '未知错误'}</div>
      `}
    </div>
  `;

  // --- 拓扑列表结果 ---
  if (ok) {
    html += `
      <div class="pt-section">
        <div class="pt-section-title">2. 拓扑列表接口 GET /v1/topology/topos/ (携带 Cookie token)</div>
    `;
    if (toposRes && toposRes.success) {
      const d = toposRes.data;
      const items = (d && d.data && d.data.items) || [];
      const count = (d && d.data && d.data.count) || items.length;
      html += `<div class="pt-status pt-status-ok">✔ 调用成功，共 ${count} 条拓扑</div>`;
      if (items.length > 0) {
        html += `<div class="pt-list">`;
        items.slice(0, 10).forEach((it, i) => {
          html += `<div class="pt-list-item"><span>${i + 1}. ${it.name}</span><span class="pt-mono">id=${it.id} type=${it.type}</span></div>`;
        });
        if (items.length > 10) html += `<div class="pt-list-item pt-more">... 其余 ${items.length - 10} 条略</div>`;
        html += `</div>`;
      }
    } else {
      html += `<div class="pt-status pt-status-err">✘ 接口调用失败：${(toposRes && toposRes.error) || '未知错误'}</div>`;
    }
    html += `</div>`;
  }

  platformTestContent.innerHTML = html;
  openPlatformTestModal();
}

if (btnPlatformTest) {
  btnPlatformTest.addEventListener('click', async () => {
    btnPlatformTest.classList.add('loading');
    btnPlatformTest.disabled = true;
    const originalHtml = btnPlatformTest.innerHTML;
    btnPlatformTest.innerHTML = '<span class="spinner"></span>测试中...';

    let loginRes = null;
    let toposRes = null;

    // 1. 若无 token 或已过期，重新登录
    if (!platformToken) {
      btnPlatformTest.innerHTML = '<span class="spinner"></span>登录中...';
      loginRes = await window.api.platformLogin();
      if (loginRes && loginRes.success && loginRes.token) {
        platformToken = loginRes.token;
      }
    } else {
      loginRes = { success: true, token: platformToken, data: { user: { realname: '已缓存', name: '已缓存' } } };
    }

    // 2. 登录成功后调用业务接口验证 token 传递
    if (platformToken) {
      btnPlatformTest.innerHTML = '<span class="spinner"></span>拉取拓扑列表...';
      toposRes = await window.api.platformRequest({
        url: '/topology/topos/',
        method: 'GET',
        token: platformToken,
      });
      // 若返回会话过期，重登一次再试
      if (toposRes && toposRes.success && toposRes.data && toposRes.data.code !== 0) {
        loginRes = await window.api.platformLogin();
        if (loginRes && loginRes.success && loginRes.token) {
          platformToken = loginRes.token;
          toposRes = await window.api.platformRequest({
            url: '/topology/topos/',
            method: 'GET',
            token: platformToken,
          });
        }
      }
    }

    // 3. 渲染结果弹窗
    renderPlatformTestResult({
      loginRes: loginRes || { success: false, error: '未调用' },
      toposRes,
    });

    btnPlatformTest.innerHTML = originalHtml;
    btnPlatformTest.classList.remove('loading');
    btnPlatformTest.disabled = false;
  });
}
