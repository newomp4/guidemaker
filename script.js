/* ============================================================
   Guidemaker — fast screenshot markup tool
   Pure vanilla JS, zero dependencies, single HTML5 canvas.
   ============================================================ */

(() => {
  'use strict';

  /* ---------- constants ---------- */
  const ACCENT = '#ff6a1a';                 // the single orange used for all markup
  const FONT   = '"Helvetica Neue", Helvetica, Arial, sans-serif';

  /* ---------- DOM refs ---------- */
  const canvas     = document.getElementById('canvas');
  const ctx        = canvas.getContext('2d');
  const canvasWrap = document.getElementById('canvasWrap');
  const dropzone   = document.getElementById('dropzone');
  const fileInput  = document.getElementById('fileInput');
  const textInput  = document.getElementById('textInput');
  const statusEl   = document.getElementById('statusLeft');
  const toolBtns   = [...document.querySelectorAll('.tool')];

  /* ---------- state ---------- */
  const state = {
    image:       null,    // HTMLImageElement of the loaded screenshot
    markups:     [],      // committed markups
    draft:       null,    // in-progress markup while dragging
    tool:        'box',   // 'box' | 'arrow' | 'text'
    strokeWidth: 4,       // scaled to image
    fontSize:    28,      // scaled to image
    headLen:     20,      // arrowhead size, scaled
    editingText: null,    // {x, y} while a text input is open
  };

  /* ---------- tool selection ---------- */
  function setTool(name) {
    state.tool = name;
    toolBtns.forEach(b => b.classList.toggle('active', b.dataset.tool === name));
    canvas.classList.toggle('tool-text', name === 'text');
    setStatus(`Tool: ${name[0].toUpperCase() + name.slice(1)}`);
  }
  toolBtns.forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
  setTool('box');

  /* ---------- status helper ---------- */
  function setStatus(msg) { statusEl.textContent = msg; }

  /* ============================================================
     LOADING IMAGES — drag/drop, paste, file picker
     ============================================================ */

  function loadImageFromFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = e => loadImageFromDataURL(e.target.result);
    reader.readAsDataURL(file);
  }

  function loadImageFromDataURL(url) {
    const img = new Image();
    img.onload = () => setImage(img);
    img.onerror = () => setStatus('Could not load image');
    img.src = url;
  }

  function setImage(img) {
    state.image   = img;
    state.markups = [];
    state.draft   = null;

    canvas.width  = img.naturalWidth;
    canvas.height = img.naturalHeight;

    // scale stroke + font to the image so they read the same on any resolution
    const minDim = Math.min(img.naturalWidth, img.naturalHeight);
    state.strokeWidth = Math.max(3, Math.round(minDim * 0.004));
    state.fontSize    = Math.max(18, Math.round(img.naturalHeight * 0.025));
    state.headLen     = Math.max(14, Math.round(state.strokeWidth * 4));

    dropzone.hidden   = true;
    canvasWrap.hidden = false;

    redraw();
    setStatus(`${img.naturalWidth} × ${img.naturalHeight}`);
  }

  // file input (click "browse")
  fileInput.addEventListener('change', e => {
    if (e.target.files[0]) loadImageFromFile(e.target.files[0]);
    fileInput.value = '';
  });

  // drag and drop (whole window)
  let dragCounter = 0;
  window.addEventListener('dragenter', e => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    dragCounter++;
    document.body.classList.add('dragging-file');
  });
  window.addEventListener('dragleave', e => {
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      document.body.classList.remove('dragging-file');
    }
  });
  window.addEventListener('dragover', e => { e.preventDefault(); });
  window.addEventListener('drop', e => {
    e.preventDefault();
    dragCounter = 0;
    document.body.classList.remove('dragging-file');
    const file = [...e.dataTransfer.files].find(f => f.type.startsWith('image/'));
    if (file) loadImageFromFile(file);
  });

  // paste from clipboard
  window.addEventListener('paste', e => {
    const item = [...e.clipboardData.items].find(i => i.type.startsWith('image/'));
    if (!item) return;
    e.preventDefault();
    loadImageFromFile(item.getAsFile());
  });

  /* ============================================================
     COORDINATES — canvas is displayed scaled, we draw in image px
     ============================================================ */

  function toCanvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width  / rect.width;
    const sy = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * sx,
      y: (e.clientY - rect.top)  * sy,
    };
  }

  function displayScale() {
    const rect = canvas.getBoundingClientRect();
    return rect.width / canvas.width;  // CSS px per image px
  }

  /* ============================================================
     DRAWING
     ============================================================ */

  function redraw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (state.image) ctx.drawImage(state.image, 0, 0);
    for (const m of state.markups) drawMarkup(m);
    if (state.draft)               drawMarkup(state.draft);
  }

  function drawMarkup(m) {
    ctx.strokeStyle = ACCENT;
    ctx.fillStyle   = ACCENT;
    ctx.lineWidth   = m.strokeWidth || state.strokeWidth;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';

    if (m.type === 'box') {
      const x = Math.min(m.x1, m.x2), y = Math.min(m.y1, m.y2);
      const w = Math.abs(m.x2 - m.x1), h = Math.abs(m.y2 - m.y1);
      ctx.strokeRect(x, y, w, h);

    } else if (m.type === 'arrow') {
      drawArrow(m.x1, m.y1, m.x2, m.y2, m.strokeWidth || state.strokeWidth,
                m.headLen || state.headLen);

    } else if (m.type === 'text') {
      ctx.textBaseline = 'top';
      ctx.font = `700 ${m.fontSize}px ${FONT}`;
      ctx.fillText(m.text, m.x, m.y);
    }
  }

  function drawArrow(x1, y1, x2, y2, lineW, headLen) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 1) return;
    const angle = Math.atan2(dy, dx);

    // shorten the shaft so the stroke endpoint sits inside the arrowhead base
    const shaftEnd = Math.max(0, len - headLen * 0.6);
    const sx = x1 + Math.cos(angle) * shaftEnd;
    const sy = y1 + Math.sin(angle) * shaftEnd;

    ctx.lineWidth = lineW;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(sx, sy);
    ctx.stroke();

    // filled triangular arrowhead
    const spread = Math.PI / 7;
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headLen * Math.cos(angle - spread),
               y2 - headLen * Math.sin(angle - spread));
    ctx.lineTo(x2 - headLen * Math.cos(angle + spread),
               y2 - headLen * Math.sin(angle + spread));
    ctx.closePath();
    ctx.fill();
  }

  /* ============================================================
     POINTER — box / arrow drag, text placement
     ============================================================ */

  let dragging = false;

  canvas.addEventListener('pointerdown', e => {
    if (!state.image) return;
    if (state.editingText) { commitText(); return; }

    const p = toCanvasCoords(e);

    if (state.tool === 'text') {
      openTextEditor(p.x, p.y);
      return;
    }

    dragging = true;
    canvas.setPointerCapture(e.pointerId);
    state.draft = {
      type: state.tool,
      x1: p.x, y1: p.y,
      x2: p.x, y2: p.y,
      strokeWidth: state.strokeWidth,
      headLen: state.headLen,
    };
    redraw();
  });

  canvas.addEventListener('pointermove', e => {
    if (!dragging || !state.draft) return;
    const p = toCanvasCoords(e);
    state.draft.x2 = p.x;
    state.draft.y2 = p.y;
    redraw();
  });

  canvas.addEventListener('pointerup', e => {
    if (!dragging) return;
    dragging = false;
    canvas.releasePointerCapture(e.pointerId);

    // ignore tiny accidental drags
    const d = state.draft;
    const dist = Math.hypot(d.x2 - d.x1, d.y2 - d.y1);
    if (dist >= 6) state.markups.push(d);
    state.draft = null;
    redraw();
  });

  /* ============================================================
     TEXT TOOL — contenteditable overlay, commits to canvas
     ============================================================ */

  function openTextEditor(x, y) {
    state.editingText = { x, y };

    const scale = displayScale();
    textInput.textContent = '';
    textInput.style.left     = (x * scale) + 'px';
    textInput.style.top      = (y * scale) + 'px';
    textInput.style.fontSize = (state.fontSize * scale) + 'px';
    textInput.style.lineHeight = '1';
    textInput.classList.add('active');
    // focus on next tick so the click that opened it doesn't dismiss it
    requestAnimationFrame(() => {
      textInput.focus();
      placeCaretAtEnd(textInput);
    });
  }

  function placeCaretAtEnd(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function commitText() {
    if (!state.editingText) return;
    const value = textInput.textContent.trim();
    const { x, y } = state.editingText;
    state.editingText = null;
    textInput.classList.remove('active');
    textInput.textContent = '';
    if (value) {
      state.markups.push({
        type: 'text',
        x, y,
        text: value,
        fontSize: state.fontSize,
      });
    }
    redraw();
  }

  function cancelText() {
    if (!state.editingText) return;
    state.editingText = null;
    textInput.classList.remove('active');
    textInput.textContent = '';
  }

  textInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitText(); }
    else if (e.key === 'Escape')          { e.preventDefault(); cancelText(); }
    e.stopPropagation();  // don't let canvas shortcuts fire while typing
  });
  textInput.addEventListener('blur', () => { if (state.editingText) commitText(); });

  /* ============================================================
     ACTIONS — undo, clear, new, export
     ============================================================ */

  function undo() {
    if (state.editingText) { cancelText(); return; }
    if (state.markups.length === 0) return;
    state.markups.pop();
    redraw();
  }

  function clearAll() {
    if (state.markups.length === 0) return;
    state.markups = [];
    redraw();
  }

  function resetImage() {
    state.image = null;
    state.markups = [];
    state.draft = null;
    cancelText();
    canvasWrap.hidden = true;
    dropzone.hidden   = false;
    setStatus('Ready');
  }

  function exportPNG() {
    if (!state.image) return;
    // make sure any in-progress text gets baked in
    if (state.editingText) commitText();
    redraw();

    canvas.toBlob(blob => {
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      a.href = url;
      a.download = `guidemaker-${stamp}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus('Exported');
    }, 'image/png');
  }

  document.getElementById('undoBtn').addEventListener('click', undo);
  document.getElementById('clearBtn').addEventListener('click', clearAll);
  document.getElementById('newBtn').addEventListener('click', resetImage);
  document.getElementById('exportBtn').addEventListener('click', exportPNG);

  /* ============================================================
     KEYBOARD SHORTCUTS
     ============================================================ */

  window.addEventListener('keydown', e => {
    // never steal keys while typing in the text overlay
    if (state.editingText) return;

    const mod = e.metaKey || e.ctrlKey;

    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
    if (mod && e.key.toLowerCase() === 'e') { e.preventDefault(); exportPNG(); return; }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); exportPNG(); return; }
    if (mod) return;

    switch (e.key.toLowerCase()) {
      case 'b': setTool('box');   break;
      case 'a': setTool('arrow'); break;
      case 't': setTool('text');  break;
    }
  });

  /* ============================================================
     MISC
     ============================================================ */

  // reposition an open text editor if the window resizes
  window.addEventListener('resize', () => {
    if (!state.editingText) return;
    const { x, y } = state.editingText;
    const scale = displayScale();
    textInput.style.left     = (x * scale) + 'px';
    textInput.style.top      = (y * scale) + 'px';
    textInput.style.fontSize = (state.fontSize * scale) + 'px';
  });

})();
