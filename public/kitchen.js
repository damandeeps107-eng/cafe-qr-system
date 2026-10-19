// Reference Restaurant Management Dashboard & Live Kitchen Engine with Hindi Voice Alerts
const socket = io();

// State
let orders = [];
let menuData = [];
let currentKdsFilter = 'active'; // 'active', 'pending', 'preparing', 'served', 'completed'
let activeNavView = 'dashboard';
let isMuted = false;
let audioContext = null;
let speechQueue = [];
let isSpeaking = false;
let availableVoices = [];
let completedItemChecks = {}; // { [orderId_itemId]: boolean }
let baseUrl = window.location.origin;

// -----------------------------------------------------------------------------
// 1. AUDIO CHIME & HINDI TEXT-TO-SPEECH ENGINE
// -----------------------------------------------------------------------------
function initAudio() {
  if (!audioContext) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioCtx();
  }
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }

  const ribbon = document.getElementById('audioBanner');
  if (ribbon) ribbon.style.display = 'none';
}

function playBellChime() {
  if (isMuted) return Promise.resolve();
  try {
    initAudio();
    const now = audioContext.currentTime;

    // Tone 1: High frequency chime (E5)
    const osc1 = audioContext.createOscillator();
    const gain1 = audioContext.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(659.25, now);

    gain1.gain.setValueAtTime(0.35, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

    osc1.connect(gain1);
    gain1.connect(audioContext.destination);

    osc1.start(now);
    osc1.stop(now + 0.6);

    // Tone 2: Harmonious chime (A5)
    const osc2 = audioContext.createOscillator();
    const gain2 = audioContext.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880.00, now + 0.15);

    gain2.gain.setValueAtTime(0.3, now + 0.15);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.9);

    osc2.connect(gain2);
    gain2.connect(audioContext.destination);

    osc2.start(now + 0.15);
    osc2.stop(now + 0.9);

    return new Promise(resolve => setTimeout(resolve, 800));
  } catch (e) {
    console.warn('Audio chime playback issue:', e);
    return Promise.resolve();
  }
}

function loadVoices() {
  if (!('speechSynthesis' in window)) return;
  availableVoices = window.speechSynthesis.getVoices();
}

if ('speechSynthesis' in window) {
  loadVoices();
  window.speechSynthesis.onvoiceschanged = loadVoices;
}

async function speakHindiText(hindiText, romanFallbackText = '') {
  if (isMuted) return;
  if (!('speechSynthesis' in window)) return;

  await playBellChime();

  speechQueue.push({ hindiText, romanFallbackText });
  processSpeechQueue();
}

function processSpeechQueue() {
  if (isSpeaking || speechQueue.length === 0) return;

  isSpeaking = true;
  const { hindiText, romanFallbackText } = speechQueue.shift();

  window.speechSynthesis.cancel();

  // Find Hindi voice
  let voice = availableVoices.find(v => v.lang.toLowerCase().includes('hi') || v.name.toLowerCase().includes('hindi'));
  let textToSpeak = hindiText;

  if (!voice) {
    // Look for Indian English voice
    voice = availableVoices.find(v => v.lang.toLowerCase().includes('en-in') || v.lang.toLowerCase().includes('in'));
  }

  if (!voice && availableVoices.length > 0) {
    voice = availableVoices[0];
    if (romanFallbackText) {
      textToSpeak = romanFallbackText;
    }
  }

  const utterance = new SpeechSynthesisUtterance(textToSpeak);
  if (voice) {
    utterance.voice = voice;
  }
  utterance.lang = voice ? voice.lang : 'hi-IN';
  utterance.rate = 0.95;
  utterance.pitch = 1.05;
  utterance.volume = 1.0;

  utterance.onend = () => {
    isSpeaking = false;
    setTimeout(processSpeechQueue, 300);
  };

  utterance.onerror = (e) => {
    console.warn('Speech synthesis error:', e);
    isSpeaking = false;
    processSpeechQueue();
  };

  window.speechSynthesis.speak(utterance);
}

function testHindiVoice() {
  initAudio();
  const testText = "टेबल नंबर दो से नया ऑर्डर आया है: एक क्रिस्पी पनीर बर्गर, दो वेज ग्रिल्ड सैंडविच।";
  const testRoman = "Table number 2 se naya order aaya hai: 1 Crispy Paneer Burger, 2 Veg Grilled Sandwich.";
  speakHindiText(testText, testRoman);
}

// -----------------------------------------------------------------------------
// 2. DATA FETCHING & REAL-TIME SYNC
// -----------------------------------------------------------------------------
let knownOrderIds = new Set();
let isPollingStarted = false;

async function initServerData() {
  try {
    const [infoRes, menuRes, ordersRes] = await Promise.all([
      fetch('/api/info'),
      fetch('/api/menu'),
      fetch('/api/orders')
    ]);

    const info = await infoRes.json();
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname.startsWith('192.168.');
    if (!isLocal) {
      // Live hosted domain (e.g., Vercel or custom domain)
      baseUrl = window.location.origin;
    } else if (info.tunnelUrl) {
      baseUrl = info.tunnelUrl;
    } else if (info.localWifiUrl) {
      baseUrl = info.localWifiUrl;
    } else {
      baseUrl = window.location.origin;
    }

    menuData = await menuRes.json();
    orders = await ordersRes.json();

    // Cache known orders to avoid duplicate voice announcements
    knownOrderIds = new Set(orders.map(o => o.id));

    renderDashboardOverview();
    renderKdsTickets();
    renderTablesManagement();
    renderAllOrdersView();
    renderMenuCatalog();

    if (window.lucide) lucide.createIcons();

    // Start background sync polling (guarantees real-time alerts on Vercel)
    startPollingFallback();
  } catch (err) {
    console.error('Failed to load initial server data', err);
  }
}

function startPollingFallback() {
  if (isPollingStarted) return;
  isPollingStarted = true;

  setInterval(async () => {
    try {
      const res = await fetch('/api/orders');
      if (!res.ok) return;
      const latestOrders = await res.json();

      // Find any order that arrived without socket notification (e.g. serverless Vercel)
      const brandNewOrders = latestOrders.filter(o => !knownOrderIds.has(o.id));
      if (brandNewOrders.length > 0) {
        brandNewOrders.reverse().forEach(newOrder => {
          knownOrderIds.add(newOrder.id);
          if (!orders.some(o => o.id === newOrder.id)) {
            orders.unshift(newOrder);
            playBellChime().then(() => {
              const speech = newOrder.speechText || `टेबल नंबर ${newOrder.tableNo} से नया ऑर्डर आया है!`;
              const roman = `New order from Table ${newOrder.tableNo}!`;
              speakHindiText(speech, roman);
            });
          }
        });
        renderDashboardOverview();
        renderKdsTickets();
        renderTablesManagement();
        renderAllOrdersView();
      }

      // Sync status updates
      let hasChanges = false;
      latestOrders.forEach(lo => {
        const local = orders.find(o => o.id === lo.id);
        if (local && local.status !== lo.status) {
          local.status = lo.status;
          hasChanges = true;
        }
      });
      if (hasChanges) {
        renderDashboardOverview();
        renderKdsTickets();
        renderTablesManagement();
        renderAllOrdersView();
      }
    } catch (e) {
      // silent polling error
    }
  }, 3500);
}


// -----------------------------------------------------------------------------
// 3. NAVIGATION VIEW SWITCHING
// -----------------------------------------------------------------------------
function switchNavView(viewName) {
  activeNavView = viewName;

  // Update Sidebar active state
  const navBtns = document.querySelectorAll('.nav-item-btn');
  navBtns.forEach(btn => {
    if (btn.dataset.target === viewName) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Hide all view sections, show target
  const sections = document.querySelectorAll('.view-section');
  sections.forEach(sec => sec.classList.remove('view-active'));

  const targetSec = document.getElementById(`view-${viewName}`);
  if (targetSec) {
    targetSec.classList.add('view-active');
  }

  // Update Header Titles
  const titleEl = document.getElementById('pageTitleHeading');
  const subEl = document.getElementById('pageSubtitleHeading');

  const titlesMap = {
    'dashboard': { title: 'Dashboard', sub: "Welcome back, Manager! Here's what's happening today." },
    'orders': { title: 'Order Management', sub: 'Track and manage live incoming and fulfilled customer orders.' },
    'tables': { title: 'Tables & QR Suite', sub: 'Monitor table occupancy and download or print table QR standees.' },
    'kitchen': { title: 'Kitchen Display System (KDS)', sub: 'Live kitchen orders production display with audio announcements.' },
    'menus': { title: 'Menu Catalog', sub: 'Artisanal dishes, pricing, dietary indicators, and availability.' },
    'analytics': { title: 'Analytics & Reports', sub: 'Revenue insights, guest volume velocity, and product contribution.' },
    'help': { title: 'Help & Knowledge Center', sub: 'Guidelines for operating the contactless QR system and POS.' },
    'settings': { title: 'Store Settings', sub: 'Restaurant profile, audio synthesis configuration, and preferences.' }
  };

  const meta = titlesMap[viewName] || { title: 'Dashboard', sub: '' };
  if (titleEl) titleEl.innerText = meta.title;
  if (subEl) subEl.innerText = meta.sub;

  if (window.lucide) lucide.createIcons();
}

// -----------------------------------------------------------------------------
// 4. DASHBOARD OVERVIEW RENDERER (ROW 1, ROW 2, ROW 3)
// -----------------------------------------------------------------------------
function renderDashboardOverview() {
  const pendingOrders = orders.filter(o => o.status === 'pending');
  const preparingOrders = orders.filter(o => o.status === 'preparing');
  const servedOrders = orders.filter(o => o.status === 'served');
  const completedOrders = orders.filter(o => o.status === 'completed');

  // 1. Row 1: Statistics Cards
  const pendingEl = document.getElementById('statPendingOrders');
  const inProgressEl = document.getElementById('statOrdersInProgress');
  const availableTablesEl = document.getElementById('statAvailableTables');

  if (pendingEl) pendingEl.innerText = pendingOrders.length;
  if (inProgressEl) inProgressEl.innerText = preparingOrders.length;

  // Calculate occupied tables
  const occupiedTables = new Set(
    orders
      .filter(o => o.status === 'pending' || o.status === 'preparing' || o.status === 'served')
      .map(o => o.tableNo)
  );
  const availableCount = Math.max(0, 12 - occupiedTables.size);
  if (availableTablesEl) availableTablesEl.innerText = `${availableCount} / 12`;

  // Update Sidebar Badges
  const ordersBadge = document.getElementById('sidebarOrdersBadge');
  if (ordersBadge) ordersBadge.innerText = pendingOrders.length + preparingOrders.length;

  // 2. Row 2: Total Revenue & Business Data
  const totalRevenue = orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
  const totalOrdersCount = orders.length;
  const aov = totalOrdersCount > 0 ? Math.round(totalRevenue / totalOrdersCount) : 0;

  const revEl = document.getElementById('revenueHeadlineValue');
  const custEl = document.getElementById('statCustomersCount');
  const ordEl = document.getElementById('statTotalOrdersCount');
  const aovEl = document.getElementById('statAovValue');

  if (revEl) revEl.innerText = `₹${totalRevenue.toLocaleString('en-IN')}`;
  if (custEl) custEl.innerText = `${totalOrdersCount * 2 + 12} Guests`;
  if (ordEl) ordEl.innerText = `${totalOrdersCount} Orders`;
  if (aovEl) aovEl.innerText = `₹${aov} AOV`;

  // 3. Row 3: Recent Activity (Actual recent orders)
  const activityList = document.getElementById('recentActivityList');
  if (activityList) {
    if (orders.length === 0) {
      activityList.innerHTML = '<p style="color: var(--secondary-text); padding: 16px 0; font-size: 13px;">No recent order activity yet.</p>';
    } else {
      activityList.innerHTML = orders.slice(0, 5).map(o => {
        const firstItem = o.items && o.items[0] ? o.items[0] : { name: 'Gourmet Dish' };
        const matchingDish = menuData.find(d => d.name === firstItem.name);
        const thumb = matchingDish ? matchingDish.image : '/images/burger.jpg';

        const elapsed = getElapsedFormatted(o.createdAt);
        let badgeClass = 'badge-pending';
        let badgeLabel = 'Pending';
        if (o.status === 'preparing') { badgeClass = 'badge-preparing'; badgeLabel = 'Preparing'; }
        if (o.status === 'served') { badgeClass = 'badge-served'; badgeLabel = 'Served'; }
        if (o.status === 'completed') { badgeClass = 'badge-completed'; badgeLabel = 'Completed'; }

        const itemsSummary = o.items ? o.items.map(i => `${i.qty}× ${i.name}`).join(', ') : 'Order items';

        return `
          <div class="activity-row-item">
            <div class="activity-item-left">
              <img src="${thumb}" alt="${firstItem.name}" class="activity-dish-thumb" onerror="this.src='/images/burger.jpg'">
              <div class="activity-item-text">
                <span class="activity-order-title">Table ${o.tableNo < 10 ? '0' + o.tableNo : o.tableNo} — ${itemsSummary}</span>
                <span class="activity-order-sub">#${o.id} • Total: ₹${o.totalAmount}</span>
              </div>
            </div>
            <div class="activity-item-right">
              <span class="activity-time-stamp">${elapsed}</span>
              <span class="status-badge-chip ${badgeClass}">${badgeLabel}</span>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  // 4. Row 3: Top Dishes (Curated menu specials)
  const topDishesList = document.getElementById('topDishesList');
  if (topDishesList && menuData.length > 0) {
    const popular = menuData.filter(m => m.isBestseller).slice(0, 4);
    topDishesList.innerHTML = popular.map((dish, i) => `
      <div class="top-dish-row">
        <div class="top-dish-left">
          <img src="${dish.image}" alt="${dish.name}" class="top-dish-thumb" onerror="this.src='/images/burger.jpg'">
          <div>
            <div class="top-dish-name">${dish.name}</div>
            <div class="top-dish-price">₹${dish.price} • ${dish.category}</div>
          </div>
        </div>
        <span class="top-dish-count-tag">${36 - i * 6} orders</span>
      </div>
    `).join('');
  }
}

// -----------------------------------------------------------------------------
// 5. KITCHEN DISPLAY SYSTEM (KDS) PRODUCTION TICKETS
// -----------------------------------------------------------------------------
function renderKdsTickets() {
  const grid = document.getElementById('kdsTicketsGrid');
  if (!grid) return;

  // Filter counters
  const activeOrders = orders.filter(o => o.status !== 'completed' && o.status !== 'cancelled');
  const pendingOrders = orders.filter(o => o.status === 'pending');
  const cookingOrders = orders.filter(o => o.status === 'preparing');
  const servedOrders = orders.filter(o => o.status === 'served');
  const completedOrders = orders.filter(o => o.status === 'completed');

  document.getElementById('kdsBadgeActive').innerText = activeOrders.length;
  document.getElementById('kdsBadgePending').innerText = pendingOrders.length;
  document.getElementById('kdsBadgeCooking').innerText = cookingOrders.length;
  document.getElementById('kdsBadgeServed').innerText = servedOrders.length;
  document.getElementById('kdsBadgeCompleted').innerText = completedOrders.length;

  const filtered = orders.filter(o => {
    if (currentKdsFilter === 'active') return o.status !== 'completed' && o.status !== 'cancelled';
    return o.status === currentKdsFilter;
  });

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; background: #fff; border: 1px solid var(--border-color); border-radius: var(--radius-lg); padding: 60px 20px; text-align: center; color: var(--secondary-text);">
        <i data-lucide="inbox" style="width: 36px; height: 36px; margin-bottom: 10px; color: var(--muted-text);"></i>
        <h3 style="font-size: 16px; font-weight: 700; color: var(--primary-text);">No Tickets in this Stage</h3>
        <p style="font-size: 13px; margin-top: 4px;">Orders placed by guests at tables will appear here in real time.</p>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
    return;
  }

  grid.innerHTML = filtered.map(order => {
    const elapsed = getElapsedFormatted(order.createdAt);
    const tableFmt = order.tableNo < 10 ? `0${order.tableNo}` : order.tableNo;

    // Items list with strikethrough check
    const itemsHtml = order.items.map((it, idx) => {
      const isDone = !!completedItemChecks[`${order.id}_${idx}`];
      return `
        <div class="kds-item-row ${isDone ? 'is-done' : ''}" onclick="toggleKdsItemCheck('${order.id}', ${idx})" title="Click to strike-through when cooked">
          <div style="display: flex; align-items: center;">
            <span class="kds-item-qty">${it.qty}×</span>
            <span class="kds-item-name">${it.name}</span>
          </div>
          <span class="kds-item-price">₹${it.price * it.qty}</span>
        </div>
      `;
    }).join('');

    // Action button
    let actionBtnHtml = '';
    if (order.status === 'pending') {
      actionBtnHtml = `
        <button class="btn-kds-primary" onclick="updateOrderStatus('${order.id}', 'preparing')">
          <i data-lucide="flame" style="width: 14px; height: 14px;"></i>
          <span>Accept & Start Cook</span>
        </button>
      `;
    } else if (order.status === 'preparing') {
      actionBtnHtml = `
        <button class="btn-kds-primary" onclick="updateOrderStatus('${order.id}', 'served')">
          <i data-lucide="check" style="width: 14px; height: 14px;"></i>
          <span>Mark as Served</span>
        </button>
      `;
    } else if (order.status === 'served') {
      actionBtnHtml = `
        <button class="btn-kds-secondary" onclick="updateOrderStatus('${order.id}', 'completed')">
          <i data-lucide="archive" style="width: 14px; height: 14px;"></i>
          <span>Archive Ticket</span>
        </button>
      `;
    } else {
      actionBtnHtml = `
        <div style="font-size: 13px; color: var(--primary-green); font-weight: 700; text-align: center; padding: 8px 0;">
          ✓ Completed & Settled
        </div>
      `;
    }

    return `
      <div class="kds-order-card" id="kds-ticket-${order.id}">
        <div class="kds-card-header">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="kds-table-badge">Table ${tableFmt}</span>
            <span style="font-size: 12px; font-weight: 600; color: var(--secondary-text);">#${order.id}</span>
          </div>
          <div class="kds-order-timer">${elapsed}</div>
        </div>

        ${order.specialNote ? `
          <div class="kds-note-box">
            <i data-lucide="alert-circle" style="width: 16px; height: 16px; flex-shrink: 0; margin-top: 1px;"></i>
            <div><strong>Chef Note:</strong> "${order.specialNote}"</div>
          </div>
        ` : ''}

        <div class="kds-items-list">
          ${itemsHtml}
        </div>

        <div class="kds-card-footer">
          <div class="kds-footer-meta">
            <span style="color: var(--secondary-text); font-weight: 600;">
              ${order.items.reduce((s, it) => s + it.qty, 0)} Total Items
            </span>
            <span style="font-size: 15px; font-weight: 800; color: var(--primary-text);">
              Total: ₹${order.totalAmount}
            </span>
          </div>

          <div class="kds-action-buttons">
            ${actionBtnHtml}
            <button class="btn-kds-secondary" onclick="replayOrderVoice('${order.id}')" title="Replay Hindi Voice Announcement">
              <i data-lucide="volume-2" style="width: 14px; height: 14px;"></i>
              <span>Announce</span>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

function toggleKdsItemCheck(orderId, itemIndex) {
  const key = `${orderId}_${itemIndex}`;
  completedItemChecks[key] = !completedItemChecks[key];
  renderKdsTickets();
}

async function updateOrderStatus(orderId, newStatus) {
  try {
    const res = await fetch(`/api/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });
    const updated = await res.json();
    const idx = orders.findIndex(o => o.id === orderId);
    if (idx !== -1) {
      orders[idx] = updated;
    }
    renderDashboardOverview();
    renderKdsTickets();
    renderAllOrdersView();
  } catch (err) {
    console.error('Failed to update status', err);
  }
}

function replayOrderVoice(orderId) {
  initAudio();
  const order = orders.find(o => o.id === orderId);
  if (!order) return;

  const hindiSpeech = order.speechText || `टेबल नंबर ${order.tableNo} से नया आर्डर आया है।`;
  const romanSpeech = `Table number ${order.tableNo} se order aaya hai: ${order.items.map(i => `${i.qty} ${i.name}`).join(', ')}`;
  speakHindiText(hindiSpeech, romanSpeech);
}

// -----------------------------------------------------------------------------
// 6. TABLES & QR CODES MANAGEMENT RENDERER
// -----------------------------------------------------------------------------
function renderTablesManagement() {
  const grid = document.getElementById('tablesManagementGrid');
  if (!grid) return;

  grid.innerHTML = '';
  const occupiedTables = new Set(
    orders
      .filter(o => o.status === 'pending' || o.status === 'preparing' || o.status === 'served')
      .map(o => o.tableNo)
  );

  for (let tableNo = 1; tableNo <= 12; tableNo++) {
    const isOccupied = occupiedTables.has(tableNo);
    const tableFmt = tableNo < 10 ? `0${tableNo}` : tableNo;
    const targetUrl = `${baseUrl}/order?table=${tableNo}`;

    const card = document.createElement('div');
    card.className = 'table-management-card';
    card.innerHTML = `
      <div class="table-card-top-bar">
        <span class="table-title-bold">Table ${tableFmt}</span>
        <span class="table-status-pill ${isOccupied ? 'status-occupied' : 'status-available'}">
          ${isOccupied ? '● Occupied' : '● Available'}
        </span>
      </div>

      <div class="table-qr-frame">
        <canvas id="qr-table-canvas-${tableNo}" class="table-qr-canvas"></canvas>
      </div>

      <p style="font-size: 11px; font-family: monospace; color: var(--secondary-text); word-break: break-all; margin-bottom: 14px;">
        ${targetUrl}
      </p>

      <div class="table-card-actions">
        <a href="${targetUrl}" target="_blank" class="btn-table-action">
          <i data-lucide="external-link" style="width: 14px; height: 14px;"></i>
          <span>Open Menu</span>
        </a>
        <button class="btn-table-action" onclick="downloadTableQR(${tableNo})">
          <i data-lucide="download" style="width: 14px; height: 14px;"></i>
          <span>Download</span>
        </button>
      </div>
    `;

    grid.appendChild(card);
    generateQrForTable(tableNo, targetUrl);
  }

  if (window.lucide) lucide.createIcons();
}

function generateQrForTable(tableNo, url) {
  const canvas = document.getElementById(`qr-table-canvas-${tableNo}`);
  if (!canvas) return;

  if (window.QRCode && typeof QRCode.toCanvas === 'function') {
    QRCode.toCanvas(canvas, url, {
      width: 180,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });
  }
}

function renderBigModalQr(tableNo = 2) {
  const canvas = document.getElementById('modalQrCanvas');
  const linkText = document.getElementById('modalQrLinkText');
  const openDirect = document.getElementById('modalOpenDirectBtn');
  if (!canvas) return;

  const targetUrl = `${baseUrl}/order?table=${tableNo}`;
  if (linkText) linkText.innerText = targetUrl;
  if (openDirect) openDirect.href = targetUrl;

  if (window.QRCode && typeof QRCode.toCanvas === 'function') {
    QRCode.toCanvas(canvas, targetUrl, {
      width: 230,
      margin: 3,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });
  }
}

function setupMobileQrModal() {
  const modal = document.getElementById('mobileQrScanModal');
  const openBtn = document.getElementById('openMobileQrModalBtn');
  const closeBtn = document.getElementById('closeMobileQrModalBtn');
  const tableSelect = document.getElementById('modalTableSelect');
  const copyBtn = document.getElementById('modalCopyLinkBtn');
  const copyText = document.getElementById('copyLinkBtnText');

  if (openBtn) {
    openBtn.addEventListener('click', () => {
      const selected = tableSelect ? parseInt(tableSelect.value, 10) : 2;
      renderBigModalQr(selected);
      if (modal) modal.classList.add('open');
      if (window.lucide) lucide.createIcons();
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      if (modal) modal.classList.remove('open');
    });
  }

  if (tableSelect) {
    tableSelect.addEventListener('change', (e) => {
      renderBigModalQr(parseInt(e.target.value, 10));
    });
  }

  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const selected = tableSelect ? tableSelect.value : '2';
      const urlToCopy = `${baseUrl}/order?table=${selected}`;
      try {
        await navigator.clipboard.writeText(urlToCopy);
        if (copyText) copyText.innerText = 'Copied! ✓';
        setTimeout(() => {
          if (copyText) copyText.innerText = 'Copy Link';
        }, 2200);
      } catch (e) {
        prompt('Copy this link to open on phone:', urlToCopy);
      }
    });
  }
}

function downloadTableQR(tableNo) {
  const canvas = document.getElementById(`qr-table-canvas-${tableNo}`);
  if (!canvas) return;

  const link = document.createElement('a');
  link.download = `RoyalCafe_Table_${tableNo < 10 ? '0' + tableNo : tableNo}_QR.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

// -----------------------------------------------------------------------------
// 7. ALL ORDERS & MENU CATALOG VIEWS
// -----------------------------------------------------------------------------
function renderAllOrdersView() {
  const container = document.getElementById('allOrdersTableView');
  if (!container) return;

  if (orders.length === 0) {
    container.innerHTML = '<p style="color: var(--secondary-text); padding: 16px;">No orders found.</p>';
    return;
  }

  container.innerHTML = orders.map(o => {
    let badgeClass = 'badge-pending';
    if (o.status === 'preparing') badgeClass = 'badge-preparing';
    if (o.status === 'served') badgeClass = 'badge-served';
    if (o.status === 'completed') badgeClass = 'badge-completed';

    const itemsSummary = o.items ? o.items.map(i => `${i.qty}× ${i.name}`).join(', ') : '';

    return `
      <div class="activity-row-item">
        <div class="activity-item-left">
          <div style="width: 40px; height: 40px; border-radius: 8px; background: #FAFAFA; border: 1px solid var(--border-color); display: flex; align-items: center; justify-content: center; font-weight: 800; color: var(--primary-green);">
            T${o.tableNo}
          </div>
          <div class="activity-item-text">
            <span class="activity-order-title">${itemsSummary}</span>
            <span class="activity-order-sub">#${o.id} • ${new Date(o.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • Note: ${o.specialNote || 'None'}</span>
          </div>
        </div>
        <div class="activity-item-right">
          <span style="font-weight: 700; font-size: 14px;">₹${o.totalAmount}</span>
          <span class="status-badge-chip ${badgeClass}">${o.status}</span>
        </div>
      </div>
    `;
  }).join('');
}

function renderMenuCatalog() {
  const container = document.getElementById('menuManagementCatalog');
  if (!container || menuData.length === 0) return;

  container.innerHTML = menuData.map(dish => `
    <div class="activity-row-item">
      <div class="activity-item-left">
        <img src="${dish.image}" alt="${dish.name}" class="activity-dish-thumb" onerror="this.src='/images/burger.jpg'">
        <div class="activity-item-text">
          <span class="activity-order-title">${dish.name}</span>
          <span class="activity-order-sub">${dish.category} • ${dish.description}</span>
        </div>
      </div>
      <div class="activity-item-right">
        <span style="font-weight: 800; font-size: 15px; color: var(--primary-text);">₹${dish.price}</span>
        <span class="status-badge-chip badge-served">${dish.isVeg ? 'Vegetarian' : 'Standard'}</span>
      </div>
    </div>
  `).join('');
}

// -----------------------------------------------------------------------------
// 8. HELPERS & FORMATTING
// -----------------------------------------------------------------------------
function getElapsedFormatted(isoString) {
  const diffSec = Math.floor((new Date() - new Date(isoString)) / 1000);
  if (diffSec < 60) return 'Just now';
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ago`;
}

// -----------------------------------------------------------------------------
// 9. REAL-TIME SOCKET.IO EVENT LISTENERS
// -----------------------------------------------------------------------------
socket.on('new_order', (newOrder) => {
  orders.unshift(newOrder);

  renderDashboardOverview();
  renderKdsTickets();
  renderTablesManagement();
  renderAllOrdersView();

  // Announce in Hindi
  initAudio();
  const hindiSpeech = newOrder.speechText || `टेबल नंबर ${newOrder.tableNo} से नया आर्डर आया है।`;
  const romanSpeech = `Table number ${newOrder.tableNo} se naya order aaya hai: ${newOrder.items.map(i => `${i.qty} ${i.name}`).join(', ')}`;

  speakHindiText(hindiSpeech, romanSpeech);
});

socket.on('order_status_updated', (updated) => {
  const idx = orders.findIndex(o => o.id === updated.id);
  if (idx !== -1) {
    orders[idx] = updated;
    renderDashboardOverview();
    renderKdsTickets();
    renderTablesManagement();
    renderAllOrdersView();
  }
});

socket.on('waiter_called', (alert) => {
  initAudio();

  const container = document.getElementById('serviceAlertContainer');
  if (container) {
    const toast = document.createElement('div');
    toast.className = 'guest-call-alert';
    toast.innerHTML = `
      <i data-lucide="bell" style="width: 22px; height: 22px; color: #EF4444;"></i>
      <div>
        <div style="font-weight: 800; font-size: 14px; color: #171717;">Assistance Request: Table ${alert.tableNo}</div>
        <div style="font-size: 12px; color: #737373;">Request: <strong>${alert.requestType}</strong></div>
      </div>
      <button onclick="this.parentElement.remove()" style="margin-left: 14px; background: none; border: none; font-size: 16px; cursor: pointer; color: #737373;">✕</button>
    `;
    container.appendChild(toast);
    if (window.lucide) lucide.createIcons();
    setTimeout(() => toast.remove(), 10000);
  }

  const hindiSpeech = `ध्यान दें! टेबल नंबर ${alert.tableNo} ने ${alert.requestType} के लिए बुलाया है!`;
  const romanSpeech = `Attention! Table number ${alert.tableNo} requested ${alert.requestType}!`;
  speakHindiText(hindiSpeech, romanSpeech);
});

// -----------------------------------------------------------------------------
// 10. LIFECYCLE & EVENT BINDINGS
// -----------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  initServerData();
  setupMobileQrModal();

  // Navigation Items click
  const navBtns = document.querySelectorAll('.nav-item-btn');
  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.target;
      switchNavView(target);
    });
  });

  // KDS Filter Pills click
  const kdsPills = document.querySelectorAll('.kds-filter-pill');
  kdsPills.forEach(pill => {
    pill.addEventListener('click', () => {
      kdsPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentKdsFilter = pill.dataset.filter;
      renderKdsTickets();
    });
  });

  // Audio Buttons
  document.getElementById('enableAudioBtn')?.addEventListener('click', () => {
    initAudio();
    testHindiVoice();
  });

  document.getElementById('testVoiceBtn')?.addEventListener('click', () => {
    testHindiVoice();
  });

  document.getElementById('kdsReplayVoiceBtn')?.addEventListener('click', () => {
    testHindiVoice();
  });

  // Mute / Unmute
  document.getElementById('kdsMuteToggleBtn')?.addEventListener('click', () => {
    isMuted = !isMuted;
    const txt = document.getElementById('kdsMuteStatusText');
    if (txt) txt.innerText = isMuted ? 'Muted' : 'Sound On';
  });

  // Audio unlock on any first user interaction
  document.body.addEventListener('click', initAudio, { once: true });
});
