/* Tagging Workbench v1 (local-only)
   - Load export.json and optional tags.json
   - Extract turns using same logic as Chat Browser
   - Call Ollama /api/chat to assign tags per turn
   - Merge (union) and export full tags.json
*/

const els = {
  loadExportBtn: document.getElementById("loadExportBtn"),
  exportFileInput: document.getElementById("exportFileInput"),
  loadTagsBtn: document.getElementById("loadTagsBtn"),
  tagsFileInput: document.getElementById("tagsFileInput"),

  runBtn: document.getElementById("runBtn"),
  exportBtn: document.getElementById("exportBtn"),
  cancelBtn: document.getElementById("cancelBtn"),

  modelInput: document.getElementById("modelInput"),
  baseUrlInput: document.getElementById("baseUrlInput"),
  allowProposalsChk: document.getElementById("allowProposalsChk"),
  onlyUntaggedChk: document.getElementById("onlyUntaggedChk"),
  maxTurnsInput: document.getElementById("maxTurnsInput"),

  statusLine: document.getElementById("statusLine"),
  progressFill: document.getElementById("progressFill"),
  progressText: document.getElementById("progressText"),

  convSearch: document.getElementById("convSearch"),
  convList: document.getElementById("convList"),
  convMeta: document.getElementById("convMeta"),

  reviewList: document.getElementById("reviewList"),
  reviewMeta: document.getElementById("reviewMeta"),

  modalOverlay: document.getElementById("modalOverlay"),
  modalTitle: document.getElementById("modalTitle"),
  modalPre: document.getElementById("modalPre"),
  modalCloseBtn: document.getElementById("modalCloseBtn"),
};

const state = {
  exportRaw: null,
  rows: [],
  convIndex: new Map(),   // convId -> {convId,title,msgs:[]}
  convSummaries: [],      // [{convId,title,turnCount}]
  selectedConvId: null,

  tags: {
    version: 1,
    tags: [],            // catalog [{id,name,order?}]
    assignments: {},     // convId -> { turnIndex: [tagId...] }
    loaded: false,
    source: "",
  },

  proposals: [],          // [{name, count}]
  proposedByTurn: new Map(), // key `${convId}::${turnIx}` -> {tag_ids, confidence, proposed_tags}

  cancelled: false,
};

function safeStr(v){ return (v===null||v===undefined) ? "" : String(v); }

function openModal(title, obj){
  els.modalTitle.textContent = title || "Error";
  try { els.modalPre.textContent = JSON.stringify(obj, null, 2); }
  catch { els.modalPre.textContent = String(obj); }
  els.modalOverlay.classList.add("open");
  els.modalOverlay.setAttribute("aria-hidden","false");
}
function closeModal(){
  els.modalOverlay.classList.remove("open");
  els.modalOverlay.setAttribute("aria-hidden","true");
  els.modalPre.textContent="";
}
els.modalCloseBtn?.addEventListener("click", closeModal);
els.modalOverlay?.addEventListener("click",(e)=>{ if(e.target===els.modalOverlay) closeModal(); });
document.addEventListener("keydown",(e)=>{ if(e.key==="Escape") closeModal(); });

async function readJsonFile(file){
  const txt = await file.text();
  return JSON.parse(txt);
}

// ---------- Export parsing (copied/compatible with your app.js patterns) ----------
function normalizeExport(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.conversations)) return data.conversations;
  if (data && Array.isArray(data.items)) return data.items;
  return [];
}

function extractTextFromMessage(msg) {
  try {
    const parts = msg?.content?.parts;
    if (Array.isArray(parts)) return parts.join("\n");
    const text = msg?.content?.text;
    if (typeof text === "string") return text;
    if (typeof msg?.text === "string") return msg.text;
    const c = msg?.content;
    if (typeof c === "string") return c;
  } catch {}
  return "";
}

function toDateObj(t){
  if (t === null || t === undefined) return null;
  if (typeof t === "number") {
    // ChatGPT export create_time is often epoch seconds
    const ms = t < 2e12 ? t * 1000 : t;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof t === "string") {
    const d = new Date(t);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
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
        });
      }
    }
  }

  // Sort by time within conversation; keep conv grouping stable
  rows.sort((a, b) => {
    const ca = safeStr(a.convId);
    const cb = safeStr(b.convId);
    if (ca !== cb) return ca.localeCompare(cb);
    const ta = toDateObj(a.msgTime)?.getTime() || 0;
    const tb = toDateObj(b.msgTime)?.getTime() || 0;
    return ta - tb;
  });

  return rows;
}

function buildConversationIndex(rows){
  const map = new Map();
  for (const r of rows) {
    const key = r.convId || r.convTitle || "(unknown)";
    if (!map.has(key)) map.set(key, { convId: key, title: r.convTitle || "(untitled)", msgs: [] });
    map.get(key).msgs.push(r);
  }
  for (const entry of map.values()) {
    entry.msgs.sort((a,b)=>(toDateObj(a.msgTime)?.getTime()||0)-(toDateObj(b.msgTime)?.getTime()||0));
  }
  return map;
}

// ---------- Turn consolidation (matches your browser behavior) ----------
function joinTexts(arr){
  return (arr || []).map(x => safeStr(x.text)).filter(Boolean).join("\n\n").trim();
}

function rangeTimeForMsgs(msgArr){
  const ts = (msgArr || []).map(m => toDateObj(m.msgTime)).filter(Boolean).map(d=>d.getTime());
  if (!ts.length) return { first: null, last: null };
  return { first: new Date(Math.min(...ts)), last: new Date(Math.max(...ts)) };
}

function toTurns(msgs) {
  const turns = [];
  const preamble = [];
  let current = null;

  for (const m of msgs) {
    const role = safeStr(m.role);

    if (role === "user") {
      if (!current) current = { user: [], assistant: [], other: [] };
      if (current.assistant.length === 0) {
        current.user.push(m);
      } else {
        turns.push(current);
        current = { user: [m], assistant: [], other: [] };
      }
      continue;
    }

    if (role === "assistant") {
      if (!current) current = { user: [], assistant: [], other: [] };
      current.assistant.push(m);
      continue;
    }

    // other roles: system/tool/etc
    if (!current) {
      preamble.push(m);
    } else {
      current.other.push(m);
    }
  }

  if (current) turns.push(current);

  // Mirror browser behavior: attach preamble if needed (kept as separate “other”)
  return { preamble, turns };
}

// ---------- tags.json handling ----------
function loadTagsJson(obj, sourceLabel){
  const version = obj?.version ?? 1;
  const tags = Array.isArray(obj?.tags) ? obj.tags : [];
  const assignments = (obj && typeof obj.assignments === "object" && obj.assignments) ? obj.assignments : {};
  state.tags = { version, tags, assignments, loaded: true, source: sourceLabel || "" };
}

function buildAllowedTagMap(){
  const m = new Map();
  for (const t of (state.tags.tags || [])) m.set(t.id, t.name || t.id);
  return m;
}

function unionTags(existingArr, newArr){
  const s = new Set([...(existingArr||[]), ...(newArr||[])].map(String));
  return Array.from(s);
}

// ---------- UI rendering ----------
function renderStatus(){
  const convCount = state.convIndex?.size || 0;
  const tagCount = state.tags?.tags?.length || 0;
  const tagsLoaded = !!state.tags.loaded;
  els.statusLine.textContent =
    !state.exportRaw ? "No export loaded."
    : `Export loaded: ${convCount} conversations. Tags: ${tagsLoaded ? `${tagCount} loaded` : "not loaded (closed vocab empty)"}.`;
}

function renderConversationList(){
  const q = safeStr(els.convSearch?.value).trim().toLowerCase();
  const items = [];
  for (const entry of state.convIndex.values()){
    if (q && !safeStr(entry.title).toLowerCase().includes(q)) continue;
    const { turns } = toTurns(entry.msgs);
    items.push({ convId: entry.convId, title: entry.title, turnCount: turns.length });
  }
  items.sort((a,b)=>safeStr(a.title).localeCompare(safeStr(b.title)));
  state.convSummaries = items;

  els.convMeta.textContent = `${items.length} conversations`;
  els.convList.innerHTML = "";
  for (const it of items){
    const div = document.createElement("div");
    div.className = "convItem" + (it.convId === state.selectedConvId ? " active" : "");
    div.innerHTML = `
      <div class="convTitle">${escapeHtml(it.title)}</div>
      <div class="convMeta"><span>${it.turnCount} turns</span><span class="mono">${escapeHtml(it.convId)}</span></div>
    `;
    div.addEventListener("click", ()=>{
      state.selectedConvId = it.convId;
      renderConversationList();
      renderReviewForConversation(it.convId);
    });
    els.convList.appendChild(div);
  }
}

function renderReviewForConversation(convId){
  const entry = state.convIndex.get(convId);
  if (!entry) return;
  const { turns } = toTurns(entry.msgs);
  els.reviewMeta.textContent = `${turns.length} turns`;

  const allowed = buildAllowedTagMap();
  const allowedIds = new Set(Array.from(allowed.keys()));

  els.reviewList.innerHTML = "";
  for (let i=0;i<turns.length;i++){
    const t = turns[i];
    const userText = joinTexts(t.user);
    const asstText = joinTexts(t.assistant) || joinTexts(t.other);
    const key = `${convId}::${i}`;
    const proposed = state.proposedByTurn.get(key);
    const existing = state.tags.assignments?.[convId]?.[String(i)] || [];

    const current = proposed?.tag_ids?.length ? proposed.tag_ids : existing;

    const item = document.createElement("div");
    item.className = "reviewItem";
    item.innerHTML = `
      <div class="reviewTitle">
        <strong>Turn ${i}</strong>
        <span class="time mono">${proposed ? `conf ${formatConf(proposed.confidence)}` : ""}</span>
      </div>
      <div class="reviewSnippet"><b>User:</b> ${escapeHtml(snippet(userText, 420))}\n\n<b>Assistant:</b> ${escapeHtml(snippet(asstText, 420))}</div>
      <div class="reviewTagsRow">
        <label>Tag IDs</label>
        <input type="text" data-convid="${escapeAttr(convId)}" data-turnix="${i}" value="${escapeAttr(current.join(", "))}" placeholder="comma-separated tag IDs" />
      </div>
      ${proposed && proposed.proposed_tags?.length ? `<div class="small">Proposals: ${escapeHtml(proposed.proposed_tags.join(", "))}</div>` : ""}
    `;
    // Input validation on blur: strip unknown IDs (closed vocab)
    const inp = item.querySelector("input[type='text']");
    inp.addEventListener("blur", ()=>{
      const ids = parseCsv(inp.value).filter(x => allowedIds.has(x));
      inp.value = ids.join(", ");
      // update state immediately so export reflects edits
      upsertAssignment(convId, i, ids);
    });

    els.reviewList.appendChild(item);
  }
}

function upsertAssignment(convId, turnIx, tagIds){
  if (!state.tags.assignments) state.tags.assignments = {};
  if (!state.tags.assignments[convId]) state.tags.assignments[convId] = {};
  state.tags.assignments[convId][String(turnIx)] = Array.isArray(tagIds) ? tagIds : [];
}

// ---------- Ollama tagging ----------
function buildSystemPrompt(allowedMap, allowProposals){
  const lines = [];
  lines.push("You are a precise labeling assistant.");
  lines.push("Task: assign zero or more tag_ids to the given conversation turn.");
  lines.push("You MUST follow these rules:");
  lines.push("1) Output MUST be strict JSON with keys: tag_ids, confidence, proposed_tags.");
  lines.push("2) tag_ids MUST be selected only from the allowed IDs provided.");
  lines.push("3) confidence MUST be a number between 0 and 1.");
  lines.push(`4) proposed_tags MUST be an array of strings. ${allowProposals ? "Use it only if you think the taxonomy is missing something." : "Leave it empty."}`);
  lines.push("5) Use at most 5 tag_ids.");
  lines.push("");
  lines.push("Allowed tags (id: name):");
  for (const [id, name] of allowedMap.entries()){
    lines.push(`${id}: ${name}`);
  }
  return lines.join("\n");
}

function buildUserPrompt(convTitle, turnIx, userText, assistantText){
  return [
    `Conversation title: ${convTitle}`,
    `Turn index: ${turnIx}`,
    "",
    "USER TEXT:",
    userText || "(empty)",
    "",
    "ASSISTANT TEXT:",
    assistantText || "(empty)",
    "",
    "Return JSON only."
  ].join("\n");
}

async function ollamaChat(baseUrl, model, system, user){
  const url = baseUrl.replace(/\/+$/,"") + "/api/chat";
  const body = {
    model,
    stream: false,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ]
  };
  const res = await fetch(url, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok){
    const txt = await res.text().catch(()=> "");
    throw new Error(`Ollama error ${res.status}: ${txt || res.statusText}`);
  }
  const json = await res.json();
  const content = json?.message?.content ?? json?.response ?? "";
  return content;
}

function parseModelJson(text){
  // Be strict, but tolerate leading/trailing junk by extracting first {...}
  const s = safeStr(text).trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("Model did not return JSON.");
  const candidate = s.slice(start, end+1);
  return JSON.parse(candidate);
}

// ---------- Run pipeline ----------
function setProgress(pct, msg){
  els.progressFill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  els.progressText.textContent = msg || "";
}

async function runTagging(){
  if (!state.exportRaw) return openModal("Missing export", { error: "Load export.json first." });

  const model = safeStr(els.modelInput.value).trim();
  if (!model) return openModal("Missing model", { error: "Enter an Ollama model name (e.g., llama3.2)." });

  const baseUrl = safeStr(els.baseUrlInput.value).trim() || "http://localhost:11434";
  const allowProposals = !!els.allowProposalsChk.checked;
  const onlyUntagged = !!els.onlyUntaggedChk.checked;
  const maxTurns = els.maxTurnsInput.value ? Math.max(1, Number(els.maxTurnsInput.value)) : null;

  const allowed = buildAllowedTagMap();
  const allowedIds = new Set(Array.from(allowed.keys()));
  const systemPrompt = buildSystemPrompt(allowed, allowProposals);

  state.cancelled = false;
  els.cancelBtn.disabled = false;
  els.runBtn.disabled = true;

  try{
    const convIds = state.selectedConvId ? [state.selectedConvId] : Array.from(state.convIndex.keys());
    let totalWork = 0;
    const workItems = [];

    for (const convId of convIds){
      const entry = state.convIndex.get(convId);
      if (!entry) continue;
      const { turns } = toTurns(entry.msgs);
      for (let i=0;i<turns.length;i++){
        if (maxTurns && workItems.length >= maxTurns) break;
        const existing = state.tags.assignments?.[convId]?.[String(i)] || [];
        if (onlyUntagged && existing.length) continue;
        workItems.push({ convId, convTitle: entry.title, turnIx: i, turn: turns[i] });
      }
      if (maxTurns && workItems.length >= maxTurns) break;
    }

    totalWork = workItems.length;
    if (!totalWork){
      setProgress(0, "Nothing to do (all turns already tagged or scope empty).");
      return;
    }

    for (let idx=0; idx<workItems.length; idx++){
      if (state.cancelled) throw new Error("Cancelled.");
      const w = workItems[idx];
      const userText = joinTexts(w.turn.user);
      const assistantTextFull = joinTexts(w.turn.assistant) || joinTexts(w.turn.other);
      const assistantText = assistantTextFull.length > 3500 ? assistantTextFull.slice(0,3500) : assistantTextFull;

      setProgress((idx/totalWork)*100, `Tagging ${idx+1}/${totalWork} (turn ${w.turnIx})…`);

      const userPrompt = buildUserPrompt(w.convTitle, w.turnIx, userText, assistantText);
      const raw = await ollamaChat(baseUrl, model, systemPrompt, userPrompt);
      const out = parseModelJson(raw);

      const tag_ids = Array.isArray(out.tag_ids) ? out.tag_ids.map(String).filter(x => allowedIds.has(x)).slice(0,5) : [];
      const confidence = (typeof out.confidence === "number") ? Math.max(0, Math.min(1, out.confidence)) : 0;
      const proposed_tags = allowProposals && Array.isArray(out.proposed_tags) ? out.proposed_tags.map(safeStr).map(s=>s.trim()).filter(Boolean).slice(0,5) : [];

      // merge (union) into assignments
      const existing = state.tags.assignments?.[w.convId]?.[String(w.turnIx)] || [];
      const merged = unionTags(existing, tag_ids);
      upsertAssignment(w.convId, w.turnIx, merged);

      state.proposedByTurn.set(`${w.convId}::${w.turnIx}`, { tag_ids, confidence, proposed_tags });
    }

    setProgress(100, `Done. Tagged ${totalWork} turns.`);
    if (state.selectedConvId) renderReviewForConversation(state.selectedConvId);
    else renderConversationList(); // refresh counts

  } catch (e){
    setProgress(0, "Idle");
    if (String(e?.message) !== "Cancelled.") openModal("Tagging error", { error: String(e?.message || e) });
  } finally{
    els.cancelBtn.disabled = true;
    els.runBtn.disabled = false;
  }
}

// ---------- Export tags.json ----------
function downloadJson(filename, obj){
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

function exportTags(){
  const out = {
    version: state.tags.version ?? 1,
    tags: Array.isArray(state.tags.tags) ? state.tags.tags : [],
    assignments: state.tags.assignments || {},
  };
  downloadJson("tags.json", out);
}

// ---------- helpers ----------
function parseCsv(s){
  return safeStr(s).split(",").map(x=>x.trim()).filter(Boolean);
}
function snippet(s, n){ return safeStr(s).length > n ? safeStr(s).slice(0,n) + "…" : safeStr(s); }
function escapeHtml(s){
  return safeStr(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
function escapeAttr(s){
  return escapeHtml(s).replace(/\"/g,"&quot;");
}
function formatConf(x){
  if (typeof x !== "number") return "";
  return (Math.round(x*100)/100).toFixed(2);
}

// ---------- wiring ----------
els.loadExportBtn.addEventListener("click", ()=> els.exportFileInput.click());
els.exportFileInput.addEventListener("change", async (e)=>{
  const f = e.target.files?.[0];
  if (!f) return;
  try{
    const data = await readJsonFile(f);
    state.exportRaw = data;
    state.rows = flattenChatGPTExport(data);
    state.convIndex = buildConversationIndex(state.rows);
    state.selectedConvId = null;
    state.proposedByTurn = new Map();
    renderStatus();
    renderConversationList();
    els.reviewList.innerHTML = "";
    els.reviewMeta.textContent = "—";
  } catch(err){
    openModal("Export load error", { error: String(err?.message || err) });
  } finally {
    e.target.value = "";
  }
});

els.loadTagsBtn.addEventListener("click", ()=> els.tagsFileInput.click());
els.tagsFileInput.addEventListener("change", async (e)=>{
  const f = e.target.files?.[0];
  if (!f) return;
  try{
    const obj = await readJsonFile(f);
    loadTagsJson(obj, f.name);
    renderStatus();
    if (state.selectedConvId) renderReviewForConversation(state.selectedConvId);
  } catch(err){
    openModal("Tags load error", { error: String(err?.message || err) });
  } finally {
    e.target.value = "";
  }
});

els.convSearch.addEventListener("input", renderConversationList);

els.runBtn.addEventListener("click", runTagging);
els.cancelBtn.addEventListener("click", ()=>{
  state.cancelled = true;
  els.cancelBtn.disabled = true;
});

els.exportBtn.addEventListener("click", exportTags);

// initial UI state
els.modelInput.value = "llama3.2";
renderStatus();
setProgress(0, "Idle");
