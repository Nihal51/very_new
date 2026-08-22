/**
 * Firestore writes for the two public forms.
 *
 * The Firebase SDK is roughly 100 KB gzipped, so it is *not* part of the page
 * bundle: it is `import()`ed inside `submitDoc`, which only runs when someone
 * actually presses Submit. A visitor reading the pricing page downloads none of it.
 *
 * These NEXT_PUBLIC_* values are public identifiers by design — they are safe in
 * client code. What actually protects the data is `firestore.rules`, which must
 * be deployed (see README).
 */

export type Collection = 'bookings' | 'drivers';

export type SubmitFailure =
  | 'config' // env vars missing at build time
  | 'permission' // security rules rejected the write
  | 'network' // offline or Firestore unreachable
  | 'unknown';

export type SubmitResult =
  | { ok: true; id: string }
  | { ok: false; reason: SubmitFailure; message: string };

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

/** True when the build had Firebase credentials available. */
export function isFirebaseConfigured(): boolean {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
}

const FRIENDLY: Record<SubmitFailure, string> = {
  config:
    'Online booking is not connected on this deployment yet. Send your details on WhatsApp and we will confirm right away.',
  permission:
    'We could not save your request just now. Please send it on WhatsApp or call us — we will pick it up immediately.',
  network:
    'Your connection dropped while we were saving. Check your internet, or send the details on WhatsApp instead.',
  unknown:
    'Something went wrong while saving your request. Please send it on WhatsApp or call us — we do not want you waiting.',
};

/**
 * Write one document, then resolve with a plain result object.
 * Never throws: the caller renders an error state, and every failure path keeps
 * the WhatsApp fallback available so an outage cannot cost a lead.
 */
export async function submitDoc(
  collectionName: Collection,
  data: Record<string, unknown>,
): Promise<SubmitResult> {
  if (!isFirebaseConfigured()) {
    return { ok: false, reason: 'config', message: FRIENDLY.config };
  }

  try {
    const [{ initializeApp, getApps, getApp }, { getFirestore, collection, addDoc, serverTimestamp }] =
      await Promise.all([import('firebase/app'), import('firebase/firestore')]);

    const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
    const db = getFirestore(app);

    const ref = await addDoc(collection(db, collectionName), {
      ...data,
      createdAt: serverTimestamp(),
      // Carried over from the original site so existing console filters and any
      // dispatch workflow keyed on `status` keep working.
      status: 'new',
      source: 'website',
    });

    return { ok: true, id: ref.id };
  } catch (err: unknown) {
    const code = typeof err === 'object' && err && 'code' in err ? String(err.code) : '';
    const reason: SubmitFailure = code.includes('permission-denied')
      ? 'permission'
      : code.includes('unavailable') || code.includes('network')
        ? 'network'
        : 'unknown';

    if (process.env.NODE_ENV !== 'production') console.error('[drivebuddy] submit failed', err);
    return { ok: false, reason, message: FRIENDLY[reason] };
  }
}
