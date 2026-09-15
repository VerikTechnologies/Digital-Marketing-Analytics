import sharp from 'sharp';
import QRCode from 'qrcode';

// Fallback link icon
const FALLBACK_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>`;

const escapeXML = (str) => String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function generateBeautifulQR(value, qrName, brandName, logoUrl, returnSvg = false) {
  const size = 1000;
  const qrSize = 650;
  
  let primaryColor = "#0f172a";
  let logoBase64 = null;
  let logoMime = "image/png";

  if (logoUrl) {
    try {
      const res = await fetch(logoUrl);
      if (res.ok) {
        const buffer = await res.arrayBuffer();
        const imgBuffer = Buffer.from(buffer);
        
        try {
          const { dominant } = await sharp(imgBuffer).stats();
          const toHex = (c) => c.toString(16).padStart(2, '0');
          if (dominant.r < 245 || dominant.g < 245 || dominant.b < 245) { // ignore pure white/light grey logos
              primaryColor = `#${toHex(dominant.r)}${toHex(dominant.g)}${toHex(dominant.b)}`;
          }
        } catch(e) {
          console.warn("Could not extract dominant color, falling back to default.", e.message);
        }

        const processedLogo = await sharp(imgBuffer)
          .resize(120, 120, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
          .png()
          .toBuffer();
          
        logoBase64 = processedLogo.toString('base64');
      }
    } catch (e) {
      console.error("Failed to process logo URL", e);
    }
  }

  const qrRawSvg = await QRCode.toString(value, {
    type: "svg",
    errorCorrectionLevel: "H",
    margin: 0,
    color: { dark: primaryColor, light: "#00000000" },
    width: qrSize
  });

  const qrInner = qrRawSvg.replace(/[\s\S]*<svg[^>]*>/i, '').replace(/<\/svg>[\s\S]*/i, '');

  const logoOverlay = logoBase64 
    ? `<image href="data:${logoMime};base64,${logoBase64}" x="${qrSize/2 - 60}" y="${qrSize/2 - 60}" width="120" height="120" />`
    : `<g transform="translate(${qrSize/2 - 40}, ${qrSize/2 - 40})">${FALLBACK_ICON}</g>`;

  const svgTemplate = `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#ffffff"/>
          <stop offset="100%" stop-color="#f1f5f9"/>
        </linearGradient>
        <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="0" dy="10" stdDeviation="15" flood-color="${primaryColor}" flood-opacity="0.15"/>
        </filter>
      </defs>
      
      <rect width="${size}" height="${size}" fill="url(#bg)" />
      
      <rect x="100" y="80" width="800" height="840" fill="#ffffff" rx="40" filter="url(#shadow)" />
      
      <g transform="translate(175, 120)">
        ${qrInner}
        <circle cx="${qrSize/2}" cy="${qrSize/2}" r="75" fill="#ffffff" />
        ${logoOverlay}
      </g>
      
      <text x="500" y="820" font-family="system-ui, sans-serif" font-size="36" font-weight="bold" fill="${primaryColor}" text-anchor="middle">
        ${escapeXML(qrName)}
      </text>
      
      <text x="500" y="860" font-family="system-ui, sans-serif" font-size="22" fill="#64748b" text-anchor="middle">
        ${escapeXML(brandName)}
      </text>
    </svg>
  `;

  if (returnSvg) {
    return svgTemplate;
  }

  return sharp(Buffer.from(svgTemplate)).png().toBuffer();
}
