import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/**
 * Procedural geometry, not a flat illustration: bevelled oak frame, granular cork,
 * curved paper sheets and cast-shadow thumbtacks. Real HTML remains the accessible
 * text/link layer. The orthographic camera preserves alignment and small-screen legibility.
 */
export function createBulletinBoardScene(host, { surface, onFallback = () => {} } = {}) {
  const doc = host.ownerDocument, view = doc.defaultView;
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
  renderer.setClearColor(0x000000, 0); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.setPixelRatio(Math.min(view.devicePixelRatio || 1, 1.5));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.setAttribute('aria-hidden', 'true'); host.append(renderer.domElement);
  const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-5, 5, 4, -4, .1, 80);
  camera.position.set(0, 0, 18); camera.lookAt(0, 0, 0);
  const textures = new Set(), materials = new Set(), geometries = new Set();
  const boardGroup = new THREE.Group(), papers = new THREE.Group(); scene.add(boardGroup, papers);
  let disposed = false, environmentTarget = null, frame = 0, dimensions = '', cards = [], noteShape = '';
  let boardGeometry = [], paperGeometry = [];
  const material = (Type, value) => { const result = new Type(value); materials.add(result); return result; };
  const mesh = (shape, finish, parent, pool) => {
    geometries.add(shape); pool?.push(shape);
    const result = new THREE.Mesh(shape, finish); result.castShadow = true; result.receiveShadow = true; parent.add(result); return result;
  };
  function texture(width, height, draw, { repeat = false, color = true } = {}) {
    const canvas = doc.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d'); if (!context) throw new Error('Canevas indisponible.');
    draw(context, width, height);
    const map = new THREE.CanvasTexture(canvas); textures.add(map);
    map.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    if (repeat) map.wrapS = map.wrapT = THREE.RepeatWrapping;
    return map;
  }
  function clear(group, pool) {
    group.clear(); for (const shape of pool) { shape.dispose(); geometries.delete(shape); }
    pool.length = 0;
  }
  function render() {
    if (disposed || frame) return;
    frame = view.requestAnimationFrame(() => {
      frame = 0;
      if (!disposed && host.clientWidth && host.clientHeight) renderer.render(scene, camera);
    });
  }
  function contextLost(event) { event.preventDefault(); if (!disposed) { onFallback(); destroy(); } }
  function destroy() {
    if (disposed) return;
    disposed = true;
    if (frame) view.cancelAnimationFrame(frame);
    renderer.domElement.removeEventListener('webglcontextlost', contextLost);
    for (const value of geometries) value.dispose();
    for (const value of materials) value.dispose();
    for (const value of textures) value.dispose();
    environmentTarget?.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
  }
  renderer.domElement.addEventListener('webglcontextlost', contextLost);
  try {
    const environment = new RoomEnvironment(), generator = new THREE.PMREMGenerator(renderer);
    try { environmentTarget = generator.fromScene(environment, .07); scene.environment = environmentTarget.texture; }
    finally { environment.dispose(); generator.dispose(); }
    scene.environmentIntensity = .38;
    scene.add(new THREE.HemisphereLight(0xfff5df, 0x796248, 1.55));
    const key = new THREE.DirectionalLight(0xfff6e6, 2.6); key.position.set(-5, 8, 10);
    key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -.00014; key.shadow.normalBias = .003; key.shadow.radius = 4;
    scene.add(key, key.target);
    const fill = new THREE.DirectionalLight(0xe9f0fa, .7); fill.position.set(4, -1, 9); scene.add(fill);
    let seed = 91271;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const cork = texture(1024, 1024, (context, width, height) => {
      context.fillStyle = '#ae8556'; context.fillRect(0, 0, width, height);
      // Cork is irregular bark flakes at several scales, with darker pores between them.
      for (let index = 0; index < 47000; index++) {
        const x = random() * width, y = random() * height, size = 1 + random() * (index < 14000 ? 10 : 3.4);
        const shade = Math.floor(95 + random() * 104), red = shade + 27, green = shade - 5, blue = shade - 47;
        context.fillStyle = `rgba(${red},${green},${Math.max(20, blue)},${.26 + random() * .58})`;
        context.beginPath(); const points = 4 + Math.floor(random() * 4);
        for (let point = 0; point < points; point++) {
          const angle = point * Math.PI * 2 / points, radius = size * (.5 + random() * .5);
          const px = x + Math.cos(angle) * radius, py = y + Math.sin(angle) * radius * .7;
          if (!point) context.moveTo(px, py); else context.lineTo(px, py);
        }
        context.closePath(); context.fill();
        if (index < 9000) { context.strokeStyle = '#4c31151d'; context.lineWidth = .7; context.stroke(); }
      }
      for (let index = 0; index < 4000; index++) {
        context.fillStyle = random() > .5 ? '#efd6a23d' : '#4e36172d'; context.fillRect(random() * width, random() * height, .5 + random() * 1.6, .5 + random());
      }
    }, { repeat: true });
    const corkBump = cork.clone(); corkBump.colorSpace = THREE.NoColorSpace; textures.add(corkBump);
    const corkFinish = material(THREE.MeshStandardMaterial, { map: cork, bumpMap: corkBump, bumpScale: .038, roughness: .98, color: 0xc49c72 });
    const wood = texture(1024, 256, (context, width, height) => {
      context.fillStyle = '#80512e'; context.fillRect(0, 0, width, height);
      for (let row = 0; row < 900; row++) {
        const base = random() * height, amplitude = 1.2 + random() * 3.3;
        context.strokeStyle = row % 3 ? `rgba(43,20,5,${.035 + random() * .21})` : `rgba(233,176,98,${.08 + random() * .26})`;
        context.lineWidth = .3 + random() * 1.25; context.beginPath();
        for (let x = 0; x <= width; x += 7) {
          const y = base + Math.sin(x / (90 + base) + base) * amplitude + Math.sin(x / 30 + base * 4) * .6;
          if (!x) context.moveTo(x, y); else context.lineTo(x, y);
        }
        context.stroke();
      }
      const sheen = context.createLinearGradient(0, 0, 0, height); sheen.addColorStop(0, '#f4c47c3a'); sheen.addColorStop(.28, '#f4c47c0a'); sheen.addColorStop(.72, '#20100312'); sheen.addColorStop(1, '#2010033a'); context.fillStyle = sheen; context.fillRect(0, 0, width, height);
    }, { repeat: true });
    const woodVertical = wood.clone(); textures.add(woodVertical); woodVertical.center.set(.5, .5); woodVertical.rotation = Math.PI / 2;
    const woodHorizontalFinish = material(THREE.MeshStandardMaterial, { map: wood, bumpMap: wood, bumpScale: .011, color: 0xeac698, roughness: .49 });
    const woodVerticalFinish = material(THREE.MeshStandardMaterial, { map: woodVertical, bumpMap: woodVertical, bumpScale: .011, color: 0xeac698, roughness: .49 });
    const darkWood = material(THREE.MeshStandardMaterial, { color: 0x42291b, roughness: .7 });
    const woodLip = material(THREE.MeshStandardMaterial, { color: 0x6a492c, roughness: .57 });
    const paperNoise = texture(256, 256, (context, width, height) => {
      const pixels = context.createImageData(width, height);
      for (let offset = 0; offset < pixels.data.length; offset += 4) {
        const shade = 222 + Math.floor(random() * 33); pixels.data.set([shade, shade, shade, 255], offset);
      }
      context.putImageData(pixels, 0, 0);
    }, { repeat: true, color: false });
    const paperColors = { cream: 0xf6edd3, yellow: 0xf3dd82, mint: 0xd7e4c9, rose: 0xefd5cf };
    const pinColors = { cream: 0x994237, yellow: 0xb0492c, mint: 0x456659, rose: 0x78556b };
    const paperFinishes = {}, pinFinishes = {};
    for (const [name, color] of Object.entries(paperColors)) {
      paperFinishes[name] = material(THREE.MeshStandardMaterial, { color, roughness: .94, bumpMap: paperNoise, bumpScale: .004, side: THREE.DoubleSide });
      pinFinishes[name] = material(THREE.MeshPhysicalMaterial, { color: pinColors[name], metalness: .12, roughness: .23, clearcoat: .62, clearcoatRoughness: .19 });
    }
    const steel = material(THREE.MeshStandardMaterial, { color: 0xa3a49b, metalness: .85, roughness: .26 });
    const paperShadowMap = texture(256, 256, context => {
      context.shadowColor = '#201408a8'; context.shadowBlur = 9; context.shadowOffsetX = 3; context.shadowOffsetY = 6;
      context.fillStyle = '#201408a8'; context.fillRect(13, 12, 224, 222);
    });
    const paperShadow = material(THREE.MeshBasicMaterial, { map: paperShadowMap, transparent: true, depthWrite: false, opacity: .57, toneMapped: false });

    function frameGeometry(points) {
      const shape = new THREE.Shape(); points.forEach(([x, y], index) => index ? shape.lineTo(x, y) : shape.moveTo(x, y)); shape.closePath();
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: .12, bevelEnabled: true, bevelSize: .028, bevelThickness: .026, bevelSegments: 3, steps: 1 });
      // Continuous grain along the rails, independent of board proportions.
      const uv = geometry.attributes.uv;
      for (let index = 0; index < uv.count; index++) uv.setXY(index, uv.getX(index) * .45, uv.getY(index) * .9);
      return geometry;
    }
    function buildBoard(width, height, border) {
      clear(boardGroup, boardGeometry);
      const w = width / 100, h = height / 100, b = border / 100;
      const left = -w / 2, right = w / 2, top = h / 2, bottom = -h / 2;
      const backing = mesh(new THREE.BoxGeometry(w - .035, h - .035, .16), darkWood, boardGroup, boardGeometry); backing.position.z = -.105;
      cork.repeat.set((w - b * 2) / 6, (h - b * 2) / 6); corkBump.repeat.copy(cork.repeat);
      const face = mesh(new THREE.PlaneGeometry(w - 2 * b + .035, h - 2 * b + .035), corkFinish, boardGroup, boardGeometry); face.position.z = -.004; face.castShadow = false;
      const rails = [
        [[left, top], [right, top], [right - b, top - b], [left + b, top - b]],
        [[left, bottom], [left + b, bottom + b], [right - b, bottom + b], [right, bottom]],
        [[left, bottom], [left, top], [left + b, top - b], [left + b, bottom + b]],
        [[right, top], [right, bottom], [right - b, bottom + b], [right - b, top - b]],
      ];
      rails.forEach((points, index) => { const rail = mesh(frameGeometry(points), index < 2 ? woodHorizontalFinish : woodVerticalFinish, boardGroup, boardGeometry); rail.position.z = .015; });
      // Thin raised inner moulding frames a slightly recessed sheet of cork.
      for (const y of [top - b + .013, bottom + b - .013]) { const lip = mesh(new THREE.BoxGeometry(w - 2 * b, .021, .027), woodLip, boardGroup, boardGeometry); lip.position.set(0, y, .09); }
      for (const x of [left + b - .013, right - b + .013]) { const lip = mesh(new THREE.BoxGeometry(.021, h - 2 * b, .027), woodLip, boardGroup, boardGeometry); lip.position.set(x, 0, .09); }
      camera.left = -w / 2; camera.right = w / 2; camera.top = h / 2; camera.bottom = -h / 2; camera.updateProjectionMatrix();
      key.position.set(-Math.min(w * .6, 9), h * .55 + 4, Math.max(8, h * .7)); key.target.position.set(0, 0, 0);
      const extent = Math.max(w, h) * .73 + 1;
      Object.assign(key.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, near: .1, far: Math.max(50, h * 3) }); key.shadow.camera.updateProjectionMatrix();
      // A long personal board must not allocate a screen-sized texture for every row.
      // Cap each drawing-buffer axis separately; HTML text stays crisp at every length.
      renderer.setSize(Math.max(1, Math.min(1800, width)), Math.max(1, Math.min(2800, height)), false);
    }
    function addPaper(card, bounds) {
      const rect = card.getBoundingClientRect(), width = card.offsetWidth / 100, height = card.offsetHeight / 100;
      if (!width || !height) return;
      const group = new THREE.Group(); group.position.set((rect.left + rect.width / 2 - bounds.left - bounds.width / 2) / 100, (bounds.top + bounds.height / 2 - rect.top - rect.height / 2) / 100, 0);
      group.rotation.z = -(Number(card.dataset.angle) || 0) * Math.PI / 180; papers.add(group);
      const contact = mesh(new THREE.PlaneGeometry(width + .20, height + .23), paperShadow, group, paperGeometry);
      contact.position.set(.025, -.045, .006); contact.castShadow = contact.receiveShadow = false;
      const sheet = new THREE.PlaneGeometry(width, height, 18, 24), positions = sheet.attributes.position;
      for (let index = 0; index < positions.count; index++) {
        const x = positions.getX(index) / width, y = positions.getY(index) / height;
        const edge = Math.pow(Math.abs(x) * 2, 3) * .028;
        const cornerCurl = Math.pow(x + .5, 5) * Math.pow(.5 - y, 5) * .31;
        const bottomLift = Math.pow(.5 - y, 7) * .024;
        positions.setZ(index, .078 + edge + cornerCurl + bottomLift + Math.sin(x * 8 + y * 3) * .003);
        positions.setXY(index, positions.getX(index) - cornerCurl * .15, positions.getY(index) + cornerCurl * .17);
      }
      sheet.computeVertexNormals(); mesh(sheet, paperFinishes[card.dataset.color] || paperFinishes.cream, group, paperGeometry);
      const pin = new THREE.Group(); pin.position.set(0, height / 2 - .175, .08); pin.rotation.x = -.08; pin.rotation.y = .11; group.add(pin);
      const finish = pinFinishes[card.dataset.color] || pinFinishes.cream;
      const shaft = mesh(new THREE.CylinderGeometry(.014, .011, .16, 12), steel, pin, paperGeometry); shaft.rotation.x = Math.PI / 2; shaft.position.z = .023;
      const base = mesh(new THREE.CylinderGeometry(.06, .082, .036, 28), finish, pin, paperGeometry); base.rotation.x = Math.PI / 2; base.position.z = .105;
      const neck = mesh(new THREE.CylinderGeometry(.037, .055, .07, 24), finish, pin, paperGeometry); neck.rotation.x = Math.PI / 2; neck.position.z = .151;
      const head = mesh(new THREE.SphereGeometry(.073, 28, 16), finish, pin, paperGeometry); head.scale.set(1, 1, .46); head.position.z = .199;
    }
    function update(elements = cards) {
      if (disposed) return;
      cards = elements;
      const bounds = host.getBoundingClientRect(), width = host.clientWidth, height = host.clientHeight;
      if (!width || !height) return;
      const border = parseFloat(view.getComputedStyle(surface).borderLeftWidth) || 19;
      const nextDimensions = `${width}:${height}:${border}`;
      if (dimensions !== nextDimensions) { dimensions = nextDimensions; buildBoard(width, height, border); }
      const signature = cards.map(card => { const rect = card.getBoundingClientRect(); return [card.dataset.noteId, card.dataset.color, card.dataset.angle, card.offsetWidth, card.offsetHeight, Math.round(rect.left - bounds.left), Math.round(rect.top - bounds.top)].join(':'); }).join('|');
      if (noteShape !== signature || !papers.children.length) {
        noteShape = signature; clear(papers, paperGeometry);
        for (const card of cards) addPaper(card, bounds);
      }
      render();
    }
    update(); return { update, destroy };
  } catch (error) { destroy(); throw error; }
}
