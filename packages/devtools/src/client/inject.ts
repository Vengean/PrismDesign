interface InjectOptions {
  agentPort: number;
  toggleKey: string;
}

export function getClientCode(options: InjectOptions): string {
  return `
(function() {
  const AGENT_PORT = ${options.agentPort};
  const TOGGLE_KEY = "${options.toggleKey}";
  const AGENT_URL = "http://" + location.hostname + ":" + AGENT_PORT;

  // ============================================================
  // State persistence (survives HMR/reload)
  // ============================================================
  const PD_STATE_KEY = "pd-devtools-state";

  function saveState() {
    try {
      sessionStorage.setItem(PD_STATE_KEY, JSON.stringify({
        panelVisible: panelVisible,
        selectMode: selectMode,
        chatOpen: chatOpen,
        chatMessages: chatMessages,
      }));
    } catch {}
  }

  function loadState() {
    try {
      const raw = sessionStorage.getItem(PD_STATE_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return null;
  }

  const savedState = loadState();

  // ============================================================
  // State
  // ============================================================
  let panelVisible = false;       // overall design mode
  let selectMode = false;         // element selection active
  let dragMode = false;           // drag reorder mode
  let navigatorOpen = false;      // navigator panel visible
  let chatOpen = false;           // chat panel visible
  let selectedElement = null;
  let connected = false;
  let aiWorking = false;          // lock UI when AI is processing
  let ws = null;
  let chatMessages = savedState?.chatMessages || [];
  let dragMoves = [];

  // Change management
  let pendingChanges = new Map();
  let originalStyles = new Map();
  let originalTexts = new Map();
  let undoStack = [];  // array of Map snapshots
  let redoStack = [];

  // UI refs
  let rootEl = null;
  let styleEl = null;
  let hoverOverlay, selectOverlay, labelOverlay;
  let popover = null;

  // ============================================================
  // Client ID (persisted per browser tab)
  // ============================================================
  const CLIENT_ID = "pd-" + Math.random().toString(36).slice(2, 10) + "-" + Date.now().toString(36);

  // ============================================================
  // Agent Client
  // ============================================================
  const agentHeaders = { "Content-Type": "application/json", "X-Client-ID": CLIENT_ID };

  const agent = {
    async getStatus() {
      const res = await fetch(AGENT_URL + "/api/status");
      return res.json();
    },
    async applyChanges(changes, supplement) {
      const res = await fetch(AGENT_URL + "/api/apply-changes", {
        method: "POST",
        headers: agentHeaders,
        body: JSON.stringify({
          changes,
          pagePath: location.pathname,
          supplement,
        }),
      });
      return res.json();
    },
    async chat(message, context) {
      const res = await fetch(AGENT_URL + "/api/chat", {
        method: "POST",
        headers: agentHeaders,
        body: JSON.stringify({ message, context }),
      });
      return res.json();
    },
    async rollback() {
      const res = await fetch(AGENT_URL + "/api/rollback", { method: "POST" });
      return res.json();
    },
    connectWs(onMessage) {
      const wsUrl = AGENT_URL.replace(/^http/, "ws") + "/ws";
      ws = new WebSocket(wsUrl);
      ws.onmessage = (e) => {
        try { const { type, data } = JSON.parse(e.data); onMessage(type, data); } catch {}
      };
      ws.onclose = () => { ws = null; };
      return ws;
    }
  };

  // ============================================================
  // Inspector
  // ============================================================
  function getReactComponentInfo(el) {
    const fiberKey = Object.keys(el).find(k => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"));
    if (!fiberKey) return null;
    let fiber = el[fiberKey];
    while (fiber) {
      if (typeof fiber.type === "function") {
        const source = fiber._debugSource;
        if (!source?.fileName?.includes("node_modules")) {
          return { name: fiber.type.displayName || fiber.type.name || "Anonymous", props: sanitizeProps(fiber.memoizedProps), sourceFile: source?.fileName, sourceLine: source?.lineNumber };
        }
      }
      fiber = fiber.return;
    }
    return null;
  }

  function getVueComponentInfo(el) {
    const vue3 = el.__vueParentComponent;
    if (vue3) return { name: vue3.type.__name || vue3.type.name || "Anonymous", props: sanitizeProps(vue3.props), sourceFile: vue3.type.__file };
    const vue2 = el.__vue__;
    if (vue2) return { name: vue2.$options.name || "Anonymous", props: sanitizeProps(vue2.$props), sourceFile: vue2.$options.__file };
    return null;
  }

  function sanitizeProps(props) {
    if (!props) return {};
    const clean = {};
    for (const [key, value] of Object.entries(props)) {
      if (key === "children") continue;
      const t = typeof value;
      if (t === "string" || t === "number" || t === "boolean" || value === null) clean[key] = value;
    }
    return clean;
  }

  function getComponentInfo(el) { return getReactComponentInfo(el) || getVueComponentInfo(el); }

  // Get full component chain: App > ProductCard > Button
  function getComponentChain(el) {
    const chain = [];
    let node = el;
    while (node && node !== document.body) {
      const comp = getComponentInfo(node);
      if (comp && (chain.length === 0 || chain[chain.length - 1].name !== comp.name)) {
        chain.push(comp);
      }
      node = node.parentElement;
    }
    chain.reverse();
    return chain;
  }

  function getComponentLabel(el) {
    const chain = getComponentChain(el);
    if (chain.length === 0) {
      // Fallback: use tag + class
      const tag = el.tagName.toLowerCase();
      const cls = (el.className && typeof el.className === "string") ? "." + el.className.trim().split(/\\s+/).filter(function(c) { return !c.startsWith("css-") && !c.startsWith("pd-"); }).slice(0, 2).join(".") : "";
      return { label: tag + cls, source: "" };
    }
    const names = chain.map(function(c) { return c.name; }).join(" > ");
    const last = chain[chain.length - 1];
    const source = last.sourceFile ? last.sourceFile.split("/").slice(-2).join("/") + (last.sourceLine ? ":" + last.sourceLine : "") : "";
    return { label: names, source: source };
  }

  function getDomPath(el) {
    const parts = [];
    while (el && el !== document.body) {
      let sel = el.tagName.toLowerCase();
      if (el.id && !el.id.startsWith("pd-")) sel += "#" + el.id;
      else if (el.className && typeof el.className === "string") {
        const cls = el.className.trim().split(/\\s+/).filter(c => !c.startsWith("pd-")).slice(0, 2).join(".");
        if (cls) sel += "." + cls;
      }
      parts.unshift(sel);
      el = el.parentElement;
    }
    return parts.join(" > ");
  }

  function isOurElement(el) {
    let node = el;
    while (node) { if (node.id && node.id.startsWith("pd-")) return true; node = node.parentElement; }
    return false;
  }

  const SKIP_TAGS = new Set(["script", "style", "link", "meta", "noscript"]);
  function shouldSkip(el) {
    return isOurElement(el) || SKIP_TAGS.has(el.tagName.toLowerCase());
  }

  function rgbToHex(rgb) {
    const match = (rgb || "").match(/\\d+/g);
    if (!match || match.length < 3) return "#000000";
    return "#" + match.slice(0, 3).map(n => parseInt(n).toString(16).padStart(2, "0")).join("");
  }

  // ============================================================
  // Overlays
  // ============================================================
  function createOverlays() {
    hoverOverlay = document.createElement("div"); hoverOverlay.id = "pd-hover-overlay"; document.body.appendChild(hoverOverlay);
    selectOverlay = document.createElement("div"); selectOverlay.id = "pd-select-overlay"; document.body.appendChild(selectOverlay);
    labelOverlay = document.createElement("div"); labelOverlay.id = "pd-label"; document.body.appendChild(labelOverlay);
  }
  function showHover(el) {
    if (!hoverOverlay) return;
    const rect = el.getBoundingClientRect();
    Object.assign(hoverOverlay.style, { display: "block", top: (rect.top + window.scrollY) + "px", left: (rect.left + window.scrollX) + "px", width: rect.width + "px", height: rect.height + "px" });
    const comp = getComponentInfo(el);
    labelOverlay.textContent = comp ? comp.name : el.tagName.toLowerCase();
    Object.assign(labelOverlay.style, { display: "block", top: (rect.top + window.scrollY - 22) + "px", left: (rect.left + window.scrollX) + "px" });
  }
  function hideHover() { if (hoverOverlay) hoverOverlay.style.display = "none"; if (labelOverlay) labelOverlay.style.display = "none"; }
  function showSelect(el) {
    if (!selectOverlay) return;
    const rect = el.getBoundingClientRect();
    Object.assign(selectOverlay.style, { display: "block", top: (rect.top + window.scrollY) + "px", left: (rect.left + window.scrollX) + "px", width: rect.width + "px", height: rect.height + "px" });
  }
  function hideSelect() { if (selectOverlay) selectOverlay.style.display = "none"; }
  function destroyOverlays() { [hoverOverlay, selectOverlay, labelOverlay].forEach(el => el?.remove()); hoverOverlay = selectOverlay = labelOverlay = null; }

  // ============================================================
  // Popover (element editor)
  // ============================================================
  function showPopover(el) {
    hidePopover();
    if (aiWorking) return;
    const comp = getComponentInfo(el);
    const computed = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    popover = document.createElement("div");
    popover.id = "pd-popover";
    const title = comp ? comp.name : el.tagName.toLowerCase();
    const source = comp?.sourceFile ? comp.sourceFile.split("/").slice(-2).join("/") + (comp.sourceLine ? ":" + comp.sourceLine : "") : "";
    // Determine which property groups to show based on element type
    const tag = el.tagName.toLowerCase();
    const display = computed.display;
    const isText = ["span","p","h1","h2","h3","h4","h5","h6","a","label","strong","em","b","i"].includes(tag) || el.children.length === 0;
    const isFlex = display === "flex" || display === "inline-flex";
    const isImg = tag === "img" || tag === "svg";

    const groups = [];

    // Text properties — show for text-like elements
    if (isText || !isImg) {
      groups.push({ title: "\u6587\u5B57", fields: [
        { key: "color", label: "\u989C\u8272", type: "color" },
        { key: "fontSize", label: "\u5B57\u53F7", type: "range", min: 10, max: 72, unit: "px" },
        { key: "fontWeight", label: "\u5B57\u91CD", type: "select", opts: [{v:"300",l:"\u7EC6"},{v:"400",l:"\u5E38\u89C4"},{v:"500",l:"\u4E2D"},{v:"600",l:"\u534A\u7C97"},{v:"700",l:"\u7C97"},{v:"800",l:"\u7279\u7C97"}] },
      ]});
    }

    // Background & appearance — always show
    groups.push({ title: "\u5916\u89C2", fields: [
      { key: "backgroundColor", label: "\u80CC\u666F\u8272", type: "color" },
      { key: "borderRadius", label: "\u5706\u89D2", type: "range", min: 0, max: 50, unit: "px" },
      { key: "opacity", label: "\u900F\u660E\u5EA6", type: "range", min: 0, max: 1, step: 0.05, unit: "" },
    ]});

    // Spacing — always show
    groups.push({ title: "\u95F4\u8DDD", fields: [
      { key: "padding", label: "\u5185\u8FB9\u8DDD", type: "range", min: 0, max: 80, unit: "px" },
      { key: "margin", label: "\u5916\u8FB9\u8DDD", type: "range", min: 0, max: 80, unit: "px" },
    ]});

    // Flex gap — only for flex containers
    if (isFlex) {
      groups.push({ title: "\u5E03\u5C40", fields: [
        { key: "gap", label: "\u95F4\u8DDD", type: "range", min: 0, max: 60, unit: "px" },
      ]});
    }

    let fieldsHtml = "";
    for (const g of groups) {
      fieldsHtml += '<div class="pd-pop-group"><div class="pd-pop-group-title">' + g.title + '</div>';
      for (const f of g.fields) {
        const val = computed.getPropertyValue(f.key.replace(/([A-Z])/g, "-$1").toLowerCase());
        fieldsHtml += '<div class="pd-pop-row"><span class="pd-pop-label">' + f.label + '</span>';
        if (f.type === "color") {
          fieldsHtml += '<input type="color" data-pd-prop="' + f.key + '" value="' + rgbToHex(val) + '" /><span class="pd-pop-hex">' + rgbToHex(val) + '</span>';
        } else if (f.type === "range") {
          const n = parseFloat(val) || 0;
          fieldsHtml += '<input type="range" data-pd-prop="' + f.key + '" min="' + f.min + '" max="' + f.max + '" step="' + (f.step||1) + '" value="' + n + '" /><span class="pd-pop-val" data-pd-val="' + f.key + '">' + (Math.round(n*100)/100) + (f.unit||"") + '</span>';
        } else if (f.type === "select") {
          fieldsHtml += '<select data-pd-prop="' + f.key + '">';
          for (const o of f.opts) {
            const sel = String(Math.round(parseFloat(val)/100)*100) === o.v ? " selected" : "";
            fieldsHtml += '<option value="' + o.v + '"' + sel + '>' + o.l + ' (' + o.v + ')</option>';
          }
          fieldsHtml += '</select>';
        }
        fieldsHtml += '</div>';
      }
      fieldsHtml += '</div>';
    }
    // Text content section
    const textContent = (el.textContent || "").trim();
    let textHtml = "";
    if (textContent) {
      textHtml = '<div class="pd-pop-group"><div class="pd-pop-group-title">\u6587\u672C\u5185\u5BB9</div><div style="padding:4px 14px 8px"><textarea class="pd-pop-textarea" id="pd-pop-text-input">' + escapeHtml(textContent) + '</textarea></div></div>';
    }

    popover.className = "pd-panel";
    popover.innerHTML = '<div class="pd-panel-header"><span class="pd-pop-title">' + title + '</span>' + (source ? '<span class="pd-pop-src">' + source + '</span>' : '') + '<span class="pd-panel-header-spacer"></span><div class="pd-panel-btns"><button class="pd-wbtn pd-wbtn-expand" id="pd-pop-toggle" title="\u5C55\u5F00/\u6536\u8D77"><svg class="pd-icon-collapse" viewBox="0 0 10 10"><polygon points="1,1 5,1 1,5" fill="#006500"/><polygon points="9,9 5,9 9,5" fill="#006500"/></svg><svg class="pd-icon-expand" viewBox="0 0 10 10"><polygon points="5,5 9,5 5,1" fill="#006500"/><polygon points="5,5 1,5 5,9" fill="#006500"/></svg></button><button class="pd-wbtn pd-wbtn-close" id="pd-pop-close" title="\u5173\u95ED"><svg viewBox="0 0 10 10" fill="none"><path d="M2.5 2.5l5 5M7.5 2.5l-5 5"/></svg></button></div></div><div class="pd-panel-body pd-pop-body">' + fieldsHtml + textHtml + '</div>';
    document.body.appendChild(popover);
    // Fixed top-right position
    popover.style.display = "flex";
    popover.style.position = "fixed";
    popover.style.right = "16px";
    popover.style.top = "16px";
    popover.style.left = "auto";
    // Bind
    popover.querySelector("#pd-pop-toggle").addEventListener("click", () => { popover.classList.toggle("pd-minimized"); });
    popover.querySelector("#pd-pop-close").addEventListener("click", () => { hidePopover(); hideCommentBox(); hideSelect(); selectedElement = null; });
    popover.querySelectorAll("[data-pd-prop]").forEach(input => {
      const prop = input.dataset.pdProp;
      const unitMap = { fontSize:"px", padding:"px", margin:"px", borderRadius:"px", gap:"px", letterSpacing:"px" };
      input.addEventListener("input", () => {
        applyStyleChange(el, prop, input.value);
        const vs = popover?.querySelector('[data-pd-val="'+prop+'"]');
        if (vs) vs.textContent = (Math.round(parseFloat(input.value)*100)/100) + (unitMap[prop]||"");
      });
    });
    // Text editing via textarea
    const textInput = popover.querySelector("#pd-pop-text-input");
    if (textInput) {
      if (!originalTexts.has(el)) originalTexts.set(el, el.textContent || "");
      let textDebounce = null;
      textInput.addEventListener("input", () => {
        const newText = textInput.value;
        el.textContent = newText;
        if (textDebounce) clearTimeout(textDebounce);
        textDebounce = setTimeout(() => {
          pushUndo();
          const oldText = originalTexts.get(el) || "";
          if (oldText !== newText) {
            pendingChanges.set(getDomPath(el)+"::textContent", { selector: getDomPath(el), property: "textContent", oldValue: oldText, newValue: newText, element: el });
            updateSaveBadge();
          }
        }, 300);
      });
    }
    makeDraggable(popover, popover.querySelector(".pd-panel-header"));
  }
  function hidePopover() { if (popover) { popover.remove(); popover = null; } }

  // ============================================================
  // Comment box (near selected element)
  // ============================================================
  let commentBox = null;

  function showCommentBox(el) {
    hideCommentBox();
    if (aiWorking) return;
    commentBox = document.createElement("div");
    commentBox.id = "pd-comment-box";

    commentBox.innerHTML =
      '<textarea class="pd-comment-input" placeholder="\u6DFB\u52A0\u8BC4\u8BBA\u2026" rows="2"></textarea>' +
      '<div class="pd-comment-actions">' +
        '<button class="pd-comment-btn" id="pd-comment-cancel">\u53D6\u6D88</button>' +
        '<button class="pd-comment-btn pd-comment-btn-ok" id="pd-comment-ok">\u786E\u5B9A</button>' +
      '</div>';

    document.body.appendChild(commentBox);

    // Position near the element (fixed, so use viewport coords)
    const rect = el.getBoundingClientRect();
    let left = rect.left;
    let top = rect.bottom + 8;
    if (left + 260 > window.innerWidth) left = window.innerWidth - 270;
    if (left < 8) left = 8;
    if (top + 100 > window.innerHeight) top = rect.top - 108;
    commentBox.style.left = left + "px";
    commentBox.style.top = top + "px";

    const input = commentBox.querySelector(".pd-comment-input");
    input.focus();

    commentBox.querySelector("#pd-comment-cancel").addEventListener("click", hideCommentBox);
    commentBox.querySelector("#pd-comment-ok").addEventListener("click", function() {
      const text = input.value.trim();
      if (text) {
        pushUndo();
        const info = getComponentLabel(el);
        const domPath = getDomPath(el);
        pendingChanges.set(domPath + "::comment::" + Date.now(), {
          selector: domPath,
          property: "comment",
          oldValue: "",
          newValue: text,
          element: el,
        });
        updateSaveBadge();
      }
      hideCommentBox();
    });

    // Enter to submit
    input.addEventListener("keydown", function(e) {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        commentBox.querySelector("#pd-comment-ok").click();
      }
    });
  }

  function hideCommentBox() {
    if (commentBox) { commentBox.remove(); commentBox = null; }
  }

  function makeDraggable(el, handle) {
    let sx, sy, ox, oy;
    handle.style.cursor = "grab";
    handle.addEventListener("mousedown", (e) => {
      // Don't drag when clicking window buttons
      if (e.target.closest(".pd-wbtn")) return;
      e.preventDefault();
      // Convert bottom-based sizing to explicit height before dragging
      if (el.style.bottom && !el.style.height) {
        const rect = el.getBoundingClientRect();
        el.style.height = rect.height + "px";
        el.style.bottom = "auto";
      }
      sx = e.clientX; sy = e.clientY;
      ox = el.offsetLeft; oy = el.offsetTop;
      handle.style.cursor = "grabbing";
      const onM = (ev) => {
        el.style.left = (ox + ev.clientX - sx) + "px";
        el.style.top = (oy + ev.clientY - sy) + "px";
      };
      const onU = () => {
        handle.style.cursor = "grab";
        document.removeEventListener("mousemove", onM);
        document.removeEventListener("mouseup", onU);
      };
      document.addEventListener("mousemove", onM);
      document.addEventListener("mouseup", onU);
    });
  }

  function makeResizable(el) {
    const EDGE = 10;
    let resizing = false, edge = "", sx, sy, origRect;

    function getEdge(e) {
      const r = el.getBoundingClientRect();
      const x = e.clientX, y = e.clientY;
      let edges = "";
      if (y < r.top + EDGE) edges += "n";
      if (y > r.bottom - EDGE) edges += "s";
      if (x < r.left + EDGE) edges += "w";
      if (x > r.right - EDGE) edges += "e";
      return edges;
    }

    function getCursor(e) {
      const map = { n:"ns-resize", s:"ns-resize", e:"ew-resize", w:"ew-resize", nw:"nwse-resize", ne:"nesw-resize", sw:"nesw-resize", se:"nwse-resize" };
      return map[e] || "";
    }

    el.addEventListener("mousemove", (e) => {
      if (resizing) return;
      const ed = getEdge(e);
      el.style.cursor = getCursor(ed) || "";
    });

    el.addEventListener("mousedown", (e) => {
      const ed = getEdge(e);
      if (!ed) return;
      e.preventDefault(); e.stopPropagation();
      resizing = true; edge = ed;
      sx = e.clientX; sy = e.clientY;
      origRect = el.getBoundingClientRect();
      // Convert to explicit position/size
      el.style.left = origRect.left + "px";
      el.style.top = origRect.top + "px";
      el.style.width = origRect.width + "px";
      el.style.height = origRect.height + "px";
      el.style.bottom = "auto";
      el.style.right = "auto";

      const onM = (ev) => {
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (edge.includes("e")) el.style.width = Math.max(200, origRect.width + dx) + "px";
        if (edge.includes("w")) { el.style.width = Math.max(200, origRect.width - dx) + "px"; el.style.left = (origRect.left + dx) + "px"; }
        if (edge.includes("s")) el.style.height = Math.max(120, origRect.height + dy) + "px";
        if (edge.includes("n")) { el.style.height = Math.max(120, origRect.height - dy) + "px"; el.style.top = (origRect.top + dy) + "px"; }
      };
      const onU = () => {
        resizing = false;
        document.removeEventListener("mousemove", onM);
        document.removeEventListener("mouseup", onU);
      };
      document.addEventListener("mousemove", onM);
      document.addEventListener("mouseup", onU);
    });
  }

  // ============================================================
  // Style changes (cached, not sent to AI yet)
  // ============================================================
  let lastUndoPushTime = 0;
  function applyStyleChange(el, prop, rawValue) {
    // Debounce undo: only push if >500ms since last push
    const now = Date.now();
    if (now - lastUndoPushTime > 500) { pushUndo(); lastUndoPushTime = now; }
    const unitProps = { fontSize:"px", padding:"px", margin:"px", borderRadius:"px", gap:"px", letterSpacing:"px" };
    let value = rawValue;
    if (unitProps[prop]) value = parseFloat(rawValue) + unitProps[prop];
    if (!originalStyles.has(el)) {
      const c = window.getComputedStyle(el); const snap = {};
      ["color","backgroundColor","fontSize","fontWeight","lineHeight","letterSpacing","padding","margin","borderRadius","gap","opacity"].forEach(k => snap[k] = c.getPropertyValue(k.replace(/([A-Z])/g,"-$1").toLowerCase()));
      originalStyles.set(el, snap);
    }
    el.style[prop] = value;
    const cssProp = prop.replace(/([A-Z])/g,"-$1").toLowerCase();
    const domPath = getDomPath(el);
    const original = originalStyles.get(el);
    pendingChanges.set(domPath+"::"+cssProp, { selector: domPath, property: cssProp, oldValue: original ? original[prop]||"" : "", newValue: value, element: el, jsProp: prop });
    updateSaveBadge();
  }

  // ============================================================
  // Undo / Redo
  // ============================================================
  function pushUndo() {
    undoStack.push(new Map(pendingChanges));
    redoStack = [];
    updateUndoRedoState();
  }

  function doUndo() {
    if (undoStack.length === 0 || aiWorking) return;
    redoStack.push(new Map(pendingChanges));
    const prev = undoStack.pop();
    pendingChanges = prev;
    reapplyAllChanges();
    updateSaveBadge();
    updateUndoRedoState();
  }

  function doRedo() {
    if (redoStack.length === 0 || aiWorking) return;
    undoStack.push(new Map(pendingChanges));
    const next = redoStack.pop();
    pendingChanges = next;
    reapplyAllChanges();
    updateSaveBadge();
    updateUndoRedoState();
  }

  function reapplyAllChanges() {
    // Reset all modified elements to original styles
    originalStyles.forEach((styles, el) => {
      for (const k of Object.keys(styles)) el.style[k] = "";
    });
    // Reset all modified texts
    originalTexts.forEach((text, el) => { el.textContent = text; });
    // Reapply only the changes in current pendingChanges
    for (const [, change] of pendingChanges) {
      const el = change.element;
      if (!el) continue;
      if (change.property === "textContent") {
        el.textContent = change.newValue;
      } else {
        const jsProp = change.jsProp || change.property.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        el.style[jsProp] = change.newValue;
      }
    }
  }

  function updateUndoRedoState() {
    const undoBtn = rootEl?.querySelector("#pd-btn-undo");
    const redoBtn = rootEl?.querySelector("#pd-btn-redo");
    if (undoBtn) undoBtn.classList.toggle("pd-disabled", undoStack.length === 0);
    if (redoBtn) redoBtn.classList.toggle("pd-disabled", redoStack.length === 0);
  }

  function updateSaveBadge() {
    const badge = rootEl?.querySelector("#pd-save-badge");
    const btn = rootEl?.querySelector("#pd-btn-save");
    const n = pendingChanges.size;
    if (badge) {
      badge.textContent = n > 0 ? n : "";
      badge.style.display = n > 0 ? "inline-flex" : "none";
    }
    if (btn) btn.classList.toggle("pd-disabled", n === 0);
  }

  // ============================================================
  // Navigator panel (DOM tree)
  // ============================================================
  function buildDomTree(root, depth, maxDepth) {
    if (depth > maxDepth) return "";
    const children = Array.from(root.children).filter(c => !shouldSkip(c));
    let html = "";
    for (const child of children) {
      const comp = getComponentInfo(child);
      const tag = child.tagName.toLowerCase();
      const label = comp ? comp.name : tag;
      const cls = (child.className && typeof child.className === "string") ? child.className.trim().split(/\\s+/).filter(c => !c.startsWith("pd-")).slice(0,1).join("") : "";
      const hasKids = Array.from(child.children).filter(c => !shouldSkip(c)).length > 0;
      const uid = "pd-n-" + Math.random().toString(36).slice(2,8);
      const expanded = depth < 3;
      html += '<div class="pd-nav-node" style="padding-left:'+(depth*14+8)+'px" data-pd-uid="'+uid+'">';
      if (hasKids) html += '<span class="pd-nav-arrow" data-pd-toggle="'+uid+'">'+(expanded?"\\u25BC":"\\u25B6")+'</span>';
      else html += '<span class="pd-nav-dot">\\u00B7</span>';
      if (comp) html += '<span class="pd-nav-tag pd-nav-comp">'+label+'</span>';
      else html += '<span class="pd-nav-tag">'+tag+'</span>';
      if (cls) html += '<span class="pd-nav-cls">.'+cls+'</span>';
      html += '</div>';
      if (hasKids) html += '<div class="pd-nav-kids'+(expanded?" pd-expanded":"")+'" data-pd-parent="'+uid+'">' + buildDomTree(child, depth+1, maxDepth) + '</div>';
    }
    return html;
  }

  function getAllElements() {
    const els = [];
    function walk(el, d, max) { if (d > max) return; const kids = Array.from(el.children).filter(c => !shouldSkip(c)); for (const c of kids) { els.push(c); walk(c, d+1, max); } }
    walk(document.body, 0, 20);
    return els;
  }

  function toggleNavigator() {
    navigatorOpen = !navigatorOpen;
    const panel = rootEl?.querySelector("#pd-navigator");
    if (!panel) return;
    if (navigatorOpen) {
      panel.style.display = "flex";
      panel.querySelector(".pd-nav-body").innerHTML = buildDomTree(document.body, 0, 20);
    } else {
      panel.style.display = "none";
    }
    rootEl.querySelector("#pd-btn-select").classList.toggle("pd-tb-active", navigatorOpen || selectMode);
  }

  // ============================================================
  // Chat panel
  // ============================================================
  function toggleChat() {
    chatOpen = !chatOpen;
    if (chatOpen) {
      // Close select mode and its windows
      if (selectMode) exitSelectMode();
      if (dragMode) exitDragMode();
    }
    const panel = rootEl?.querySelector("#pd-chat-panel");
    if (!panel) return;
    panel.style.display = chatOpen ? "flex" : "none";
    rootEl.querySelector("#pd-btn-chat").classList.toggle("pd-tb-active", chatOpen);
    if (chatOpen) renderChatMessages();
    saveState();
  }

  function renderChatMessages() {
    const container = rootEl?.querySelector("#pd-chat-messages");
    if (!container) return;
    let html = "";
    if (chatMessages.length === 0) {
      html = '<div class="pd-chat-empty"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="1.5"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg><span>\u63CF\u8FF0\u4F60\u60F3\u8981\u7684\u4FEE\u6539\uFF0CAI \u4F1A\u76F4\u63A5\u4FEE\u6539\u6E90\u4EE3\u7801\u3002</span></div>';
    } else {
      for (const msg of chatMessages) {
        const isUser = msg.role === "user";
        html += '<div class="pd-chat-msg '+(isUser?"pd-msg-user":"pd-msg-ai")+'">';
        if (!isUser) html += '<div class="pd-msg-avatar">AI</div>';
        const rendered = isUser ? escapeHtml(msg.content) : renderMarkdown(msg.content);
        html += '<div class="pd-msg-bubble">'+rendered+'</div></div>';
      }
    }
    container.innerHTML = html;
    container.scrollTop = container.scrollHeight;
    saveState();
  }

  async function ensureConnected() {
    if (connected) return true;
    try {
      await agent.getStatus(); connected = true; updateConnectionDot();
      agent.connectWs((type) => {
        if (type === "agent:start") setAIWorking(true);
        else if (type === "agent:done") { setAIWorking(false); pendingChanges.clear(); originalStyles = new Map(); originalTexts = new Map(); undoStack = []; redoStack = []; updateSaveBadge(); updateUndoRedoState(); }
        else if (type === "agent:error") setAIWorking(false);
      });
      return true;
    } catch { return false; }
  }

  async function sendChatMessage(text) {
    if (!text.trim() || aiWorking) return;
    if (!await ensureConnected()) { chatMessages.push({ role: "ai", content: "Agent \u672A\u8FDE\u63A5\uFF0C\u8BF7\u786E\u4FDD\u670D\u52A1\u5DF2\u542F\u52A8\u3002" }); renderChatMessages(); return; }
    chatMessages.push({ role: "user", content: text });
    chatMessages.push({ role: "ai", content: "\u601D\u8003\u4E2D..." });
    renderChatMessages();
    setAIWorking(true);
    const context = { pagePath: location.pathname, components: selectedElement ? [getComponentInfo(selectedElement)].filter(Boolean) : [] };
    try {
      const result = await agent.chat(text, context);
      chatMessages[chatMessages.length-1] = { role: "ai", content: result.success ? (result.message || "\u5DF2\u5B8C\u6210\u3002") : "Error: "+(result.message||"Failed") };
    } catch { chatMessages[chatMessages.length-1] = { role: "ai", content: "\u8BF7\u6C42\u5931\u8D25\u3002" }; }
    setAIWorking(false);
    renderChatMessages();
  }

  function escapeHtml(s) { return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

  function renderMarkdown(text) {
    let html = escapeHtml(text);
    // Fenced code blocks
    html = html.replace(/\u0060\u0060\u0060([\\s\\S]*?)\u0060\u0060\u0060/g, '<pre class="pd-md-pre"><code>$1</code></pre>');
    // Inline code
    html = html.replace(/\u0060([^\u0060]+)\u0060/g, '<code class="pd-md-code">$1</code>');
    // Bold
    html = html.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
    // Italic
    html = html.replace(/\\*(.+?)\\*/g, '<em>$1</em>');
    // Headers
    html = html.replace(/^### (.+)$/gm, '<div class="pd-md-h3">$1</div>');
    html = html.replace(/^## (.+)$/gm, '<div class="pd-md-h2">$1</div>');
    html = html.replace(/^# (.+)$/gm, '<div class="pd-md-h1">$1</div>');
    // Table
    html = html.replace(/^\\|(.+)\\|\\s*$/gm, function(match, content) {
      const cells = content.split('|').map(function(c) { return c.trim(); });
      if (cells.every(function(c) { return /^[-:]+$/.test(c); })) return '';
      return '<tr>' + cells.map(function(c) { return '<td>' + c + '</td>'; }).join('') + '</tr>';
    });
    html = html.replace(/(<tr>[\\s\\S]*?<\\/tr>)/g, '<table class="pd-md-table">$1</table>');
    // Clean up multiple consecutive tables
    html = html.replace(/<\\/table>\\s*<table class="pd-md-table">/g, '');
    // Unordered list
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\\/li>\\n?)+/g, '<ul class="pd-md-ul">$&</ul>');
    // Line breaks (but not inside pre/table)
    html = html.replace(/\\n/g, '<br>');
    // Clean up extra <br> around block elements
    html = html.replace(/<br>\\s*(<pre|<div|<ul|<table)/g, '$1');
    html = html.replace(/(<\\/pre>|<\\/div>|<\\/ul>|<\\/table>)\\s*<br>/g, '$1');
    return html;
  }

  // ============================================================
  // AI working lock
  // ============================================================
  function setAIWorking(working) {
    aiWorking = working;
    const toolbar = rootEl?.querySelector("#pd-toolbar");
    if (toolbar) toolbar.classList.toggle("pd-ai-busy", working);
    // Disable/enable chat input
    const input = rootEl?.querySelector("#pd-chat-input");
    const sendBtn = rootEl?.querySelector("#pd-chat-send");
    if (input) { input.disabled = working; input.placeholder = working ? "AI \u5904\u7406\u4E2D..." : "\u63CF\u8FF0\u4FEE\u6539\u5185\u5BB9..."; }
    if (sendBtn) sendBtn.disabled = working;
    // Disable select mode during AI work
    if (working && selectMode) { exitSelectMode(); }
    // Update save button
    const saveBtn = rootEl?.querySelector("#pd-btn-save");
    if (saveBtn) saveBtn.classList.toggle("pd-disabled", working);
  }

  // ============================================================
  // Changes modal
  // ============================================================
  function showChangesModal() {
    if (pendingChanges.size === 0 || aiWorking) return;
    hidePopover();
    hideCommentBox();
    const modal = rootEl?.querySelector("#pd-changes-modal");
    const body = rootEl?.querySelector("#pd-modal-changes");
    if (!modal || !body) return;

    // Group by component chain
    const groups = new Map();
    for (const [, c] of pendingChanges) {
      const info = c.element ? getComponentLabel(c.element) : { label: c.selector.split(" > ").pop() || "unknown", source: "" };
      const key = info.label + (info.source ? "||" + info.source : "");
      if (!groups.has(key)) groups.set(key, { label: info.label, source: info.source, items: [] });
      groups.get(key).items.push(c);
    }

    let html = "";
    for (const [, group] of groups) {
      html += '<div class="pd-modal-group">';
      html += '<div class="pd-modal-comp">' + escapeHtml(group.label) + (group.source ? '<span class="pd-modal-source"> ' + escapeHtml(group.source) + '</span>' : '') + '</div>';
      for (const c of group.items) {
        html += '<div class="pd-modal-change">';
        if (c.property === "comment") {
          html += '<span class="pd-modal-prop-name">\u8BC4\u8BBA</span>: ';
          html += '<span class="pd-modal-new">' + escapeHtml(c.newValue) + '</span>';
        } else {
          html += '<span class="pd-modal-prop-name">' + escapeHtml(c.property) + '</span>: ';
          html += '<span class="pd-modal-old">' + escapeHtml(c.oldValue || "(\u7A7A)") + '</span>';
          html += '<span class="pd-modal-arrow"> \u2192 </span>';
          html += '<span class="pd-modal-new">' + escapeHtml(c.newValue) + '</span>';
        }
        html += '</div>';
      }
      html += '</div>';
    }
    body.innerHTML = html;
    modal.style.display = "flex";
  }

  function hideChangesModal() {
    const modal = rootEl?.querySelector("#pd-changes-modal");
    if (modal) modal.style.display = "none";
  }

  async function syncChanges() {
    hideChangesModal();
    if (!await ensureConnected()) {
      chatMessages.push({ role: "ai", content: "Agent \u672A\u8FDE\u63A5\uFF0C\u8BF7\u786E\u4FDD\u670D\u52A1\u5DF2\u542F\u52A8\u3002" });
      if (chatOpen) renderChatMessages();
      return;
    }
    // Enrich each change with component chain + context for disambiguation
    const changes = Array.from(pendingChanges.values()).map(function(c) {
      const info = c.element ? getComponentLabel(c.element) : { label: "", source: "" };
      const comp = c.element ? getComponentInfo(c.element) : null;
      // Extra context: text content + sibling index
      var textHint = "";
      var siblingHint = "";
      if (c.element) {
        var rawText = (c.element.textContent || "").trim().slice(0, 60);
        if (rawText) textHint = rawText;
        var parent = c.element.parentElement;
        if (parent) {
          var siblings = Array.from(parent.children).filter(function(s) { return s.tagName === c.element.tagName; });
          if (siblings.length > 1) siblingHint = "\u7B2C " + (siblings.indexOf(c.element) + 1) + "/" + siblings.length + " \u4E2A";
        }
      }
      return { selector: c.selector, property: c.property, oldValue: c.oldValue, newValue: c.newValue, componentChain: info.label, componentName: comp?.name, sourceFile: comp?.sourceFile, sourceLine: comp?.sourceLine, textContent: textHint, siblingIndex: siblingHint };
    });
    // Open chat panel
    if (!chatOpen) toggleChat();
    rootEl?.querySelector("#pd-chat-panel")?.classList.remove("pd-minimized");
    chatMessages.push({ role: "ai", content: "\u6B63\u5728\u540C\u6B65 " + changes.length + " \u9879\u53D8\u66F4\u5230\u6E90\u7801..." });
    renderChatMessages();
    setAIWorking(true);
    try {
      const result = await agent.applyChanges(changes);
      if (result.success) {
        chatMessages.push({ role: "ai", content: result.message || ("\u5DF2\u5B8C\u6210\uFF0C\u4FEE\u6539\u4E86: " + (result.filesModified||[]).join(", ")) });
        pendingChanges.clear(); originalStyles = new Map(); originalTexts = new Map(); undoStack = []; redoStack = [];
        updateSaveBadge(); updateUndoRedoState();
      } else {
        chatMessages.push({ role: "ai", content: "\u5931\u8D25: " + result.message });
      }
    } catch { chatMessages.push({ role: "ai", content: "\u540C\u6B65\u8BF7\u6C42\u5931\u8D25\u3002" }); }
    setAIWorking(false);
    renderChatMessages();
  }

  // ============================================================
  // Connection
  // ============================================================
  let retryTimer = null;
  function connectAgent() {
    if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
    tryConnect();
    retryTimer = setInterval(() => {
      if (!connected && panelVisible) tryConnect();
      else if (connected && retryTimer) { clearInterval(retryTimer); retryTimer = null; }
    }, 3000);
  }
  function tryConnect() {
    agent.getStatus().then(() => {
      connected = true; updateConnectionDot();
      if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
      agent.connectWs((type) => {
        if (type === "agent:start") setAIWorking(true);
        else if (type === "agent:done") { setAIWorking(false); pendingChanges.clear(); originalStyles = new Map(); originalTexts = new Map(); undoStack = []; redoStack = []; updateSaveBadge(); updateUndoRedoState(); }
        else if (type === "agent:error") setAIWorking(false);
      });
    }).catch(() => { connected = false; updateConnectionDot(); });
  }
  function updateConnectionDot() {
    const dot = rootEl?.querySelector("#pd-conn-dot");
    if (dot) { dot.style.background = connected ? "#22c55e" : "#ef4444"; }
  }

  // ============================================================
  // Select mode
  // ============================================================
  function enterSelectMode() {
    if (aiWorking) return;
    if (chatOpen) toggleChat();
    if (dragMode) exitDragMode();
    selectMode = true;
    createOverlays();
    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("click", onClick, true);
    rootEl?.querySelector("#pd-btn-select")?.classList.add("pd-tb-active");
    if (!navigatorOpen) toggleNavigator();
  }
  function exitSelectMode() {
    selectMode = false;
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("click", onClick, true);
    hideHover(); hideSelect(); destroyOverlays(); hidePopover();
    selectedElement = null;
    rootEl?.querySelector("#pd-btn-select")?.classList.remove("pd-tb-active");
    if (navigatorOpen) toggleNavigator();
  }
  function toggleSelectMode() {
    if (selectMode) exitSelectMode(); else enterSelectMode();
  }

  // ============================================================
  // Drag reorder mode
  // ============================================================
  let dragTarget = null;

  function enterDragMode() {
    if (aiWorking) return;
    if (chatOpen) toggleChat();
    if (selectMode) exitSelectMode();
    dragMode = true;
    createOverlays();
    document.body.style.cursor = "grab";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onDragHover, true);
    document.addEventListener("mousedown", onDragMouseDown, true);
    rootEl?.querySelector("#pd-btn-drag")?.classList.add("pd-tb-active");
  }
  function exitDragMode() {
    dragMode = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    document.removeEventListener("mousemove", onDragHover, true);
    document.removeEventListener("mousedown", onDragMouseDown, true);
    hideHover(); hideSelect(); destroyOverlays();
    rootEl?.querySelector("#pd-btn-drag")?.classList.remove("pd-tb-active");
  }
  function toggleDragMode() {
    if (dragMode) exitDragMode(); else enterDragMode();
  }

  function onDragHover(e) {
    if (!dragMode || dragTarget) return;
    const target = e.target;
    if (isOurElement(target)) { hideHover(); return; }
    showHover(target);
  }

  function onDragMouseDown(e) {
    if (!dragMode || aiWorking) return;
    const target = e.target;
    if (isOurElement(target)) return;
    e.preventDefault();
    e.stopPropagation();

    const parent = target.parentElement;
    if (!parent) return;
    const siblings = Array.from(parent.children).filter(c => !isOurElement(c));
    if (siblings.length < 2) return; // nothing to reorder

    dragTarget = target;
    const fromIndex = siblings.indexOf(target);
    target.style.opacity = "0.4";
    target.style.outline = "2px dashed #6366f1";
    document.body.style.cursor = "grabbing";
    hideHover();

    let lastDropTarget = null;

    const onMove = (ev) => {
      ev.preventDefault();
      // Temporarily hide drag target to get element underneath
      target.style.pointerEvents = "none";
      const hoverEl = document.elementFromPoint(ev.clientX, ev.clientY);
      target.style.pointerEvents = "";

      if (!hoverEl || isOurElement(hoverEl)) {
        if (lastDropTarget) { lastDropTarget.style.borderTop = ""; lastDropTarget = null; }
        return;
      }
      const sib = siblings.find(s => s !== target && (s === hoverEl || s.contains(hoverEl)));
      if (lastDropTarget && lastDropTarget !== sib) { lastDropTarget.style.borderTop = ""; }
      if (sib) { sib.style.borderTop = "3px solid #6366f1"; lastDropTarget = sib; }
    };
    const onUp = (ev) => {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("mouseup", onUp, true);
      target.style.opacity = "";
      target.style.outline = "";
      target.style.pointerEvents = "";
      document.body.style.cursor = "grab";
      siblings.forEach(s => s.style.borderTop = "");

      target.style.pointerEvents = "none";
      const hoverEl = document.elementFromPoint(ev.clientX, ev.clientY);
      target.style.pointerEvents = "";

      const dropTarget = siblings.find(s => s !== target && (s === hoverEl || s.contains(hoverEl)));
      if (dropTarget) {
        const toIndex = siblings.indexOf(dropTarget);
        pushUndo();
        if (toIndex > fromIndex) parent.insertBefore(target, dropTarget.nextSibling);
        else parent.insertBefore(target, dropTarget);
        dragMoves.push({ element: getDomPath(target), from: fromIndex, to: toIndex });
        updateSaveBadge();
      }
      dragTarget = null;
    };
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mouseup", onUp, true);
  }

  function onMouseMove(e) {
    if (!selectMode || aiWorking) return;
    const target = e.target;
    if (isOurElement(target)) { hideHover(); return; }
    if (target === selectedElement) return;
    showHover(target);
  }
  function onClick(e) {
    if (!selectMode || aiWorking) return;
    const target = e.target;
    if (isOurElement(target)) return;
    if (target.contentEditable === "true") return;
    e.preventDefault(); e.stopPropagation();
    selectedElement = target;
    hideHover(); showSelect(target); showPopover(target); showCommentBox(target);
    syncNavigatorToElement(target);
  }

  function syncNavigatorToElement(el) {
    if (!navigatorOpen || !rootEl) return;
    const allEls = getAllElements();
    const idx = allEls.indexOf(el);
    if (idx === -1) return;
    const nodes = rootEl.querySelectorAll(".pd-nav-node");
    if (idx >= nodes.length) return;
    // Clear previous
    rootEl.querySelectorAll(".pd-nav-node.pd-nav-active").forEach(n => n.classList.remove("pd-nav-active"));
    const targetNode = nodes[idx];
    targetNode.classList.add("pd-nav-active");
    // Expand parent tree nodes to make it visible
    let parent = targetNode.parentElement;
    while (parent && parent.classList) {
      if (parent.classList.contains("pd-nav-kids") && !parent.classList.contains("pd-expanded")) {
        parent.classList.add("pd-expanded");
        const uid = parent.dataset.pdParent;
        if (uid) {
          const arrow = rootEl.querySelector("[data-pd-toggle=\\"" + uid + "\\"]");
          if (arrow) arrow.textContent = "\\u25BC";
        }
      }
      parent = parent.parentElement;
    }
    // Scroll into view
    targetNode.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // ============================================================
  // Create UI
  // ============================================================
  function createUI() {
    styleEl = document.createElement("style");
    styleEl.id = "pd-panel-style";
    styleEl.textContent = \`
      #pd-root, #pd-root * { box-sizing: border-box; }
      #pd-root { position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 2147483640; pointer-events: none;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif; font-size: 13px; color: #1a1a1a; line-height: 1.5; }

      /* ---- Bottom Toolbar ---- */
      #pd-toolbar {
        position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
        background: #fff; border: 1px solid #e5e7eb; border-radius: 14px;
        padding: 6px 10px; display: flex; align-items: center; gap: 0;
        pointer-events: auto;
        box-shadow: 0 4px 24px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.04);
        z-index: 2147483647;
        transition: opacity 0.2s;
      }
      #pd-toolbar.pd-ai-busy { opacity: 0.7; }
      #pd-toolbar.pd-ai-busy::after {
        content: "AI \u5904\u7406\u4E2D..."; position: absolute; top: -28px; left: 50%; transform: translateX(-50%);
        background: #fef3c7; color: #92400e; font-size: 11px; padding: 2px 10px; border-radius: 6px;
        white-space: nowrap; border: 1px solid #fde68a;
      }
      .pd-tb-btn {
        display: inline-flex; align-items: center; justify-content: center; gap: 4px;
        height: 32px; padding: 0 8px; border: none; border-radius: 8px;
        background: transparent; color: #6b7280; font-size: 12px; font-weight: 500;
        cursor: pointer; transition: all 0.15s; white-space: nowrap; position: relative;
      }
      .pd-tb-btn:hover { background: #f3f4f6; color: #374151; }
      .pd-tb-btn.pd-tb-active { background: #ede9fe; color: #6366f1; }
      .pd-tb-btn.pd-disabled { opacity: 0.35; pointer-events: none; }
      .pd-tb-btn svg { width: 16px; height: 16px; }
      .pd-tb-sep { width: 1px; height: 20px; background: #e5e7eb; margin: 0 6px; flex-shrink: 0; }
      .pd-conn-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
      .pd-save-badge {
        display: none; align-items: center; justify-content: center;
        min-width: 16px; height: 16px; padding: 0 4px;
        background: #ef4444; color: #fff; font-size: 9px; font-weight: 700;
        border-radius: 8px; position: absolute; top: 2px; right: 2px;
      }

      /* ---- Unified Panel ---- */
      .pd-panel {
        position: fixed; background: #fff; border: 1px solid #e5e7eb; border-radius: 14px;
        display: none; flex-direction: column; pointer-events: auto;
        box-shadow: 0 8px 32px rgba(0,0,0,0.08);
        overflow: hidden;
      }
      .pd-panel-header {
        padding: 10px 14px; display: flex; align-items: center; gap: 8px;
        border-bottom: 1px solid #f0f0f0; background: #fafafa; flex-shrink: 0;
        font-weight: 600; font-size: 12px; color: #374151;
        border-radius: 14px 14px 0 0;
      }
      .pd-panel-header-spacer { flex: 1; }
      /* macOS window buttons — dots with icons on hover */
      .pd-panel-btns { display: flex; gap: 8px; align-items: center; }
      .pd-wbtn {
        width: 12px; height: 12px; border-radius: 50%; border: none; cursor: pointer;
        padding: 0; display: flex; align-items: center; justify-content: center;
        position: relative; transition: all 0.15s;
      }
      .pd-wbtn svg { display: none; width: 8px; height: 8px; stroke-width: 1.2; }
      .pd-panel-btns:hover .pd-wbtn svg { display: block; }
      /* Close (red) — macOS X icon */
      .pd-wbtn-close { background: #ff5f57; }
      .pd-wbtn-close svg { stroke: #4a0002; }
      /* Expand/Collapse (green) — macOS fullscreen arrows */
      .pd-wbtn-expand { background: #28c840; }
      .pd-wbtn-expand .pd-icon-expand,
      .pd-wbtn-expand .pd-icon-collapse { display: none !important; }
      .pd-panel-btns:hover .pd-wbtn-expand .pd-icon-expand { display: block !important; }
      .pd-minimized .pd-panel-btns:hover .pd-wbtn-expand .pd-icon-expand { display: none !important; }
      .pd-minimized .pd-panel-btns:hover .pd-wbtn-expand .pd-icon-collapse { display: block !important; }
      .pd-panel-body { flex: 1; overflow-y: auto; scrollbar-width: thin; scrollbar-color: #e5e7eb transparent; }
      .pd-panel.pd-minimized { bottom: auto !important; }
      .pd-panel.pd-minimized .pd-panel-body,
      .pd-panel.pd-minimized .pd-panel-footer,
      .pd-panel.pd-minimized #pd-chat-input-wrap { display: none !important; }
      .pd-panel.pd-minimized .pd-panel-header { border-bottom: none; border-radius: 14px; }

      /* ---- Navigator ---- */
      #pd-navigator { top: 16px; left: 16px; bottom: 80px; width: 280px; z-index: 2147483642; }
      .pd-nav-body { padding: 4px 0; }
      .pd-nav-node { padding: 4px 8px; cursor: default; white-space: nowrap; display: flex; align-items: center; gap: 4px; font-size: 12px; border-radius: 4px; margin: 0 4px; transition: background 0.1s; }
      .pd-nav-node:hover { background: #f3f4f6; }
      .pd-nav-node.pd-nav-active { background: #ede9fe; }
      .pd-nav-arrow { width: 14px; font-size: 9px; color: #9ca3af; flex-shrink: 0; text-align: center; cursor: pointer; border-radius: 3px; line-height: 16px; }
      .pd-nav-arrow:hover { background: #e5e7eb; color: #374151; }
      .pd-nav-dot { width: 14px; font-size: 12px; color: #d1d5db; flex-shrink: 0; text-align: center; }
      .pd-nav-tag { color: #374151; cursor: pointer; }
      .pd-nav-tag:hover { color: #6366f1; }
      .pd-nav-comp { color: #6366f1; font-weight: 600; }
      .pd-nav-cls { color: #9ca3af; font-size: 10px; margin-left: 2px; }
      .pd-nav-kids { display: none; }
      .pd-nav-kids.pd-expanded { display: block; }

      /* ---- Chat ---- */
      #pd-chat-panel { top: 16px; left: 16px; bottom: 80px; width: 340px; z-index: 2147483643; }
      #pd-chat-messages { flex: 1; overflow-y: auto; padding: 14px; scrollbar-width: thin; scrollbar-color: #e5e7eb transparent; }
      .pd-chat-empty { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 40px 20px; text-align: center; color: #9ca3af; font-size: 12px; line-height: 1.6; }
      .pd-chat-msg { margin-bottom: 12px; display: flex; gap: 8px; align-items: flex-start; }
      .pd-msg-user { justify-content: flex-end; }
      .pd-msg-ai { justify-content: flex-start; }
      .pd-msg-avatar { width: 22px; height: 22px; border-radius: 50%; background: #ede9fe; color: #6366f1; display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 9px; font-weight: 700; margin-top: 2px; }
      .pd-msg-bubble { max-width: 80%; padding: 8px 12px; border-radius: 12px; font-size: 12px; line-height: 1.5; word-break: break-word; }
      .pd-msg-user .pd-msg-bubble { background: #6366f1; color: #fff; border-bottom-right-radius: 4px; }
      .pd-msg-ai .pd-msg-bubble { background: #f3f4f6; color: #374151; border-bottom-left-radius: 4px; }
      /* Markdown in chat */
      .pd-md-h1 { font-size: 15px; font-weight: 700; margin: 6px 0 4px; }
      .pd-md-h2 { font-size: 13px; font-weight: 700; margin: 6px 0 3px; }
      .pd-md-h3 { font-size: 12px; font-weight: 700; margin: 4px 0 2px; }
      .pd-md-code { background: rgba(99,102,241,0.08); color: #6366f1; padding: 1px 5px; border-radius: 4px; font-family: ui-monospace, SFMono-Regular, monospace; font-size: 11px; }
      .pd-md-pre { background: #1e1b4b; color: #e5e7eb; padding: 10px 12px; border-radius: 8px; margin: 6px 0; overflow-x: auto; font-size: 11px; line-height: 1.5; }
      .pd-md-pre code { background: none; color: inherit; padding: 0; font-family: ui-monospace, SFMono-Regular, monospace; }
      .pd-md-table { width: 100%; border-collapse: collapse; margin: 6px 0; font-size: 11px; }
      .pd-md-table td { border: 1px solid #e5e7eb; padding: 4px 8px; }
      .pd-md-table tr:first-child td { font-weight: 600; background: #f9fafb; }
      .pd-md-ul { margin: 4px 0; padding-left: 18px; }
      .pd-md-ul li { margin: 2px 0; }
      .pd-msg-bubble strong { font-weight: 600; }
      .pd-msg-bubble em { font-style: italic; }
      .pd-panel-footer, #pd-chat-input-wrap { padding: 10px 12px; border-top: 1px solid #f0f0f0; display: flex; gap: 8px; background: #fafafa; border-radius: 0 0 14px 14px; flex-shrink: 0; }
      #pd-chat-input { flex: 1; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px 12px; color: #1a1a1a; font-size: 12px; outline: none; resize: none; font-family: inherit; min-height: 36px; max-height: 80px; transition: border-color 0.15s; }
      #pd-chat-input::placeholder { color: #c0c0c0; }
      #pd-chat-input:focus { border-color: #6366f1; }
      #pd-chat-input:disabled { background: #f9fafb; color: #9ca3af; }
      #pd-chat-send { width: 36px; height: 36px; border-radius: 8px; border: none; background: #6366f1; color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background 0.15s; flex-shrink: 0; }
      #pd-chat-send:hover { background: #4f46e5; }
      #pd-chat-send:disabled { background: #c7d2fe; cursor: not-allowed; }
      #pd-chat-send svg { width: 14px; height: 14px; }

      /* ---- Overlays (below #pd-root so panels stay on top) ---- */
      #pd-hover-overlay { position: absolute; pointer-events: none; z-index: 2147483630; border: 1.5px solid rgba(99,102,241,0.5); border-radius: 3px; background: rgba(99,102,241,0.06); display: none; transition: all 80ms; }
      #pd-select-overlay { position: absolute; pointer-events: none; z-index: 2147483630; border: 2px solid #6366f1; border-radius: 3px; background: rgba(99,102,241,0.04); display: none; transition: all 80ms; }
      #pd-label { position: absolute; pointer-events: none; z-index: 2147483631; background: #6366f1; color: #fff; font-size: 10px; font-weight: 500; font-family: ui-monospace, SFMono-Regular, monospace; padding: 2px 6px; border-radius: 4px; white-space: nowrap; display: none; }

      /* ---- Popover (uses .pd-panel styles) ---- */
      #pd-popover { position: fixed; z-index: 2147483646; width: 300px; background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; box-shadow: 0 8px 32px rgba(0,0,0,0.08); pointer-events: auto; overflow: hidden; color: #1a1a1a; }
      .pd-pop-title { font-size: 12px; font-weight: 600; color: #6366f1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .pd-pop-src { font-size: 9px; color: #9ca3af; font-family: ui-monospace, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .pd-pop-body { padding: 8px 0; max-height: 320px; overflow-y: auto; scrollbar-width: thin; scrollbar-color: #e5e7eb transparent; }
      .pd-pop-row { display: flex; align-items: center; gap: 6px; padding: 3px 12px; height: 28px; }
      .pd-pop-row:hover { background: #f9fafb; }
      .pd-pop-label { width: 64px; flex-shrink: 0; font-size: 11px; color: #9ca3af; text-align: right; }
      .pd-pop-row input[type="color"] { width: 24px; height: 20px; border: 1px solid #e5e7eb; border-radius: 4px; cursor: pointer; padding: 1px; background: #fff; }
      .pd-pop-row input[type="range"] { flex: 1; height: 3px; accent-color: #6366f1; cursor: pointer; }
      .pd-pop-row select { flex: 1; background: #fff; color: #374151; border: 1px solid #e5e7eb; border-radius: 4px; padding: 2px 6px; font-size: 11px; outline: none; }
      .pd-pop-val { width: 38px; font-size: 10px; color: #6366f1; text-align: right; font-family: ui-monospace, monospace; }
      .pd-pop-group { padding: 4px 0; }
      .pd-pop-group + .pd-pop-group { border-top: 1px solid #f0f0f0; }
      .pd-pop-group-title { font-size: 10px; font-weight: 600; color: #9ca3af; text-transform: uppercase; padding: 4px 14px 2px; letter-spacing: 0.05em; }
      .pd-pop-hex { font-size: 10px; color: #9ca3af; font-family: ui-monospace, monospace; margin-left: 4px; width: 52px; }
      .pd-pop-textarea {
        width: 100%; box-sizing: border-box; border: 1px solid #e5e7eb; border-radius: 6px;
        padding: 6px 10px; font-size: 12px; font-family: inherit; color: #1a1a1a;
        outline: none; resize: vertical; min-height: 40px; max-height: 120px;
        transition: border-color 0.15s; line-height: 1.5;
      }
      .pd-pop-textarea:focus { border-color: #6366f1; }

      /* ---- Comment box ---- */
      #pd-comment-box {
        position: fixed; z-index: 2147483646; width: 260px;
        background: #fff; border: 1px solid #e5e7eb; border-radius: 10px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.1); padding: 10px;
        pointer-events: auto;
      }
      .pd-comment-input {
        width: 100%; box-sizing: border-box; border: 1px solid #e5e7eb; border-radius: 6px;
        padding: 8px 10px; font-size: 12px; font-family: inherit;
        outline: none; resize: none; color: #1a1a1a; min-height: 48px;
        transition: border-color 0.15s;
      }
      .pd-comment-input:focus { border-color: #6366f1; }
      .pd-comment-input::placeholder { color: #c0c0c0; }
      .pd-comment-actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 8px; }
      .pd-comment-btn {
        height: 28px; padding: 0 14px; border: 1px solid #e5e7eb; background: #fff;
        color: #374151; font-size: 12px; border-radius: 6px; cursor: pointer;
        transition: all 0.15s;
      }
      .pd-comment-btn:hover { background: #f3f4f6; }
      .pd-comment-btn-ok { background: #6366f1; color: #fff; border-color: #6366f1; }
      .pd-comment-btn-ok:hover { background: #4f46e5; }

      /* ---- Changes Modal ---- */
      .pd-modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; z-index: 2147483648; pointer-events: auto; }
      .pd-modal { background: #fff; border-radius: 14px; width: 480px; max-height: 70vh; display: flex; flex-direction: column; box-shadow: 0 16px 48px rgba(0,0,0,0.15); overflow: hidden; }
      .pd-modal-body { flex: 1; overflow-y: auto; padding: 12px 16px; scrollbar-width: thin; scrollbar-color: #e5e7eb transparent; }
      .pd-modal-group { padding: 10px 0; border-bottom: 1px solid #f0f0f0; }
      .pd-modal-group:last-child { border-bottom: none; }
      .pd-modal-comp { font-size: 12px; font-weight: 600; color: #6366f1; margin-bottom: 6px; }
      .pd-modal-source { font-weight: 400; color: #9ca3af; font-size: 10px; font-family: ui-monospace, monospace; margin-left: 6px; }
      .pd-modal-change { font-size: 12px; color: #374151; padding: 2px 0 2px 12px; }
      .pd-modal-prop-name { color: #6b7280; }
      .pd-modal-old { color: #9ca3af; text-decoration: line-through; }
      .pd-modal-new { color: #22c55e; font-weight: 500; }
      .pd-modal-arrow { color: #9ca3af; }
      .pd-modal-footer { padding: 12px 16px; border-top: 1px solid #f0f0f0; display: flex; justify-content: flex-end; gap: 8px; background: #fafafa; border-radius: 0 0 14px 14px; }
      .pd-modal-btn { height: 32px; padding: 0 20px; border: 1px solid #e5e7eb; background: #fff; color: #374151; font-size: 13px; border-radius: 8px; cursor: pointer; transition: all 0.15s; }
      .pd-modal-btn:hover { background: #f3f4f6; }
      .pd-modal-btn-primary { background: #6366f1; color: #fff; border-color: #6366f1; }
      .pd-modal-btn-primary:hover { background: #4f46e5; }

      /* ---- Hint ---- */
      .pd-hint-toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px 18px; z-index: 2147483647; font-family: -apple-system, sans-serif; font-size: 12px; color: #6b7280; display: flex; align-items: center; gap: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.08); transition: opacity 0.4s, transform 0.4s; }
      .pd-hint-toast .pd-key-badge { background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 4px; padding: 1px 6px; font-size: 11px; color: #6366f1; font-weight: 600; }
    \`;
    document.head.appendChild(styleEl);

    rootEl = document.createElement("div");
    rootEl.id = "pd-root";
    rootEl.innerHTML =
      // Bottom toolbar
      '<div id="pd-toolbar">' +
        // Select
        '<button class="pd-tb-btn" id="pd-btn-select" title="\u9009\u62E9\u5143\u7D20">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="M13 13l6 6"/></svg>' +
        '</button>' +
        // Drag
        '<button class="pd-tb-btn" id="pd-btn-drag" title="\u62D6\u62FD\u6392\u5E8F">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 13V4.5a1.5 1.5 0 013 0V12"/><path d="M11 11.5V6.5a1.5 1.5 0 013 0V12"/><path d="M14 10.5V8.5a1.5 1.5 0 013 0V12"/><path d="M8 12.5a1.5 1.5 0 00-3 0V14a6 6 0 0012 0V12"/></svg>' +
        '</button>' +
        '<div class="pd-tb-sep"></div>' +
        // Chat
        '<button class="pd-tb-btn" id="pd-btn-chat" title="AI \u5BF9\u8BDD">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>' +
          '<span class="pd-conn-dot" id="pd-conn-dot" style="background:#ef4444"></span>' +
        '</button>' +
        '<div class="pd-tb-sep"></div>' +
        // Undo
        '<button class="pd-tb-btn pd-disabled" id="pd-btn-undo" title="\u64A4\u9500">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 00-9-9 9 9 0 00-6.69 3L3 13"/></svg>' +
        '</button>' +
        // Redo
        '<button class="pd-tb-btn pd-disabled" id="pd-btn-redo" title="\u91CD\u505A">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 019-9 9 9 0 016.69 3L21 13"/></svg>' +
        '</button>' +
        '<div class="pd-tb-sep"></div>' +
        // Pending changes
        '<button class="pd-tb-btn" id="pd-btn-save" title="\u5F85\u53D1\u9001\u53D8\u66F4">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>' +
          '<span class="pd-save-badge" id="pd-save-badge"></span>' +
        '</button>' +
      '</div>' +

      // Navigator panel
      '<div id="pd-navigator" class="pd-panel">' +
        '<div class="pd-panel-header">\u5BFC\u822A\u5668<span class="pd-panel-header-spacer"></span>' +
          '<div class="pd-panel-btns">' +
            '<button class="pd-wbtn pd-wbtn-expand" id="pd-nav-collapse" title="\u5C55\u5F00/\u6536\u8D77"><svg class="pd-icon-collapse" viewBox="0 0 10 10"><polygon points="1,1 5,1 1,5" fill="#006500"/><polygon points="9,9 5,9 9,5" fill="#006500"/></svg><svg class="pd-icon-expand" viewBox="0 0 10 10"><polygon points="5,5 9,5 5,1" fill="#006500"/><polygon points="5,5 1,5 5,9" fill="#006500"/></svg></button>' +
            '<button class="pd-wbtn pd-wbtn-close" id="pd-nav-close" title="\u5173\u95ED"><svg viewBox="0 0 10 10" fill="none"><path d="M2.5 2.5l5 5M7.5 2.5l-5 5"/></svg></button>' +
          '</div>' +
        '</div>' +
        '<div class="pd-panel-body pd-nav-body"></div>' +
      '</div>' +

      // Chat panel
      '<div id="pd-chat-panel" class="pd-panel">' +
        '<div class="pd-panel-header">\u5BF9\u8BDD<span class="pd-panel-header-spacer"></span>' +
          '<div class="pd-panel-btns">' +
            '<button class="pd-wbtn pd-wbtn-expand" id="pd-chat-collapse" title="\u5C55\u5F00/\u6536\u8D77"><svg class="pd-icon-collapse" viewBox="0 0 10 10"><polygon points="1,1 5,1 1,5" fill="#006500"/><polygon points="9,9 5,9 9,5" fill="#006500"/></svg><svg class="pd-icon-expand" viewBox="0 0 10 10"><polygon points="5,5 9,5 5,1" fill="#006500"/><polygon points="5,5 1,5 5,9" fill="#006500"/></svg></button>' +
            '<button class="pd-wbtn pd-wbtn-close" id="pd-chat-close" title="\u5173\u95ED"><svg viewBox="0 0 10 10" fill="none"><path d="M2.5 2.5l5 5M7.5 2.5l-5 5"/></svg></button>' +
          '</div>' +
        '</div>' +
        '<div class="pd-panel-body" id="pd-chat-messages"></div>' +
        '<div class="pd-panel-footer" id="pd-chat-input-wrap">' +
          '<textarea id="pd-chat-input" placeholder="\u63CF\u8FF0\u4FEE\u6539\u5185\u5BB9..." rows="1"></textarea>' +
          '<button id="pd-chat-send"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg></button>' +
        '</div>' +
      '</div>' +

      // Changes modal
      '<div id="pd-changes-modal" class="pd-modal-overlay" style="display:none">' +
        '<div class="pd-modal">' +
          '<div class="pd-panel-header">\u5F85\u53D1\u9001\u53D8\u66F4<span class="pd-panel-header-spacer"></span><div class="pd-panel-btns"><button class="pd-wbtn pd-wbtn-close" id="pd-modal-close"><svg viewBox="0 0 10 10" fill="none"><path d="M2.5 2.5l5 5M7.5 2.5l-5 5"/></svg></button></div></div>' +
          '<div class="pd-modal-body" id="pd-modal-changes"></div>' +
          '<div class="pd-modal-footer">' +
            '<button class="pd-modal-btn" id="pd-modal-cancel">\u53D6\u6D88</button>' +
            '<button class="pd-modal-btn pd-modal-btn-primary" id="pd-modal-sync">\u540C\u6B65\u5230\u4EE3\u7801</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.body.appendChild(rootEl);

    // ---- Bind toolbar ----
    rootEl.querySelector("#pd-btn-select").addEventListener("click", toggleSelectMode);
    rootEl.querySelector("#pd-btn-drag").addEventListener("click", toggleDragMode);
    rootEl.querySelector("#pd-btn-chat").addEventListener("click", toggleChat);
    rootEl.querySelector("#pd-btn-undo").addEventListener("click", doUndo);
    rootEl.querySelector("#pd-btn-redo").addEventListener("click", doRedo);
    rootEl.querySelector("#pd-btn-save").addEventListener("click", showChangesModal);
    rootEl.querySelector("#pd-modal-close").addEventListener("click", hideChangesModal);
    rootEl.querySelector("#pd-modal-cancel").addEventListener("click", hideChangesModal);
    rootEl.querySelector("#pd-modal-sync").addEventListener("click", syncChanges);

    // ---- Navigator events ----
    rootEl.querySelector("#pd-nav-close").addEventListener("click", () => { if (selectMode) exitSelectMode(); else toggleNavigator(); });
    rootEl.querySelector("#pd-nav-collapse").addEventListener("click", () => {
      rootEl.querySelector("#pd-navigator").classList.toggle("pd-minimized");
    });
    const navBody = rootEl.querySelector(".pd-nav-body");
    // Arrow click: toggle expand only
    navBody.addEventListener("click", (e) => {
      const arrow = e.target.closest("[data-pd-toggle]");
      if (arrow) {
        e.stopPropagation();
        const uid = arrow.dataset.pdToggle;
        const kidBlock = rootEl.querySelector('[data-pd-parent="'+uid+'"]');
        if (kidBlock) {
          kidBlock.classList.toggle("pd-expanded");
          arrow.textContent = kidBlock.classList.contains("pd-expanded") ? "\\u25BC" : "\\u25B6";
        }
        return;
      }
      // Node click: select element
      const node = e.target.closest(".pd-nav-node");
      if (!node) return;
      const idx = Array.from(rootEl.querySelectorAll(".pd-nav-node")).indexOf(node);
      const allEls = getAllElements();
      if (allEls[idx]) {
        // Clear previous active
        rootEl.querySelectorAll(".pd-nav-node.pd-nav-active").forEach(n => n.classList.remove("pd-nav-active"));
        node.classList.add("pd-nav-active");
        pushUndo();
        selectedElement = allEls[idx];
        showSelect(selectedElement);
        showPopover(selectedElement);
        selectedElement.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
    // Hover: highlight element on page
    navBody.addEventListener("mouseover", (e) => {
      const node = e.target.closest(".pd-nav-node");
      if (!node) return;
      const idx = Array.from(rootEl.querySelectorAll(".pd-nav-node")).indexOf(node);
      const allEls = getAllElements();
      if (allEls[idx]) showHover(allEls[idx]);
    });
    navBody.addEventListener("mouseleave", () => { hideHover(); });

    // ---- Chat events ----
    rootEl.querySelector("#pd-chat-close").addEventListener("click", toggleChat);
    rootEl.querySelector("#pd-chat-collapse").addEventListener("click", () => {
      rootEl.querySelector("#pd-chat-panel").classList.toggle("pd-minimized");
    });
    const chatInput = rootEl.querySelector("#pd-chat-input");
    rootEl.querySelector("#pd-chat-send").addEventListener("click", () => { sendChatMessage(chatInput.value); chatInput.value = ""; chatInput.style.height = "36px"; });
    chatInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendChatMessage(chatInput.value); chatInput.value = ""; chatInput.style.height = "36px"; } });
    chatInput.addEventListener("input", () => { chatInput.style.height = "36px"; chatInput.style.height = Math.min(chatInput.scrollHeight, 80)+"px"; });

    // Make panels draggable
    makeDraggable(rootEl.querySelector("#pd-navigator"), rootEl.querySelector("#pd-navigator .pd-panel-header"));
    makeDraggable(rootEl.querySelector("#pd-chat-panel"), rootEl.querySelector("#pd-chat-panel .pd-panel-header"));
    makeResizable(rootEl.querySelector("#pd-navigator"));
    makeResizable(rootEl.querySelector("#pd-chat-panel"));

    renderChatMessages();
    updateSaveBadge();
    updateUndoRedoState();
  }

  // ============================================================
  // Show / Hide
  // ============================================================
  function showPanel() {
    if (!rootEl) createUI();
    rootEl.style.display = "block";
    panelVisible = true;
    connectAgent();
    enterSelectMode();
    saveState();
  }
  function hidePanel() {
    if (!rootEl) return;
    rootEl.style.display = "none";
    panelVisible = false;
    if (selectMode) exitSelectMode();
    if (dragMode) exitDragMode();
    if (chatOpen) toggleChat();
    if (navigatorOpen) toggleNavigator();
    hidePopover();
    saveState();
  }
  function togglePanel() { dismissHint(); if (panelVisible) hidePanel(); else showPanel(); }

  // ============================================================
  // Keyboard shortcut
  // ============================================================
  document.addEventListener("keydown", (e) => {
    // Tab — toggle design mode
    if (e.key === TOGGLE_KEY && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const active = document.activeElement;
      if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT" || active.contentEditable === "true")) return;
      e.preventDefault();
      togglePanel();
      return;
    }
    // Ctrl+key shortcuts — only when design mode is active
    if (!panelVisible || !(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    if (key === "e") { e.preventDefault(); toggleSelectMode(); }
    else if (key === "d") { e.preventDefault(); toggleDragMode(); }
    else if (key === "t") { e.preventDefault(); toggleChat(); }
    else if (key === "u") { e.preventDefault(); doUndo(); }
    else if (key === "r") { e.preventDefault(); doRedo(); }
    else if (key === "s") { e.preventDefault(); showChangesModal(); }
  });

  // Hint — show on page load
  let hintEl = null;
  function dismissHint() {
    if (hintEl) { hintEl.style.opacity = "0"; hintEl.style.transform = "translateX(-50%) translateY(8px)"; setTimeout(() => { if (hintEl) { hintEl.remove(); hintEl = null; } }, 400); }
  }
  function showHint() {
    hintEl = document.createElement("div");
    Object.assign(hintEl.style, {
      position: "fixed", bottom: "24px", left: "50%", transform: "translateX(-50%)",
      background: "#fff", border: "1px solid #e5e7eb", borderRadius: "10px",
      padding: "10px 18px", zIndex: "2147483647", fontFamily: "-apple-system, sans-serif",
      fontSize: "12px", color: "#6b7280", display: "flex", alignItems: "center", gap: "8px",
      boxShadow: "0 4px 16px rgba(0,0,0,0.08)", transition: "opacity 0.4s, transform 0.4s"
    });
    const badge = '<span style="background:#f3f4f6;border:1px solid #e5e7eb;border-radius:4px;padding:1px 6px;font-size:11px;color:#6366f1;font-weight:600;">Tab</span>';
    hintEl.innerHTML = "\u6309 " + badge + " \u8FDB\u5165\u8BBE\u8BA1\u6A21\u5F0F";
    document.body.appendChild(hintEl);
    setTimeout(dismissHint, 4000);
  }
  if (!savedState?.panelVisible) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", showHint);
    } else {
      setTimeout(showHint, 300);
    }
  }

  // Restore state after HMR/reload
  if (savedState?.panelVisible) {
    // Delay to ensure DOM is ready
    setTimeout(() => {
      showPanel();
      if (savedState.chatOpen) toggleChat();
    }, 100);
  }

  console.log("[PrismDesign] \u5DF2\u52A0\u8F7D\uFF0C\u6309 Tab \u952E\u5207\u6362\u8BBE\u8BA1\u6A21\u5F0F");
})();
`;
}
