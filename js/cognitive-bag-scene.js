import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const ZONES = Array.from({ length: 6 }, (_, index) => ({ angle: index % 2 ? .43 : -.43, y: 1.18 - Math.floor(index / 2) * 1.16 }));
const validZone = value => Number.isInteger(value) && value >= 0 && value < 6;

/** Real leather, curved tape and physical swing; the game remains the owner of rules and time. */
export function createCognitiveBagScene(host, { onHit = () => {}, onUnavailable = () => {} } = {}) {
  const doc = host.ownerDocument, view = doc.defaultView;
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(view.devicePixelRatio || 1, 1.65));
  renderer.setClearColor(0x11151b, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement;
  canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:pan-y pinch-zoom;';
  canvas.setAttribute('aria-hidden', 'true');
  const originalPosition = host.style.position;
  if (view.getComputedStyle(host).position === 'static') host.style.position = 'relative';
  host.append(canvas);

  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(33, 1, .1, 50);
  const pivot = new THREE.Group(), bag = new THREE.Group();
  pivot.position.y = 3.63; bag.position.y = -3.63; pivot.add(bag); scene.add(pivot);
  const geometries = new Set(), materials = new Set(), textures = new Set();
  const buttons = [], hitAreas = [], tapeMeshes = [], highlights = [], impulses = [];
  const stitchGeometries = [];
  let stitchFinish;
  let disposed = false, frame = 0, observer, environmentTarget, enabled = true, pointer = null, previousKey = '';
  const reducedMotion = view.matchMedia?.('(prefers-reduced-motion: reduce)');
  const material = (Type, options) => { const value = new Type(options); materials.add(value); return value; };
  const geometry = value => { geometries.add(value); return value; };
  const trackTexture = value => { textures.add(value); return value; };
  const mesh = (shape, finish, parent = bag) => {
    const value = new THREE.Mesh(geometry(shape), finish); value.castShadow = true; value.receiveShadow = true; parent.add(value); return value;
  };
  const hash = (x, y, salt = 0) => {
    let n = (Math.imul(x + salt, 374761393) + Math.imul(y, 668265263)) | 0;
    n = Math.imul(n ^ n >>> 13, 1274126177); return ((n ^ n >>> 16) >>> 0) / 4294967295;
  };
  function canvasTexture(width, height, draw, colorSpace = THREE.SRGBColorSpace) {
    const surface = doc.createElement('canvas'); surface.width = width; surface.height = height;
    const context = surface.getContext('2d');
    if (!context) throw new Error('Le canevas nécessaire au sac 3D est indisponible.');
    draw(context, width, height);
    const value = trackTexture(new THREE.CanvasTexture(surface)); value.colorSpace = colorSpace;
    value.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); return value;
  }
  function radius(y, angle = 0) {
    const edge = Math.min(1, Math.abs(y) / 2.16), folds = Math.pow(edge, 7);
    return 1.155 - .17 * Math.pow(edge, 10) + .011 * Math.sin(y * 4 + angle * 3)
      + folds * (.022 * Math.sin(angle * 19 + y * 8) + .014 * Math.sin(angle * 31 - y * 12))
      + .003 * Math.sin(y * 28 + angle * 11);
  }
  const point = (angle, y, offset = 0) => {
    const r = radius(y, angle) + offset; return new THREE.Vector3(Math.sin(angle) * r, y, Math.cos(angle) * r);
  };
  function surfaceGeometry(angleStart, angleWidth, bottom, height, xSegments = 20, ySegments = 16, offset = .012, crease = false) {
    const positions = [], uvs = [], indices = [];
    for (let row = 0; row <= ySegments; row++) for (let col = 0; col <= xSegments; col++) {
      const u = col / xSegments, v = row / ySegments, angle = angleStart + angleWidth * u, y = bottom + height * v;
      const wrinkle = crease ? .005 * Math.sin(u * 28 + v * 7) + .006 * Math.sin(v * 23 - u * 9) + .02 * Math.pow(Math.abs(u - .5) * 2, 8) * Math.sin(v * 12) ** 2 : 0;
      const p = point(angle, y, offset + wrinkle); positions.push(p.x, p.y, p.z); uvs.push(u, v);
      if (col < xSegments && row < ySegments) {
        const a = row * (xSegments + 1) + col, b = a + xSegments + 1;
        indices.push(a, a + 1, b + 1, a, b + 1, b);
      }
    }
    const value = new THREE.BufferGeometry(); value.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    value.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); value.setIndex(indices); value.computeVertexNormals(); return value;
  }
  function tube(points, thickness, finish, segments = 64, parent = bag) {
    const shape = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), segments, thickness, 5, false);
    if (finish === stitchFinish) { stitchGeometries.push(geometry(shape)); return null; }
    return mesh(shape, finish, parent);
  }
  function ring(radiusValue, thickness, finish, x, y, z, parent = bag) {
    const value = mesh(new THREE.TorusGeometry(radiusValue, thickness, 8, 32), finish, parent); value.position.set(x, y, z); return value;
  }

  function repositionButtons() {
    if (disposed) return;
    pivot.updateMatrixWorld(true);
    for (let index = 0; index < buttons.length; index++) {
      const zone = ZONES[index], projections = [];
      for (const dx of [-.35, .35]) for (const dy of [-.45, .45]) projections.push(bag.localToWorld(point(zone.angle + dx, zone.y + dy, .025)).project(camera));
      const left = Math.min(...projections.map(p => (p.x + 1) * host.clientWidth / 2));
      const right = Math.max(...projections.map(p => (p.x + 1) * host.clientWidth / 2));
      const top = Math.min(...projections.map(p => (1 - p.y) * host.clientHeight / 2));
      const bottom = Math.max(...projections.map(p => (1 - p.y) * host.clientHeight / 2));
      const button = buttons[index];
      button.style.left = `${(left + right) / 2}px`; button.style.top = `${(top + bottom) / 2}px`;
      button.style.width = `${Math.max(44, right - left)}px`; button.style.height = `${Math.max(44, bottom - top)}px`;
    }
  }
  function render() {
    if (disposed || frame) return;
    frame = view.requestAnimationFrame(time => {
      frame = 0;
      if (disposed) return;
      if (reducedMotion?.matches) impulses.length = 0;
      while (impulses.length && time - impulses[0].time > 2100) impulses.shift();
      pivot.rotation.x = 0; pivot.rotation.z = 0;
      for (const impulse of impulses) {
        const age = (time - impulse.time) / 1000, swing = Math.exp(-age * 2.7) * Math.sin(age * 10);
        pivot.rotation.x += swing * .046; pivot.rotation.z += swing * impulse.direction * .032;
      }
      pivot.rotation.x = THREE.MathUtils.clamp(pivot.rotation.x, -.08, .08);
      pivot.rotation.z = THREE.MathUtils.clamp(pivot.rotation.z, -.06, .06);
      if (host.clientWidth && host.clientHeight) { renderer.render(scene, camera); repositionButtons(); }
      if (impulses.length) render();
    });
  }

  try {
    const environment = new RoomEnvironment(), generator = new THREE.PMREMGenerator(renderer);
    try { environmentTarget = generator.fromScene(environment, .08); scene.environment = environmentTarget.texture; }
    finally { generator.dispose(); environment.dispose(); }
    scene.environmentIntensity = .32;
    scene.add(new THREE.HemisphereLight(0xdce9ff, 0x322824, .8));
    const key = new THREE.DirectionalLight(0xffefd9, 3.4); key.position.set(-3.6, 6, 5); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024); Object.assign(key.shadow.camera, { left: -4, right: 4, top: 5, bottom: -5, near: .5, far: 20 });
    key.shadow.normalBias = .03; key.shadow.bias = -.0002; key.shadow.radius = 3; scene.add(key);
    const rim = new THREE.DirectionalLight(0xa8c7ef, 2.1); rim.position.set(4, 2, -3); scene.add(rim);
    const fill = new THREE.DirectionalLight(0xdfedff, .5); fill.position.set(2, 1, 7); scene.add(fill);

    const leatherMap = canvasTexture(1024, 1024, (context, width, height) => {
      const pixels = context.createImageData(width, height);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const noise = hash(x, y), slow = hash(Math.floor(x / 36), Math.floor(y / 36));
        const shade = 30 + noise * 11 + slow * 3, index = (y * width + x) * 4;
        pixels.data.set([shade, shade + 1, shade + 1, 255], index);
      }
      context.putImageData(pixels, 0, 0);
      for (const [index, zone] of ZONES.entries()) {
        const cx = (zone.angle / (Math.PI * 2) + .5) * width, cy = (1 - (zone.y + 2.16) / 4.32) * height;
        const rx = .36 / (Math.PI * 2) * width, ry = .48 / 4.32 * height;
        context.save(); context.translate(cx, cy); context.scale(rx, ry);
        const gradient = context.createRadialGradient(-.06, -.1, .07, 0, 0, 1.15);
        gradient.addColorStop(0, 'rgba(160,151,132,.54)'); gradient.addColorStop(.57, 'rgba(140,135,121,.37)'); gradient.addColorStop(.84, 'rgba(133,127,115,.18)'); gradient.addColorStop(1, 'rgba(96,90,82,0)');
        context.fillStyle = gradient; context.fillRect(-1.3, -1.3, 2.6, 2.6); context.restore();
        for (let scratch = 0; scratch < 220; scratch++) {
          const angle = hash(scratch, index, 71) * Math.PI * 2, distance = Math.sqrt(hash(scratch, index, 22));
          const x = cx + Math.cos(angle) * rx * distance, y = cy + Math.sin(angle) * ry * distance;
          context.strokeStyle = `rgba(187,178,160,${.035 + hash(scratch, index, 35) * .12})`; context.lineWidth = .5 + hash(scratch, index, 48);
          context.beginPath(); context.moveTo(x, y); context.lineTo(x + hash(scratch, index, 39) * 4 - 2, y + hash(scratch, index, 96) * 9 - 4); context.stroke();
        }
      }
      // Small handling scuffs and naturally uneven stitching shadows.
      for (let index = 0; index < 850; index++) {
        const x = hash(index, 8) * width, y = hash(index, 19) * height;
        context.strokeStyle = `rgba(155,152,143,${hash(index, 36) * .10})`; context.lineWidth = .7;
        context.beginPath(); context.moveTo(x, y); context.lineTo(x + hash(index, 42) * 5 - 2.5, y + hash(index, 52) * 11 - 5.5); context.stroke();
      }
    });
    const grainMap = canvasTexture(512, 512, (context, width, height) => {
      const pixels = context.createImageData(width, height), cell = 8;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const gx = Math.floor(x / cell), gy = Math.floor(y / cell); let first = 99, second = 99;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const px = (gx + dx + hash(gx + dx, gy + dy, 43)) * cell, py = (gy + dy + hash(gx + dx, gy + dy, 84)) * cell;
          const distance = Math.hypot(px - x, py - y);
          if (distance < first) { second = first; first = distance; } else if (distance < second) second = distance;
        }
        const crease = Math.min(1, (second - first) * 1.4), shade = 75 + crease * 83 + hash(x, y) * 38, index = (y * width + x) * 4;
        pixels.data.set([shade, shade, shade, 255], index);
      }
      context.putImageData(pixels, 0, 0);
    }, THREE.NoColorSpace);
    grainMap.wrapS = grainMap.wrapT = THREE.RepeatWrapping; grainMap.repeat.set(2, 3);
    const leather = material(THREE.MeshStandardMaterial, { map: leatherMap, roughness: .76, metalness: .025, bumpMap: grainMap, bumpScale: .022 });
    const seamLeather = material(THREE.MeshStandardMaterial, { color: 0x1f2223, roughness: .72, bumpMap: grainMap, bumpScale: .012 });
    const thread = material(THREE.MeshStandardMaterial, { color: 0x756f64, roughness: .95 });
    stitchFinish = thread;
    const steel = material(THREE.MeshStandardMaterial, { color: 0x8d969f, metalness: .97, roughness: .25 });
    const darkSteel = material(THREE.MeshStandardMaterial, { color: 0x373d43, metalness: .85, roughness: .39 });
    const bagShell = mesh(surfaceGeometry(-Math.PI, Math.PI * 2, -2.16, 4.32, 112, 86, 0), leather);
    bagShell.name = 'Sac en cuir avec zones usées intégrées';
    for (const y of [-2.155, 2.155]) {
      const cap = mesh(new THREE.CircleGeometry(.998, 72), seamLeather); cap.rotation.x = y > 0 ? -Math.PI / 2 : Math.PI / 2; cap.position.y = y;
    }
    const topPiping = Array.from({ length: 97 }, (_, index) => point(index / 96 * Math.PI * 2, 2.065, .009));
    const bottomPiping = Array.from({ length: 97 }, (_, index) => point(index / 96 * Math.PI * 2, -2.03, .009));
    tube(topPiping, .021, seamLeather, 96); tube(bottomPiping, .021, seamLeather, 96);
    for (const angle of [-1.22, 1.22, Math.PI]) {
      tube(Array.from({ length: 65 }, (_, i) => point(angle, -2.03 + 4.1 * i / 64, .006)), .018, seamLeather, 72);
      for (let stitch = 0; stitch < 48; stitch++) {
        const y = -1.98 + stitch * .083;
        tube([point(angle - .023, y, .015), point(angle - .025, y + .035, .015)], .0037, thread, 1);
        tube([point(angle + .023, y + .009, .015), point(angle + .024, y + .042, .015)], .0037, thread, 1);
      }
    }
    for (const y of [-1.98, 2.025]) for (let index = 0; index < 74; index++) {
      const angle = index / 74 * Math.PI * 2;
      tube([point(angle, y, .015), point(angle + .036, y, .015)], .0038, thread, 1);
    }

    // Four reinforced suspension tabs and individually interlocked steel links.
    for (const angle of [-.79, .79, 2.36, -2.36]) {
      const strap = mesh(surfaceGeometry(angle - .13, .26, 1.69, .49, 7, 6, .028), seamLeather);
      strap.name = 'Patte de suspension cousue';
      for (const side of [-.105, .105]) for (let row = 0; row < 6; row++) tube([point(angle + side, 1.76 + row * .056, .045), point(angle + side, 1.785 + row * .056, .045)], .0045, thread, 1);
      const anchor = point(angle, 2.22, -.015);
      const loop = ring(.12, .027, darkSteel, anchor.x, 2.245, anchor.z); loop.rotation.y = angle;
      const end = new THREE.Vector3(.055 * Math.sin(angle), 3.55, .055 * Math.cos(angle));
      const start = new THREE.Vector3(anchor.x, 2.32, anchor.z), chainDirection = end.clone().sub(start).normalize();
      const length = start.distanceTo(end), count = Math.round(length / .128);
      for (let link = 0; link < count; link++) {
        const center = start.clone().lerp(end, (link + .4) / count);
        const chain = ring(.07, .018, steel, center.x, center.y, center.z); chain.scale.y = 1.38;
        chain.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), chainDirection);
        chain.rotateY(link % 2 ? Math.PI / 2 : 0);
      }
    }
    mesh(mergeGeometries(stitchGeometries, false), thread);
    ring(.112, .035, steel, 0, 3.62, 0);
    const hook = tube([new THREE.Vector3(0, 3.69, 0), new THREE.Vector3(-.11, 3.8, 0), new THREE.Vector3(0, 3.94, 0), new THREE.Vector3(.10, 3.85, 0)], .031, steel, 20, scene);
    hook.name = 'Crochet fixe';

    function drawNumber(context, index) {
      context.strokeStyle = '#171817'; context.lineWidth = 19; context.lineJoin = context.lineCap = 'round';
      context.save(); context.translate(128, 128); context.rotate((index % 2 ? -1 : 1) * .055); context.translate(-128, -128);
      context.beginPath();
      if (index === 0) { context.moveTo(91, 90); context.lineTo(134, 52); context.lineTo(132, 204); }
      if (index === 1) { context.moveTo(79, 89); context.bezierCurveTo(94, 29, 185, 35, 175, 98); context.bezierCurveTo(170, 128, 98, 153, 78, 203); context.lineTo(182, 198); }
      if (index === 2) { context.moveTo(78, 61); context.bezierCurveTo(132, 34, 198, 55, 162, 106); context.lineTo(123, 126); context.bezierCurveTo(210, 107, 194, 209, 111, 202); context.lineTo(77, 186); }
      if (index === 3) { context.moveTo(148, 53); context.lineTo(73, 152); context.lineTo(191, 153); context.moveTo(160, 67); context.lineTo(155, 204); }
      if (index === 4) { context.moveTo(183, 56); context.lineTo(92, 58); context.lineTo(86, 126); context.bezierCurveTo(189, 78, 212, 207, 112, 206); context.lineTo(77, 184); }
      if (index === 5) { context.moveTo(171, 57); context.bezierCurveTo(82, 43, 58, 178, 114, 203); context.bezierCurveTo(179, 228, 203, 133, 151, 122); context.bezierCurveTo(125, 114, 104, 126, 87, 145); }
      context.stroke(); context.restore();
    }
    const glowMap = canvasTexture(128, 128, (context, width, height) => {
      const gradient = context.createRadialGradient(width / 2, height / 2, width * .17, width / 2, height / 2, width * .49);
      gradient.addColorStop(0, 'rgba(255,255,255,.16)'); gradient.addColorStop(.53, 'rgba(255,255,255,.22)'); gradient.addColorStop(.78, 'rgba(255,255,255,.78)'); gradient.addColorStop(.89, 'rgba(255,255,255,.38)'); gradient.addColorStop(1, 'rgba(255,255,255,0)');
      context.fillStyle = gradient; context.fillRect(0, 0, width, height);
    });
    for (const [index, zone] of ZONES.entries()) {
      const tapeMap = canvasTexture(256, 256, context => {
        context.beginPath();
        for (let step = 0; step <= 16; step++) { const x = 7 + step * 15, y = 17 + hash(step, index, 47) * 10; step ? context.lineTo(x, y) : context.moveTo(x, y); }
        for (let step = 0; step <= 15; step++) context.lineTo(237 + hash(step, index, 42) * 10, 26 + step * 14);
        for (let step = 16; step >= 0; step--) context.lineTo(7 + step * 15, 235 + hash(step, index, 82) * 9);
        for (let step = 15; step >= 0; step--) context.lineTo(7 + hash(step, index, 95) * 10, 26 + step * 14);
        context.closePath(); context.fillStyle = '#dfdacb'; context.fill(); context.save(); context.clip();
        for (let row = 0; row < 256; row++) { context.fillStyle = `rgba(61,52,42,${hash(row, index, 33) * .05})`; context.fillRect(0, row, 256, 1); }
        for (let line = 0; line < 8; line++) {
          const x = 23 + hash(line, index, 99) * 216;
          const gradient = context.createLinearGradient(x - 8, 0, x + 8, 0);
          gradient.addColorStop(0, 'rgba(80,68,48,0)'); gradient.addColorStop(.43, 'rgba(80,68,48,.13)'); gradient.addColorStop(.53, 'rgba(255,255,255,.24)'); gradient.addColorStop(1, 'rgba(255,255,255,0)');
          context.save(); context.rotate((hash(line, index, 57) - .5) * .2); context.fillStyle = gradient; context.fillRect(x - 8, 0, 16, 256); context.restore();
        }
        for (let speck = 0; speck < 500; speck++) { context.fillStyle = `rgba(94,74,51,${hash(speck, index, 63) * .10})`; context.fillRect(hash(speck, index, 21) * 256, hash(speck, index, 64) * 256, 1, 2); }
        drawNumber(context, index); context.restore();
      });
      const tapeMaterial = material(THREE.MeshStandardMaterial, { map: tapeMap, transparent: true, alphaTest: .35, roughness: .93, metalness: 0, side: THREE.DoubleSide });
      const tape = mesh(surfaceGeometry(zone.angle - .30, .60, zone.y - .35, .7, 20, 20, .018, true), tapeMaterial); tape.castShadow = false; tape.name = `Ruban ${index + 1}`; tapeMeshes.push(tape);
      const glowMaterial = material(THREE.MeshBasicMaterial, { map: glowMap, transparent: true, color: 0xffd878, opacity: .85, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending });
      const glow = mesh(surfaceGeometry(zone.angle - .41, .82, zone.y - .5, 1, 22, 20, .055), glowMaterial); glow.castShadow = glow.receiveShadow = false; glow.visible = false; highlights.push(glow);
      const hitArea = mesh(surfaceGeometry(zone.angle - .36, .72, zone.y - .45, .90, 8, 8, .06), material(THREE.MeshBasicMaterial, { colorWrite: false, depthWrite: false }));
      hitArea.castShadow = hitArea.receiveShadow = false; hitArea.userData.zone = index; hitAreas.push(hitArea);

      const button = doc.createElement('button'); button.type = 'button'; button.className = 'cognitive-bag-zone';
      button.setAttribute('aria-label', `Zone ${index + 1}`); button.dataset.zone = String(index);
      button.style.cssText = 'position:absolute;z-index:2;transform:translate(-50%,-50%);min-width:44px;min-height:44px;padding:0;margin:0;border:0;border-radius:38%;background:transparent;box-shadow:none;touch-action:pan-y pinch-zoom;cursor:crosshair;';
      button.addEventListener('focus', () => { if (button.matches(':focus-visible')) { button.style.outline = '2px solid #f6da97'; button.style.outlineOffset = '2px'; } });
      button.addEventListener('blur', () => { button.style.outline = 'none'; });
      button.addEventListener('pointerdown', event => beginPointer(event, index));
      button.addEventListener('pointerup', endPointer); button.addEventListener('pointercancel', cancelPointer);
      button.addEventListener('click', event => { if (event.detail === 0 && enabled && !disposed) onHit(index); });
      buttons.push(button); host.append(button);
    }

    // Static links, piping and tabs share draws; only the bag as a whole swings.
    for (const finish of [steel, darkSteel, seamLeather]) {
      const parts = bag.children.filter(object => object.isMesh && object.material === finish);
      if (parts.length < 2) continue;
      const shapes = parts.map(part => { part.updateMatrix(); return geometry(part.geometry.clone().applyMatrix4(part.matrix)); });
      const combined = mergeGeometries(shapes, false);
      if (combined) { for (const part of parts) bag.remove(part); mesh(combined, finish); }
    }

    const floor = mesh(new THREE.PlaneGeometry(14, 14), material(THREE.ShadowMaterial, { opacity: .24 }), scene);
    floor.rotation.x = -Math.PI / 2; floor.position.y = -2.55; floor.castShadow = false;
    const shadowMap = canvasTexture(128, 128, (context, width, height) => {
      const gradient = context.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, width / 2);
      gradient.addColorStop(0, 'rgba(0,0,0,.65)'); gradient.addColorStop(.35, 'rgba(0,0,0,.40)'); gradient.addColorStop(1, 'rgba(0,0,0,0)'); context.fillStyle = gradient; context.fillRect(0, 0, width, height);
    });
    const shadow = mesh(new THREE.PlaneGeometry(4.6, 3.3), material(THREE.MeshBasicMaterial, { map: shadowMap, transparent: true, depthWrite: false }), scene);
    shadow.rotation.x = -Math.PI / 2; shadow.position.set(0, -2.548, 0); shadow.castShadow = shadow.receiveShadow = false;
  } catch (error) { destroy(); throw error; }

  const raycaster = new THREE.Raycaster(), pointerPosition = new THREE.Vector2();
  function zoneAt(event) {
    const rect = canvas.getBoundingClientRect(); if (!rect.width || !rect.height) return null;
    pointerPosition.set((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
    raycaster.setFromCamera(pointerPosition, camera);
    return raycaster.intersectObjects(hitAreas, false)[0]?.object.userData.zone ?? null;
  }
  function beginPointer(event, index = zoneAt(event)) {
    if (!enabled || disposed || event.button !== 0 || !validZone(index) || pointer) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, index };
  }
  function endPointer(event) {
    if (!pointer || pointer.id !== event.pointerId) return;
    const down = pointer; pointer = null;
    if (enabled && !disposed && Math.hypot(event.clientX - down.x, event.clientY - down.y) < 13) onHit(down.index);
  }
  function cancelPointer() { pointer = null; }
  function contextLost(event) { event.preventDefault(); if (!disposed) onUnavailable(); }
  canvas.addEventListener('pointerdown', beginPointer); canvas.addEventListener('pointerup', endPointer); canvas.addEventListener('pointercancel', cancelPointer);
  canvas.addEventListener('webglcontextlost', contextLost);
  doc.addEventListener('pointerup', endPointer); doc.addEventListener('pointercancel', cancelPointer);

  function resize() {
    if (disposed || !host.clientWidth || !host.clientHeight) return;
    const width = host.clientWidth, height = host.clientHeight; renderer.setSize(width, height, false); camera.aspect = width / height;
    const distance = Math.max(11.8, 4.4 / camera.aspect);
    camera.position.set(0, 1.0, distance); camera.lookAt(0, .65, 0); camera.updateProjectionMatrix(); camera.updateMatrixWorld(); render();
  }
  function update({ numbers = true, enabled: canHit = true, target = null, flash = null } = {}) {
    if (disposed) return;
    enabled = Boolean(canHit);
    const flashIndex = validZone(flash) ? flash : validZone(flash?.index) ? flash.index : null;
    const correct = typeof flash === 'object' && flash !== null ? flash.correct !== false : true;
    const key = `${numbers}:${enabled}:${target}:${flashIndex}:${correct}`;
    if (key === previousKey) return; previousKey = key;
    for (let index = 0; index < 6; index++) {
      tapeMeshes[index].visible = Boolean(numbers); buttons[index].disabled = !enabled;
      buttons[index].style.cursor = enabled ? 'crosshair' : 'default';
      const highlighted = target === index || flashIndex === index;
      highlights[index].visible = highlighted;
      highlights[index].material.color.set(flashIndex === index ? correct ? 0x83edac : 0xff816f : 0xffd878);
      highlights[index].material.opacity = flashIndex === index ? .94 : .73;
    }
    if (!enabled) cancelPointer(); render();
  }
  function hit(index) {
    if (disposed || !validZone(index) || reducedMotion?.matches) return;
    impulses.push({ time: view.performance.now(), direction: index % 2 ? -1 : 1 });
    if (impulses.length > 3) impulses.shift(); render();
  }
  function destroy() {
    if (disposed) return; disposed = true;
    if (frame) view.cancelAnimationFrame(frame); observer?.disconnect();
    canvas.removeEventListener('pointerdown', beginPointer); canvas.removeEventListener('pointerup', endPointer); canvas.removeEventListener('pointercancel', cancelPointer); canvas.removeEventListener('webglcontextlost', contextLost);
    doc.removeEventListener('pointerup', endPointer); doc.removeEventListener('pointercancel', cancelPointer);
    for (const button of buttons) button.remove();
    for (const value of geometries) value.dispose(); for (const value of materials) value.dispose(); for (const value of textures) value.dispose();
    scene.traverse(object => object.shadow?.dispose());
    environmentTarget?.dispose(); renderer.dispose(); renderer.forceContextLoss(); canvas.remove(); host.style.position = originalPosition;
  }
  if (view.ResizeObserver) { observer = new view.ResizeObserver(resize); observer.observe(host); }
  resize(); update();
  return { update, hit, resize, destroy };
}
