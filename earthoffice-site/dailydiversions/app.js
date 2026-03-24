/* Daily Diversions MVP (static)
   - Loads words, dailySelections (overrides), samplecontent (local pool), comments (test)
   - Override selection if present for (UTC date, word); otherwise makeSelection() from sample pool
   - Challenge unlocks description + comments
   - Answer/comment logging is stubbed (no server writes)
*/

const DATA_PATHS = {
  words: "data/words.json",
  dailySelections: "data/dailySelections.json",
  samplecontent: "data/samplecontent.json",
  comments: "data/comments.json"
};

const UI = {
  utcPill: document.getElementById("utcPill"),
  statusPill: document.getElementById("statusPill"),

  wordSearch: document.getElementById("wordSearch"),
  wordList: document.getElementById("wordList"),
  wordCount: document.getElementById("wordCount"),

  selectedWordLabel: document.getElementById("selectedWordLabel"),
  openSourceBtn: document.getElementById("openSourceBtn"),

  contentEmpty: document.getElementById("contentEmpty"),
  contentStage: document.getElementById("contentStage"),
  contentFrame: document.getElementById("contentFrame"),
  attributionLine: document.getElementById("attributionLine"),

  challengeCard: document.getElementById("challengeCard"),
  challengeText: document.getElementById("challengeText"),
  challengeInput: document.getElementById("challengeInput"),
  challengeSubmit: document.getElementById("challengeSubmit"),

  descriptionCard: document.getElementById("descriptionCard"),
  descriptionText: document.getElementById("descriptionText"),

  commentsCard: document.getElementById("commentsCard"),
  commentsList: document.getElementById("commentsList"),
  commentInput: document.getElementById("commentInput"),
  commentPost: document.getElementById("commentPost"),
  commentMeta: document.getElementById("commentMeta"),

  devStatus: document.getElementById("devStatus")
};

const STATE = {
  words: [],
  wordIndexById: new Map(),
  dailySelections: null,
  samplecontent: [],
  contentById: new Map(),
  comments: [],

  selectedWordId: null,
  selectedContent: null,
  selectedDescription: "",
  selectedChallenge: "",
  unlocked: false,

  todayUTC: null
};

// ---------- Utilities ----------
function getTodayUTCDateString() {
  // --- ORIGINAL (real UTC date) ---
  // const now = new Date();
  // const y = now.getUTCFullYear();
  // const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  // const d = String(now.getUTCDate()).padStart(2, "0");
  // return `${y}-${m}-${d}`;

  // --- TEST MODE (fixed date for stable fixtures) ---
  // Using a constant date allows you to test the same dailySelections/comments
  // dataset on any future calendar date without needing to regenerate data.
  return "2026-01-11";
}


function isoNowUTC() {
  return new Date().toISOString();
}

function setStatus(text, subtle = true) {
  UI.statusPill.textContent = text;
  UI.statusPill.classList.toggle("subtle", subtle);
}

async function fetchJson(path) {
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
  return res.json();
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ---------- Stubs (no server writes in MVP) ----------
function logAnswer({ date_utc, word_id, answer_text, answer_utc }) {
  // Stub: Replace later with POST /api/answer (Worker + rate limiting)
  console.log("[stub] logAnswer", { date_utc, word_id, answer_text, answer_utc });
}

function logComment({ date_utc, word_id, comment_text, comment_utc }) {
  // Stub: Replace later with POST /api/comment (Worker + rate limiting)
  console.log("[stub] logComment", { date_utc, word_id, comment_text, comment_utc });
}

// ---------- Selection ----------
function getWordById(word_id) {
  return STATE.wordIndexById.get(word_id) || null;
}

function getOverrideForToday(word_id) {
  const d = STATE.todayUTC;
  const selections = STATE.dailySelections?.selections;
  if (!selections) return null;
  const dayObj = selections[d];
  if (!dayObj) return null;
  return dayObj[word_id] || null;
}

function getCandidatesForWord(word_id) {
  const w = getWordById(word_id);
  const allowedTypes = (w?.content_preferences?.allowed_types?.length)
    ? new Set(w.content_preferences.allowed_types)
    : null;

  return STATE.samplecontent.filter(item => {
    if (!item || !item.content_id) return false;
    const tags = Array.isArray(item.tags) ? item.tags : [];
    const tagged = tags.includes(word_id);
    if (!tagged) return false;
    if (allowedTypes && !allowedTypes.has(item.type)) return false;
    return true;
  });
}

function makeSelection(word_id) {
  const candidates = getCandidatesForWord(word_id);
  if (!candidates.length) {
    throw new Error(`No sample content candidates for word_id="${word_id}". Add tags in samplecontent.json.`);
  }
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  return pick;
}

// ---------- Content + UX ----------
function resetUnlockState() {
  STATE.unlocked = false;

  UI.descriptionCard.classList.add("locked");
  UI.descriptionCard.setAttribute("aria-disabled", "true");
  UI.descriptionText.textContent = "Locked. Answer the prompt to reveal.";

  UI.commentsCard.classList.add("locked");
  UI.commentsCard.setAttribute("aria-disabled", "true");
  UI.commentsList.innerHTML = `<div class="small muted">Locked. Answer the prompt to view and post.</div>`;

  UI.challengeInput.value = "";
  UI.challengeInput.disabled = false;
  UI.challengeSubmit.disabled = false;

  UI.commentInput.value = "";
  UI.commentInput.disabled = true;
  UI.commentPost.disabled = true;
  UI.commentMeta.textContent = "Posting is stubbed in MVP.";
}

function unlock() {
  STATE.unlocked = true;

  UI.descriptionCard.classList.remove("locked");
  UI.descriptionCard.setAttribute("aria-disabled", "false");
  UI.descriptionText.textContent = STATE.selectedDescription || "(No description)";

  UI.commentsCard.classList.remove("locked");
  UI.commentsCard.setAttribute("aria-disabled", "false");

  UI.commentInput.disabled = false;
  UI.commentPost.disabled = false;

  renderComments();
}

function renderContent(item) {
  UI.contentEmpty.classList.add("hidden");
  UI.contentStage.classList.remove("hidden");

  UI.contentFrame.innerHTML = "";
  UI.attributionLine.textContent = "";

  if (!item) return;

  if (item.type === "image") {
    const img = document.createElement("img");
    img.src = item.local_path;
    img.alt = item.title || item.content_id || "image";
    UI.contentFrame.appendChild(img);
  } else if (item.type === "text") {
    // For MVP: support inline text if provided, otherwise fetch local_path
    const box = document.createElement("div");
    box.className = "content-text";
    box.textContent = item.inline_text || "Loading text…";
    UI.contentFrame.appendChild(box);

    if (!item.inline_text && item.local_path) {
      fetch(item.local_path, { cache: "no-cache" })
        .then(r => r.ok ? r.text() : Promise.reject(new Error(`Failed to load text: ${r.status}`)))
        .then(t => { box.textContent = t; })
        .catch(e => { box.textContent = `Error loading text: ${e.message}`; });
    }
  } else {
    const box = document.createElement("div");
    box.className = "content-text";
    box.textContent = `Unsupported content type: ${item.type}`;
    UI.contentFrame.appendChild(box);
  }

  // Attribution line (lightweight, but always present if data exists)
  const s = item.source || {};
  const parts = [];
  if (s.source_name) parts.push(s.source_name);
  if (s.creator_name) parts.push(`by ${s.creator_name}`);
  if (s.license) parts.push(`(${s.license})`);

  let attr = parts.join(" ");
  if (s.source_url) {
    // show as plain text, button uses actual link
    attr = attr ? `${attr} · Source link available` : "Source link available";
  }
  UI.attributionLine.textContent = attr || "";

  // Source button
  UI.openSourceBtn.disabled = !s.source_url;
  UI.openSourceBtn.onclick = () => {
    if (s.source_url) window.open(s.source_url, "_blank", "noopener,noreferrer");
  };
}

function generateDescription(item, word) {
  // MVP: templated (replace later with AI-generated description)
  const wLabel = word?.label || word?.word_id || "this topic";
  const title = item?.title ? `“${item.title}”` : "Selected content";
  const kind = item?.type ? item.type : "content";
  return `${title} (${kind}) for ${wLabel}. This is a curated sample used during MVP to validate selection and engagement plumbing.`;
}

function generateChallenge(item, word) {
  // MVP: safe, non-doxxy prompts
  const wLabel = word?.label || word?.word_id || "this topic";
  if (item?.type === "image") {
    return `In one sentence, what does this image suggest about “${wLabel}”?`;
  }
  if (item?.type === "text") {
    return `What is the strongest idea in this text as it relates to “${wLabel}”?`;
  }
  return `What do you notice first about this selection for “${wLabel}”?`;
}

function applySelection(word_id) {
  const word = getWordById(word_id);
  if (!word) throw new Error(`Unknown word_id "${word_id}"`);

  STATE.selectedWordId = word_id;
  STATE.selectedContent = null;
  STATE.selectedDescription = "";
  STATE.selectedChallenge = "";

  UI.selectedWordLabel.textContent = word.label || word.word_id;

  resetUnlockState();

  // 1) Override selection if present
  const override = getOverrideForToday(word_id);

  let contentItem = null;
  let selectionMode = "";

  if (override?.content_id) {
    contentItem = STATE.contentById.get(override.content_id) || null;
    selectionMode = "override";
    if (!contentItem) {
      // If override points to missing content_id, fall back to makeSelection
      contentItem = makeSelection(word_id);
      selectionMode = "fallback (override missing content_id)";
    }
  } else {
    // 2) Dev fallback: makeSelection()
    contentItem = makeSelection(word_id);
    selectionMode = "fallback";
  }

  STATE.selectedContent = contentItem;

  // Derive description/challenge
  STATE.selectedDescription = (override?.description_override && override.description_override.trim())
    ? override.description_override.trim()
    : generateDescription(contentItem, word);

  STATE.selectedChallenge = (override?.challenge_override && override.challenge_override.trim())
    ? override.challenge_override.trim()
    : generateChallenge(contentItem, word);

  UI.challengeText.textContent = STATE.selectedChallenge;

  renderContent(contentItem);

  // Dev status
  const contentId = contentItem?.content_id || "(none)";
  UI.devStatus.textContent =
    `Selected via ${selectionMode}. date_utc=${STATE.todayUTC}, word_id=${word_id}, content_id=${contentId}`;
}

function renderWords(filterText = "") {
  const q = filterText.trim().toLowerCase();
  const filtered = STATE.words.filter(w => {
    if (!w.active) return false;
    if (!q) return true;
    const a = (w.label || "").toLowerCase();
    const b = (w.word_id || "").toLowerCase();
    return a.includes(q) || b.includes(q);
  });

  UI.wordList.innerHTML = "";

  for (const w of filtered) {
    const row = document.createElement("div");
    row.className = "word-item";
    row.setAttribute("role", "option");
    row.dataset.wordId = w.word_id;

    const left = document.createElement("div");
    left.className = "word-label";
    left.textContent = w.label || w.word_id;

    const right = document.createElement("div");
    right.className = "word-meta";
    right.textContent = w.word_id;

    row.appendChild(left);
    row.appendChild(right);

    if (STATE.selectedWordId === w.word_id) {
      row.classList.add("selected");
      row.setAttribute("aria-selected", "true");
    }

    row.addEventListener("click", () => {
      // set selected state in list
      STATE.selectedWordId = w.word_id;
      renderWords(UI.wordSearch.value);
      try {
        applySelection(w.word_id);
      } catch (e) {
        setStatus(`Error: ${e.message}`, false);
        console.error(e);
      }
    });

    UI.wordList.appendChild(row);
  }

  UI.wordCount.textContent = `${filtered.length} words`;
}

function renderComments() {
  const d = STATE.todayUTC;
  const w = STATE.selectedWordId;
  if (!STATE.unlocked || !d || !w) return;

  const relevant = STATE.comments
    .filter(c => c.date_utc === d && c.word_id === w)
    .sort((a, b) => (a.comment_utc || "").localeCompare(b.comment_utc || ""));

  if (!relevant.length) {
    UI.commentsList.innerHTML = `<div class="small muted">No comments yet for this word today.</div>`;
    return;
  }

  UI.commentsList.innerHTML = "";
  for (const c of relevant) {
    const card = document.createElement("div");
    card.className = "comment";

    const time = document.createElement("div");
    time.className = "comment-time";
    time.textContent = c.comment_utc ? new Date(c.comment_utc).toUTCString() : "(time unknown)";

    const text = document.createElement("div");
    text.className = "comment-text";
    text.textContent = c.comment_text || "";

    card.appendChild(time);
    card.appendChild(text);

    UI.commentsList.appendChild(card);
  }
}

// ---------- Event wiring ----------
function wireChallenge() {
  UI.challengeSubmit.addEventListener("click", () => {
    if (!STATE.selectedWordId) return;
    if (!STATE.selectedContent) return;

    const answer = UI.challengeInput.value.trim();
    if (!answer) {
      UI.challengeInput.focus();
      return;
    }

    // stub log
    logAnswer({
      date_utc: STATE.todayUTC,
      word_id: STATE.selectedWordId,
      answer_text: answer,
      answer_utc: isoNowUTC()
    });

    unlock();
  });

  UI.challengeInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      UI.challengeSubmit.click();
    }
  });
}

function wireCommentPost() {
  UI.commentPost.addEventListener("click", () => {
    if (!STATE.unlocked) return;
    const txt = UI.commentInput.value.trim();
    if (!txt) {
      UI.commentInput.focus();
      return;
    }

    const payload = {
      date_utc: STATE.todayUTC,
      word_id: STATE.selectedWordId,
      comment_text: txt,
      comment_utc: isoNowUTC()
    };

    logComment(payload);

    // Dev-only: append locally so you can see it immediately.
    // This does NOT persist and will reset on reload.
    STATE.comments.push(payload);
    UI.commentInput.value = "";
    renderComments();
  });
}

// ---------- Init ----------
async function init() {
  try {
    STATE.todayUTC = getTodayUTCDateString();
    UI.utcPill.textContent = `UTC: ${STATE.todayUTC}`;

    setStatus("Loading data…");

    const [words, dailySelections, samplecontent, comments] = await Promise.all([
      fetchJson(DATA_PATHS.words),
      fetchJson(DATA_PATHS.dailySelections),
      fetchJson(DATA_PATHS.samplecontent),
      fetchJson(DATA_PATHS.comments)
    ]);

    // words
    STATE.words = Array.isArray(words.words) ? words.words : [];
    STATE.wordIndexById = new Map();
    for (const w of STATE.words) {
      if (w?.word_id) STATE.wordIndexById.set(w.word_id, w);
    }

    // daily selections
    STATE.dailySelections = dailySelections || { selections: {} };

    // sample content
    STATE.samplecontent = Array.isArray(samplecontent.items) ? samplecontent.items : [];
    STATE.contentById = new Map();
    for (const it of STATE.samplecontent) {
      if (it?.content_id) STATE.contentById.set(it.content_id, it);
    }

    // comments
    STATE.comments = Array.isArray(comments.comments) ? comments.comments : [];

    // UI wiring
    wireChallenge();
    wireCommentPost();

    UI.wordSearch.addEventListener("input", () => {
      renderWords(UI.wordSearch.value);
    });

    // initial state
    renderWords("");

    // disable challenge input until a word selected
    UI.challengeInput.disabled = true;
    UI.challengeSubmit.disabled = true;

    setStatus("Ready");
  } catch (e) {
    console.error(e);
    setStatus(`Load error: ${e.message}`, false);
    UI.devStatus.textContent = `Failed to initialize: ${e.message}`;
  }
}

init();
