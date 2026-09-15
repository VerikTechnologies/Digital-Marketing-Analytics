import sharp from 'sharp';
import QRCode from 'qrcode';

/**
 * Generates a beautiful, branded QR code image.
 * Uses sharp's composite() to layer images instead of nested SVG (which is unreliable).
 *
 * Layout (1000x1100px canvas):
 *   - White card with rounded corners and drop shadow
 *   - Full-size QR code centered in card
 *   - Brand logo in center of QR (with white circle behind it)
 *   - QR name (bold) + brand name below the QR
 *   - Thin brand-colored accent bar at the top of the card
 */

const CANVAS_W = 1000;
const CANVAS_H = 1100;
const CARD_X = 60;
const CARD_Y = 60;
const CARD_W = CANVAS_W - 120;
const CARD_H = CANVAS_H - 120;
const QR_SIZE = 700;
const QR_X = CARD_X + (CARD_W - QR_SIZE) / 2;
const QR_Y = CARD_Y + 80;
const LOGO_BOX = 160;
const LOGO_X = Math.round(QR_X + QR_SIZE / 2 - LOGO_BOX / 2);
const LOGO_Y = Math.round(QR_Y + QR_SIZE / 2 - LOGO_BOX / 2);

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

function escapeXML(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function wrapText(text, maxChars) {
  if (text.length <= maxChars) return [text];
  const words = text.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).trim().length > maxChars) {
      if (current) lines.push(current.trim());
      current = word;
    } else {
      current = (current + ' ' + word).trim();
    }
  }
  if (current) lines.push(current.trim());
  return lines;
}

export async function generateBeautifulQR(value, qrName, brandName, logoUrl, returnSvg = false) {
  let primaryColor = '#1e293b';
  let accentColor = '#3b82f6';
  let logoBuffer = null;

  // ── 1. Download & process logo, extract dominant color ──────────────────────
  if (logoUrl) {
    try {
      const res = await fetch(logoUrl, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const raw = Buffer.from(await res.arrayBuffer());
        try {
          const { dominant } = await sharp(raw).stats();
          const { r, g, b } = dominant;
          // Only use color if it's not near-white or near-black
          const brightness = (r + g + b) / 3;
          if (brightness > 20 && brightness < 230) {
            const toHex = (c) => c.toString(16).padStart(2, '0');
            primaryColor = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
            accentColor = primaryColor;
          }
        } catch { /* fallback to default colors */ }

        // Resize logo to fit within the white circle
        logoBuffer = await sharp(raw)
          .resize(LOGO_BOX - 40, LOGO_BOX - 40, { fit: 'inside', background: { r: 255, g: 255, b: 255, alpha: 0 } })
          .png()
          .toBuffer();
      }
    } catch (e) {
      console.warn('Logo fetch/process failed, using fallback icon:', e.message);
    }
  }

  // ── 2. Generate QR code as a PNG buffer ─────────────────────────────────────
  const qrPngBuffer = await QRCode.toBuffer(value, {
    type: 'png',
    errorCorrectionLevel: 'H',
    margin: 1,
    width: QR_SIZE,
    color: { dark: primaryColor, light: '#FFFFFF' },
  });

  // ── 3. Build the card background SVG ────────────────────────────────────────
  const { r: pr, g: pg, b: pb } = hexToRgb(primaryColor);
  const nameLines = wrapText(qrName || '', 28);
  const textY = QR_Y + QR_SIZE + 55;
  const nameTextSvg = nameLines.map((line, i) =>
    `<text x="${CANVAS_W / 2}" y="${textY + i * 48}" font-family="Arial, sans-serif" font-size="38" font-weight="bold" fill="${primaryColor}" text-anchor="middle">${escapeXML(line)}</text>`
  ).join('\n');
  const brandTextY = textY + nameLines.length * 48 + 10;

  const bgSvg = `
<svg width="${CANVAS_W}" height="${CANVAS_H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="card-shadow">
      <feDropShadow dx="0" dy="8" stdDeviation="20" flood-color="rgba(${pr},${pg},${pb},0.18)"/>
    </filter>
    <linearGradient id="page-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f8fafc"/>
      <stop offset="100%" stop-color="#e2e8f0"/>
    </linearGradient>
  </defs>

  <!-- Page background -->
  <rect width="${CANVAS_W}" height="${CANVAS_H}" fill="url(#page-bg)"/>

  <!-- Card shadow + body -->
  <rect x="${CARD_X}" y="${CARD_Y}" width="${CARD_W}" height="${CARD_H}" rx="32" fill="white" filter="url(#card-shadow)"/>

  <!-- Accent bar at the top of the card -->
  <rect x="${CARD_X}" y="${CARD_Y}" width="${CARD_W}" height="14" rx="32" fill="${accentColor}"/>
  <rect x="${CARD_X}" y="${CARD_Y + 8}" width="${CARD_W}" height="14" fill="${accentColor}"/>

  <!-- White circle behind logo (to mask QR modules) -->
  <circle cx="${QR_X + QR_SIZE / 2}" cy="${QR_Y + QR_SIZE / 2}" r="${LOGO_BOX / 2 + 12}" fill="white"/>

  <!-- QR name -->
  ${nameTextSvg}

  <!-- Brand name subtitle -->
  <text x="${CANVAS_W / 2}" y="${brandTextY}" font-family="Arial, sans-serif" font-size="26" fill="#64748b" text-anchor="middle">${escapeXML(brandName || '')}</text>

  <!-- Bottom accent dot -->
  <circle cx="${CANVAS_W / 2}" cy="${CANVAS_H - 36}" r="6" fill="${accentColor}" opacity="0.5"/>
</svg>`.trim();

  // If SVG return requested (for SVG download), just return the SVG with QR baked in
  if (returnSvg) {
    const qrBase64 = qrPngBuffer.toString('base64');
    const logoBase64 = logoBuffer ? logoBuffer.toString('base64') : null;
    const svgWithQr = bgSvg.replace(
      '<!-- White circle behind logo (to mask QR modules) -->',
      `<image href="data:image/png;base64,${qrBase64}" x="${QR_X}" y="${QR_Y}" width="${QR_SIZE}" height="${QR_SIZE}"/>
  <!-- White circle behind logo (to mask QR modules) -->`
    ) + (logoBase64
      ? `\n<!-- logo injected -->`
      : '');
    return svgWithQr;
  }

  // ── 4. Composite: background → QR code → white circle is in SVG → logo ────
  const layers = [
    // QR code PNG at correct position
    { input: qrPngBuffer, top: Math.round(QR_Y), left: Math.round(QR_X) },
  ];

  if (logoBuffer) {
    // Center logo inside the white circle
    const meta = await sharp(logoBuffer).metadata();
    const logoTop = Math.round(LOGO_Y + (LOGO_BOX - (meta.height || LOGO_BOX)) / 2);
    const logoLeft = Math.round(LOGO_X + (LOGO_BOX - (meta.width || LOGO_BOX)) / 2);
    layers.push({ input: logoBuffer, top: Math.max(0, logoTop), left: Math.max(0, logoLeft) });
  } else {
    // Fallback: draw a small "QR" label icon in the center
    const fallbackSvg = `
<svg width="${LOGO_BOX - 40}" height="${LOGO_BOX - 40}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${LOGO_BOX - 40}" height="${LOGO_BOX - 40}" rx="16" fill="${accentColor}" opacity="0.12"/>
  <text x="${(LOGO_BOX - 40) / 2}" y="${(LOGO_BOX - 40) / 2 + 14}" font-family="Arial,sans-serif" font-size="28" font-weight="bold" fill="${accentColor}" text-anchor="middle">VK</text>
</svg>`.trim();
    const fallbackBuffer = await sharp(Buffer.from(fallbackSvg)).png().toBuffer();
    layers.push({ input: fallbackBuffer, top: Math.round(LOGO_Y + 20), left: Math.round(LOGO_X + 20) });
  }

  const finalBuffer = await sharp(Buffer.from(bgSvg), { density: 96 })
    .resize(CANVAS_W, CANVAS_H)
    .composite(layers)
    .png()
    .toBuffer();

  return finalBuffer;
}
