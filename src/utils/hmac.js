/**
 * hmac.js — Client-side HMAC-SHA-256 verification for signed payloads.
 *
 * Ported from StockMind AI's implementation.
 * The backend signs every sensitive payload.
 * The client verifies signature before rendering.
 * Prevents tampered or injected data from being displayed.
 *
 * NOTE: The key here is a PUBLIC verification key only —
 * the signing secret never leaves the backend.
 */

/**
 * Verifies a payload against its HMAC-SHA-256 signature.
 * Uses Web Crypto API (available in all modern browsers + Electron).
 *
 * @param {object} payload   — The data object (without hmacSignature field)
 * @param {string} signature — Hex-encoded HMAC-SHA-256 from backend
 * @param {string} verifyKey — Public verification key
 * @returns {Promise<boolean>}
 */
export async function verifyHmac(payload, signature, verifyKey) {
  try {
    const encoder     = new TextEncoder();
    const keyData     = encoder.encode(verifyKey);
    const messageData = encoder.encode(JSON.stringify(payload));

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const signatureBytes = hexToBytes(signature);
    return await crypto.subtle.verify('HMAC', cryptoKey, signatureBytes, messageData);
  } catch {
    return false;  // Any error = treat as invalid
  }
}

/**
 * Signs a payload with HMAC-SHA-256 (for internal use — development only).
 * Production signing always happens server-side.
 */
export async function signHmac(payload, secretKey) {
  try {
    const encoder     = new TextEncoder();
    const keyData     = encoder.encode(secretKey);
    const messageData = encoder.encode(JSON.stringify(payload));

    const cryptoKey = await crypto.subtle.importKey(
      'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );

    const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
    return bytesToHex(new Uint8Array(signature));
  } catch {
    return null;
  }
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
