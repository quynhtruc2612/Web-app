import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { auth, db, handleFirestoreError, OperationType, storage } from './firebase';
import type { Submission } from '../types';

const CHUNK_CHAR_LIMIT = 550000; // safely under Firestore 1MB doc limit and 750k rule cap

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Failed to encode audio recording.'));
        return;
      }
      const commaIndex = result.indexOf(',');
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.onerror = () => reject(new Error('Unable to read recorded audio blob.'));
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType || 'audio/webm' });
}

export function getFileExtensionForMime(mimeType: string): string {
  const clean = mimeType.split(';')[0].trim().toLowerCase();
  if (clean.includes('mp4') || clean.includes('m4a')) return 'm4a';
  if (clean.includes('ogg')) return 'ogg';
  if (clean.includes('wav')) return 'wav';
  if (clean.includes('mpeg') || clean.includes('mp3')) return 'mp3';
  return 'webm';
}

export interface AudioUploadPrepResult {
  audioStorageType: 'firebase_storage' | 'firestore_chunks';
  audioStoragePath: string;
  audioChunkCount: number;
  base64Chunks: string[];
}

/**
 * Attempts upload to Firebase Cloud Storage first; if Storage bucket rules are
 * not yet enabled in the Firebase project, prepares authenticated Firestore
 * subcollection chunks so recordings persist reliably without losing data.
 */
export async function prepareOrUploadAudioToStorage(params: {
  blob: Blob;
  mimeType: string;
  studentUid: string;
  assignmentId: string;
  questionId: string;
  submissionId: string;
}): Promise<AudioUploadPrepResult> {
  const ext = getFileExtensionForMime(params.mimeType);
  const authUid = auth.currentUser?.uid || params.studentUid;
  const storagePath = `recordings/${authUid}/${params.assignmentId}/${params.questionId}/${params.submissionId}.${ext}`;

  try {
    const storageRef = ref(storage, storagePath);
    const uploadPromise = uploadBytes(storageRef, params.blob, {
      contentType: params.mimeType.split(';')[0] || 'audio/webm',
      customMetadata: {
        studentUid: authUid,
        canonicalStudentUid: params.studentUid,
        assignmentId: params.assignmentId,
        questionId: params.questionId,
      },
    });
    // Guard against hanging CORS/storage timeouts
    await Promise.race([
      uploadPromise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('storage/timeout')), 8000)
      ),
    ]);

    return {
      audioStorageType: 'firebase_storage',
      audioStoragePath: storagePath,
      audioChunkCount: 0,
      base64Chunks: [],
    };
  } catch (err) {
    console.warn(
      'Firebase Cloud Storage unavailable or unauthorized; persisting securely via Firestore audioChunks:',
      err instanceof Error ? err.message : String(err)
    );
    const fullBase64 = await blobToBase64(params.blob);
    const chunks: string[] = [];
    for (let i = 0; i < fullBase64.length; i += CHUNK_CHAR_LIMIT) {
      chunks.push(fullBase64.slice(i, i + CHUNK_CHAR_LIMIT));
    }
    if (chunks.length === 0) {
      chunks.push('');
    }
    return {
      audioStorageType: 'firestore_chunks',
      audioStoragePath: `submissions/${params.submissionId}/audioChunks`,
      audioChunkCount: chunks.length,
      base64Chunks: chunks,
    };
  }
}

export async function writeAudioChunksToFirestore(params: {
  submissionId: string;
  studentUid: string;
  chunks: string[];
}): Promise<void> {
  const basePath = `submissions/${params.submissionId}/audioChunks`;
  const authUid = auth.currentUser?.uid || params.studentUid;
  try {
    const batch = writeBatch(db);
    params.chunks.forEach((chunkData, index) => {
      const chunkRef = doc(db, basePath, String(index));
      batch.set(chunkRef, {
        chunkIndex: index,
        data: chunkData,
        studentUid: authUid,
        createdAt: serverTimestamp(),
      });
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, basePath);
  }
}

export async function resolveSubmissionAudioUrl(
  submission: Submission
): Promise<{ url: string; shouldRevoke: boolean }> {
  if (submission.audioStorageType === 'firebase_storage' && submission.audioStoragePath) {
    const storageRef = ref(storage, submission.audioStoragePath);
    const url = await getDownloadURL(storageRef);
    return { url, shouldRevoke: false };
  }

  if (submission.audioStorageType === 'firestore_chunks') {
    const chunksPath = `submissions/${submission.submissionId}/audioChunks`;
    try {
      const parts: string[] = [];

      if (submission.audioChunkCount > 0) {
        // Fetch deterministic chunk docs directly via getDoc (uses allow get Master Gate)
        const snaps = await Promise.all(
          Array.from({ length: submission.audioChunkCount }, (_, idx) =>
            getDoc(doc(db, chunksPath, String(idx)))
          )
        );
        for (const snap of snaps) {
          if (snap.exists()) {
            const data = snap.data();
            if (typeof data.data === 'string') {
              parts.push(data.data);
            }
          }
        }
      } else {
        const q = query(collection(db, chunksPath), orderBy('chunkIndex', 'asc'));
        const snap = await getDocs(q);
        snap.forEach((d) => {
          const data = d.data();
          if (typeof data.data === 'string') {
            parts.push(data.data);
          }
        });
      }

      if (parts.length === 0) {
        throw new Error('No audio recording chunks found for this submission.');
      }
      const blob = base64ToBlob(parts.join(''), submission.audioMimeType);
      const url = URL.createObjectURL(blob);
      return { url, shouldRevoke: true };
    } catch (error) {
      if (error instanceof Error && error.message.includes('No audio recording')) {
        throw error;
      }
      handleFirestoreError(error, OperationType.GET, chunksPath);
    }
  }

  throw new Error('Audio recording reference is unavailable.');
}
