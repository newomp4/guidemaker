/* ============================================================
   Guidemaker — fast screenshot markup tool
   Pure vanilla JS, zero dependencies, single HTML5 canvas.

   State model
   -----------
   state.docs        = array of {id, image, markups[], selectedIdx}
   state.activeId    = id of the currently displayed doc
   state.tool        = 'select' | 'box' | 'arrow' | 'text'
   state.interaction = null, or an active drag: drawing/moving/resizing

   Markups are plain objects; every redraw paints the base image and
   all markups fresh, so undo is just a pop, and selection/handles are
   overlayed in screen-relative pixel sizes that stay crisp at any zoom.
   ============================================================ */

(() => {
  'use strict';

  /* ---------- constants ---------- */
  const ACCENT     = '#ff6a1a';
  const FONT       = '"Helvetica Neue", Helvetica, Arial, sans-serif';
  const HANDLE_PX  = 10;   // handle side length in screen pixels
  const HIT_TOL_PX = 8;    // pointer pick tolerance in screen pixels
  const SEL_DASH   = [6, 4];

  /* ---------- DOM refs ---------- */
  const canvas     = document.getElementById('canvas');
  const ctx        = canvas.getContext('2d');
  const canvasWrap = document.getElementById('canvasWrap');
  const dropzone   = document.getElementById('dropzone');
  const fileInput  = document.getElementById('fileInput');
  const textInput  = document.getElementById('textInput');
  const statusEl   = document.getElementById('statusLeft');
  const filmstrip  = document.getElementById('filmstrip');
  const filmScroll = document.getElementById('filmstripScroll');
  const toolBtns   = [...document.querySelectorAll('.tool')];

  /* ---------- state ---------- */
  const state = {
    docs: [],
    activeId: null,
    tool: 'box',
    interaction: null,   // {type:'drawing'|'moving'|'resizing', ...}
    editingText: null,   // {x,y,editIdx?} — editIdx re-uses an existing markup
    // defaults scoped to the active image (recomputed on switch)
    strokeWidth: 4,
    fontSize: 28,
    headLen: 20,
  };

  let nextId = 1;

  /* ---------- helpers ---------- */
  const activeDoc = () => state.docs.find(d => d.id === state.activeId) || null;
  const clamp     = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const setStatus = msg => { statusEl.textContent = msg; };

  /* ============================================================
     TOOL SELECTION
     ============================================================ */
  function setTool(name) {
    if (state.editingText) commitText();
    state.tool = name;
    toolBtns.forEach(b => b.classList.toggle('active', b.dataset.tool === name));
    canvas.classList.toggle('tool-text',   name === 'text');
    canvas.classList.toggle('tool-select', name === 'select');
    setStatus(`Tool: ${name[0].toUpperCase() + name.slice(1)}`);
    updateCursorIdle();
  }
  toolBtns.forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
  setTool('box');

  /* ============================================================
     IMAGE LOADING — drag/drop, paste, file picker
     Supports multi-file. Each image becomes its own doc.
     ============================================================ */

  function loadFiles(files) {
    const imgs = [...files].filter(f => f && f.type.startsWith('image/'));
    if (!imgs.length) return;
    imgs.forEach(f => {
      const reader = new FileReader();
      reader.onload = e => {
        const img = new Image();
        img.onload = () => addDoc(img);
        img.onerror = () => setStatus('Could not load image');
        img.src = e.target.result;
      };
      reader.readAsDataURL(f);
    });
  }

  function addDoc(image) {
    const doc = { id: nextId++, image, markups: [], selectedIdx: -1 };
    state.docs.push(doc);
    if (state.activeId === null) {
      switchToDoc(doc.id);
    } else {
      renderFilmstrip();
      setStatus(`Loaded ${state.docs.length} image${state.docs.length === 1 ? '' : 's'}`);
    }
  }

  function switchToDoc(id) {
    if (state.editingText) commitText();
    const doc = state.docs.find(d => d.id === id);
    if (!doc) return;
    state.activeId = id;
    state.interaction = null;

    const img = doc.image;
    canvas.width  = img.naturalWidth;
    canvas.height = img.naturalHeight;

    const minDim = Math.min(img.naturalWidth, img.naturalHeight);
    state.strokeWidth = Math.max(3, Math.round(minDim * 0.004));
    state.fontSize    = Math.max(18, Math.round(img.naturalHeight * 0.025));
    state.headLen     = Math.max(14, Math.round(state.strokeWidth * 4));

    dropzone.hidden   = true;
    canvasWrap.hidden = false;
    filmstrip.hidden  = state.docs.length === 0;

    renderFilmstrip();
    redraw();
    setStatus(`${img.naturalWidth} × ${img.naturalHeight}  ·  image ${state.docs.findIndex(d => d.id === id) + 1} of ${state.docs.length}`);
  }

  function removeDoc(id) {
    const i = state.docs.findIndex(d => d.id === id);
    if (i < 0) return;
    state.docs.splice(i, 1);
    if (state.activeId === id) {
      if (state.docs.length === 0) {
        state.activeId = null;
        canvasWrap.hidden = false;  // hide via filmstrip branch below
        canvasWrap.hidden = true;
        dropzone.hidden = false;
        filmstrip.hidden = true;
        setStatus('Ready');
        renderFilmstrip();
        return;
      }
      // pick neighbor
      switchToDoc(state.docs[Math.min(i, state.docs.length - 1)].id);
    } else {
      renderFilmstrip();
    }
  }

  /* ---------- filmstrip rendering ---------- */
  function renderFilmstrip() {
    filmstrip.hidden = state.docs.length === 0;
    filmScroll.innerHTML = '';
    state.docs.forEach((doc, idx) => {
      const t = document.createElement('div');
      t.className = 'thumb' +
        (doc.id === state.activeId ? ' active' : '') +
        (doc.markups.length > 0    ? ' has-markups' : '');
      t.title = `Image ${idx + 1}`;

      const img = document.createElement('img');
      img.src = doc.image.src;
      img.alt = '';
      t.appendChild(img);

      const badge = document.createElement('div');
      badge.className = 'thumb-index';
      badge.textContent = String(idx + 1);
      t.appendChild(badge);

      const x = document.createElement('button');
      x.className = 'thumb-remove';
      x.title = 'Remove';
      x.textContent = '×';
      x.addEventListener('click', ev => {
        ev.stopPropagation();
        removeDoc(doc.id);
      });
      t.appendChild(x);

      t.addEventListener('click', () => switchToDoc(doc.id));
      filmScroll.appendChild(t);
    });
  }

  // file input (browse / + button)
  fileInput.addEventListener('change', e => {
    if (e.target.files.length) loadFiles(e.target.files);
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
  window.addEventListener('dragleave', () => {
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
    if (e.dataTransfer.files.length) loadFiles(e.dataTransfer.files);
  });

  // paste from clipboard
  window.addEventListener('paste', e => {
    if (state.editingText) return;   // let the text overlay receive paste
    const items = [...e.clipboardData.items].filter(i => i.type.startsWith('image/'));
    if (!items.length) return;
    e.preventDefault();
    items.forEach(it => loadFiles([it.getAsFile()]));
  });

  /* ============================================================
     COORDINATES — canvas renders in image pixels, displays scaled
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
    return rect.width / canvas.width;   // CSS px per image px
  }

  function imgPerScreen(px) { return px / (displayScale() || 1); }
  function hitTol()         { return imgPerScreen(HIT_TOL_PX); }
  function handleSizeImg()  { return imgPerScreen(HANDLE_PX); }

  /* ============================================================
     DRAWING
     ============================================================ */

  function redraw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const doc = activeDoc();
    if (!doc) return;

    ctx.drawImage(doc.image, 0, 0);
    for (const m of doc.markups) drawMarkup(m);

    // in-progress draft
    if (state.interaction?.type === 'drawing') drawMarkup(state.interaction.draft);

    // selection chrome
    if (doc.selectedIdx >= 0 && doc.selectedIdx < doc.markups.length) {
      drawSelection(doc.markups[doc.selectedIdx]);
    }
  }

  function drawMarkup(m) {
    ctx.strokeStyle = ACCENT;
    ctx.fillStyle   = ACCENT;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.setLineDash([]);

    if (m.type === 'box') {
      ctx.lineWidth = m.strokeWidth;
      const minX = Math.min(m.x1, m.x2), maxX = Math.max(m.x1, m.x2);
      const minY = Math.min(m.y1, m.y2), maxY = Math.max(m.y1, m.y2);
      ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);

    } else if (m.type === 'arrow') {
      drawArrow(m.x1, m.y1, m.x2, m.y2, m.strokeWidth, m.headLen);

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
    const shaftEnd = Math.max(0, len - headLen * 0.6);
    const sx = x1 + Math.cos(angle) * shaftEnd;
    const sy = y1 + Math.sin(angle) * shaftEnd;

    ctx.lineWidth = lineW;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(sx, sy);
    ctx.stroke();

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

  function drawSelection(m) {
    const strokeW = 1.5 / (displayScale() || 1);
    const size    = handleSizeImg();

    ctx.save();
    ctx.lineWidth   = strokeW;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.setLineDash(SEL_DASH.map(v => v / (displayScale() || 1)));

    if (m.type === 'box') {
      const bb = boxBbox(m);
      ctx.strokeRect(bb.x, bb.y, bb.w, bb.h);
    } else if (m.type === 'text') {
      const bb = textBbox(m);
      ctx.strokeRect(bb.x, bb.y, bb.w, bb.h);
    } else if (m.type === 'arrow') {
      // subtle line echo, same path, dashed white
      ctx.beginPath();
      ctx.moveTo(m.x1, m.y1);
      ctx.lineTo(m.x2, m.y2);
      ctx.stroke();
    }

    ctx.setLineDash([]);
    ctx.fillStyle   = '#ffffff';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth   = strokeW;

    for (const h of getHandles(m)) {
      ctx.beginPath();
      ctx.rect(h.x - size / 2, h.y - size / 2, size, size);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ============================================================
     GEOMETRY — bboxes, handles, hit tests
     ============================================================ */

  function boxBbox(m) {
    const minX = Math.min(m.x1, m.x2), maxX = Math.max(m.x1, m.x2);
    const minY = Math.min(m.y1, m.y2), maxY = Math.max(m.y1, m.y2);
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  function textBbox(m) {
    ctx.save();
    ctx.font = `700 ${m.fontSize}px ${FONT}`;
    const metrics = ctx.measureText(m.text || ' ');
    ctx.restore();
    return { x: m.x, y: m.y, w: Math.max(metrics.width, 4), h: m.fontSize };
  }

  function getHandles(m) {
    if (m.type === 'box') {
      const bb = boxBbox(m);
      return [
        { name: 'nw', x: bb.x,          y: bb.y          },
        { name: 'ne', x: bb.x + bb.w,   y: bb.y          },
        { name: 'se', x: bb.x + bb.w,   y: bb.y + bb.h   },
        { name: 'sw', x: bb.x,          y: bb.y + bb.h   },
      ];
    }
    if (m.type === 'arrow') {
      return [
        { name: 'start', x: m.x1, y: m.y1 },
        { name: 'end',   x: m.x2, y: m.y2 },
      ];
    }
    if (m.type === 'text') {
      const bb = textBbox(m);
      return [{ name: 'se', x: bb.x + bb.w, y: bb.y + bb.h }];
    }
    return [];
  }

  function hitHandle(m, x, y, tol) {
    for (const h of getHandles(m)) {
      if (Math.abs(x - h.x) <= tol && Math.abs(y - h.y) <= tol) return h;
    }
    return null;
  }

  function hitBody(m, x, y, tol) {
    if (m.type === 'box') {
      const bb = boxBbox(m);
      return x >= bb.x - tol && x <= bb.x + bb.w + tol &&
             y >= bb.y - tol && y <= bb.y + bb.h + tol;
    }
    if (m.type === 'arrow') {
      return pointToLineDist(x, y, m.x1, m.y1, m.x2, m.y2) <= tol + m.strokeWidth / 2;
    }
    if (m.type === 'text') {
      const bb = textBbox(m);
      return x >= bb.x - tol && x <= bb.x + bb.w + tol &&
             y >= bb.y - tol && y <= bb.y + bb.h + tol;
    }
    return false;
  }

  function pointToLineDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(px - x1, py - y1);
    const t = clamp(((px - x1) * dx + (py - y1) * dy) / len2, 0, 1);
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  function topMarkupAt(doc, x, y, tol) {
    for (let i = doc.markups.length - 1; i >= 0; i--) {
      if (hitBody(doc.markups[i], x, y, tol)) return i;
    }
    return -1;
  }

  /* ============================================================
     POINTER — draw, move, resize, select
     ============================================================ */

  canvas.addEventListener('pointerdown', e => {
    const doc = activeDoc();
    if (!doc) return;
    if (e.button !== 0) return;

    // clicking anywhere while editing text commits the edit first
    if (state.editingText) { commitText(); return; }

    const p = toCanvasCoords(e);
    const tol = hitTol();

    // priority 1: handles of currently-selected markup
    if (doc.selectedIdx >= 0) {
      const sel = doc.markups[doc.selectedIdx];
      const h = hitHandle(sel, p.x, p.y, tol * 1.6);
      if (h) {
        state.interaction = {
          type: 'resizing',
          handle: h.name,
          idx: doc.selectedIdx,
          orig: JSON.parse(JSON.stringify(sel)),
          startX: p.x, startY: p.y,
        };
        canvas.setPointerCapture(e.pointerId);
        return;
      }
      // priority 2: body of selected markup → move (in any tool)
      if (hitBody(sel, p.x, p.y, tol)) {
        state.interaction = {
          type: 'moving',
          idx: doc.selectedIdx,
          orig: JSON.parse(JSON.stringify(sel)),
          startX: p.x, startY: p.y,
        };
        canvas.classList.add('is-moving');
        canvas.setPointerCapture(e.pointerId);
        return;
      }
    }

    // priority 3: in select tool, click picks any markup
    if (state.tool === 'select') {
      const idx = topMarkupAt(doc, p.x, p.y, tol);
      doc.selectedIdx = idx;
      redraw();
      if (idx >= 0) {
        // prime for move in case the user drags
        state.interaction = {
          type: 'moving',
          idx,
          orig: JSON.parse(JSON.stringify(doc.markups[idx])),
          startX: p.x, startY: p.y,
        };
        canvas.classList.add('is-moving');
        canvas.setPointerCapture(e.pointerId);
      }
      return;
    }

    // priority 4: drawing tools — deselect first, then start a draft
    doc.selectedIdx = -1;

    if (state.tool === 'text') {
      openTextEditor(p.x, p.y);
      redraw();
      return;
    }

    state.interaction = {
      type: 'drawing',
      draft: {
        type: state.tool,
        x1: p.x, y1: p.y,
        x2: p.x, y2: p.y,
        strokeWidth: state.strokeWidth,
        headLen: state.headLen,
      },
    };
    canvas.setPointerCapture(e.pointerId);
    redraw();
  });

  canvas.addEventListener('pointermove', e => {
    const doc = activeDoc();
    if (!doc) return;

    if (!state.interaction) { updateCursorIdle(e); return; }

    const p = toCanvasCoords(e);
    const it = state.interaction;

    if (it.type === 'drawing') {
      it.draft.x2 = p.x;
      it.draft.y2 = p.y;
      redraw();

    } else if (it.type === 'moving') {
      const m  = doc.markups[it.idx];
      const o  = it.orig;
      const dx = p.x - it.startX;
      const dy = p.y - it.startY;
      if (m.type === 'text') {
        m.x = o.x + dx;
        m.y = o.y + dy;
      } else {
        m.x1 = o.x1 + dx; m.y1 = o.y1 + dy;
        m.x2 = o.x2 + dx; m.y2 = o.y2 + dy;
      }
      redraw();

    } else if (it.type === 'resizing') {
      resizeMarkup(doc.markups[it.idx], it, p);
      redraw();
    }
  });

  canvas.addEventListener('pointerup', e => {
    const doc = activeDoc();
    if (!doc) return;
    if (!state.interaction) return;

    const it = state.interaction;
    canvas.classList.remove('is-moving');
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);

    if (it.type === 'drawing') {
      const d = it.draft;
      const dist = Math.hypot(d.x2 - d.x1, d.y2 - d.y1);
      if (dist >= 6) {
        doc.markups.push(d);
        doc.selectedIdx = doc.markups.length - 1;   // auto-select after draw
      }
    }
    // moving / resizing: already mutated in place; nothing more to do

    state.interaction = null;
    renderFilmstrip();   // has-markups dot state may have changed
    redraw();
    updateCursorIdle(e);
  });

  function resizeMarkup(m, it, p) {
    const o = it.orig;
    if (m.type === 'box') {
      // each corner anchors the opposite corner
      let x1 = o.x1, y1 = o.y1, x2 = o.x2, y2 = o.y2;
      // reinterpret which corner we're dragging based on current orientation
      // we stored handle name from the pre-drag bbox; since box renders via min/max,
      // we translate handle to whichever of (x1/y1, x2/y2) is that corner of the bbox
      const minXisX1 = o.x1 <= o.x2;
      const minYisY1 = o.y1 <= o.y2;
      const setLeft   = v => { if (minXisX1) x1 = v; else x2 = v; };
      const setRight  = v => { if (minXisX1) x2 = v; else x1 = v; };
      const setTop    = v => { if (minYisY1) y1 = v; else y2 = v; };
      const setBottom = v => { if (minYisY1) y2 = v; else y1 = v; };
      switch (it.handle) {
        case 'nw': setLeft(p.x);  setTop(p.y);    break;
        case 'ne': setRight(p.x); setTop(p.y);    break;
        case 'se': setRight(p.x); setBottom(p.y); break;
        case 'sw': setLeft(p.x);  setBottom(p.y); break;
      }
      m.x1 = x1; m.y1 = y1; m.x2 = x2; m.y2 = y2;

    } else if (m.type === 'arrow') {
      if (it.handle === 'start') { m.x1 = p.x; m.y1 = p.y; }
      else                       { m.x2 = p.x; m.y2 = p.y; }

    } else if (m.type === 'text') {
      // drag the se handle: text height = distance from its top (m.y) to mouse y
      const newSize = Math.max(8, p.y - m.y);
      m.fontSize = newSize;
    }
  }

  /* ============================================================
     CURSOR FEEDBACK
     ============================================================ */

  function updateCursorIdle(e) {
    const doc = activeDoc();
    if (!doc) { canvas.style.cursor = ''; return; }

    if (!e) {
      canvas.style.cursor = '';
      return;
    }
    const p = toCanvasCoords(e);
    const tol = hitTol();

    if (doc.selectedIdx >= 0) {
      const sel = doc.markups[doc.selectedIdx];
      const h = hitHandle(sel, p.x, p.y, tol * 1.6);
      if (h) { canvas.style.cursor = handleCursor(h.name); return; }
      if (hitBody(sel, p.x, p.y, tol)) { canvas.style.cursor = 'move'; return; }
    }

    if (state.tool === 'select') {
      const i = topMarkupAt(doc, p.x, p.y, tol);
      canvas.style.cursor = i >= 0 ? 'pointer' : 'default';
      return;
    }

    canvas.style.cursor = state.tool === 'text' ? 'text' : 'crosshair';
  }

  function handleCursor(name) {
    switch (name) {
      case 'nw': case 'se': return 'nwse-resize';
      case 'ne': case 'sw': return 'nesw-resize';
      case 'start': case 'end': return 'crosshair';
      default: return 'default';
    }
  }

  canvas.addEventListener('pointerleave', () => {
    if (!state.interaction) canvas.style.cursor = '';
  });

  /* ============================================================
     TEXT TOOL — contenteditable overlay, commits as markup
     ============================================================ */

  function openTextEditor(x, y) {
    state.editingText = { x, y };

    const scale = displayScale();
    textInput.textContent = '';
    textInput.style.left       = (x * scale) + 'px';
    textInput.style.top        = (y * scale) + 'px';
    textInput.style.fontSize   = (state.fontSize * scale) + 'px';
    textInput.classList.add('active');

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
      const doc = activeDoc();
      if (doc) {
        doc.markups.push({ type: 'text', x, y, text: value, fontSize: state.fontSize });
        doc.selectedIdx = doc.markups.length - 1;
      }
    }
    renderFilmstrip();
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
    e.stopPropagation();
  });
  textInput.addEventListener('blur', () => { if (state.editingText) commitText(); });

  /* ============================================================
     ACTIONS
     ============================================================ */

  function undo() {
    if (state.editingText) { cancelText(); return; }
    const doc = activeDoc();
    if (!doc || doc.markups.length === 0) return;
    doc.markups.pop();
    doc.selectedIdx = -1;
    renderFilmstrip();
    redraw();
  }

  function clearMarkups() {
    const doc = activeDoc();
    if (!doc || doc.markups.length === 0) return;
    doc.markups = [];
    doc.selectedIdx = -1;
    renderFilmstrip();
    redraw();
  }

  function deleteSelected() {
    const doc = activeDoc();
    if (!doc || doc.selectedIdx < 0) return;
    doc.markups.splice(doc.selectedIdx, 1);
    doc.selectedIdx = -1;
    renderFilmstrip();
    redraw();
  }

  function newSession() {
    state.docs = [];
    state.activeId = null;
    state.interaction = null;
    cancelText();
    canvasWrap.hidden = true;
    dropzone.hidden   = false;
    filmstrip.hidden  = true;
    renderFilmstrip();
    setStatus('Ready');
  }

  function exportPNG() {
    const doc = activeDoc();
    if (!doc) return;
    if (state.editingText) commitText();
    // hide selection chrome during export
    const prevSel = doc.selectedIdx;
    doc.selectedIdx = -1;
    redraw();

    canvas.toBlob(blob => {
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      const idx  = state.docs.findIndex(d => d.id === doc.id) + 1;
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      a.href = url;
      a.download = `guidemaker-${String(idx).padStart(2, '0')}-${stamp}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus(`Exported image ${idx}`);
      // restore selection
      doc.selectedIdx = prevSel;
      redraw();
    }, 'image/png');
  }

  document.getElementById('undoBtn').addEventListener('click', undo);
  document.getElementById('clearBtn').addEventListener('click', clearMarkups);
  document.getElementById('newBtn').addEventListener('click', newSession);
  document.getElementById('exportBtn').addEventListener('click', exportPNG);

  /* ============================================================
     KEYBOARD
     ============================================================ */

  window.addEventListener('keydown', e => {
    if (state.editingText) return;  // don't steal keys from the text overlay
    const mod = e.metaKey || e.ctrlKey;

    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
    if (mod && (e.key.toLowerCase() === 'e' || e.key.toLowerCase() === 's')) {
      e.preventDefault(); exportPNG(); return;
    }
    if (mod) return;

    if (e.key === 'Delete' || e.key === 'Backspace') {
      const doc = activeDoc();
      if (doc && doc.selectedIdx >= 0) {
        e.preventDefault();
        deleteSelected();
        return;
      }
    }
    if (e.key === 'Escape') {
      const doc = activeDoc();
      if (doc && doc.selectedIdx >= 0) {
        doc.selectedIdx = -1;
        redraw();
      }
      return;
    }
    if (e.key === 'Tab') {
      // quick cycle through images
      if (state.docs.length > 1) {
        e.preventDefault();
        const i = state.docs.findIndex(d => d.id === state.activeId);
        const next = (i + (e.shiftKey ? -1 : 1) + state.docs.length) % state.docs.length;
        switchToDoc(state.docs[next].id);
      }
      return;
    }

    switch (e.key.toLowerCase()) {
      case 'v': setTool('select'); break;
      case 'b': setTool('box');    break;
      case 'a': setTool('arrow');  break;
      case 't': setTool('text');   break;
    }
  });

  /* ============================================================
     MISC
     ============================================================ */

  window.addEventListener('resize', () => {
    if (state.editingText) {
      const { x, y } = state.editingText;
      const scale = displayScale();
      textInput.style.left     = (x * scale) + 'px';
      textInput.style.top      = (y * scale) + 'px';
      textInput.style.fontSize = (state.fontSize * scale) + 'px';
    }
    redraw();
  });

})();
