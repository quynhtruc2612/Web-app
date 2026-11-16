import 'dotenv/config';
import crypto from 'crypto';
import express, { type Request, type Response, type NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { createRemoteJWKSet, jwtVerify, SignJWT } from 'jose';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const PROMPT_VERSION = 'b1-pet-v1.0';
const GEMINI_MODEL = 'gemini-4-hydrogen';
const BOOTSTRAPPED_TEACHER_EMAIL = 'quynhtruc2612@gmail.com';
const STUDENT_TOKEN_TTL_SECONDS = 4 * 60 * 60; // 4 hours

interface FirebaseAppletConfig {
  projectId: string;
  firestoreDatabaseId?: string;
  storageBucket?: string;
}

let firebaseProjectId = '';
let firestoreDatabaseId = '(default)';
try {
  const configPath = path.resolve(__dirname, 'firebase-applet-config.json');
  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as FirebaseAppletConfig;
    firebaseProjectId = parsed.projectId || '';
    firestoreDatabaseId = parsed.firestoreDatabaseId || '(default)';
  }
} catch (err) {
  console.error('Failed to read firebase-applet-config.json:', err);
}

// Server-only HMAC signing key for short-lived student session tokens (never exposed to clients)
const SESSION_SECRET_KEY = new Uint8Array(
  process.env.STUDENT_SESSION_SECRET
    ? crypto.createHash('sha256').update(process.env.STUDENT_SESSION_SECRET).digest()
    : process.env.GEMINI_API_KEY
    ? crypto
        .createHash('sha256')
        .update(`b1-speaking-session:${process.env.GEMINI_API_KEY}:${firebaseProjectId}`)
        .digest()
    : crypto.randomBytes(32)
);

const revokedSessionJtis = new Map<string, number>();
const sessionAttemptWindows = new Map<string, { count: number; resetAt: number }>();

function cleanupExpiredMaps() {
  const now = Date.now();
  for (const [jti, expMs] of revokedSessionJtis.entries()) {
    if (expMs <= now) revokedSessionJtis.delete(jti);
  }
  for (const [ip, win] of sessionAttemptWindows.entries()) {
    if (win.resetAt <= now) sessionAttemptWindows.delete(ip);
  }
}

function checkSessionRateLimit(ip: string): boolean {
  cleanupExpiredMaps();
  const now = Date.now();
  const entry = sessionAttemptWindows.get(ip);
  if (!entry || entry.resetAt <= now) {
    sessionAttemptWindows.set(ip, { count: 1, resetAt: now + 10 * 60 * 1000 });
    return true;
  }
  if (entry.count >= 30) {
    return false;
  }
  entry.count += 1;
  return true;
}

const JWKS = createRemoteJWKSet(
  new URL(
    'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'
  )
);

interface VerifiedStudentSessionInfo {
  sessionUid: string;
  canonicalStudentUid: string;
  rosterId: string;
  studentId: string;
  fullName: string;
  className: string;
  expiresAtMs: number;
}

interface AuthenticatedRequest extends Request {
  authUser?: {
    uid: string;
    email: string;
    emailVerified: boolean;
    isAnonymous: boolean;
    idToken: string;
  };
  studentSession?: VerifiedStudentSessionInfo;
}

interface FirestoreRestDoc {
  fields?: Record<
    string,
    {
      stringValue?: string;
      timestampValue?: string;
      booleanValue?: boolean;
      integerValue?: string;
    }
  >;
}

async function fetchFirestoreDocWithToken(
  collectionPath: string,
  docId: string,
  idToken: string
): Promise<FirestoreRestDoc | null> {
  if (!firebaseProjectId) return null;
  const safeDb = encodeURIComponent(firestoreDatabaseId || '(default)');
  const safeCol = collectionPath
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/');
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    firebaseProjectId
  )}/databases/${safeDb}/documents/${safeCol}/${encodeURIComponent(docId)}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });

  if (!res.ok) {
    return null;
  }
  return (await res.json()) as FirestoreRestDoc;
}

async function fetchActiveStudentSessionFromFirestore(
  uid: string,
  idToken: string
): Promise<VerifiedStudentSessionInfo | null> {
  const doc = await fetchFirestoreDocWithToken('studentSessions', uid, idToken);
  if (!doc || !doc.fields) return null;

  const status = doc.fields.status?.stringValue || '';
  const expiresAtIso = doc.fields.expiresAt?.timestampValue || '';
  const expiresAtMs = expiresAtIso ? Date.parse(expiresAtIso) : 0;

  if (status !== 'active' || !Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    return null;
  }

  const sessionUid = doc.fields.sessionUid?.stringValue || '';
  const studentIdKey = doc.fields.studentIdKey?.stringValue || '';
  const studentId = doc.fields.studentId?.stringValue || '';
  const fullName = doc.fields.fullName?.stringValue || '';
  const className = doc.fields.className?.stringValue || '';

  if (sessionUid !== uid || !studentIdKey || !studentId || !fullName || !className) {
    return null;
  }

  return {
    sessionUid,
    canonicalStudentUid: `stu_${studentIdKey}`,
    rosterId: studentIdKey,
    studentId,
    fullName,
    className,
    expiresAtMs,
  };
}

async function isVerifiedTeacherAccount(
  uid: string,
  email: string,
  emailVerified: boolean,
  idToken: string
): Promise<boolean> {
  if (!emailVerified) return false;
  if (email.toLowerCase() === BOOTSTRAPPED_TEACHER_EMAIL.toLowerCase()) {
    return true;
  }
  const userDoc = await fetchFirestoreDocWithToken('users', uid, idToken);
  if (!userDoc?.fields) return false;
  return (
    userDoc.fields.role?.stringValue === 'teacher' &&
    userDoc.fields.accountStatus?.stringValue === 'active'
  );
}

async function verifyFirebaseTokenOnly(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid authorization token.' });
      return;
    }

    if (!firebaseProjectId) {
      res.status(500).json({ error: 'Firebase project configuration is missing on the server.' });
      return;
    }

    const token = authHeader.slice('Bearer '.length).trim();
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `https://securetoken.google.com/${firebaseProjectId}`,
      audience: firebaseProjectId,
    });

    const uid = typeof payload.sub === 'string' ? payload.sub : '';
    const email = typeof payload.email === 'string' ? payload.email : '';
    const emailVerified = payload.email_verified === true;
    const firebaseClaim = payload.firebase as { sign_in_provider?: string } | undefined;
    const isAnonymous = firebaseClaim?.sign_in_provider === 'anonymous';

    if (!uid) {
      res.status(401).json({ error: 'Invalid Firebase authentication token.' });
      return;
    }

    req.authUser = {
      uid,
      email,
      emailVerified,
      isAnonymous,
      idToken: token,
    };
    next();
  } catch (err) {
    console.error('Token verification failed:', err);
    res.status(401).json({
      error: 'Authentication token is invalid or expired. Please start a new session.',
    });
  }
}

async function verifyAssessAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  await verifyFirebaseTokenOnly(req, res, async () => {
    const authUser = req.authUser;
    if (!authUser) return;

    // Path 1: Verified Teacher (Google Auth)
    if (!authUser.isAnonymous && authUser.emailVerified) {
      const teacherOk = await isVerifiedTeacherAccount(
        authUser.uid,
        authUser.email,
        authUser.emailVerified,
        authUser.idToken
      );
      if (teacherOk) {
        next();
        return;
      }
    }

    // Path 2: Verified Student (Firebase Anonymous Auth + Server-Signed Student Session Token + Active Firestore Session)
    const sessionHeader = req.headers['x-student-session'];
    const sessionToken = typeof sessionHeader === 'string' ? sessionHeader.trim() : '';
    if (!sessionToken) {
      res.status(401).json({
        error: 'Your student speaking session token is missing. Please re-enter your Student ID and Class.',
      });
      return;
    }

    try {
      const { payload } = await jwtVerify(sessionToken, SESSION_SECRET_KEY, {
        algorithms: ['HS256'],
        issuer: 'b1-speaking-practice',
        audience: 'student-session',
      });

      const jti = typeof payload.jti === 'string' ? payload.jti : '';
      if (!jti || revokedSessionJtis.has(jti)) {
        res.status(401).json({
          error: 'Your student session has ended. Please enter your details again to continue.',
        });
        return;
      }

      if (payload.sub !== authUser.uid || payload.role !== 'student') {
        res.status(403).json({ error: 'Student session mismatch. Access denied.' });
        return;
      }

      const activeFirestoreSession = await fetchActiveStudentSessionFromFirestore(
        authUser.uid,
        authUser.idToken
      );
      if (!activeFirestoreSession) {
        res.status(401).json({
          error: 'Your temporary student session is expired or inactive. Please start a new session.',
        });
        return;
      }

      req.studentSession = activeFirestoreSession;
      next();
    } catch (err) {
      console.error('Student session token verification failed:', err);
      res.status(401).json({
        error: 'Your student session token expired or is invalid. Please re-verify your Student ID.',
      });
    }
  });
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024, // 20 MB max for up to 5 minutes of compressed speech
  },
});

function normalizeAudioMimeType(rawMime: string): string {
  const base = (rawMime || 'audio/webm').split(';')[0].trim().toLowerCase();
  if (base === 'audio/x-m4a' || base === 'audio/m4a') return 'audio/mp4';
  if (base === 'audio/wave' || base === 'audio/x-wav') return 'audio/wav';
  if (base === 'video/webm') return 'audio/webm';
  return base || 'audio/webm';
}

function clampCriterionScore(val: unknown): number {
  const num = typeof val === 'number' ? val : Number(val);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(5, Math.round(num)));
}

function buildAssessmentSystemInstruction(): string {
  return `You are an encouraging, experienced English speaking examiner and coach assessing a B1-level learner's spoken response aligned with selected B1 Preliminary (PET) speaking criteria.

CRITICAL RULES:
1. Evaluate ONLY these THREE criteria on a 0 to 5 integer scale:
   - Grammar & Vocabulary (0-5): Grammatical accuracy and appropriate use of B1 structures, vocabulary range/variety, word choice, natural expressions, relevance to the question.
   - Discourse Management (0-5): Clarity and logical organization, developing/extending answers with details or examples, linking words/cohesive devices, overall coherence and fluency. Never reward length alone if repetitive or off-topic.
   - Pronunciation (0-5): Evaluate directly from the ACTUAL AUDIO RECORDING: intelligibility, clarity, individual sounds where clearly identifiable, final consonants/word endings, word and sentence stress, intonation and pausing. Be fair to different accents (such as Vietnamese accents) whenever speech is understandable. If audio quality is too noisy or unclear to evaluate specific features, note that limitation honestly instead of guessing.
2. NEVER add Interactive Communication or any 4th criterion.
3. TRANSCRIPT RULES:
   - Transcribe the student's exact spoken words accurately.
   - Preserve original mistakes; do NOT silently fix grammar in the transcript.
   - Mark unclear words as [unclear] instead of guessing or inventing speech.
   - Do NOT fabricate timestamps or pretend you heard speech that isn't there.
4. AUDIO QUALITY / EMPTY CHECK:
   - If the audio is silent, corrupted, completely unintelligible, or too brief/empty to contain meaningful English speech (e.g. under 2 words of intelligible speech), set assessment_status to "needs_rerecording", explain the reason clearly in overall_comment, and set all three criterion scores to 0.
5. EXPRESSION CORRECTIONS:
   - Only include phrases in expression_corrections that ACTUALLY appear verbatim in the transcript. Never invent errors.
   - Suggest natural, achievable B1-level alternatives (avoid overly complex C1/C2 vocabulary).
   - If no significant corrections are needed, return an empty array for expression_corrections.
6. FEEDBACK TONE:
   - Use clear, supportive, simple B1-friendly English.
   - Highlight 2-3 specific strengths and 2-3 achievable priority improvements.
   - Keep overall_comment encouraging with one practical next step.`;
}

async function runGeminiAssessment(params: {
  audioBuffer: Buffer;
  mimeType: string;
  questionPrompt: string;
  weekTitle: string;
  speakingTopic: string;
  recordingDuration: number;
}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY_MISSING');
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const base64Audio = params.audioBuffer.toString('base64');

  const promptText = `Assess this student's spoken English response.

Assignment Context:
- Assignment: ${params.weekTitle}
- Speaking Topic: ${params.speakingTopic}
- Speaking Question: "${params.questionPrompt}"
- Recorded Duration: ${Math.round(params.recordingDuration)} seconds

Please listen carefully to the attached audio recording, transcribe it verbatim, evaluate the three B1 criteria (Grammar & Vocabulary, Discourse Management, Pronunciation from the audio), and return the structured JSON response.`;

  const responseSchema = {
    type: Type.OBJECT,
    properties: {
      transcript: {
        type: Type.STRING,
        description: 'Exact verbatim transcript preserving original wording; use [unclear] for unintelligible parts.',
      },
      assessment_status: {
        type: Type.STRING,
        description: 'Must be "completed" if speech is assessable, or "needs_rerecording" if silent/corrupted/insufficient.',
      },
      grammar_vocabulary: {
        type: Type.OBJECT,
        properties: {
          score: { type: Type.INTEGER, description: 'Integer score 0 to 5.' },
          feedback: { type: Type.STRING },
          strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
          improvements: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['score', 'feedback', 'strengths', 'improvements'],
      },
      discourse_management: {
        type: Type.OBJECT,
        properties: {
          score: { type: Type.INTEGER, description: 'Integer score 0 to 5.' },
          feedback: { type: Type.STRING },
          strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
          improvements: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['score', 'feedback', 'strengths', 'improvements'],
      },
      pronunciation: {
        type: Type.OBJECT,
        properties: {
          score: { type: Type.INTEGER, description: 'Integer score 0 to 5 based on the audio.' },
          feedback: { type: Type.STRING },
          strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
          improvements: { type: Type.ARRAY, items: { type: Type.STRING } },
          evidence: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Specific words or features observed in the audio.',
          },
        },
        required: ['score', 'feedback', 'strengths', 'improvements', 'evidence'],
      },
      what_you_did_well: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
      },
      areas_to_improve: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
      },
      expression_corrections: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            original: { type: Type.STRING },
            improved: { type: Type.STRING },
            explanation: { type: Type.STRING },
          },
          required: ['original', 'improved', 'explanation'],
        },
      },
      overall_comment: {
        type: Type.STRING,
      },
    },
    required: [
      'transcript',
      'assessment_status',
      'grammar_vocabulary',
      'discourse_management',
      'pronunciation',
      'what_you_did_well',
      'areas_to_improve',
      'expression_corrections',
      'overall_comment',
    ],
  };

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: params.mimeType,
                data: base64Audio,
              },
            },
            { text: promptText },
          ],
        },
        config: {
          systemInstruction: buildAssessmentSystemInstruction(),
          responseMimeType: 'application/json',
          responseSchema,
        },
      });

      const rawText = (response.text ?? '').trim();
      if (!rawText) {
        throw new Error('Empty response returned from Gemini API.');
      }

      const parsed = JSON.parse(rawText);

      const isNeedsRerecording = parsed.assessment_status === 'needs_rerecording';
      const transcript = String(parsed.transcript || '').slice(0, 15000);

      if (isNeedsRerecording) {
        return {
          transcript: transcript || '[unclear]',
          assessment: null,
          overallScore: null,
          what_you_did_well: [],
          areas_to_improve: Array.isArray(parsed.areas_to_improve)
            ? parsed.areas_to_improve.map(String).slice(0, 5)
            : ['Please record again in a quiet environment with your microphone close to your mouth.'],
          expression_corrections: [],
          overall_comment: String(
            parsed.overall_comment ||
              'The recording was too quiet, unclear, or too short to assess reliably. Please record your answer again.'
          ).slice(0, 3000),
          assessment_status: 'needs_rerecording' as const,
          aiModel: GEMINI_MODEL,
          promptVersion: PROMPT_VERSION,
        };
      }

      const gvScore = clampCriterionScore(parsed.grammar_vocabulary?.score);
      const dmScore = clampCriterionScore(parsed.discourse_management?.score);
      const prScore = clampCriterionScore(parsed.pronunciation?.score);

      // Server-authoritative overall score calculation
      const overallScore = Math.round(((gvScore + dmScore + prScore) / 3) * 10) / 10;

      const assessment = {
        grammar_vocabulary: {
          score: gvScore,
          feedback: String(parsed.grammar_vocabulary?.feedback || '').slice(0, 1500),
          strengths: Array.isArray(parsed.grammar_vocabulary?.strengths)
            ? parsed.grammar_vocabulary.strengths.map(String).slice(0, 5)
            : [],
          improvements: Array.isArray(parsed.grammar_vocabulary?.improvements)
            ? parsed.grammar_vocabulary.improvements.map(String).slice(0, 5)
            : [],
        },
        discourse_management: {
          score: dmScore,
          feedback: String(parsed.discourse_management?.feedback || '').slice(0, 1500),
          strengths: Array.isArray(parsed.discourse_management?.strengths)
            ? parsed.discourse_management.strengths.map(String).slice(0, 5)
            : [],
          improvements: Array.isArray(parsed.discourse_management?.improvements)
            ? parsed.discourse_management.improvements.map(String).slice(0, 5)
            : [],
        },
        pronunciation: {
          score: prScore,
          feedback: String(parsed.pronunciation?.feedback || '').slice(0, 1500),
          strengths: Array.isArray(parsed.pronunciation?.strengths)
            ? parsed.pronunciation.strengths.map(String).slice(0, 5)
            : [],
          improvements: Array.isArray(parsed.pronunciation?.improvements)
            ? parsed.pronunciation.improvements.map(String).slice(0, 5)
            : [],
          evidence: Array.isArray(parsed.pronunciation?.evidence)
            ? parsed.pronunciation.evidence.map(String).slice(0, 6)
            : [],
        },
        overall_score: overallScore,
      };

      const corrections = Array.isArray(parsed.expression_corrections)
        ? parsed.expression_corrections
            .filter(
              (c: any) =>
                c &&
                typeof c.original === 'string' &&
                c.original.trim().length > 0 &&
                typeof c.improved === 'string' &&
                c.improved.trim().length > 0
            )
            .slice(0, 10)
            .map((c: any) => ({
              original: String(c.original).slice(0, 300),
              improved: String(c.improved).slice(0, 300),
              explanation: String(c.explanation || '').slice(0, 400),
            }))
        : [];

      return {
        transcript,
        assessment,
        overallScore,
        what_you_did_well: Array.isArray(parsed.what_you_did_well)
          ? parsed.what_you_did_well.map(String).slice(0, 5)
          : [],
        areas_to_improve: Array.isArray(parsed.areas_to_improve)
          ? parsed.areas_to_improve.map(String).slice(0, 5)
          : [],
        expression_corrections: corrections,
        overall_comment: String(parsed.overall_comment || '').slice(0, 3000),
        assessment_status: 'completed' as const,
        aiModel: GEMINI_MODEL,
        promptVersion: PROMPT_VERSION,
      };
    } catch (err) {
      lastError = err;
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 800));
      }
    }
  }

  throw lastError;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
      firebaseProjectConfigured: Boolean(firebaseProjectId),
      studentSessionAuthEnabled: true,
    });
  });

  // Issues a short-lived signed student session token ONLY after verifying both the Firebase Anonymous Auth token
  // AND the Firestore rule-validated studentSessions/{uid} document (never trusting client-supplied student name/ID).
  app.post(
    '/api/student/session',
    verifyFirebaseTokenOnly,
    async (req: AuthenticatedRequest, res: Response) => {
      const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
      if (!checkSessionRateLimit(clientIp)) {
        res.status(429).json({
          error: 'Too many verification attempts. Please wait a few minutes and try again.',
        });
        return;
      }

      const authUser = req.authUser;
      if (!authUser) return;

      if (!authUser.isAnonymous) {
        res.status(403).json({
          error: 'Student session endpoint is restricted to verified student access.',
        });
        return;
      }

      try {
        const session = await fetchActiveStudentSessionFromFirestore(
          authUser.uid,
          authUser.idToken
        );
        if (!session) {
          res.status(403).json({
            error:
              'Student identity could not be verified. Please check your Full Name, Student ID, and Class.',
          });
          return;
        }

        const nowSeconds = Math.floor(Date.now() / 1000);
        const firestoreExpSeconds = Math.floor(session.expiresAtMs / 1000);
        const tokenExpSeconds = Math.min(
          firestoreExpSeconds,
          nowSeconds + STUDENT_TOKEN_TTL_SECONDS
        );
        const jti = crypto.randomUUID();

        const sessionToken = await new SignJWT({
          role: 'student',
          canonicalStudentUid: session.canonicalStudentUid,
          rosterId: session.rosterId,
          studentId: session.studentId,
          fullName: session.fullName,
          className: session.className,
        })
          .setProtectedHeader({ alg: 'HS256' })
          .setIssuedAt(nowSeconds)
          .setExpirationTime(tokenExpSeconds)
          .setIssuer('b1-speaking-practice')
          .setAudience('student-session')
          .setSubject(authUser.uid)
          .setJti(jti)
          .sign(SESSION_SECRET_KEY);

        res.json({
          sessionToken,
          expiresAt: tokenExpSeconds * 1000,
          student: {
            canonicalStudentUid: session.canonicalStudentUid,
            studentId: session.studentId,
            fullName: session.fullName,
            className: session.className,
          },
        });
      } catch (err) {
        console.error('Failed to issue student session token:', err);
        res.status(500).json({ error: 'Unable to verify student session right now.' });
      }
    }
  );

  app.post('/api/student/logout', async (req: Request, res: Response) => {
    const sessionHeader = req.headers['x-student-session'];
    const sessionToken = typeof sessionHeader === 'string' ? sessionHeader.trim() : '';
    if (sessionToken) {
      try {
        const { payload } = await jwtVerify(sessionToken, SESSION_SECRET_KEY, {
          algorithms: ['HS256'],
          issuer: 'b1-speaking-practice',
          audience: 'student-session',
        });
        if (typeof payload.jti === 'string') {
          const expMs =
            typeof payload.exp === 'number'
              ? payload.exp * 1000
              : Date.now() + STUDENT_TOKEN_TTL_SECONDS * 1000;
          revokedSessionJtis.set(payload.jti, expMs);
        }
      } catch {
        // Token already expired or invalid; safe to ignore on logout
      }
    }
    res.json({ ok: true });
  });

  app.post(
    '/api/assess',
    verifyAssessAuth,
    upload.single('audio'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const file = req.file;
        const questionPrompt = String(req.body?.questionPrompt || '').trim();
        const weekTitle = String(req.body?.weekTitle || 'Weekly Speaking Practice').trim();
        const speakingTopic = String(req.body?.speakingTopic || 'General Speaking').trim();
        const recordingDuration = Number(req.body?.recordingDuration || 0);

        if (!questionPrompt) {
          res.status(400).json({ error: 'Speaking question prompt is required.' });
          return;
        }

        if (!Number.isFinite(recordingDuration) || recordingDuration < 0 || recordingDuration > 305) {
          res.status(400).json({ error: 'Recording duration must be between 0 and 300 seconds.' });
          return;
        }

        if (!file || !file.buffer || file.buffer.length < 500) {
          res.json({
            transcript: '[unclear]',
            assessment: null,
            overallScore: null,
            what_you_did_well: [],
            areas_to_improve: [
              'Please check your microphone connection and speak for at least a few seconds before submitting.',
            ],
            expression_corrections: [],
            overall_comment:
              'The submitted audio recording was empty or too short to evaluate. Please record your answer again.',
            assessment_status: 'needs_rerecording',
            aiModel: GEMINI_MODEL,
            promptVersion: PROMPT_VERSION,
          });
          return;
        }

        const mimeType = normalizeAudioMimeType(file.mimetype || req.body?.mimeType || 'audio/webm');

        const result = await runGeminiAssessment({
          audioBuffer: file.buffer,
          mimeType,
          questionPrompt,
          weekTitle,
          speakingTopic,
          recordingDuration,
        });

        res.json(result);
      } catch (err: any) {
        console.error('AI Assessment error:', err);
        if (err instanceof Error && err.message === 'GEMINI_API_KEY_MISSING') {
          res.status(503).json({
            error:
              'Gemini AI assessment is not configured on the server (GEMINI_API_KEY missing). Your recording has been saved and can be assessed once configured.',
          });
          return;
        }
        const message =
          err?.message || 'Unable to complete AI speaking assessment right now. Please retry.';
        res.status(502).json({
          error: `AI assessment service error: ${message}`,
        });
      }
    }
  );

  // Multer / express error handler
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof multer.MulterError) {
      res.status(400).json({ error: `Audio upload error: ${err.message}` });
      return;
    }
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`B1 Speaking Practice server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
