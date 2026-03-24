/**
 * Daily Diversions — app.js
 *
 * Architecture notes:
 * - ContentSource is the single point responsible for fetching entries.
 *   To add automated/API-driven content later, swap or extend ContentSource
 *   without touching the UI layer.
 * - UI functions only receive plain data objects; they know nothing about
 *   how that data was fetched.
 */

'use strict';

/* ============================================================
   CONFIG — edit this list to add or remove categories
   ============================================================ */
const CATEGORIES = [
  { id: 'church-steeples',       label: 'Church Steeples',        file: 'data/church-steeples.json' },
  { id: 'historic-bridges',      label: 'Historic Bridges',        file: 'data/historic-bridges.json' },
  { id: 'vintage-advertisements',label: 'Vintage Advertisements',  file: 'data/vintage-advertisements.json' },
  { id: 'nature',                label: 'Nature',                  file: 'data/nature.json' },
];

/* ============================================================
   CONTENT SOURCE
   Replace or extend this object to swap in an API or CMS.
   The contract: getEntry(categoryConfig, dateString) must return
   a Promise that resolves to an entry object { imageUrl, title,
   description } or null if nothing found.
   ============================================================ */
const ContentSource = {
  _cache: {},

  async _loadFile(file) {
    if (this._cache[file]) return this._cache[file];
    const res = await fetch(file);
    if (!res.ok) throw new Error(`Failed to load ${file} (${res.status})`);
    const data = await res.json();
    this._cache[file] = data;
    return data;
  },

  async getEntry(categoryConfig, dateString) {
    const data = await this._loadFile(categoryConfig.file);
    const entry = data.entries.find(e => e.date === dateString);
    return entry || null;
  }
};

/* ============================================================
   DATE HELPER
   ============================================================ */
function getTodayString() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const dd   = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatDisplayDate(dateString) {
  // dateString is YYYY-MM-DD; parse as local date (avoid UTC offset shift)
  const [y, m, day] = dateString.split('-').map(Number);
  const d = new Date(y, m - 1, day);
  return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

/* ============================================================
   STATE
   ============================================================ */
const state = {
  activeCategory: CATEGORIES[0].id,
  todayString: getTodayString(),
  renderSeq: 0,   // incremented each time renderContent is called; lets a
                  // stale async fetch detect it has been superseded
};

/* ============================================================
   DOM REFERENCES  (resolved after DOMContentLoaded)
   ============================================================ */
let dom = {};

function resolveDOM() {
  dom = {
    categoryNav:      document.getElementById('category-nav'),
    contentCard:      document.getElementById('content-card'),
    todayDate:        document.getElementById('today-date'),
    shareRow:         document.getElementById('share-row'),
    btnShare:         document.getElementById('btn-share'),
    modalOverlay:     document.getElementById('modal-overlay'),
    modalClose:       document.getElementById('modal-close'),
    shareForm:        document.getElementById('share-form'),
    recipientEmail:   document.getElementById('recipient-email'),
    personalMessage:  document.getElementById('personal-message'),
    previewTitle:     document.getElementById('preview-title'),
    previewCategory:  document.getElementById('preview-category'),
    formStatus:       document.getElementById('form-status'),
    btnSend:          document.getElementById('btn-send'),
  };
}

/* ============================================================
   CATEGORY NAV
   ============================================================ */
function buildCategoryNav() {
  dom.categoryNav.innerHTML = '';
  CATEGORIES.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'category-btn' + (cat.id === state.activeCategory ? ' active' : '');
    btn.textContent = cat.label;
    btn.dataset.id = cat.id;
    btn.addEventListener('click', () => selectCategory(cat.id));
    dom.categoryNav.appendChild(btn);
  });
}

function updateCategoryNav() {
  dom.categoryNav.querySelectorAll('.category-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.id === state.activeCategory);
  });
}

function selectCategory(id) {
  if (id === state.activeCategory) return;
  state.activeCategory = id;
  updateCategoryNav();
  renderContent();
}

/* ============================================================
   CONTENT CARD
   ============================================================ */
function renderSkeleton() {
  dom.contentCard.innerHTML = `
    <div class="content-image-wrap">
      <div class="img-placeholder skeleton"></div>
    </div>
    <div class="content-body">
      <div class="skeleton" style="width:90px;height:1.2em;margin-bottom:0.7rem;border-radius:4px;"></div>
      <div class="skeleton" style="width:70%;height:1.5em;margin-bottom:0.75rem;border-radius:4px;"></div>
      <div class="skeleton" style="width:100%;height:0.95em;margin-bottom:0.4rem;border-radius:4px;"></div>
      <div class="skeleton" style="width:85%;height:0.95em;border-radius:4px;"></div>
    </div>`;
  dom.shareRow.style.visibility = 'hidden';
}

function renderEntry(entry, categoryLabel) {
  dom.contentCard.innerHTML = `
    <div class="content-image-wrap">
      <div class="img-placeholder">&#x1F4F7;</div>
      <img src="${escHtml(entry.imageUrl)}"
           alt="${escHtml(entry.title)}"
           class="img-loading"
           loading="eager">
    </div>
    <div class="content-body">
      <span class="content-category-label">${escHtml(categoryLabel)}</span>
      <h2 class="content-title">${escHtml(entry.title)}</h2>
      <p class="content-description">${escHtml(entry.description)}</p>
    </div>`;

  // Fade in image once loaded.
  // Check .complete first — if the browser already has it cached the load
  // event fires before the listener is attached and the image stays invisible.
  const img = dom.contentCard.querySelector('img');
  if (img.complete) {
    img.classList.remove('img-loading');
  } else {
    img.addEventListener('load', () => img.classList.remove('img-loading'));
    img.addEventListener('error', () => { img.style.display = 'none'; });
  }

  dom.shareRow.style.visibility = 'visible';
}

function renderNoContent(categoryLabel) {
  dom.contentCard.innerHTML = `
    <div class="no-content">
      <span class="no-content-icon">&#x1F4C5;</span>
      <p>No content scheduled for <strong>${escHtml(categoryLabel)}</strong> today.</p>
      <p style="margin-top:0.5rem;font-size:0.85rem;">Check back tomorrow!</p>
    </div>`;
  dom.shareRow.style.visibility = 'hidden';
}

async function renderContent() {
  renderSkeleton();
  const seq = ++state.renderSeq;           // claim this render slot
  const cat = CATEGORIES.find(c => c.id === state.activeCategory);
  try {
    const entry = await ContentSource.getEntry(cat, state.todayString);
    if (seq !== state.renderSeq) return;   // a newer render started; discard
    if (entry) {
      renderEntry(entry, cat.label);
    } else {
      renderNoContent(cat.label);
    }
  } catch (err) {
    if (seq !== state.renderSeq) return;
    console.error('Failed to load content:', err);
    dom.contentCard.innerHTML = `
      <div class="no-content">
        <span class="no-content-icon">&#x26A0;</span>
        <p>Could not load today's content. Please try again.</p>
      </div>`;
    dom.shareRow.style.visibility = 'hidden';
  }
}

/* ============================================================
   SHARE MODAL
   ============================================================ */
function openModal() {
  // Populate preview snippet with current content
  const cat = CATEGORIES.find(c => c.id === state.activeCategory);
  const titleEl = dom.contentCard.querySelector('.content-title');
  if (dom.previewTitle && titleEl) {
    dom.previewTitle.textContent = titleEl.textContent;
  }
  if (dom.previewCategory) {
    dom.previewCategory.textContent = cat.label;
  }
  clearFormStatus();
  dom.modalOverlay.classList.add('open');
  dom.recipientEmail.focus();
}

function closeModal() {
  dom.modalOverlay.classList.remove('open');
  dom.shareForm.reset();
  clearFormStatus();
}

function clearFormStatus() {
  dom.formStatus.textContent = '';
  dom.formStatus.className = 'form-status';
}

function setFormStatus(message, type) {
  dom.formStatus.textContent = message;
  dom.formStatus.className = `form-status ${type}`;
}

/* ============================================================
   SHARE FORM SUBMISSION
   Sends data to send-mail.php via fetch (POST, JSON).
   PHP script is stubbed — see send-mail.php for details.
   ============================================================ */
async function handleShareSubmit(e) {
  e.preventDefault();
  const email   = dom.recipientEmail.value.trim();
  const message = dom.personalMessage.value.trim();

  if (!email) {
    setFormStatus('Please enter a recipient email address.', 'error');
    dom.recipientEmail.focus();
    return;
  }

  const cat = CATEGORIES.find(c => c.id === state.activeCategory);
  const titleEl = dom.contentCard.querySelector('.content-title');
  const title   = titleEl ? titleEl.textContent : '';

  const payload = {
    recipientEmail: email,
    personalMessage: message,
    contentTitle: title,
    contentCategory: cat.label,
    contentDate: state.todayString,
    shareUrl: window.location.href,
  };

  dom.btnSend.disabled = true;
  setFormStatus('Sending…', '');

  try {
    const res = await fetch('send-mail.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const json = await res.json().catch(() => ({}));

    if (res.ok && json.success) {
      setFormStatus('Sent! Your friend should receive it shortly.', 'success');
      dom.shareForm.reset();
    } else {
      const msg = json.message || 'Something went wrong. Please try again.';
      setFormStatus(msg, 'error');
    }
  } catch (err) {
    // Network error or PHP not yet configured
    setFormStatus('Could not reach the mail server. (PHP not yet configured?)', 'error');
    console.error('Share failed:', err);
  } finally {
    dom.btnSend.disabled = false;
  }
}

/* ============================================================
   UTILITY
   ============================================================ */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ============================================================
   INIT
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  resolveDOM();

  // Display today's date in the header
  if (dom.todayDate) {
    dom.todayDate.textContent = formatDisplayDate(state.todayString);
  }

  // Build UI
  buildCategoryNav();
  renderContent();

  // Share button
  dom.btnShare.addEventListener('click', openModal);
  dom.modalClose.addEventListener('click', closeModal);

  // Close modal on backdrop click
  dom.modalOverlay.addEventListener('click', e => {
    if (e.target === dom.modalOverlay) closeModal();
  });

  // Close modal on Escape key
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && dom.modalOverlay.classList.contains('open')) {
      closeModal();
    }
  });

  // Share form
  dom.shareForm.addEventListener('submit', handleShareSubmit);
});
