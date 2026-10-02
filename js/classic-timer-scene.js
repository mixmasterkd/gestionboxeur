import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/**
 * A real, locally rendered 3D timer. The timer engine owns time and settings;
 * this view only reflects its state and reports physical-control gestures.
 * Native controls outside the canvas provide the equivalent keyboard actions.
 */
export function createClassicTimerScene(host, { onAdjust = () => {}, onToggle = () => {} } = {}) {
  const doc = host.ownerDocument, view = doc.defaultView;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(view.devicePixelRatio || 1, 1.75));
  renderer.setClearColor(0x101318, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement;
  canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:pan-y pinch-zoom;';
  canvas.setAttribute('aria-hidden', 'true');
  host.append(canvas);

  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(34, 1, .1, 90);
  const timer = new THREE.Group(); scene.add(timer);
  const textures = new Set(), materials = new Set(), geometries = new Set();
  let disposed = false, frame = 0, visualKey = '', locked = false, pointer = null;
  let rotationEnabled = false;
  let workSeconds = 180, restSeconds = 60, timerStatus = 'idle';
  let environmentTarget, observer;
  const rockers = {}, rockerButtons = {}, lamps = {};
  const originalPosition = host.style.position;
  const originalTouchAction = host.style.touchAction;
  if (view.getComputedStyle(host).position === 'static') host.style.position = 'relative';
  host.style.touchAction = 'pan-y pinch-zoom';
  const rotationButton = doc.createElement('button');
  rotationButton.type = 'button';
  rotationButton.className = 'classic-rotation-screw';
  rotationButton.setAttribute('aria-pressed', 'false');
  rotationButton.setAttribute('aria-label', 'Activer la rotation du timer');
  rotationButton.style.cssText = 'position:absolute;z-index:2;width:44px;height:44px;min-width:44px;min-height:44px;padding:0;border:0;border-radius:50%;background:transparent;box-shadow:none;cursor:pointer;display:grid;place-items:center;transform:translate(-50%,-50%);touch-action:manipulation;color:#e5e8ea;';
  // Invisible accessible hit area follows the actual front screw; no floating UI.
  host.append(rotationButton);
  const material = (Type, options) => { const value = new Type(options); materials.add(value); return value; };
  const geometry = value => { geometries.add(value); return value; };
  const texture = value => { textures.add(value); return value; };
  const mesh = (shape, finish, parent = timer) => {
    const item = new THREE.Mesh(geometry(shape), finish);
    item.castShadow = true; item.receiveShadow = true; parent.add(item); return item;
  };
  function render() {
    if (!disposed && !frame) frame = view.requestAnimationFrame(() => {
      frame = 0;
      if (!disposed && host.clientWidth && host.clientHeight) renderer.render(scene, camera);
    });
  }

  function makeCanvasTexture(width, height, draw) {
    const surface = doc.createElement('canvas'); surface.width = width; surface.height = height;
    const context = surface.getContext('2d');
    if (!context) throw new Error('Le rendu 3D nécessite un canevas 2D.');
    draw(context, width, height);
    const map = texture(new THREE.CanvasTexture(surface));
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return map;
  }

  function cylinder(radius, depth, finish, x, y, z, parent = timer, segments = 48) {
    const item = mesh(new THREE.CylinderGeometry(radius, radius, depth, segments), finish, parent);
    item.position.set(x, y, z); return item;
  }

  function destroy() {
    if (disposed) return;
    disposed = true;
    observer?.disconnect();
    if (frame) view.cancelAnimationFrame(frame);
    canvas.removeEventListener('pointerdown', pointerDown);
    canvas.removeEventListener('pointermove', pointerMove);
    canvas.removeEventListener('pointerup', pointerUp);
    canvas.removeEventListener('pointercancel', pointerCancel);
    canvas.removeEventListener('lostpointercapture', pointerCancel);
    canvas.removeEventListener('webglcontextlost', contextLost);
    canvas.removeEventListener('keydown', rotationKeyDown);
    rotationButton.removeEventListener('click', toggleRotation);
    rotationButton.removeEventListener('keydown', rotationKeyDown);
    for (const value of geometries) value.dispose();
    for (const value of materials) value.dispose();
    for (const value of textures) value.dispose();
    environmentTarget?.dispose();
    renderer.dispose(); renderer.forceContextLoss(); canvas.remove();
    rotationButton.remove();
    for (const button of Object.values(rockerButtons)) button.remove();
    host.style.position = originalPosition;
    host.style.touchAction = originalTouchAction;
  }

  try {
    const environment = new RoomEnvironment(), generator = new THREE.PMREMGenerator(renderer);
    try { environmentTarget = generator.fromScene(environment, .04); scene.environment = environmentTarget.texture; }
    finally { environment.dispose(); generator.dispose(); }
    scene.environmentIntensity = .72;
    scene.add(new THREE.HemisphereLight(0xe8efff, 0x19212a, .75));
    const key = new THREE.DirectionalLight(0xfff1de, 2.7);
    key.position.set(-4, 7, 8); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: .1, far: 30 });
    key.shadow.bias = -.0005; key.shadow.normalBias = .035; key.shadow.radius = 4;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xbed9ff, 1.7); fill.position.set(7, 3, -2); scene.add(fill);

    const grain = makeCanvasTexture(128, 128, (context, width, height) => {
      const pixels = context.createImageData(width, height); let seed = 131;
      for (let index = 0; index < pixels.data.length; index += 4) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const shade = 110 + (seed >>> 27);
        pixels.data.set([shade, shade, shade, 255], index);
      }
      context.putImageData(pixels, 0, 0);
    });
    grain.colorSpace = THREE.NoColorSpace; grain.wrapS = grain.wrapT = THREE.RepeatWrapping; grain.repeat.set(7, 7);
    const enamel = material(THREE.MeshStandardMaterial, { color: 0x16191d, metalness: .72, roughness: .44, bumpMap: grain, bumpScale: .022 });
    const edge = material(THREE.MeshStandardMaterial, { color: 0x24292e, metalness: .85, roughness: .32 });
    const rubber = material(THREE.MeshStandardMaterial, { color: 0x101215, roughness: .8, metalness: .05 });
    const black = material(THREE.MeshStandardMaterial, { color: 0x020304, roughness: .9 });
    const chrome = material(THREE.MeshStandardMaterial, { color: 0xc9d0d7, metalness: 1, roughness: .21 });

    const body = mesh(new RoundedBoxGeometry(7.25, 2.9, 2.12, 3, .09), enamel);
    body.position.y = -.23;
    const plate = mesh(new RoundedBoxGeometry(7.05, 2.7, .047, 2, .05), enamel);
    plate.position.set(0, -.23, 1.079);
    const seam = mesh(new THREE.BoxGeometry(7.13, .022, 1.99), rubber);
    seam.position.set(0, 1.148, -.014);

    for (const x of [-2.87, 2.87]) for (const z of [-.67, .65]) cylinder(.28, .16, rubber, x, -1.75, z);
    const floor = mesh(new THREE.PlaneGeometry(60, 60), material(THREE.ShadowMaterial, { opacity: .35 }), scene);
    floor.rotation.x = -Math.PI / 2; floor.position.y = -1.842; floor.castShadow = false;
    const contactMap = makeCanvasTexture(128, 128, (context, width, height) => {
      const gradient = context.createRadialGradient(width / 2, height / 2, 6, width / 2, height / 2, width / 2);
      gradient.addColorStop(0, 'rgba(0,0,0,.75)'); gradient.addColorStop(.55, 'rgba(0,0,0,.32)'); gradient.addColorStop(1, 'rgba(0,0,0,0)');
      context.fillStyle = gradient; context.fillRect(0, 0, width, height);
    });
    const contact = mesh(new THREE.PlaneGeometry(10, 4.6), material(THREE.MeshBasicMaterial, { map: contactMap, transparent: true, depthWrite: false }), scene);
    contact.rotation.x = -Math.PI / 2; contact.position.y = -1.837; contact.castShadow = contact.receiveShadow = false;

    // Painted legends sit on the face; the controls and speaker have real depth.
    const faceMap = makeCanvasTexture(1792, 700, context => {
      const sx = x => (x + 3.5) / 7 * 1792, sy = y => (1.12 - y) / 2.7 * 700;
      const label = (text, x, y, size, color = '#f5f3eb') => {
        context.fillStyle = color; context.font = `700 ${size}px Arial, sans-serif`; context.textAlign = 'center'; context.fillText(text, sx(x), sy(y));
      };
      label('CHRONOMÈTRE DE RING', -.55, 1.015, 32, '#e5e6e2');
      label('MARCHE', -1.69, .84, 42); label('ROUND', -1.69, .08, 42); label('REPOS', -1.69, -.68, 42);
      label('PAUSE', -2.73, .44, 38); label('MARCHE', -.64, .44, 38);
      label('2 MIN', -2.73, -.32, 40); label('3 MIN', -.64, -.32, 40);
      label('30 S', -2.73, -1.08, 40); label('1 MIN', -.64, -1.08, 40);
      label('PRÊT POUR LE PROCHAIN ROUND', 1.89, -1.32, 26, '#e5e6e2');
    });
    const legends = mesh(new THREE.PlaneGeometry(7, 2.7), material(THREE.MeshStandardMaterial, { map: faceMap, transparent: true, roughness: .7, depthWrite: false }));
    legends.position.set(0, -.23, 1.111); legends.castShadow = false;

    function screw(x, y, z = 1.13, parent = timer) {
      const group = new THREE.Group(); group.position.set(x, y, z); parent.add(group);
      const head = cylinder(.064, .03, chrome, 0, 0, 0, group, 20); head.rotation.x = Math.PI / 2;
      const cut = mesh(new THREE.BoxGeometry(.081, .011, .006), black, group); cut.position.z = .02; cut.rotation.z = -.55;
      return group;
    }
    for (const x of [-3.36, 3.36]) for (const y of [1, -1.43]) {
      const bolt = screw(x, y);
      if (x > 0 && y < 0) bolt.userData.control = 'rotation';
    }
    for (const x of [.28, 1.45]) for (const y of [.34, -1.09]) screw(x, y);

    // A fully modelled rear: removable panel, vents, cable strain relief and a
    // physical, lightly curled sticky note. Its pencil URL is deliberately not a link.
    const rear = new THREE.Group(); rear.position.z = -1.083; rear.rotation.y = Math.PI; timer.add(rear);
    const rearPlate = mesh(new RoundedBoxGeometry(7.02, 2.65, .035, 2, .045), edge, rear); rearPlate.position.y = -.23;
    for (const x of [-3.3, 3.3]) for (const y of [.98, -1.41]) screw(x, y, .045, rear);
    const rearBlack = material(THREE.MeshStandardMaterial, { color: 0x090b0d, roughness: .8 });
    for (let row = 0; row < 7; row++) {
      for (const x of [-2.42, -1.53]) {
        const slot = mesh(new RoundedBoxGeometry(.76, .073, .021, 2, .029), rearBlack, rear);
        slot.position.set(x, .56 - row * .155, .032);
      }
    }
    const socket = cylinder(.185, .08, rubber, -2.42, -1.02, .078, rear); socket.rotation.x = Math.PI / 2;
    const socketCentre = cylinder(.096, .088, black, -2.42, -1.02, .10, rear); socketCentre.rotation.x = Math.PI / 2;
    const serialMap = makeCanvasTexture(560, 160, context => {
      context.fillStyle = '#b2b0a4'; context.fillRect(0, 0, 560, 160);
      context.fillStyle = '#22272a'; context.font = 'bold 22px monospace'; context.fillText('RING TIMER · 12 V', 18, 35);
      context.font = '16px monospace'; context.fillText('SÉRIE 001 / FABRIQUÉ POUR DURER', 18, 65);
      for (let x = 18; x < 380; x += 5) context.fillRect(x, 85, x % 3 + 1, 40);
      context.font = '14px monospace'; context.fillText('001-003-026', 395, 110);
    });
    const serial = mesh(new THREE.PlaneGeometry(1.55, .44), material(THREE.MeshStandardMaterial, { map: serialMap, roughness: .86 }), rear);
    serial.position.set(-1.6, -.99, .026);

    const noteMap = makeCanvasTexture(1536, 880, (context, width, height) => {
      context.fillStyle = '#efe0a0'; context.fillRect(0, 0, width, height);
      const tint = context.createLinearGradient(0, 0, width * .2, height);
      tint.addColorStop(0, '#dbc781'); tint.addColorStop(.16, '#f6e9b1'); tint.addColorStop(.78, '#f2e1a0'); tint.addColorStop(1, '#e5ce84');
      context.fillStyle = tint; context.fillRect(0, 0, width, height);
      let seed = 7341;
      for (let index = 0; index < 38000; index++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const x = seed % width; seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const y = seed % height;
        context.fillStyle = index % 3 ? '#8a753509' : '#fff6d00c'; context.fillRect(x, y, 1 + index % 2, 1);
      }
      // Separate low-opacity impressions give graphite a soft, imperfect edge.
      function pencil(text, x, y, font, rotation = 0) {
        context.save(); context.translate(x, y); context.rotate(rotation); context.font = font;
        context.fillStyle = '#121511'; context.fillText(text, 0, 0);
        context.globalAlpha = .15; context.fillStyle = '#262620'; context.fillText(text, .8, -.6);
        context.restore();
      }
      pencil('Une pause entre deux rounds ?', 93, 196, 'italic 600 65px "Comic Sans MS", "Comic Sans", cursive', -.022);
      pencil('Mon petit jeu de boxe', 157, 309, 'italic 600 70px "Comic Sans MS", "Comic Sans", cursive', .015);
      // Small hand-drawn graphite letterforms avoid relying on a handwriting font
      // installed on the visitor's device. Keep the complete URL on one line.
      const letters = {
        m: [6.2, 'M.4 7 L.6 2.7 Q.9 1.8 1.2 3.1 Q2.5 1.7 3.1 3.1 L3 7 M3.1 3.2 Q4.8 1.6 5.6 3.2 L5.4 7'],
        i: [2, 'M.6 2.8 L.4 7 M.7 .6 L.75 .7'],
        x: [4.6, 'M.4 2.6 L3.6 7 M3.8 2.7 L.2 7'],
        a: [4.6, 'M3.6 3.2 Q.2 1.6 .4 5.3 Q.4 8.4 3.4 5.9 M3.7 2.6 L3.4 7'],
        s: [4.2, 'M3.4 3 Q.7 1.5 .4 3.6 Q.3 4.3 2.3 4.9 Q4.2 5.6 2.8 6.8 Q1.8 7.8 .3 6.8'],
        t: [3.6, 'M1.9 .7 L1.2 6 Q1.2 7.8 3 6.7 M.2 3 L3.1 2.8'],
        e: [4.6, 'M.5 4.6 L3.7 4 Q3.5 1.5 1.3 2.9 Q-.5 4.1 .7 6.3 Q1.8 8.1 3.7 6.6'],
        r: [3.7, 'M.5 2.8 L.3 7 M.5 4 Q1.5 1.8 3 3'],
        k: [4.4, 'M.9 .4 L.4 7 M3.8 2.8 L.6 5 M1.5 4.3 L3.8 7'],
        d: [4.6, 'M3.7 3.3 Q.1 1.6 .4 5.5 Q.6 8.2 3.4 5.9 M4 .2 L3.4 7'],
        '.': [2, 'M.6 7 L.7 7.1'],
        g: [4.6, 'M3.6 3.2 Q.4 1.7 .4 5.4 Q.7 8 3.4 5.8 M3.8 2.7 L3.3 8.5 Q2.8 10.6 .3 8.9'],
        h: [4.8, 'M1 .3 L.4 7 M.7 4.2 Q3 1.3 3.7 3.6 L3.5 7'],
        u: [4.8, 'M.7 2.8 L.5 5.7 Q.3 8.5 3.7 5.7 M3.9 2.6 L3.5 7'],
        b: [4.8, 'M.9 .3 L.4 7 M.7 3.8 Q3 1.3 3.9 4.1 Q4.6 7.3 .5 7'],
        o: [4.8, 'M2.6 2.6 Q.1 2.3 .4 5.4 Q.9 8.5 3.7 6.3 Q5 3.3 2.6 2.6'],
        '/': [4.2, 'M3.7 .3 L.2 8'],
        B: [5.5, 'M.8 7 L1.2 .3 Q5.9 -.4 4.5 2.5 Q3.5 4 1 3.6 Q6.5 3.1 4.7 6 Q3.7 7.7 .8 7'],
        D: [6, 'M.7 7 L1 .3 Q6.6 -.2 5.1 4.9 Q4 7.8 .7 7'],
        '-': [3.8, 'M.3 4.5 L3 4.3'],
      };
      context.save(); context.translate(72, 461); context.rotate(-.012); context.scale(8.9, 8.9);
      context.strokeStyle = '#080a08'; context.lineWidth = .8; context.lineCap = 'round'; context.lineJoin = 'round';
      for (const [index, character] of [...'mixmasterkd.github.io/BoxeurDeux-D'].entries()) {
        const [advance, strokes] = letters[character];
        context.save(); context.translate(0, Math.sin(index * 2.7) * .12); context.transform(1, 0, -.07, 1, 0, 0);
        const path = new view.Path2D(strokes); context.stroke(path);
        context.globalAlpha = .18; context.translate(.065, -.055); context.stroke(path); context.restore();
        context.translate(advance + .12, 0);
      }
      context.restore();
      context.strokeStyle = '#746c5477'; context.lineWidth = 2.2; context.beginPath(); context.moveTo(70, 548); context.quadraticCurveTo(725, 562, 1450, 542); context.stroke();
      pencil('À noter avant de retourner au gym !', 155, 729, 'italic 600 52px "Comic Sans MS", "Comic Sans", cursive', .018);
    });
    const paperShape = new THREE.PlaneGeometry(3.84, 2.2, 36, 22);
    const paperPoints = paperShape.attributes.position;
    for (let index = 0; index < paperPoints.count; index++) {
      const x = paperPoints.getX(index), y = paperPoints.getY(index), down = (1.1 - y) / 2.2;
      const curl = .035 + .24 * Math.pow(down, 3) + .11 * Math.pow(Math.max(0, x / 1.92), 4) * down;
      paperPoints.setZ(index, curl + .025 * Math.sin(x * 2.3) * down);
    }
    paperShape.computeVertexNormals();
    const note = mesh(paperShape, material(THREE.MeshStandardMaterial, { map: noteMap, color: 0xcab877, roughness: .95, metalness: 0, side: THREE.DoubleSide }), rear);
    note.position.set(.98, -.11, .047); note.rotation.z = -.065;
    // The adhesive strip remains flat against the panel, while the lower corners lift.
    const adhesive = mesh(new THREE.PlaneGeometry(3.64, .12), material(THREE.MeshStandardMaterial, { color: 0xb09a50, roughness: 1 }), rear);
    adhesive.position.set(.916, .89, .055); adhesive.rotation.z = -.065;

    // Recessed speaker grille, with individually bevelled metal louvres.
    const speaker = mesh(new RoundedBoxGeometry(1.03, 1.28, .028, 2, .055), black); speaker.position.set(.87, -.38, 1.123);
    for (let row = 0; row < 8; row++) {
      const bar = mesh(new RoundedBoxGeometry(1.02, .076, .06, 2, .03), edge);
      bar.position.set(.87, .17 - row * .155, 1.14);
    }

    const logoFinish = material(THREE.MeshBasicMaterial, { color: 0xffffff, transparent: true, toneMapped: false, depthWrite: false });
    const logo = mesh(new THREE.PlaneGeometry(1.46, 1.46), logoFinish); logo.position.set(2.47, -.15, 1.115); logo.castShadow = false; logo.visible = false;
    const logoPath = new URL(`${import.meta.env?.BASE_URL || './'}images/boxing-logo.png`, doc.baseURI).href;
    new THREE.TextureLoader().load(logoPath, map => {
      if (disposed) { map.dispose(); return; }
      texture(map); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      logoFinish.map = map; logoFinish.needsUpdate = true; logo.visible = true; render();
    }, undefined, () => { /* A missing logo never blocks the clock. */ });

    const rockerFinish = material(THREE.MeshStandardMaterial, { color: 0x202326, roughness: .49, metalness: .14 });
    function makeRocker(name, y) {
      const control = new THREE.Group(); control.position.set(-1.69, y, 1.146); control.userData.control = name; timer.add(control);
      const frame = mesh(new RoundedBoxGeometry(1.17, .62, .09, 3, .075), edge, control);
      frame.position.z = .012;
      const opening = mesh(new RoundedBoxGeometry(1.08, .55, .074, 3, .059), black, control);
      opening.position.z = .060;
      const pivot = new THREE.Group(); pivot.position.z = .119; control.add(pivot); rockers[name] = pivot;
      const cap = mesh(new RoundedBoxGeometry(.93, .445, .145, 3, .047), rockerFinish, pivot);
      cap.position.z = .009;
      // The whole cap rotates around its real central axle; the pressed half
      // sinks into the recess and the opposite edge lifts above the bezel.
      const divider = mesh(new THREE.BoxGeometry(.008, .336, .006), rubber, pivot); divider.position.z = .084;
      for (const x of [-.39, .39]) for (const shift of [-.016, .016]) {
        const grip = mesh(new RoundedBoxGeometry(.009, .267, .010, 1, .003), rubber, pivot); grip.position.set(x + shift, 0, .081);
      }
      // Keyboard focus follows the physical face. Pointer events stay on the
      // canvas, so these overlays cannot overlap touch zones on narrow screens.
      const button = doc.createElement('button'); button.type = 'button'; button.className = 'classic-rocker-control'; button.dataset.control = name;
      button.style.cssText = 'position:absolute;z-index:2;transform:translate(-50%,-50%);padding:0;margin:0;min-width:0;min-height:0;border:0;border-radius:4px;background:transparent;box-shadow:none;pointer-events:none;';
      button.addEventListener('click', () => activateControl(name));
      button.addEventListener('focus', () => { if (button.matches(':focus-visible')) { button.style.outline = '2px solid #f1d99c'; button.style.outlineOffset = '3px'; } });
      button.addEventListener('blur', () => { button.style.outline = 'none'; });
      rockerButtons[name] = button; host.append(button);
    }
    makeRocker('power', .51); makeRocker('work', -.25); makeRocker('rest', -1.01);

    // A lathed, translucent lens plus horizontal and vertical moulded ridges.
    const domeProfile = new THREE.SplineCurve([new THREE.Vector2(.57, 0), new THREE.Vector2(.592, .14), new THREE.Vector2(.55, .40), new THREE.Vector2(.435, .72), new THREE.Vector2(.29, .94), new THREE.Vector2(.13, 1.055), new THREE.Vector2(0, 1.09)]).getPoints(42);
    const lensGeometry = geometry(new THREE.LatheGeometry(domeProfile, 64));
    const ribRingGeometry = geometry(new THREE.TorusGeometry(1, .012, 5, 56));
    const radiusAt = y => {
      const point = domeProfile.findIndex(value => value.y >= y);
      if (point <= 0) return domeProfile[0].x;
      const before = domeProfile[point - 1], after = domeProfile[point];
      return THREE.MathUtils.lerp(before.x, after.x, (y - before.y) / (after.y - before.y));
    };
    for (const [name, x, color] of [['work', -2.48, 0x009b62], ['warning', 0, 0xf4a008], ['rest', 2.48, 0xd51b25]]) {
      const beacon = new THREE.Group(); beacon.position.set(x, 1.21, 0); timer.add(beacon);
      cylinder(.69, .1, rubber, 0, .02, 0, beacon);
      cylinder(.658, .18, chrome, 0, .14, 0, beacon, 64);
      cylinder(.618, .028, edge, 0, .243, 0, beacon, 64);
      const grooves = new THREE.InstancedMesh(geometry(new THREE.BoxGeometry(.012, .12, .009)), edge, 72), transform = new THREE.Object3D();
      for (let index = 0; index < 72; index++) {
        const angle = index / 72 * Math.PI * 2; transform.position.set(Math.sin(angle) * .66, .14, Math.cos(angle) * .66); transform.rotation.y = angle; transform.updateMatrix(); grooves.setMatrixAt(index, transform.matrix);
      }
      beacon.add(grooves);
      const baseColor = new THREE.Color(color);
      const lensMaterial = material(THREE.MeshPhysicalMaterial, { color: baseColor.clone().multiplyScalar(.25), metalness: .02, roughness: .11, transmission: .5, thickness: .4, attenuationColor: baseColor, attenuationDistance: .6, ior: 1.47, clearcoat: 1, clearcoatRoughness: .055, emissive: color, emissiveIntensity: 0 });
      const lens = new THREE.Mesh(lensGeometry, lensMaterial); lens.position.y = .26; lens.castShadow = true; beacon.add(lens);
      const ribs = material(THREE.MeshPhysicalMaterial, { color: baseColor.clone().multiplyScalar(.25), roughness: .14, metalness: .03, clearcoat: 1, emissive: color, emissiveIntensity: 0 });
      for (let y = .085; y < 1.055; y += .085) {
        const ring = new THREE.Mesh(ribRingGeometry, ribs); ring.rotation.x = Math.PI / 2; ring.scale.set(radiusAt(y), radiusAt(y), 1); ring.position.y = .26 + y; beacon.add(ring);
      }
      for (let index = 0; index < 16; index++) {
        const angle = index / 16 * Math.PI * 2;
        const points = domeProfile.slice(1, -1).map(point => new THREE.Vector3(Math.sin(angle) * (point.x + .004), point.y + .26, Math.cos(angle) * (point.x + .004)));
        const ridge = mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 24, .010, 4, false), ribs, beacon); ridge.castShadow = false;
      }
      const bulbMaterial = material(THREE.MeshStandardMaterial, { color: 0x5a5040, emissive: color, emissiveIntensity: 0, roughness: .3 });
      const bulb = mesh(new THREE.SphereGeometry(.265, 24, 16), bulbMaterial, beacon); bulb.scale.y = 1.16; bulb.position.y = .66;
      const light = new THREE.PointLight(color, 0, 5, 2); light.position.set(0, .61, .3); beacon.add(light);
      const glowTexture = makeCanvasTexture(128, 128, (context, width, height) => {
        const gradient = context.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, width / 2);
        gradient.addColorStop(0, 'rgba(255,255,255,.6)'); gradient.addColorStop(.3, 'rgba(255,255,255,.19)'); gradient.addColorStop(1, 'rgba(255,255,255,0)');
        context.fillStyle = gradient; context.fillRect(0, 0, width, height);
      });
      const halo = new THREE.Sprite(material(THREE.SpriteMaterial, { map: glowTexture, color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      halo.position.set(0, .79, .02); halo.scale.set(1.98, 1.98, 1); beacon.add(halo);
      lamps[name] = { baseColor, lensMaterial, ribs, bulbMaterial, light, halo };
    }
  } catch (error) { destroy(); throw error; }

  const raycaster = new THREE.Raycaster(), position = new THREE.Vector2();
  function positionRotationButton() {
    timer.updateWorldMatrix(true, false);
    const world = timer.localToWorld(new THREE.Vector3(3.36, -1.43, 1.15));
    const outward = new THREE.Vector3(0, 0, 1).transformDirection(timer.matrixWorld);
    const facingCamera = outward.dot(camera.position.clone().sub(world).normalize()) > .12;
    const point = world.project(camera);
    const visible = facingCamera && point.z > -1 && point.z < 1 && Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1;
    // Never leave a clickable ghost of the front screw over the rear post-it.
    if (!visible && doc.activeElement === rotationButton && rotationEnabled) canvas.focus({ preventScroll: true });
    rotationButton.hidden = !visible;
    rotationButton.style.display = visible ? 'grid' : 'none';
    rotationButton.style.left = `${(point.x + 1) / 2 * 100}%`;
    rotationButton.style.top = `${(1 - point.y) / 2 * 100}%`;
    for (const [name, button] of Object.entries(rockerButtons)) {
      const y = name === 'power' ? .51 : name === 'work' ? -.25 : -1.01;
      const corners = [];
      for (const xOffset of [-.59, .59]) for (const yOffset of [-.31, .31]) corners.push(timer.localToWorld(new THREE.Vector3(-1.69 + xOffset, y + yOffset, 1.27)).project(camera));
      const xValues = corners.map(p => (p.x + 1) * host.clientWidth / 2), yValues = corners.map(p => (1 - p.y) * host.clientHeight / 2);
      const left = Math.min(...xValues), right = Math.max(...xValues), top = Math.min(...yValues), bottom = Math.max(...yValues);
      const shown = facingCamera && corners.every(p => p.z > -1 && p.z < 1) && right > 0 && left < host.clientWidth && bottom > 0 && top < host.clientHeight;
      if (!shown && doc.activeElement === button && rotationEnabled) canvas.focus({ preventScroll: true });
      button.hidden = !shown; button.style.display = shown ? 'block' : 'none';
      button.style.left = `${(left + right) / 2}px`; button.style.top = `${(top + bottom) / 2}px`;
      button.style.width = `${right - left}px`; button.style.height = `${bottom - top}px`;
    }
  }
  function activateControl(name) {
    if (disposed) return;
    if (name === 'power') onToggle();
    else if (!locked && (name === 'work' || name === 'rest')) onAdjust(name, 1);
  }
  function describeRotation() {
    const rearVisible = Math.cos(timer.rotation.y - Math.atan(.34)) < -.4;
    canvas.setAttribute('aria-label', rearVisible
      ? 'Vue arrière du timer. Post-it : mixmasterkd.github.io/BoxeurDeux-D. Utiliser les flèches gauche et droite pour tourner, Échap pour revenir.'
      : 'Timer de boxe en trois dimensions. Utiliser les flèches gauche et droite pour tourner, Échap pour revenir.');
  }
  function setRotation(enabled) {
    if (disposed) return;
    pointerCancel(); rotationEnabled = Boolean(enabled);
    rotationButton.setAttribute('aria-pressed', String(rotationEnabled));
    rotationButton.setAttribute('aria-label', rotationEnabled ? 'Bloquer la rotation et revenir à la face avant' : 'Activer la rotation du timer');
    canvas.style.touchAction = rotationEnabled ? 'pinch-zoom' : 'pan-y pinch-zoom';
    canvas.style.cursor = rotationEnabled ? 'grab' : 'default';
    canvas.setAttribute('aria-hidden', String(!rotationEnabled));
    canvas.tabIndex = rotationEnabled ? 0 : -1;
    if (rotationEnabled) { canvas.setAttribute('role', 'img'); describeRotation(); }
    else { timer.rotation.y = 0; canvas.removeAttribute('aria-label'); canvas.removeAttribute('role'); }
    positionRotationButton(); render();
  }
  function toggleRotation() { setRotation(!rotationEnabled); }
  function rotateBy(amount) {
    timer.rotation.y = THREE.MathUtils.euclideanModulo(timer.rotation.y + amount + Math.PI, Math.PI * 2) - Math.PI;
    positionRotationButton(); describeRotation(); render();
  }
  function rotationKeyDown(event) {
    if (!rotationEnabled) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault(); event.stopPropagation();
      rotateBy((event.key === 'ArrowLeft' ? -1 : 1) * Math.PI / (event.shiftKey ? 4 : 12));
    } else if (event.key === 'Home') {
      event.preventDefault(); timer.rotation.y = 0; positionRotationButton(); describeRotation(); render();
    } else if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); setRotation(false); rotationButton.focus({ preventScroll: true });
    }
  }
  function controlAt(event) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    position.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(position, camera);
    timer.updateWorldMatrix(true, true);
    // The case occludes front controls from behind. Casting only against controls
    // lets their invisible back faces steal a rotation gesture on the rear panel.
    const hit = raycaster.intersectObject(timer, true).find(item => item.object.isMesh && item.object.visible);
    for (let item = hit?.object; item; item = item.parent) if (item.userData.control) return item.userData.control;
    return null;
  }
  function pointerDown(event) {
    if (event.button !== 0 || pointer || disposed) return;
    const control = controlAt(event);
    if (!control && rotationEnabled) {
      pointer = { id: event.pointerId, control: 'rotate', x: event.clientX, y: event.clientY, last: event.clientX, changed: false };
      canvas.setPointerCapture?.(event.pointerId); canvas.style.cursor = 'grabbing'; return;
    }
    if (!control || locked && control !== 'power' && control !== 'rotation') return;
    pointer = { id: event.pointerId, control, x: event.clientX, y: event.clientY, last: event.clientX, changed: false };
    canvas.setPointerCapture?.(event.pointerId);
    canvas.style.cursor = 'pointer';
  }
  function pointerMove(event) {
    if (!pointer) {
      const control = controlAt(event);
      canvas.style.cursor = control ? (!locked || control === 'power' || control === 'rotation' ? 'pointer' : 'not-allowed') : rotationEnabled ? 'grab' : 'default';
      return;
    }
    if (pointer.id !== event.pointerId || pointer.control === 'power') return;
    const delta = event.clientX - pointer.last;
    if (pointer.control === 'rotate') {
      pointer.last = event.clientX;
      rotateBy(delta / Math.max(240, canvas.clientWidth) * Math.PI * 2);
      return;
    }
    if (pointer.control === 'rotation') return;
    if (Math.abs(delta) >= 26 && Math.abs(event.clientX - pointer.x) > Math.abs(event.clientY - pointer.y)) {
      pointer.changed = true; pointer.last = event.clientX;
      const value = pointer.control === 'work' ? workSeconds : restSeconds;
      const lower = pointer.control === 'work' ? 120 : 30, upper = pointer.control === 'work' ? 180 : 60;
      if (!locked && (delta > 0 ? value < upper : value > lower)) onAdjust(pointer.control, delta > 0 ? 1 : -1);
    }
  }
  function pointerUp(event) {
    if (!pointer || pointer.id !== event.pointerId) return;
    const gesture = pointer; pointer = null; canvas.style.cursor = rotationEnabled ? 'grab' : 'pointer';
    if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) <= 16 && !gesture.changed) {
      if (gesture.control === 'rotation') toggleRotation();
      else if (gesture.control !== 'rotate') activateControl(gesture.control);
    }
    if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  }
  function pointerCancel() {
    const pointerId = pointer?.id; pointer = null; canvas.style.cursor = rotationEnabled ? 'grab' : 'default';
    if (pointerId !== undefined && canvas.hasPointerCapture?.(pointerId)) canvas.releasePointerCapture(pointerId);
  }
  function contextLost(event) {
    event.preventDefault();
    host.dispatchEvent(new view.CustomEvent('classic-timer-unavailable', { bubbles: true }));
  }
  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointercancel', pointerCancel);
  canvas.addEventListener('lostpointercapture', pointerCancel);
  canvas.addEventListener('webglcontextlost', contextLost);
  canvas.addEventListener('keydown', rotationKeyDown);
  rotationButton.addEventListener('click', toggleRotation);
  rotationButton.addEventListener('keydown', rotationKeyDown);

  function resize() {
    if (disposed) return;
    const width = host.clientWidth, height = host.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false); camera.aspect = width / height;
    const distance = Math.max(9.75, 9.4 / camera.aspect);
    camera.position.set(distance * .34, distance * .24 + .65, distance);
    camera.lookAt(0, .51, 0); camera.updateProjectionMatrix(); camera.updateMatrixWorld(); positionRotationButton(); render();
  }
  function update({ phase = 'prepare', warning = false, status = 'idle', config = {} } = {}) {
    if (disposed) return;
    locked = status === 'running' || status === 'paused';
    const key = `${phase}:${warning}:${status}:${config.work}:${config.rest}`;
    if (key === visualKey) return;
    visualKey = key;
    timerStatus = status;
    workSeconds = config.work || 180; restSeconds = config.rest || 60;
    rockers.power.rotation.y = timerStatus === 'running' ? .24 : -.24;
    rockers.work.rotation.y = workSeconds === 120 ? -.24 : .24;
    rockers.rest.rotation.y = restSeconds === 30 ? -.24 : .24;
    rockerButtons.power.setAttribute('aria-label', `${{ idle: 'Démarrer', running: 'Mettre en pause', paused: 'Reprendre', done: 'Recommencer' }[timerStatus] || 'Démarrer'} le timer avec la bascule Marche`);
    rockerButtons.power.setAttribute('aria-pressed', String(timerStatus === 'running'));
    rockerButtons.work.disabled = rockerButtons.rest.disabled = locked;
    rockerButtons.work.setAttribute('aria-label', `Durée du round : ${workSeconds / 60} minutes. Basculer sur ${workSeconds === 120 ? 3 : 2} minutes`);
    rockerButtons.rest.setAttribute('aria-label', `Repos : ${restSeconds} secondes. Basculer sur ${restSeconds === 30 ? 60 : 30} secondes`);
    rockerButtons.work.setAttribute('aria-pressed', String(workSeconds === 180));
    rockerButtons.rest.setAttribute('aria-pressed', String(restSeconds === 60));
    const active = status === 'idle' || status === 'done' ? null : phase === 'work' ? warning ? 'warning' : 'work' : phase === 'rest' ? 'rest' : null;
    for (const [name, lamp] of Object.entries(lamps)) {
      const on = name === active;
      lamp.lensMaterial.color.copy(lamp.baseColor).multiplyScalar(on ? .7 : .25);
      lamp.ribs.color.copy(lamp.baseColor).multiplyScalar(on ? .7 : .25);
      lamp.lensMaterial.emissiveIntensity = on ? .72 : 0;
      lamp.ribs.emissiveIntensity = on ? .5 : 0;
      lamp.bulbMaterial.emissiveIntensity = on ? 4 : 0;
      lamp.light.intensity = on ? 8 : 0;
      lamp.halo.material.opacity = on ? .4 : 0;
    }
    render();
  }
  if (view.ResizeObserver) { observer = new view.ResizeObserver(resize); observer.observe(host); }
  resize(); update();
  return { update, resize, destroy };
}
