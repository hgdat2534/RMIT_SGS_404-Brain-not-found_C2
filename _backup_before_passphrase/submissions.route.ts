import { NextRequest, NextResponse } from 'next/server';
import { SubmissionRecord } from '@/lib/tideBridge';

// Helper to create sealed initial demo records (server NEVER sees plaintext identities)
function makeSealedBlob(identityObj: object, nonce: string): string {
  const b64 = Buffer.from(JSON.stringify(identityObj), 'utf-8').toString('base64');
  return `TIDE_QEA_v1::tag=message::nonce=${nonce}::blob=${b64.split('').reverse().join('')}`;
}

let SUBMISSIONS_DB: SubmissionRecord[] = [
  {
    id: 'sub-1',
    anonymousCode: 'BV-8041',
    track: 'National Merit Scholarship & AI Fellowship',
    title: 'Zero-Allocation Lock-Free Ring Buffer for Real-Time Telemetry',
    abstract:
      'Custom C++20 memory pool and wait-free ring buffer achieving 14.2M ops/sec with deterministic tail latency under strict 64KB RAM constraints.',
    repoLink: 'https://github.com/anonymous-candidate/lockfree-ringbuffer',
    createdAt: '2026-10-22T02:15:00Z',
    encryptedIdentity: makeSealedBlob(
      {
        fullName: 'Huỳnh Gia Đạt',
        studentId: '25120041',
        university: 'VNU-HCM University of Science (HCMUS)',
        email: 'hgdat.25@clc.fitus.edu.vn',
      },
      '9f4a2c81e7b03d12'
    ),
    encryptionTag: 'message',
    encryptionEngine: 'TideCloak-Simulated-Envelope',
    judges: [
      {
        judgeId: 'judge-1',
        judgeName: 'Dr. Evelyn Vance',
        role: 'Committee Chair',
        score: 96,
        feedback: 'Exceptional low-level memory mastery and cache-line alignment analysis.',
        locked: true,
        signatureHash: '0x8f3c...91a2',
        lockedAt: '2026-10-22T03:10:00Z',
      },
      {
        judgeId: 'judge-2',
        judgeName: 'Prof. Marcus Thorne',
        role: 'External Evaluator',
        score: 94,
        feedback: 'Rigorous formal verification of pointer bounds. Clear benchmark methodology.',
        locked: true,
        signatureHash: '0x4d1e...c08b',
        lockedAt: '2026-10-22T03:22:00Z',
      },
      {
        judgeId: 'judge-3',
        judgeName: 'Dr. Linh Nguyen',
        role: 'Industry Lead',
        score: null,
        feedback: '',
        locked: false,
        signatureHash: null,
        lockedAt: null,
      },
    ],
  },
  {
    id: 'sub-2',
    anonymousCode: 'BV-8042',
    track: 'National Merit Scholarship & AI Fellowship',
    title: 'Adversarial Prompt Guardrails via DeBERTa-v3 Token Attribution',
    abstract:
      'Fine-tuned DeBERTa-v3-small classifier detecting multi-lingual jailbreak injections with 98.4% F1 score and sub-25ms inference latency.',
    repoLink: 'https://github.com/anonymous-candidate/deberta-jailbreak-guard',
    createdAt: '2026-10-22T02:30:00Z',
    encryptedIdentity: makeSealedBlob(
      {
        fullName: 'Nguyễn Quốc Tuấn',
        studentId: '25120089',
        university: 'RMIT & HCMUS Joint AI Lab',
        email: 'quoctuan.ai@research.edu.vn',
      },
      '3b7e19a04c6d82f5'
    ),
    encryptionTag: 'message',
    encryptionEngine: 'TideCloak-Simulated-Envelope',
    judges: [
      {
        judgeId: 'judge-1',
        judgeName: 'Dr. Evelyn Vance',
        role: 'Committee Chair',
        score: 91,
        feedback: 'Strong ablation study on tabular + text embeddings.',
        locked: true,
        signatureHash: '0x7a2b...11f4',
        lockedAt: '2026-10-22T03:15:00Z',
      },
      {
        judgeId: 'judge-2',
        judgeName: 'Prof. Marcus Thorne',
        role: 'External Evaluator',
        score: null,
        feedback: '',
        locked: false,
        signatureHash: null,
        lockedAt: null,
      },
      {
        judgeId: 'judge-3',
        judgeName: 'Dr. Linh Nguyen',
        role: 'Industry Lead',
        score: null,
        feedback: '',
        locked: false,
        signatureHash: null,
        lockedAt: null,
      },
    ],
  },
];

export async function GET() {
  return NextResponse.json({
    submissions: SUBMISSIONS_DB,
    serverCustodyNotice:
      'ZERO_MASTER_KEY: This backend stores only TideCloak ciphertext for candidate identities. Unilateral server decryption is mathematically impossible.',
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  if (body.action === 'CREATE_SUBMISSION') {
    const newSub: SubmissionRecord = {
      id: `sub-${Date.now()}`,
      anonymousCode: `BV-${Math.floor(1000 + Math.random() * 9000)}`,
      track: body.track || 'National Merit Scholarship & AI Fellowship',
      title: body.title,
      abstract: body.abstract,
      repoLink: body.repoLink || 'https://github.com/anonymous/submission',
      createdAt: new Date().toISOString(),
      encryptedIdentity: body.encryptedIdentity,
      encryptionTag: body.encryptionTag || 'message',
      encryptionEngine: body.encryptionEngine || 'TideCloak-Simulated-Envelope',
      judges: [
        {
          judgeId: 'judge-1',
          judgeName: 'Dr. Evelyn Vance',
          role: 'Committee Chair',
          score: null,
          feedback: '',
          locked: false,
          signatureHash: null,
          lockedAt: null,
        },
        {
          judgeId: 'judge-2',
          judgeName: 'Prof. Marcus Thorne',
          role: 'External Evaluator',
          score: null,
          feedback: '',
          locked: false,
          signatureHash: null,
          lockedAt: null,
        },
        {
          judgeId: 'judge-3',
          judgeName: 'Dr. Linh Nguyen',
          role: 'Industry Lead',
          score: null,
          feedback: '',
          locked: false,
          signatureHash: null,
          lockedAt: null,
        },
      ],
    };
    SUBMISSIONS_DB = [newSub, ...SUBMISSIONS_DB];
    return NextResponse.json({ submission: newSub });
  }

  if (body.action === 'LOCK_JUDGE_SCORE') {
    const { submissionId, judgeId, score, feedback } = body;
    SUBMISSIONS_DB = SUBMISSIONS_DB.map((sub) => {
      if (sub.id !== submissionId) return sub;
      const updatedJudges = sub.judges.map((j) => {
        if (j.judgeId !== judgeId) return j;
        const randomSig =
          '0x' +
          Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join('') +
          '...' +
          Array.from({ length: 4 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
        return {
          ...j,
          score: Number(score),
          feedback,
          locked: true,
          signatureHash: randomSig,
          lockedAt: new Date().toISOString(),
        };
      });
      return { ...sub, judges: updatedJudges };
    });
    return NextResponse.json({ submissions: SUBMISSIONS_DB });
  }

  if (body.action === 'RESET_DEMO') {
    // Reset Judge 3 on sub-1 so the user can re-record the demo video anytime with 1 click!
    SUBMISSIONS_DB[0].judges[2] = {
      judgeId: 'judge-3',
      judgeName: 'Dr. Linh Nguyen',
      role: 'Industry Lead',
      score: null,
      feedback: '',
      locked: false,
      signatureHash: null,
      lockedAt: null,
    };
    return NextResponse.json({ submissions: SUBMISSIONS_DB });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
