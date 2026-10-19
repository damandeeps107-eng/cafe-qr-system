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
// 1. PROFESSIONAL HINDI VOICE ANNOUNCEMENT ENGINE (SINGLE VOICE GUARD)
// -----------------------------------------------------------------------------
const posAudioChannel = (typeof window !== 'undefined' && 'BroadcastChannel' in window) 
  ? new BroadcastChannel('pos_order_voice_channel') 
  : null;

let orderAnnouncementQueue = [];
let isAnnouncing = false;
let announcedOrderIds = new Set(); // Tracks unique order IDs to prevent duplicates

if (posAudioChannel) {
  posAudioChannel.onmessage = (event) => {
    if (event.data && event.data.type === 'ORDER_ANNOUNCED') {
      announcedOrderIds.add(event.data.orderId);
      orderAnnouncementQueue = orderAnnouncementQueue.filter(o => o.id !== event.data.orderId);
    }
  };
}

// Instant cross-tab real-time orders channel (0.001s transmission)
if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
  try {
    const liveOrderChannel = new BroadcastChannel('pos_live_orders');
    liveOrderChannel.onmessage = (event) => {
      if (event.data && event.data.type === 'NEW_ORDER' && event.data.order) {
        const newOrder = event.data.order;
        if (!knownOrderIds.has(newOrder.id)) {
          knownOrderIds.add(newOrder.id);
          if (!orders.some(o => o.id === newOrder.id)) {
            orders.unshift(newOrder);
            renderDashboardOverview();
            renderKdsTickets();
            renderTablesManagement();
            renderAllOrdersView();
            announceNewOrder(newOrder);
          }
        }
      }
    };
  } catch (e) {}
}

let isAudioFullyUnlocked = false;

function initAudio() {
  try {
    if (!audioContext) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) audioContext = new AudioCtx();
    }
    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume();
    }
    if (audioContext && !isAudioFullyUnlocked) {
      try {
        const buffer = audioContext.createBuffer(1, 1, 22050);
        const src = audioContext.createBufferSource();
        src.buffer = buffer;
        src.connect(audioContext.destination);
        src.start(0);
      } catch (e) {}
    }

    // HTML5 Audio unlock (primes browser for background audio playback)
    try {
      const silent = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA');
      silent.volume = 0.01;
      silent.play().catch(() => {});
    } catch (e) {}

    // Speech synthesis unlock (primes browser SpeechSynthesis queue)
    if ('speechSynthesis' in window) {
      try {
        window.speechSynthesis.resume();
        const silentUtterance = new SpeechSynthesisUtterance(' ');
        silentUtterance.volume = 0;
        window.speechSynthesis.speak(silentUtterance);
      } catch (e) {}
    }

    isAudioFullyUnlocked = true;
    localStorage.setItem('pos_audio_unlocked', 'true');

    const ribbon = document.getElementById('audioBanner');
    if (ribbon) ribbon.style.display = 'none';
  } catch (err) {
    console.warn('initAudio unlock issue:', err);
  }
}

// Global user gesture listeners: ANY user click or keypress unlocks all audio instantly
if (typeof document !== 'undefined') {
  document.addEventListener('click', initAudio, { passive: true });
  document.addEventListener('touchstart', initAudio, { passive: true });
  window.addEventListener('keydown', initAudio, { passive: true });
}

/**
 * Signature Indian Railway Station 2-Tone Melodic Chime (Ding-Dong)
 * Tone 1 (Ding): High pitch bell ~740 Hz with 1480 Hz overtone
 * Tone 2 (Dong): Resonant low bell ~554 Hz with 1108 Hz overtone
 */
function playRailwayChime() {
  if (isMuted) return Promise.resolve();
  try {
    initAudio();
    if (!audioContext) return Promise.resolve();
    const now = audioContext.currentTime;

    // --- TONE 1: "DING" (740 Hz) ---
    const osc1 = audioContext.createOscillator();
    const gain1 = audioContext.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(740, now);
    gain1.gain.setValueAtTime(0.55, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc1.connect(gain1);
    gain1.connect(audioContext.destination);
    osc1.start(now);
    osc1.stop(now + 0.35);

    // Overtone 1
    const osc1Over = audioContext.createOscillator();
    const gain1Over = audioContext.createGain();
    osc1Over.type = 'triangle';
    osc1Over.frequency.setValueAtTime(1480, now);
    gain1Over.gain.setValueAtTime(0.18, now);
    gain1Over.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    osc1Over.connect(gain1Over);
    gain1Over.connect(audioContext.destination);
    osc1Over.start(now);
    osc1Over.stop(now + 0.28);

    // --- TONE 2: "DONG" (554.37 Hz) ---
    const osc2 = audioContext.createOscillator();
    const gain2 = audioContext.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(554.37, now + 0.28);
    gain2.gain.setValueAtTime(0.60, now + 0.28);
    gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.95);
    osc2.connect(gain2);
    gain2.connect(audioContext.destination);
    osc2.start(now + 0.28);
    osc2.stop(now + 0.95);

    // Overtone 2
    const osc2Over = audioContext.createOscillator();
    const gain2Over = audioContext.createGain();
    osc2Over.type = 'triangle';
    osc2Over.frequency.setValueAtTime(1108.74, now + 0.28);
    gain2Over.gain.setValueAtTime(0.20, now + 0.28);
    gain2Over.gain.exponentialRampToValueAtTime(0.0001, now + 0.70);
    osc2Over.connect(gain2Over);
    gain2Over.connect(audioContext.destination);
    osc2Over.start(now + 0.28);
    osc2Over.stop(now + 0.70);

    return new Promise(resolve => setTimeout(resolve, 950));
  } catch (e) {
    console.warn('Railway chime playback issue:', e);
    return Promise.resolve();
  }
}

// Backward-compatibility alias
const playPosChime = playRailwayChime;

// -----------------------------------------------------------------------------
// HINDI NATURAL PRONUNCIATION & NUMBER NORMALIZATION
// -----------------------------------------------------------------------------
const HINDI_NUMBER_WORDS = {
  0: 'शून्य',
  1: 'एक', 2: 'दो', 3: 'तीन', 4: 'चार', 5: 'पाँच',
  6: 'छह', 7: 'सात', 8: 'आठ', 9: 'नौ', 10: 'दस',
  11: 'ग्यारह', 12: 'बारह', 13: 'तेरह', 14: 'चौदह', 15: 'पंद्रह',
  16: 'सोलह', 17: 'सत्रह', 18: 'अठारह', 19: 'उन्नीस', 20: 'बीस',
  21: 'इक्कीस', 22: 'बाईस', 23: 'तेईस', 24: 'चौबीस', 25: 'पच्चीस',
  26: 'छब्बीस', 27: 'सत्ताईस', 28: 'अट्ठाईस', 29: 'उनतीस', 30: 'तीस'
};

const HINDI_ITEM_DICTIONARY = {
  'chilli paneer': 'चिली पनीर',
  'chilli paneer dry': 'चिली पनीर ड्राई',
  'paneer chilli': 'पनीर चिली',
  'veg burger': 'वेज बर्गर',
  'burger': 'बर्गर',
  'cold coffee': 'कोल्ड कॉफी',
  'hot coffee': 'हॉट कॉफी',
  'coffee': 'कॉफी',
  'masala dosa': 'मसाला डोसा',
  'plain dosa': 'प्लेन डोसा',
  'dosa': 'डोसा',
  'shahi paneer': 'शाही पनीर',
  'kadai paneer': 'कड़ाही पनीर',
  'paneer butter masala': 'पनीर बटर मसाला',
  'butter naan': 'बटर नान',
  'garlic naan': 'गार्लिक नान',
  'plain naan': 'प्लेन नान',
  'naan': 'नान',
  'tandoori roti': 'तंदूरी रोटी',
  'roti': 'रोटी',
  'crispy paneer burger': 'क्रिस्पी पनीर बर्गर',
  'cheesy veg burger': 'चीज़ी वेज बर्गर',
  'spicy mexican burger': 'स्पाइसी मैक्सिकन बर्गर',
  'corn & cheese grilled sandwich': 'कॉर्न और चीज़ ग्रिल्ड सैंडविच',
  'paneer tikka sandwich': 'पनीर टिक्का सैंडविच',
  'bombay masala sandwich': 'बॉम्बे मसाला सैंडविच',
  'sandwich': 'सैंडविच',
  'peri peri french fries': 'पेरी पेरी फ्रेंच फ्राइज़',
  'cheesy loaded fries': 'चीज़ी लोडेड फ्राइज़',
  'french fries': 'फ्रेंच फ्राइज़',
  'fries': 'फ्राइज़',
  'margherita pizza': 'मार्गशिता पिज़्ज़ा',
  'farmhouse veggie pizza': 'फार्महाउस वेज पिज़्ज़ा',
  'paneer makhani pizza': 'पनीर मखनी पिज़्ज़ा',
  'pizza': 'पिज़्ज़ा',
  'white sauce pasta': 'व्हाइट सॉस पास्ता',
  'red arrabbiata pasta': 'रेड अराबियाता पास्ता',
  'pasta': 'पास्ता',
  'choco lava cake': 'चोको लावा केक',
  'hot choco lava cake': 'चोको लावा केक',
  'sizzling brownie': 'सिज़लिंग ब्राउनी',
  'brownie': 'ब्राउनी',
  'vanilla ice cream': 'वैनिला आइसक्रीम',
  'ice cream': 'आइसक्रीम',
  'masala chai': 'मसाला चाय',
  'ginger tea': 'अदरक वाली चाय',
  'chai': 'चाय',
  'tea': 'चाय',
  'fresh lime soda': 'फ्रेश लाइम सोडा',
  'mojito': 'मोहितो',
  'virgin mojito': 'वर्जिन मोहितो',
  'lassi': 'लस्सी',
  'sweet lassi': 'मीठी लस्सी',
  'mango shake': 'मैंगो शेक',
  'chocolate shake': 'चॉकलेट शेक'
};

function getHindiNumber(num) {
  const n = parseInt(num, 10);
  return HINDI_NUMBER_WORDS[n] || String(num);
}

function getHindiItemName(item) {
  if (item.nameHindi && item.nameHindi.trim()) {
    return item.nameHindi.trim();
  }
  const clean = (item.name || '').replace(/\(.*\)/g, '').trim().toLowerCase();
  if (HINDI_ITEM_DICTIONARY[clean]) {
    return HINDI_ITEM_DICTIONARY[clean];
  }
  for (const [key, val] of Object.entries(HINDI_ITEM_DICTIONARY)) {
    if (clean === key || clean.includes(key)) {
      return val;
    }
  }
  return item.name || '';
}

function buildHindiItemsPhrase(items) {
  if (!items || items.length === 0) return '';
  const itemClauses = items.map(item => {
    const qtyHindi = getHindiNumber(item.qty || 1);
    const nameHindi = getHindiItemName(item);
    return `${qtyHindi} ${nameHindi}`;
  });

  if (itemClauses.length === 1) {
    return itemClauses[0];
  }
  if (itemClauses.length === 2) {
    return `${itemClauses[0]} और ${itemClauses[1]}`;
  }
  const last = itemClauses.pop();
  return `${itemClauses.join(', ')} और ${last}`;
}

/**
 * Builds the exact Indian Railway Station announcement format:
 * First announcement:
 * "कृपया ध्यान दें! टेबल नंबर पाँच से नया ऑर्डर प्राप्त हुआ है। दो चिली पनीर, एक वेज बर्गर और एक कोल्ड कॉफी।"
 * Second announcement:
 * "दोबारा सूचित किया जाता है। टेबल नंबर पाँच से नया ऑर्डर प्राप्त हुआ है। दो चिली पनीर, एक वेज बर्गर और एक कोल्ड कॉफी।"
 */
function buildRailwayHindiAnnouncements(order) {
  const tableHindi = getHindiNumber(order.tableNo);
  const itemsPhrase = buildHindiItemsPhrase(order.items);

  let firstAnnouncement = '';
  let secondAnnouncement = '';

  if (itemsPhrase) {
    firstAnnouncement = `कृपया ध्यान दें! टेबल नंबर ${tableHindi} से नया ऑर्डर प्राप्त हुआ है। ${itemsPhrase}।`;
    secondAnnouncement = `दोबारा सूचित किया जाता है। टेबल नंबर ${tableHindi} से नया ऑर्डर प्राप्त हुआ है। ${itemsPhrase}।`;
  } else {
    firstAnnouncement = `कृपया ध्यान दें! टेबल नंबर ${tableHindi} से नया ऑर्डर प्राप्त हुआ है।`;
    secondAnnouncement = `दोबारा सूचित किया जाता है। टेबल नंबर ${tableHindi} से नया ऑर्डर प्राप्त हुआ है।`;
  }

  return { firstAnnouncement, secondAnnouncement };
}

// -----------------------------------------------------------------------------
// INTELLIGENT HINDI NEURAL FEMALE VOICE SELECTION
// -----------------------------------------------------------------------------
function loadVoices() {
  if (!('speechSynthesis' in window)) return;
  availableVoices = window.speechSynthesis.getVoices();
  populateVoiceSelectDropdown();
}

if ('speechSynthesis' in window) {
  loadVoices();
  window.speechSynthesis.onvoiceschanged = loadVoices;
}

function getBestHindiFemaleVoice() {
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

  // 2. Score voices according to natural Hindi female neural criteria
  function scoreVoice(v) {
    const name = (v.name || '').toLowerCase();
    const lang = (v.lang || '').toLowerCase().replace(/_/g, '-');
    let score = 0;

    const isExplicitHindi = lang.includes('hi') || name.includes('hindi') || name.includes('हिन्दी');
    const isIndian = lang.includes('in') || name.includes('india');

    const isFemale = name.includes('female') || name.includes('swara') || name.includes('lekha') ||
                     name.includes('kalpana') || name.includes('neerja') || name.includes('veena') ||
                     name.includes('kajal') || name.includes('tara') || name.includes('heera') ||
                     name.includes('priya') || name.includes('pooja') || name.includes('zira');

    const isNatural = name.includes('natural') || name.includes('online') || name.includes('neural') || name.includes('google');

    // Priority 1: Hindi Female Natural / Online (Google हिन्दी, Microsoft Swara Online Natural, Lekha)
    if (isExplicitHindi && isFemale && isNatural) score += 3000;
    else if (isExplicitHindi && isFemale) score += 2500;
    else if (isExplicitHindi && isNatural) score += 2000;
    else if (isExplicitHindi) score += 1800;

    // Priority 2: Indian English / Multilingual Female (Tara, Neerja, Veena, Heera)
    else if (isIndian && isFemale && isNatural) score += 1000;
    else if (isIndian && isFemale) score += 800;
    else if (isIndian) score += 600;

    // Priority 3: Other Female voices
    else if (isFemale) score += 200;

    return score;
  }

  const sorted = [...availableVoices].sort((a, b) => scoreVoice(b) - scoreVoice(a));
  return sorted[0] || null;
}

function populateVoiceSelectDropdown() {
  const select = document.getElementById('posVoiceSelect');
  if (!select) return;

  select.innerHTML = '';
  const best = getBestHindiFemaleVoice();
  const savedURI = localStorage.getItem('pos_selected_voice_uri');

  // Option: Auto-Detect
  const autoOpt = document.createElement('option');
  autoOpt.value = '';
  autoOpt.innerText = `Auto-Detect (Recommended: ${best ? best.name : 'Natural Hindi Female'})`;
  if (!savedURI) autoOpt.selected = true;
  select.appendChild(autoOpt);

  availableVoices.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v.voiceURI || v.name;
    const isHi = (v.lang || '').toLowerCase().includes('hi') || (v.name || '').includes('हिन्दी');
    const isInd = (v.lang || '').toLowerCase().includes('in');
    opt.innerText = `${v.name} (${v.lang})${isHi ? ' 🇮🇳 Hindi' : (isInd ? ' 🇮🇳' : '')}`;
    if (savedURI && (v.voiceURI === savedURI || v.name === savedURI)) {
      opt.selected = true;
    }
    select.appendChild(opt);
  });
}

/**
 * Speaks Hindi Devanagari text with Station Announcement Cadence & Loud Audio
 */
function speakHindiUtterance(text) {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) {
      resolve();
      return;
    }

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    const voice = getBestHindiFemaleVoice();
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang || 'hi-IN';
    } else {
      utterance.lang = 'hi-IN';
    }

    // Professional railway public announcement cadence (0.88x)
    const rate = parseFloat(localStorage.getItem('pos_voice_rate') || '0.88');
    const pitch = parseFloat(localStorage.getItem('pos_voice_pitch') || '1.0');
    const volume = parseFloat(localStorage.getItem('pos_voice_volume') || '1.0');

    utterance.rate = rate;
    utterance.pitch = pitch;
    utterance.volume = volume;

    let safetyTimeout = null;
    let heartbeatInterval = null;

    const cleanup = () => {
      if (safetyTimeout) clearTimeout(safetyTimeout);
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      resolve();
    };

    utterance.onend = cleanup;
    utterance.onerror = (e) => {
      console.warn('Speech synthesis utterance note:', e);
      cleanup();
    };

    // Chrome garbage-collection speech fix: keep speech synthesis alive
    heartbeatInterval = setInterval(() => {
      if (window.speechSynthesis.speaking) {
        window.speechSynthesis.pause();
        window.speechSynthesis.resume();
      }
    }, 5000);

    // 40-second safety timeout
    safetyTimeout = setTimeout(cleanup, 40000);

    window.speechSynthesis.speak(utterance);
  });
}

function playAudioElement(audio) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const cleanup = () => {
      finished = true;
      if (timer) clearTimeout(timer);
    };
    audio.onended = () => {
      if (!finished) {
        cleanup();
        resolve();
      }
    };
    audio.onerror = (e) => {
      if (!finished) {
        cleanup();
        reject(e || new Error('Audio element error'));
      }
    };
    // 45s safety timeout
    const timer = setTimeout(() => {
      if (!finished) {
        cleanup();
        resolve();
      }
    }, 45000);

    audio.play().catch(err => {
      if (!finished) {
        cleanup();
        reject(err);
      }
    });
  });
}

async function requestElevenLabsSpeech(text) {
  try {
    const res = await fetch('/api/tts/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.success) {
        return data.audioDataUri || data.audioUrl;
      }
    }
  } catch (err) {
    console.warn('ElevenLabs API fetch error:', err);
  }
  return null;
}

/**
 * ELEVENLABS INDIAN RAILWAY HINDI ANNOUNCEMENT ENGINE (AUTOMATIC 2X REPEAT)
 * 1. Play 2-tone Railway Melodic Chime (Ding-Dong)
 * 2. Announce complete order in Hindi with ElevenLabs natural female voice
 * 3. Wait 2 seconds
 * 4. Replay the complete order announcement (replaying same generated audio buffer)
 * 5. Stop automatically
 */
async function announceOrder(order) {
  const { firstAnnouncement } = buildRailwayHindiAnnouncements(order);

  // Inform any other open tabs on this computer so they do NOT announce the same order
  if (posAudioChannel && order.id) {
    try {
      posAudioChannel.postMessage({ type: 'ORDER_ANNOUNCED', orderId: order.id });
    } catch (e) {}
  }

  // 1. Play clear 2-tone Railway notification chime immediately
  await playRailwayChime();

  // Natural breath pause between chime and speech (300ms)
  await new Promise(r => setTimeout(r, 300));

  // Synthesize or retrieve ElevenLabs audio (max 400ms wait so it NEVER lags)
  let audioSource = order.audioDataUri || order.audioUrl || null;
  if (!audioSource) {
    try {
      audioSource = await Promise.race([
        requestElevenLabsSpeech(firstAnnouncement),
        new Promise(resolve => setTimeout(() => resolve(null), 400))
      ]);
    } catch (e) {
      audioSource = null;
    }
  }

  if (audioSource) {
    try {
      const audio = new Audio(audioSource);
      audio.preload = 'auto';

      // 2. Announce complete order in Hindi (Pass 1)
      await playAudioElement(audio);

      // 3. Short pause
      await new Promise(r => setTimeout(r, 1200));

      // 4. Repeat announcement (Pass 2)
      audio.currentTime = 0;
      await playAudioElement(audio);

      return;
    } catch (err) {
      console.warn('ElevenLabs audio playback failed, falling back to instant speech synthesis:', err);
    }
  }

  // Instant Fallback: Native Hindi Web Speech Synthesis (Zero lag, crisp Railway voice)
  await speakHindiUtterance(firstAnnouncement);
  await new Promise(r => setTimeout(r, 1200));
  await speakHindiUtterance(firstAnnouncement);
}

// Backward compatibility alias
const announceOrderWithDoubleRepetition = announceOrder;

/**
 * Sequential Order Announcement Queue (Zero Overlap, Single Voice Guard)
 */
function announceNewOrder(order) {
  if (!order || !order.id) return;
  if (announcedOrderIds.has(order.id)) return; // Prevent duplicate
  announcedOrderIds.add(order.id);

  if (isMuted) return;

  orderAnnouncementQueue.push(order);
  processOrderAnnouncementQueue();
}

async function processOrderAnnouncementQueue() {
  if (isAnnouncing || orderAnnouncementQueue.length === 0) return;
  if (isMuted) return;

  isAnnouncing = true;
  const currentOrder = orderAnnouncementQueue.shift();

  try {
    await announceOrder(currentOrder);
  } catch (err) {
    console.error('Error during order announcement:', err);
  } finally {
    isAnnouncing = false;
    // Sequential spacing before starting next order in queue
    if (orderAnnouncementQueue.length > 0) {
      setTimeout(processOrderAnnouncementQueue, 600);
    }
  }
}

/**
 * Test Announcement: Table 5, 2 Chilli Paneer, 1 Veg Burger, 1 Cold Coffee
 */
function testVoiceAnnouncement() {
  initAudio();
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  orderAnnouncementQueue = []; // Clear queue to prevent stacked triggers
  isAnnouncing = false;

  const sampleOrder = {
    id: `TEST-${Date.now()}`,
    tableNo: 5,
    items: [
      { qty: 2, name: 'Chilli Paneer', nameHindi: 'चिली पनीर' },
      { qty: 1, name: 'Veg Burger', nameHindi: 'वेज बर्गर' },
      { qty: 1, name: 'Cold Coffee', nameHindi: 'कोल्ड कॉफी' }
    ]
  };

  showToast('Playing Indian Railway Announcement (ElevenLabs Hindi • Repeats 2x)...', '🎙️');
  orderAnnouncementQueue.push(sampleOrder);
  processOrderAnnouncementQueue();
}

const testHindiVoice = testVoiceAnnouncement;

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
    announcedOrderIds = new Set(orders.map(o => o.id));

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
  }, 800);
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

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getMenuItemImage(item) {
  if (!item) return '/images/burger.jpg';

  // 1. Direct item image if available
  if (item.image && typeof item.image === 'string' && item.image.trim().length > 0) {
    return item.image;
  }

  // 2. Lookup in loaded menu database
  if (Array.isArray(menuData) && menuData.length > 0) {
    if (item.id) {
      const matchById = menuData.find(m => m.id === item.id);
      if (matchById && matchById.image) return matchById.image;
    }
    if (item.name) {
      const lowerName = item.name.toLowerCase().trim();
      const matchByName = menuData.find(m => m.name && m.name.toLowerCase().trim() === lowerName);
      if (matchByName && matchByName.image) return matchByName.image;

      const partialMatch = menuData.find(m => m.name && (lowerName.includes(m.name.toLowerCase()) || m.name.toLowerCase().includes(lowerName)));
      if (partialMatch && partialMatch.image) return partialMatch.image;
    }
  }

  // 3. Fallback to existing authentic food images by keyword
  const name = (item.name || '').toLowerCase();
  if (name.includes('burger')) return '/images/burger.jpg';
  if (name.includes('sandwich') || name.includes('club') || name.includes('toast') || name.includes('panini')) return '/images/sandwich.jpg';
  if (name.includes('coffee') || name.includes('cold') || name.includes('brew') || name.includes('latte') || name.includes('cappuccino')) return '/images/coffee.jpg';
  if (name.includes('pizza')) return 'https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=600&q=80';
  if (name.includes('fries') || name.includes('peri')) return 'https://images.unsplash.com/photo-1576107232684-1279f3908594?auto=format&fit=crop&w=600&q=80';
  if (name.includes('cake') || name.includes('lava') || name.includes('brownie') || name.includes('sweet') || name.includes('dessert')) return 'https://images.unsplash.com/photo-1606313564200-e75d5e30476c?auto=format&fit=crop&w=600&q=80';
  if (name.includes('shake') || name.includes('chocolate') || name.includes('mojito') || name.includes('drink')) return 'https://images.unsplash.com/photo-1572490122747-3968b75cc699?auto=format&fit=crop&w=600&q=80';

  return '/images/burger.jpg';
}

function renderOrderThumbnailsStack(items) {
  if (!items || !items.length) {
    return `
      <div class="food-avatar-single">
        <img class="food-thumb-img single" src="/images/burger.jpg" alt="Dish" onerror="this.src='/images/burger.jpg'" />
      </div>
    `;
  }

  // Single item order
  if (items.length === 1) {
    const item = items[0];
    const imgSrc = getMenuItemImage(item);
    return `
      <div class="food-avatar-single">
        <img class="food-thumb-img single" src="${imgSrc}" alt="${escapeHtml(item.name)}" onerror="this.src='/images/burger.jpg'" />
      </div>
    `;
  }

  // Multiple items: show overlapping small thumbnails (up to 3) with count badge
  const visibleItems = items.slice(0, 3);
  const extraCount = items.length - 3;

  let stackHtml = `<div class="food-avatar-stack">`;
  visibleItems.forEach((item, index) => {
    const imgSrc = getMenuItemImage(item);
    const zIndex = 10 - index;
    stackHtml += `
      <div class="food-stack-item" style="z-index: ${zIndex};">
        <img class="food-thumb-img stack" src="${imgSrc}" alt="${escapeHtml(item.name)}" onerror="this.src='/images/burger.jpg'" />
      </div>
    `;
  });

  if (extraCount > 0) {
    stackHtml += `<div class="food-stack-more">+${extraCount}</div>`;
  }
  stackHtml += `</div>`;
  return stackHtml;
}

function formatRelativeTime(dateString) {
  if (!dateString) return 'Just now';
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return 'Recently';

  const now = new Date();
  const diffSec = Math.floor((now - d) / 1000);

  if (diffSec < 45) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} ${diffMin === 1 ? 'min' : 'mins'} ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} ${diffHr === 1 ? 'hour' : 'hours'} ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function openOrderDetailsModal(orderId) {
  const order = orders.find(o => o.id === orderId);
  if (!order) return;

  const modal = document.getElementById('orderDetailsModal');
  if (!modal) return;

  const headlineEl = document.getElementById('modalOrderHeadline');
  if (headlineEl) headlineEl.innerText = `Order #${order.id}`;

  const tablePillEl = document.getElementById('modalOrderTablePill');
  if (tablePillEl) tablePillEl.innerText = `Table ${order.tableNo}`;

  const metaSubtitleEl = document.getElementById('modalOrderMetaSubtitle');
  if (metaSubtitleEl) {
    const relTime = formatRelativeTime(order.createdAt);
    const exactTime = new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    metaSubtitleEl.innerText = `Placed ${relTime} • ${exactTime} • Status: ${order.status.toUpperCase()}`;
  }

  const itemsContainer = document.getElementById('modalOrderItemsContainer');
  if (itemsContainer) {
    const items = order.items || [];
    itemsContainer.innerHTML = items.map(item => {
      const imgSrc = getMenuItemImage(item);
      const unitPrice = item.price || 0;
      const lineTotal = unitPrice * (item.qty || 1);
      return `
        <div class="order-modal-item-row">
          <img class="modal-item-thumb" src="${imgSrc}" alt="${escapeHtml(item.name)}" onerror="this.src='/images/burger.jpg'" />
          <div style="flex: 1; min-width: 0;">
            <div style="font-size: 14px; font-weight: 700; color: #111827; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              ${escapeHtml(item.name)}
            </div>
            <div style="font-size: 12px; color: #6B7280; margin-top: 2px;">
              ₹${unitPrice} × ${item.qty}
            </div>
          </div>
          <div style="font-size: 14px; font-weight: 800; color: #111827;">
            ₹${lineTotal}
          </div>
        </div>
      `;
    }).join('');
  }

  const noteBox = document.getElementById('modalOrderNoteBox');
  const noteText = document.getElementById('modalOrderNoteText');
  const noteContent = order.specialNote || order.note;
  if (noteBox && noteText) {
    if (noteContent && noteContent.trim().length > 0) {
      noteText.innerText = noteContent;
      noteBox.style.display = 'block';
    } else {
      noteBox.style.display = 'none';
    }
  }

  const totalFigure = document.getElementById('modalOrderTotalFigure');
  if (totalFigure) totalFigure.innerText = `₹${order.totalAmount}`;

  const voiceBtn = document.getElementById('modalOrderVoiceBtn');
  if (voiceBtn) {
    voiceBtn.onclick = () => replayOrderVoice(order.id);
  }

  modal.classList.add('active');
  if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
}

function closeOrderDetailsModal() {
  const modal = document.getElementById('orderDetailsModal');
  if (modal) {
    modal.classList.remove('active');
  }
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
    if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
    return;
  }

  list.innerHTML = displayOrders.map(order => {
    const items = order.items || [];
    const firstItem = items[0] || { name: 'Assorted Dish', qty: 1 };
    const heroImg = getMenuItemImage(firstItem);
    const hasMore = items.length > 1;
    const moreCount = items.length - 1;
    const foodSummary = `${firstItem.qty}× ${escapeHtml(firstItem.name)}${hasMore ? ` +${moreCount} more` : ''}`;

    const relTime = formatRelativeTime(order.createdAt);
    const status = order.status || 'pending';
    let statusLabel = 'New';
    let statusDotColor = '#F59E0B';
    let statusBg = '#FEF3C7';
    let statusTextColor = '#B45309';

    if (status === 'preparing') {
      statusLabel = 'Cooking';
      statusBg = '#EFF6FF';
      statusTextColor = '#1D4ED8';
      statusDotColor = '#3B82F6';
    } else if (status === 'served') {
      statusLabel = 'Served';
      statusBg = '#F3E8FF';
      statusTextColor = '#7E22CE';
      statusDotColor = '#A855F7';
    } else if (status === 'completed') {
      statusLabel = 'Done';
      statusBg = '#ECFDF5';
      statusTextColor = '#047857';
      statusDotColor = '#10B981';
    }

    const titleText = status === 'completed' ? 'Order Completed' : (status === 'preparing' ? 'Kitchen Preparing' : 'New Order Received');

    return `
      <div class="recent-activity-item-card" onclick="openOrderDetailsModal('${order.id}')" title="Click to view order #${order.id} details">
        <div class="activity-thumb-wrapper">
          <img class="activity-hero-thumb" src="${heroImg}" alt="${escapeHtml(firstItem.name)}" onerror="this.src='/images/burger.jpg'" />
          ${hasMore ? `<span class="activity-multidish-count">${items.length} items</span>` : ''}
        </div>

        <div class="activity-details-block">
          <div class="activity-header-line">
            <span class="activity-bold-title">${titleText}</span>
            <span class="activity-status-dot-pill" style="background: ${statusBg}; color: ${statusTextColor};">
              <span class="activity-dot" style="background: ${statusDotColor};"></span>
              ${statusLabel}
            </span>
          </div>

          <div class="activity-table-food-line">
            <span class="activity-table-tag">Table ${order.tableNo}</span>
            <span class="activity-dot-separator">•</span>
            <span class="activity-food-name">${foodSummary}</span>
          </div>

          <div class="activity-price-time-line">
            <span class="activity-price-tag">₹${order.totalAmount}</span>
            <span class="activity-dot-separator">•</span>
            <span class="activity-time-tag">${relTime}</span>
          </div>
        </div>

        <i data-lucide="chevron-right" class="activity-action-arrow" style="width: 18px; height: 18px;"></i>
      </div>
    `;
  }).join('');

  if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
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
  initAudio();
  showToast(`Replaying Railway Announcement for Table ${order.tableNo}...`, '🎙️');
  orderAnnouncementQueue.push(order);
  processOrderAnnouncementQueue();
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
    container.innerHTML = `
      <div class="empty-state-card" style="padding: 36px; text-align: center; color: var(--secondary-text); grid-column: 1 / -1; background: #FFFFFF; border: 1px dashed #E5E7EB; border-radius: 12px;">
        <i data-lucide="inbox" style="width: 40px; height: 40px; margin-bottom: 10px; opacity: 0.5;"></i>
        <h4 style="font-size: 15px; font-weight: 700; color: #374151;">No Orders Yet</h4>
        <p style="font-size: 13px; color: #6B7280; margin-top: 4px;">Orders placed by guests at tables will appear here in real time.</p>
        <button onclick="switchNavView('tables')" style="margin-top: 14px; background: var(--primary-green); color: #FFFFFF; border: none; padding: 8px 16px; border-radius: 8px; font-weight: 700; cursor: pointer;">
          View Table QR Codes &rarr;
        </button>
      </div>
    `;
    if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
    return;
  }

  container.innerHTML = orders.map(order => {
    const items = order.items || [];
    const thumbnailsStackHtml = renderOrderThumbnailsStack(items);
    const relTime = formatRelativeTime(order.createdAt);
    const exactTime = new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Status Badge config
    const status = order.status || 'pending';
    let statusBadgeClass = 'status-badge-pending';
    let statusLabel = 'New Incoming';

    if (status === 'preparing') {
      statusBadgeClass = 'status-badge-preparing';
      statusLabel = 'In Kitchen';
    } else if (status === 'served') {
      statusBadgeClass = 'status-badge-served';
      statusLabel = 'Served';
    } else if (status === 'completed') {
      statusBadgeClass = 'status-badge-completed';
      statusLabel = 'Completed';
    } else if (status === 'cancelled') {
      statusBadgeClass = 'status-badge-cancelled';
      statusLabel = 'Cancelled';
    }

    // Top 3 items summary lines
    const displayItems = items.slice(0, 3);
    const remainingCount = items.length - 3;

    const itemsSummaryHtml = displayItems.map(item => `
      <div class="order-item-line">
        <span class="item-name-text">
          <span class="item-qty-tag">${item.qty}×</span>${escapeHtml(item.name)}
        </span>
        <span class="item-price-text">₹${(item.price || 0) * (item.qty || 1)}</span>
      </div>
    `).join('');

    const moreItemsHtml = remainingCount > 0 ? `
      <div class="order-more-items-text">+${remainingCount} more dish${remainingCount > 1 ? 'es' : ''}</div>
    ` : '';

    const noteHtml = (order.specialNote || order.note) ? `
      <div class="order-note-pill" title="${escapeHtml(order.specialNote || order.note)}">
        <i data-lucide="message-square" style="width: 12px; height: 12px; flex-shrink: 0;"></i>
        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(order.specialNote || order.note)}</span>
      </div>
    ` : '';

    return `
      <div class="order-saas-card" onclick="openOrderDetailsModal('${order.id}')" title="Click to view details for Order #${order.id}">
        <!-- Top Card Header -->
        <div class="order-card-header">
          <div class="order-header-left">
            <span class="order-id-badge">#${order.id}</span>
            <span class="order-table-pill">
              <i data-lucide="map-pin" style="width: 11px; height: 11px;"></i>
              <span>Table ${order.tableNo}</span>
            </span>
            ${order.customerName && order.customerName !== `Table ${order.tableNo}` ? `<span class="order-guest-name">• ${escapeHtml(order.customerName)}</span>` : ''}
          </div>
          <div class="order-status-badge ${statusBadgeClass}">
            <span class="status-dot"></span>
            <span>${statusLabel}</span>
          </div>
        </div>

        <!-- Middle Card Body -->
        <div class="order-card-body">
          <div class="order-visual-column">
            ${thumbnailsStackHtml}
          </div>
          <div class="order-items-column">
            <div class="order-items-summary-list">
              ${itemsSummaryHtml}
            </div>
            ${moreItemsHtml}
            ${noteHtml}
          </div>
        </div>

        <!-- Bottom Card Footer -->
        <div class="order-card-footer">
          <div class="order-footer-meta">
            <span class="order-time-label">
              <i data-lucide="clock" style="width: 11px; height: 11px;"></i>
              <span>${relTime} (${exactTime})</span>
            </span>
            <div class="order-total-block">
              <span class="total-caption">Total:</span>
              <span class="total-figure">₹${order.totalAmount}</span>
            </div>
          </div>

          <div class="order-footer-actions">
            <button class="btn-order-voice-icon" title="Listen voice announcement" onclick="event.stopPropagation(); replayOrderVoice('${order.id}')">
              <i data-lucide="volume-2" style="width: 15px; height: 15px;"></i>
            </button>
            <button class="btn-order-view-details" onclick="event.stopPropagation(); openOrderDetailsModal('${order.id}')">
              <span>View Details</span>
              <i data-lucide="chevron-right" style="width: 13px; height: 13px;"></i>
            </button>
          </div>
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
window.openOrderDetailsModal = openOrderDetailsModal;
window.closeOrderDetailsModal = closeOrderDetailsModal;
window.enterPinDigit = enterPinDigit;
window.deletePinDigit = deletePinDigit;
window.clearPin = clearPin;
window.lockDashboard = lockDashboard;
window.saveManagerPinFromSettings = saveManagerPinFromSettings;

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

  socket.on('order_audio_ready', (data) => {
    const target = orders.find(o => o.id === data.orderId);
    if (target) {
      target.audioUrl = data.audioUrl;
      target.audioDataUri = data.audioDataUri;
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
    speedRange.value = localStorage.getItem('pos_voice_rate') || '0.88';
    if (speedText) speedText.innerText = `${speedRange.value}x`;
    speedRange.addEventListener('input', (e) => {
      localStorage.setItem('pos_voice_rate', e.target.value);
      if (speedText) speedText.innerText = `${e.target.value}x`;
    });
  }

  const volumeRange = document.getElementById('posVolumeRange');
  const volumeText = document.getElementById('volumeValText');
  if (volumeRange) {
    volumeRange.value = localStorage.getItem('pos_voice_volume') || '1.0';
    if (volumeText) volumeText.innerText = `${Math.round(parseFloat(volumeRange.value) * 100)}%`;
    volumeRange.addEventListener('input', (e) => {
      localStorage.setItem('pos_voice_volume', e.target.value);
      if (volumeText) volumeText.innerText = `${Math.round(parseFloat(e.target.value) * 100)}%`;
    });
  }

  const repetitionSelect = document.getElementById('posRepetitionSelect');
  if (repetitionSelect) {
    repetitionSelect.value = localStorage.getItem('pos_double_announcement') || 'false';
    repetitionSelect.addEventListener('change', (e) => {
      localStorage.setItem('pos_double_announcement', e.target.value);
      showToast(e.target.value === 'true' ? 'Announcement: Double Repeat (2x)' : 'Announcement: Single (Plays Once)', '🔊');
    });
  }

  // Audio unlock on any first user interaction anywhere on the screen
  document.body.addEventListener('click', initAudio, { once: true });
  document.body.addEventListener('touchstart', initAudio, { once: true });
  document.body.addEventListener('keydown', initAudio, { once: true });

  // Initialize Manager PIN Protection Lock
  initDashboardPinProtection();
});

// -----------------------------------------------------------------------------
// 14. MANAGER PIN PROTECTION ENGINE (SaaS POS Security)
// -----------------------------------------------------------------------------
let currentPinInput = '';
const DEFAULT_MANAGER_PIN = '1234';

function getManagerPin() {
  return localStorage.getItem('pos_manager_pin') || DEFAULT_MANAGER_PIN;
}

function setManagerPin(newPin) {
  if (/^\d{4}$/.test(newPin)) {
    localStorage.setItem('pos_manager_pin', newPin);
    return true;
  }
  return false;
}

function isDashboardAuthenticated() {
  return sessionStorage.getItem('pos_dashboard_auth') === 'true';
}

function initDashboardPinProtection() {
  const overlay = document.getElementById('dashboardPinLockOverlay');
  if (!overlay) return;

  if (isDashboardAuthenticated()) {
    overlay.classList.add('unlocked');
  } else {
    overlay.classList.remove('unlocked');
    currentPinInput = '';
    updatePinDotsUI();
  }

  // Support hardware keyboard number entry
  window.addEventListener('keydown', (e) => {
    if (overlay.classList.contains('unlocked')) return;
    if (e.key >= '0' && e.key <= '9') {
      enterPinDigit(e.key);
    } else if (e.key === 'Backspace') {
      deletePinDigit();
    } else if (e.key === 'Escape' || e.key.toLowerCase() === 'c') {
      clearPin();
    }
  });

  const pinInputSettings = document.getElementById('managerPinInput');
  if (pinInputSettings) {
    pinInputSettings.value = getManagerPin();
  }
}

function updatePinDotsUI() {
  const dots = document.querySelectorAll('#pinDotsRow .pin-dot');
  dots.forEach((dot, idx) => {
    if (idx < currentPinInput.length) {
      dot.classList.add('filled');
    } else {
      dot.classList.remove('filled');
    }
  });
}

function enterPinDigit(digit) {
  initAudio();
  if (currentPinInput.length >= 4) return;
  currentPinInput += digit;
  updatePinDotsUI();

  const errEl = document.getElementById('pinErrorMessage');
  if (errEl) errEl.style.display = 'none';

  if (currentPinInput.length === 4) {
    verifyPinInput();
  }
}

function deletePinDigit() {
  if (currentPinInput.length > 0) {
    currentPinInput = currentPinInput.slice(0, -1);
    updatePinDotsUI();
  }
}

function clearPin() {
  currentPinInput = '';
  updatePinDotsUI();
  const errEl = document.getElementById('pinErrorMessage');
  if (errEl) errEl.style.display = 'none';
}

function verifyPinInput() {
  const expected = getManagerPin();
  if (currentPinInput === expected) {
    sessionStorage.setItem('pos_dashboard_auth', 'true');
    const overlay = document.getElementById('dashboardPinLockOverlay');
    if (overlay) {
      overlay.classList.add('unlocked');
    }
    showToast('Manager Access Granted', '🔓');
    currentPinInput = '';
    updatePinDotsUI();
    initAudio();
  } else {
    const errEl = document.getElementById('pinErrorMessage');
    if (errEl) {
      errEl.style.display = 'block';
      errEl.classList.remove('pin-error-text');
      void errEl.offsetWidth;
      errEl.classList.add('pin-error-text');
    }
    currentPinInput = '';
    updatePinDotsUI();
  }
}

function lockDashboard() {
  sessionStorage.removeItem('pos_dashboard_auth');
  currentPinInput = '';
  updatePinDotsUI();
  const overlay = document.getElementById('dashboardPinLockOverlay');
  if (overlay) {
    overlay.classList.remove('unlocked');
  }
  showToast('Dashboard Locked', '🔒');
}

function saveManagerPinFromSettings() {
  const input = document.getElementById('managerPinInput');
  if (!input) return;
  const val = input.value.trim();
  if (/^\d{4}$/.test(val)) {
    setManagerPin(val);
    showToast(`Manager PIN updated to ${val}`, '🔑');
  } else {
    showToast('PIN must be exactly 4 numeric digits', '⚠️');
  }
}
