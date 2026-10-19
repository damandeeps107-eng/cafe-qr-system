// Printable Table QR Code Standees Generator
let baseUrl = window.location.origin;
let totalTables = 12;

async function initServerInfo() {
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname.startsWith('192.168.');
  
  if (!isLocal) {
    // Live hosted domain (e.g. Vercel)
    baseUrl = window.location.origin;
  } else {
    try {
      const res = await fetch('/api/info');
      const data = await res.json();
      if (data.tunnelUrl) {
        baseUrl = data.tunnelUrl;
      } else if (data.localWifiUrl) {
        baseUrl = data.localWifiUrl;
      } else {
        baseUrl = window.location.origin;
      }
    } catch (e) {
      baseUrl = window.location.origin;
    }
  }

  const input = document.getElementById('baseUrlInput');
  const wifiNotice = document.getElementById('wifiNotice');
  if (input) input.value = baseUrl;
  if (wifiNotice) wifiNotice.innerHTML = `<strong>Domain for QR Standees:</strong> <a href="${baseUrl}" target="_blank" style="color: #92400e; text-decoration: underline;">${baseUrl}</a> (Automatic Live Sync)`;

  renderAllStandees();
}

function renderAllStandees() {
  const grid = document.getElementById('standeesGrid');
  if (!grid) return;
  grid.innerHTML = '';

  for (let tableNo = 1; tableNo <= totalTables; tableNo++) {
    const card = createStandeeElement(tableNo);
    grid.appendChild(card);
    generateQRCodeForTable(tableNo);
  }
}

function createStandeeElement(tableNo) {
  const card = document.createElement('div');
  card.className = 'standee-card';
  card.id = `standee-table-${tableNo}`;

  const tableFormatted = tableNo < 10 ? `0${tableNo}` : tableNo;
  const targetUrl = `${baseUrl}/order?table=${tableNo}`;

  card.innerHTML = `
    <div class="standee-cafe-header">
      <div class="standee-cafe-icon">☕</div>
      <div class="standee-cafe-name">The Royal Cafe & Bistro</div>
    </div>

    <div class="standee-table-box">
      <div class="standee-table-title">TABLE ${tableFormatted}</div>
    </div>

    <div class="qr-frame">
      <canvas id="qr-canvas-${tableNo}" class="qr-image"></canvas>
    </div>

    <div class="standee-instructions">
      <div class="instruction-hi" style="font-weight: 700; letter-spacing: -0.01em;">Scan with camera to order</div>
      <div class="instruction-en">Instant Contactless Dining</div>
    </div>

    <div class="standee-url-text">${targetUrl}</div>

    <div class="standee-card-actions">
      <a href="${targetUrl}" target="_blank" class="btn-card-action">
        <span>↗</span> Open Menu
      </a>
      <button class="btn-card-action" onclick="downloadStandeeQR(${tableNo})">
        <span>↓</span> Download QR
      </button>
    </div>
  `;

  return card;
}

function generateQRCodeForTable(tableNo) {
  const container = document.getElementById(`qr-canvas-${tableNo}`);
  if (!container) return;
  container.innerHTML = '';

  const targetUrl = `${baseUrl}/order?table=${tableNo}`;

  if (typeof QRCode === 'function') {
    try {
      new QRCode(container, {
        text: targetUrl,
        width: 175,
        height: 175,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: (QRCode.CorrectLevel && QRCode.CorrectLevel.M) || 0
      });
      return;
    } catch (e) {
      console.warn('QRCode error, using fallback:', e);
    }
  }

  // Fallback: draw placeholder from backend or image
  fetch(`/api/qr/${tableNo}`)
    .then(r => r.json())
    .then(d => {
      const img = document.createElement('img');
      img.src = d.qrDataUrl;
      img.style.width = '175px';
      img.style.height = '175px';
      container.appendChild(img);
    })
    .catch(() => {
      const img = document.createElement('img');
      img.src = `https://api.qrserver.com/v1/create-qr-code/?size=175x175&data=${encodeURIComponent(targetUrl)}`;
      img.style.width = '175px';
      img.style.height = '175px';
      container.appendChild(img);
    });
}

function downloadStandeeQR(tableNo) {
  const container = document.getElementById(`qr-canvas-${tableNo}`);
  if (!container) return;

  const canvas = container.querySelector('canvas');
  const img = container.querySelector('img');
  const link = document.createElement('a');
  const tableFormatted = tableNo < 10 ? `0${tableNo}` : tableNo;
  link.download = `RoyalCafe_Standee_Table_${tableFormatted}.png`;

  if (canvas) {
    link.href = canvas.toDataURL('image/png');
    link.click();
  } else if (img) {
    link.href = img.src;
    link.target = '_blank';
    link.click();
  }
}

window.downloadStandeeQR = downloadStandeeQR;

document.addEventListener('DOMContentLoaded', () => {
  initServerInfo();

  // Apply custom URL
  document.getElementById('applyUrlBtn')?.addEventListener('click', () => {
    const input = document.getElementById('baseUrlInput');
    if (input && input.value.trim()) {
      baseUrl = input.value.trim().replace(/\/$/, '');
      renderAllStandees();
    }
  });

  // Add more tables
  document.getElementById('addTableBtn')?.addEventListener('click', () => {
    totalTables += 4;
    renderAllStandees();
  });
});
