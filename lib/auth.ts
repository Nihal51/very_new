/**
 * Customer and admin login, on Firebase Authentication.
 *
 * Two ways in: a phone number + SMS code (most customers), or a Google account
 * (one tap, and the only way into /admin). The auth SDK is imported on demand,
 * so pages without a login box never download it.
 *
 * `db.signedIn` in localStorage is a hint, not a credential: it only tells the
 * booking form whether it is worth loading the auth SDK to pre-fill a returning
 * customer's details. Firebase itself decides who is signed in.
 */

import type { ConfirmationResult, User } from 'firebase/auth';

import { getFirebaseApp } from './firebase';

const HINT = 'db.signedIn';

export function rememberSignedIn(on: boolean) {
  try {
    if (on) localStorage.setItem(HINT, '1');
    else localStorage.removeItem(HINT);
  } catch {
    /* private mode — the hint is optional */
  }
}

export function mightBeSignedIn(): boolean {
  try {
    return localStorage.getItem(HINT) === '1';
  } catch {
    return false;
  }
}

export async function getAuthClient() {
  const [app, { getAuth }] = await Promise.all([getFirebaseApp(), import('firebase/auth')]);
  const auth = getAuth(app);
  auth.languageCode = 'en';
  return auth;
}

/** Calls back with the user (or null) now and on every change. Returns an unsubscribe. */
export async function watchUser(cb: (user: User | null) => void): Promise<() => void> {
  const [auth, { onAuthStateChanged }] = await Promise.all([getAuthClient(), import('firebase/auth')]);
  return onAuthStateChanged(auth, (user) => {
    rememberSignedIn(Boolean(user));
    cb(user);
  });
}

/** Resolves once Firebase has restored any saved session. */
export async function currentUser(): Promise<User | null> {
  const auth = await getAuthClient();
  await auth.authStateReady();
  return auth.currentUser;
}

export async function signInWithGoogle(): Promise<User> {
  const [auth, { GoogleAuthProvider, signInWithPopup }] = await Promise.all([
    getAuthClient(),
    import('firebase/auth'),
  ]);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const { user } = await signInWithPopup(auth, provider);
  rememberSignedIn(true);
  return user;
}

/**
 * Step 1 of phone login: sends the SMS. `containerId` is an empty element the
 * invisible reCAPTCHA renders into — Firebase requires it to stop SMS abuse.
 */
export async function sendLoginCode(phone10: string, containerId: string): Promise<ConfirmationResult> {
  const [auth, { RecaptchaVerifier, signInWithPhoneNumber }] = await Promise.all([
    getAuthClient(),
    import('firebase/auth'),
  ]);
  const w = window as unknown as { __dbRecaptcha?: InstanceType<typeof RecaptchaVerifier> };
  w.__dbRecaptcha?.clear();
  w.__dbRecaptcha = new RecaptchaVerifier(auth, containerId, { size: 'invisible' });
  return signInWithPhoneNumber(auth, `+91${phone10}`, w.__dbRecaptcha);
}

/** Step 2: the 6-digit code from the SMS. */
export async function confirmLoginCode(confirmation: ConfirmationResult, code: string): Promise<User> {
  const { user } = await confirmation.confirm(code.trim());
  rememberSignedIn(true);
  return user;
}

export async function signOutUser() {
  const [auth, { signOut }] = await Promise.all([getAuthClient(), import('firebase/auth')]);
  await signOut(auth);
  rememberSignedIn(false);
}

/** Firebase error codes → words a customer understands. */
export function authErrorMessage(err: unknown): string {
  const code = typeof err === 'object' && err && 'code' in err ? String((err as { code: unknown }).code) : '';
  if (code.includes('invalid-verification-code')) return 'That code is not right. Check the SMS and try again.';
  if (code.includes('code-expired')) return 'That code has expired. Ask for a new one.';
  if (code.includes('too-many-requests')) return 'Too many tries. Please wait a few minutes and try again.';
  if (code.includes('invalid-phone-number')) return 'Enter a valid 10-digit mobile number.';
  if (code.includes('popup-closed-by-user') || code.includes('cancelled-popup-request'))
    return 'The Google window was closed before you finished.';
  if (code.includes('popup-blocked')) return 'Your browser blocked the Google window. Allow pop-ups and try again.';
  if (code.includes('network')) return 'Your connection dropped. Check your internet and try again.';
  if (code.includes('operation-not-allowed') || code.includes('unauthorized-domain'))
    return 'Login is not switched on yet. Please book without logging in for now.';
  return 'Something went wrong. Please try again, or book without logging in.';
}

/* ------------------------------------------------------------------ profile */

export type Profile = { name: string; phone: string; email: string };

export async function loadProfile(uid: string): Promise<Profile | null> {
  const [app, { getFirestore, doc, getDoc }] = await Promise.all([getFirebaseApp(), import('firebase/firestore')]);
  const snap = await getDoc(doc(getFirestore(app), 'users', uid));
  if (!snap.exists()) return null;
  const d = snap.data();
  return { name: String(d.name ?? ''), phone: String(d.phone ?? ''), email: String(d.email ?? '') };
}

export async function saveProfile(uid: string, profile: Profile, isNew: boolean) {
  const [app, { getFirestore, doc, setDoc, updateDoc, serverTimestamp }] = await Promise.all([
    getFirebaseApp(),
    import('firebase/firestore'),
  ]);
  const ref = doc(getFirestore(app), 'users', uid);
  const data = { name: profile.name.trim(), phone: profile.phone, email: profile.email };
  if (isNew) await setDoc(ref, { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  else await updateDoc(ref, { ...data, updatedAt: serverTimestamp() });
}
