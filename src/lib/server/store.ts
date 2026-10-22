// Tiny JSON-file store. It holds ciphertext, signed policies (which are public bytes), access
// requests and an audit log. It never holds plaintext or keys: there are none to hold.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { AccessRequest, AuditEvent, StoredDoc, StoredPolicy } from "../errand/model";
import { isoNow, newId } from "../errand/model";

export interface StoreShape {
  docs: StoredDoc[];
  policies: StoredPolicy[];
  requests: AccessRequest[];
  audit: AuditEvent[];
}

const FILE = join(process.cwd(), "data", "errand-store.json");
const empty = (): StoreShape => ({ docs: [], policies: [], requests: [], audit: [] });

export function readStore(): StoreShape {
  if (!existsSync(FILE)) return empty();
  try {
    return { ...empty(), ...JSON.parse(readFileSync(FILE, "utf-8")) };
  } catch {
    return empty();
  }
}

export function writeStore(s: StoreShape) {
  mkdirSync(join(process.cwd(), "data"), { recursive: true });
  writeFileSync(FILE, JSON.stringify(s, null, 2));
}

export function mutate<T>(fn: (s: StoreShape) => T): T {
  const s = readStore();
  const out = fn(s);
  writeStore(s);
  return out;
}

export function audit(actor: string, kind: AuditEvent["kind"], message: string, detail?: string) {
  mutate((s) => {
    s.audit.unshift({ id: newId("ev"), at: isoNow(), actor, kind, message, detail });
    s.audit = s.audit.slice(0, 300);
  });
}
