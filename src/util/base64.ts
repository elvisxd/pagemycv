// Bytes across a JSON boundary.
//
// The messaging layer serialises to JSON, and a Uint8Array survives that as an
// object with numeric keys — silently, which is exactly the failure that cost
// this project a day in Phase 0 with `chrome.storage.session` and a CryptoKey.
// A string cannot fail that way, and the ~33% it costs on a 200 KB resume is
// worth not having to wonder.

/** Chunked: String.fromCharCode(...bytes) overflows the stack past ~100 KB. */
const CHUNK = 0x8000;

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function fromBase64(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  // The ArrayBuffer parameter is not decoration: without it the type widens to
  // ArrayBufferLike, which includes SharedArrayBuffer, and a BlobPart will not
  // accept that.
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
