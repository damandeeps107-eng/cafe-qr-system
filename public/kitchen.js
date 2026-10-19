// Reference Restaurant Management Dashboard & Live Kitchen Engine with Professional POS Voice Notifications
let socket = null;
try {
  if (typeof io === 'function') {
    socket = io({ transports: ['websocket', 'polling'], timeout: 4000 });
  }
} catch (e) {
  console.warn('Socket.IO initialization bypassed, will use auto-polling fallback:', e);
}

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
let manualOccupiedTables = new Set();
let baseUrl = window.location.origin;

// -----------------------------------------------------------------------------
// 1. PROFESSIONAL RESTAURANT POS BELL CHIME & NATURAL FEMALE VOICE ENGINE
// -----------------------------------------------------------------------------
function initAudio() {
  if (!audioContext) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) audioContext = new AudioCtx();
  }
  if (audioContext && audioContext.state === 'suspended') {
    audioContext.resume();
  }

  const ribbon = document.getElementById('audioBanner');
  if (ribbon) ribbon.style.display = 'none';

  localStorage.setItem('pos_audio_unlocked', 'true');
}

/**
 * Modern 3-Tone Restaurant POS Chime (Harmonic Acoustic Chime)
 * Note 1: C6 (1046.5 Hz) -> Note 2: E6 (1318.5 Hz) -> Note 3: G6 (1567.98 Hz)
 */
function playPosChime() {
  if (isMuted) return Promise.resolve();
  try {
    initAudio();
    if (!audioContext) return Promise.resolve();
    const now = audioContext.currentTime;

    // Note 1: C6 (1046.5 Hz) - bright entrance
    const osc1 = audioContext.createOscillator();
    const gain1 = audioContext.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(1046.5, now);
    gain1.gain.setValueAtTime(0.38, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc1.connect(gain1);
    gain1.connect(audioContext.destination);
    osc1.start(now);
    osc1.stop(now + 0.3);

    // Note 2: E6 (1318.5 Hz) - warm major harmonic
    const osc2 = audioContext.createOscillator();
    const gain2 = audioContext.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1318.5, now + 0.09);
    gain2.gain.setValueAtTime(0.42, now + 0.09);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.42);
    osc2.connect(gain2);
    gain2.connect(audioContext.destination);
    osc2.start(now + 0.09);
    osc2.stop(now + 0.42);

    // Note 3: G6 (1567.98 Hz) - bell resolution with extended acoustic decay
    const osc3 = audioContext.createOscillator();
    const gain3 = audioContext.createGain();
    osc3.type = 'triangle';
    osc3.frequency.setValueAtTime(1567.98, now + 0.18);
    gain3.gain.setValueAtTime(0.48, now + 0.18);
    gain3.gain.exponentialRampToValueAtTime(0.0001, now + 0.85);
    osc3.connect(gain3);
    gain3.connect(audioContext.destination);
    osc3.start(now + 0.18);
    osc3.stop(now + 0.85);

    // Subtle overtone (3135 Hz) for crispness
    const oscOver = audioContext.createOscillator();
    const gainOver = audioContext.createGain();
    oscOver.type = 'sine';
    oscOver.frequency.setValueAtTime(3135.96, now + 0.18);
    gainOver.gain.setValueAtTime(0.12, now + 0.18);
    gainOver.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
    oscOver.connect(gainOver);
    gainOver.connect(audioContext.destination);
    oscOver.start(now + 0.18);
    oscOver.stop(now + 0.55);

    return new Promise(resolve => setTimeout(resolve, 650));
  } catch (e) {
    console.warn('POS Chime playback issue:', e);
    return Promise.resolve();
  }
}

/**
 * Intelligent Natural Female Indian English Voice Selector
 */
function loadVoices() {
  if (!('speechSynthesis' in window)) return;
  availableVoices = window.speechSynthesis.getVoices();
  populateVoiceSelectDropdown();
}

if ('speechSynthesis' in window) {
  loadVoices();
  window.speechSynthesis.onvoiceschanged = loadVoices;
}

function getBestNaturalFemaleVoice() {
  if (!availableVoices || availableVoices.length === 0) {
    if ('speechSynthesis' in window) {
      availableVoices = window.speechSynthesis.getVoices();
    }
  }

  // 1. Check user-saved custom selection
  const savedURI = localStorage.getItem('pos_selected_voice_uri');
  if (savedURI && availableVoices && availableVoices.length > 0) {
    const saved = availableVoices.find(v => v.voiceURI === savedURI || v.name === savedURI);
    if (saved) return saved;
  }

  if (!availableVoices || availableVoices.length === 0) return null;

  // 2. Score voices according to natural Indian English female criteria
  function scoreVoice(voice) {
    const name = (voice.name || '').toLowerCase();
    const lang = (voice.lang || '').toLowerCase().replace(/_/g, '-');
    let score = 0;

    const isIndian = lang.includes('en-in') || lang.includes('hi-in');
    const isFemale = name.includes('female') || name.includes('tara') || name.includes('heera') ||
                     name.includes('neerja') || name.includes('veena') || name.includes('kajal') ||
                     name.includes('raveena') || name.includes('lekha') || name.includes('siri') ||
                     name.includes('samantha') || name.includes('karen') || name.includes('victoria') ||
                     name.includes('zira') || name.includes('jenny') || name.includes('aria') ||
                     name.includes('priya') || name.includes('swara') || name.includes('pooja');

    const isNatural = name.includes('natural') || name.includes('online') || name.includes('neural') || name.includes('google');

    // Tier 1: Natural Female Indian English (e.g., Heera Natural, Tara, Neerja, Google Indian English Female)
    if (isIndian && isFemale && isNatural) score += 1000;
    else if (isIndian && isFemale) score += 800;
    else if (isIndian) score += 500;

    // Tier 2: Natural Female English (e.g., Google UK English Female, Jenny, Samantha)
    if (!isIndian && isFemale && isNatural) score += 400;
    else if (!isIndian && isFemale) score += 300;

    // Tier 3: Any English
    if (lang.startsWith('en')) score += 100;

    return score;
  }

  const sorted = [...availableVoices].sort((a, b) => scoreVoice(b) - scoreVoice(a));
  return sorted[0] || null;
}

function populateVoiceSelectDropdown() {
  const select = document.getElementById('posVoiceSelect');
  if (!select) return;

  select.innerHTML = '';
  const best = getBestNaturalFemaleVoice();
  const savedURI = localStorage.getItem('pos_selected_voice_uri');

  // Option: Auto-Detect
  const autoOpt = document.createElement('option');
  autoOpt.value = '';
  autoOpt.innerText = `Auto-Detect (Recommended: ${best ? best.name : 'Natural Female'})`;
  if (!savedURI) autoOpt.selected = true;
  select.appendChild(autoOpt);

  availableVoices.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v.voiceURI || v.name;
    const isInd = v.lang.toLowerCase().includes('in');
    opt.innerText = `${v.name} (${v.lang})${isInd ? ' 🇮🇳' : ''}`;
    if (savedURI && (v.voiceURI === savedURI || v.name === savedURI)) {
      opt.selected = true;
    }
    select.appendChild(opt);
  });
}

/**
 * Text Transformation Helpers for Natural Speaking Delivery
 */
function numberToWord(num) {
  const map = {
    1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five',
    6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten',
    11: 'eleven', 12: 'twelve', 13: 'thirteen', 14: 'fourteen',
    15: 'fifteen', 16: 'sixteen', 17: 'seventeen', 18: 'eighteen',
    19: 'nineteen', 20: 'twenty'
  };
  return map[num] || num.toString();
}

function capitalize(text) {
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Builds the exact reference announcement format:
 * "New order received! Table number five. Two Chilli Paneer, one Veg Burger, and one Cold Coffee."
 */
function buildPosOrderAnnouncement(order) {
  const tableWord = numberToWord(order.tableNo);

  if (!order.items || order.items.length === 0) {
    return `New order received! Table number ${tableWord}.`;
  }

  const itemsList = order.items.map(item => {
    const qtyWord = numberToWord(item.qty);
    const cleanName = (item.name || '').replace(/\(.*\)/g, '').trim();
    return `${qtyWord} ${cleanName}`;
  });

  let itemsPhrase = '';
  if (itemsList.length === 1) {
    itemsPhrase = capitalize(itemsList[0]);
  } else if (itemsList.length === 2) {
    itemsPhrase = `${capitalize(itemsList[0])} and ${itemsList[1]}`;
  } else {
    const lastItem = itemsList.pop();
    itemsPhrase = `${capitalize(itemsList.join(', '))}, and ${lastItem}`;
  }

  return `New order received! Table number ${tableWord}. ${itemsPhrase}.`;
}

/**
 * Sequential Speech Queue System to avoid overlapping announcements
 */
function announceNewOrder(order) {
  if (isMuted) return;

  const announcementText = buildPosOrderAnnouncement(order);
  speechQueue.push(announcementText);
  processSpeechQueue();
}

async function processSpeechQueue() {
  if (isSpeaking || speechQueue.length === 0) return;
  if (!('speechSynthesis' in window)) return;

  isSpeaking = true;
  const textToSpeak = speechQueue.shift();

  // 1. Play pleasant POS notification chime
  await playPosChime();

  // 2. Breath pause between chime and spoken words
  await new Promise(r => setTimeout(r, 120));

  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(textToSpeak);
  const voice = getBestNaturalFemaleVoice();
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang || 'en-IN';
  } else {
    utterance.lang = 'en-IN';
  }

  // Smooth, slightly energetic POS delivery tempo
  const speed = parseFloat(localStorage.getItem('pos_voice_rate') || '1.02');
  const pitch = parseFloat(localStorage.getItem('pos_voice_pitch') || '1.08');
  utterance.rate = speed;
  utterance.pitch = pitch;
  utterance.volume = 1.0;

  utterance.onend = () => {
    isSpeaking = false;
    setTimeout(processSpeechQueue, 350);
  };

  utterance.onerror = (e) => {
    console.warn('Speech synthesis utterance issue:', e);
    isSpeaking = false;
    setTimeout(processSpeechQueue, 350);
  };

  window.speechSynthesis.speak(utterance);
}

/**
 * Test Announcement matching the exact reference requirement
 */
function testVoiceAnnouncement() {
  initAudio();
  const sampleOrder = {
    tableNo: 5,
    items: [
      { qty: 2, name: 'Chilli Paneer' },
      { qty: 1, name: 'Veg Burger' },
      { qty: 1, name: 'Cold Coffee' }
    ]
  };

  const announcement = buildPosOrderAnnouncement(sampleOrder);
  speechQueue.push(announcement);
  processSpeechQueue();

  showToast('Playing POS Voice Announcement...', '🎙️');
}

// -----------------------------------------------------------------------------
// 2. UNIVERSAL QR CODE RENDERER (Supports Canvas, Div & Image Fallback)
// -----------------------------------------------------------------------------
function drawQRCode(element, text, size = 180) {
  if (!element) return;
  element.innerHTML = '';

  // 1. Try bundled QRCode (qrcodejs)
  if (typeof QRCode === 'function') {
    try {
      new QRCode(element, {
        text: text,
        width: size,
        height: size,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: (QRCode.CorrectLevel && QRCode.CorrectLevel.M) || 0
      });
      return;
    } catch (e) {
      console.warn('QRCode constructor error, using image fallback:', e);
    }
  }

  // 2. High resolution fallback image
  const img = document.createElement('img');
  img.src = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(text)}`;
  img.alt = 'QR Code';
  img.style.width = `${size}px`;
  img.style.height = `${size}px`;
  img.style.display = 'block';
  img.style.margin = '0 auto';
  element.appendChild(img);
}

// Toast Notification
function showToast(message, icon = '✓') {
  let toast = document.getElementById('dashboardToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'dashboardToast';
    toast.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #171717;
      color: #FFFFFF;
      padding: 12px 20px;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 10px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.25);
      z-index: 99999;
      transform: translateY(100px);
      transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    `;
    document.body.appendChild(toast);
  }

  toast.innerHTML = `<span style="font-size: 16px;">${icon}</span><span>${message}</span>`;
  toast.style.transform = 'translateY(0)';
  setTimeout(() => {
    toast.style.transform = 'translateY(100px)';
  }, 2600);
}

// -----------------------------------------------------------------------------
// 3. DATA FETCHING & REAL-TIME SYNC
// -----------------------------------------------------------------------------
let knownOrderIds = new Set();
let isPollingStarted = false;

async function initServerData() {
  try {
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname.startsWith('192.168.');
    if (!isLocal) {
      baseUrl = window.location.origin;
    }

    const [infoRes, menuRes, ordersRes] = await Promise.all([
      fetch('/api/info').catch(() => null),
      fetch('/api/menu').catch(() => null),
      fetch('/api/orders').catch(() => null)
    ]);

    if (infoRes && infoRes.ok) {
      const info = await infoRes.json();
      if (!isLocal) {
        baseUrl = window.location.origin;
      } else if (info.tunnelUrl) {
        baseUrl = info.tunnelUrl;
      } else if (info.localWifiUrl) {
        baseUrl = info.localWifiUrl;
      } else {
        baseUrl = window.location.origin;
      }
    }

    if (menuRes && menuRes.ok) {
      menuData = await menuRes.json();
    }

    if (ordersRes && ordersRes.ok) {
      orders = await ordersRes.json();
    }

    knownOrderIds = new Set(orders.map(o => o.id));

    renderDashboardOverview();
    renderKdsTickets();
    renderTablesManagement();
    renderAllOrdersView();
    renderMenuCatalog();

    if (window.lucide && typeof lucide.createIcons === 'function') {
      lucide.createIcons();
    }

    startPollingFallback();
  } catch (err) {
    console.error('Initial server sync warning:', err);
    renderDashboardOverview();
    renderKdsTickets();
    renderTablesManagement();
    renderAllOrdersView();
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

      const brandNew = latestOrders.filter(o => !knownOrderIds.has(o.id));
      if (brandNew.length > 0) {
        brandNew.reverse().forEach(newOrder => {
          knownOrderIds.add(newOrder.id);
          if (!orders.some(o => o.id === newOrder.id)) {
            orders.unshift(newOrder);
            // Automatic Professional Voice Announcement
            announceNewOrder(newOrder);
          }
        });
        renderDashboardOverview();
        renderKdsTickets();
        renderTablesManagement();
        renderAllOrdersView();
      }

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
      // silent background polling
    }
  }, 3500);
}

// -----------------------------------------------------------------------------
// 4. NAVIGATION VIEW SWITCHING
// -----------------------------------------------------------------------------
function switchNavView(viewName) {
  activeNavView = viewName;

  // Update Sidebar active button
  const navBtns = document.querySelectorAll('.nav-item-btn');
  navBtns.forEach(btn => {
    if (btn.dataset.target === viewName) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Hide all sections, show target
  const sections = document.querySelectorAll('.view-section');
  sections.forEach(sec => sec.classList.remove('view-active'));

  const targetSec = document.getElementById(`view-${viewName}`);
  if (targetSec) {
    targetSec.classList.add('view-active');
  }

  // Update Top Titles
  const titleEl = document.getElementById('pageTitleHeading');
  const subEl = document.getElementById('pageSubtitleHeading');

  const titlesMap = {
    'dashboard': { title: 'Dashboard', sub: "Welcome back, Manager! Here's what's happening today." },
    'orders': { title: 'Order Management', sub: 'Track and manage live incoming and fulfilled customer orders.' },
    'tables': { title: 'Tables & QR Suite', sub: 'Monitor table occupancy, generate live QR codes, and download standees.' },
    'kitchen': { title: 'Kitchen Display System (KDS)', sub: 'Live kitchen production tickets with POS chime and natural voice alerts.' },
    'menus': { title: 'Menu Catalog', sub: 'Curated dishes, rates, vegetarian classifications, and stock status.' },
    'analytics': { title: 'Analytics & Reports', sub: 'Weekly revenue distribution, guest volume velocity, and product contribution.' },
    'help': { title: 'Help & Operations Guide', sub: 'How to use table QR codes, POS workflow, and voice announcements.' },
    'settings': { title: 'Restaurant & POS Voice Settings', sub: 'Fine-tune voice announcements, speech speed, and audio chimes.' }
  };

  const meta = titlesMap[viewName] || { title: 'Dashboard', sub: '' };
  if (titleEl) titleEl.innerText = meta.title;
  if (subEl) subEl.innerText = meta.sub;

  if (viewName === 'tables') {
    renderTablesManagement();
  }

  if (viewName === 'settings') {
    populateVoiceSelectDropdown();
  }

  if (window.lucide && typeof lucide.createIcons === 'function') {
    lucide.createIcons();
  }
}

// -----------------------------------------------------------------------------
// 5. DASHBOARD OVERVIEW RENDERER (ROW 1, ROW 2, ROW 3)
// -----------------------------------------------------------------------------
function renderDashboardOverview() {
  const pending = orders.filter(o => o.status === 'pending').length;
  const inProgress = orders.filter(o => o.status === 'preparing' || o.status === 'served').length;

  const occupiedFromOrders = new Set(
    orders
      .filter(o => o.status === 'pending' || o.status === 'preparing' || o.status === 'served')
      .map(o => o.tableNo)
  );
  const totalOccupied = new Set([...occupiedFromOrders, ...manualOccupiedTables]).size;
  const availableTables = Math.max(0, 12 - totalOccupied);

  // Row 1 Counters
  const pEl = document.getElementById('statPendingOrders');
  const progEl = document.getElementById('statOrdersInProgress');
  const tEl = document.getElementById('statAvailableTables');
  if (pEl) pEl.innerText = pending;
  if (progEl) progEl.innerText = inProgress;
  if (tEl) tEl.innerText = `${availableTables} / 12`;

  // Sidebar badges
  const bOrders = document.getElementById('sidebarOrdersBadge');
  const bKds = document.getElementById('sidebarKitchenBadge');
  if (bOrders) bOrders.innerText = pending + inProgress;
  if (bKds) bKds.innerText = inProgress > 0 ? `${inProgress} COOK` : 'LIVE';

  // Row 2 Calculations
  const totalRevenue = orders.reduce((sum, o) => sum + (o.totalAmount || 0), 14250);
  const rEl = document.getElementById('revenueHeadlineValue');
  if (rEl) rEl.innerText = `₹${totalRevenue.toLocaleString()}`;

  const cCountEl = document.getElementById('statCustomersCount');
  const oCountEl = document.getElementById('statTotalOrdersCount');
  const aovEl = document.getElementById('statAovValue');
  if (cCountEl) cCountEl.innerText = `${orders.length * 3 + 142} Guests`;
  if (oCountEl) oCountEl.innerText = `${orders.length + 48} Orders`;
  const avgOrderVal = orders.length ? Math.round(totalRevenue / (orders.length + 48)) : 365;
  if (aovEl) aovEl.innerText = `₹${avgOrderVal} AOV`;

  renderRecentActivityList();
  renderTopDishesList();
}

function renderRecentActivityList() {
  const list = document.getElementById('recentActivityList');
  if (!list) return;

  const displayOrders = orders.slice(0, 5);
  if (displayOrders.length === 0) {
    list.innerHTML = `
      <div class="empty-state-card" style="padding: 24px; text-align: center; color: var(--secondary-text);">
        <i data-lucide="inbox" style="width: 32px; height: 32px; margin-bottom: 8px; opacity: 0.5;"></i>
        <p style="font-size: 13px;">No recent customer activity yet.</p>
        <button onclick="switchNavView('tables')" style="margin-top: 10px; background: none; border: none; color: var(--primary-green); font-weight: 700; cursor: pointer;">
          View Table QR Codes &rarr;
        </button>
      </div>
    `;
    return;
  }

  list.innerHTML = displayOrders.map(order => {
    const timeFormatted = new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const itemsSummary = order.items ? order.items.map(i => `${i.qty}× ${i.name}`).join(', ') : 'Assorted items';
    const statusClass = order.status === 'completed' ? 'status-completed' : (order.status === 'preparing' ? 'status-cooking' : 'status-pending');
    const statusLabel = order.status.charAt(0).toUpperCase() + order.status.slice(1);

    return `
      <div class="activity-row" onclick="switchNavView('orders')">
        <div class="activity-row-left">
          <div class="activity-icon-box">
            <i data-lucide="shopping-bag" style="width: 18px; height: 18px;"></i>
          </div>
          <div class="activity-info">
            <span class="activity-title">Table ${order.tableNo} &bull; ${order.customerName || 'Guest'}</span>
            <span class="activity-desc">${itemsSummary}</span>
          </div>
        </div>
        <div class="activity-row-right">
          <span class="activity-time">${timeFormatted}</span>
          <span class="order-status-chip ${statusClass}">${statusLabel}</span>
          <span style="font-size: 13px; font-weight: 700; color: #171717;">₹${order.totalAmount}</span>
        </div>
      </div>
    `;
  }).join('');
}

function renderTopDishesList() {
  const list = document.getElementById('topDishesList');
  if (!list) return;

  const defaultTop = [
    { name: 'Crispy Paneer Burger', category: 'Signature Gourmet', orders: 124, price: 180, growth: '+28%' },
    { name: 'Artisanal Cold Brew', category: 'Handcrafted Beverage', orders: 98, price: 150, growth: '+19%' },
    { name: 'Four Cheese Grilled Sandwich', category: 'Sourdough Panini', orders: 86, price: 160, growth: '+14%' },
    { name: 'Farmhouse Pizza Rustica', category: 'Stone Baked', orders: 62, price: 280, growth: '+9%' }
  ];

  list.innerHTML = defaultTop.map(dish => `
    <div class="top-dish-item" onclick="switchNavView('menus')">
      <div class="top-dish-left">
        <div class="dish-thumb-placeholder">
          <i data-lucide="utensils" style="width: 16px; height: 16px;"></i>
        </div>
        <div class="top-dish-info">
          <span class="top-dish-name">${dish.name}</span>
          <span class="top-dish-meta">${dish.category} &bull; ₹${dish.price}</span>
        </div>
      </div>
      <div class="top-dish-right">
        <span class="top-dish-count">${dish.orders} ordered</span>
        <span class="top-dish-trend">${dish.growth}</span>
      </div>
    </div>
  `).join('');
}

// -----------------------------------------------------------------------------
// 6. KITCHEN DISPLAY SYSTEM (LIVE KDS WITH ITEM STRIKES)
// -----------------------------------------------------------------------------
function renderKdsTickets() {
  const container = document.getElementById('kdsTicketsGrid');
  if (!container) return;

  let filtered = orders;
  if (currentKdsFilter === 'active') {
    filtered = orders.filter(o => o.status !== 'completed' && o.status !== 'cancelled');
  } else if (currentKdsFilter !== 'all') {
    filtered = orders.filter(o => o.status === currentKdsFilter);
  }

  // Update counters
  const cActive = orders.filter(o => o.status !== 'completed' && o.status !== 'cancelled').length;
  const cPending = orders.filter(o => o.status === 'pending').length;
  const cCooking = orders.filter(o => o.status === 'preparing').length;
  const cServed = orders.filter(o => o.status === 'served').length;
  const cDone = orders.filter(o => o.status === 'completed').length;

  const bA = document.getElementById('kdsBadgeActive');
  const bP = document.getElementById('kdsBadgePending');
  const bC = document.getElementById('kdsBadgeCooking');
  const bS = document.getElementById('kdsBadgeServed');
  const bD = document.getElementById('kdsBadgeCompleted');
  if (bA) bA.innerText = cActive;
  if (bP) bP.innerText = cPending;
  if (bC) bC.innerText = cCooking;
  if (bS) bS.innerText = cServed;
  if (bD) bD.innerText = cDone;

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-kds-box" style="grid-column: 1 / -1; text-align: center; padding: 48px; background: #FFFFFF; border-radius: 12px; border: 1px dashed #E5E5E5;">
        <i data-lucide="chef-hat" style="width: 44px; height: 44px; color: #16A36A; margin-bottom: 12px;"></i>
        <h3 style="font-size: 16px; font-weight: 700; color: #171717;">Kitchen Queue is Clear!</h3>
        <p style="font-size: 13px; color: #737373; margin-top: 4px;">Incoming customer orders will chime and announce automatically in clear Indian English.</p>
        <button onclick="testVoiceAnnouncement()" style="margin-top: 14px; padding: 8px 16px; background: #FAFAFA; border: 1px solid #E5E5E5; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer;">
          🎙️ Test POS Announcement
        </button>
      </div>
    `;
    if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
    return;
  }

  container.innerHTML = filtered.map(order => {
    const elapsedMinutes = Math.floor((Date.now() - new Date(order.createdAt).getTime()) / 60000);
    const isUrgent = elapsedMinutes > 15;
    const timeFormatted = new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const itemsHtml = order.items.map((item, idx) => {
      const checkKey = `${order.id}_${idx}`;
      const isDone = !!completedItemChecks[checkKey];
      return `
        <div class="kds-item-row ${isDone ? 'is-done' : ''}" onclick="toggleKdsItemCheck('${order.id}', ${idx})" title="Click to strike-through when cooked">
          <div class="kds-item-qty">${item.qty}×</div>
          <div class="kds-item-name">${item.name}</div>
          <div class="kds-item-check-icon">${isDone ? '✓' : '○'}</div>
        </div>
      `;
    }).join('');

    let actionBtnHtml = '';
    if (order.status === 'pending') {
      actionBtnHtml = `
        <button class="btn-kds-primary" onclick="updateOrderStatus('${order.id}', 'preparing')">
          <i data-lucide="flame" style="width: 14px; height: 14px;"></i>
          <span>Start Cooking</span>
        </button>
      `;
    } else if (order.status === 'preparing') {
      actionBtnHtml = `
        <button class="btn-kds-primary" onclick="updateOrderStatus('${order.id}', 'served')">
          <i data-lucide="check" style="width: 14px; height: 14px;"></i>
          <span>Mark Served</span>
        </button>
      `;
    } else if (order.status === 'served') {
      actionBtnHtml = `
        <button class="btn-kds-secondary" onclick="updateOrderStatus('${order.id}', 'completed')">
          <i data-lucide="check-check" style="width: 14px; height: 14px;"></i>
          <span>Complete Order</span>
        </button>
      `;
    }

    return `
      <div class="kds-ticket-card status-${order.status} ${isUrgent ? 'kds-ticket-urgent' : ''}">
        <div class="kds-ticket-header">
          <div>
            <div class="kds-table-title">TABLE ${order.tableNo}</div>
            <div class="kds-order-meta">${order.id} &bull; ${timeFormatted} (${elapsedMinutes}m ago)</div>
          </div>
          <span class="order-status-chip status-${order.status}">${order.status}</span>
        </div>

        <div class="kds-items-list">
          ${itemsHtml}
        </div>

        ${order.specialNote ? `
          <div class="kds-note-box">
            <i data-lucide="alert-circle" style="width: 14px; height: 14px; flex-shrink: 0; color: #D97706;"></i>
            <span>Note: ${order.specialNote}</span>
          </div>
        ` : ''}

        <div class="kds-ticket-footer">
          ${actionBtnHtml}
          <button class="btn-kds-secondary" onclick="replayOrderVoice('${order.id}')" title="Replay POS Voice Announcement">
            <i data-lucide="volume-2" style="width: 14px; height: 14px;"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
}

function toggleKdsItemCheck(orderId, itemIdx) {
  const key = `${orderId}_${itemIdx}`;
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

    if (res.ok) {
      const updated = await res.json();
      const idx = orders.findIndex(o => o.id === orderId);
      if (idx !== -1) orders[idx] = updated;

      showToast(`Order status updated to ${newStatus}`, '✓');
      renderDashboardOverview();
      renderKdsTickets();
      renderTablesManagement();
      renderAllOrdersView();
    }
  } catch (err) {
    const o = orders.find(x => x.id === orderId);
    if (o) {
      o.status = newStatus;
      showToast(`Order status updated to ${newStatus}`, '✓');
      renderDashboardOverview();
      renderKdsTickets();
      renderTablesManagement();
      renderAllOrdersView();
    }
  }
}

function replayOrderVoice(orderId) {
  const order = orders.find(o => o.id === orderId);
  if (!order) return;
  announceNewOrder(order);
}

// -----------------------------------------------------------------------------
// 7. TABLES & QR CODES MANAGEMENT RENDERER (ALL 12 TABLES)
// -----------------------------------------------------------------------------
function renderTablesManagement() {
  const grid = document.getElementById('tablesManagementGrid');
  if (!grid) return;

  grid.innerHTML = '';
  const occupiedFromOrders = new Set(
    orders
      .filter(o => o.status === 'pending' || o.status === 'preparing' || o.status === 'served')
      .map(o => o.tableNo)
  );

  for (let tableNo = 1; tableNo <= 12; tableNo++) {
    const isOccupied = occupiedFromOrders.has(tableNo) || manualOccupiedTables.has(tableNo);
    const tableFmt = tableNo < 10 ? `0${tableNo}` : tableNo;
    const targetUrl = `${baseUrl}/order?table=${tableNo}`;

    const card = document.createElement('div');
    card.className = 'table-management-card';
    card.innerHTML = `
      <div class="table-card-top-bar" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <span class="table-title-bold" style="font-weight: 800; font-size: 15px; color: #171717;">Table ${tableFmt}</span>
        <button onclick="toggleTableOccupancy(${tableNo})" style="background: none; border: none; cursor: pointer; padding: 0;">
          <span class="table-status-pill ${isOccupied ? 'status-occupied' : 'status-available'}" style="cursor: pointer;" title="Click to toggle Available / Occupied">
            ${isOccupied ? '● Occupied' : '● Available'}
          </span>
        </button>
      </div>

      <div class="table-qr-frame" style="background: #FFFFFF; border: 1.5px dashed #E5E5E5; border-radius: 10px; padding: 12px; margin-bottom: 12px; display: flex; justify-content: center; align-items: center; min-height: 160px;">
        <div id="qr-table-container-${tableNo}" class="table-qr-canvas" style="display: flex; justify-content: center; align-items: center;"></div>
      </div>

      <div style="font-size: 11px; font-family: monospace; color: var(--secondary-text); word-break: break-all; margin-bottom: 12px; background: #FAFAFA; padding: 6px 8px; border-radius: 6px; border: 1px solid #EAEAEA;">
        ${targetUrl}
      </div>

      <div class="table-card-actions" style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
        <a href="${targetUrl}" target="_blank" class="btn-table-action" style="text-decoration: none; display: flex; align-items: center; justify-content: center; gap: 4px; padding: 7px; background: #FAFAFA; border: 1px solid #E5E5E5; border-radius: 6px; font-size: 11px; font-weight: 700; color: #171717;">
          <i data-lucide="external-link" style="width: 12px; height: 12px;"></i>
          <span>Open Menu</span>
        </a>
        <button class="btn-table-action" onclick="downloadTableQR(${tableNo})" style="display: flex; align-items: center; justify-content: center; gap: 4px; padding: 7px; background: #FAFAFA; border: 1px solid #E5E5E5; border-radius: 6px; font-size: 11px; font-weight: 700; color: #171717; cursor: pointer;">
          <i data-lucide="download" style="width: 12px; height: 12px;"></i>
          <span>Download</span>
        </button>
        <button class="btn-table-action" onclick="copyTableLink(${tableNo})" style="grid-column: span 2; display: flex; align-items: center; justify-content: center; gap: 4px; padding: 7px; background: rgba(22, 163, 106, 0.08); border: 1px solid rgba(22, 163, 106, 0.2); border-radius: 6px; font-size: 11px; font-weight: 700; color: #16A36A; cursor: pointer;">
          <i data-lucide="copy" style="width: 12px; height: 12px;"></i>
          <span>Copy QR Link</span>
        </button>
      </div>
    `;

    grid.appendChild(card);

    const qrContainer = card.querySelector(`#qr-table-container-${tableNo}`);
    drawQRCode(qrContainer, targetUrl, 140);
  }

  if (window.lucide && typeof lucide.createIcons === 'function') {
    lucide.createIcons();
  }
}

function copyTableLink(tableNo) {
  const url = `${baseUrl}/order?table=${tableNo}`;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(() => {
      showToast(`Copied Table ${tableNo} Link!`, '📋');
    }).catch(() => {
      prompt(`Table ${tableNo} Menu Link:`, url);
    });
  } else {
    prompt(`Table ${tableNo} Menu Link:`, url);
  }
}

function toggleTableOccupancy(tableNo) {
  if (manualOccupiedTables.has(tableNo)) {
    manualOccupiedTables.delete(tableNo);
    showToast(`Table ${tableNo} marked Available`, '🟢');
  } else {
    manualOccupiedTables.add(tableNo);
    showToast(`Table ${tableNo} marked Occupied`, '🔵');
  }
  renderDashboardOverview();
  renderTablesManagement();
}

function downloadTableQR(tableNo) {
  const container = document.getElementById(`qr-table-container-${tableNo}`);
  if (!container) return;

  const canvas = container.querySelector('canvas');
  const img = container.querySelector('img');

  const link = document.createElement('a');
  link.download = `RoyalCafe_Table_${tableNo < 10 ? '0' + tableNo : tableNo}_QR.png`;

  if (canvas) {
    link.href = canvas.toDataURL('image/png');
    link.click();
  } else if (img) {
    link.href = img.src;
    link.target = '_blank';
    link.click();
  }
}

// -----------------------------------------------------------------------------
// 8. ALL ORDERS & MENU CATALOG VIEWS
// -----------------------------------------------------------------------------
function renderAllOrdersView() {
  const container = document.getElementById('allOrdersTableView');
  if (!container) return;

  if (orders.length === 0) {
    container.innerHTML = '<p style="color: var(--secondary-text); padding: 16px;">No orders found yet.</p>';
    return;
  }

  container.innerHTML = orders.map(order => {
    const timeFormatted = new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const itemsSummary = order.items.map(i => `${i.qty}× ${i.name}`).join(', ');
    const statusClass = order.status === 'completed' ? 'status-completed' : (order.status === 'preparing' ? 'status-cooking' : 'status-pending');

    return `
      <div class="activity-row">
        <div class="activity-row-left">
          <div class="activity-icon-box">
            <i data-lucide="receipt" style="width: 18px; height: 18px;"></i>
          </div>
          <div class="activity-info">
            <span class="activity-title">Order ${order.id} &bull; Table ${order.tableNo}</span>
            <span class="activity-desc">${itemsSummary}</span>
          </div>
        </div>
        <div class="activity-row-right">
          <span class="activity-time">${timeFormatted}</span>
          <span class="order-status-chip ${statusClass}">${order.status}</span>
          <span style="font-size: 14px; font-weight: 800; color: #171717;">₹${order.totalAmount}</span>
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
}

function renderMenuCatalog() {
  const container = document.getElementById('menuManagementCatalog');
  if (!container) return;

  if (menuData.length === 0) {
    container.innerHTML = '<p style="color: var(--secondary-text); padding: 16px;">Loading menu items...</p>';
    return;
  }

  container.innerHTML = menuData.map(item => `
    <div class="activity-row">
      <div class="activity-row-left">
        <div class="activity-icon-box" style="background: rgba(22, 163, 106, 0.1); color: #16A36A;">
          <i data-lucide="utensils" style="width: 18px; height: 18px;"></i>
        </div>
        <div class="activity-info">
          <span class="activity-title">${item.name}</span>
          <span class="activity-desc">${item.description || item.category} &bull; ${item.prepTime || '15 mins'}</span>
        </div>
      </div>
      <div class="activity-row-right">
        <span class="order-status-chip status-completed">${item.category}</span>
        <span style="font-size: 15px; font-weight: 800; color: #16A36A;">₹${item.price}</span>
      </div>
    </div>
  `).join('');

  if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
}

// -----------------------------------------------------------------------------
// 9. SCAN ON MOBILE MODAL
// -----------------------------------------------------------------------------
function renderBigModalQr(tableNo = 2) {
  const container = document.getElementById('modalQrContainer');
  const linkText = document.getElementById('modalQrLinkText');
  const openDirect = document.getElementById('modalOpenDirectBtn');
  if (!container) return;

  const targetUrl = `${baseUrl}/order?table=${tableNo}`;
  if (linkText) linkText.innerText = targetUrl;
  if (openDirect) openDirect.href = targetUrl;

  drawQRCode(container, targetUrl, 220);
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
      if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
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
    copyBtn.addEventListener('click', () => {
      const selected = tableSelect ? tableSelect.value : '2';
      const urlToCopy = `${baseUrl}/order?table=${selected}`;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(urlToCopy).then(() => {
          if (copyText) copyText.innerText = 'Copied! ✓';
          showToast(`Copied Table ${selected} Link!`, '📋');
          setTimeout(() => {
            if (copyText) copyText.innerText = 'Copy Link';
          }, 2000);
        });
      } else {
        prompt('Copy this link to open on phone:', urlToCopy);
      }
    });
  }
}

// -----------------------------------------------------------------------------
// 10. NOTIFICATION DRAWER
// -----------------------------------------------------------------------------
function openNotificationDrawer() {
  showToast('POS Voice Engine is active & ready.', '🔔');
}

// -----------------------------------------------------------------------------
// 11. EXPOSE ALL FUNCTIONS ON WINDOW (Prevents inline onclick ReferenceErrors)
// -----------------------------------------------------------------------------
window.switchNavView = switchNavView;
window.toggleKdsItemCheck = toggleKdsItemCheck;
window.updateOrderStatus = updateOrderStatus;
window.replayOrderVoice = replayOrderVoice;
window.downloadTableQR = downloadTableQR;
window.copyTableLink = copyTableLink;
window.toggleTableOccupancy = toggleTableOccupancy;
window.testVoiceAnnouncement = testVoiceAnnouncement;
window.testHindiVoice = testVoiceAnnouncement; // backward compatibility alias
window.showToast = showToast;
window.openNotificationDrawer = openNotificationDrawer;

// -----------------------------------------------------------------------------
// 12. SOCKET.IO EVENT HANDLERS (Safely bounded)
// -----------------------------------------------------------------------------
if (socket) {
  socket.on('new_order', (newOrder) => {
    knownOrderIds.add(newOrder.id);
    if (!orders.some(o => o.id === newOrder.id)) {
      orders.unshift(newOrder);
      renderDashboardOverview();
      renderKdsTickets();
      renderTablesManagement();
      renderAllOrdersView();

      // Professional POS Voice Announcement
      announceNewOrder(newOrder);
    }
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
      if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
      setTimeout(() => toast.remove(), 10000);
    }

    // Spoken service alert
    const tableWord = numberToWord(alert.tableNo);
    const serviceSpeech = `Assistance request from Table number ${tableWord}. ${alert.requestType || 'Waiter called'}.`;
    speechQueue.push(serviceSpeech);
    processSpeechQueue();
  });
}

// -----------------------------------------------------------------------------
// 13. LIFECYCLE INITIALIZATION
// -----------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  initServerData();
  setupMobileQrModal();

  // Navigation Items click
  const navBtns = document.querySelectorAll('.nav-item-btn');
  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.target;
      if (target) switchNavView(target);
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
    testVoiceAnnouncement();
  });

  document.getElementById('testVoiceBtn')?.addEventListener('click', () => {
    testVoiceAnnouncement();
  });

  document.getElementById('kdsReplayVoiceBtn')?.addEventListener('click', () => {
    testVoiceAnnouncement();
  });

  // Notification Bell
  document.getElementById('notifBellBtn')?.addEventListener('click', () => {
    openNotificationDrawer();
  });

  // Settings Icon
  document.getElementById('settingsIconBtn')?.addEventListener('click', () => {
    switchNavView('settings');
  });

  // Mute / Unmute
  document.getElementById('kdsMuteToggleBtn')?.addEventListener('click', () => {
    isMuted = !isMuted;
    const txt = document.getElementById('kdsMuteStatusText');
    if (txt) txt.innerText = isMuted ? 'Muted' : 'Sound On';
    showToast(isMuted ? 'POS Voice Muted' : 'POS Voice Sound On', isMuted ? '🔇' : '🔔');
  });

  // Voice Settings controls in View-Settings
  const voiceSelect = document.getElementById('posVoiceSelect');
  if (voiceSelect) {
    voiceSelect.addEventListener('change', (e) => {
      localStorage.setItem('pos_selected_voice_uri', e.target.value);
      testVoiceAnnouncement();
    });
  }

  const speedRange = document.getElementById('posSpeedRange');
  const speedText = document.getElementById('speedValText');
  if (speedRange) {
    speedRange.value = localStorage.getItem('pos_voice_rate') || '1.02';
    if (speedText) speedText.innerText = `${speedRange.value}x`;
    speedRange.addEventListener('input', (e) => {
      localStorage.setItem('pos_voice_rate', e.target.value);
      if (speedText) speedText.innerText = `${e.target.value}x`;
    });
  }

  // Audio unlock on any first user interaction anywhere on the screen
  document.body.addEventListener('click', initAudio, { once: true });
  document.body.addEventListener('touchstart', initAudio, { once: true });
  document.body.addEventListener('keydown', initAudio, { once: true });
});
