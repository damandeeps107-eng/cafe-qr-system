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
  const targetUrl = `${baseUrl}/?table=${tableNo}`;

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
  const canvas = document.getElementById(`qr-canvas-${tableNo}`);
  if (!canvas) return;

  const targetUrl = `${baseUrl}/?table=${tableNo}`;

  if (window.QRCode && typeof QRCode.toCanvas === 'function') {
    QRCode.toCanvas(canvas, targetUrl, {
      width: 200,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    }, function (error) {
      if (error) console.error(error);
    });
  } else {
    // Fallback: draw placeholder or fetch from backend
    fetch(`/api/qr/${tableNo}`)
      .then(r => r.json())
      .then(d => {
        const img = new Image();
        img.onload = () => {
          const ctx = canvas.getContext('2d');
          canvas.width = 175;
          canvas.height = 175;
          ctx.drawImage(img, 0, 0, 175, 175);
        };
        img.src = d.qrDataUrl;
      })
      .catch(console.error);
  }
}

function downloadStandeeQR(tableNo) {
  const canvas = document.getElementById(`qr-canvas-${tableNo}`);
  if (!canvas) return;

  const link = document.createElement('a');
  const tableFormatted = tableNo < 10 ? `0${tableNo}` : tableNo;
  link.download = `RoyalCafe_Table_${tableFormatted}_QR.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

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
