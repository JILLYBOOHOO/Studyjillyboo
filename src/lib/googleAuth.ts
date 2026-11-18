import {
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  User,
} from 'firebase/auth';
import { auth } from './firebaseClient';

export const WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.readonly',
] as const;

const REDIRECT_PENDING_KEY = 'studytrack_auth_redirect_pending';

function buildProvider(includeWorkspace: boolean): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  if (includeWorkspace) {
    for (const scope of WORKSPACE_SCOPES) {
      provider.addScope(scope);
    }
  }
  return provider;
}

const basicProvider = buildProvider(false);
const workspaceProvider = buildProvider(true);

let isSigningIn = false;
let cachedAccessToken: string | null = null;

export interface GoogleSignInOptions {
  includeWorkspace?: boolean;
  useRedirect?: boolean;
  allowBasicFallback?: boolean;
}

export class GoogleAuthError extends Error {
  code: string;
  isPopupIssue: boolean;

  constructor(message: string, code = 'auth/unknown', isPopupIssue = false) {
    super(message);
    this.name = 'GoogleAuthError';
    this.code = code;
    this.isPopupIssue = isPopupIssue;
  }
}

export function isEmbeddedIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function isMobileBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent,
  );
}

export function formatGoogleAuthError(err: unknown): {
  code: string;
  message: string;
  isPopupIssue: boolean;
} {
  const rawCode =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code || '')
      : '';
  const rawMsg = err instanceof Error ? err.message : String(err || '');
  const code =
    rawCode ||
    (rawMsg.match(/\(?(auth\/[a-z0-9-]+)\)?/i)?.[1] ?? 'auth/unknown');

  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return {
      code,
      isPopupIssue: true,
      message:
        'The Google sign-in popup disconnected before finishing. Tap "Quick Sign-In (Recommended on Mobile)" or "Full-Page Redirect Sign-In" below.',
    };
  }

  if (code === 'auth/popup-blocked') {
    return {
      code,
      isPopupIssue: true,
      message:
        'Your browser blocked the Google sign-in popup. Tap "Full-Page Redirect Sign-In" or "Quick Sign-In" below.',
    };
  }

  if (code === 'auth/unauthorized-domain') {
    return {
      code,
      isPopupIssue: false,
      message:
        'This domain is not authorized for Firebase sign-in. Try opening the app from its main preview URL.',
    };
  }

  if (code === 'auth/network-request-failed') {
    return {
      code,
      isPopupIssue: false,
      message: 'Network connection interrupted during Google sign-in. Please check your internet and try again.',
    };
  }

  if (err instanceof GoogleAuthError) {
    return { code: err.code, message: err.message, isPopupIssue: err.isPopupIssue };
  }

  return {
    code,
    isPopupIssue: false,
    message: rawMsg || 'Google sign-in did not complete. Please try again.',
  };
}

function readAndClearRedirectPending(): boolean {
  try {
    const raw = window.sessionStorage.getItem(REDIRECT_PENDING_KEY);
    if (!raw) return false;
    window.sessionStorage.removeItem(REDIRECT_PENDING_KEY);
    const ts = Number(raw);
    return Number.isFinite(ts) && Date.now() - ts < 10 * 60 * 1000;
  } catch {
    return false;
  }
}

function markRedirectPending() {
  try {
    window.sessionStorage.setItem(REDIRECT_PENDING_KEY, String(Date.now()));
  } catch {
    // Non-critical hint only; never store tokens here
  }
}

export const initAuth = (
  onAuthUser: (user: User | null, gmailToken: string | null) => void,
  onAuthError?: (err: GoogleAuthError) => void,
) => {
  let active = true;

  getRedirectResult(auth)
    .then((result) => {
      if (!active) return;
      const hadPendingRedirect = readAndClearRedirectPending();
      if (result?.user) {
        const credential = GoogleAuthProvider.credentialFromResult(result);
        const token = credential?.accessToken || null;
        if (token) {
          cachedAccessToken = token;
        }
        onAuthUser(result.user, cachedAccessToken);
      } else if (hadPendingRedirect && !auth.currentUser) {
        onAuthError?.(
          new GoogleAuthError(
            'Your browser blocked cross-domain redirect storage (third-party cookies/storage partitioning). Tap "Quick Sign-In" to enter without cross-domain redirect.',
            'auth/redirect-storage-blocked',
            true,
          ),
        );
      }
    })
    .catch((err) => {
      if (!active) return;
      readAndClearRedirectPending();
      const formatted = formatGoogleAuthError(err);
      onAuthError?.(
        new GoogleAuthError(formatted.message, formatted.code, formatted.isPopupIssue),
      );
    });

  const unsub = onAuthStateChanged(auth, (user: User | null) => {
    if (!active) return;
    if (user) {
      if (!isSigningIn) {
        onAuthUser(user, cachedAccessToken);
      }
    } else {
      cachedAccessToken = null;
      onAuthUser(null, null);
    }
  });

  return () => {
    active = false;
    unsub();
  };
};

async function rescueCompletedFirebaseSignIn(hadUserBefore: boolean): Promise<{
  user: User;
  accessToken: string;
} | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 350));
    try {
      await auth.authStateReady();
    } catch {
      // Ignore authStateReady errors and continue checking
    }
    if (auth.currentUser && (!hadUserBefore || cachedAccessToken)) {
      return {
        user: auth.currentUser,
        accessToken: cachedAccessToken || '',
      };
    }
  }
  return null;
}

export const googleSignIn = async (
  options: GoogleSignInOptions = {},
): Promise<{
  user: User;
  accessToken: string;
} | null> => {
  const mobile = isMobileBrowser();
  const embedded = isEmbeddedIframe();
  // On mobile browsers, avoid requesting unverified Workspace scopes in an initial popup
  // unless explicitly requested (which uses full-page redirect outside iframes).
  const includeWorkspace = options.includeWorkspace ?? !mobile;
  const useRedirect = options.useRedirect ?? (mobile && includeWorkspace && !embedded);
  const provider = includeWorkspace ? workspaceProvider : basicProvider;
  const hadUserBefore = Boolean(auth.currentUser);

  if (useRedirect) {
    if (embedded) {
      throw new GoogleAuthError(
        'Full-page Google sign-in cannot run inside an embedded preview frame. Tap "Open in Full Browser Tab" or use "Quick Sign-In" below.',
        'auth/iframe-redirect-unsupported',
        true,
      );
    }
    markRedirectPending();
    await signInWithRedirect(auth, provider);
    return null;
  }

  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    const token = credential?.accessToken || '';
    if (token) {
      cachedAccessToken = token;
    }
    return { user: result.user, accessToken: token || cachedAccessToken || '' };
  } catch (err) {
    const formatted = formatGoogleAuthError(err);

    // On mobile Chrome, the popup watcher can fire auth/popup-closed-by-user right as
    // auth.currentUser finishes updating in the background. Wait and rescue if signed in.
    if (formatted.isPopupIssue) {
      const rescued = await rescueCompletedFirebaseSignIn(hadUserBefore);
      if (rescued) {
        return rescued;
      }

      // If a standalone mobile browser dropped even the popup, fall back automatically to
      // full-page redirect with basic scopes so the user doesn't get stuck in a popup loop.
      if (mobile && !embedded && options.allowBasicFallback !== false) {
        markRedirectPending();
        await signInWithRedirect(auth, basicProvider);
        return null;
      }
    }

    throw new GoogleAuthError(formatted.message, formatted.code, formatted.isPopupIssue);
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const clearAccessToken = () => {
  cachedAccessToken = null;
};

export const logout = async () => {
  await auth.signOut();
  cachedAccessToken = null;
};
