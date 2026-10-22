'use client';

import React, { useEffect, useState } from 'react';
import { useTideCloak } from '@tidecloak/nextjs';
import {
  Shield,
  Lock,
  Unlock,
  Terminal,
  UserCheck,
  AlertTriangle,
  CheckCircle2,
  FileLock2,
  KeyRound,
  RefreshCw,
  Send,
  EyeOff,
  Sparkles,
  ServerCrash,
} from 'lucide-react';
import {
  SubmissionRecord,
  sealCandidateIdentity,
  unmaskCandidateIdentity,
} from '@/lib/tideBridge';

export default function BlindVaultApp() {
  // Official TideCloak Next.js SDK Hook
  const tide = useTideCloak();
  const isTideConnected = Boolean(tide?.authenticated);

  const [submissions, setSubmissions] = useState<SubmissionRecord[]>([]);
  const [selectedSubId, setSelectedSubId] = useState<string>('sub-1');
  const [activeJudgeId, setActiveJudgeId] = useState<string>('judge-3');
  const [scoreInput, setScoreInput] = useState<string>('95');
  const [feedbackInput, setFeedbackInput] = useState<string>(
    'Outstanding systems architecture and zero-allocation proof. Ready for fellowship award.'
  );

  // Candidate New Submission Form State
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [candName, setCandName] = useState('Trần Minh Khoa');
  const [candStudentId, setCandStudentId] = useState('25120112');
  const [candUni, setCandUni] = useState('VNU-HCM University of Science');
  const [candEmail, setCandEmail] = useState('tmkhoa@fit.hcmus.edu.vn');
  const [projTitle, setProjTitle] = useState('Byzantine-Resilient Federated Learning Aggregator');
  const [projAbstract, setProjAbstract] = useState(
    'Zero-trust gradient aggregation preventing poisoned model updates across hospital nodes.'
  );

  // Audit & Rogue Admin Console Log
  const [auditLogs, setAuditLogs] = useState<
    { time: string; actor: string; status: 'BLOCKED' | 'ALLOWED' | 'INFO'; message: string }[]
  >([
    {
      time: new Date().toLocaleTimeString(),
      actor: 'TideCloak Fabric',
      status: 'INFO',
      message:
        'Initialized BlindVault Quorum Policy: Candidate identity decryption requires 3-of-3 cryptographically locked judge scores + _tide_message.selfdecrypt authority.',
    },
  ]);

  const [rogueModalData, setRogueModalData] = useState<string | null>(null);

  const addLog = (actor: string, status: 'BLOCKED' | 'ALLOWED' | 'INFO', message: string) => {
    setAuditLogs((prev) => [
      { time: new Date().toLocaleTimeString(), actor, status, message },
      ...prev,
    ]);
  };

  const fetchSubmissions = async () => {
    const res = await fetch('/api/submissions');
    const data = await res.json();
    setSubmissions(data.submissions || []);
  };

  useEffect(() => {
    fetchSubmissions();
  }, []);

  const selectedSub = submissions.find((s) => s.id === selectedSubId) || submissions[0];
  const lockedCount = selectedSub ? selectedSub.judges.filter((j) => j.locked).length : 0;
  const totalJudges = selectedSub ? selectedSub.judges.length : 3;
  const quorumReached = lockedCount === totalJudges;

  // Action 1: Candidate Submits Blind Work (Client-Side TideCloak Encryption)
  const handleCreateSubmission = async (e: React.FormEvent) => {
    e.preventDefault();
    const { ciphertext, engine } = await sealCandidateIdentity(
      {
        fullName: candName,
        studentId: candStudentId,
        university: candUni,
        email: candEmail,
      },
      tide?.doEncrypt,
      isTideConnected
    );

    const res = await fetch('/api/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'CREATE_SUBMISSION',
        title: projTitle,
        abstract: projAbstract,
        encryptedIdentity: ciphertext,
        encryptionTag: 'message',
        encryptionEngine: engine,
      }),
    });
    const data = await res.json();
    if (data.submission) {
      await fetchSubmissions();
      setSelectedSubId(data.submission.id);
      setShowSubmitModal(false);
      addLog(
        'Candidate Client',
        'INFO',
        `Sealed candidate identity via ${engine} (Tag: 'message'). Plaintext never left browser; server stored anonymous code ${data.submission.anonymousCode}.`
      );
    }
  };

  // Action 2: Judge Locks Score
  const handleLockScore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSub) return;

    const res = await fetch('/api/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'LOCK_JUDGE_SCORE',
        submissionId: selectedSub.id,
        judgeId: activeJudgeId,
        score: Number(scoreInput),
        feedback: feedbackInput,
      }),
    });
    const data = await res.json();
    setSubmissions(data.submissions);

    const updatedSub = data.submissions.find((s: SubmissionRecord) => s.id === selectedSub.id);
    const newLocked = updatedSub.judges.filter((j: any) => j.locked).length;
    const judgeObj = updatedSub.judges.find((j: any) => j.judgeId === activeJudgeId);

    addLog(
      judgeObj?.judgeName || activeJudgeId,
      'INFO',
      `Cryptographically locked score (${scoreInput}/100) for ${selectedSub.anonymousCode}. Quorum status: ${newLocked}/${totalJudges}.`
    );
  };

  // Action 3: Rogue Admin / Compromised Server Unilateral Unmask Attempt
  const handleRogueAdminAttempt = async () => {
    if (!selectedSub) return;
    const result = await unmaskCandidateIdentity(
      selectedSub,
      tide?.doDecrypt,
      isTideConnected
    );

    if (!result.success) {
      addLog(
        'ROGUE_ROOT_ADMIN (Server Override)',
        'BLOCKED',
        `[${result.auditCode}] Unilateral unmask attempt on ${selectedSub.anonymousCode} FAILED! ${result.error}`
      );
      setRogueModalData(
        JSON.stringify(
          {
            attackVector: 'Direct Backend DB Dump + Root Admin Override',
            targetSubmission: selectedSub.anonymousCode,
            quorumState: `${lockedCount}/${totalJudges} Judges Locked`,
            serverStoredIdentity: selectedSub.encryptedIdentity,
            tideCloakVerdict: 'ACCESS_DENIED_NO_MASTER_KEY',
            reason: result.error,
          },
          null,
          2
        )
      );
    } else {
      addLog(
        'Auditor / Committee',
        'ALLOWED',
        `Quorum policy (${lockedCount}/${totalJudges}) already met—identity can now be legitimately decrypted.`
      );
    }
  };

  // Action 4: Emergent Authority Decryption (Once 3/3 Quorum Met)
  const handleEmergentUnmask = async () => {
    if (!selectedSub) return;
    const result = await unmaskCandidateIdentity(
      selectedSub,
      tide?.doDecrypt,
      isTideConnected
    );

    if (!result.success || !result.identity) {
      addLog('Emergent Authority Gate', 'BLOCKED', result.error || 'Quorum not met');
      return;
    }

    setSubmissions((prev) =>
      prev.map((s) =>
        s.id === selectedSub.id ? { ...s, unmaskedIdentity: result.identity } : s
      )
    );

    addLog(
      'TideCloak Emergent Authority',
      'ALLOWED',
      `[${result.auditCode}] 3/3 Judge Quorum verified + TideCloak tag 'message' decryption completed! Unmasked ${selectedSub.anonymousCode} -> ${result.identity.fullName} (${result.identity.studentId}).`
    );
  };

  // Demo Reset button for quick video takes
  const handleResetDemo = async () => {
    const res = await fetch('/api/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'RESET_DEMO' }),
    });
    const data = await res.json();
    setSubmissions(data.submissions);
    setRogueModalData(null);
    addLog(
      'Demo Controller',
      'INFO',
      'Reset Submission #BV-8041 back to 2/3 Judge Quorum (Sealed State) for live demo recording.'
    );
  };

  const activeJudgeRecord = selectedSub?.judges.find((j) => j.judgeId === activeJudgeId);
  const averageScore =
    selectedSub && quorumReached
      ? (
          selectedSub.judges.reduce((acc, j) => acc + (j.score || 0), 0) /
          selectedSub.judges.length
        ).toFixed(1)
      : null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Navbar */}
      <header className="border-b border-slate-800 bg-slate-900/70 backdrop-blur sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-6 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
              <Shield className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold tracking-tight text-white">BlindVault</h1>
                <span className="text-xs px-2.5 py-0.5 rounded-full font-medium bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  TideCloak Emergent Authority
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Mathematically Guaranteed True-Blind Grading & Scholarship Review
              </p>
            </div>
          </div>

          {/* TideCloak Connection & Actions */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs">
              <span
                className={`h-2 w-2 rounded-full ${
                  isTideConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
                }`}
              />
              <span className="text-slate-300 font-medium">
                {isTideConnected
                  ? 'TideCloak Enclave Authenticated'
                  : 'TideCloak Hybrid Sandbox Ready'}
              </span>
            </div>

            {isTideConnected ? (
              <button
                onClick={() => tide?.logout?.()}
                className="px-3.5 py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
              >
                Logout TideCloak
              </button>
            ) : (
              <button
                onClick={() => tide?.login?.()}
                className="px-3.5 py-2 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm transition flex items-center gap-1.5"
              >
                <KeyRound className="h-3.5 w-3.5" />
                Login with TideCloak
              </button>
            )}

            <button
              onClick={() => setShowSubmitModal(true)}
              className="px-3.5 py-2 rounded-lg text-xs font-semibold bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 transition flex items-center gap-1.5"
            >
              <FileLock2 className="h-3.5 w-3.5" />
              + New Blind Submission
            </button>

            <button
              onClick={handleResetDemo}
              title="Reset BV-8041 to 2/3 Quorum for Video Demo"
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700 transition"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Grid */}
      <main className="max-w-7xl mx-auto w-full px-6 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1">
        {/* LEFT COLUMN (4 cols): Anonymous Submissions Queue */}
        <section className="lg:col-span-4 space-y-4">
          <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <EyeOff className="h-4 w-4 text-indigo-400" />
                Anonymous Submissions Vault
              </h2>
              <span className="text-xs text-slate-400">{submissions.length} Sealed</span>
            </div>

            <div className="space-y-2.5">
              {submissions.map((sub) => {
                const subLocked = sub.judges.filter((j) => j.locked).length;
                const subQuorum = subLocked === sub.judges.length;
                const isSelected = sub.id === selectedSub?.id;

                return (
                  <button
                    key={sub.id}
                    onClick={() => {
                      setSelectedSubId(sub.id);
                      setRogueModalData(null);
                    }}
                    className={`w-full text-left p-3.5 rounded-xl border transition ${
                      isSelected
                        ? 'bg-indigo-950/40 border-indigo-500/60 shadow-lg shadow-indigo-950/30'
                        : 'bg-slate-950/60 border-slate-800/80 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-slate-800 text-indigo-300">
                        #{sub.anonymousCode}
                      </span>
                      <span
                        className={`text-[11px] font-medium px-2 py-0.5 rounded-full flex items-center gap-1 ${
                          sub.unmaskedIdentity
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : subQuorum
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                            : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                        }`}
                      >
                        {sub.unmaskedIdentity ? (
                          <>
                            <Unlock className="h-3 w-3" /> Identity Unmasked
                          </>
                        ) : subQuorum ? (
                          <>
                            <Sparkles className="h-3 w-3" /> 3/3 Quorum Ready
                          </>
                        ) : (
                          <>
                            <Lock className="h-3 w-3" /> {subLocked}/3 Judges Locked
                          </>
                        )}
                      </span>
                    </div>

                    <h3 className="text-sm font-semibold text-white line-clamp-1">{sub.title}</h3>
                    <p className="text-xs text-slate-400 line-clamp-2 mt-1">{sub.abstract}</p>

                    <div className="mt-2.5 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
                      <span>Candidate Identity:</span>
                      {sub.unmaskedIdentity ? (
                        <span className="font-semibold text-emerald-400">
                          {sub.unmaskedIdentity.fullName} ({sub.unmaskedIdentity.studentId})
                        </span>
                      ) : (
                        <span className="font-mono text-rose-400">
                          [TIDECLOAK E2EE CIPHERTEXT]
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Why TideCloak Callout Card for Judges */}
          <div className="p-4 rounded-xl bg-gradient-to-br from-indigo-950/50 to-slate-900 border border-indigo-500/30 space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-300 flex items-center gap-1.5">
              <Shield className="h-4 w-4" />
              Why Ordinary RBAC Fails Here
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              In traditional grading apps, &ldquo;blind review&rdquo; only hides the student&apos;s
              name in the frontend while the database administrator or chair still holds unilateral
              power to query the table early.
            </p>
            <p className="text-xs text-indigo-200/90 leading-relaxed font-medium">
              With TideCloak, candidate identities are encrypted client-side under tag{' '}
              <code className="px-1 py-0.5 rounded bg-slate-950 text-indigo-300">message</code>.
              Decryption authority only emerges when 3/3 judges lock their scores.
            </p>
          </div>
        </section>

        {/* RIGHT COLUMN (8 cols): Active Evaluation, Emergent Authority Gate & Rogue Admin Simulator */}
        <section className="lg:col-span-8 space-y-6">
          {selectedSub && (
            <>
              {/* Submission Header & Emergent Authority Status Banner */}
              <div className="p-6 rounded-xl bg-slate-900/90 border border-slate-800 space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1 max-w-xl">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold px-2.5 py-1 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                        Anonymous ID #{selectedSub.anonymousCode}
                      </span>
                      <span className="text-xs text-slate-400">{selectedSub.track}</span>
                    </div>
                    <h2 className="text-xl font-bold text-white pt-1">{selectedSub.title}</h2>
                    <p className="text-sm text-slate-300 leading-relaxed">{selectedSub.abstract}</p>
                  </div>

                  {/* Identity Vault Box */}
                  <div
                    className={`p-4 rounded-xl border min-w-[260px] ${
                      selectedSub.unmaskedIdentity
                        ? 'bg-emerald-950/30 border-emerald-500/50'
                        : 'bg-slate-950 border-slate-800'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                        Candidate Identity Vault
                      </span>
                      {selectedSub.unmaskedIdentity ? (
                        <Unlock className="h-4 w-4 text-emerald-400" />
                      ) : (
                        <Lock className="h-4 w-4 text-rose-400" />
                      )}
                    </div>

                    {selectedSub.unmaskedIdentity ? (
                      <div className="space-y-1 text-xs">
                        <p className="text-base font-bold text-emerald-300">
                          {selectedSub.unmaskedIdentity.fullName}
                        </p>
                        <p className="text-slate-300">
                          ID: <span className="font-mono">{selectedSub.unmaskedIdentity.studentId}</span>
                        </p>
                        <p className="text-slate-400">{selectedSub.unmaskedIdentity.university}</p>
                        {averageScore && (
                          <div className="mt-2 pt-2 border-t border-emerald-500/30 flex items-center justify-between">
                            <span className="text-emerald-200 font-medium">Final Quorum Avg:</span>
                            <span className="text-sm font-bold text-white bg-emerald-600 px-2 py-0.5 rounded">
                              {averageScore} / 100
                            </span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="p-2 rounded bg-slate-900 border border-slate-800 font-mono text-[10px] text-rose-300/90 break-all line-clamp-2">
                          {selectedSub.encryptedIdentity}
                        </div>
                        <p className="text-[11px] text-slate-400">
                          Sealed via <span className="text-indigo-300">{selectedSub.encryptionEngine}</span>
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Emergent Authority Quorum Progress Bar */}
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800/90 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-300 flex items-center gap-1.5">
                        <Sparkles className="h-4 w-4" />
                        Emergent Authority Threshold Policy (3-of-3 Judge Signatures)
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Neither the Chair nor the Database Server can decrypt the candidate identity
                        until all 3 judges lock their evaluation scores.
                      </p>
                    </div>
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-bold ${
                        quorumReached
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                          : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      }`}
                    >
                      {lockedCount} / {totalJudges} Scores Locked
                    </span>
                  </div>

                  {/* 3 Judge Cards */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {selectedSub.judges.map((j) => (
                      <div
                        key={j.judgeId}
                        onClick={() => setActiveJudgeId(j.judgeId)}
                        className={`cursor-pointer p-3 rounded-lg border transition ${
                          j.locked
                            ? 'bg-emerald-950/20 border-emerald-500/40'
                            : activeJudgeId === j.judgeId
                            ? 'bg-indigo-950/40 border-indigo-500'
                            : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-bold text-white">{j.judgeName}</span>
                          {j.locked ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                          ) : (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">
                              Pending
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-400">{j.role}</p>
                        {j.locked ? (
                          <div className="mt-2 pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs">
                            <span className="font-bold text-emerald-300">Score: {j.score}/100</span>
                            <span className="font-mono text-[10px] text-slate-400">
                              Sig: {j.signatureHash}
                            </span>
                          </div>
                        ) : (
                          <p className="mt-2 pt-2 border-t border-slate-800/80 text-[11px] text-indigo-300 font-medium">
                            Click to evaluate as {j.judgeName.split(' ')[1]} →
                          </p>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Action Bar: Try Rogue Admin Override vs Emergent Unmask */}
                  <div className="pt-2 flex flex-wrap items-center justify-between gap-3">
                    <button
                      onClick={handleRogueAdminAttempt}
                      className="px-4 py-2.5 rounded-lg text-xs font-bold bg-rose-950/80 hover:bg-rose-900/80 text-rose-200 border border-rose-500/50 transition flex items-center gap-2"
                    >
                      <ServerCrash className="h-4 w-4 text-rose-400" />
                      Simulate Rogue Admin / DB Override Attempt
                    </button>

                    <button
                      onClick={handleEmergentUnmask}
                      disabled={!quorumReached || Boolean(selectedSub.unmaskedIdentity)}
                      className={`px-5 py-2.5 rounded-lg text-xs font-bold transition flex items-center gap-2 ${
                        selectedSub.unmaskedIdentity
                          ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-500/40 cursor-default'
                          : quorumReached
                          ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/40 animate-pulse'
                          : 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
                      }`}
                    >
                      <Unlock className="h-4 w-4" />
                      {selectedSub.unmaskedIdentity
                        ? 'Identity Decrypted via TideCloak'
                        : quorumReached
                        ? '3/3 Quorum Met! Unlock Identity via TideCloak doDecrypt()'
                        : `Locked: Waiting for ${totalJudges - lockedCount} More Judge(s)`}
                    </button>
                  </div>
                </div>

                {/* Rogue Admin Inspection Output (If triggered) */}
                {rogueModalData && (
                  <div className="p-4 rounded-xl bg-rose-950/30 border border-rose-500/50 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-rose-300 flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-rose-400" />
                        ROGUE ADMIN / COMPROMISED SERVER DUMP BLOCKED BY TIDECLOAK
                      </span>
                      <button
                        onClick={() => setRogueModalData(null)}
                        className="text-xs text-slate-400 hover:text-white"
                      >
                        Dismiss
                      </button>
                    </div>
                    <pre className="p-3 rounded-lg bg-slate-950 text-[11px] font-mono text-rose-200 overflow-x-auto border border-rose-500/30">
                      {rogueModalData}
                    </pre>
                  </div>
                )}
              </div>

              {/* Judge Evaluation Form (Lock in 3rd Judge Score during live demo!) */}
              <div className="p-6 rounded-xl bg-slate-900/90 border border-slate-800 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <UserCheck className="h-4 w-4 text-indigo-400" />
                    Blind Grading Console — Active Reviewer:{' '}
                    <span className="text-indigo-300">{activeJudgeRecord?.judgeName}</span> (
                    {activeJudgeRecord?.role})
                  </h3>

                  <select
                    value={activeJudgeId}
                    onChange={(e) => setActiveJudgeId(e.target.value)}
                    className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-slate-200"
                  >
                    {selectedSub.judges.map((j) => (
                      <option key={j.judgeId} value={j.judgeId}>
                        Switch to: {j.judgeName} ({j.locked ? 'Locked' : 'Pending'})
                      </option>
                    ))}
                  </select>
                </div>

                {activeJudgeRecord?.locked ? (
                  <div className="p-4 rounded-lg bg-slate-950 border border-emerald-500/30 flex items-center justify-between">
                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-emerald-300">
                        This judge has already cryptographically locked their evaluation.
                      </p>
                      <p className="text-xs text-slate-400">&ldquo;{activeJudgeRecord.feedback}&rdquo;</p>
                    </div>
                    <div className="text-right">
                      <span className="text-lg font-bold text-white">
                        {activeJudgeRecord.score} / 100
                      </span>
                      <p className="text-[10px] font-mono text-slate-400">
                        Sig: {activeJudgeRecord.signatureHash}
                      </p>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={handleLockScore} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-slate-300 mb-1">
                          Score (0 - 100)
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          required
                          value={scoreInput}
                          onChange={(e) => setScoreInput(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-sm font-bold text-white"
                        />
                      </div>
                      <div className="md:col-span-3">
                        <label className="block text-xs font-medium text-slate-300 mb-1">
                          Written Evaluation (Logged prior to identity reveal)
                        </label>
                        <input
                          type="text"
                          required
                          value={feedbackInput}
                          onChange={(e) => setFeedbackInput(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-sm text-white"
                        />
                      </div>
                    </div>

                    <div className="flex justify-end">
                      <button
                        type="submit"
                        className="px-5 py-2.5 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-md transition flex items-center gap-2"
                      >
                        <Lock className="h-4 w-4" />
                        Sign & Lock Final Score as {activeJudgeRecord?.judgeName}
                      </button>
                    </div>
                  </form>
                )}
              </div>

              {/* Cryptographic Audit & Emergent Authority Log */}
              <div className="p-5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                    <Terminal className="h-4 w-4 text-indigo-400" />
                    TideCloak Emergent Authority Verification Log
                  </h3>
                  <span className="text-[11px] font-mono text-slate-400">
                    No Master Key Custody
                  </span>
                </div>

                <div className="space-y-2 max-h-48 overflow-y-auto pr-1 font-mono text-xs">
                  {auditLogs.map((log, i) => (
                    <div
                      key={i}
                      className={`p-2.5 rounded-lg border flex items-start gap-2.5 ${
                        log.status === 'BLOCKED'
                          ? 'bg-rose-950/30 border-rose-500/40 text-rose-200'
                          : log.status === 'ALLOWED'
                          ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-200'
                          : 'bg-slate-950 border-slate-800 text-slate-300'
                      }`}
                    >
                      <span className="text-[10px] text-slate-400 shrink-0">{log.time}</span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-bold shrink-0 ${
                          log.status === 'BLOCKED'
                            ? 'bg-rose-500/30 text-rose-300'
                            : log.status === 'ALLOWED'
                            ? 'bg-emerald-500/30 text-emerald-300'
                            : 'bg-indigo-500/20 text-indigo-300'
                        }`}
                      >
                        {log.actor}
                      </span>
                      <span className="text-[11px] leading-relaxed">{log.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </section>
      </main>

      {/* Modal: Candidate Client-Side Encrypted Submission */}
      {showSubmitModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <FileLock2 className="h-5 w-5 text-emerald-400" />
                <h3 className="text-base font-bold text-white">
                  Submit Project with TideCloak Client-Side Encryption
                </h3>
              </div>
              <button
                onClick={() => setShowSubmitModal(false)}
                className="text-xs text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateSubmission} className="space-y-3 text-xs">
              <div className="p-3 rounded-lg bg-indigo-950/40 border border-indigo-500/30 text-indigo-200">
                Your identity fields below are encrypted in the browser using{' '}
                <code>doEncrypt([&#123; data, tags: [&apos;message&apos;] &#125;])</code> before
                being sent to the Next.js server.
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 mb-1">Full Name (Encrypted)</label>
                  <input
                    type="text"
                    required
                    value={candName}
                    onChange={(e) => setCandName(e.target.value)}
                    className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-700 text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 mb-1">Student ID (Encrypted)</label>
                  <input
                    type="text"
                    required
                    value={candStudentId}
                    onChange={(e) => setCandStudentId(e.target.value)}
                    className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-700 text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 mb-1">Institution (Encrypted)</label>
                  <input
                    type="text"
                    required
                    value={candUni}
                    onChange={(e) => setCandUni(e.target.value)}
                    className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-700 text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 mb-1">Email (Encrypted)</label>
                  <input
                    type="email"
                    required
                    value={candEmail}
                    onChange={(e) => setCandEmail(e.target.value)}
                    className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-700 text-white"
                  />
                </div>
              </div>

              <div className="pt-2 border-t border-slate-800">
                <label className="block text-slate-300 mb-1">
                  Project Title (Visible to Blind Judges)
                </label>
                <input
                  type="text"
                  required
                  value={projTitle}
                  onChange={(e) => setProjTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-700 text-white"
                />
              </div>

              <div>
                <label className="block text-slate-300 mb-1">
                  Technical Abstract (Visible to Blind Judges)
                </label>
                <textarea
                  rows={3}
                  required
                  value={projAbstract}
                  onChange={(e) => setProjAbstract(e.target.value)}
                  className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-700 text-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSubmitModal(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center gap-1.5"
                >
                  <Send className="h-3.5 w-3.5" />
                  Encrypt Identity & Submit
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
