"use client";
// Encrypt / decrypt folder documents under a RelationshipAttestation policy.
// The folder's record id is the ONLY tag (the contract rejects any other or extra tag).
import { IAMService } from "@tidecloak/js";
import { b64ToBytes, bytesToB64 } from "./client";

// doEncrypt can return a string or bytes. Bytes are stored with a prefix so we hand the SDK the
// same type back on decrypt.
const BYTES_PREFIX = "b64:";

export async function encryptMany(texts: string[], recordId: string, policyB64: string): Promise<string[]> {
  const out = await IAMService.doEncrypt(
    texts.map((data) => ({ data, tags: [recordId] })),
    b64ToBytes(policyB64),
  );
  return out.map((c) => (typeof c === "string" ? c : BYTES_PREFIX + bytesToB64(c)));
}

export async function decryptMany(ciphertexts: string[], recordId: string, policyB64: string): Promise<string[]> {
  const out = await IAMService.doDecrypt(
    ciphertexts.map((c) => ({ encrypted: c.startsWith(BYTES_PREFIX) ? b64ToBytes(c.slice(BYTES_PREFIX.length)) : c, tags: [recordId] })),
    b64ToBytes(policyB64),
  );
  return out.map((p) => (typeof p === "string" ? p : new TextDecoder().decode(p)));
}
