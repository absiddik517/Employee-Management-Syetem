import { initializeApp, deleteApp, getApps } from 'firebase/app';
import { getAuth, initializeAuth, inMemoryPersistence } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

// Centralized Firebase configuration (can be switched to import.meta.env later)
export const firebaseConfig = {
  apiKey: "AIzaSyCSU0iYIL7cVobL0P6xeUV_87Bm5ZG_h7w",
  authDomain: "iron-ivy-jvc14.firebaseapp.com",
  projectId: "iron-ivy-jvc14",
  storageBucket: "iron-ivy-jvc14.firebasestorage.app",
  messagingSenderId: "793943202811",
  appId: "1:793943202811:web:d7e8937008a99832d0495e"
};

const firestoreDatabaseId = 'ai-studio-6b59576b-9eb4-4341-b9bd-1bed0ff2719e';

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = firestoreDatabaseId
  ? getFirestore(app, firestoreDatabaseId)
  : getFirestore(app);
export const storage = getStorage(app);

// Keep Storage retries bounded so missing bucket / CORS errors do not hang forms for 10 minutes
storage.maxUploadRetryTime = 12000;
storage.maxOperationRetryTime = 12000;

export function withTimeout(promise, ms = 20000, errorMessage = 'Operation timed out. Please try again.') {
  let timerId;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timerId = setTimeout(() => reject(new Error(errorMessage)), ms);
    })
  ]).finally(() => {
    if (timerId) clearTimeout(timerId);
  });
}

// Secondary Firebase app instance used when an administrator creates or inspects a user
// so the caller's active auth session is never replaced.
export function getSecondaryAuthApp() {
  const name = `secondary-admin-creator-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const existing = getApps().find((a) => a.name === name);
  if (existing) return existing;
  return initializeApp(firebaseConfig, name);
}

export function getSecondaryAuth(secondaryApp) {
  try {
    return initializeAuth(secondaryApp, { persistence: inMemoryPersistence });
  } catch {
    return getAuth(secondaryApp);
  }
}

export async function disposeSecondaryApp(secondaryApp) {
  try {
    if (secondaryApp) {
      await Promise.race([
        deleteApp(secondaryApp),
        new Promise((resolve) => setTimeout(resolve, 1500))
      ]);
    }
  } catch {
    // ignore cleanup error
  }
}

export const OperationType = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  LIST: 'list',
  GET: 'get',
  WRITE: 'write'
};

export function handleFirestoreError(error, operationType, path) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid || null,
      email: auth.currentUser?.email || null,
      emailVerified: auth.currentUser?.emailVerified ?? null,
      isAnonymous: auth.currentUser?.isAnonymous ?? null,
      tenantId: auth.currentUser?.tenantId || null,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email
        })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testFirestoreConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

testFirestoreConnection();
