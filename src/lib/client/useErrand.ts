"use client";

// Browser-side plumbing shared by the owner page and the agent console.
// Every call to our API goes through the SDK's secureFetch with an ABSOLUTE url (the DPoP proof
// signs origin + path; a relative url throws "Failed to construct 'URL'").

import { useTideCloak } from "@tidecloak/nextjs";
import { IAMService } from "@tidecloak/js";
import { useCallback, useMemo } from "react";
import { getFolder, type FolderId, type PolicySpec } from "@/lib/domain/folders";
import type { IgaContext } from "@/lib/tide/approvals";
import { fromBase64 } from "@/lib/tide/vaultPolicies";
import type { PlainDocument } from "@/lib/seed/documents";

export interface FolderPayload {
  folder: { id: FolderId; label: string; recordId: string; agentRole: string };
  documents: { id: string; folderId: FolderId; ciphertext: string; createdAt: string }[];
  policies: (PolicySpec & { policyB64: string; grantedBy: string; createdAt: string })[];
}

export interface DecryptedDocument extends PlainDocument {
  id: string;
}

export function useErrand() {
  const tide = useTideCloak();
  const { secureFetch, getToken, getConfig } = tide;

  const api = useCallback(
    async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await secureFetch(new URL(path, window.location.origin).toString(), {
        ...init,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
      });
      const json = (await res.json().catch(() => ({}))) as T & { error?: string };
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      return json;
    },
    [secureFetch, getToken],
  );

  const config = getConfig() as { realm?: string; "auth-server-url"?: string; vendorId?: string };
  const iga: IgaContext = useMemo(
    () => ({
      baseUrl: config["auth-server-url"] ?? "http://localhost:8080",
      realm: config.realm ?? "errand",
      secureFetch: (url, init) => secureFetch(url, init),
      getToken,
    }),
    [config, secureFetch, getToken],
  );

  /**
   * Decrypt a folder using the policy issued to `subjectRole`. The caller does not need to HOLD
   * that role for the server to hand the policy over - the Tide network checks that, and refuses.
   */
  const decryptFolder = useCallback(
    async (folderId: FolderId, subjectRole: string): Promise<DecryptedDocument[]> => {
      const payload = await api<FolderPayload>(`/api/vault?folder=${folderId}`);
      const policy = payload.policies.find((p) => p.subjectRole === subjectRole);
      if (!policy) throw new Error(`No signed policy for ${subjectRole} on ${folderId}. The owner must run "Set up vault" first.`);
      if (!payload.documents.length) return [];
      const recordId = getFolder(folderId).recordId;
      const out = await IAMService.doDecrypt(
        payload.documents.map((d) => ({ encrypted: d.ciphertext, tags: [recordId] })),
        fromBase64(policy.policyB64),
      );
      return out.map((plain, i) => {
        const text = typeof plain === "string" ? plain : new TextDecoder().decode(plain);
        const parsed = JSON.parse(text) as PlainDocument;
        return { id: payload.documents[i].id, title: parsed.title, body: parsed.body };
      });
    },
    [api],
  );

  const audit = useCallback(
    (entry: { action: string; folderId?: FolderId; outcome: "allowed" | "refused" | "queued" | "info"; detail: string }) =>
      api("/api/audit", { method: "POST", body: JSON.stringify(entry) }).catch(() => undefined),
    [api],
  );

  return { tide, api, iga, decryptFolder, audit, vendorId: config.vendorId ?? "" };
}
