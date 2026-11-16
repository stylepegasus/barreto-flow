import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import { isAuthorizedEmail } from '../utils/authAllowlist';

export const WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/calendar.events',
];

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
for (const scope of WORKSPACE_SCOPES) {
  provider.addScope(scope);
}
provider.setCustomParameters({
  prompt: 'select_account',
});

let isSigningIn = false;
// Token cached strictly in memory (never localStorage/sessionStorage)
let cachedAccessToken: string | null = null;

export const subscribeAppAuth = (callbacks: {
  onAuthorized: (user: User, workspaceToken: string | null) => void;
  onUnauthorized: (rejectedEmail: string) => void;
  onUnauthenticated: () => void;
}) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (!user) {
      if (!isSigningIn) {
        cachedAccessToken = null;
        callbacks.onUnauthenticated();
      }
      return;
    }

    if (!isAuthorizedEmail(user.email)) {
      const rejected = user.email ?? '';
      cachedAccessToken = null;
      await auth.signOut();
      callbacks.onUnauthorized(rejected);
      return;
    }

    callbacks.onAuthorized(user, cachedAccessToken);
  });
};

export const signInAppWithGoogle = async (): Promise<
  | { authorized: true; user: User; accessToken: string | null }
  | { authorized: false; rejectedEmail: string }
> => {
  isSigningIn = true;
  try {
    const result = await signInWithPopup(auth, provider);
    const email = result.user.email ?? '';

    if (!isAuthorizedEmail(email)) {
      cachedAccessToken = null;
      await auth.signOut();
      return { authorized: false, rejectedEmail: email };
    }

    const credential = GoogleAuthProvider.credentialFromResult(result);
    cachedAccessToken = credential?.accessToken ?? null;
    return {
      authorized: true,
      user: result.user,
      accessToken: cachedAccessToken,
    };
  } finally {
    isSigningIn = false;
  }
};

export const signInWithGoogleWorkspace = async (): Promise<{
  user: User;
  accessToken: string;
}> => {
  isSigningIn = true;
  try {
    const result = await signInWithPopup(auth, provider);
    if (!isAuthorizedEmail(result.user.email)) {
      cachedAccessToken = null;
      await auth.signOut();
      throw new Error(
        'Esta conta Google não está autorizada a acessar o Barreto Flow.'
      );
    }
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error(
        'Não foi possível obter a permissão de acesso ao Google Workspace.'
      );
    }
    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } finally {
    isSigningIn = false;
  }
};

export const getWorkspaceAccessToken = (): string | null => {
  return cachedAccessToken;
};

export const getFirebaseIdToken = async (): Promise<string | null> => {
  const user = auth.currentUser;
  if (!user) return null;
  if (!isAuthorizedEmail(user.email)) return null;
  return await user.getIdToken();
};

export const signOutGoogleWorkspace = async (): Promise<void> => {
  await auth.signOut();
  cachedAccessToken = null;
};
