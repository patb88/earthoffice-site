/* ChatGPT Export Browser
   - Loads JSON from file picker or from ./conversations.json (fetch)
   - Flattens to one row per message
   - Truncates preview text
*/

const els = {
  fileInput: document.getElementById("fileInput"),
  loadDefaultBtn: document.getElementById("loadDefaultBtn"),
  clearBtn: document.getElementById("clearBtn"),

  searchInput: document.getElementById("searchInput"),
  roleSelect: document.getElementById("roleSelect"),
  truncateInput: document.getElementById("truncateInput"),
  showTimes: document.getElementById("showTimes"),

  stats: document.getElementById("stats"),
  tbody: document.getElementById("tbody"),

  rawPane: document.getElementById("rawPane"),
  rawPre: document.getElementById("rawPre"),
  closeRawBtn: document.getElementById("closeRawBtn"),
  
  augFileInput: document.getElementById("augFileInput"),
  exportAugBtn: document.getElementById("exportAugBtn"),
  clearAugBtn: document.getElementById("clearAugBtn"),
  augStatus: document.getElementById("augStatus"),
};

// just added
if (els.augFileInput) {
  els.augFileInput.addEventListener("change", async (e) => {
    try {
      const file = e.target.files?.[0];
      if (!file) return;
      const text = await file.text();
      const data = JSON.parse(text);
      const incomingMap = parseAugFileJson(data);

      mergeAugmentations(incomingMap);

      // Re-attach to existing rows and re-render
      if (Array.isArray(allRows) && allRows.length) {
        attachAugFieldsToTurns(allRows);
        applyFilters();
        render();
      }

      if (els.augStatus) {
        els.augStatus.textContent = `Augmentations loaded (${Object.keys(incomingMap || {}).length} turns)`;
      }
    } catch (err) {
      console.error(err);
      alert(err?.message || String(err));
    } finally {
      e.target.value = "";
    }
  });
}

if (els.exportAugBtn) {
  els.exportAugBtn.addEventListener("click", () => {
    const out = {
      schema: AUG_SCHEMA,
      updated_at: new Date().toISOString(),
      turns: augmentations,
    };
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "augmentations.json";
    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
  });
}

if (els.clearAugBtn) {
  els.clearAugBtn.addEventListener("click", () => {
    augmentations = {};
    saveLocalAugmentations();
    if (Array.isArray(allRows) && allRows.length) {
      attachAugFieldsToTurns(allRows);
      applyFilters();
      render();
    }
    if (els.augStatus) els.augStatus.textContent = "Augmentations cleared (local)";
  });
}
// end just added

let allRows = [];      // flattened messages
let filteredRows = []; // after filters
// --- Augmentation store (MVP) ---
const AUG_STORAGE_KEY = "chat_aug_v1";

let aug = loadAugmentations() ?? {
  schemaVersion: 1,
  turns: {},
  axisCatalog: {
    topic: [],
    intent: ["Learn","Troubleshoot","Decide","Plan","Create","Summarize","Ideate","Reflect","Analyze","Find"]
  }
};
// -----------------------------
// Augmentations (sidecar)
// -----------------------------
const AUG_SCHEMA = "exportbrowser.augmentations.v1";
const AUG_LOCAL_KEY = "exportbrowser.augmentations.local.v1";

// In-memory augmentation store (turnId -> {tags, topic, intent})
let augmentations = loadLocalAugmentations(); // turnId -> object

function loadLocalAugmentations() {
  try {
    const raw = localStorage.getItem(AUG_LOCAL_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}

function saveLocalAugmentations() {
  localStorage.setItem(AUG_LOCAL_KEY, JSON.stringify(augmentations));
}

function mergeAugmentations(incoming) {
  // incoming is turnId -> fields
  for (const [turnId, fields] of Object.entries(incoming || {})) {
    if (!fields || typeof fields !== "object") continue;
    augmentations[turnId] = {
      ...(augmentations[turnId] || {}),
      ...fields,
    };
  }
  saveLocalAugmentations();
}

function parseAugFileJson(data) {
  // Accept either:
  // A) { schema, turns: {turnId: {...}} }
  // B) {turnId: {...}} (bare map)
  if (data && typeof data === "object" && data.turns && typeof data.turns === "object") {
    return data.turns;
  }
  return data; // assume bare map
}

function attachAugFieldsToTurns(rows) {
  // rows are turn rows with msgId === turnId
  for (const r of rows) {
    if (!r || r.role !== "turn") continue;
    const turnId = r.msgId;
    const aug = augmentations[turnId] || {};
    r.tags = Array.isArray(aug.tags) ? aug.tags : [];
    r.topic = typeof aug.topic === "string" ? aug.topic : "";
    r.intent = typeof aug.intent === "string" ? aug.intent : "";
  }
}

function mirrorAxesToSidecar(row, topicsArr, intentStr) {
  const turnId = row.msgId; // your turnId is the msgId for turn rows
  augmentations[turnId] = {
    ...(augmentations[turnId] || {}),
    topic: (topicsArr || []).join(", "),
    intent: intentStr || ""
  };
  saveLocalAugmentations();

  // keep row in sync too (optional, but helpful)
  row.topic = (topicsArr || []).join(", ");
  row.intent = intentStr || "";
}

function editTurnTags(row) {
  const axes = getTurnAxes(row);

  const currentTopic = (axes.topic || []).join(", ");
  const topicInput = prompt("Topic(s) (comma-separated):", currentTopic);
  if (topicInput === null) return;

  const newTopics = String(topicInput)
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  const catalog = (aug.axisCatalog.intent || [])
    .map(s => String(s).trim())
    .filter(Boolean);

  const intentPrompt =
    "Intent (type a name or enter a number):\n" +
    catalog.map((i, ix) => `${ix + 1}. ${i}`).join("\n") +
    `\n\nCurrent: ${axes.intent || "—"}`;

  const intentInput = prompt(intentPrompt, axes.intent || "");
  if (intentInput === null) return;

  let rawChoice = String(intentInput || "").trim();
  if (rawChoice === "") {
	setTurnAxes(row, { topic: newTopics, intent: "", tags: newTags });
    render();
    return;
  }

  rawChoice = rawChoice.replace(/^[-•]\s+/, "").trim();

  const asNum = Number(rawChoice);
  if (Number.isInteger(asNum) && asNum >= 1 && asNum <= catalog.length) {
    setTurnAxes(row, { topic: newTopics, intent: catalog[asNum - 1], tags: newTags });
render();
    return;
  }

  const lower = rawChoice.toLowerCase();
  const match = catalog.find(x => x.toLowerCase() === lower);
  if (!match) {
    alert(
      `Intent not recognized.\n\nEnter one of these (or a number 1-${catalog.length}):\n` +
      catalog.map((i, ix) => `${ix + 1}. ${i}`).join("\n")
    );
    return;
  }
  const currentTags = (axes.tags || []).join(", ");
const tagsInput = prompt("Tags (comma-separated):", currentTags);
if (tagsInput === null) return;

const newTags = String(tagsInput)
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

  setTurnAxes(row, { topic: newTopics, intent: match, tags: newTags });
  render();
}

function loadAugmentations() {
  try {
    const raw = localStorage.getItem(AUG_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.schemaVersion !== 1) return null;
    // Ensure required containers exist
    parsed.turns = parsed.turns ?? {};
    parsed.axisCatalog = parsed.axisCatalog ?? {};
    parsed.axisCatalog.topic = parsed.axisCatalog.topic ?? [];
    parsed.axisCatalog.intent = parsed.axisCatalog.intent ?? ["Learn","Troubleshoot","Decide","Plan","Create","Summarize","Ideate","Reflect","Analyze","Find"];
    return parsed;
  } catch {
    return null;
  }
}

function saveAugmentations() {
  try {
    localStorage.setItem(AUG_STORAGE_KEY, JSON.stringify(aug));
  } catch (e) {
    console.warn("Failed to save augmentations:", e);
  }
}

// Stable key for turn-level augmentation
function getTurnKey(row) {
  if (!row) return null;
  // Preferred: convId + stableTurnId
  if (row.convId && row.stableTurnId) return `${row.convId}:${row.stableTurnId}`;
  // Fallback: (works, but less stable) convId + msgId
  if (row.convId && row.msgId) return `${row.convId}:${row.msgId}`;
  return null;
}

function getTurnAxes(row) {
  const turnId = row?.msgId;
  const a = (turnId && augmentations[turnId]) ? augmentations[turnId] : {};

  // topic stored as string in augmentations; convert to array for UI
  const topicArr = typeof a.topic === "string"
    ? a.topic.split(",").map(s => s.trim()).filter(Boolean)
    : (Array.isArray(a.topic) ? a.topic : []);

  return {
    topic: topicArr,
    intent: typeof a.intent === "string" ? a.intent : "",
    tags: Array.isArray(a.tags) ? a.tags : []
  };
}


function setTurnAxes(row, { topic, intent, tags } = {}) {
  const turnId = row?.msgId;
  if (!turnId) return;

  const prev = augmentations[turnId] || {};

  const topicStr =
    Array.isArray(topic) ? topic.join(", ") :
    (typeof topic === "string" ? topic : (prev.topic || ""));

  augmentations[turnId] = {
    ...prev,
    topic: topicStr,
    intent: (typeof intent === "string") ? intent : (prev.intent || ""),
    tags: Array.isArray(tags) ? tags : (prev.tags || [])
  };

  saveLocalAugmentations();

  // Keep row in sync so render reflects updates without reload
  row.topic = augmentations[turnId].topic || "";
  row.intent = augmentations[turnId].intent || "";
  row.tags = augmentations[turnId].tags || [];
}



function setTurnAxes(row, { topic, intent, tags } = {}) {
  const turnId = row?.msgId;
  if (!turnId) return;

  const prev = augmentations[turnId] || {};

  const topicStr =
    Array.isArray(topic) ? topic.join(", ") :
    (typeof topic === "string" ? topic : (prev.topic || ""));

  augmentations[turnId] = {
    ...prev,
    topic: topicStr,
    intent: (typeof intent === "string") ? intent : (prev.intent || ""),
    tags: Array.isArray(tags) ? tags : (prev.tags || [])
  };

  saveLocalAugmentations();

  // Keep row in sync so render reflects updates without reload
  row.topic = augmentations[turnId].topic || "";
  row.intent = augmentations[turnId].intent || "";
  row.tags = augmentations[turnId].tags || [];
}

function safeDate(epochSeconds) {
  if (!epochSeconds || Number.isNaN(Number(epochSeconds))) return "";
  const d = new Date(Number(epochSeconds) * 1000);
  return d.toISOString().replace("T", " ").replace("Z", " UTC");
}

function truncateText(s, n) {
  if (typeof s !== "string") return "";
  if (s.length <= n) return s;
  return s.slice(0, n) + "…";
}

// Attempt to normalize the variety of exported structures.
// Primary support: conversations.json with conversation.mapping[*].message
function flattenChatGPTExport(data) {
  const rows = [];

  // Case 1: array of conversations
  const conversations = Array.isArray(data)
    ? data
    : (Array.isArray(data?.conversations) ? data.conversations : null);
	
//debugging
//console.log("top-level keys:", data && typeof data === "object" ? Object.keys(data) : typeof data);
//console.log("conversations count:", conversations ? conversations.length : "null");
//end debugger

  if (conversations && conversations.length) {
    for (const conv of conversations) {
      const convTitle = conv?.title ?? "(untitled)";
      const convCreate = conv?.create_time ?? null;
      const convUpdate = conv?.update_time ?? null;

      const convIdRaw = String(
        conv?.id ??
        conv?.conversation_id ??
        conv?.conversationId ??
        conv?.uuid ??
        conv?.chat_id ??
        conv?.metadata?.id ??
        ""
      );
      const convId = convIdRaw.trim()
        ? convIdRaw
        : `conv_${Math.random().toString(16).slice(2)}`;

      const mapping = conv?.mapping;
	  
	  //debugger
	  //console.log("conv keys:", Object.keys(conv || {}));
//console.log("mapping type:", typeof mapping, "mapping size:", mapping && typeof mapping === "object" ? Object.keys(mapping).length : "n/a");
// end debugger

      if (!mapping || typeof mapping !== "object") continue;

      // IMPORTANT: use nodeWrapper as the value from mapping
      for (const [mappingNodeId, nodeWrapper] of Object.entries(mapping)) {
const node = nodeWrapper;          // nodeWrapper already IS the node
const msg = nodeWrapper?.message;  // message is directly on the node

if (!msg) {
  // show one example and then stop spamming
  if (!flattenChatGPTExport._loggedMissingMsg) {
    flattenChatGPTExport._loggedMissingMsg = true;
    //console.log("example nodeWrapper keys:", Object.keys(nodeWrapper || {}));
    //console.log("example node keys:", Object.keys(node || {}));
    //console.log("example node:", node);
  }
  continue;
}


        // These should not shadow the loop variables
		const nodeId = String(nodeWrapper?.id ?? mappingNodeId);	
        const msgId = String(msg?.id ?? nodeId);

        // Extract content + metadata first
        const content = msg?.content ?? {};
        const contentType = String(content?.content_type ?? "text");
        const meta = msg?.metadata ?? {};
        const isHidden = meta?.is_visually_hidden_from_conversation === true;
        const isUserSystem = meta?.is_user_system_message === true;

        // Normalize role
        let role = String(msg?.author?.role ?? "").toLowerCase();
        if (
          role === "user" &&
          (isUserSystem || isHidden || contentType === "user_editable_context")
        ) {
          role = "system";
        }

        const msgTime = msg?.create_time ?? null;

        // Build display text
        let text = "";
        const parts = Array.isArray(content?.parts) ? content.parts : [];
        if (parts.length > 0) {
          text = parts
            .map((p) => (typeof p === "string" ? p : JSON.stringify(p)))
            .join("\n")
            .trim();
        }

        // Override UI text for user context nodes
        if (contentType === "user_editable_context") {
          text = "[user context / instructions]";
        }
const parent = nodeWrapper?.parent ?? null;
const children = Array.isArray(nodeWrapper?.children) ? nodeWrapper.children : [];

        rows.push({
          convId,
          convTitle,
          convCreate,
          convUpdate,
          nodeId,
          msgId,
		  parent,
		  children,
          role,
          msgTime,
          contentType,
          isHidden,
          isUserSystem,
          text,
          raw: {
            convMeta: { id: convId, title: convTitle, create_time: convCreate, update_time: convUpdate },
            nodeId,
            node,
          },
        });
      }
    }

    // Sorting: by conversation update time, then message time, then stable fallback
    rows.sort((a, b) => {
      const au = Number(a.convUpdate ?? 0), bu = Number(b.convUpdate ?? 0);
      if (au !== bu) return bu - au;
      const at = Number(a.msgTime ?? 0), bt = Number(b.msgTime ?? 0);
      if (at !== bt) return at - bt;
      return String(a.msgId).localeCompare(String(b.msgId));
    });

    return rows;
  }

  // Case 2: unknown structure
  throw new Error("Unrecognized JSON structure. Expected an array of conversations or {conversations:[...]}.");
}


function applyFilters() {
  const q = (els.searchInput.value || "").trim().toLowerCase();
  const role = els.roleSelect.value;
  filteredRows = allRows.filter(r => {
    if (role !== "all" && r.role !== role) return false;
    if (!q) return true;

    const hay = [
      r.convTitle,
      r.convId,
      r.msgId,
      r.nodeId,
      r.role,
      r.text,
    ].join(" ").toLowerCase();

    return hay.includes(q);
  });
}

function render() {
  // Ensure augmentation overlay is applied before any UI rendering
  if (Array.isArray(allRows) && allRows.length) {
  attachAugFieldsToTurns(allRows);
}
  if (Array.isArray(allRows) && allRows.length) attachAugFieldsToTurns(allRows);
  const truncN = Math.max(20, Math.min(1000, Number(els.truncateInput.value || 140)));
  const showTimes = els.showTimes.checked;

  els.tbody.innerHTML = "";

  const frag = document.createDocumentFragment();
  filteredRows.forEach((r, idx) => {
    const tr = document.createElement("tr");

    const tdIdx = document.createElement("td");
    tdIdx.className = "mono";
    tdIdx.textContent = String(idx + 1);
    tr.appendChild(tdIdx);

    const tdConv = document.createElement("td");
    tdConv.innerHTML = `
      <div><strong>${escapeHtml(r.convTitle)}</strong></div>
      <div class="mono" style="color: var(--muted); font-size: 12px;">${escapeHtml(r.convId)}</div>
    `;
    tr.appendChild(tdConv);

    const tdRole = document.createElement("td");
    tdRole.innerHTML = `<span class="badge">${escapeHtml(r.role || "")}</span>`;
    tr.appendChild(tdRole);

    const tdTime = document.createElement("td");
    tdTime.className = "mono";
    tdTime.textContent = showTimes ? safeDate(r.msgTime) : "";
    tr.appendChild(tdTime);

    const tdMsg = document.createElement("td");
    tdMsg.className = "mono";
    tdMsg.textContent = r.msgId || "";
    tr.appendChild(tdMsg);

    const tdPrev = document.createElement("td");
    tdPrev.className = "preview";
    tdPrev.title = r.text || "";
    tdPrev.textContent = truncateText(r.text || "", truncN);
    tr.appendChild(tdPrev);

const tdTags = document.createElement("td");
const tagsInput = document.createElement("input");
tagsInput.type = "text";
tagsInput.className = "tags-input"; // optional, for styling
tagsInput.placeholder = "tag1, tag2";
tagsInput.value = (r.tags && r.tags.length) ? r.tags.join(", ") : "";

tagsInput.addEventListener("change", () => {
  const turnId = r.msgId;
  const tags = tagsInput.value
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  augmentations[turnId] = {
    ...(augmentations[turnId] || {}),
    tags
  };

  saveLocalAugmentations();
  r.tags = tags;
});

tdTags.appendChild(tagsInput);

if (r.role === "turn") {
  const axes = getTurnAxes(r);
  const topicStr = (axes.topic || []).join(", ");
  const intentStr = axes.intent || "";
  const tagsStr  = (axes.tags && axes.tags.length) ? axes.tags.join(", ") : "—";
  
tdTags.innerHTML = `
  <div><strong>${escapeHtml(intentStr || "—")}</strong></div>
  <div style="color: var(--muted); font-size: 12px;">${escapeHtml(topicStr || "")}</div>
  <div style="margin-top: 4px; font-size: 12px;">Tags: ${escapeHtml(tagsStr)}</div>
  <div style="margin-top: 6px;">
    <button class="btn secondary" style="padding: 4px 8px;">Edit</button>
  </div>
`;


  tdTags.querySelector("button").addEventListener("click", () => editTurnTags(r));
} else {
  tdTags.textContent = "—";
}

tr.appendChild(tdTags);


    const tdRaw = document.createElement("td");
    const btn = document.createElement("button");
    btn.className = "btn secondary";
    btn.textContent = "{ }";
    btn.title = "Show raw JSON for this node/message";
    btn.addEventListener("click", () => openRaw(r.raw));
    tdRaw.appendChild(btn);
    tr.appendChild(tdRaw);

    frag.appendChild(tr);
  });

  els.tbody.appendChild(frag);

const augCount = Object.keys(augmentations || {}).length;
els.stats.textContent =
  `Loaded turns: ${allRows.length} | Visible turns: ${filteredRows.length} | Aug turns: ${augCount}`;
}

function openRaw(obj) {
  els.rawPre.textContent = JSON.stringify(obj, null, 2);
  els.rawPane.setAttribute("aria-hidden", "false");
}

function closeRaw() {
  els.rawPane.setAttribute("aria-hidden", "true");
  els.rawPre.textContent = "";
}

function clearAll() {
  allRows = [];
  filteredRows = [];
  els.searchInput.value = "";
  els.roleSelect.value = "all";
  els.stats.textContent = "No data loaded.";
  els.tbody.innerHTML = "";
  closeRaw();
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function deriveTurnsFromMessageRows(messageRows) {
  // Group rows by conversation
  const byConv = new Map();
  for (const r of messageRows) {
    if (!r?.convId) continue;
    if (!byConv.has(r.convId)) byConv.set(r.convId, []);
    byConv.get(r.convId).push(r);
  }

  const turns = [];

for (const [convId, rows] of byConv.entries()) {
  // Build index so we can resolve children ids to rows
  const byNodeId = new Map(rows.map(r => [r.nodeId, r]));

  // Sort by time as a baseline (fine), but we won’t *depend* on it for pairing
  rows.sort((a, b) => {
    const at = Number(a.msgTime ?? 0), bt = Number(b.msgTime ?? 0);
    if (at !== bt) return at - bt;
    return String(a.nodeId).localeCompare(String(b.nodeId));
  });

  let turnIndex = 0;
  let current = null;

  const attachAssistantViaChildren = (userRow) => {
    // Children are available via raw.node.children in your current rows
    const children = userRow?.raw?.node?.children;
    if (!Array.isArray(children) || children.length === 0) return;

    const visited = new Set();
    const queue = [...children];

    while (queue.length) {
      const childId = queue.shift();
      if (!childId || visited.has(childId)) continue;
      visited.add(childId);

      const childRow = byNodeId.get(childId);
      if (!childRow) continue;

      if (childRow.role === "assistant") {
        current.assistantMessages.push(childRow);
 attachedAssistantIds.add(childRow);  // <-- mark as consumed
        // Optional: follow assistant’s children too (sometimes assistant->assistant chains happen)
        const nextKids = childRow?.raw?.node?.children;
        if (Array.isArray(nextKids) && nextKids.length) {
          queue.unshift(...nextKids);
        }
        // Stop after first assistant chain; comment out the next line if you want multi-branch capture
        continue;
      }

      // If child is system/tool/etc, ignore but keep walking
      const nextKids = childRow?.raw?.node?.children;
      if (Array.isArray(nextKids) && nextKids.length) {
        queue.unshift(...nextKids);
      }
    }
  };

  const flush = () => {
    if (!current) return;

    const userText = (current.userMessages || []).map(m => m.text || "").join("\n").trim();
    const assistantText = (current.assistantMessages || []).map(m => m.text || "").join("\n").trim();

    if (!userText && !assistantText) {
      current = null;
      return;
    }

    const turnId = `${convId}:turn_${String(turnIndex).padStart(5, "0")}`;
const stableTurnId = current.userMessages[0]?.msgId;

    turns.push({
      convId,
      convTitle: current.convTitle,
      convCreate: current.convCreate,
      convUpdate: current.convUpdate,
      nodeId: turnId,
      msgId: turnId,
	  stableTurnId,            // NEW — augmentation anchor
      role: "turn",
      msgTime: current.startTime,
      turnIndex,
      userMessageIds: current.userMessages.map(m => m.msgId),
      assistantMessageIds: current.assistantMessages.map(m => m.msgId),
      userText,
      assistantText,
      text: `U: ${userText}\n\nA: ${assistantText}`,
      raw: {
        turnId,
        convMeta: {
          id: convId,
          title: current.convTitle,
          create_time: current.convCreate,
          update_time: current.convUpdate,
        },
        startTime: current.startTime,
        userMessages: current.userMessages,
        assistantMessages: current.assistantMessages,
        ignoredMessages: current.ignoredMessages,
      },
    });

    turnIndex += 1;
    current = null;
  };

const attachedAssistantIds = new Set();

  for (const r of rows) {
    const role = r.role || "";

    // ignore system/tool
    if (role !== "user" && role !== "assistant") {
      if (current) current.ignoredMessages.push(r);
      continue;
    }

    if (role === "user") {
      flush();

      current = {
        convTitle: r.convTitle,
        convCreate: r.convCreate,
        convUpdate: r.convUpdate,
        startTime: r.msgTime ?? null,
        userMessages: [r],
        assistantMessages: [],
        ignoredMessages: [],
      };

      // NEW: attach assistant(s) via DAG immediately
      attachAssistantViaChildren(r);

      // If we successfully attached assistant(s), we can flush right away for clean turns
      // Comment out the next two lines if you prefer time-sweep behavior for multi-part turns.
      flush();
      continue;
    }

  // SUPPRESS assistant-only rows already attached via DAG
  if (attachedAssistantIds.has(r.id)) {
    continue;
  }
  
    // If we encounter an assistant outside a user-started turn, keep old behavior
    if (!current) {
      current = {
        convTitle: r.convTitle,
        convCreate: r.convCreate,
        convUpdate: r.convUpdate,
        startTime: r.msgTime ?? null,
        userMessages: [],
        assistantMessages: [r],
        ignoredMessages: [],
      };
      continue;
    }

    current.assistantMessages.push(r);
attachedAssistantIds.add(r.id);  // <-- mark as consumed	
  }

  flush();
}


  // Sort turns by conversation update time, then by start time
  turns.sort((a, b) => {
    const au = Number(a.convUpdate ?? 0), bu = Number(b.convUpdate ?? 0);
    if (au !== bu) return bu - au;
    const at = Number(a.msgTime ?? 0), bt = Number(b.msgTime ?? 0);
    if (at !== bt) return at - bt;
    return String(a.msgId).localeCompare(String(b.msgId));
  });

  return turns;
}

async function loadFromFile(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  const messageRows = flattenChatGPTExport(data);
  allRows = deriveTurnsFromMessageRows(messageRows);
  attachAugFieldsToTurns(allRows); // IMPORTANT
  els.roleSelect.value = "all";
  applyFilters();
  render();
}


async function loadFromFetch() {
  const res = await fetch("./conversations.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  const data = await res.json();
	const messageRows = flattenChatGPTExport(data);
	allRows = deriveTurnsFromMessageRows(messageRows);
	attachAugFieldsToTurns(allRows);
	applyFilters();
	render();

}

// Wiring
els.fileInput.addEventListener("change", async (e) => {
  try {
    const file = e.target.files?.[0];
    if (!file) return;
    await loadFromFile(file);
  } catch (err) {
    console.error(err);
	alert(err?.message || String(err));
  } finally {
    els.fileInput.value = "";
  }
});

els.loadDefaultBtn.addEventListener("click", async () => {
  try {
    await loadFromFetch();
  } catch (err) {
    alert(
      (err?.message || String(err)) +
      "\n\nTip: If you opened index.html directly, fetch() may be blocked. Use the file picker or run a local server."
    );
  }
});

els.clearBtn.addEventListener("click", clearAll);

["input", "change"].forEach(evt => {
  els.searchInput.addEventListener(evt, () => { applyFilters(); render(); });
  els.roleSelect.addEventListener(evt, () => { applyFilters(); render(); });
  els.truncateInput.addEventListener(evt, () => { render(); });
  els.showTimes.addEventListener(evt, () => { render(); });
});

els.closeRawBtn.addEventListener("click", closeRaw);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeRaw();
});
