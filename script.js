lucide.createIcons();

const CANVAS_WIDTH = 1080;
let CANVAS_HEIGHT = 1920;
const COLLISION = { WALL: 0x0001, CENTER: 0x0002, ITEM: 0x0004 };

let fallingImagesUrls = [];
let centerImageUrl = null;
let isRecording = false, isProcessingZip = false, isLooping = false;
let recordedFrames = [];
let engine, render, runner, centralBody, ground, ceiling, leftWall, rightWall, mouse, mouseConstraint;
let timeTick = 0; 
let lastCaptureTime = 0; 
let activeScale = 1;

// Stato dei modificatori
let modChaos = false, modExplosive = false, modMouse = false;

// Stato Disegno e Ostacoli
let isDrawingMode = false;
let hideObstacles = false;
let drawnObstacles = [];
let drawStartPt = null;
let previewObstacle = null;

let domObstacles = {};
let obstacleIdCounter = 0;

const canvasContainer = document.getElementById('canvasContainer');
const sceneContainer = document.getElementById('sceneContainer');

// Canvas offscreen sicuro per l'esportazione perfetta
const exportCanvas = document.createElement('canvas');
const exportCtx = exportCanvas.getContext('2d', { willReadFrequently: true });

function initPhysics() {
  engine = Matter.Engine.create();
  setGravity('normal'); 
  
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_WIDTH; canvas.height = CANVAS_HEIGHT;
  canvasContainer.appendChild(canvas);
  canvasContainer.classList.add('has-canvas');

  const initialBg = document.getElementById('bgColor').value;
  canvasContainer.style.backgroundColor = initialBg;

  render = Matter.Render.create({
    canvas: canvas, engine: engine,
    options: { 
      width: CANVAS_WIDTH, height: CANVAS_HEIGHT, 
      background: 'transparent', // Matter.js ora è sempre trasparente per evitare bug
      wireframes: false 
    }
  });

  const wOpt = { isStatic: true, render: { visible: false }, collisionFilter: { category: COLLISION.WALL, mask: 0xFFFF } };
  ground = Matter.Bodies.rectangle(CANVAS_WIDTH/2, CANVAS_HEIGHT + 100, CANVAS_WIDTH * 3, 200, wOpt);
  ceiling = Matter.Bodies.rectangle(CANVAS_WIDTH/2, -500, CANVAS_WIDTH * 3, 200, wOpt);
  leftWall = Matter.Bodies.rectangle(-100, CANVAS_HEIGHT/2, 200, CANVAS_HEIGHT * 3, wOpt);
  rightWall = Matter.Bodies.rectangle(CANVAS_WIDTH + 100, CANVAS_HEIGHT/2, 200, CANVAS_HEIGHT * 3, wOpt);
  
  Matter.Composite.add(engine.world, [ground, ceiling, leftWall, rightWall]);

  mouse = Matter.Mouse.create(canvas);
  mouseConstraint = Matter.MouseConstraint.create(engine, { 
    mouse: mouse, 
    constraint: { stiffness: 0.2, render: { visible: false } } 
  });
  Matter.Composite.add(engine.world, mouseConstraint);
  render.mouse = mouse;

  // DISEGNO OSTACOLI MOUSE
  Matter.Events.on(mouseConstraint, 'mousedown', function(event) {
    if (!isDrawingMode || isRecording) return;
    drawStartPt = { x: mouse.position.x, y: mouse.position.y };
  });

  Matter.Events.on(mouseConstraint, 'mousemove', function(event) {
    if (!isDrawingMode || !drawStartPt || isRecording) return;
    if (previewObstacle) Matter.Composite.remove(engine.world, previewObstacle);
    
    const currentPt = { x: mouse.position.x, y: mouse.position.y };
    const dx = currentPt.x - drawStartPt.x;
    const dy = currentPt.y - drawStartPt.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 10) return; 

    const centerX = drawStartPt.x + dx / 2;
    const centerY = drawStartPt.y + dy / 2;
    const angle = Math.atan2(dy, dx);

    previewObstacle = Matter.Bodies.rectangle(centerX, centerY, dist, 25, {
      isStatic: true, angle: angle,
      render: { fillStyle: 'rgba(255,255,255,0.2)', strokeStyle: 'rgba(255,255,255,0.4)', lineWidth: 1 },
      collisionFilter: { category: COLLISION.WALL, mask: 0xFFFF }
    });
    Matter.Composite.add(engine.world, previewObstacle);
  });

  Matter.Events.on(mouseConstraint, 'mouseup', function(event) {
    if (!isDrawingMode || !drawStartPt || isRecording) return;
    if (previewObstacle) {
      previewObstacle.render.visible = !hideObstacles;
      drawnObstacles.push(previewObstacle);
      previewObstacle = null;
    }
    drawStartPt = null;
  });

  Matter.Events.on(engine, 'collisionStart', (event) => {
    if (!modExplosive) return;
    event.pairs.forEach((pair) => {
      const bodyA = pair.bodyA;
      const bodyB = pair.bodyB;
      const relVelX = bodyA.velocity.x - bodyB.velocity.x;
      const relVelY = bodyA.velocity.y - bodyB.velocity.y;
      const speedSq = relVelX * relVelX + relVelY * relVelY;
      
      if (speedSq > 150 && !bodyA.isStatic && !bodyB.isStatic) {
        const forceMagnitude = 0.05;
        Matter.Body.applyForce(bodyA, bodyA.position, { x: relVelX * forceMagnitude, y: relVelY * forceMagnitude });
        Matter.Body.applyForce(bodyB, bodyB.position, { x: -relVelX * forceMagnitude, y: -relVelY * forceMagnitude });
      }
    });
  });

  Matter.Events.on(engine, 'beforeUpdate', () => {
    timeTick += 0.05;
    const effect = document.getElementById('physicsEffect').value;
    const bodies = Matter.Composite.allBodies(engine.world).filter(b => !b.isStatic);
    const mouseX = mouse.position.x;
    const mouseY = mouse.position.y;

    bodies.forEach(body => {
      if (modMouse && mouseX && mouseY && !isRecording) {
        const dx = body.position.x - mouseX;
        const dy = body.position.y - mouseY;
        const distSq = dx * dx + dy * dy;
        if (distSq < 40000) { 
          const force = 50 / Math.max(distSq, 100); 
          Matter.Body.applyForce(body, body.position, { x: dx * force * body.mass * 0.001, y: dy * force * body.mass * 0.001 });
        }
      }

      if (effect === 'leaves') {
        Matter.Body.applyForce(body, body.position, { x: Math.sin(timeTick + body.id) * 0.002 * body.mass, y: 0 });
      } else if (effect === 'vortex') {
        const dx = (CANVAS_WIDTH / 2) - body.position.x;
        const dy = (CANVAS_HEIGHT / 2) - body.position.y;
        Matter.Body.applyForce(body, body.position, { x: -dy * 0.00003 * body.mass, y: dx * 0.00003 * body.mass });
        Matter.Body.applyForce(body, body.position, { x: dx * 0.000005 * body.mass, y: dy * 0.000005 * body.mass }); 
      } else if (effect === 'magnetic') {
        const dx = (CANVAS_WIDTH / 2) - body.position.x;
        const dy = (CANVAS_HEIGHT / 2) - body.position.y;
        Matter.Body.applyForce(body, body.position, { x: dx * 0.00003 * body.mass, y: dy * 0.00003 * body.mass });
      } else if (effect === 'popcorn') {
        if (body.position.y > CANVAS_HEIGHT - 250 && Math.abs(body.velocity.y) < 2 && Math.random() < 0.02) {
          Matter.Body.setVelocity(body, { x: (Math.random() - 0.5) * 15, y: -15 - Math.random() * 20 });
          Matter.Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.6); 
        }
      }

      if (isLooping) {
        const outBottom = body.position.y > CANVAS_HEIGHT + 300;
        const outTop = body.position.y < -600;
        const outSides = body.position.x < -300 || body.position.x > CANVAS_WIDTH + 300;

        if (outBottom || outTop || outSides) {
          let nx = (CANVAS_WIDTH / 2) + (Math.random() - 0.5) * 800;
          let ny = -200 - (Math.random() * 200);
          let vx = (Math.random() - 0.5) * 4;
          let vy = 0;

          if (effect === 'explosion' || effect === 'popcorn') {
            ny = CANVAS_HEIGHT + 100; vy = -20 - Math.random() * 15;
          } else if (effect === 'windRight') {
            nx = -100; ny = Math.random() * CANVAS_HEIGHT; vx = 10;
          } else if (effect === 'windLeft') {
            nx = CANVAS_WIDTH + 100; ny = Math.random() * CANVAS_HEIGHT; vx = -10;
          }

          Matter.Body.setPosition(body, { x: nx, y: ny });
          Matter.Body.setVelocity(body, { x: vx, y: vy });
        }
      }
    });
  });

  // GARANTISCE CHE GLI OSTACOLI SIANO INVISIBILI IN REGISTRAZIONE
  Matter.Events.on(render, 'beforeRender', () => {
    const isExporting = isRecording;
    
    Object.values(domObstacles).forEach(obs => {
      if(obs.body) obs.body.render.visible = isExporting ? false : !hideObstacles;
      obs.el.style.opacity = (isExporting || hideObstacles) ? '0' : '1';
      obs.el.style.pointerEvents = (isExporting || hideObstacles) ? 'none' : 'auto';
    });

    drawnObstacles.forEach(obs => {
      obs.render.visible = isExporting ? false : !hideObstacles;
    });

    if (previewObstacle) {
      previewObstacle.render.visible = isExporting ? false : !hideObstacles;
    }
  });

  // REGISTRAZIONE CORRETTA: SFONDO PIENO + ELEMENTI
  Matter.Events.on(render, 'afterRender', () => {
    if (isRecording) {
      const now = performance.now();
      const targetFps = parseInt(document.getElementById('exportFps').value);
      const intervalMs = 1000 / targetFps;

      if (now - lastCaptureTime >= intervalMs) {
        exportCanvas.width = render.canvas.width;
        exportCanvas.height = render.canvas.height;
        
        // Disegna Sfondo
        exportCtx.fillStyle = document.getElementById('bgColor').value;
        exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
        
        // Disegna Canvas Fisica (Trasparente ma con Sprites)
        exportCtx.drawImage(render.canvas, 0, 0);

        // Estrae un Jpeg sano, senza parti nere e con le texture embedded (grazie al Base64)
        recordedFrames.push(exportCanvas.toDataURL('image/jpeg', 0.8));
        lastCaptureTime = now;
        document.getElementById('recordStatus').innerText = `Registrazione... Frame: ${recordedFrames.length}`;
      }
    }
  });

  Matter.Render.run(render);
  runner = Matter.Runner.create();
  Matter.Runner.run(runner, engine);

  window.addEventListener("resize", () => {
    const scaleY = (sceneContainer.clientHeight - 40) / CANVAS_HEIGHT;
    const scaleX = (sceneContainer.clientWidth - 40) / CANVAS_WIDTH;
    activeScale = Math.min(scaleX, scaleY);
    canvasContainer.style.transform = `scale(${activeScale})`;
    Matter.Mouse.setScale(mouse, { x: 1/activeScale, y: 1/activeScale });
  });
  window.dispatchEvent(new Event('resize'));
}

function setGravity(effect) {
  if (!engine) return;
  if (effect === 'windRight') { engine.gravity.x = 1.5; engine.gravity.y = 0.8; }
  else if (effect === 'windLeft') { engine.gravity.x = -1.5; engine.gravity.y = 0.8; }
  else if (effect === 'heavy') { engine.gravity.x = 0; engine.gravity.y = 3.5; }
  else if (effect === 'space') { engine.gravity.x = 0; engine.gravity.y = 0.1; }
  else if (effect === 'vortex' || effect === 'magnetic') { engine.gravity.x = 0; engine.gravity.y = 0; }
  else if (effect === 'leaves') { engine.gravity.x = 0; engine.gravity.y = 0.6; }
  else { engine.gravity.x = 0; engine.gravity.y = 1.5; }
}

document.getElementById('canvasFormat').addEventListener('change', (e) => {
  CANVAS_HEIGHT = parseInt(e.target.value);
  canvasContainer.style.height = CANVAS_HEIGHT + 'px';
  if(render) {
    render.canvas.height = CANVAS_HEIGHT;
    render.options.height = CANVAS_HEIGHT;
    Matter.Body.setPosition(ground, { x: CANVAS_WIDTH/2, y: CANVAS_HEIGHT + 100 });
    Matter.Body.setPosition(leftWall, { x: -100, y: CANVAS_HEIGHT/2 });
    Matter.Body.setPosition(rightWall, { x: CANVAS_WIDTH + 100, y: CANVAS_HEIGHT/2 });
  }
  document.querySelector('#placeholder-text p.text-2xl').innerText = `1080 x ${CANVAS_HEIGHT}`;
  window.dispatchEvent(new Event('resize'));
});

document.getElementById('modDraw').addEventListener('change', (e) => {
  isDrawingMode = e.target.checked;
  mouseConstraint.collisionFilter.mask = isDrawingMode ? 0x0000 : 0xFFFFFFFF;
  canvasContainer.style.cursor = isDrawingMode ? 'crosshair' : 'default';
});

document.getElementById('modHideObstacles').addEventListener('change', (e) => {
  hideObstacles = e.target.checked;
});

document.getElementById('clearObstaclesBtn').addEventListener('click', () => {
  drawnObstacles.forEach(obs => Matter.Composite.remove(engine.world, obs));
  drawnObstacles = [];
  Object.values(domObstacles).forEach(obs => {
    obs.el.remove(); Matter.Composite.remove(engine.world, obs.body);
  });
  domObstacles = {};
});

document.getElementById('addRectBtn').addEventListener('click', () => {
  createDOMObstacle(CANVAS_WIDTH/2 - 100, CANVAS_HEIGHT/2 - 25, 200, 50);
});

function createDOMObstacle(x, y, w, h) {
  const id = 'obs_' + (obstacleIdCounter++);
  const el = document.createElement('div');
  el.className = 'dom-rect';
  el.style.left = x + 'px'; el.style.top = y + 'px';
  el.style.width = w + 'px'; el.style.height = h + 'px';
  
  const handle = document.createElement('div');
  handle.className = 'dom-rect-drag';
  el.appendChild(handle);

  const delBtn = document.createElement('button');
  delBtn.innerHTML = '×';
  delBtn.className = 'absolute top-0 right-1 text-white text-2xl leading-none font-bold pointer-events-auto hover:text-red-400 z-10';
  delBtn.onclick = () => {
    el.remove(); Matter.Composite.remove(engine.world, domObstacles[id].body); delete domObstacles[id];
  };
  el.appendChild(delBtn);
  canvasContainer.appendChild(el);

  const body = Matter.Bodies.rectangle(x + w/2, y + h/2, w, h, {
    isStatic: true,
    render: { fillStyle: 'rgba(255,255,255,0.1)', strokeStyle: 'rgba(255,255,255,0.4)', lineWidth: 2 },
    collisionFilter: { category: COLLISION.WALL, mask: 0xFFFF }
  });
  Matter.Composite.add(engine.world, body);
  domObstacles[id] = { el, body, w, h, x, y };

  const ro = new ResizeObserver(entries => {
    for (let entry of entries) {
      updateObstacleBody(id, entry.contentRect.width, entry.contentRect.height);
    }
  });
  ro.observe(el);

  let isDragging = false, startX, startY, initialX, initialY;
  handle.addEventListener('mousedown', (e) => {
    if(hideObstacles || isRecording) return;
    isDragging = true;
    startX = e.clientX; startY = e.clientY;
    initialX = parseFloat(el.style.left); initialY = parseFloat(el.style.top);
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if(!isDragging || isRecording) return;
    const dx = (e.clientX - startX) / activeScale;
    const dy = (e.clientY - startY) / activeScale;
    const newX = initialX + dx; const newY = initialY + dy;
    el.style.left = newX + 'px'; el.style.top = newY + 'px';
    Matter.Body.setPosition(domObstacles[id].body, { x: newX + domObstacles[id].w/2, y: newY + domObstacles[id].h/2 });
  });
  window.addEventListener('mouseup', () => isDragging = false);
}

function updateObstacleBody(id, newW, newH) {
  const obs = domObstacles[id]; if(!obs) return;
  const newX = parseFloat(obs.el.style.left) + newW/2;
  const newY = parseFloat(obs.el.style.top) + newH/2;
  const scaleX = newW / obs.w; const scaleY = newH / obs.h;
  Matter.Body.scale(obs.body, scaleX, scaleY);
  Matter.Body.setPosition(obs.body, {x: newX, y: newY});
  obs.w = newW; obs.h = newH;
}

document.getElementById('physicsEffect').addEventListener('change', (e) => setGravity(e.target.value));
document.getElementById('modChaos').addEventListener('change', (e) => modChaos = e.target.checked);
document.getElementById('modExplosive').addEventListener('change', (e) => modExplosive = e.target.checked);
document.getElementById('modMouse').addEventListener('change', (e) => modMouse = e.target.checked);
document.getElementById('isLooping').addEventListener('change', (e) => {
  isLooping = e.target.checked; ground.isSensor = ceiling.isSensor = isLooping; 
});

function updateCenterBody() {
  if (centralBody) Matter.Composite.remove(engine.world, centralBody);
  const scale = parseFloat(document.getElementById('centerScale').value);
  const rotation = parseInt(document.getElementById('centerRotation').value);
  
  if (centerImageUrl) {
    const img = new Image();
    img.onload = () => {
      const baseW = 400; const baseH = baseW * (img.naturalHeight / img.naturalWidth);
      centralBody = Matter.Bodies.rectangle(CANVAS_WIDTH/2, CANVAS_HEIGHT/2, baseW * scale, baseH * scale, {
        isStatic: true, angle: rotation * (Math.PI / 180),
        collisionFilter: { category: COLLISION.CENTER, mask: COLLISION.WALL | COLLISION.ITEM },
        render: { sprite: { texture: centerImageUrl, xScale: (baseW*scale)/img.naturalWidth, yScale: (baseH*scale)/img.naturalHeight } }
      });
      Matter.Composite.add(engine.world, centralBody);
    };
    img.src = centerImageUrl;
  }
}

document.getElementById('bgColor').addEventListener('input', (e) => {
  canvasContainer.style.backgroundColor = e.target.value;
});

// SISTEMA CARICAMENTO IMMAGINI CONVERTITE IN BASE64 (Risolve il bug degli elementi spariti)
document.getElementById('centerImage').addEventListener('change', (e) => { 
  if (e.target.files[0]) { 
    const reader = new FileReader();
    reader.onload = (event) => {
      centerImageUrl = event.target.result;
      updateCenterBody(); 
      document.getElementById('clearCenterBtn').classList.remove('hidden');
    };
    reader.readAsDataURL(e.target.files[0]);
  }
});

document.getElementById('clearCenterBtn').addEventListener('click', () => {
  centerImageUrl = null;
  document.getElementById('centerImage').value = '';
  if (centralBody) {
    Matter.Composite.remove(engine.world, centralBody);
    centralBody = null;
  }
  document.getElementById('clearCenterBtn').classList.add('hidden');
});

document.getElementById('centerScale').addEventListener('input', (e) => { document.getElementById('scaleLabel').innerText = `Scala (${parseFloat(e.target.value).toFixed(1)}x)`; updateCenterBody(); });
document.getElementById('centerRotation').addEventListener('input', (e) => { document.getElementById('rotationLabel').innerText = `Rotazione (${e.target.value}°)`; updateCenterBody(); });

document.getElementById('fallingImages').addEventListener('change', (e) => {
  if (e.target.files.length === 0) return;
  const preview = document.getElementById('previewContainer'); 
  preview.classList.remove('hidden');
  document.getElementById('clearFallingBtn').classList.remove('hidden');

  for (let file of Array.from(e.target.files)) {
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64Url = event.target.result;
      fallingImagesUrls.push(base64Url);
      const img = document.createElement('img'); 
      img.src = base64Url; 
      img.className = "h-8 w-8 object-cover bg-neutral-800 rounded border border-neutral-700 shrink-0"; 
      preview.appendChild(img);
    };
    reader.readAsDataURL(file);
  }
});

document.getElementById('clearFallingBtn').addEventListener('click', () => {
  fallingImagesUrls = [];
  document.getElementById('fallingImages').value = '';
  const preview = document.getElementById('previewContainer');
  preview.innerHTML = '';
  preview.classList.add('hidden');
  document.getElementById('clearFallingBtn').classList.add('hidden');
});

document.getElementById('itemAmount').addEventListener('input', (e) => document.getElementById('amountLabel').innerText = `Quantità: ${e.target.value}`);
document.getElementById('itemSize').addEventListener('input', (e) => document.getElementById('sizeLabel').innerText = `Misura: ${e.target.value}px`);

document.getElementById('spawnBtn').addEventListener('click', () => {
  if (fallingImagesUrls.length === 0) return alert("Carica un'immagine per gli elementi cadenti!");
  
  const effect = document.getElementById('physicsEffect').value;
  const shape = document.getElementById('shapeType').value;
  
  let amount = parseInt(document.getElementById('itemAmount').value);
  let baseSize = parseInt(document.getElementById('itemSize').value);
  if (effect === 'fluid') { amount = Math.max(amount, 50); baseSize = 15; }

  const btn = document.getElementById('spawnBtn');
  btn.disabled = true; btn.style.opacity = "0.5";

  let spawnedCount = 0;
  let spawnDelay = effect === 'explosion' ? 20 : (effect === 'popcorn' ? 30 : (effect === 'cannons' ? 100 : 150));
  if (effect === 'fluid') spawnDelay = 10; 

  const interval = setInterval(() => {
    if (spawnedCount >= amount) { clearInterval(interval); btn.disabled = false; btn.style.opacity = "1"; return; }

    const imgUrl = fallingImagesUrls[spawnedCount % fallingImagesUrls.length];
    
    let radius = baseSize + Math.random() * (baseSize / 3);
    if (modChaos && Math.random() < 0.1 && effect !== 'fluid') radius *= 3.5; 

    let startX = (CANVAS_WIDTH / 2) + (Math.random() - 0.5) * 800;
    let startY = -200 - (Math.random() * 200);
    let velX = (Math.random() - 0.5) * 4;
    let velY = 0;
    
    let physOptions = { restitution: 0.5, friction: 0.5, density: 0.04, frictionAir: 0.01, collisionFilter: { category: COLLISION.ITEM, mask: COLLISION.WALL | COLLISION.CENTER | COLLISION.ITEM } };

    if (effect === 'bouncy') { physOptions.restitution = 1.1; physOptions.frictionAir = 0.001; }
    if (effect === 'heavy') { physOptions.density = 0.5; physOptions.restitution = 0.1; }
    if (effect === 'space') { physOptions.frictionAir = 0.08; physOptions.restitution = 0.9; }
    if (effect === 'leaves') { physOptions.frictionAir = 0.05; }
    if (effect === 'windRight') { startX = -100; startY = Math.random() * CANVAS_HEIGHT; velX = 15; }
    if (effect === 'windLeft') { startX = CANVAS_WIDTH + 100; startY = Math.random() * CANVAS_HEIGHT; velX = -15; }
    if (effect === 'explosion') { startY = CANVAS_HEIGHT + 100; velY = -30 - Math.random() * 15; velX = (Math.random() - 0.5) * 25; }
    if (effect === 'fluid') { physOptions.restitution = 0.1; physOptions.friction = 0.001; physOptions.density = 0.1; }
    if (effect === 'popcorn') {
      startX = 150 + Math.random() * (CANVAS_WIDTH - 300); startY = CANVAS_HEIGHT - 50; 
      velY = -35 - Math.random() * 20; velX = (Math.random() - 0.5) * 15; physOptions.restitution = 0.8;
    }
    if (effect === 'cannons') {
      startY = 200 + Math.random() * (CANVAS_HEIGHT - 400);
      if (spawnedCount % 2 === 0) { startX = -50; velX = 25 + Math.random() * 10; velY = -5; } 
      else { startX = CANVAS_WIDTH + 50; velX = -25 - Math.random() * 10; velY = -5; }
    }

    let isRect = shape === 'rectangle' || (shape === 'mixed' && Math.random() > 0.5);
    let body;
    
    const renderOpts = { sprite: { texture: imgUrl, xScale: 1, yScale: 1 } };

    if (isRect) {
      body = Matter.Bodies.rectangle(startX, startY, radius * 1.8, radius * 1.8, { ...physOptions, render: renderOpts });
    } else {
      body = Matter.Bodies.circle(startX, startY, radius, { ...physOptions, render: renderOpts });
    }

    const img = new Image();
    img.onload = () => {
      const maxDim = Math.max(img.naturalWidth, img.naturalHeight);
      const scale = isRect ? ((radius * 1.8) / maxDim) : ((radius * 2.2) / maxDim);
      body.render.sprite.xScale = scale; body.render.sprite.yScale = scale;
    };
    img.src = imgUrl;

    Matter.Body.setVelocity(body, { x: velX, y: velY });
    Matter.Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.4);

    Matter.Composite.add(engine.world, body);
    spawnedCount++;
  }, spawnDelay); 
});

document.getElementById('clearBtn').addEventListener('click', () => {
  Matter.Composite.remove(engine.world, Matter.Composite.allBodies(engine.world).filter(b => !b.isStatic));
});

const recBtn = document.getElementById('recordBtn');
const recText = document.getElementById('recordText');
const recStat = document.getElementById('recordStatus');

recBtn.addEventListener('click', () => {
  if (isProcessingZip) return;
  
  if (isRecording) {
    isRecording = false; 
    isProcessingZip = true;
    
    recBtn.className = "w-full py-2.5 rounded text-xs font-medium flex items-center justify-center gap-2 transition bg-neutral-800 text-neutral-400 cursor-wait";
    recText.innerText = "Elaborazione..."; 
    recStat.innerText = `Compressione di ${recordedFrames.length} immagini. Attendi...`; 
    recStat.className = "text-center text-[10px] text-neutral-400 mt-2 block";

    setTimeout(() => {
      const zip = new JSZip(); const imgF = zip.folder("sequence");
      recordedFrames.forEach((d, i) => imgF.file(`frame_${String(i+1).padStart(4,'0')}.jpg`, d.split(',')[1], {base64: true}));
      zip.generateAsync({type:"blob"}).then(c => {
        const a = document.createElement("a"); a.href = URL.createObjectURL(c); a.download = `physic_reels_${Date.now()}.zip`; a.click();
        isProcessingZip = false; recordedFrames = [];
        recBtn.className = "w-full py-2.5 rounded text-xs font-medium flex items-center justify-center gap-2 transition bg-white text-black hover:bg-neutral-200";
        recText.innerText = "Esporta Sequenza"; recStat.className = "hidden";
      });
    }, 100);
  } else {
    recordedFrames = []; 
    isRecording = true;
    lastCaptureTime = performance.now(); 
    
    recBtn.className = "w-full py-2.5 rounded text-xs font-medium flex items-center justify-center gap-2 transition bg-neutral-800 text-white animate-pulse";
    recText.innerText = "Ferma ed Esporta"; 
    recStat.innerText = "Avvio registrazione..."; 
    recStat.className = "text-center text-[10px] text-white mt-2 block";
  }
});

initPhysics();
