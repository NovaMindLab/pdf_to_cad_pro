import * as THREE from './assets/three.module.js';

const layerColorMap = {
  'LINES': '#f3f4f6',
  'RECTS': '#d1d5db',
  'POLYLINES': '#00f2fe',
  'CIRCLES': '#38bdf8',
  'ARCS': '#a855f7',
  'TEXTS': '#10b981',
  'SYMBOLS': '#f59e0b',
  '0': '#e2e8f0'
};

const ACI_TO_HEX = {
  1: '#ff0000',
  2: '#ffff00',
  3: '#00ff00',
  4: '#00ffff',
  5: '#0000ff',
  6: '#ff00ff',
  7: '#ffffff',
  8: '#808080',
  9: '#c0c0c0'
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

    this.layerMeshes = {};
    const segmentsByLayerColor = {};
    const textEntities = [];

    const addEntitySegments = (ent, parentColor = null, parentLayer = null) => {
      if (!ent) return;
      const layer = ent.layer || parentLayer || '0';
      const color = ent.color || parentColor || (layerColorMap[layer] || '#ffffff');
      if (!segmentsByLayerColor[layer]) segmentsByLayerColor[layer] = {};
      if (!segmentsByLayerColor[layer][color]) segmentsByLayerColor[layer][color] = [];
      const segs = segmentsByLayerColor[layer][color];

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
      } else if (ent.type === 'CIRCLE') {
        const segments = Math.max(16, Math.min(64, Math.round(ent.r * 2)));
        for (let s = 0; s < segments; s++) {
          const a0 = (s / segments) * Math.PI * 2;
          const a1 = ((s + 1) / segments) * Math.PI * 2;
          segs.push(
            ent.cx + Math.cos(a0) * ent.r, ent.cy + Math.sin(a0) * ent.r, 0,
            ent.cx + Math.cos(a1) * ent.r, ent.cy + Math.sin(a1) * ent.r, 0
          );
        }
      } else if (ent.type === 'ARC') {
        const sRad = ((ent.startAngle || 0) * Math.PI) / 180;
        let eRad = ((ent.endAngle || 360) * Math.PI) / 180;
        if (eRad <= sRad) eRad += Math.PI * 2;
        const arcAngle = eRad - sRad;
        const segments = Math.max(8, Math.min(48, Math.round(ent.r * arcAngle)));
        for (let s = 0; s < segments; s++) {
          const a0 = sRad + (s / segments) * arcAngle;
          const a1 = sRad + ((s + 1) / segments) * arcAngle;
          segs.push(
            ent.cx + Math.cos(a0) * ent.r, ent.cy + Math.sin(a0) * ent.r, 0,
            ent.cx + Math.cos(a1) * ent.r, ent.cy + Math.sin(a1) * ent.r, 0
          );
        }
      } else if (ent.type === 'TEXT' || ent.type === 'MTEXT') {
        textEntities.push(ent);
      } else if (ent.type === 'GROUP' && ent.children) {
        for (let i = 0; i < ent.children.length; i++) {
          addEntitySegments(ent.children[i], ent.color || parentColor, layer);
        }
      }
    };

    for (let i = 0; i < entities.length; i++) {
      addEntitySegments(entities[i]);
    }

    // 2. Create GPU BufferGeometries for line segments grouped by layer & color
    for (const layer in segmentsByLayerColor) {
      this.layerMeshes[layer] = [];
      for (const colorHex in segmentsByLayerColor[layer]) {
        const segs = segmentsByLayerColor[layer][colorHex];
        if (segs.length === 0) continue;

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
        
        const material = new THREE.LineBasicMaterial({
          color: new THREE.Color(colorHex),
          linewidth: 1
        });

        const lineSegments = new THREE.LineSegments(geometry, material);
        lineSegments.userData = { layer };
        this.dxfGroup.add(lineSegments);
        this.layerMeshes[layer].push(lineSegments);
      }
    }

    // 3. Build Text Sprites / Planes with high sharpness and optional rotation
    for (let i = 0; i < textEntities.length; i++) {
      const t = textEntities[i];
      if (!t.text) continue;
      const sprite = this.createTextMesh(t);
      if (sprite) {
        sprite.userData = { layer: t.layer || 'TEXTS' };
        this.textGroup.add(sprite);
      }
    }

    if (typeof updateLayerControlUI === 'function') {
      updateLayerControlUI(entities);
    }
  }

  setLayerVisibility(layerName, isVisible) {
    if (this.layerMeshes && this.layerMeshes[layerName]) {
      this.layerMeshes[layerName].forEach(m => { m.visible = isVisible; });
    }
    if (this.textGroup) {
      this.textGroup.children.forEach(m => {
        if ((m.userData && m.userData.layer) === layerName) {
          m.visible = isVisible;
        }
      });
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
    // Apply DXF width factor (group code 41) so compressed text stays compressed
    const widthFactor = (t.widthFactor && t.widthFactor > 0.05 && t.widthFactor < 20) ? t.widthFactor : 1;
    const worldW = worldH * aspect * widthFactor;

    const planeGeo = new THREE.PlaneGeometry(worldW, worldH);
    const planeMat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false
    });

    const mesh = new THREE.Mesh(planeGeo, planeMat);
    const rotDeg = t.rotation || 0;
    if (rotDeg !== 0) {
      const rotRad = (rotDeg * Math.PI) / 180;
      mesh.rotation.z = rotRad;
      const cosA = Math.cos(rotRad);
      const sinA = Math.sin(rotRad);
      const cx = (worldW / 2) * cosA - (worldH / 2) * sinA;
      const cy = (worldW / 2) * sinA + (worldH / 2) * cosA;
      mesh.position.set(t.x + cx, t.y + cy, 0.5);
    } else {
      mesh.position.set(t.x + worldW / 2, t.y + worldH / 2, 0.5);
    }
    mesh.userData = { layer: t.layer || 'TEXTS' };
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
    } else if (ent.type === 'CIRCLE') {
      const segCount = 48;
      const r = ent.r || ent.radius || 0;
      const cx = ent.cx !== undefined ? ent.cx : ent.x || 0;
      const cy = ent.cy !== undefined ? ent.cy : ent.y || 0;
      for (let i = 0; i < segCount; i++) {
        const a1 = (i / segCount) * Math.PI * 2;
        const a2 = ((i + 1) / segCount) * Math.PI * 2;
        segs.push(
          cx + r * Math.cos(a1), cy + r * Math.sin(a1), 1,
          cx + r * Math.cos(a2), cy + r * Math.sin(a2), 1
        );
      }
      if (grips) {
        grips.push(cx, cy, 2);
        grips.push(cx + r, cy, 2);
        grips.push(cx - r, cy, 2);
        grips.push(cx, cy + r, 2);
        grips.push(cx, cy - r, 2);
      }
    } else if (ent.type === 'ARC') {
      const r = ent.r || ent.radius || 0;
      const cx = ent.cx !== undefined ? ent.cx : ent.x || 0;
      const cy = ent.cy !== undefined ? ent.cy : ent.y || 0;
      let startAng = ((ent.startAngle || 0) * Math.PI) / 180;
      let endAng = ((ent.endAngle || 360) * Math.PI) / 180;
      if (endAng <= startAng) endAng += Math.PI * 2;
      const arcLen = endAng - startAng;
      const segCount = Math.max(8, Math.round(32 * (arcLen / (Math.PI * 2))));
      for (let i = 0; i < segCount; i++) {
        const a1 = startAng + (i / segCount) * arcLen;
        const a2 = startAng + ((i + 1) / segCount) * arcLen;
        segs.push(
          cx + r * Math.cos(a1), cy + r * Math.sin(a1), 1,
          cx + r * Math.cos(a2), cy + r * Math.sin(a2), 1
        );
      }
      if (grips) {
        grips.push(cx, cy, 2);
        grips.push(cx + r * Math.cos(startAng), cy + r * Math.sin(startAng), 2);
        grips.push(cx + r * Math.cos(endAng), cy + r * Math.sin(endAng), 2);
        const midAng = (startAng + endAng) / 2;
        grips.push(cx + r * Math.cos(midAng), cy + r * Math.sin(midAng), 2);
      }
    } else if (ent.type === 'TEXT' || ent.type === 'MTEXT') {
      const tw = ent.tw || 20;
      const th = ent.th || 10;
      const rot = ((ent.rotation || 0) * Math.PI) / 180;
      if (Math.abs(rot) > 1e-4) {
        const cos = Math.cos(rot);
        const sin = Math.sin(rot);
        const p0x = ent.x, p0y = ent.y;
        const p1x = ent.x + tw * cos, p1y = ent.y + tw * sin;
        const p2x = ent.x + tw * cos - th * sin, p2y = ent.y + tw * sin + th * cos;
        const p3x = ent.x - th * sin, p3y = ent.y + th * cos;
        segs.push(
          p0x, p0y, 1, p1x, p1y, 1,
          p1x, p1y, 1, p2x, p2y, 1,
          p2x, p2y, 1, p3x, p3y, 1,
          p3x, p3y, 1, p0x, p0y, 1
        );
      } else {
        segs.push(
          ent.x, ent.y, 1, ent.x + tw, ent.y, 1,
          ent.x + tw, ent.y, 1, ent.x + tw, ent.y + th, 1,
          ent.x + tw, ent.y + th, 1, ent.x, ent.y + th, 1,
          ent.x, ent.y + th, 1, ent.x, ent.y, 1
        );
      }
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

function updateLayerControlUI(entities) {
  const panel = document.getElementById('layer-control-panel');
  const toggle = document.getElementById('layer-control-toggle');
  const badge = document.getElementById('layer-count-badge');
  const list = document.getElementById('layer-control-list');
  if (!panel || !list) return;

  if (toggle && !toggle._bound) {
    toggle.addEventListener('click', () => {
      panel.classList.toggle('collapsed');
    });
    toggle._bound = true;
  }

  const layerCounts = {};
  function walk(ent) {
    if (!ent) return;
    if (ent.type === 'GROUP' && ent.children) {
      ent.children.forEach(walk);
      return;
    }
    const l = ent.layer || 'LINES';
    layerCounts[l] = (layerCounts[l] || 0) + 1;
  }
  (entities || []).forEach(walk);

  const layers = Object.keys(layerCounts).sort();
  if (badge) badge.textContent = String(layers.length);

  if (layers.length === 0) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = 'block';

  list.innerHTML = '';
  layers.forEach(layer => {
    const color = layerColorMap[layer] || '#38bdf8';
    const count = layerCounts[layer];

    const item = document.createElement('div');
    item.className = 'layer-item';

    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = true;
    chk.id = `layer-chk-${layer}`;

    const dot = document.createElement('span');
    dot.className = 'layer-color-dot';
    dot.style.backgroundColor = color;

    const nameSpan = document.createElement('span');
    nameSpan.className = 'layer-name';
    nameSpan.title = layer;
    nameSpan.textContent = layer;

    const countSpan = document.createElement('span');
    countSpan.className = 'layer-item-count';
    countSpan.style.fontSize = '10px';
    countSpan.style.color = '#94a3b8';
    countSpan.textContent = count;

    item.appendChild(chk);
    item.appendChild(dot);
    item.appendChild(nameSpan);
    item.appendChild(countSpan);

    chk.addEventListener('change', (e) => {
      e.stopPropagation();
      if (threeCadEngine) {
        threeCadEngine.setLayerVisibility(layer, chk.checked);
        threeCadEngine.render();
      }
    });

    item.addEventListener('click', (e) => {
      if (e.target !== chk) {
        chk.checked = !chk.checked;
        chk.dispatchEvent(new Event('change'));
      }
    });

    list.appendChild(item);
  });
}

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
const btnSaveCloud = document.getElementById('btn-save-cloud');
const btnErrorReset = document.getElementById('btn-error-reset');

// Custom Dialog System
// 临时调试：探测点击是否被遮挡（elementFromPoint 与实际 target 不一致说明有透明遮罩）
document.addEventListener('click', (e) => {
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const t = e.target;
  console.log('[Debug-Click] target=', (t.id || t.className || t.tagName), '| topElement=', el ? (el.id || el.className || el.tagName) : 'null');
}, true);

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
let currentCloudSourceId = null; // 云端导入的平台文件 id（转换后「保存」关联用；本地导入为 null）

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
  currentCloudSourceId = null;

  if (modalUploadZone) modalUploadZone.classList.remove('hidden');
  configPanel.classList.add('hidden');
  statusPanel.classList.add('hidden');

  stateLoading.classList.add('hidden');
  stateSuccess.classList.add('hidden');
  stateError.classList.add('hidden');

  if (btnSaveCloud) btnSaveCloud.classList.add('hidden');

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

    const isCloud = currentCloudSourceId != null;
    if (isCloud) {
      // 记录转换出的 CAD 到本地缓存（图纸列表可展开直接打开）
      try {
        const pdfName = (selectedInputPath || '').split(/[\\/]/).pop() || 'drawing.pdf';
        const cadName = pdfName.replace(/\.pdf$/i, '') + '.dxf';
        window.api.recordCadCache(currentCloudSourceId, response.saved_to, cadName);
        if (btnSaveCloud) btnSaveCloud.classList.remove('hidden');
      } catch (e) {
        console.error('[Convert] 记录 CAD 缓存失败:', e);
      }
    }

    // 先关闭弹窗（600ms 让用户看到成功提示），之后再开始渲染。
    // 大图纸 DXF 同步解析会阻塞 UI 数秒，若在弹窗打开时解析，
    // 弹窗会卡住关不掉、按钮点不动。
    const pages = (response.pdf_pages && response.pdf_pages.length > 0) ? response.pdf_pages : null;
    const savedTo = response.saved_to;
    setTimeout(() => {
      try { convertModal.classList.add('hidden'); } catch (e) {}
      if (isCloud) {
        try { showCloudSaveToast(); } catch (e) { console.error('[Convert] 显示保存浮动条失败:', e); }
      }
      if (pages) {
        if (placeholderView) placeholderView.classList.add('hidden');
        if (comparisonContainer) comparisonContainer.classList.remove('hidden');
        loadAndRenderComparison(pages[0], savedTo).catch((err) =>
          console.error('[Convert] 渲染比对视图失败:', err));
      }
    }, 600);

  } else {
    // Show Error State
    stateError.classList.remove('hidden');
    errorMessage.textContent = response ? response.message : 'Unknown conversion error.';
  }
});

// Open File Location
btnOpenExplorer.addEventListener('click', () => {
  console.log('[Debug] 点击了 打开文件夹, path=', selectedOutputPath);
  if (selectedOutputPath) {
    window.api.openExplorer(selectedOutputPath).then((r) => console.log('[Debug] openExplorer 返回:', r)).catch((err) => console.error('[Debug] openExplorer 失败:', err));
  }
});

// 保存：把转换出的 CAD 上传平台并关联到原始 PDF（仅云端导入的文件可关联）
async function saveCloudCad() {
  console.log('[Debug] 点击了 保存, cloudId=', currentCloudSourceId, ', path=', selectedOutputPath);
  if (currentCloudSourceId == null || !selectedOutputPath) return false;
  const res = await window.api.platformUploadFile(selectedOutputPath, currentCloudSourceId, null, true);
  if (res.success) {
    hideCloudSaveToast();
    if (btnSaveCloud) btnSaveCloud.classList.add('hidden');
    customAlert('保存成功！转换结果已关联到原始 PDF，可在图纸列表中查看。');
    return true;
  }
  customAlert(`保存失败：${res.error}`);
  return false;
}

if (btnSaveCloud) {
  btnSaveCloud.addEventListener('click', async () => {
    if (btnSaveCloud.disabled) return;
    btnSaveCloud.disabled = true;
    const label = btnSaveCloud.querySelector('span');
    if (label) label.textContent = '保存中...';
    await saveCloudCad();
    btnSaveCloud.disabled = false;
    if (label) label.textContent = '保存';
  });
}

// --- 主界面顶部「保存到云端」浮动条（云端导入转换成功后出现） ---
const cloudSaveToast = document.getElementById('cloud-save-toast');
let cloudSaveBusy = false;

function showCloudSaveToast() {
  if (!cloudSaveToast) return;
  cloudSaveToast.classList.remove('hidden');
}

function hideCloudSaveToast() {
  if (cloudSaveToast) cloudSaveToast.classList.add('hidden');
}

if (cloudSaveToast) {
  const toastSaveBtn = document.getElementById('cloud-toast-save');
  const toastCloseBtn = document.getElementById('cloud-toast-close');
  if (toastSaveBtn) {
    toastSaveBtn.addEventListener('click', async () => {
      if (cloudSaveBusy) return;
      cloudSaveBusy = true;
      const label = toastSaveBtn.querySelector('span');
      if (label) label.textContent = '保存中...';
      await saveCloudCad();
      cloudSaveBusy = false;
      if (label) label.textContent = '保存到云端';
    });
  }
  if (toastCloseBtn) {
    // 关闭浮动条 = 本次不保存（CAD 已在本地缓存，图纸列表里仍可打开）
    toastCloseBtn.addEventListener('click', hideCloudSaveToast);
  }
}

// Reset Listeners
btnErrorReset.addEventListener('click', resetModalUI);

// --- History database loader ---
const historyList = document.getElementById('history-list');

function formatCloudFileSize(n) {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// 历史记录面板数据源：平台云端文件列表（两层结构：原始 PDF -> children CAD）
async function loadHistory() {
  if (!historyList) return;
  historyList.innerHTML = '<tr><td colspan="5"><div class="empty-history">正在加载图纸列表...</div></td></tr>';
  let files = [];
  let listUser = '';
  let cacheMap = {};
  let cadCache = {};
  try {
    const res = await window.api.platformListFolderFiles();
    if (!res.success) throw new Error(res.error || '接口调用失败');
    files = res.data || [];
    listUser = res.user || '';
    [cacheMap, cadCache] = await Promise.all([
      window.api.getCloudDownloads() || {},
      window.api.getCadCache() || {},
    ]);
  } catch (error) {
    historyList.innerHTML = `<tr><td colspan="5"><div class="empty-history" style="color:#ef4444;">加载失败：${error.message}</div></td></tr>`;
    return;
  }

  historyList.innerHTML = '';
  if (!files.length) {
    historyList.innerHTML = `<tr><td colspan="5"><div class="empty-history">账号「${listUser || '当前用户'}」在云端 Folder 4 下暂无文件</div></td></tr>`;
    return;
  }

  files.forEach(file => {
    const isSource = file.source_file_id === null || file.source_file_id === undefined;
    const platformChildren = (isSource && (file.child_count || 0) > 0 && Array.isArray(file.children)) ? file.children : [];
    const localCads = (isSource && cadCache[String(file.id)]) || [];
    const hasChildren = platformChildren.length > 0 || localCads.length > 0;
    const cachedEntry = isSource && cacheMap[String(file.id)];
    let toggleChildren = null;

    const tr = document.createElement('tr');
    tr.dataset.id = file.id;

    // --- 展开箭头 ---
    const expandTd = document.createElement('td');
    if (hasChildren) {
      const expandBtn = document.createElement('button');
      expandBtn.className = 'expand-btn';
      expandBtn.innerHTML = '▶';
      expandBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (toggleChildren) toggleChildren();
      });
      expandTd.appendChild(expandBtn);
    }
    tr.appendChild(expandTd);

    // --- 文件名（已下载的追加「已缓存」标识） ---
    const nameTd = document.createElement('td');
    nameTd.className = 'td-filename';
    if (cachedEntry) {
      nameTd.innerHTML = `<span>${file.file_name}</span> <span class="dot-badge dot-badge-success" title="本地缓存：${cachedEntry.path}">已缓存</span>`;
      nameTd.title = `本地缓存：${cachedEntry.path}`;
    } else {
      nameTd.textContent = file.file_name;
    }
    tr.appendChild(nameTd);

    // --- 大小 ---
    const sizeTd = document.createElement('td');
    sizeTd.className = 'td-time';
    sizeTd.textContent = formatCloudFileSize(file.file_size);
    tr.appendChild(sizeTd);

    // --- 类型 ---
    const typeTd = document.createElement('td');
    typeTd.className = 'td-status';
    typeTd.textContent = isSource ? '原始 PDF' : 'CAD';
    tr.appendChild(typeTd);

    // --- 操作：PDF 行按钮（CAD 已转换过 -> 直接打开 CAD；否则导入/打开缓存 PDF） ---
    const actionsTd = document.createElement('td');
    actionsTd.className = 'td-actions';
    let importBtn = null;
    if (isSource) {
      const latestCad = localCads.length ? localCads[localCads.length - 1] : null;
      importBtn = document.createElement('button');
      importBtn.className = 'btn-import-cloud' + (cachedEntry || latestCad ? ' is-cached' : '');

      if (cachedEntry && latestCad) {
        // PDF 已下载且 CAD 已转换/保存：应用内直接打开 CAD（单视图渲染）
        importBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg><span>打开 CAD</span>';
        importBtn.title = `CAD 已转换过，点击在编辑器中打开：${latestCad.path}`;
        importBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          console.log('[Debug-OpenCAD] 点击打开 CAD:', latestCad.path);
          historyModal.classList.add('hidden');
          currentCloudSourceId = file.id; // 标记来源：编辑后可「保存到云端」
          const ok = await loadDxfOnly(latestCad.path);
          if (!ok) {
            // 打开失败 → 回退：用本地缓存的 PDF 走转换流程
            customAlert('CAD 打开失败，已切换为打开 PDF 重新转换');
            handleCloudImport(file, importBtn);
          }
        });
      } else if (cachedEntry) {
        // PDF 已下载但还没转换过：用本地缓存直接进转换
        importBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg><span>打开缓存</span>';
        importBtn.title = '已下载过，直接使用本地缓存';
        importBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          handleCloudImport(file, importBtn);
        });
      } else {
        // 未下载过：从平台下载并导入转换
        importBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><span>导入</span>';
        importBtn.title = '下载并导入转换';
        importBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          handleCloudImport(file, importBtn);
        });
      }
      actionsTd.appendChild(importBtn);

      // 清除缓存按钮：有 PDF 缓存或 CAD 转换缓存时显示
      if (cachedEntry || localCads.length > 0) {
        const clearBtn = document.createElement('button');
        clearBtn.className = 'btn-clear-cache';
        clearBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg><span>清除缓存</span>';
        clearBtn.title = '删除本地缓存的 PDF 及转换出的 CAD 文件';
        clearBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const ok = await customConfirm(`确定清除「${file.file_name}」的本地缓存吗？\n将删除已下载的 PDF 和转换出的 CAD 文件（不影响云端）。`);
          if (!ok) return;
          clearBtn.disabled = true;
          const res = await window.api.clearFileCache(file.id);
          if (res && res.success) {
            customAlert(`已清除缓存（PDF×${res.removed.pdf}，CAD×${res.removed.cad}）`);
            loadHistory(); // 刷新列表状态
          } else {
            customAlert('清除失败：' + ((res && res.error) || '未知错误'));
            clearBtn.disabled = false;
          }
        });
        actionsTd.appendChild(clearBtn);
      }
    }
    tr.appendChild(actionsTd);

    // --- 主行点击：有 CAD 子文件则展开；没有则直接导入/打开缓存 PDF 去转换 ---
    tr.style.cursor = 'pointer';
    tr.addEventListener('click', (e) => {
      if (e.target.closest('button')) return; // 按钮有自己的处理
      if (toggleChildren) {
        toggleChildren();
      } else if (isSource) {
        handleCloudImport(file, importBtn || null);
      }
    });

    historyList.appendChild(tr);

    // --- CAD 子文件明细行（平台 children + 本地缓存的转换结果） ---
    if (hasChildren) {
      const childRow = document.createElement('tr');
      childRow.className = 'cloud-children-row';
      childRow.style.display = 'none';
      const childTd = document.createElement('td');
      childTd.colSpan = 4;

      const inner = document.createElement('div');
      inner.className = 'subgraphs-inner';

      // 平台上的 CAD（已保存关联的）
      platformChildren.forEach(child => {
        const item = document.createElement('div');
        item.className = 'subgraph-item';
        item.innerHTML = `
          <span class="subgraph-name">${child.file_name}</span>
          <span class="dot-badge dot-badge-info" title="已保存到云端，与原始 PDF 关联">云端</span>
          <span class="subgraph-time">${formatCloudFileSize(child.file_size)}</span>
        `;
        const delBtn = document.createElement('button');
        delBtn.className = 'btn-cloud-delete';
        delBtn.title = `从云端删除该 CAD（不影响原始 PDF）：${child.file_name}`;
        delBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg><span>删除</span>';
        delBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          handleCloudDelete(child, delBtn);
        });
        item.appendChild(delBtn);
        inner.appendChild(item);
      });

      // 本地缓存的转换结果 CAD（可直接打开）
      localCads.forEach(cad => {
        const item = document.createElement('div');
        item.className = 'subgraph-item';
        item.innerHTML = `
          <span class="subgraph-name" title="${cad.path}">${cad.name}</span>
          <span class="dot-badge dot-badge-success" title="本地转换缓存：${cad.path}">本地</span>
          <span class="subgraph-time">${formatCloudFileSize(cad.size)}</span>
        `;
        const openBtn = document.createElement('button');
        openBtn.className = 'btn-child-open';
        openBtn.title = `在编辑器中打开：${cad.path}`;
        openBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg><span>打开 CAD</span>';
        openBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          historyModal.classList.add('hidden');
          currentCloudSourceId = file.id; // 标记来源：编辑后可「保存到云端」
          loadDxfOnly(cad.path);
        });
        item.appendChild(openBtn);
        inner.appendChild(item);
      });

      childTd.appendChild(inner);
      childRow.appendChild(childTd);
      historyList.appendChild(childRow);

      toggleChildren = () => {
        childRow.style.display = childRow.style.display === 'none' ? '' : 'none';
        expandBtn.classList.toggle('expanded');
      };
    }
  });
}

// 云端 CAD「单条删除」：调平台 DELETE /folder/file，删除该 CAD，不影响原始 PDF
async function handleCloudDelete(cadFile, btn) {
  const name = cadFile.file_name || '该 CAD';
  if (!(await customConfirm(`确定从云端删除 CAD「${name}」吗？\n单独删除 CAD 不影响原始 PDF。`))) return;

  if (btn) btn.disabled = true;
  const res = await window.api.platformDeleteFiles([cadFile.id]);
  if (res && res.success) {
    // 云端已删，同步清理本地缓存（如有该 CAD 的本地转换文件）
    try { await window.api.clearFileCache(cadFile.id); } catch (e) { console.warn('[DeleteCloud] 清理本地缓存失败:', e); }
    customAlert('已删除。');
    loadHistory(); // 刷新列表
  } else {
    customAlert('删除失败：' + ((res && res.error) || '未知错误'));
    if (btn) btn.disabled = false;
  }
}

// 云端 PDF「导入」：下载到本地 pdf 目录 -> 打开转换弹窗并预填路径
async function handleCloudImport(file, btn) {
  const label = btn.querySelector('span');
  const originalText = label ? label.textContent : '';
  btn.disabled = true;
  if (label) label.textContent = '下载中...';
  const res = await window.api.platformDownloadFile(file.id, file.file_name);
  btn.disabled = false;
  if (label) label.textContent = originalText;

  if (!res.success) {
    customAlert(`下载失败：${res.error}`);
    return;
  }

  // 打开转换弹窗，预填源文件与输出 DXF 路径
  historyModal.classList.add('hidden');
  resetModalUI();
  displayFileConfig(res.path);
  currentCloudSourceId = file.id; // 标记来源为云端文件，转换成功后可「保存」关联
  convertModal.classList.remove('hidden');
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
        if (['LINE', 'LWPOLYLINE', 'TEXT', 'MTEXT', 'CIRCLE', 'ARC'].includes(value)) {
          currentEntity = { type: value, vertices: [] };
        } else {
          currentEntity = null;
        }
      } else if (currentEntity) {
        if (groupCode === 8) {
          currentEntity.layer = value;
        } else if (groupCode === 62) {
          currentEntity.aci = parseInt(value, 10);
          if (!currentEntity.color && ACI_TO_HEX[currentEntity.aci]) {
            currentEntity.color = ACI_TO_HEX[currentEntity.aci];
          }
        } else if (groupCode === 420) {
          const c = parseInt(value, 10);
          currentEntity.color = '#' + c.toString(16).padStart(6, '0');
        } else if (currentEntity.type === 'LINE') {
          if (groupCode === 10) currentEntity.x0 = parseFloat(value);
          else if (groupCode === 20) currentEntity.y0 = parseFloat(value);
          else if (groupCode === 11) currentEntity.x1 = parseFloat(value);
          else if (groupCode === 21) currentEntity.y1 = parseFloat(value);
        } else if (currentEntity.type === 'LWPOLYLINE') {
          if (groupCode === 10) {
            currentEntity.vertices.push({ x: parseFloat(value), y: 0 });
          } else if (groupCode === 20) {
            if (currentEntity.vertices.length > 0) {
              currentEntity.vertices[currentEntity.vertices.length - 1].y = parseFloat(value);
            }
          } else if (groupCode === 70) {
            currentEntity.closed = parseInt(value, 10) === 1;
          }
        } else if (currentEntity.type === 'CIRCLE') {
          if (groupCode === 10) currentEntity.cx = currentEntity.x = parseFloat(value);
          else if (groupCode === 20) currentEntity.cy = currentEntity.y = parseFloat(value);
          else if (groupCode === 40) currentEntity.r = currentEntity.radius = parseFloat(value);
        } else if (currentEntity.type === 'ARC') {
          if (groupCode === 10) currentEntity.cx = currentEntity.x = parseFloat(value);
          else if (groupCode === 20) currentEntity.cy = currentEntity.y = parseFloat(value);
          else if (groupCode === 40) currentEntity.r = currentEntity.radius = parseFloat(value);
          else if (groupCode === 50) currentEntity.startAngle = parseFloat(value);
          else if (groupCode === 51) currentEntity.endAngle = parseFloat(value);
        } else if (currentEntity.type === 'TEXT' || currentEntity.type === 'MTEXT') {
          if (groupCode === 10) currentEntity.x = parseFloat(value);
          else if (groupCode === 20) currentEntity.y = parseFloat(value);
          else if (groupCode === 40) currentEntity.height = parseFloat(value);
          else if (groupCode === 41) currentEntity.widthFactor = parseFloat(value);
          else if (groupCode === 50) currentEntity.rotation = parseFloat(value);
          else if (groupCode === 1) currentEntity.text = value;
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
    if (ent.type === 'TEXT' || ent.type === 'MTEXT') {
      const wf = (ent.widthFactor && ent.widthFactor > 0.05 && ent.widthFactor < 20) ? ent.widthFactor : 1;
      ent.tw = (ent.text ? ent.text.length : 0) * (ent.height || 12) * 0.6 * wf;
      ent.th = (ent.height || 12) * 1.2;
    }
    if (!ent.layer) {
      if (ent.type === 'LINE') ent.layer = 'LINES';
      else if (ent.type === 'LWPOLYLINE') ent.layer = 'RECTS';
      else if (ent.type === 'CIRCLE') ent.layer = 'CIRCLES';
      else if (ent.type === 'ARC') ent.layer = 'ARCS';
      else if (ent.type === 'TEXT' || ent.type === 'MTEXT') ent.layer = 'TEXTS';
      else ent.layer = '0';
    }
    if (!ent.color) {
      ent.color = layerColorMap[ent.layer] || '#ffffff';
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
    } else if (ent.type === 'CIRCLE') {
      const r = ent.r || ent.radius || 0;
      const cx = ent.cx !== undefined ? ent.cx : ent.x || 0;
      const cy = ent.cy !== undefined ? ent.cy : ent.y || 0;
      minX = Math.min(minX, cx - r);
      maxX = Math.max(maxX, cx + r);
      minY = Math.min(minY, cy - r);
      maxY = Math.max(maxY, cy + r);
      hasGeometry = true;
    } else if (ent.type === 'ARC') {
      const r = ent.r || ent.radius || 0;
      const cx = ent.cx !== undefined ? ent.cx : ent.x || 0;
      const cy = ent.cy !== undefined ? ent.cy : ent.y || 0;
      minX = Math.min(minX, cx - r);
      maxX = Math.max(maxX, cx + r);
      minY = Math.min(minY, cy - r);
      maxY = Math.max(maxY, cy + r);
      hasGeometry = true;
    } else if (ent.type === 'TEXT' || ent.type === 'MTEXT') {
      const b = getEntityBounds(ent);
      minX = Math.min(minX, b.minX);
      maxX = Math.max(maxX, b.maxX);
      minY = Math.min(minY, b.minY);
      maxY = Math.max(maxY, b.maxY);
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
  } else if (ent.type === 'CIRCLE') {
    const r = ent.r || ent.radius || 0;
    const cx = ent.cx !== undefined ? ent.cx : ent.x || 0;
    const cy = ent.cy !== undefined ? ent.cy : ent.y || 0;
    minX = cx - r; maxX = cx + r;
    minY = cy - r; maxY = cy + r;
  } else if (ent.type === 'ARC') {
    const r = ent.r || ent.radius || 0;
    const cx = ent.cx !== undefined ? ent.cx : ent.x || 0;
    const cy = ent.cy !== undefined ? ent.cy : ent.y || 0;
    minX = cx - r; maxX = cx + r;
    minY = cy - r; maxY = cy + r;
  } else if (ent.type === 'TEXT' || ent.type === 'MTEXT') {
    const tw = ent.tw || (ent.text ? ent.text.length * (ent.height || 12) * 0.6 : 0);
    const th = ent.th || ((ent.height || 12) * 1.2);
    const rot = ((ent.rotation || 0) * Math.PI) / 180;
    if (Math.abs(rot) > 1e-4) {
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      const corners = [
        { x: ent.x, y: ent.y },
        { x: ent.x + tw * cos, y: ent.y + tw * sin },
        { x: ent.x + tw * cos - th * sin, y: ent.y + tw * sin + th * cos },
        { x: ent.x - th * sin, y: ent.y + th * cos }
      ];
      minX = Math.min(...corners.map(c => c.x));
      maxX = Math.max(...corners.map(c => c.x));
      minY = Math.min(...corners.map(c => c.y));
      maxY = Math.max(...corners.map(c => c.y));
    } else {
      minX = ent.x; maxX = ent.x + tw; minY = ent.y; maxY = ent.y + th;
    }
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
    'CIRCLES': new Path2D(),
    'ARCS': new Path2D(),
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
    } else if (ent.type === 'CIRCLE') {
      const r = ent.r || ent.radius || 0;
      const cx = ent.cx !== undefined ? ent.cx : ent.x || 0;
      const cy = ent.cy !== undefined ? ent.cy : ent.y || 0;
      p.moveTo(cx + r, cy);
      p.arc(cx, cy, r, 0, Math.PI * 2);
    } else if (ent.type === 'ARC') {
      const r = ent.r || ent.radius || 0;
      const cx = ent.cx !== undefined ? ent.cx : ent.x || 0;
      const cy = ent.cy !== undefined ? ent.cy : ent.y || 0;
      const sRad = ((ent.startAngle || 0) * Math.PI) / 180;
      let eRad = ((ent.endAngle || 360) * Math.PI) / 180;
      p.arc(cx, cy, r, sRad, eRad);
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

  // 预收集所有 TEXT 及其包围盒（避免对每个候选多段线都全量扫描实体列表）
  const allTextBounds = [];
  entities.forEach(e => {
    if (e.type !== 'TEXT') return;
    allTextBounds.push({ eb: bb(e) });
  });

  entities.forEach((ent) => {
    if (ent.type !== 'LWPOLYLINE') return;
    const b = bb(ent);
    const w = b.maxX - b.minX, h = b.maxY - b.minY;
    if (w < 40 || h < 30 || w > 900 || h > 700) return;
    const area = w * h;
    if (area >= bestArea) return;
    let txtCount = 0;
    for (const { eb } of allTextBounds) {
      if (inside((eb.minX + eb.maxX) / 2, (eb.minY + eb.maxY) / 2, b)) txtCount++;
    }
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

  // 空间哈希网格：大图纸有数万条短线（虚线/填充图案），
  // 两两比较是 O(n²)（5 万条 = 23 亿次比较）会卡死界面。
  // 把每条线的端点注册进网格，只与相邻格子内的线比较。
  // 格宽取 LINE_EPS：端点相距 ≤ EPS 时格子坐标至多差 1，3×3 邻域即覆盖。
  const CELL = LINE_EPS;
  const grid = new Map();
  shortLines.forEach(idx => {
    const e = entities[idx];
    for (const pt of [[e.x0, e.y0], [e.x1, e.y1]]) {
      const k = Math.floor(pt[0] / CELL) + ',' + Math.floor(pt[1] / CELL);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(idx);
    }
  });

  const adj = new Map();
  // 数值对键（ia*N+ib）比字符串拼接快数倍；大图纸下候选对可达千万级
  const N = entities.length || 1;
  const linkedPairs = new Set();
  function tryLink(ia, ib) {
    if (ia === ib) return;
    const key = ia < ib ? ia * N + ib : ib * N + ia;
    if (linkedPairs.has(key)) return;
    const ea = entities[ia], eb = entities[ib];
    // 廉价预检：任一坐标差超 EPS 直接排除，避免 hypot
    const d00x = ea.x0 - eb.x0; if (d00x > LINE_EPS || d00x < -LINE_EPS) {} else {
      const d00y = ea.y0 - eb.y0;
      if (d00y <= LINE_EPS && d00y >= -LINE_EPS && Math.hypot(d00x, d00y) <= LINE_EPS) return _link(ia, ib);
    }
    const d01x = ea.x0 - eb.x1; if (d01x > LINE_EPS || d01x < -LINE_EPS) {} else {
      const d01y = ea.y0 - eb.y1;
      if (d01y <= LINE_EPS && d01y >= -LINE_EPS && Math.hypot(d01x, d01y) <= LINE_EPS) return _link(ia, ib);
    }
    const d10x = ea.x1 - eb.x0; if (d10x > LINE_EPS || d10x < -LINE_EPS) {} else {
      const d10y = ea.y1 - eb.y0;
      if (d10y <= LINE_EPS && d10y >= -LINE_EPS && Math.hypot(d10x, d10y) <= LINE_EPS) return _link(ia, ib);
    }
    const d11x = ea.x1 - eb.x1; if (d11x > LINE_EPS || d11x < -LINE_EPS) {} else {
      const d11y = ea.y1 - eb.y1;
      if (d11y <= LINE_EPS && d11y >= -LINE_EPS && Math.hypot(d11x, d11y) <= LINE_EPS) return _link(ia, ib);
    }
  }
  function _link(ia, ib) {
    const key = ia < ib ? ia * N + ib : ib * N + ia;
    linkedPairs.add(key);
    if (!adj.has(ia)) adj.set(ia, []);
    if (!adj.has(ib)) adj.set(ib, []);
    adj.get(ia).push(ib); adj.get(ib).push(ia);
  }
  // 遍历每个格子与自身及右侧/下侧/对角共 5 个前向邻居（覆盖全部 8 邻域且不重复）
  const NEIGHBOR_OFFSETS = [[0, 0], [1, 0], [0, 1], [1, 1], [1, -1]];
  for (const [k, idxs] of grid) {
    const comma = k.indexOf(',');
    const cx = +k.slice(0, comma), cy = +k.slice(comma + 1);
    for (let oi = 0; oi < NEIGHBOR_OFFSETS.length; oi++) {
      const dx = NEIGHBOR_OFFSETS[oi][0], dy = NEIGHBOR_OFFSETS[oi][1];
      const nIdxs = (dx === 0 && dy === 0) ? idxs : grid.get((cx + dx) + ',' + (cy + dy));
      if (!nIdxs) continue;
      const self = (dx === 0 && dy === 0);
      for (let m = 0; m < idxs.length; m++) {
        const startN = self ? m + 1 : 0;
        for (let n = startN; n < nIdxs.length; n++) {
          tryLink(idxs[m], nIdxs[n]);
        }
      }
    }
  }

  const usedLine = new Set();
  // compSeen：无论组件最终是否被采纳，都标记其成员已处理。
  // 否则被拒绝的巨型连通分量（虚线链可达数万条线）会被下一个成员
  // 作为起点反复重新遍历，导致加载卡死数十秒甚至更久。
  const compSeen = new Set();
  const COMP_MEMBER_CAP = 120; // 符号最多 12 笔，超过即不可能是符号，提前放弃
  for (const idx of shortLines) {
    if (compSeen.has(idx) || !adj.has(idx)) continue;
    // 指针队列代替 shift()：shift 在大分量上是 O(n²)
    const q = [idx], comp = [], vis = new Set([idx]);
    for (let qi = 0; qi < q.length; qi++) {
      const c = q[qi]; comp.push(c);
      if (comp.length > COMP_MEMBER_CAP) break; // 超限早退，不再扩展
      const nbrs = adj.get(c) || [];
      for (let n = 0; n < nbrs.length; n++) {
        if (!vis.has(nbrs[n])) { vis.add(nbrs[n]); q.push(nbrs[n]); }
      }
    }
    comp.forEach(ci => compSeen.add(ci));
    if (comp.length > COMP_MEMBER_CAP) continue;
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
  // 空间哈希加速聚类：以单元中心注册到网格（格宽 = 最大盒宽 + 2×合并距离），
  // 只需与 3×3 邻域内的单元做 boxClose，避免 O(k²) 全量扫描。
  const CCELL = CORE_MAX + CORE_DIST * 2;
  const cuGrid = new Map();
  coreUnits.forEach((u, i) => {
    const cx = Math.floor(((u.bounds.minX + u.bounds.maxX) / 2) / CCELL);
    const cy = Math.floor(((u.bounds.minY + u.bounds.maxY) / 2) / CCELL);
    const k = cx + ',' + cy;
    if (!cuGrid.has(k)) cuGrid.set(k, []);
    cuGrid.get(k).push(i);
  });
  const coreNeighbors = (i) => {
    const u = coreUnits[i];
    const cx = Math.floor(((u.bounds.minX + u.bounds.maxX) / 2) / CCELL);
    const cy = Math.floor(((u.bounds.minY + u.bounds.maxY) / 2) / CCELL);
    const out = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const l = cuGrid.get((cx + dx) + ',' + (cy + dy));
        if (l) for (let m = 0; m < l.length; m++) out.push(l[m]);
      }
    }
    return out;
  };
  for (let i = 0; i < coreUnits.length; i++) {
    if (visitedU.has(i)) continue;
    const q = [i], cluster = [], vis = new Set([i]);
    for (let qi = 0; qi < q.length; qi++) {
      const cur = q[qi]; cluster.push(cur);
      const neighbors = coreNeighbors(cur);
      for (let n = 0; n < neighbors.length; n++) {
        const j = neighbors[n];
        if (!vis.has(j) && boxClose(coreUnits[cur].bounds, coreUnits[j].bounds, CORE_DIST)) {
          vis.add(j); q.push(j);
        }
      }
    }
    visitedU.add(i);
    cluster.forEach(ci => visitedU.add(ci));
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
    // 应用 DXF 宽度因子，与主渲染保持一致
    const wf = (ent.widthFactor && ent.widthFactor > 0.05 && ent.widthFactor < 20) ? ent.widthFactor : 1;
    ctx.scale(wf, -1);
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
    // 与 THREE 主渲染一致：应用 DXF 宽度因子，压缩文字在拖拽缓存中保持压缩
    const wf = (t.widthFactor && t.widthFactor > 0.05 && t.widthFactor < 20) ? t.widthFactor : 1;
    offCtx.scale(wf, -1);
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

    // 大图纸同步解析会阻塞 UI 数秒，先显示 loading 遮罩再开始解析
    if (cadLoadingOverlay) cadLoadingOverlay.classList.remove('hidden');
    await new Promise((r) => setTimeout(r, 50));

    // 1. Load and parse DXF
    const dxfText = await window.api.readTextFile(dxfFilePath);
    if (!dxfText) { if (cadLoadingOverlay) cadLoadingOverlay.classList.add('hidden'); return; }
    const parsedEntities = parseDxf(dxfText);
    dxfEntities = autoClusterEntities(parsedEntities);
    buildSpatialGrid();

    // Calculate DXF bounding box and center
    const bounds = getBoundingBox(dxfEntities);
    dxfCenterX = (bounds.minX + bounds.maxX) / 2;
    dxfCenterY = (bounds.minY + bounds.maxY) / 2;

    // 2. Load PDF page image as base64 Data URL
    const pdfPageBase64 = await window.api.readImageBase64(pdfPageData.path);
    if (!pdfPageBase64) { if (cadLoadingOverlay) cadLoadingOverlay.classList.add('hidden'); return; }

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
        // 首帧渲染完成，撤掉 loading 遮罩（兜底 2 秒强制撤掉）
        if (cadLoadingOverlay) cadLoadingOverlay.classList.add('hidden');
      }, 50);
      setTimeout(() => {
        if (cadLoadingOverlay) cadLoadingOverlay.classList.add('hidden');
      }, 2000);
    };
  } catch (error) {
    console.error("Error loading side-by-side comparison view:", error);
    if (cadLoadingOverlay) cadLoadingOverlay.classList.add('hidden');
  }
}

// 应用内直接打开 DXF（图纸列表「打开 CAD」）：不依赖系统 CAD 程序，单视图渲染
// 返回 true=成功打开；false=失败（调用方可回退到打开 PDF 转换）
const cadLoadingOverlay = document.getElementById('cad-loading-overlay');

async function loadDxfOnly(dxfFilePath) {
  // 先显示 loading 遮罩，等一帧确保它渲染出来后再开始解析
  if (cadLoadingOverlay) cadLoadingOverlay.classList.remove('hidden');
  await new Promise((r) => setTimeout(r, 50));

  try {
    if (placeholderView) placeholderView.classList.add('hidden');
    if (comparisonContainer) comparisonContainer.classList.remove('hidden');

    // 1. 解析 DXF 并构建渲染数据
    const dxfText = await window.api.readTextFile(dxfFilePath);
    if (!dxfText) { customAlert('读取 DXF 文件失败'); return false; }
    const parsedEntities = parseDxf(dxfText);
    console.log('[Debug-OpenCAD] 解析图元数量:', parsedEntities.length);
    if (parsedEntities.length === 0) { customAlert('DXF 解析结果为空，无法渲染'); return false; }
    dxfEntities = autoClusterEntities(parsedEntities);
    buildSpatialGrid();

    // 2. 计算图形包围盒并居中
    const bounds = getBoundingBox(dxfEntities);
    dxfCenterX = (bounds.minX + bounds.maxX) / 2;
    dxfCenterY = (bounds.minY + bounds.maxY) / 2;
    console.log('[Debug-OpenCAD] 包围盒:', JSON.stringify(bounds));

    // 3. 无原始 PDF 对照，切到「单视图 - CAD」标签
    pdfImage = null;
    pdfPageWidth = 0;
    pdfPageHeight = 0;
    currentViewMode = 'single';
    currentActiveTab = 'dxf';

    updateViewModeUI();
    if (typeof activateEditor === 'function') {
      activateEditor(dxfFilePath);
    }
    // 等布局完成后再自适应缩放（两帧 + 兜底延时），完成后撤掉遮罩
    requestAnimationFrame(() => requestAnimationFrame(() => {
      updateCanvasSizes();
      if (typeof fitViewport === 'function') {
        fitViewport();
      }
      console.log('[Debug-OpenCAD] 视图状态: mode=', currentViewMode, 'tab=', currentActiveTab, 'dxfRect=', JSON.stringify(dxfRect), 'zoom=', zoom, 'entities=', dxfEntities.length, 'engine=', !!threeCadEngine);
    }));
    setTimeout(() => {
      updateCanvasSizes();
      if (typeof fitViewport === 'function') {
        fitViewport();
      }
      drawViewports();
      if (cadLoadingOverlay) cadLoadingOverlay.classList.add('hidden');
    }, 150);
    return true;
  } catch (error) {
    console.error('[Debug-OpenCAD] 打开失败:', error);
    customAlert('打开 CAD 失败：' + error.message);
    return false;
  } finally {
    // 兜底：无论如何 2 秒后撤掉遮罩，避免卡死
    setTimeout(() => {
      if (cadLoadingOverlay) cadLoadingOverlay.classList.add('hidden');
    }, 2000);
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
const btnSaveCloudEdit = document.getElementById('btn-save-cloud-edit');
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
  // 云端来源的图纸：显示「保存到云端」按钮（修改后可一键保存回服务器）
  if (btnSaveCloudEdit) {
    if (currentCloudSourceId != null) btnSaveCloudEdit.classList.remove('hidden');
    else btnSaveCloudEdit.classList.add('hidden');
  }
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
    } else if (ent.type === 'CIRCLE' || ent.type === 'ARC') {
      ent.cx = (ent.cx !== undefined ? ent.cx : ent.x || 0) + dx;
      ent.cy = (ent.cy !== undefined ? ent.cy : ent.y || 0) + dy;
      if (ent.x !== undefined) ent.x += dx;
      if (ent.y !== undefined) ent.y += dy;
    } else if (ent.type === 'TEXT' || ent.type === 'MTEXT') {
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
    } else if (ent.type === 'CIRCLE') {
      const cx = ent.cx !== undefined ? ent.cx : ent.x || 0;
      const cy = ent.cy !== undefined ? ent.cy : ent.y || 0;
      const d = Math.hypot(dxfX - cx, dxfY - cy);
      if (d < minDist) { minDist = d; bestNode = { entityIndex: i, type: 'CIRCLE', nodeIndex: 0, x: cx, y: cy }; }
    } else if (ent.type === 'ARC') {
      const cx = ent.cx !== undefined ? ent.cx : ent.x || 0;
      const cy = ent.cy !== undefined ? ent.cy : ent.y || 0;
      const r = ent.r || ent.radius || 0;
      const d = Math.hypot(dxfX - cx, dxfY - cy);
      if (d < minDist) { minDist = d; bestNode = { entityIndex: i, type: 'ARC', nodeIndex: 0, x: cx, y: cy }; }
      const sRad = ((ent.startAngle || 0) * Math.PI) / 180;
      const sx = cx + r * Math.cos(sRad);
      const sy = cy + r * Math.sin(sRad);
      const ds = Math.hypot(dxfX - sx, dxfY - sy);
      if (ds < minDist) { minDist = ds; bestNode = { entityIndex: i, type: 'ARC', nodeIndex: 1, x: sx, y: sy }; }
      const eRad = ((ent.endAngle || 360) * Math.PI) / 180;
      const ex = cx + r * Math.cos(eRad);
      const ey = cy + r * Math.sin(eRad);
      const de = Math.hypot(dxfX - ex, dxfY - ey);
      if (de < minDist) { minDist = de; bestNode = { entityIndex: i, type: 'ARC', nodeIndex: 2, x: ex, y: ey }; }
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
    } else if (ent.type === 'CIRCLE') {
      const cx = ent.cx !== undefined ? ent.cx : ent.x || 0;
      const cy = ent.cy !== undefined ? ent.cy : ent.y || 0;
      const dist = Math.hypot(dxfX - cx, dxfY - cy);
      const r = ent.r || ent.radius || 0;
      if (Math.abs(dist - r) < threshold) return true;
      if (r <= 25 && dist <= r) return true;
    } else if (ent.type === 'ARC') {
      const cx = ent.cx !== undefined ? ent.cx : ent.x || 0;
      const cy = ent.cy !== undefined ? ent.cy : ent.y || 0;
      const dist = Math.hypot(dxfX - cx, dxfY - cy);
      const r = ent.r || ent.radius || 0;
      if (Math.abs(dist - r) < threshold) {
        let ang = (Math.atan2(dxfY - cy, dxfX - cx) * 180) / Math.PI;
        if (ang < 0) ang += 360;
        let s = (ent.startAngle || 0) % 360;
        let e = (ent.endAngle || 360) % 360;
        if (s < 0) s += 360;
        if (e < 0) e += 360;
        if (s <= e) {
          if (ang >= s - 2 && ang <= e + 2) return true;
        } else {
          if (ang >= s - 2 || ang <= e + 2) return true;
        }
      }
    } else if (ent.type === 'TEXT' || ent.type === 'MTEXT') {
      const tw = ent.tw || (ent.text ? ent.text.length * (ent.height || 12) * 0.6 : 0);
      const th = ent.th || ((ent.height || 12) * 1.2);
      const rot = ((ent.rotation || 0) * Math.PI) / 180;
      if (Math.abs(rot) > 1e-4) {
        const dx = dxfX - ent.x;
        const dy = dxfY - ent.y;
        const cos = Math.cos(-rot);
        const sin = Math.sin(-rot);
        const lx = dx * cos - dy * sin;
        const ly = dx * sin + dy * cos;
        if (lx >= -3 && lx <= tw + 3 && ly >= -3 && ly <= th + 3) return true;
      } else {
        if (dxfX >= ent.x - 3 && dxfX <= ent.x + tw + 3 &&
            dxfY >= ent.y - 3 && dxfY <= ent.y + th + 3) return true;
      }
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
      ? '● 已修改（未保存）· Ctrl+Z 撤销'
      : '点击图元选中 · Del 删除 · 工具栏绘制新图元';
    editorStatusTip.style.color = isDirty ? '#f59e0b' : '';
  }
  // 有未保存修改时，「保存到云端」按钮高亮提醒
  if (btnSaveCloudEdit) {
    btnSaveCloudEdit.classList.toggle('has-changes', isDirty && currentCloudSourceId != null);
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
              } else if (node.type === 'CIRCLE') {
                node.ent.cx = (node.ent.cx !== undefined ? node.ent.cx : node.ent.x || 0) + dx;
                node.ent.cy = (node.ent.cy !== undefined ? node.ent.cy : node.ent.y || 0) + dy;
                if (node.ent.x !== undefined) node.ent.x += dx;
                if (node.ent.y !== undefined) node.ent.y += dy;
              } else if (node.type === 'ARC') {
                if (node.nodeIndex === 0) {
                  node.ent.cx = (node.ent.cx !== undefined ? node.ent.cx : node.ent.x || 0) + dx;
                  node.ent.cy = (node.ent.cy !== undefined ? node.ent.cy : node.ent.y || 0) + dy;
                  if (node.ent.x !== undefined) node.ent.x += dx;
                  if (node.ent.y !== undefined) node.ent.y += dy;
                }
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
  } else if (entity.type === 'CIRCLE' || entity.type === 'ARC') {
    entity.cx = (entity.cx !== undefined ? entity.cx : entity.x || 0) + dx;
    entity.cy = (entity.cy !== undefined ? entity.cy : entity.y || 0) + dy;
    if (entity.x !== undefined) entity.x += dx;
    if (entity.y !== undefined) entity.y += dy;
  } else if (entity.type === 'TEXT' || entity.type === 'MTEXT') {
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
    } else if (ent.type === 'CIRCLE') {
      lines.push('0', 'CIRCLE');
      lines.push('8', ent.layer || 'CIRCLES');
      if (colorInt !== null) lines.push('420', String(colorInt));
      lines.push('10', (ent.cx !== undefined ? ent.cx : ent.x || 0).toFixed(6));
      lines.push('20', (ent.cy !== undefined ? ent.cy : ent.y || 0).toFixed(6));
      lines.push('30', '0.0');
      lines.push('40', (ent.r || ent.radius || 0).toFixed(6));
    } else if (ent.type === 'ARC') {
      lines.push('0', 'ARC');
      lines.push('8', ent.layer || 'ARCS');
      if (colorInt !== null) lines.push('420', String(colorInt));
      lines.push('10', (ent.cx !== undefined ? ent.cx : ent.x || 0).toFixed(6));
      lines.push('20', (ent.cy !== undefined ? ent.cy : ent.y || 0).toFixed(6));
      lines.push('30', '0.0');
      lines.push('40', (ent.r || ent.radius || 0).toFixed(6));
      lines.push('50', (ent.startAngle || 0).toFixed(6));
      lines.push('51', (ent.endAngle || 360).toFixed(6));
    } else if (ent.type === 'TEXT' || ent.type === 'MTEXT') {
      lines.push('0', ent.type || 'TEXT');
      lines.push('8', ent.layer || 'TEXTS');
      if (colorInt !== null) lines.push('420', String(colorInt));
      lines.push('10', ent.x.toFixed(6));
      lines.push('20', ent.y.toFixed(6));
      lines.push('30', '0.0');
      lines.push('40', (ent.height || 10).toFixed(6));
      if (ent.rotation) lines.push('50', ent.rotation.toFixed(6));
      if (ent.widthFactor) lines.push('41', ent.widthFactor.toFixed(6));
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

// --- 保存到云端：把编辑后的 CAD 写回本地并上传平台，关联原始 PDF ---
if (btnSaveCloudEdit) {
  btnSaveCloudEdit.addEventListener('click', async () => {
    if (btnSaveCloudEdit.disabled) return;
    if (currentCloudSourceId == null) { customAlert('当前图纸不是云端文件，无法保存到服务器。'); return; }
    if (!currentDxfPath) { customAlert('尚未加载图纸。'); return; }
    if (dxfEntities.length === 0) { customAlert('没有可保存的图元。'); return; }

    const label = btnSaveCloudEdit.querySelector('span');
    const origText = label ? label.textContent : '';
    btnSaveCloudEdit.disabled = true;
    if (label) label.textContent = '保存中...';
    try {
      // 1. 序列化编辑结果，覆盖本地 DXF 文件（保持本地缓存为最新）
      const dxfText = serializeDxfToText(dxfEntities);
      const writeRes = await window.api.saveTextFile(currentDxfPath, dxfText);
      if (!writeRes || writeRes.status !== 'success') {
        customAlert('写入本地文件失败：' + (writeRes ? writeRes.message : '未知错误'));
        return;
      }
      // 2. 上传到平台并关联原始 PDF
      const upRes = await window.api.platformUploadFile(currentDxfPath, currentCloudSourceId, null, true);
      if (upRes && upRes.success) {
        isDirty = false;
        updateDirtyIndicator();
        if (editorStatusTip) editorStatusTip.textContent = '✔ 已保存到云端';
        setTimeout(() => updateDirtyIndicator(), 3000);
        customAlert('保存成功！修改后的 CAD 已上传到云端并关联原始图纸，可在图纸列表中查看。');
      } else {
        customAlert('上传失败：' + ((upRes && upRes.error) || '未知错误'));
      }
    } catch (err) {
      console.error('[SaveCloud] 保存到云端失败:', err);
      customAlert('保存失败：' + err.message);
    } finally {
      btnSaveCloudEdit.disabled = false;
      if (label) label.textContent = origText;
    }
  });
}

// ====== 第三方平台对接 ======

// 全局 token 存储
let platformToken = null;

// 初始化时从主进程获取登录窗口完成登录后的 token
(async function initPlatform() {
  try {
    const token = await window.api.getPlatformToken();
    if (token) {
      platformToken = token;
      console.log('[平台] 初始化获取 token 成功:', token.substring(0, 20) + '...');
    } else {
      console.warn('[平台] 初始化未获取到 token');
    }
  } catch (err) {
    console.warn('[平台] 初始化获取 token 异常（应用继续运行）:', err.message);
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

// ====== 顶部导航切换（编辑 / 设置） ======
const navTabEditor = document.getElementById('nav-tab-editor');
const navTabSettings = document.getElementById('nav-tab-settings');
const dashboardContainer = document.querySelector('.dashboard-container');
const settingsView = document.getElementById('settings-view');
const btnCheckUpdate = document.getElementById('btn-check-update');
const updateStatus = document.getElementById('update-status');
const btnDownloadUpdate = document.getElementById('btn-download-update');
const updateProgressWrap = document.getElementById('update-progress-wrap');
const updateProgressBar = document.getElementById('update-progress');
const updateProgressText = document.getElementById('update-progress-text');
const updateProgressDetail = document.getElementById('update-progress-detail');
const updateProgressSize = document.getElementById('update-progress-size');
const updateProgressSpeed = document.getElementById('update-progress-speed');
const settingsVersionText = document.querySelector('.settings-version');
const btnLogout = document.getElementById('btn-logout');
const settingsUsername = document.getElementById('settings-username');

// 设置页显示当前真实应用版本与登录用户
(async () => {
  if (settingsVersionText && window.api.getAppVersion) {
    const ver = await window.api.getAppVersion();
    if (ver) settingsVersionText.textContent = `当前版本 v${ver}`;
  }
  if (settingsUsername && window.api.getLoginUser) {
    const username = await window.api.getLoginUser();
    settingsUsername.textContent = username || '未登录';
  }
})();

// 退出登录：清凭据 → 回登录界面
if (btnLogout) {
  btnLogout.addEventListener('click', async () => {
    if (await customConfirm('确定要退出登录吗？退出后将返回登录界面。')) {
      await window.api.platformLogout();
    }
  });
}

function switchNavView(view) {
  const isSettings = view === 'settings';
  navTabEditor.classList.toggle('active', !isSettings);
  navTabSettings.classList.toggle('active', isSettings);
  dashboardContainer.classList.toggle('hidden', isSettings);
  settingsView.classList.toggle('hidden', !isSettings);
}

navTabEditor.addEventListener('click', () => switchNavView('editor'));
navTabSettings.addEventListener('click', () => switchNavView('settings'));

// ====== 检查与下载更新（GitHub Release + 差分增量 + 国内 CDN 加速） ======
let latestUpdate = null;

// 下载进度与速度实时回报
if (window.api.onUpdateDownloadProgress) {
  window.api.onUpdateDownloadProgress((info) => {
    const pct = typeof info === 'object' ? info.pct : info;
    updateProgressBar.style.width = `${pct}%`;
    updateProgressText.textContent = `${pct}%`;

    if (typeof info === 'object' && updateProgressDetail) {
      updateProgressDetail.style.display = 'flex';
      if (updateProgressSize) {
        updateProgressSize.textContent = `${info.downloadedMb} MB / ${info.totalMb} MB`;
      }
      if (updateProgressSpeed) {
        updateProgressSpeed.textContent = info.pct >= 100 ? '下载完成' : `${info.speedMb} MB/s`;
      }
    }
  });
}

btnCheckUpdate.addEventListener('click', async () => {
  updateStatus.textContent = '正在检查更新...';
  btnDownloadUpdate.classList.add('hidden');
  if (updateProgressDetail) updateProgressDetail.style.display = 'none';
  const res = await window.api.checkForUpdate();
  if (!res.success) {
    updateStatus.textContent = `检查更新失败：${res.error}`;
    return;
  }
  if (!res.hasUpdate) {
    updateStatus.textContent = `当前已是最新版本（v${res.currentVersion}）`;
    return;
  }
  latestUpdate = res;
  const hasFiles = res.parts && res.parts.length > 0;
  if (!hasFiles) {
    updateStatus.textContent = `发现新版本 ${res.latestVersion}（当前 v${res.currentVersion}），但该版本未上传可用文件，请前往发布页手动下载`;
    return;
  }

  const sizeMb = (res.totalSize / 1024 / 1024).toFixed(1);
  if (res.isPatch) {
    updateStatus.innerHTML = `发现新版本 <strong>${res.latestVersion}</strong>（当前 v${res.currentVersion}）<br><span style="color:#10b981;font-size:12px;">⚡ 支持极速差分增量升级（仅 ${sizeMb} MB，秒级重启生效）</span>`;
    btnDownloadUpdate.textContent = '立即增量升级';
  } else {
    updateStatus.innerHTML = `发现新版本 <strong>${res.latestVersion}</strong>（当前 v${res.currentVersion}）<br><span style="font-size:12px;color:var(--text-secondary,#999);">📦 全量安装包（约 ${sizeMb} MB）</span>`;
    btnDownloadUpdate.textContent = '下载并安装更新';
  }
  btnDownloadUpdate.classList.remove('hidden');
});

btnDownloadUpdate.addEventListener('click', async () => {
  if (!latestUpdate || !latestUpdate.parts || latestUpdate.parts.length === 0) return;
  btnDownloadUpdate.disabled = true;
  btnDownloadUpdate.querySelector('span')?.remove();
  btnDownloadUpdate.style.opacity = '0.7';
  updateStatus.textContent = latestUpdate.isPatch ? '正在极速下载增量更新包...' : '正在下载更新...';
  updateProgressWrap.classList.remove('hidden');
  updateProgressBar.style.width = '0%';
  updateProgressText.textContent = '0%';
  if (updateProgressDetail) {
    updateProgressDetail.style.display = 'flex';
    if (updateProgressSize) updateProgressSize.textContent = '准备下载...';
    if (updateProgressSpeed) updateProgressSpeed.textContent = '';
  }

  const dl = await window.api.downloadUpdate(latestUpdate.parts, latestUpdate.totalSize);
  if (!dl.success) {
    updateStatus.textContent = `下载失败：${dl.error}`;
    updateProgressWrap.classList.add('hidden');
    if (updateProgressDetail) updateProgressDetail.style.display = 'none';
    btnDownloadUpdate.disabled = false;
    btnDownloadUpdate.style.opacity = '';
    return;
  }

  updateProgressBar.style.width = '100%';
  updateProgressText.textContent = '100%';
  updateStatus.textContent = latestUpdate.isPatch ? '下载完成，正在替换并重启应用...' : '下载完成，正在启动安装程序...';
  
  const inst = await window.api.installUpdate(dl.path, latestUpdate.isPatch);
  if (!inst.success) {
    updateStatus.textContent = `更新失败：${inst.error}`;
    btnDownloadUpdate.disabled = false;
    btnDownloadUpdate.style.opacity = '';
  } else if (inst.message) {
    updateStatus.textContent = inst.message;
  }
});
