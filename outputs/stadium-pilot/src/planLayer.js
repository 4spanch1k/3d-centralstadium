// Готовый план секторов: картинка + маска идентификаторов (R + 256·G = номер сектора) вместо живой 3D-сцены.
// Нужен слабым устройствам и телефонам: чёткий кадр без нагрузки на GPU, выбор сектора по маске за O(1).
// Подсветка рисуется на 2D-слое по контурам из sectors.json: выбранный сектор яркий с золотой кромкой, остальные приглушены.
export function createPlanLayer({ asset, getArea, onHover, onPick }) {
  const root = document.createElement('div');
  root.id = 'plan-layer';
  root.hidden = true;
  root.innerHTML = '<div class="plan-frame"><img alt="" draggable="false" /><canvas></canvas></div>';
  document.querySelector('#app').insertBefore(root, document.querySelector('.topbar'));
  const frame = root.querySelector('.plan-frame');
  const image = root.querySelector('img');
  const overlay = root.querySelector('canvas');
  const context = overlay.getContext('2d');

  let variant = null; // 'phone' | 'desktop'
  let data = null; // { ids, width, height, sectors: Map, crop }
  let loading = null;
  const cache = new Map(); // имя варианта → обещание готовых данных
  let active = false;
  let lit = null;

  const pickVariant = () => (window.innerWidth <= 700 || window.innerHeight > window.innerWidth ? 'phone' : 'desktop');

  async function load(name) {
    const [meta, maskBlob, imageBlob] = await Promise.all([
      fetch(asset('pre/plan/sectors.json')).then((r) => r.json()),
      fetch(asset(`pre/plan/plan-${name}-id.png`)).then((r) => r.blob()),
      fetch(asset(`pre/plan/plan-${name}.webp`)).then((r) => r.blob()),
    ]);
    const [width, height] = meta.sizes[name];
    // Маску читаем без цветокоррекции и сглаживания: цвет пикселя это номер сектора.
    const bitmap = await createImageBitmap(maskBlob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const scratch = document.createElement('canvas');
    scratch.width = width;
    scratch.height = height;
    const scratchContext = scratch.getContext('2d', { willReadFrequently: true });
    scratchContext.imageSmoothingEnabled = false;
    scratchContext.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    const pixels = scratchContext.getImageData(0, 0, width, height).data;
    const ids = new Uint16Array(width * height);
    for (let i = 0; i < ids.length; i += 1) ids[i] = pixels[i * 4] + 256 * pixels[i * 4 + 1];
    const sectors = new Map();
    let left = Infinity; let top = Infinity; let right = 0; let bottom = 0;
    for (const sector of meta.sectors) {
      const view = sector[name];
      sectors.set(sector.number, { ...view, number: sector.number, stand: sector.stand, label: sector.label, seatCount: sector.seatCount });
      left = Math.min(left, view.bounds[0]); top = Math.min(top, view.bounds[1]);
      right = Math.max(right, view.bounds[2]); bottom = Math.max(bottom, view.bounds[3]);
    }
    const margin = Math.round((right - left) * 0.04);
    const crop = [Math.max(0, left - margin), Math.max(0, top - margin), Math.min(width, right + margin), Math.min(height, bottom + margin)];
    const url = URL.createObjectURL(imageBlob);
    return { ids, width, height, sectors, crop, url };
  }
  // Данные варианта читаются один раз: заранее из очереди или при первом показе. После ошибки можно повторить.
  function obtain(name) {
    if (!cache.has(name)) cache.set(name, load(name).catch((error) => { cache.delete(name); throw error; }));
    return cache.get(name);
  }

  function layout() {
    if (!data) return;
    const area = getArea();
    const [cropLeft, cropTop, cropRight, cropBottom] = data.crop;
    const scale = Math.min(area.width / (cropRight - cropLeft), area.height / (cropBottom - cropTop));
    const x = area.x + (area.width - (cropRight - cropLeft) * scale) / 2 - cropLeft * scale;
    const y = area.y + (area.height - (cropBottom - cropTop) * scale) / 2 - cropTop * scale;
    frame.style.width = `${data.width * scale}px`;
    frame.style.height = `${data.height * scale}px`;
    frame.style.transform = `translate(${x}px, ${y}px)`;
    frame.dataset.scale = String(scale);
  }

  function draw(sector) {
    if (!data) return;
    context.clearRect(0, 0, overlay.width, overlay.height);
    const phone = variant === 'phone';
    const fontSize = Math.round(overlay.width * (phone ? 0.019 : 0.0085));
    const path = (polygons) => {
      context.beginPath();
      for (const polygon of polygons) {
        polygon.forEach(([px, py], index) => (index ? context.lineTo(px, py) : context.moveTo(px, py)));
        context.closePath();
      }
    };
    if (sector !== null && data.sectors.has(sector)) {
      context.fillStyle = 'rgba(14, 24, 20, 0.52)';
      context.fillRect(0, 0, overlay.width, overlay.height);
      const target = data.sectors.get(sector);
      context.save();
      path(target.polygons);
      context.globalCompositeOperation = 'destination-out';
      context.fill();
      context.restore();
      path(target.polygons);
      context.fillStyle = 'rgba(255, 236, 170, 0.26)';
      context.fill();
      context.lineJoin = 'round';
      context.lineWidth = Math.max(3, overlay.width * 0.0028);
      context.strokeStyle = '#f2c14e';
      context.stroke();
    }
    // Номера секторов поверх плана.
    context.font = `700 ${fontSize}px system-ui, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.lineJoin = 'round';
    context.lineWidth = fontSize * 0.28;
    for (const item of data.sectors.values()) {
      const [cx, cy] = item.center;
      const text = String(item.number);
      const emphasis = item.number === sector;
      context.strokeStyle = emphasis ? 'rgba(20, 44, 33, 0.95)' : 'rgba(20, 44, 33, 0.7)';
      context.fillStyle = '#fff';
      context.strokeText(text, cx, cy);
      context.fillText(text, cx, cy);
    }
    lit = sector;
  }

  function sectorAt(clientX, clientY) {
    if (!data) return null;
    const bounds = frame.getBoundingClientRect();
    const px = Math.floor((clientX - bounds.left) / bounds.width * data.width);
    const py = Math.floor((clientY - bounds.top) / bounds.height * data.height);
    if (px < 0 || py < 0 || px >= data.width || py >= data.height) return null;
    const id = data.ids[py * data.width + px];
    if (id) return id;
    // Щели на проходах: берём ближайший сектор в небольшом окне вокруг точки.
    const reach = Math.round(data.width * 0.004);
    let best = 0; let bestDistance = Infinity;
    for (let dy = -reach; dy <= reach; dy += 1) {
      for (let dx = -reach; dx <= reach; dx += 1) {
        const x = px + dx; const y = py + dy;
        if (x < 0 || y < 0 || x >= data.width || y >= data.height) continue;
        const value = data.ids[y * data.width + x];
        const distance = dx * dx + dy * dy;
        if (value && distance < bestDistance) { best = value; bestDistance = distance; }
      }
    }
    return best || null;
  }

  let hoverFrame = 0;
  root.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') return;
    const now = performance.now();
    if (now - hoverFrame < 30) return;
    hoverFrame = now;
    const sector = sectorAt(event.clientX, event.clientY);
    root.style.cursor = sector ? 'pointer' : '';
    onHover(sector, event, data?.sectors.get(sector) || null);
  });
  // У касания pointerleave приходит сразу после отпускания пальца: подсветку первого касания он не должен снимать,
  // иначе второе касание снова считается первым и сектор не открывается.
  root.addEventListener('pointerleave', (event) => { if (event.pointerType !== 'touch') onHover(null, null, null); });
  root.addEventListener('pointerup', (event) => {
    const sector = sectorAt(event.clientX, event.clientY);
    if (sector) onPick(sector, event, data.sectors.get(sector));
  });

  async function show() {
    const wanted = pickVariant();
    active = true;
    if (!data || variant !== wanted) {
      variant = wanted;
      const request = (loading = obtain(wanted));
      try {
        const loaded = await request;
        if (request !== loading) return;
        if (image.src !== loaded.url) {
          image.src = loaded.url;
          await image.decode().catch(() => {});
          if (request !== loading) return;
        }
        overlay.width = loaded.width;
        overlay.height = loaded.height;
        data = loaded;
      } catch (error) {
        console.warn('План секторов не загрузился', error);
        active = false;
        return false;
      }
    }
    if (!active) return true;
    layout();
    draw(lit);
    root.hidden = false;
    requestAnimationFrame(() => root.classList.add('visible'));
    return true;
  }
  function hide() {
    active = false;
    root.classList.remove('visible');
    root.hidden = true;
  }
  window.addEventListener('resize', () => {
    if (!active) return;
    if (pickVariant() !== variant) show();
    else layout();
  });
  return {
    show,
    hide,
    prefetch: () => obtain(pickVariant()),
    highlight: (sector) => { if (data && sector !== lit) draw(sector); else lit = sector; },
    get ready() { return active && !!data; },
  };
}
