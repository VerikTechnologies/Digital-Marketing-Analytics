// Quick test script - run with: node test-qr.mjs
import { generateBeautifulQR } from './src/qrGenerator.js';
import fs from 'fs';

console.log('Generating test QR...');
const buf = await generateBeautifulQR(
  'https://joeyrooms.com',
  'Joey Host Playstore',
  'Joyorooms',
  'https://joeyrooms.com/logo.png'  // replace with actual logo URL or null
);
fs.writeFileSync('./test-output.png', buf);
console.log('✅ Saved to test-output.png — open it to check!');
