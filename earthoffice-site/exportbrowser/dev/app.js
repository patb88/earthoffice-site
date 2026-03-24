/* Chat Explorer (SAFE MODE)
   - Clean reader UI (Filters / Conversations / Turns)
   - Turn consolidation (user + assistant blocks)
   - No augmentations; topic/tags controls are present but no-op for now
*/
console.log("Chat Explorer: SAFE MODE");

const ENABLE_TAG_ASSIST = false; // true only on local dev
const els = {
  // Top actions
  fileInput: document.getElementById("fileInput"),
  loadDefaultBtn: document.getElementById("loadDefaultBtn"),
  clearBtn: document.getElementById("clearBtn"),

  // Filters (left)
  searchInput: document.getElementById("searchInput"),
  truncateInput: document.getElementById("truncateInput"),
  fromDate: document.getElementById("fromDate"),
  toDate: document.getElementById("toDate"),
  topicSelect: document.getElementById("topicSelect"),
  tagInput: document.getElementById("tagInput"),
  applyFilterBtn: document.getElementById("applyFilterBtn"),
  clearFilterBtn: document.getElementById("clearFilterBtn"),
  providerFilterWrap: document.getElementById("providerFilterWrap"),

  // Conversations (middle)
  convSearch: document.getElementById("convSearch"),
  convList: document.getElementById("convList"),
  convMeta: document.getElementById("convMeta"),

  // Messages (middle)
  promptList: document.getElementById("promptList"),
  promptMeta: document.getElementById("promptMeta"),

  // Turns (right)
  turnsTitle: document.getElementById("turnsTitle"),
  turnsMeta: document.getElementById("turnsMeta"),
  turnsPane: document.getElementById("turnsPane"),
  scrollTopBtn: document.getElementById("scrollTopBtn"),
  toggleAllBtn: document.getElementById("toggleAllBtn"),
  showTimesBtn: document.getElementById("showTimesBtn"),
 
  // Status/meta
  status: document.getElementById("status"),
  jsonMeta: document.getElementById("jsonMeta"),

  // Modal
  modalOverlay: document.getElementById("modalOverlay"),
  modalTitle: document.getElementById("modalTitle"),
  modalPre: document.getElementById("modalPre"),
  modalCloseBtn: document.getElementById("modalCloseBtn"),

  // Topics (Tier 2)
  topicsFileInput: document.getElementById("topicsFileInput"),
  loadTopicsBtn: document.getElementById("loadTopicsBtn"),
  exportTopicsBtn: document.getElementById("exportTopicsBtn"),

  // Tags local file controls
  loadTagsBtn: document.getElementById("loadTagsBtn"),
  exportTagsBtn: document.getElementById("exportTagsBtn"),

  // Tag modal
  tagModalOverlay: document.getElementById("tagModalOverlay"),
  tagModalTitle: document.getElementById("tagModalTitle"),
  tagModalMeta: document.getElementById("tagModalMeta"),
  tagModalList: document.getElementById("tagModalList"),
  tagModalNewName: document.getElementById("tagModalNewName"),
  tagModalAddBtn: document.getElementById("tagModalAddBtn"),
  tagModalSaveBtn: document.getElementById("tagModalSaveBtn"),
  tagModalClearBtn: document.getElementById("tagModalClearBtn"),
  tagModalCloseBtn: document.getElementById("tagModalCloseBtn"),
  tagsFileInput: document.getElementById("tagsFileInput"),

  // Topic modal
  topicModalOverlay: document.getElementById("topicModalOverlay"),
  topicModalTitle: document.getElementById("topicModalTitle"),
  topicModalMeta: document.getElementById("topicModalMeta"),
  topicModalList: document.getElementById("topicModalList"),
  topicModalNewName: document.getElementById("topicModalNewName"),
  topicModalAddBtn: document.getElementById("topicModalAddBtn"),
  topicModalCloseBtn: document.getElementById("topicModalCloseBtn"),
  topicModalSaveBtn: document.getElementById("topicModalSaveBtn"),
  topicModalClearBtn: document.getElementById("topicModalClearBtn"),
};


const state = {
  showTimes: false,
  // Topics (conversation-level) loaded from topics.json sidecar
  topics: {
    version: 1,
    catalog: [],      // [{id,name,color?,order?}]
    byId: new Map(),  // id -> topic
    assignments: {},  // convId -> [topicId]
    loaded: false,
    source: "",
  },

  // Tags (turn-level) loaded from tags.json sidecar (local-only)
  tags: {
    version: 1,
    tags: [],          // [{id,name,order?}]
    assignments: {},   // convId -> { turnIndex: [tagId...] }
    loaded: false,
    source: "",
  },

  // Topic editing (Tier 2)
  topicEdit: {
    convId: null,
    selected: new Set(),
  },

  // Tag editing (turn-level)
  tagEdit: null, // { convId, turnIx, currentSet }

  rawData: null,
  rowsAll: [],       // flattened messages
  rowsFiltered: [],  // message-level filter result
  convIndex: new Map(), // convId -> { convId, title, msgs: [], firstTime, lastTime }
  convList: [],      // array of conv summaries for UI (after convSearch)
  selectedConvId: null,
  allExpanded: false,
  providerFilters: new Set(),
  providerFilterSeen: new Set(),
};

// ---------- utilities ----------
function safeStr(v) { return (v === null || v === undefined) ? "" : String(v); }

function debounce(fn, ms) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}


// ---------- topics (conversation-level sidecar) ----------
const TOPIC_UNASSIGNED = "__unassigned__";
function slugifyTopicId(name) {
  const base = safeStr(name)
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "topic";
}

// Generic slugifier used by tags as well
function slugifyId(name) {
  return slugifyTopicId(name);
}


function rebuildTopicIndex() {
  state.topics.byId = new Map(state.topics.catalog.map(t => [t.id, t]));
}

function ensureUniqueTopicId(desiredId) {
  const id0 = safeStr(desiredId).trim() || "topic";
  let id = id0;
  let k = 2;
  const exists = (x) => state.topics.byId?.has(x) || state.topics.catalog.some(t => t.id === x);
  while (exists(id)) {
    id = `${id0}-${k++}`;
  }
  return id;
}

function sortTopicCatalog() {
  state.topics.catalog.sort((a, b) => {
    const ao = (a.order ?? 999999);
    const bo = (b.order ?? 999999);
    if (ao !== bo) return ao - bo;
    return safeStr(a.name).localeCompare(safeStr(b.name));
  });
}

function addTopic(name) {
  const nm = safeStr(name).trim();
  if (!nm) return null;

  const baseId = slugifyTopicId(nm);
  const id = ensureUniqueTopicId(baseId);

  const t = { id, name: nm };
  state.topics.catalog.push(t);
  sortTopicCatalog();
  rebuildTopicIndex();
  populateTopicSelect();

  // If a topic modal is open, refresh its list in-place
  if (state.topicEdit?.convId) renderTopicModalList();

  // Re-render conversation list to reflect topic labels
  if (state.convIndex && state.convIndex.size) renderAll();

  return t;
}

function renameTopic(topicId, newName) {
  const id = safeStr(topicId);
  const nm = safeStr(newName).trim();
  if (!id || !nm) return false;
  const t = state.topics.catalog.find(x => x.id === id);
  if (!t) return false;
  t.name = nm;
  sortTopicCatalog();
  rebuildTopicIndex();
  populateTopicSelect();
  if (state.topicEdit?.convId) renderTopicModalList();
  if (state.convIndex && state.convIndex.size) renderAll();
  return true;
}

function deleteTopic(topicId) {
  const id = safeStr(topicId);
  if (!id) return false;

  // Remove from catalog
  const before = state.topics.catalog.length;
  state.topics.catalog = state.topics.catalog.filter(t => t.id !== id);
  if (state.topics.catalog.length === before) return false;

  // Remove from assignments everywhere
  const a = state.topics.assignments || {};
  for (const convId of Object.keys(a)) {
    const arr = Array.isArray(a[convId]) ? a[convId] : [];
    const next = arr.filter(x => x !== id);
    if (next.length) a[convId] = next;
    else delete a[convId];
  }

  // Remove from current modal selection
  if (state.topicEdit?.selected) state.topicEdit.selected.delete(id);

  rebuildTopicIndex();
  populateTopicSelect();

  // If the filter is set to a deleted topic, reset it
  if (safeStr(els.topicSelect?.value) === id && els.topicSelect) {
    els.topicSelect.value = "";
  }

  if (state.topicEdit?.convId) renderTopicModalList();
  if (state.convIndex && state.convIndex.size) renderAll();
  return true;
}


function normalizeTopicsData(data) {
  // Accept: { version, topics: [...], assignments: {...} }
  if (!data || typeof data !== "object") return { version: 1, topics: [], assignments: {} };
  const version = Number(data.version || 1) || 1;
  const topics = Array.isArray(data.topics) ? data.topics : [];
  const assignments = (data.assignments && typeof data.assignments === "object") ? data.assignments : {};
  return { version, topics, assignments };
}

function ingestTopics(data, sourceLabel) {
  const norm = normalizeTopicsData(data);

  state.topics.version = norm.version;
  state.topics.catalog = norm.topics
    .filter(t => t && typeof t === "object" && typeof t.id === "string" && t.id.trim())
    .map(t => ({
      id: t.id.trim(),
      name: safeStr(t.name || t.id).trim() || t.id.trim(),
      color: safeStr(t.color || "").trim(),
      order: Number.isFinite(Number(t.order)) ? Number(t.order) : null,
    }));

  // Sort: explicit order first, then name
  state.topics.catalog.sort((a, b) => {
    const ao = (a.order === null ? 1e9 : a.order);
    const bo = (b.order === null ? 1e9 : b.order);
    if (ao !== bo) return ao - bo;
    return a.name.localeCompare(b.name);
  });

  state.topics.byId = new Map(state.topics.catalog.map(t => [t.id, t]));

  // Normalize assignments: convId -> [topicId...]
  const cleaned = {};
  for (const [convId, v] of Object.entries(norm.assignments || {})) {
    const key = safeStr(convId).trim();
    if (!key) continue;

    let arr = [];
    if (Array.isArray(v)) arr = v;
    else if (typeof v === "string" && v.trim()) arr = [v.trim()];
    else continue;

    // keep only non-empty ids (we do NOT require the id to exist in catalog yet)
    const ids = Array.from(new Set(arr.map(x => safeStr(x).trim()).filter(Boolean)));
    cleaned[key] = ids;
  }
  state.topics.assignments = cleaned;

  state.topics.loaded = true;
  state.topics.source = safeStr(sourceLabel || "");

  populateTopicSelect();

  // If data is already loaded, re-render to apply topic filter immediately
  if (state.convIndex && state.convIndex.size) renderAll();
}


function ingestTags(data, sourceLabel) {
  const norm = normalizeTagsFile(data);
  // State shape mirrors topics but uses tags/tags
  state.tags.version = norm.version || 1;
  state.tags.tags = (norm.tags || []).map(t => ({
    id: safeStr(t.id).trim(),
    name: safeStr(t.name || t.id).trim() || safeStr(t.id).trim(),
    order: Number.isFinite(Number(t.order)) ? Number(t.order) : 0,
  })).filter(t => t.id);

  state.tags.assignments = norm.assignments || {};
  state.tags.axis_assignments = norm.axis_assignments || {};
  state.tags.axes_meta = norm.axes_meta || {};
  sortTagsCatalog();
  state.tags.loaded = true;

  // Update UI meta
  const count = state.tags.tags.length;
  els.jsonMeta.textContent = `${safeStr(els.jsonMeta.textContent)} • Tags: ${count} loaded from ${sourceLabel || "tags.json"}`;
}

function openTagModal(convId, turnIx) {
  if (!convId || turnIx === null || turnIx === undefined) return;
  state.selectedTurnIx = turnIx;
  state.tagEdit = { convId, turnIx };
  renderTagModalList();
  els.tagModalOverlay?.classList.add("open");
  els.tagModalOverlay?.setAttribute("aria-hidden", "false");
}

function closeTagModal() {
  els.tagModalOverlay?.classList.remove("open");
  els.tagModalOverlay?.setAttribute("aria-hidden", "true");
  state.tagEdit = null;
}


function renderTagModalList() {
  const convId = state.tagEdit?.convId;
  const turnIx = state.tagEdit?.turnIx;
  if (convId === null || convId === undefined) return;

  const entry = state.convIndex.get(convId);
  const title = entry?.title || "(untitled)";
  els.tagModalTitle.textContent = "Edit Tags";
  els.tagModalMeta.textContent = `${title} • turn ${Number(turnIx) + 1} • ${convId}`;

  const list = els.tagModalList;
  if (!list) return;
  list.innerHTML = "";

  const frag = document.createDocumentFragment();

  if (!state.tags.loaded || !state.tags.tags.length) {
    const empty = document.createElement("div");
    empty.className = "small";
    empty.textContent = "No tags found. Use “Load tags” or add one below.";
    frag.appendChild(empty);
    list.appendChild(frag);
    return;
  }

  const current = new Set(getTurnTags(convId, turnIx));
  state.tagEdit.currentSet = current;

  for (const t of state.tags.tags) {
    const row = document.createElement("div");
    row.className = "topicItem";

    const label = document.createElement("label");
    label.className = "topicLabel";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = current.has(t.id);
    cb.addEventListener("change", () => {
      if (cb.checked) current.add(t.id);
      else current.delete(t.id);
    });

    const span = document.createElement("span");
    span.className = "topicName";
    span.textContent = t.name;

    label.appendChild(cb);
    label.appendChild(span);

    const actions = document.createElement("div");
    actions.className = "topicActions";

    const ren = document.createElement("button");
    ren.className = "tertiary topicMiniBtn";
    ren.type = "button";
    ren.textContent = "Rename";
    ren.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      const next = prompt("Rename tag:", t.name);
      if (next === null) return;
      const trimmed = safeStr(next).trim();
      if (!trimmed) return;
      renameTag(t.id, trimmed);
      renderTagModalList();
      renderAll();
    });

    const del = document.createElement("button");
    del.className = "tertiary topicMiniBtn danger";
    del.type = "button";
    del.textContent = "Delete";
    del.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      const ok = confirm(`Delete tag “${t.name}”? This will remove it from all turns.`);
      if (!ok) return;
      deleteTag(t.id);
      renderTagModalList();
      renderAll();
    });

    actions.appendChild(ren);
    actions.appendChild(del);

    row.appendChild(label);
    row.appendChild(actions);

    frag.appendChild(row);
  }

  list.appendChild(frag);
}

function saveTagModal() {
  const convId = state.tagEdit?.convId;
  const turnIx = state.tagEdit?.turnIx;
  if (!convId && convId !== "") return;

  const set = state.tagEdit?.currentSet;
  const tags = set ? Array.from(set) : [];
  setTurnTags(convId, turnIx, tags);

  closeTagModal();
  renderAll();
}

function clearTagModal() {
  const convId = state.tagEdit?.convId;
  const turnIx = state.tagEdit?.turnIx;
  if (!convId && convId !== "") return;
  setTurnTags(convId, turnIx, []);
  closeTagModal();
  renderAll();
}


function populateTopicSelect() {
  const sel = els.topicSelect;
  if (!sel) return;

  const current = sel.value;

  sel.innerHTML = "";

  const optAll = document.createElement("option");
  optAll.value = "";
  optAll.textContent = "All topics";
  sel.appendChild(optAll);

  const optUn = document.createElement("option");
  optUn.value = TOPIC_UNASSIGNED;
  optUn.textContent = "Unassigned";
  sel.appendChild(optUn);

  for (const t of state.topics.catalog) {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.name;
    sel.appendChild(opt);
  }

  // Restore selection if still valid
  const exists = Array.from(sel.options).some(o => o.value === current);
  sel.value = exists ? current : "";
}

function getTopicIdsForConv(convId) {
  const ids = state.topics.assignments?.[convId];
  return Array.isArray(ids) ? ids : [];
}


function getTopicNamesForConv(convId) {
  const ids = getTopicIdsForConv(convId);
  if (!ids.length) return [];
  const names = [];
  for (const id of ids) {
    const t = state.topics.byId.get(id);
    names.push(t ? t.name : id);
  }
  return names;
}


function renderTopicModalList() {
  const list = els.topicModalList;
  if (!list) return;

  const frag = document.createDocumentFragment();

  if (!state.topics.catalog.length) {
    const empty = document.createElement("div");
    empty.className = "small";
    empty.textContent = "No topics found. Add one below or load topics.json.";
    frag.appendChild(empty);
  } else {
    for (const t of state.topics.catalog) {
      const row = document.createElement("div");
      row.className = "topicItem";

      const label = document.createElement("label");
      label.className = "topicLabel";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = state.topicEdit.selected.has(t.id);
      cb.addEventListener("change", () => {
        if (cb.checked) state.topicEdit.selected.add(t.id);
        else state.topicEdit.selected.delete(t.id);
      });

      const span = document.createElement("span");
      span.className = "topicName";
      span.textContent = t.name;

      label.appendChild(cb);
      label.appendChild(span);

      const actions = document.createElement("div");
      actions.className = "topicActions";

      const ren = document.createElement("button");
      ren.className = "tertiary topicMiniBtn";
      ren.type = "button";
      ren.textContent = "Rename";
      ren.addEventListener("click", (e) => {
        e.preventDefault(); e.stopPropagation();
        const next = prompt("Rename topic:", t.name);
        if (next === null) return;
        const trimmed = safeStr(next).trim();
        if (!trimmed) return;
        renameTopic(t.id, trimmed);
      });

      const del = document.createElement("button");
      del.className = "tertiary topicMiniBtn danger";
      del.type = "button";
      del.textContent = "Delete";
      del.addEventListener("click", (e) => {
        e.preventDefault(); e.stopPropagation();
        const ok = confirm(`Delete topic "${t.name}"? This will remove it from all conversations.`);
        if (!ok) return;
        deleteTopic(t.id);
      });

      actions.appendChild(ren);
      actions.appendChild(del);

      row.appendChild(label);
      row.appendChild(actions);

      frag.appendChild(row);
    }
  }

  list.innerHTML = "";
  list.appendChild(frag);
}

function openTopicModal(convId) {
  if (!convId) return;
  const overlay = els.topicModalOverlay;
  const list = els.topicModalList;
  if (!overlay || !list) return;

  // Initialize selection from current assignments
  state.topicEdit.convId = convId;
  state.topicEdit.selected = new Set(getTopicIdsForConv(convId));

  const entry = state.convIndex.get(convId);
  const title = entry?.title || "(untitled)";

  if (els.topicModalTitle) els.topicModalTitle.textContent = "Edit Topics";
  if (els.topicModalMeta) els.topicModalMeta.textContent = `${title} • ${convId}`;

  // Build checklist
  list.innerHTML = "";
  renderTopicModalList();

  overlay.classList.add("open");
  overlay.setAttribute("aria-hidden", "false");
}

function closeTopicModal() {
  const overlay = els.topicModalOverlay;
  if (!overlay) return;
  overlay.classList.remove("open");
  overlay.setAttribute("aria-hidden", "true");
  if (els.topicModalList) els.topicModalList.innerHTML = "";
  if (els.topicModalMeta) els.topicModalMeta.textContent = "";
  state.topicEdit.convId = null;
  state.topicEdit.selected = new Set();
}

function saveTopicModal() {
  const convId = state.topicEdit.convId;
  if (!convId) return;

  const ids = Array.from(state.topicEdit.selected);

  // Sort by catalog order/name for stable diffs
  const order = new Map(state.topics.catalog.map((t, ix) => [t.id, ix]));
  ids.sort((a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9) || a.localeCompare(b));

  if (ids.length) state.topics.assignments[convId] = ids;
  else delete state.topics.assignments[convId];

  closeTopicModal();

  // Refresh UI (topic filter + badges)
  renderAll();
}

function clearTopicModalSelection() {
  state.topicEdit.selected = new Set();
  // Reflect in UI
  els.topicModalList?.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.checked = false;
  });
}


function convMatchesTopic(convId, selectedTopicId) {
  if (!selectedTopicId) return true;
  const ids = getTopicIdsForConv(convId);

  if (selectedTopicId === TOPIC_UNASSIGNED) return ids.length === 0;
  return ids.includes(selectedTopicId);
}

function initTopicsLocalOnly() {
  // Local-only mode: topics are loaded explicitly by the user via "Load topics".
  // We do NOT fetch topics.json from the webserver.
  state.topics.loaded = false;
  state.topics.source = ""; // shown as "not loaded" in jsonMeta
  state.topics.catalog = [];
  state.topics.byId = new Map();
  state.topics.assignments = {};
  populateTopicSelect();
}

function initTagsLocalOnly() {
  // Local-only mode: tags are loaded explicitly by the user via "Load tags".
  // We do NOT fetch tags.json from the webserver.
  state.tags.loaded = false;
  state.tags.source = "";
  state.tags.tags = [];
  state.tags.assignments = {};
}


function toDateObj(ts) {
  if (!ts) return null;
  // ts is often unix seconds in ChatGPT export
  if (typeof ts === "number") {
    const ms = ts > 1e12 ? ts : ts * 1000;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(ts);
  return isNaN(d.getTime()) ? null : d;
}

function fmtDate(d) {
  if (!d) return "—";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtDateTime(d) {
  if (!d) return "";
  const ymd = fmtDate(d);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${ymd} ${hh}:${mm}:${ss}`;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function truncateText(s, n) {
  const text = safeStr(s);
  if (text.length <= n) return { short: text, truncated: false };
  return { short: text.slice(0, n) + "…", truncated: true };
}

// --- Markdown rendering (Tier 2: emphasis, strong, code, lists, blockquotes, headings, links) ---
function hasMarkdownRuntime() {
  return typeof window.marked !== "undefined" && typeof window.marked.parse === "function";
}

/**
 * Minimal sanitizer fallback (used only if DOMPurify isn't available).
 * Allowlist-based; strips risky tags/attrs and forces safe links.
 */
function sanitizeHtmlFallback(dirtyHtml) {
  const tpl = document.createElement("template");
  tpl.innerHTML = dirtyHtml;

  const ALLOW_TAGS = new Set([
    "P","BR","HR",
    "EM","STRONG",
    "CODE","PRE",
    "UL","OL","LI",
    "BLOCKQUOTE",
    "A",
    "H1","H2","H3","H4","H5","H6"
  ]);

  const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_ELEMENT, null);
  const toProcess = [];
  while (walker.nextNode()) toProcess.push(walker.currentNode);

  for (const el of toProcess) {
    const tag = el.tagName;

    // Remove outright dangerous containers
    if (["SCRIPT","STYLE","IFRAME","OBJECT","EMBED","LINK","META"].includes(tag)) {
      el.remove();
      continue;
    }

    if (!ALLOW_TAGS.has(tag)) {
      // Replace unknown tags with their text content (keeps readability)
      const txt = document.createTextNode(el.textContent || "");
      el.replaceWith(txt);
      continue;
    }

    // Strip attributes except href on <a>
    const attrs = Array.from(el.attributes || []);
    for (const a of attrs) {
      if (tag === "A" && a.name.toLowerCase() === "href") continue;
      el.removeAttribute(a.name);
    }

    if (tag === "A") {
      const href = el.getAttribute("href") || "";
      const safe = /^(https?:\/\/|mailto:)/i.test(href);
      if (!safe) {
        el.removeAttribute("href");
      } else {
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener noreferrer");
      }
    }
  }

  return tpl.innerHTML;
}

function sanitizeHtml(dirtyHtml) {
  // Prefer DOMPurify if present (recommended)
  if (typeof window.DOMPurify !== "undefined" && typeof window.DOMPurify.sanitize === "function") {
    const clean = window.DOMPurify.sanitize(dirtyHtml, { USE_PROFILES: { html: true } });
    return clean;
  }
  return sanitizeHtmlFallback(dirtyHtml);
}

/**
 * Render markdown into a container. If marked isn't loaded, falls back to plain text.
 * @param {HTMLElement} el
 * @param {string} md
 */
function renderMarkdownInto(el, md) {
  const text = md || "";
  if (!hasMarkdownRuntime()) {
    el.textContent = text;
    return;
  }

  // Suppress tables (deferred to a future Tier 3)
  const renderer = new window.marked.Renderer();
  renderer.table = () => "";
  renderer.tablerow = () => "";
  renderer.tablecell = () => "";

  const html = window.marked.parse(text, {
    gfm: true,
    breaks: false,
    headerIds: false,
    mangle: false,
    renderer
  });

  el.innerHTML = sanitizeHtml(html);

  // Ensure links open in a new tab + safe rel even if sanitizer allows attributes
  el.querySelectorAll("a[href]").forEach((a) => {
    const href = a.getAttribute("href") || "";
    const safe = /^(https?:\/\/|mailto:)/i.test(href);
    if (!safe) {
      a.removeAttribute("href");
      return;
    }
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
  });
}

function openModal(title, obj) {
  els.modalTitle.textContent = title || "Raw JSON";
  try {
    els.modalPre.textContent = JSON.stringify(obj, null, 2);
  } catch {
    els.modalPre.textContent = String(obj);
  }
  els.modalOverlay.classList.add("open");
  els.modalOverlay.setAttribute("aria-hidden", "false");
}

function closeModal() {
  els.modalOverlay.classList.remove("open");
  els.modalOverlay.setAttribute("aria-hidden", "true");
  els.modalPre.textContent = "";
}

els.modalCloseBtn?.addEventListener("click", closeModal);
els.modalOverlay?.addEventListener("click", (e) => {
  if (e.target === els.modalOverlay) closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { closeModal(); closeTopicModal(); closeTagModal(); }
});

// Topic modal wiring (Tier 2)
els.topicModalCloseBtn?.addEventListener("click", closeTopicModal);
els.topicModalOverlay?.addEventListener("click", (e) => {
  if (e.target === els.topicModalOverlay) closeTopicModal();
});
els.topicModalSaveBtn?.addEventListener("click", saveTopicModal);
els.topicModalClearBtn?.addEventListener("click", clearTopicModalSelection);

els.topicModalAddBtn?.addEventListener("click", () => {
  const name = safeStr(els.topicModalNewName?.value).trim();
  if (!name) return;
  const t = addTopic(name);
  if (els.topicModalNewName) els.topicModalNewName.value = "";
  if (t && state.topicEdit?.selected) state.topicEdit.selected.add(t.id);
  renderTopicModalList();
});

els.topicModalNewName?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    els.topicModalAddBtn?.click();
  }
});


// ---------- parsing / flattening ----------
function normalizeExport(data) {
  // Accept either:
  // - ChatGPT "conversations" array
  // - { conversations: [...] }
  // - already flattened array
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.conversations)) return data.conversations;
  if (data && Array.isArray(data.items)) return data.items;
  return [];
}

function extractTextFromMessage(msg) {
  // Common shapes:
  // msg.content.parts (array of strings)
  // msg.content.text (string)
  // msg.text (string)
  try {
    const parts = msg?.content?.parts;
    if (Array.isArray(parts)) return parts.join("\n");
    const text = msg?.content?.text;
    if (typeof text === "string") return text;
    if (typeof msg?.text === "string") return msg.text;
    // Some tool messages store content differently
    const c = msg?.content;
    if (typeof c === "string") return c;
  } catch {}
  return "";
}

function flattenChatGPTExport(data) {
  const convs = normalizeExport(data);
  const rows = [];

  for (const conv of convs) {
    const convId = conv.id || conv.conversation_id || conv.conversationId || conv.uuid || "";
    const convTitle = conv.title || conv.name || conv.conversation_title || "(untitled)";

    if (conv.mapping && typeof conv.mapping === "object") {
      const mapping = conv.mapping;
      for (const nodeId of Object.keys(mapping)) {
        const node = mapping[nodeId];
        const msg = node?.message;
        if (!msg) continue;

        const role = msg.author?.role || msg.role || "";
        const createTime = msg.create_time ?? msg.createTime ?? null;
        const text = extractTextFromMessage(msg);

        if (!text && !role) continue;

        rows.push({
          convId,
          convTitle,
          nodeId,
          msgId: msg.id || nodeId || "",
          role,
          msgTime: createTime,
          text,
          raw: { convId, convTitle, nodeId, message: msg },
        });
      }
    } else if (Array.isArray(conv.messages)) {
      for (const m of conv.messages) {
        const role = m.author?.role || m.role || "";
        const createTime = m.create_time ?? m.createTime ?? null;
        const text = extractTextFromMessage(m);
        rows.push({
          convId,
          convTitle,
          nodeId: m.id || "",
          msgId: m.id || "",
          role,
          msgTime: createTime,
          text,
          raw: { convId, convTitle, message: m },
        });
      }
    }
  }

  // Sort by conversation then time
  rows.sort((a, b) => {
    const c = safeStr(a.convTitle).localeCompare(safeStr(b.convTitle));
    if (c !== 0) return c;
    const ta = toDateObj(a.msgTime)?.getTime() || 0;
    const tb = toDateObj(b.msgTime)?.getTime() || 0;
    return ta - tb;
  });

  return rows;
}



function looksLikeClaudeExport(data) {
  const convs = normalizeExport(data);
  const first = convs?.[0];
  return !!(first && Array.isArray(first.chat_messages) && (first.uuid || first.name || first.title));
}

function extractTextFromClaudeMessage(m) {
  try {
    const blocks = m?.content;
    if (Array.isArray(blocks)) {
      const txt = blocks
        .filter(b => b && b.type === "text" && typeof b.text === "string")
        .map(b => b.text)
        .join("\n");
      if (txt.trim()) return txt;
    }
  } catch {}
  return (typeof m?.text === "string") ? m.text : "";
}

function flattenClaudeExport(data) {
  const convs = normalizeExport(data);
  const rows = [];

  for (const conv of convs) {
    const convId = conv.uuid || conv.id || conv.conversation_id || conv.conversationId || "";
    const convTitle = conv.name || conv.title || conv.conversation_title || "(untitled)";
    const msgs = Array.isArray(conv.chat_messages) ? conv.chat_messages : [];

    for (const m of msgs) {
      const sender = safeStr(m?.sender);
      const role = sender === "human" ? "user"
        : sender === "assistant" ? "assistant"
        : (sender || "other");
      const msgTime = m?.created_at || m?.updated_at || null;
      const text = extractTextFromClaudeMessage(m);
      if (!text && !role) continue;

      rows.push({
        convId,
        convTitle,
        nodeId: m?.uuid || "",
        msgId: m?.uuid || "",
        role,
        msgTime,
        text,
        raw: { convId, convTitle, message: m },
      });
    }
  }

  rows.sort((a, b) => {
    const c = safeStr(a.convTitle).localeCompare(safeStr(b.convTitle));
    if (c !== 0) return c;
    const ta = toDateObj(a.msgTime)?.getTime() || 0;
    const tb = toDateObj(b.msgTime)?.getTime() || 0;
    return ta - tb;
  });

  return rows;
}

function looksLikeGrokExport(data) {
  const convs = normalizeExport(data);
  const first = convs?.[0];
  return !!(first && first.conversation && Array.isArray(first.responses));
}

function extractMsLike(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof value === "object") {
    if ("$date" in value) return extractMsLike(value.$date);
    if ("$numberLong" in value) return extractMsLike(value.$numberLong);
    if ("value" in value) return extractMsLike(value.value);
  }
  return null;
}

function flattenGrokExport(data) {
  const convs = normalizeExport(data);
  const rows = [];

  for (const item of convs) {
    const conv = item?.conversation || {};
    const convId = conv.conversationId || conv.conversation_id || conv.id || item?.conversationId || item?.conversation_id || item?.id || item?.uuid || "";
    const convTitle = conv.title || item?.title || "(untitled)";
    const responses = Array.isArray(item?.responses) ? item.responses : [];

    for (const entry of responses) {
      // Grok export responses are usually wrapped as { response: {...}, share_link: ... }
      const r = entry?.response || entry || {};

      const sender = safeStr(r?.sender).toLowerCase();
      const role = sender === "human" || sender === "user" ? "user"
        : sender === "assistant" ? "assistant"
        : (sender || "other");

      const msgTime =
        extractMsLike(r?.createTime) ??
        extractMsLike(r?.create_time) ??
        extractMsLike(r?.thinking_start_time) ??
        extractMsLike(r?.thinking_end_time) ??
        null;

      const text = safeStr(r?.message || r?.text || "");
      if (!text && !role) continue;

      rows.push({
        convId,
        convTitle,
        nodeId: safeStr(r?._id || r?.messageId || r?.id || ""),
        msgId: safeStr(r?._id || r?.messageId || r?.id || ""),
        role,
        msgTime,
        text,
        raw: { convId, convTitle, response: r, responseEntry: entry, conversation: conv },
      });
    }
  }

  rows.sort((a, b) => {
    const c = safeStr(a.convTitle).localeCompare(safeStr(b.convTitle));
    if (c !== 0) return c;
    const ta = toDateObj(a.msgTime)?.getTime() || 0;
    const tb = toDateObj(b.msgTime)?.getTime() || 0;
    return ta - tb;
  });

  return rows;
}

function looksLikeGeminiExport(data) {
  return Array.isArray(data) && data.some(x => {
    const header = safeStr(x?.header).toLowerCase();
    const products = Array.isArray(x?.products) ? x.products.map(p => safeStr(p).toLowerCase()) : [];
    return header.includes("gemini") || products.includes("gemini apps");
  });
}

function decodeHtmlToText(html) {
  const raw = safeStr(html);
  if (!raw) return "";
  const div = document.createElement("div");
  div.innerHTML = raw;
  return safeStr(div.textContent || div.innerText || "").trim();
}

function flattenGeminiExport(data) {
  const SESSION_WINDOW_MS = 30 * 60 * 1000; // 30 minutes
  const items = (Array.isArray(data) ? data : []).slice();
  const rows = [];

  items.sort((a, b) => {
    const ta = toDateObj(a?.time)?.getTime() || 0;
    const tb = toDateObj(b?.time)?.getTime() || 0;
    return ta - tb;
  });

  let sessionIndex = 0;
  let prevTs = null;
  let currentConvId = null;
  let currentConvTitle = "(untitled)";
  let turnInSession = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i] || {};
    const dt = toDateObj(item.time);
    const ts = dt?.getTime() || null;

    const rawTitle = safeStr(item.title || "").trim();
    const userText = rawTitle.replace(/^Prompted\s*/i, "").trim() || rawTitle || "(no text)";
    const nextTitle = truncateText(userText.replace(/\s+/g, " ").trim(), 80).short || "(untitled)";

    const startNewSession = (
      currentConvId === null ||
      prevTs === null ||
      ts === null ||
      Math.abs(ts - prevTs) > SESSION_WINDOW_MS
    );

    if (startNewSession) {
      sessionIndex += 1;
      turnInSession = 0;
      const stamp = dt ? fmtDateTime(dt).replace(/[\s:]/g, "-") : `session-${sessionIndex}`;
      currentConvId = `gemini-session-${stamp}-${sessionIndex}`;
      currentConvTitle = nextTitle;
    }

    turnInSession += 1;
    const pairKey = `${currentConvId}-t${String(turnInSession).padStart(3, "0")}`;

    rows.push({
      convId: currentConvId,
      convTitle: currentConvTitle,
      nodeId: `${pairKey}-u`,
      msgId: `${pairKey}-u`,
      role: "user",
      msgTime: item.time || null,
      text: userText,
      raw: { convId: currentConvId, convTitle: currentConvTitle, activity: item, side: "user" },
    });

    const htmlBlocks = Array.isArray(item.safeHtmlItem) ? item.safeHtmlItem : [];
    const asstText = htmlBlocks
      .map(b => decodeHtmlToText(b?.html || ""))
      .filter(Boolean)
      .join("\n\n")
      .trim();

    if (asstText) {
      rows.push({
        convId: currentConvId,
        convTitle: currentConvTitle,
        nodeId: `${pairKey}-a`,
        msgId: `${pairKey}-a`,
        role: "assistant",
        msgTime: item.time || null,
        text: asstText,
        raw: { convId: currentConvId, convTitle: currentConvTitle, activity: item, side: "assistant" },
      });
    }

    prevTs = ts;
  }

  rows.sort((a, b) => {
    const ta = toDateObj(a.msgTime)?.getTime() || 0;
    const tb = toDateObj(b.msgTime)?.getTime() || 0;
    if (ta !== tb) return ta - tb;
    return safeStr(a.msgId).localeCompare(safeStr(b.msgId));
  });

  return rows;
}

function detectProvider(data) {
  if (looksLikeClaudeExport(data)) return "anthropic";
  if (looksLikeGrokExport(data)) return "grok";
  if (looksLikeGeminiExport(data)) return "gemini";
  return "openai";
}

function namespacedConvId(provider, convId) {
  const p = safeStr(provider).trim().toLowerCase() || "unknown";
  const id = safeStr(convId).trim() || "unknown";
  return `${p}::${id}`;
}

function applyProviderPrefixToRows(rows, provider) {
  const p = safeStr(provider).trim().toLowerCase() || "unknown";
  return (Array.isArray(rows) ? rows : []).map(r => {
    const oldId = safeStr(r?.convId);
    const newId = oldId.startsWith(`${p}::`) ? oldId : namespacedConvId(p, oldId);
    return {
      ...r,
      convId: newId,
      raw: (r?.raw && typeof r.raw === "object") ? { ...r.raw, convId: newId } : r.raw,
    };
  });
}

function flattenAnyExport(data) {
  const provider = detectProvider(data);
  if (provider === "anthropic") return flattenClaudeExport(data);
  if (provider === "grok") return flattenGrokExport(data);
  if (provider === "gemini") return flattenGeminiExport(data);
  return flattenChatGPTExport(data);
}

function getProviderFromConvId(convId) {
  const s = safeStr(convId).trim();
  const m = s.match(/^([^:]+)::/);
  return m ? m[1].toLowerCase() : "unknown";
}

function providerLabel(provider) {
  const p = safeStr(provider).toLowerCase();
  if (p === "openai") return "OpenAI";
  if (p === "anthropic") return "Claude";
  if (p === "grok") return "Grok";
  if (p === "gemini") return "Gemini";
  return provider || "Unknown";
}

function getAvailableProvidersFromIndex(convIndex) {
  const counts = new Map();
  for (const entry of convIndex.values()) {
    const provider = getProviderFromConvId(entry.convId);
    counts.set(provider, (counts.get(provider) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([provider, count]) => ({ provider, count }))
    .sort((a, b) => providerLabel(a.provider).localeCompare(providerLabel(b.provider)));
}

function syncProviderFiltersWithData() {
  const available = getAvailableProvidersFromIndex(state.convIndex).map(x => x.provider);
  const next = new Set();

  for (const p of available) {
    if (!state.providerFilterSeen.has(p)) {
      next.add(p); // new providers default to checked
      state.providerFilterSeen.add(p);
    } else if (state.providerFilters.size === 0 || state.providerFilters.has(p)) {
      next.add(p);
    }
  }

  if (state.providerFilters.size === 0 && state.providerFilterSeen.size === 0) {
    available.forEach(p => {
      next.add(p);
      state.providerFilterSeen.add(p);
    });
  }

  state.providerFilters = next;
}

function ensureProviderFilterUI() {
  if (els.providerFilterWrap) return els.providerFilterWrap;
  const anchor = els.applyFilterBtn?.parentElement || els.applyFilterBtn || els.clearFilterBtn;
  if (!anchor || !anchor.parentNode) return null;

  const wrap = document.createElement("div");
  wrap.id = "providerFilterWrap";
  wrap.className = "providerFilterWrap";
  wrap.style.margin = "8px 0 10px 0";

  const title = document.createElement("div");
  title.className = "small";
  title.textContent = "Platforms";
  title.style.marginBottom = "6px";
  wrap.appendChild(title);

  const list = document.createElement("div");
  list.className = "providerFilterList";
  list.style.display = "grid";
  list.style.gap = "4px";
  wrap.appendChild(list);

  anchor.parentNode.insertBefore(wrap, anchor);
  els.providerFilterWrap = wrap;
  return wrap;
}

function renderProviderFilters() {
  const wrap = ensureProviderFilterUI();
  if (!wrap) return;
  const list = wrap.querySelector(".providerFilterList");
  if (!list) return;
  list.innerHTML = "";

  const available = getAvailableProvidersFromIndex(state.convIndex);
  if (!available.length) {
    wrap.style.display = "none";
    return;
  }

  wrap.style.display = "";
  syncProviderFiltersWithData();

  for (const item of available) {
    const row = document.createElement("label");
    row.className = "providerFilterItem";
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.gap = "6px";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = state.providerFilters.has(item.provider);
    cb.addEventListener("change", () => {
      if (cb.checked) state.providerFilters.add(item.provider);
      else state.providerFilters.delete(item.provider);
      renderAll();
    });

    const span = document.createElement("span");
    span.textContent = `${providerLabel(item.provider)} ${item.count}`;

    row.appendChild(cb);
    row.appendChild(span);
    list.appendChild(row);
  }
}

// ---------- filtering ----------
function applyMessageFilters(rows) {
  const q = safeStr(els.searchInput?.value).trim().toLowerCase();
  const role = "";
  const from = els.fromDate.value ? new Date(els.fromDate.value + "T00:00:00") : null;
  const to = els.toDate.value ? new Date(els.toDate.value + "T23:59:59") : null;

    // topic/tags present but intentionally ignored in SAFE MODE
  return rows.filter(r => {
    const dt = toDateObj(r.msgTime);

    // If a date window is active, exclude rows with unknown timestamps.
    // This prevents conversations outside the window from lingering with blank dates.
    if ((from || to) && !dt) return false;

    if (from && dt < from) return false;
    if (to && dt > to) return false;

    if (q) {
      const hay = [r.convTitle, r.msgId, r.role, r.text].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }

    return true;
  });
}

// ---------- conversation indexing ----------
function buildConversationIndex(rows) {
  const map = new Map();

  for (const r of rows) {
    const key = r.convId || r.convTitle || "(unknown)";
    if (!map.has(key)) {
      map.set(key, { convId: key, title: r.convTitle || "(untitled)", msgs: [], firstTime: null, lastTime: null });
    }
    const entry = map.get(key);
    entry.msgs.push(r);

    const dt = toDateObj(r.msgTime);
    if (dt) {
      if (!entry.firstTime || dt < entry.firstTime) entry.firstTime = dt;
      if (!entry.lastTime || dt > entry.lastTime) entry.lastTime = dt;
    }
  }

  // Ensure message order within conversation
  for (const entry of map.values()) {
    entry.msgs.sort((a, b) => (toDateObj(a.msgTime)?.getTime() || 0) - (toDateObj(b.msgTime)?.getTime() || 0));
  }
  return map;
}

function summarizeConversations(convIndex) {
  const list = [];
  for (const entry of convIndex.values()) {
    const { turns } = toTurns(entry.msgs);
    list.push({
      convId: entry.convId,
      title: entry.title,
      firstTime: entry.firstTime,
      lastTime: entry.lastTime,
      turnCount: turns.length,
      msgCount: entry.msgs.length,
    });
  }
  // Sort by most recent activity first
  list.sort((a, b) => (b.lastTime?.getTime() || 0) - (a.lastTime?.getTime() || 0));
  return list;
}


// ---------- turn consolidation ----------
function toTurns(msgs) {
  const turns = [];
  const preamble = [];

  let current = null;

  for (const m of msgs) {
    const role = safeStr(m.role);

    if (role === "user") {
      // If the current turn has no assistant response yet, treat consecutive user messages as one prompt.
      if (current && current.assistant.length === 0) {
        current.user.push(m);
      } else {
        current = {
          user: [m],
          assistant: [],
          system: [],
          tool: [],
          other: [],
        };
        turns.push(current);
      }
      continue;
    }

    if (!current) {
      // before first user message
      preamble.push(m);
      continue;
    }

    if (role === "assistant") current.assistant.push(m);
    else if (role === "system") current.system.push(m);
    else if (role === "tool") current.tool.push(m);
    else current.other.push(m);
  }

  return { preamble, turns };
}

function joinTexts(msgArr) {
  return msgArr.map(m => safeStr(m.text)).filter(Boolean).join("\n\n").trim();
}

function rangeTimeForMsgs(msgArr) {
  let min = null, max = null;
  for (const m of msgArr) {
    const d = toDateObj(m.msgTime);
    if (!d) continue;
    if (!min || d < min) min = d;
    if (!max || d > max) max = d;
  }
  return { min, max };
}

async function tagConversationOnServer(convId, uiCtx = {}) {
  const exportJson = state.rawData;
  if (!exportJson) {
    throw new Error("No export JSON loaded. Load an export file first.");
  }

  if (typeof setStatus === "function") {
    setStatus(`Tagging "${uiCtx.title || convId}"...`);
  }

  const resp = await fetch("http://localhost:3000/api/tag_export_conversation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      export: exportJson,          // ✅ send in-memory export
      conversation_id: safeStr(convId).replace(/^[a-z0-9_-]+::/i, ""),
      turn_start: 0,
      turn_end: 999999,

      options: { model: "gpt-4.1-mini", max_output_tokens: 250 },
      limits: { max_turns_per_request: 200 },

      persist: {
        write_tags_json: false,
        include_tags_json: true,
        base_tags_json: {
          version: state.tags?.version ?? 1,
          tags: state.tags?.tags ?? [],
          assignments: state.tags?.assignments ?? {},
          axes_meta: state.tags?.axes_meta ?? undefined,
          axis_assignments: state.tags?.axis_assignments ?? {}
        }
      }
    })
  });

console.log("[TagAssist] response", { ok: resp.ok, status: resp.status, hasTagsJson: !!data.tags_json, keys: Object.keys(data || {}) });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data?.error || `HTTP ${resp.status}`);

  if (data.tags_json) {
    ingestTags(data.tags_json, "TagAssist");
    renderAll();
  }

  const turns = data.tagged_turns ?? 0;
  const tokens = data.usage_total?.total_tokens ?? 0;

  if (typeof setStatus === "function") {
    setStatus(`Tagged "${uiCtx.title || convId}": ${turns} turn(s) • ${tokens} tokens. Export tags.json to save.`);
  }
}

// ---------- rendering: conversations ----------
function renderConversationList() {
  els.convList.innerHTML = "";

  if (state.convList.length === 0) {
    const empty = document.createElement("div");
    empty.className = "small";
    empty.textContent = "No conversations match the current filters.";
    els.convList.appendChild(empty);
    els.convMeta.textContent = "0";
    return;
  }

  const frag = document.createDocumentFragment();
  state.convList.forEach((c) => {
    const item = document.createElement("div");
    item.className = "convItem" + (c.convId === state.selectedConvId ? " active" : "");

    // Line 1: title
    const title = document.createElement("div");
    title.className = "convTitle";
    title.textContent = c.title || "(untitled)";

    // Line 2: platform (left) · turn count (right)
    const line2 = document.createElement("div");
    line2.className = "convLine2";

    const provSpan = document.createElement("span");
    provSpan.textContent = providerLabel(getProviderFromConvId(c.convId));

    const turnSpan = document.createElement("span");
    turnSpan.textContent = c.turnCount === 1 ? "1 turn" : `${c.turnCount} turns`;

    line2.appendChild(provSpan);
    line2.appendChild(turnSpan);

    // Line 3: date range
    const line3 = document.createElement("div");
    line3.className = "convLine3";
    line3.textContent = `${fmtDate(c.firstTime)} → ${fmtDate(c.lastTime)}`;

    // Line 4: topic names or "no topic assigned"
    const topicNames = getTopicNamesForConv(c.convId);
    const line4 = document.createElement("div");
    line4.className = "convLine4";
    line4.textContent = topicNames.length
      ? topicNames.join(", ")
      : "no topic assigned";

    // Line 5: Topics button (+ TagAssist if dev)
    const line5 = document.createElement("div");
    line5.className = "convLine5";

    const tbtn = document.createElement("button");
    tbtn.className = "convTileBtn";
    tbtn.textContent = "Topics";
    tbtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openTopicModal(c.convId);
    });
    line5.appendChild(tbtn);

    if (ENABLE_TAG_ASSIST) {
      const abtn = document.createElement("button");
      abtn.className = "convTileBtn";
      abtn.textContent = "TagAssist";
      abtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        await tagConversationOnServer(c.convId, { title: c.title });
      });
      line5.appendChild(abtn);
    }

    item.appendChild(title);
    item.appendChild(line2);
    item.appendChild(line3);
    item.appendChild(line4);
    item.appendChild(line5);
	
    item.addEventListener("click", () => {
      state.selectedConvId = c.convId;
      renderAll();
    });

    frag.appendChild(item);
  });

  els.convList.appendChild(frag);
  els.convMeta.textContent = `${state.convList.length} shown`;
}


// ---------- rendering: user messages (middle) ----------
function renderUserMessagesPane() {
  if (!els.promptList) return;
  els.promptList.innerHTML = "";

  if (!state.selectedConvId || !state.convIndex.has(state.selectedConvId)) {
    els.promptMeta && (els.promptMeta.textContent = "—");
    const empty = document.createElement("div");
    empty.className = "small";
    empty.textContent = "Select a conversation to view its user messages.";
    els.promptList.appendChild(empty);
    return;
  }

  const entry = state.convIndex.get(state.selectedConvId);
  const { turns } = toTurns(entry.msgs);

  els.promptMeta && (els.promptMeta.textContent = turns.length === 1 ? "1 turn" : `${turns.length} turns`);

  if (!turns.length) {
    const empty = document.createElement("div");
    empty.className = "small";
    empty.textContent = "No user messages found in this conversation.";
    els.promptList.appendChild(empty);
    return;
  }

  const frag = document.createDocumentFragment();

  turns.forEach((turn, ix) => {
    const userText = joinTexts(turn.user) || "(no text)";
    const d = rangeTimeForMsgs(turn.user).min;
    const dateStr = d ? fmtDate(d) : "—";
    const trunc = truncateText(userText.replace(/\s+/g, " ").trim(), 150);

    const item = document.createElement("div");
    item.className = "promptItem";
    item.setAttribute("role", "button");
    item.setAttribute("tabindex", "0");

    const msg = document.createElement("div");
    msg.className = "promptText";
    msg.textContent = trunc.short;

    const meta = document.createElement("div");
    meta.className = "promptMeta";
    meta.textContent = dateStr;

    item.appendChild(msg);
    item.appendChild(meta);

    const go = () => {
      const target = els.turnsPane?.querySelector(`#turn-${ix}`);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    item.addEventListener("click", go);
    item.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); }
    });

    frag.appendChild(item);
  });

  els.promptList.appendChild(frag);
}


function renderTurnMetaBar(convId, turnIx) {
  const ax = getTurnAxis(convId, turnIx);
  const cls = ax?.class || [];
  const intent = ax?.intent || [];

  const tags = getTurnTags(convId, turnIx);

  const clsTxt = cls.length ? cls.join(", ") : "—";
  const intentTxt = intent.length ? intent.join(", ") : "—";
  const tagsTxt = tags.length ? tags.map(tagNameById).join(", ") : "—";

  const wrap = document.createElement("div");
  wrap.className = "turnTags";
  wrap.textContent = `Class: ${clsTxt} • Intent: ${intentTxt} • Tags: ${tagsTxt}`;

  if ((!cls.length && !intent.length) && (!tags.length)) {
    wrap.classList.add("muted");
  }
  return wrap;
}


// ---------- rendering: turns ----------

function renderTurnsPane() {
  els.turnsPane.innerHTML = "";

  if (!state.selectedConvId || !state.convIndex.has(state.selectedConvId)) {
    els.turnsTitle.textContent = "No conversation selected";
    els.turnsMeta.textContent = "Load a JSON export to begin.";
    return;
  }

  const entry = state.convIndex.get(state.selectedConvId);
  const { preamble, turns } = toTurns(entry.msgs);
  const showTimes = !!state.showTimes;

  const basePreviewN = clamp(Number(els.truncateInput?.value || 220), 20, 2000);
  const previewN = state.allExpanded ? 999999 : basePreviewN;

  els.turnsTitle.textContent = entry.title || "(untitled)";
  els.turnsMeta.textContent = `${fmtDate(entry.firstTime)} → ${fmtDate(entry.lastTime)} • ${turns.length} turns • ${entry.msgs.length} messages`;

  const frag = document.createDocumentFragment();

  // Optional preamble
  if (preamble.length) {
    const card = document.createElement("div");
    card.className = "turnCard";

    const row = document.createElement("div");
    row.className = "turnRow";

    const left = document.createElement("div");
    left.className = "turnLeft";

    const pill = document.createElement("div");
    pill.className = "rolePill";
    pill.textContent = "Preamble";
    left.appendChild(pill);

    const msg = renderMsgBlock(preamble, showTimes, previewN, "Preamble (raw messages)", {}, left);

    row.appendChild(left);
    row.appendChild(msg);
    card.appendChild(row);
    frag.appendChild(card);
  }

  turns.forEach((turn, ix) => {
    const card = document.createElement("div");
    card.className = "turnCard";
    card.id = `turn-${ix}`;

    // User row
    const userRow = document.createElement("div");
    userRow.className = "turnRow";

    const userLeft = document.createElement("div");
    userLeft.className = "turnLeft";

    const userPill = document.createElement("div");
    userPill.className = "rolePill user";
    userPill.textContent = "User";
    userLeft.appendChild(userPill);

    // Tag editor (per-turn)
    const tagBtn = document.createElement("button");
    tagBtn.className = "tertiary";
    tagBtn.textContent = "Tags";
    tagBtn.addEventListener("click", () => {
      state.selectedTurnIx = ix;
      openTagModal(state.selectedConvId, ix);
    });
    userLeft.appendChild(tagBtn);

    const userMsg = renderMsgBlock(turn.user, showTimes, previewN, `Turn ${ix + 1} • User (raw)`, { turn }, userLeft);

    // Tags summary line
    userMsg.insertBefore(renderTurnMetaBar(state.selectedConvId, ix), userMsg.firstChild);

    userRow.appendChild(userLeft);
    userRow.appendChild(userMsg);

    // Assistant row
    const asstRow = document.createElement("div");
    asstRow.className = "turnRow";

    const asstLeft = document.createElement("div");
    asstLeft.className = "turnLeft";

    const asstPill = document.createElement("div");
    asstPill.className = "rolePill assistant";
    asstPill.textContent = "Assistant";
    asstLeft.appendChild(asstPill);

    const asstMsgs = (turn.assistant.length ? turn.assistant : [...turn.system, ...turn.tool, ...turn.other]);
    const asstLabel = turn.assistant.length ? `Turn ${ix + 1} • Assistant (raw)` : `Turn ${ix + 1} • (No assistant text) (raw)`;

    const asstMsg = renderMsgBlock(asstMsgs, showTimes, previewN, asstLabel, { includeNonAssistant: true, turn }, asstLeft);

    asstRow.appendChild(asstLeft);
    asstRow.appendChild(asstMsg);

    card.appendChild(userRow);
    card.appendChild(asstRow);
    frag.appendChild(card);
  });

  els.turnsPane.appendChild(frag);

  if (els.toggleAllBtn) {
    els.toggleAllBtn.textContent = state.allExpanded ? "Collapse all" : "Expand all";
  }
}

function renderMsgBlock(msgArr, showTimes, previewN, rawTitle, opts = {}, leftCol = null) {
  const msg = document.createElement("div");
  msg.className = "msg";

  const joined = joinTexts(msgArr);
  const displayText = joined || "(no text)";
  const t = truncateText(displayText, previewN);

  const txt = document.createElement("div");
  txt.className = "msgText";

  // Default to short view for performance and vertical density
  renderMarkdownInto(txt, t.short);
  msg.appendChild(txt);

  const metaRow = document.createElement("div");
  metaRow.className = "msgMetaRow";

  const time = document.createElement("div");
  time.className = "time";
  if (showTimes) {
    const rng = rangeTimeForMsgs(msgArr);
    if (rng.min) {
      time.textContent = (rng.max && rng.max.getTime() !== rng.min.getTime())
        ? `${fmtDateTime(rng.min)} → ${fmtDateTime(rng.max)}`
        : `${fmtDateTime(rng.min)}`;
    } else {
      time.textContent = "";
    }
  } else {
    time.textContent = "";
  }
  metaRow.appendChild(time);

  const rawBtn = document.createElement("button");
  rawBtn.className = "tertiary";
  rawBtn.textContent = "View raw";
  rawBtn.addEventListener("click", () => {
    if (opts.turn) {
      const payload = {
        user: opts.turn.user.map(m => m.raw),
        assistant: opts.turn.assistant.map(m => m.raw),
        system: opts.turn.system.map(m => m.raw),
        tool: opts.turn.tool.map(m => m.raw),
        other: opts.turn.other.map(m => m.raw),
      };
      openModal(rawTitle || "Turn (raw)", payload);
    } else {
      openModal(rawTitle || "Messages (raw)", msgArr.map(m => m.raw));
    }
  });

  // Put "View raw" under the role pill when requested
  if (leftCol) {
    leftCol.appendChild(rawBtn);
  } else {
    metaRow.appendChild(rawBtn);
  }

  msg.appendChild(metaRow);

  // Optional hint when assistant is empty but non-assistant exists
  if (opts.includeNonAssistant && opts.turn && opts.turn.assistant.length === 0) {
    const hint = document.createElement("div");
    hint.className = "small";
    const counts = [];
    if (opts.turn.system.length) counts.push(`${opts.turn.system.length} system`);
    if (opts.turn.tool.length) counts.push(`${opts.turn.tool.length} tool`);
    if (opts.turn.other.length) counts.push(`${opts.turn.other.length} other`);
    hint.textContent = counts.length
      ? `No assistant text; this turn contains ${counts.join(", ")} message(s).`
      : "No assistant text in this turn.";
    msg.appendChild(hint);
  }

  // Expander (placed under role pill when requested)
  if (t.truncated) {
    const more = document.createElement("button");
    more.className = "tertiary";
    more.textContent = "Show more";
    let expanded = false;

    more.addEventListener("click", () => {
      expanded = !expanded;
      if (expanded) {
        more.textContent = "Show less";
        renderMarkdownInto(txt, displayText);
      } else {
        more.textContent = "Show more";
        renderMarkdownInto(txt, t.short);
      }
    });

    if (leftCol) {
      leftCol.appendChild(more);
    } else {
      const exp = document.createElement("div");
      exp.className = "expander";
      exp.appendChild(more);
      msg.appendChild(exp);
    }
  }

  return msg;
}


// ---------- render orchestrator ----------
function renderAll() {
  // build conversations list with conversation-title search filter
  const q = safeStr(els.convSearch.value).trim().toLowerCase();
  const convs = summarizeConversations(state.convIndex);

  const filteredByTitle = q
    ? convs.filter(c => safeStr(c.title).toLowerCase().includes(q))
    : convs;

  const activeProviders = state.providerFilters;
  const filteredByProvider = activeProviders.size
    ? filteredByTitle.filter(c => activeProviders.has(getProviderFromConvId(c.convId)))
    : filteredByTitle;

  // Topic filter (conversation-level sidecar)
  const selectedTopic = safeStr(els.topicSelect?.value).trim();
  const filteredTopic = selectedTopic
    ? filteredByProvider.filter(c => convMatchesTopic(c.convId, selectedTopic))
    : filteredByProvider;

    // Tag filter (turn-level sidecar)
  const requiredTags = parseTagFilterInput();
  const filteredTags = requiredTags.length
    ? (selectedTopic ? filteredTopic : filteredByProvider).filter(c => convMatchesTags(c.convId, requiredTags))
    : (selectedTopic ? filteredTopic : filteredByProvider);

  state.convList = filteredTags;
  renderProviderFilters();

  // Choose default conversation if none selected or missing
  if (!state.selectedConvId || !state.convIndex.has(state.selectedConvId)) {
    state.selectedConvId = state.convList[0]?.convId || null;
  }

  renderConversationList();
  renderUserMessagesPane();
  renderTurnsPane();
}

// ---------- data load ----------
async function loadFromFile(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  ingestData(data, file.name);
}

async function loadDefault() {
  // Conversation samples (existing behavior)
  const convCandidates = [
    "./sample.json",
    "./data/sample.json",
    "./export.json",
    "./data/export.json"
  ];

  let lastErr = null;
  let loadedSource = null;

  for (const url of convCandidates) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;

      const data = await res.json();
      ingestData(data, url);
      loadedSource = url;
      break;
    } catch (e) {
      lastErr = e;
    }
  }

  if (!loadedSource) {
    openModal("Sample not found", {
      tried: convCandidates,
      error: String(lastErr || "No sample file found.")
    });
    return;
  }

  // --- NEW: attempt to load sampletopics.json (optional) ---
  const topicCandidates = [
    "./sampletopics.json",
    "./data/sampletopics.json"
  ];

  for (const url of topicCandidates) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;

      const topicsData = await res.json();
      ingestTopics(topicsData, url);

      // Re-render now that topics exist
      if (state.convIndex && state.convIndex.size) {
        renderAll();
      }
      break; // stop after first successful topics load
    } catch {
      // silent fail — topics are optional
    }
  }

  // --- NEW: attempt to load sampletags.json (optional) ---
  const tagCandidates = [
    "./sampletags.json",
    "./data/sampletags.json"
  ];

  for (const url of tagCandidates) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;

      const tagsData = await res.json();
      ingestTags(tagsData, url);

      // Re-render now that tags exist
      if (state.convIndex && state.convIndex.size) {
        renderAll();
      }
      break; // stop after first successful tags load
    } catch {
      // silent fail — tags are optional
    }
  }
}



function ingestRows(rows, sourceLabel, rawDataForAssist = null) {
  state.rawData = rawDataForAssist;
  state.rowsAll = Array.isArray(rows) ? rows : [];
  state.rowsFiltered = applyMessageFilters(state.rowsAll);
  state.convIndex = buildConversationIndex(state.rowsFiltered);

  const convCount = state.convIndex.size;
  const msgCount = state.rowsFiltered.length;

  els.status.textContent = `Loaded ${convCount} conversation(s), ${msgCount} message(s).`;
  const topicNote = state.topics?.loaded
    ? (state.topics.source ? ` • Topics: ${state.topics.source}` : " • Topics: (loaded)")
    : " • Topics: (not loaded — use \"Load topics\")";
  els.jsonMeta.textContent = `Source: ${sourceLabel || "JSON"} • Rendering turns (SAFE MODE).${topicNote}`;

  state.selectedConvId = null;
  syncProviderFiltersWithData();
  renderAll();
}

function ingestData(data, sourceLabel) {
  const provider = detectProvider(data);
  const rows = applyProviderPrefixToRows(flattenAnyExport(data), provider);
  const rawDataForAssist = provider === "openai" ? data : null;
  ingestRows(rows, sourceLabel, rawDataForAssist);
}

function clearAll() {
  state.rawData = null;
  state.showTimes = false;
  state.rowsAll = [];
  state.rowsFiltered = [];
  state.convIndex = new Map();
  state.convList = [];
  state.selectedConvId = null;
  state.providerFilters = new Set();
  state.providerFilterSeen = new Set();
  state.providerFilters = new Set();

  els.status.textContent = "No data loaded.";
  els.jsonMeta.textContent = "";
  els.convMeta.textContent = "—";
  els.convList.innerHTML = "";
  els.turnsTitle.textContent = "No conversation selected";
  els.turnsMeta.textContent = "Load a JSON export to begin.";
  els.turnsPane.innerHTML = "";
  if (els.promptList) els.promptList.innerHTML = "";
  if (els.promptMeta) els.promptMeta.textContent = "—";
  renderProviderFilters();
}


function updateShowTimesBtn() {
  if (!els.showTimesBtn) return;
  els.showTimesBtn.textContent = state.showTimes ? "Timestamps: On" : "Timestamps: Off";
  els.showTimesBtn.classList.toggle("primary", !!state.showTimes);
}

// ---------- wiring ----------
/**
 * Bundle-load support (Option 1): allow selecting conversations.json + topics.json + tags.json
 * in a single file picker action (multi-select).
 *
 * Security note: browsers do not allow enumerating sibling files in the same folder; users must
 * explicitly select the files they want to load.
 */
async function loadBundleFromFiles(fileList) {
  const files = Array.from(fileList || []).filter(Boolean);
  if (!files.length) return;

  const byLowerName = new Map(files.map(f => [safeStr(f.name).toLowerCase(), f]));
  const topicsFile = byLowerName.get("topics.json") || files.find(f => /topics\.json$/i.test(safeStr(f.name)));
  const tagsFile = byLowerName.get("tags.json") || files.find(f => /tags\.json$/i.test(safeStr(f.name)));
  const candidates = files.filter(f => f !== topicsFile && f !== tagsFile);

  async function readJsonFile(file) {
    const text = await file.text();
    return JSON.parse(text);
  }

  const payloads = [];
  for (const f of candidates) {
    try {
      const data = await readJsonFile(f);
      const provider = detectProvider(data);
      payloads.push({ file: f, data, provider });
    } catch (err) {
      console.warn("Failed to parse JSON file:", f?.name, err);
    }
  }

  if (!payloads.length) {
    if (topicsFile) {
      try { ingestTopics(await readJsonFile(topicsFile), topicsFile.name || "topics.json"); }
      catch (err) { openModal("Topics load error", { error: String(err) }); }
    }
    if (tagsFile) {
      try {
        ingestTags(await readJsonFile(tagsFile), tagsFile.name || "tags.json");
        if (state.convIndex && state.convIndex.size) renderAll();
      } catch (err) { openModal("Tags load error", { error: String(err) }); }
    }
    const topicNote = state.topics?.loaded
      ? (state.topics.source ? `Topics: ${state.topics.source}` : "Topics: (loaded)")
      : "Topics: (not loaded)";
    const tagNote = state.tags?.loaded ? `Tags: ${state.tags.tags?.length || 0} loaded` : "Tags: (not loaded)";
    els.status.textContent = "No conversations file selected.";
    els.jsonMeta.textContent = `${topicNote} • ${tagNote}`;
    return;
  }

  const providers = new Set(payloads.map(p => p.provider));

  let mergedRows = [];
  const unrecognizedFiles = [];
  for (const p of payloads) {
    const rows = flattenAnyExport(p.data);
    if (rows.length === 0) {
      unrecognizedFiles.push(safeStr(p.file?.name));
    }
    mergedRows = mergedRows.concat(applyProviderPrefixToRows(rows, p.provider));
  }

  if (unrecognizedFiles.length && mergedRows.length === 0) {
    const names = unrecognizedFiles.join(", ");
    els.status.textContent = "No conversations found.";
    openModal("Unrecognized file format", {
      message: `The selected file(s) don't appear to contain conversation exports from a supported platform (ChatGPT, Claude, Gemini, or Grok).`,
      files: names,
      hint: "Make sure you're loading the JSON export file from your chat platform, not another type of JSON file."
    });
    return;
  }

  if (unrecognizedFiles.length) {
    console.warn("Some files produced no conversations:", unrecognizedFiles.join(", "));
  }

  mergedRows.sort((a, b) => {
    const c = safeStr(a.convTitle).localeCompare(safeStr(b.convTitle));
    if (c !== 0) return c;
    const ta = toDateObj(a.msgTime)?.getTime() || 0;
    const tb = toDateObj(b.msgTime)?.getTime() || 0;
    return ta - tb;
  });

  let rawDataForAssist = null;
  if (providers.size === 1 && providers.has("openai")) {
    const mergedConvs = [];
    for (const p of payloads) {
      const arr = normalizeExport(p.data);
      if (Array.isArray(arr) && arr.length) mergedConvs.push(...arr);
    }
    rawDataForAssist = mergedConvs.length ? mergedConvs : null;
  }

  const label = providers.size > 1
    ? `Merged ${payloads.length} file(s) (${Array.from(providers).join(" + ")})`
    : (payloads.length > 1 ? `Merged ${payloads.length} file(s)` : (payloads[0]?.file?.name || "JSON"));

  ingestRows(mergedRows, label, rawDataForAssist);

  if (topicsFile) {
    try { ingestTopics(await readJsonFile(topicsFile), topicsFile.name || "topics.json"); }
    catch (err) { openModal("Topics load error", { error: String(err) }); }
  }
  if (tagsFile) {
    try {
      ingestTags(await readJsonFile(tagsFile), tagsFile.name || "tags.json");
      if (state.convIndex && state.convIndex.size) renderAll();
    } catch (err) { openModal("Tags load error", { error: String(err) }); }
  }
}

els.fileInput?.addEventListener("change", async (e) => {
  try {
    const files = e.target.files;
    if (!files || !files.length) return;
    await loadBundleFromFiles(files);
    e.target.value = "";
  } catch (err) {
    openModal("Load error", { error: String(err) });
  }
});


// Topics: load from file (Tier 2)
els.loadTopicsBtn?.addEventListener("click", () => {
  els.topicsFileInput?.click();
});

els.topicsFileInput?.addEventListener("change", async (e) => {
  try {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const data = JSON.parse(text);
    ingestTopics(data, file.name || "topics.json");
    e.target.value = "";
  } catch (err) {
    openModal("Topics load error", { error: String(err) });
  }
});

function exportTopicsJson() {
  const payload = {
    version: state.topics.version || 1,
    topics: state.topics.catalog.map(t => ({
      id: t.id,
      name: t.name,
      ...(t.color ? { color: t.color } : {}),
      ...(Number.isFinite(t.order) ? { order: t.order } : {}),
    })),
    assignments: state.topics.assignments || {},
  };

  const text = JSON.stringify(payload, null, 2);
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "topics.json";
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 500);
}

els.exportTopicsBtn?.addEventListener("click", exportTopicsJson);


// Tags: load from file (local-only)
els.loadTagsBtn?.addEventListener("click", () => {
  els.tagsFileInput?.click();
});

els.tagsFileInput?.addEventListener("change", async (e) => {
  try {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const data = JSON.parse(text);
    ingestTags(data, file.name || "tags.json");
    e.target.value = "";
    renderAll();
  } catch (err) {
    openModal("Tags load error", { error: String(err) });
  }
});

function exportTagsJson() {
  const payload = {
    version: state.tags.version || 1,
    tags: (state.tags.tags || []).map(t => ({
      id: t.id,
      name: t.name,
      ...(Number.isFinite(t.order) ? { order: t.order } : {}),
    })),
    assignments: state.tags.assignments || {},
    axis_assignments: state.tags.axis_assignments || {},
    axes_meta: state.tags.axes_meta || {},
  };
  downloadJson("tags.json", payload);
}

els.exportTagsBtn?.addEventListener("click", exportTagsJson);

// Tag modal actions
els.tagModalCloseBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  closeTagModal();
});

els.tagModalSaveBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  saveTagModal();
});

els.tagModalClearBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  clearTagModal();
});

els.tagModalAddBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  const name = safeStr(els.tagModalNewName?.value).trim();
  if (!name) return;
  const id = addTag(name);
  if (els.tagModalNewName) els.tagModalNewName.value = "";
  // If we're editing a specific turn, auto-check the newly added tag
  if (id && state.tagEdit?.currentSet) state.tagEdit.currentSet.add(id);
  renderTagModalList();
  renderAll();
});

// Close tag modal when clicking the overlay backdrop
els.tagModalOverlay?.addEventListener("click", (e) => {
  if (e.target === els.tagModalOverlay) closeTagModal();
});

els.loadDefaultBtn?.addEventListener("click", async () => {
  try { await loadDefault(); }
  catch (err) { openModal("Load sample error", { error: String(err) }); }
});

els.clearBtn?.addEventListener("click", clearAll);

els.applyFilterBtn?.addEventListener("click", () => {
  if (!state.rowsAll.length) return;
  state.rowsFiltered = applyMessageFilters(state.rowsAll);
  state.convIndex = buildConversationIndex(state.rowsFiltered);
  state.selectedConvId = null;
  syncProviderFiltersWithData();
  renderAll();
});

els.clearFilterBtn?.addEventListener("click", () => {
  if (!state.rowsAll.length) return;
  if (els.searchInput) els.searchInput.value = "";
  if (els.fromDate) els.fromDate.value = "";
  if (els.toDate) els.toDate.value = "";
  if (els.topicSelect) els.topicSelect.value = "";
  if (els.tagInput) els.tagInput.value = "";
  state.providerFilters = new Set(getAvailableProvidersFromIndex(state.convIndex).map(x => x.provider));
  state.rowsFiltered = state.rowsAll.slice();
  state.convIndex = buildConversationIndex(state.rowsFiltered);
  state.selectedConvId = null;
  syncProviderFiltersWithData();
  renderAll();
});


[
  els.searchInput,
  els.truncateInput,
  els.fromDate,
  els.toDate,
  els.topicSelect,
  els.tagInput,
].forEach(el => {
  el?.addEventListener("change", () => {
    // no auto filter apply (keeps UI predictable), but preview + timestamps should re-render
    if (el === els.truncateInput) {
      renderTurnsPane();
    }
  });
});

els.convSearch?.addEventListener("input", debounce(() => renderAll(), 150));

els.topicSelect?.addEventListener("change", () => renderAll());

els.scrollTopBtn?.addEventListener("click", () => {
  els.turnsPane?.scrollTo({ top: 0, behavior: "smooth" });
});


els.showTimesBtn?.addEventListener("click", () => {
  state.showTimes = !state.showTimes;
  updateShowTimesBtn();
  renderTurnsPane();
});

els.toggleAllBtn?.addEventListener("click", () => {
  state.allExpanded = !state.allExpanded;
  if (els.toggleAllBtn) {
    els.toggleAllBtn.textContent = state.allExpanded ? "Collapse all" : "Expand all";
  }
  renderTurnsPane();
});
function setAllExpanded(expand) {
  const pane = els.turnsPane;
  if (!pane) return;

  const toggles = Array.from(pane.querySelectorAll(".expander .tertiary"));
  toggles.forEach(btn => {
    const label = (btn.textContent || "").trim().toLowerCase();
    const isExpanded = label === "show less";
    if (expand && !isExpanded) btn.click();
    if (!expand && isExpanded) btn.click();
  });

  state.allExpanded = !!expand;
  if (els.toggleAllBtn) els.toggleAllBtn.textContent = state.allExpanded ? "Collapse all" : "Expand all";
}

// Initialize empty state
clearAll();

// Load topics sidecar if present (non-fatal if missing)
initTopicsLocalOnly();
initTagsLocalOnly();
updateShowTimesBtn();
if (typeof updateShowTimesBtn === "function") updateShowTimesBtn();
ensureProviderFilterUI();
renderProviderFilters();
// ---------- TAG HELPERS ----------
function normalizeTagsFile(obj) {
  if (!obj || typeof obj !== "object") {
    return { version: 1, tags: [], assignments: {}, axis_assignments: {}, axes_meta: {} };
  }
  const version = Number(obj.version || 1);
  const tags = Array.isArray(obj.tags) ? obj.tags.filter(t => t && t.id) : [];
  const assignments = (obj.assignments && typeof obj.assignments === "object") ? obj.assignments : {};
  const axis_assignments = (obj.axis_assignments && typeof obj.axis_assignments === "object") ? obj.axis_assignments : {};
  const axes_meta = (obj.axes_meta && typeof obj.axes_meta === "object") ? obj.axes_meta : {};
  return { version, tags, assignments, axis_assignments, axes_meta };
}

function tagNameById(id) {
  const t = (state.tags.tags || []).find(x => x.id === id);
  return t ? t.name : id;
}

function tagIdByNameToken(token) {
  const tok = safeStr(token).trim();
  if (!tok) return null;
  // Prefer exact id match
  const byId = (state.tags.tags || []).find(t => t.id === tok);
  if (byId) return byId.id;
  // Case-insensitive name match
  const lc = tok.toLowerCase();
  const byName = (state.tags.tags || []).find(t => safeStr(t.name).toLowerCase() === lc);
  return byName ? byName.id : tok; // allow raw ids
}

function parseTagFilterInput() {
  const raw = safeStr(els.tagInput?.value).trim();
  if (!raw) return [];
  return raw.split(",").map(s => s.trim()).filter(Boolean).map(tagIdByNameToken).filter(Boolean);
}

function turnKey(convId, turnIx) {
  return `${safeStr(convId)}::${String(turnIx)}`;
}

function getTurnAxis(convId, turnIx) {
  const c = state.tags.axis_assignments?.[convId];
  if (!c) return null;
  // try 0-based key first, then 1-based fallback
  return c[String(turnIx)] || c[String(turnIx + 1)] || null;
}

function getTurnTags(convId, turnIx) {
  const c = state.tags.assignments?.[convId];
  if (!c) return [];
  // try 0-based key first, then 1-based fallback
  const arr = (c[String(turnIx)] ?? c[String(turnIx + 1)]);
  return Array.isArray(arr) ? arr : [];
}

function convMatchesTags(convId, requiredTagIds) {
  if (!requiredTagIds || requiredTagIds.length === 0) return true;
  if (!state.convIndex.has(convId)) return false;
  const entry = state.convIndex.get(convId);
  const { turns } = toTurns(entry.msgs);
  // Conversation matches if ANY turn contains ALL required tags
  for (let ix = 0; ix < turns.length; ix++) {
    const ttags = getTurnTags(convId, ix);
    if (!ttags || ttags.length === 0) continue;
    let ok = true;
    for (const rid of requiredTagIds) {
      if (!ttags.includes(rid)) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

function setTurnTags(convId, turnIx, tagIds) {
  if (!state.tags.assignments || typeof state.tags.assignments !== "object") state.tags.assignments = {};
  if (!state.tags.assignments[convId]) state.tags.assignments[convId] = {};
  if (!tagIds || tagIds.length === 0) {
    delete state.tags.assignments[convId][String(turnIx)];
    // clean empty conv
    if (Object.keys(state.tags.assignments[convId]).length === 0) delete state.tags.assignments[convId];
    return;
  }
  // de-dupe + stable sort by tag name
  const uniq = Array.from(new Set(tagIds));
  uniq.sort((a,b) => safeStr(tagNameById(a)).localeCompare(safeStr(tagNameById(b))));
  state.tags.assignments[convId][String(turnIx)] = uniq;
}

function ensureUniqueTagId(baseId) {
  let id = baseId;
  let n = 2;
  const exists = () => (state.tags.tags || []).some(t => t.id === id);
  while (exists()) {
    id = `${baseId}-${n++}`;
  }
  return id;
}

function addTag(name) {
  const nm = safeStr(name).trim();
  if (!nm) return null;
  const base = slugifyId(nm);
  const id = ensureUniqueTagId(base);
  state.tags.tags.push({ id, name: nm, order: (state.tags.tags.length + 1) * 10 });
  sortTagsCatalog();
  state.tags.loaded = true;
  return id;
}

function sortTagsCatalog() {
  state.tags.tags.sort((a,b) => (Number(a.order||0) - Number(b.order||0)) || safeStr(a.name).localeCompare(safeStr(b.name)));
}

function renameTag(id, newName) {
  const t = state.tags.tags.find(x => x.id === id);
  if (!t) return;
  t.name = safeStr(newName).trim() || t.name;
  sortTagsCatalog();
}

function deleteTag(id) {
  // remove from catalog
  state.tags.tags = state.tags.tags.filter(t => t.id !== id);
  // remove from all assignments
  const asn = state.tags.assignments || {};
  for (const convId of Object.keys(asn)) {
    const turns = asn[convId] || {};
    for (const k of Object.keys(turns)) {
      const arr = Array.isArray(turns[k]) ? turns[k] : [];
      const next = arr.filter(x => x !== id);
      if (next.length) turns[k] = next;
      else delete turns[k];
    }
    if (Object.keys(turns).length === 0) delete asn[convId];
  }
  state.tags.assignments = asn;
}

function downloadJson(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
