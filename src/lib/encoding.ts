// Base64 for policy bytes and request models. Browser and server (Node has btoa/atob).

export const toBase64 = (b: Uint8Array) => {
  let bin = "";
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  return btoa(bin);
};

export const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
