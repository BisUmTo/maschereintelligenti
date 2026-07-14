/*
 * Strumento ALLINEA — allinea la scansione della maschera al template.
 *
 * La scansione (PDF o immagine) viene mostrata sopra il template con opacità
 * regolabile; si sposta trascinando e si scala con slider/rotellina.
 * Il download produce un .jpg quadrato con la sola scansione, nella stessa
 * posizione in cui è stata allineata.
 */
(function () {
    'use strict';

    const SIZE = 1000;        // risoluzione interna del canvas di anteprima
    const EXPORT_SIZE = 2048; // risoluzione del .jpg esportato
    const RASTER_MAX = 2400;  // lato massimo della rasterizzazione della scansione

    // Foglio A4 verticale: 21 x 29.7 cm. Il template è stampato come quadrato
    // di 19 cm centrato, con 1 cm di margine per lato laterale.
    const A4_W_CM = 21;
    const A4_H_CM = 29.7;
    const MARGIN_CM = 1;
    const TEMPLATE_CM = A4_W_CM - 2 * MARGIN_CM; // 19 cm

    const canvas = document.getElementById('align-canvas');
    const ctx = canvas.getContext('2d');
    const canvasWrap = document.getElementById('canvas-wrap');
    const canvasHint = document.getElementById('canvas-hint');
    const fileInput = document.getElementById('file-input');
    const fileStatus = document.getElementById('file-status');
    const controls = document.getElementById('align-controls');
    const opacitySlider = document.getElementById('opacity-slider');
    const zoomSlider = document.getElementById('zoom-slider');
    const rotateLeftBtn = document.getElementById('rotate-left');
    const rotateRightBtn = document.getElementById('rotate-right');
    const resetBtn = document.getElementById('reset-btn');
    const downloadBtn = document.getElementById('download-btn');

    if (window.pdfjsLib) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
    }

    const template = new Image();
    template.src = 'assets/template.png';
    template.onload = draw;

    let srcCanvas = null;   // scansione rasterizzata, orientamento originale
    let scanCanvas = null;  // scansione con la rotazione corrente applicata
    let rotation = 0;       // 0 | 90 | 180 | 270
    let view = { x: 0, y: 0, scale: 1 };
    let defaultScale = 1;
    let opacity = 0.55;

    setLoaded(false);

    function setLoaded(loaded) {
        controls.classList.toggle('disabled', !loaded);
        canvasHint.classList.toggle('hidden', loaded);
        downloadBtn.disabled = !loaded;
    }

    /* ---------- Posizionamento di default (A4 con margini di 1 cm) ---------- */

    function applyDefaultPlacement() {
        const w = scanCanvas.width;
        const h = scanCanvas.height;
        const pxPerCm = w / A4_W_CM;
        const regionW = TEMPLATE_CM * pxPerCm;
        const regionX = MARGIN_CM * pxPerCm;
        const regionY = (h - regionW) / 2;

        view.scale = SIZE / regionW;
        view.x = -regionX * view.scale;
        view.y = -regionY * view.scale;
        defaultScale = view.scale;
        zoomSlider.value = 100;
    }

    /* ---------- Disegno ---------- */

    function draw() {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, SIZE, SIZE);
        if (template.complete && template.naturalWidth) {
            ctx.drawImage(template, 0, 0, SIZE, SIZE);
        }
        if (scanCanvas) {
            ctx.globalAlpha = opacity;
            ctx.drawImage(
                scanCanvas,
                view.x, view.y,
                scanCanvas.width * view.scale,
                scanCanvas.height * view.scale
            );
            ctx.globalAlpha = 1;
        }
    }

    /* ---------- Caricamento file ---------- */

    async function loadFile(file) {
        if (!file) return;
        fileStatus.textContent = 'Caricamento…';
        try {
            let raster;
            if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
                raster = await rasterizePdf(file);
            } else if (file.type.startsWith('image/')) {
                raster = await rasterizeImage(file);
            } else {
                throw new Error('Formato non supportato: carica un .pdf o un\'immagine.');
            }
            srcCanvas = raster;
            rotation = 0;
            scanCanvas = srcCanvas;
            applyDefaultPlacement();
            opacity = opacitySlider.value / 100;
            setLoaded(true);
            fileStatus.textContent = '✅ ' + file.name;
            draw();
        } catch (err) {
            console.error(err);
            fileStatus.textContent = '❌ Errore: ' + err.message;
        }
    }

    async function rasterizePdf(file) {
        if (!window.pdfjsLib) {
            throw new Error('Libreria PDF non caricata: controlla la connessione e ricarica la pagina.');
        }
        const data = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data }).promise;
        const page = await pdf.getPage(1);
        const base = page.getViewport({ scale: 1 });
        const scale = RASTER_MAX / Math.max(base.width, base.height);
        const viewport = page.getViewport({ scale });
        const c = document.createElement('canvas');
        c.width = Math.round(viewport.width);
        c.height = Math.round(viewport.height);
        const cctx = c.getContext('2d');
        cctx.fillStyle = '#ffffff';
        cctx.fillRect(0, 0, c.width, c.height);
        // intent 'print': niente pacing via requestAnimationFrame, così il
        // render completa anche in schede in background o throttled.
        await page.render({ canvasContext: cctx, viewport, intent: 'print' }).promise;
        return c;
    }

    function rasterizeImage(file) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                URL.revokeObjectURL(url);
                const scale = Math.min(1, RASTER_MAX / Math.max(img.width, img.height));
                const c = document.createElement('canvas');
                c.width = Math.round(img.width * scale);
                c.height = Math.round(img.height * scale);
                c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
                resolve(c);
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('Immagine non leggibile.'));
            };
            img.src = url;
        });
    }

    /* ---------- Rotazione ---------- */

    function applyRotation() {
        const rad = rotation * Math.PI / 180;
        const swap = rotation === 90 || rotation === 270;
        const c = document.createElement('canvas');
        c.width = swap ? srcCanvas.height : srcCanvas.width;
        c.height = swap ? srcCanvas.width : srcCanvas.height;
        const cctx = c.getContext('2d');
        cctx.translate(c.width / 2, c.height / 2);
        cctx.rotate(rad);
        cctx.drawImage(srcCanvas, -srcCanvas.width / 2, -srcCanvas.height / 2);
        scanCanvas = c;
        applyDefaultPlacement();
        draw();
    }

    function rotate(deltaDeg) {
        if (!srcCanvas) return;
        rotation = (rotation + deltaDeg + 360) % 360;
        applyRotation();
    }

    /* ---------- Zoom ---------- */

    function zoomAt(cx, cy, factor) {
        const newScale = clamp(view.scale * factor, defaultScale * 0.2, defaultScale * 5);
        factor = newScale / view.scale;
        view.x = cx - (cx - view.x) * factor;
        view.y = cy - (cy - view.y) * factor;
        view.scale = newScale;
        syncZoomSlider();
        draw();
    }

    function syncZoomSlider() {
        zoomSlider.value = clamp(Math.round((view.scale / defaultScale) * 100), 50, 200);
    }

    function clamp(v, min, max) {
        return Math.min(max, Math.max(min, v));
    }

    /* Converte coordinate evento -> pixel interni del canvas */
    function canvasPoint(e) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) * (SIZE / rect.width),
            y: (e.clientY - rect.top) * (SIZE / rect.height)
        };
    }

    /* ---------- Trascinamento e pinch ---------- */

    const pointers = new Map();
    let pinchStartDist = 0;
    let pinchStartScale = 1;

    canvas.addEventListener('pointerdown', (e) => {
        if (!scanCanvas) return;
        canvas.setPointerCapture(e.pointerId);
        pointers.set(e.pointerId, canvasPoint(e));
        if (pointers.size === 2) {
            const pts = [...pointers.values()];
            pinchStartDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
            pinchStartScale = view.scale;
        }
        canvas.classList.add('dragging');
    });

    canvas.addEventListener('pointermove', (e) => {
        if (!pointers.has(e.pointerId)) return;
        const prev = pointers.get(e.pointerId);
        const pt = canvasPoint(e);
        pointers.set(e.pointerId, pt);

        if (pointers.size === 1) {
            view.x += pt.x - prev.x;
            view.y += pt.y - prev.y;
            draw();
        } else if (pointers.size === 2 && pinchStartDist > 0) {
            const pts = [...pointers.values()];
            const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
            const midX = (pts[0].x + pts[1].x) / 2;
            const midY = (pts[0].y + pts[1].y) / 2;
            zoomAt(midX, midY, (pinchStartScale * (dist / pinchStartDist)) / view.scale);
        }
    });

    function endPointer(e) {
        pointers.delete(e.pointerId);
        if (pointers.size < 2) pinchStartDist = 0;
        if (pointers.size === 0) canvas.classList.remove('dragging');
    }
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);

    canvas.addEventListener('wheel', (e) => {
        if (!scanCanvas) return;
        e.preventDefault();
        const pt = canvasPoint(e);
        zoomAt(pt.x, pt.y, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });

    /* ---------- Controlli ---------- */

    fileInput.addEventListener('change', () => loadFile(fileInput.files[0]));

    canvasWrap.addEventListener('dragover', (e) => {
        e.preventDefault();
        canvasWrap.classList.add('dragover');
    });
    canvasWrap.addEventListener('dragleave', () => canvasWrap.classList.remove('dragover'));
    canvasWrap.addEventListener('drop', (e) => {
        e.preventDefault();
        canvasWrap.classList.remove('dragover');
        loadFile(e.dataTransfer.files[0]);
    });

    opacitySlider.addEventListener('input', () => {
        opacity = opacitySlider.value / 100;
        draw();
    });

    zoomSlider.addEventListener('input', () => {
        const target = defaultScale * (zoomSlider.value / 100);
        zoomAt(SIZE / 2, SIZE / 2, target / view.scale);
    });

    rotateLeftBtn.addEventListener('click', () => rotate(-90));
    rotateRightBtn.addEventListener('click', () => rotate(90));

    resetBtn.addEventListener('click', () => {
        if (!scanCanvas) return;
        applyDefaultPlacement();
        draw();
    });

    downloadBtn.addEventListener('click', () => {
        if (!scanCanvas) return;
        const k = EXPORT_SIZE / SIZE;
        const c = document.createElement('canvas');
        c.width = EXPORT_SIZE;
        c.height = EXPORT_SIZE;
        const cctx = c.getContext('2d');
        cctx.fillStyle = '#ffffff';
        cctx.fillRect(0, 0, EXPORT_SIZE, EXPORT_SIZE);
        cctx.drawImage(
            scanCanvas,
            view.x * k, view.y * k,
            scanCanvas.width * view.scale * k,
            scanCanvas.height * view.scale * k
        );
        c.toBlob((blob) => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'maschera.jpg';
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 10000);
        }, 'image/jpeg', 0.92);
    });

    draw();
})();
