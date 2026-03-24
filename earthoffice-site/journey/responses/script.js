let allPrompts = [];
let filteredPrompts = [];
let currentPromptId = null;

// Utility: get unique sorted values from an array
function uniqueSorted(arr) {
  return Array.from(new Set(arr.filter(v => v !== null && v !== ""))).sort((a, b) =>
    a.toString().localeCompare(b.toString(), undefined, { sensitivity: "base" })
  );
}

// Load JSON then initialize
async function loadData() {
  try {
    const resp = await fetch("prompts.txt?v=" + Date.now());
    const data = await resp.json();
    allPrompts = data;
    filteredPrompts = data.slice();
    initFilters(data);
    applyFilters();  // also renders prompt list
  } catch (err) {
    console.error("Error loading prompts.json:", err);
  }
}

// Initialize filter UI based on data
function initFilters(data) {
  const dayValues = data
    .map(p => p.HRTDays)
    .filter(d => typeof d === "number" && !Number.isNaN(d));
  const minDay = Math.min(...dayValues);
  const maxDay = Math.max(...dayValues);

  // Set day inputs
  const dayMinInput = document.getElementById("day-min");
  const dayMaxInput = document.getElementById("day-max");
  dayMinInput.value = minDay;
  dayMaxInput.value = maxDay;
  dayMinInput.dataset.min = minDay;
  dayMaxInput.dataset.max = maxDay;

  // Build unique Class, Phase, Tags lists
  const classes = uniqueSorted(data.map(p => p.Class));
  const phases = uniqueSorted(data.map(p => p.Phase));
  const tags = uniqueSorted(
    data.flatMap(p => Array.isArray(p.Tags) ? p.Tags : [])
  );

  populateMultiSelect("class-filter", classes);
  populateMultiSelect("phase-filter", phases);
  populateMultiSelect("tag-filter", tags);

  // Wire up filter events
  dayMinInput.addEventListener("change", applyFilters);
  dayMaxInput.addEventListener("change", applyFilters);
  document.getElementById("class-filter").addEventListener("change", applyFilters);
  document.getElementById("phase-filter").addEventListener("change", applyFilters);
  document.getElementById("tag-filter").addEventListener("change", applyFilters);
  document.getElementById("clear-filters").addEventListener("click", clearFilters);
  document.getElementById("search-input").addEventListener("input", applyFilters);
}

// Populate a <select multiple> with options
function populateMultiSelect(selectId, values) {
  const select = document.getElementById(selectId);
  select.innerHTML = "";
  values.forEach(v => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    select.appendChild(opt);
  });
}

// Get selected values from a multi-select
function getSelectedValues(selectId) {
  const select = document.getElementById(selectId);
  return Array.from(select.selectedOptions).map(o => o.value);
}

// Core filter logic
function applyFilters() {
  const dayMinInput = document.getElementById("day-min");
  const dayMaxInput = document.getElementById("day-max");
  const searchInput = document.getElementById("search-input");

  let dayMin = parseInt(dayMinInput.value, 10);
  let dayMax = parseInt(dayMaxInput.value, 10);
  if (Number.isNaN(dayMin)) {
    dayMin = parseInt(dayMinInput.dataset.min, 10);
    dayMinInput.value = dayMin;
  }
  if (Number.isNaN(dayMax)) {
    dayMax = parseInt(dayMaxInput.dataset.max, 10);
    dayMaxInput.value = dayMax;
  }

  const selectedClasses = getSelectedValues("class-filter");
  const selectedPhases = getSelectedValues("phase-filter");
  const selectedTags = getSelectedValues("tag-filter");
  const searchTerm = searchInput.value.trim().toLowerCase();

  filteredPrompts = allPrompts.filter(p => {
    const d = typeof p.HRTDays === "number" ? p.HRTDays : 0;

    const withinDays = d >= dayMin && d <= dayMax;

    const matchesClass =
      selectedClasses.length === 0 || selectedClasses.includes(p.Class);

    const matchesPhase =
      selectedPhases.length === 0 || selectedPhases.includes(p.Phase);

    const matchesTags =
      selectedTags.length === 0 ||
      selectedTags.every(tag =>
        Array.isArray(p.Tags) && p.Tags.includes(tag)
      );

    const matchesSearch =
      searchTerm === "" ||
      (p.PromptText && p.PromptText.toLowerCase().includes(searchTerm));

    return withinDays && matchesClass && matchesPhase && matchesTags && matchesSearch;
  });

  renderPromptList();

  // If current selection got filtered out, clear response viewer
  if (currentPromptId !== null) {
    const stillExists = filteredPrompts.some(p => p.PromptID === currentPromptId);
    if (!stillExists) {
      clearResponseViewer();
      currentPromptId = null;
    }
  }
}

// Clear filters
function clearFilters() {
  const dayMinInput = document.getElementById("day-min");
  const dayMaxInput = document.getElementById("day-max");
  dayMinInput.value = dayMinInput.dataset.min;
  dayMaxInput.value = dayMaxInput.dataset.max;

  ["class-filter", "phase-filter", "tag-filter"].forEach(id => {
    const sel = document.getElementById(id);
    Array.from(sel.options).forEach(o => (o.selected = false));
  });

  document.getElementById("search-input").value = "";

  applyFilters();
}

// Render prompt cards
function renderPromptList() {
  const container = document.getElementById("prompt-list");
  container.innerHTML = "";

  if (filteredPrompts.length === 0) {
    const msg = document.createElement("p");
    msg.textContent = "No prompts match the current filters.";
    msg.className = "response-placeholder";
    container.appendChild(msg);
    return;
  }

  filteredPrompts
    .sort((a, b) => (a.HRTDays ?? 0) - (b.HRTDays ?? 0) || (a.PromptID ?? 0) - (b.PromptID ?? 0))
    .forEach(p => {
      const card = document.createElement("div");
      card.className = "prompt-card";
      card.dataset.promptId = p.PromptID;

      if (p.PromptID === currentPromptId) {
        card.classList.add("active");
      }

      const metaDiv = document.createElement("div");
      metaDiv.className = "prompt-meta";

      const idSpan = document.createElement("span");
      idSpan.textContent = `#${p.PromptID}`;
      metaDiv.appendChild(idSpan);

      const daySpan = document.createElement("span");
      daySpan.textContent = `Day ${p.HRTDays}`;
      metaDiv.appendChild(daySpan);

      const classSpan = document.createElement("span");
      classSpan.textContent = p.Class || "—";
      metaDiv.appendChild(classSpan);

      const phaseSpan = document.createElement("span");
      phaseSpan.textContent = p.Phase || "—";
      metaDiv.appendChild(phaseSpan);

      const title = document.createElement("p");
      title.className = "prompt-text";
      title.textContent = truncateText(p.PromptText || "", 140);

      const tagsDiv = document.createElement("div");
      tagsDiv.className = "prompt-tags";

      (Array.isArray(p.Tags) ? p.Tags : []).slice(0, 4).forEach(tag => {
        const tagSpan = document.createElement("span");
        tagSpan.className = "tag-pill";
        tagSpan.textContent = tag;
        tagsDiv.appendChild(tagSpan);
      });

      card.appendChild(metaDiv);
      card.appendChild(title);
      if (tagsDiv.children.length > 0) {
        card.appendChild(tagsDiv);
      }

      card.addEventListener("click", () => {
        currentPromptId = p.PromptID;
        highlightActiveCard();
        loadResponse(p);
      });

      container.appendChild(card);
    });
}

// Truncate helper
function truncateText(text, maxLength) {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

// Highlight active card
function highlightActiveCard() {
  const cards = document.querySelectorAll(".prompt-card");
  cards.forEach(c => {
    if (parseInt(c.dataset.promptId, 10) === currentPromptId) {
      c.classList.add("active");
    } else {
      c.classList.remove("active");
    }
  });
}

// Clear response viewer
function clearResponseViewer() {
  document.getElementById("response-title").textContent =
    "Select a prompt to view its response";
  document.getElementById("response-subtitle").textContent = "";
  const content = document.getElementById("response-content");
  content.innerHTML = `<p class="response-placeholder">
    Use the filters and prompt list on the left to explore the journey.
  </p>`;
}

// Load response HTML and display it
async function loadResponse(prompt) {
  const titleEl = document.getElementById("response-title");
  const subtitleEl = document.getElementById("response-subtitle");
  const contentEl = document.getElementById("response-content");

titleEl.textContent = prompt.PromptText || "(No prompt text)";

  const metaParts = [];
  if (typeof prompt.HRTDays === "number") metaParts.push(`Day ${prompt.HRTDays}`);
  if (prompt.Class) metaParts.push(`Class: ${prompt.Class}`);
  if (prompt.Phase) metaParts.push(`Phase: ${prompt.Phase}`);

  subtitleEl.textContent = metaParts.join(" · ");

  contentEl.innerHTML = `<p class="response-placeholder">Loading response…</p>`;

  if (!prompt.ResponsePath) {
    contentEl.innerHTML = `<p class="response-placeholder">
      No response file is configured for this prompt (missing ResponsePath).
    </p>`;
    return;
  }

  try {
  const url = new URL(prompt.ResponsePath, window.location.href);
  url.searchParams.set("v", Date.now());

  const resp = await fetch(url.toString(), { cache: "no-store" });
if (!resp.ok) {
  throw new Error(`HTTP ${resp.status}`);
}
const buffer = await resp.arrayBuffer();
const html = new TextDecoder("windows-1252").decode(buffer);
contentEl.innerHTML = html;

setTimeout(() => {
  scrollToPromptToken(prompt);
}, 80);



// On small screens, jump to the response pane
if (window.matchMedia("(max-width: 960px)").matches) {
  document.getElementById("response-meta")?.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

// Give the browser a moment to render, then scroll to the prompt
  } catch (err) {
    console.error("Error loading response file:", err);
    contentEl.innerHTML = `<p class="response-placeholder">
      Unable to load response file at <code>${prompt.ResponsePath}</code>.
    </p>`;
  }
}

function scrollToPromptToken(prompt) {
  const container = document.getElementById("response-content");
  if (!container || !prompt || prompt.PromptID == null) return;

  const token = `p${prompt.PromptID}`.toLowerCase();

  const normalize = (str) =>
    (str || "")
      .toLowerCase()
      .replace(/\u00a0/g, " ") // nbsp -> space
      .replace(/\s+/g, " ")
      .trim();

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);

  let node;
  let foundNode = null;

  while ((node = walker.nextNode())) {
    const text = normalize(node.textContent);
    const idx = text.indexOf(token);

    if (idx !== -1) {
      const after = text[idx + token.length] || " ";
      // Prevent p12 matching p120
      if (!/[0-9]/.test(after)) {
        foundNode = node;
        break;
      }
    }
  } // IMPORTANT: closes while loop

  if (!foundNode) {
    console.warn("Token not found in response HTML:", token);
    return;
  }

  // Scroll to a reasonable ancestor
  let el = foundNode.parentElement;
  while (el && el !== container && el.offsetHeight < 10) {
    el = el.parentElement;
  }
  if (!el || el === container) el = foundNode.parentElement || container;

  const containerRect = container.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  const offset = elRect.top - containerRect.top + container.scrollTop - 12;

  container.scrollTo({ top: offset, behavior: "smooth" });
}


function updateHeaderCounters() {
  try {
    // Sept 9, 2025 at noon LOCAL time (month is 0-based; 8 = September)
    const start = new Date(2025, 8, 9, 12, 0, 0);
    const now = new Date();

    const msPerDay = 24 * 60 * 60 * 1000;
    const diffDaysRaw = (now.getTime() - start.getTime()) / msPerDay;

    const days = Math.floor(diffDaysRaw);
    const weeks = diffDaysRaw / 7;
    const months = diffDaysRaw / 30.436875; // average month length

    const daysEl = document.getElementById("counter-days");
    const weeksEl = document.getElementById("counter-weeks");
    const monthsEl = document.getElementById("counter-months");

    // If IDs don’t exist, fail silently (but log once for debugging)
    if (!daysEl || !weeksEl || !monthsEl) {
      console.warn("Counter elements not found. Check IDs in index.html.");
      return;
    }

    daysEl.textContent = String(days);
    weeksEl.textContent = weeks.toFixed(1);
    monthsEl.textContent = months.toFixed(1);
  } catch (e) {
    console.error("updateHeaderCounters failed:", e);
  }
}


document.addEventListener("DOMContentLoaded", () => {
  updateHeaderCounters();
  loadData();
});

