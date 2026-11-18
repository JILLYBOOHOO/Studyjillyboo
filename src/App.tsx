import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import type { User } from 'firebase/auth';
import { AlertCircle, ExternalLink, Loader2, LogOut, Plus, RefreshCw, Smartphone } from 'lucide-react';
import { AccessibilityBar } from './components/AccessibilityBar';
import { AccessibilityProvider, useAccessibility } from './components/AccessibilityContext';
import { AddTaskModal } from './components/AddTaskModal';
import { ClassworkView } from './components/ClassworkView';
import { DEFAULT_CLASS_QUERY } from './components/EmailView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { GoogleSignInButton } from './components/GoogleSignInButton';
import {
  type LibrarySelection,
  type LibrarySubTab,
  LibraryView,
} from './components/LibraryView';
import { OverviewView } from './components/OverviewView';
import { SafeImage } from './components/SafeImage';
import { SciFiCursor } from './components/SciFiCursor';
import { type TutorSubTab, TutorView } from './components/TutorView';
import { VisualLabView } from './components/VisualLabView';
import { type WorkspaceSubTab, WorkspaceView } from './components/WorkspaceView';

const PROGRAM_LABEL = 'Associate Degree in Artificial Intelligence';
import {
  clearAllUserData,
  clearTutorThreadDoc,
  createCourseDoc,
  createLectureDoc,
  createModuleDoc,
  createProgressReportDoc,
  createQuizDoc,
  createSmartNoteDoc,
  createSprintDoc,
  createTaskDoc,
  deleteCourseDoc,
  deleteLectureDoc,
  deleteModuleDoc,
  deleteQuizDoc,
  deleteSmartNoteDoc,
  deleteTaskDoc,
  ensureUserProfileAndSeed,
  saveTutorThreadMessagesDoc,
  seedStarterWorkspace,
  subscribeWorkspace,
  syncAmberHeartCurriculumDoc,
  updateLectureActionsDoc,
  updateLectureOrganizationDoc,
  updateModuleOrganizationDoc,
  updateQuizProgressDoc,
  updateSmartNoteDoc,
  updateSprintStepsDoc,
  updateTaskStatusDoc,
} from './lib/firestoreStore';
import {
  clearAccessToken,
  formatGoogleAuthError,
  type GoogleSignInOptions,
  googleSignIn,
  initAuth,
  isEmbeddedIframe,
  isMobileBrowser,
  logout,
} from './lib/googleAuth';
import type {
  CatchUpSprint,
  ClassworkItem,
  ClassworkStatus,
  Course,
  EmailMessageSummary,
  InteractiveQuiz,
  LectureAnalysis,
  LinkedMaterialRef,
  ModuleGuide,
  ProgressReport,
  SmartClipAnalysis,
  SmartNoteCard,
  TutorCitation,
  TutorThread,
} from './types';

type ActiveTab = 'overview' | 'classwork' | 'library' | 'tutor' | 'studio' | 'workspace';

const NAV_ITEMS: Array<{ id: ActiveTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'classwork', label: 'Classwork' },
  { id: 'library', label: 'Library' },
  { id: 'tutor', label: 'Tutor' },
  { id: 'studio', label: 'Visual Lab' },
  { id: 'workspace', label: 'Workspace' },
];

function StudyTrackWorkspace() {
  const { sciFiMode } = useAccessibility();
  const mainContentRef = useRef<HTMLElement | null>(null);
  const orbIconRef = useRef<HTMLSpanElement | null>(null);

  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [gmailToken, setGmailToken] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  const [activeTab, setActiveTab] = useState<ActiveTab>('overview');
  const [librarySubTab, setLibrarySubTab] = useState<LibrarySubTab>('materials');
  const [tutorSubTab, setTutorSubTab] = useState<TutorSubTab>('qa');
  const [workspaceSubTab, setWorkspaceSubTab] = useState<WorkspaceSubTab>('gmail');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  const [courses, setCourses] = useState<Course[]>([]);
  const [tasks, setTasks] = useState<ClassworkItem[]>([]);
  const [lectures, setLectures] = useState<LectureAnalysis[]>([]);
  const [modules, setModules] = useState<ModuleGuide[]>([]);
  const [sprint, setSprint] = useState<CatchUpSprint | null>(null);
  const [progressReport, setProgressReport] = useState<ProgressReport | null>(null);
  const [tutorThreads, setTutorThreads] = useState<TutorThread[]>([]);
  const [quizzes, setQuizzes] = useState<InteractiveQuiz[]>([]);
  const [notes, setNotes] = useState<SmartNoteCard[]>([]);

  const qaThread = tutorThreads.find((t) => t.mode === 'qa') || null;
  const socraticThread = tutorThreads.find((t) => t.mode === 'socratic') || null;
  const qaThreadIdRef = useRef<string | null>(null);
  const socraticThreadIdRef = useRef<string | null>(null);

  const [emails, setEmails] = useState<EmailMessageSummary[]>([]);
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [selectedLibraryItem, setSelectedLibraryItem] = useState<LibrarySelection>(null);
  const [pendingTutorPrompt, setPendingTutorPrompt] = useState<{
    courseCode: string;
    question: string;
  } | null>(null);
  const [pendingSocraticFocus, setPendingSocraticFocus] = useState<{
    courseCode: string;
    topicFocus: string;
    materialId?: string;
  } | null>(null);
  const [pendingQuizRequest, setPendingQuizRequest] = useState<{
    courseCode: string;
    materialId?: string;
    topicFocus?: string;
  } | null>(null);
  const [latestExtensionClip, setLatestExtensionClip] = useState<SmartClipAnalysis | null>(null);

  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [authPopupIssue, setAuthPopupIssue] = useState(false);
  const [showMobileOptions, setShowMobileOptions] = useState(() => isMobileBrowser());

  useEffect(() => {
    qaThreadIdRef.current = qaThread?.id || null;
  }, [qaThread?.id]);

  useEffect(() => {
    socraticThreadIdRef.current = socraticThread?.id || null;
  }, [socraticThread?.id]);

  useEffect(() => {
    const onTabShortcut = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      const digit = Number(e.key);
      if (digit >= 1 && digit <= NAV_ITEMS.length) {
        e.preventDefault();
        setActiveTab(NAV_ITEMS[digit - 1].id);
      }
    };
    window.addEventListener('keydown', onTabShortcut);
    return () => window.removeEventListener('keydown', onTabShortcut);
  }, []);

  useEffect(() => {
    if (!sciFiMode || typeof window === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const ctx = gsap.context(() => {
      if (mainContentRef.current) {
        gsap.fromTo(
          mainContentRef.current,
          { opacity: 0.72, y: 12 },
          { opacity: 1, y: 0, duration: 0.36, ease: 'power3.out' },
        );
      }
      if (orbIconRef.current) {
        gsap.to(orbIconRef.current, {
          rotate: 360,
          duration: 14,
          repeat: -1,
          ease: 'none',
        });
      }
    });

    return () => ctx.revert();
  }, [activeTab, sciFiMode, workspaceLoading]);

  const syncEmailsSilently = async (token: string) => {
    try {
      const url = `/api/gmail/messages?q=${encodeURIComponent(DEFAULT_CLASS_QUERY)}`;
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (resp.status === 401 || resp.status === 403) {
        clearAccessToken();
        setGmailToken(null);
        return;
      }
      if (!resp.ok) return;
      const data = await resp.json();
      const list: EmailMessageSummary[] = Array.isArray(data.messages) ? data.messages : [];
      setEmails(list);
      if (list.length > 0) {
        setSelectedEmailId((prev) => (prev && list.some((m) => m.id === prev) ? prev : list[0].id));
      }
    } catch {
      // Background email sync is best-effort; explicit sync remains in EmailView
    }
  };

  useEffect(() => {
    const unsub = initAuth(
      (firebaseUser, token) => {
        setUser(firebaseUser);
        setGmailToken(token);
        setAuthReady(true);
        if (firebaseUser) {
          setGlobalError(null);
          setAuthPopupIssue(false);
        }
        if (firebaseUser && token) {
          void syncEmailsSilently(token);
        }
      },
      (authErr) => {
        setGlobalError(authErr.message);
        setAuthPopupIssue(authErr.isPopupIssue);
        setShowMobileOptions(true);
        setAuthReady(true);
      },
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user) {
      setCourses([]);
      setTasks([]);
      setLectures([]);
      setModules([]);
      setSprint(null);
      setProgressReport(null);
      setTutorThreads([]);
      setQuizzes([]);
      setNotes([]);
      qaThreadIdRef.current = null;
      socraticThreadIdRef.current = null;
      setEmails([]);
      setSelectedEmailId(null);
      setSelectedLibraryItem(null);
      setPendingTutorPrompt(null);
      setPendingSocraticFocus(null);
      setPendingQuizRequest(null);
      return;
    }

    let unsubWorkspace: (() => void) | undefined;
    let active = true;
    setWorkspaceLoading(true);

    ensureUserProfileAndSeed(user)
      .then(() => {
        if (!active) return;
        unsubWorkspace = subscribeWorkspace(user.uid, {
          onCourses: (data) => {
            setCourses(data);
            setWorkspaceLoading(false);
          },
          onTasks: setTasks,
          onLectures: setLectures,
          onModules: setModules,
          onSprint: setSprint,
          onProgressReport: setProgressReport,
          onTutorThreads: (threads) => {
            qaThreadIdRef.current = threads.find((t) => t.mode === 'qa')?.id || null;
            socraticThreadIdRef.current = threads.find((t) => t.mode === 'socratic')?.id || null;
            setTutorThreads(threads);
          },
          onQuizzes: setQuizzes,
          onNotes: setNotes,
          onError: (err) => {
            setGlobalError(err.message);
            setWorkspaceLoading(false);
          },
        });
      })
      .catch((err) => {
        if (!active) return;
        setGlobalError(err instanceof Error ? err.message : 'Could not load workspace.');
        setWorkspaceLoading(false);
      });

    return () => {
      active = false;
      if (unsubWorkspace) unsubWorkspace();
    };
  }, [user]);

  // Listen for live clips from the StudyTrack Chrome Extension & ?clip= / ?coach= handoff URLs
  useEffect(() => {
    if (!user) return;

    const persistIncomingClip = async (clip: SmartClipAnalysis, createTaskToo = false) => {
      try {
        if (clip.smartCard) {
          await createSmartNoteDoc(user.uid, clip.smartCard);
        }
        if (createTaskToo) {
          await createTaskDoc(user.uid, {
            courseCode: clip.smartCard?.courseCode || 'AIL1001',
            courseTitle: clip.smartCard?.courseCode || 'AIL1001',
            title: clip.reminderTitle || clip.smartCard?.title || 'Extension Captured Task',
            type: 'Assignment',
            status: 'Urgent Catch-Up',
            dueDate: clip.detectedDateIso ? clip.detectedDateIso.slice(0, 10) : 'TBD',
            estimatedMinutes: 45,
            source: 'Smart Note',
            notes: clip.extractedText.slice(0, 1800),
          });
        }
        setLatestExtensionClip(clip);
        setLibrarySubTab('extension');
        setActiveTab('library');
      } catch (err) {
        setGlobalError(
          err instanceof Error ? err.message : 'Could not auto-save clip from Chrome Extension.',
        );
      }
    };

    const handleWindowMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      const msg = event.data as {
        source?: string;
        type?: string;
        clip?: SmartClipAnalysis;
      } | null;
      if (msg?.source === 'studytrack-chrome-extension' && msg.type === 'CLIP_READY' && msg.clip) {
        void persistIncomingClip(msg.clip);
      }
    };

    window.addEventListener('message', handleWindowMessage);

    const params = new URLSearchParams(window.location.search);
    const clipId = params.get('clip');
    const createTaskToo = params.get('task') === '1';
    const coachTopic = params.get('coach');

    if (clipId) {
      window.history.replaceState({}, '', window.location.pathname);
      fetch(`/api/clip/handoff/${encodeURIComponent(clipId)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data?.clip) {
            void persistIncomingClip(data.clip as SmartClipAnalysis, createTaskToo);
          }
        })
        .catch(() => {});
    } else if (coachTopic) {
      window.history.replaceState({}, '', window.location.pathname);
      setPendingSocraticFocus({ courseCode: 'ALL', topicFocus: coachTopic });
      setTutorSubTab('socratic');
      setActiveTab('tutor');
    }

    return () => {
      window.removeEventListener('message', handleWindowMessage);
    };
  }, [user]);

  const handleGoogleSignIn = async (options?: GoogleSignInOptions): Promise<string | null> => {
    setGlobalError(null);
    setAuthPopupIssue(false);
    setSigningIn(true);
    try {
      const res = await googleSignIn(options);
      if (res) {
        setUser(res.user);
        const token = res.accessToken || null;
        setGmailToken(token);
        if (token) {
          void syncEmailsSilently(token);
        }
        return token;
      }
      return null;
    } catch (err) {
      const formatted = formatGoogleAuthError(err);
      setGlobalError(formatted.message);
      setAuthPopupIssue(formatted.isPopupIssue);
      if (formatted.isPopupIssue) {
        setShowMobileOptions(true);
      }
      return null;
    } finally {
      setSigningIn(false);
    }
  };

  const handleOpenLinkedMaterial = (ref: LinkedMaterialRef) => {
    if (ref.kind === 'lecture') {
      setSelectedLibraryItem({ kind: 'lecture', id: ref.targetId });
      setActiveTab('library');
    } else if (ref.kind === 'module') {
      setSelectedLibraryItem({ kind: 'module', id: ref.targetId });
      setActiveTab('library');
    } else if (ref.kind === 'email') {
      if (ref.targetId) setSelectedEmailId(ref.targetId);
      setWorkspaceSubTab('gmail');
      setActiveTab('workspace');
    } else {
      setActiveTab('classwork');
    }
  };

  const handleOpenCitation = (cit: TutorCitation) => {
    if (cit.kind === 'lecture') {
      setSelectedLibraryItem({ kind: 'lecture', id: cit.id });
      setActiveTab('library');
    } else if (cit.kind === 'module') {
      setSelectedLibraryItem({ kind: 'module', id: cit.id });
      setActiveTab('library');
    } else if (cit.kind === 'email') {
      if (cit.id) setSelectedEmailId(cit.id);
      setWorkspaceSubTab('gmail');
      setActiveTab('workspace');
    }
  };

  if (!authReady) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="flex items-center gap-2.5 text-sm text-slate-600">
          <Loader2 className="w-4 h-4 animate-spin text-blue-700" />
          Loading StudyTrack AI...
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col">
        <header className="bg-white border-b border-slate-200 px-6 py-4">
          <div className="max-w-6xl mx-auto flex items-center justify-between gap-8">
            <span className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
              StudyTrack AI
            </span>
            <GoogleSignInButton
              loading={signingIn}
              onClick={() => void handleGoogleSignIn()}
            />
          </div>
        </header>

        <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-12 flex items-center">
          <div className="w-full bg-white border border-slate-200 rounded-xl overflow-hidden grid grid-cols-1 lg:grid-cols-12 items-stretch">
            <div className="lg:col-span-7 p-8 sm:p-10 flex flex-col justify-between gap-8">
              <div className="space-y-4">
                <p className="text-xs font-medium text-slate-500">
                  {PROGRAM_LABEL}
                </p>
                <h1 className="text-3xl sm:text-4xl font-semibold text-slate-900 tracking-tight text-balance">
                  Catch up on missed classes, understand every module, and stay ahead.
                </h1>
                <p className="text-base text-slate-600 leading-relaxed max-w-xl">
                  Sign in with Google to track HEART/NSTA Amber Academy coursework, organize Zoom
                  recordings and modules, sync Gmail, Calendar &amp; Docs, and practice with your
                  Mastery Coach and quizzes.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-slate-200 text-sm">
                  <div>
                    <p className="font-semibold text-slate-900">Mastery Coach (Ask-Back)</p>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Tests your understanding with questions, gives hints when wrong, and loops
                      until you master it.
                    </p>
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900">Interactive Course Quizzes</p>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Practice multiple-choice and short-answer quizzes directly from your uploaded
                      classes.
                    </p>
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900">Week 17–18 &amp; 52-Week Outline</p>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Full AIL1001–AGD101 timetable, 4-Phase roadmap, and 1-click Calendar sync.
                    </p>
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900">Gmail, Calendar &amp; Docs Sync</p>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Scan emails for deadlines, schedule revision blocks, and import/export Google
                      Docs.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                {globalError && (
                  <div
                    className="rounded-lg border border-red-200 bg-red-50 p-3.5 text-xs text-red-800 space-y-2"
                    role="alert"
                  >
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-700" />
                      <p className="font-medium leading-relaxed">{globalError}</p>
                    </div>
                    {authPopupIssue && (
                      <p className="text-[11px] text-red-700 pl-6 leading-relaxed">
                        Tip: If you saw &ldquo;Google hasn&apos;t verified this app&rdquo; and tapped
                        Continue, mobile Chrome sometimes drops the popup link. Try Quick Sign-In or
                        Full-Page Redirect below.
                      </p>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-3">
                  <GoogleSignInButton
                    label={
                      isMobileBrowser()
                        ? 'Sign in with Google'
                        : 'Sign in with Google to Open Workspace'
                    }
                    loading={signingIn}
                    onClick={() =>
                      void handleGoogleSignIn({
                        includeWorkspace: !isMobileBrowser(),
                      })
                    }
                  />
                  {!showMobileOptions && (
                    <button
                      type="button"
                      onClick={() => setShowMobileOptions(true)}
                      className="text-xs font-medium text-slate-600 hover:text-slate-900 underline underline-offset-2"
                    >
                      Trouble signing in on mobile?
                    </button>
                  )}
                </div>

                {showMobileOptions && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 space-y-2.5">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                      <Smartphone className="w-3.5 h-3.5 text-blue-700" />
                      <span>Alternative Sign-In Options (Mobile &amp; Strict Browsers)</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={signingIn}
                        onClick={() => void handleGoogleSignIn({ includeWorkspace: false })}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-800 bg-white border border-slate-300 hover:bg-slate-100 disabled:opacity-50 rounded-lg transition-colors"
                      >
                        Quick Sign-In (Skip Gmail &amp; Docs for now)
                      </button>

                      {!isEmbeddedIframe() ? (
                        <button
                          type="button"
                          disabled={signingIn}
                          onClick={() =>
                            void handleGoogleSignIn({ includeWorkspace: false, useRedirect: true })
                          }
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-800 bg-blue-50 border border-blue-200 hover:bg-blue-100 disabled:opacity-50 rounded-lg transition-colors"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          Full-Page Redirect Sign-In
                        </button>
                      ) : (
                        <a
                          href={typeof window !== 'undefined' ? window.location.href : '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-800 bg-blue-50 border border-blue-200 hover:bg-blue-100 rounded-lg transition-colors"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          Open in Full Browser Tab
                        </a>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      Quick Sign-In avoids Google&apos;s unverified-app testing screen so you can enter
                      your courses, quizzes, and Visual Lab right away—then connect Gmail, Calendar &amp;
                      Docs anytime from the Workspace tab.
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="lg:col-span-5 min-h-[260px] border-t lg:border-t-0 lg:border-l border-slate-200">
              <SafeImage
                src="/src/assets/images/study_desk_hero_1795018668152.jpg"
                alt="Calm university student study desk"
                fallbackLabel="StudyTrack AI Workspace"
                className="w-full h-full object-cover"
              />
            </div>
          </div>
        </main>
      </div>
    );
  }

  const activeTabLabel = NAV_ITEMS.find((i) => i.id === activeTab)?.label || 'Overview';

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-blue-700 focus:text-white focus:rounded-lg focus:text-sm focus:font-semibold"
      >
        Skip to main content
      </a>

      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 glass-surface border-b border-slate-200 transition-colors">
        <div className="h-[2px] w-full neon-gradient-bar" aria-hidden="true" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-6">
          {/* Zone 1: Brand wordmark only */}
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            className="inline-flex items-center gap-2 text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            <span
              ref={orbIconRef}
              aria-hidden="true"
              className="w-2.5 h-2.5 rounded-sm bg-gradient-to-tr from-cyan-400 to-indigo-500 inline-block"
            />
            StudyTrack AI
          </button>

          {/* Zone 2: Concise single-line nav links with Arrow-key navigation */}
          <nav
            aria-label="Primary"
            className="hidden md:flex items-center gap-5 text-sm font-medium"
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                e.preventDefault();
                const idx = NAV_ITEMS.findIndex((i) => i.id === activeTab);
                const next = (idx + (e.key === 'ArrowRight' ? 1 : -1) + NAV_ITEMS.length) % NAV_ITEMS.length;
                setActiveTab(NAV_ITEMS[next].id);
              }
            }}
          >
            {NAV_ITEMS.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => setActiveTab(item.id)}
                  className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'border-blue-700 text-slate-900'
                      : 'border-transparent text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Primary action */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setIsAddModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Catch-Up Item
            </button>
          </div>
        </div>

        {/* Mobile single-row navigation */}
        <nav
          aria-label="Mobile Navigation"
          className="md:hidden border-t border-slate-200 px-3 py-1.5 flex items-center gap-2 overflow-x-auto"
        >
          {NAV_ITEMS.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => setActiveTab(item.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
                  active ? 'bg-blue-50 text-blue-800' : 'text-slate-600'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>
      </header>

      <AccessibilityBar
        courses={courses}
        activeTabLabel={activeTabLabel}
        onSaveVoiceNote={(note) => createSmartNoteDoc(user.uid, note)}
        onOpenLibraryNotes={() => {
          setLibrarySubTab('notebook');
          setActiveTab('library');
        }}
        onOpenExtensionHub={() => {
          setLibrarySubTab('extension');
          setActiveTab('library');
        }}
      />

      <main
        ref={mainContentRef}
        id="main-content"
        tabIndex={-1}
        className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-8 focus:outline-none"
      >
        {globalError && (
          <div
            className="mb-6 bg-red-50 border border-red-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm text-red-800"
            role="alert"
          >
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{globalError}</span>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {authPopupIssue && !isEmbeddedIframe() && (
                <button
                  type="button"
                  disabled={signingIn}
                  onClick={() =>
                    void handleGoogleSignIn({ includeWorkspace: true, useRedirect: true })
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-800 bg-white border border-blue-200 hover:bg-blue-50 rounded-lg transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Retry via Redirect
                </button>
              )}
              {authPopupIssue && isEmbeddedIframe() && (
                <a
                  href={typeof window !== 'undefined' ? window.location.href : '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-800 bg-white border border-blue-200 hover:bg-blue-50 rounded-lg transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open in Full Tab
                </a>
              )}
              <button
                type="button"
                onClick={() => {
                  setGlobalError(null);
                  setAuthPopupIssue(false);
                }}
                className="text-xs font-medium underline shrink-0"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {workspaceLoading ? (
          <div className="bg-white border border-slate-200 rounded-xl p-12 flex items-center justify-center gap-2.5 text-sm text-slate-600">
            <Loader2 className="w-4 h-4 animate-spin text-blue-700" />
            Syncing your coursework from Firestore...
          </div>
        ) : (
          <>
            {activeTab === 'overview' && (
              <OverviewView
                studentName={user.displayName || user.email || 'AI Student'}
                courses={courses}
                tasks={tasks}
                lectures={lectures}
                modules={modules}
                sprint={sprint}
                progressReport={progressReport}
                syncedEmailCount={emails.length}
                hasGmailToken={Boolean(gmailToken)}
                onNavigate={(tab, subTab) => {
                  if (tab === 'workspace' && subTab) {
                    setWorkspaceSubTab(subTab);
                  }
                  setActiveTab(tab);
                }}
                onOpenLinkedMaterial={handleOpenLinkedMaterial}
                onAnalyzeProgress={async () => {
                  const resp = await fetch('/api/progress/analyze', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      courses,
                      tasks,
                      lectures,
                      modules,
                      emails,
                    }),
                  });
                  const data = await resp.json();
                  if (!resp.ok) throw new Error(data.error || 'Could not analyze progress.');
                  await createProgressReportDoc(user.uid, data);
                }}
                onGenerateSprint={async (hours, focusNote) => {
                  const resp = await fetch('/api/catchup/plan', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      hoursAvailable: hours,
                      focusNote,
                      tasks,
                    }),
                  });
                  const data = await resp.json();
                  if (!resp.ok) throw new Error(data.error || 'Could not generate catch-up sprint.');
                  await createSprintDoc(user.uid, data);
                }}
                onToggleSprintStep={async (stepOrder, taskId) => {
                  if (!sprint) return;
                  const nextSteps = sprint.steps.map((s) =>
                    s.order === stepOrder ? { ...s, completed: !s.completed } : s,
                  );
                  await updateSprintStepsDoc(user.uid, sprint.id, nextSteps);
                  const toggled = nextSteps.find((s) => s.order === stepOrder);
                  if (toggled && taskId && tasks.some((t) => t.id === taskId)) {
                    await updateTaskStatusDoc(
                      user.uid,
                      taskId,
                      toggled.completed ? 'Completed' : 'In Progress',
                    );
                  }
                }}
                onDeleteCourse={(courseId) => deleteCourseDoc(user.uid, courseId)}
                onOpenAddModal={() => setIsAddModalOpen(true)}
                onResetStarter={() => seedStarterWorkspace(user.uid)}
                onSyncAmberCurriculum={() => syncAmberHeartCurriculumDoc(user.uid)}
                onQuickStartCoach={(courseCode, topicFocus) => {
                  setPendingSocraticFocus({ courseCode, topicFocus });
                  setTutorSubTab('socratic');
                  setActiveTab('tutor');
                }}
                onQuickStartQuiz={(courseCode, topicFocus) => {
                  setPendingQuizRequest({ courseCode, topicFocus });
                  setTutorSubTab('quiz');
                  setActiveTab('tutor');
                }}
                onClearAll={() => clearAllUserData(user.uid)}
              />
            )}

            {activeTab === 'classwork' && (
              <ClassworkView
                tasks={tasks}
                courses={courses}
                onUpdateStatus={(taskId, status: ClassworkStatus) =>
                  updateTaskStatusDoc(user.uid, taskId, status)
                }
                onDeleteTask={(taskId) => deleteTaskDoc(user.uid, taskId)}
                onOpenAddModal={() => setIsAddModalOpen(true)}
              />
            )}

            {activeTab === 'library' && (
              <LibraryView
                studentName={user.displayName || ''}
                courses={courses}
                lectures={lectures}
                modules={modules}
                notes={notes}
                googleToken={gmailToken}
                activeSubTab={librarySubTab}
                onChangeSubTab={setLibrarySubTab}
                latestExtensionClip={latestExtensionClip}
                onClearExtensionClip={() => setLatestExtensionClip(null)}
                selectedItem={selectedLibraryItem}
                onSelectItem={setSelectedLibraryItem}
                onSaveLecture={(lecture) => createLectureDoc(user.uid, lecture)}
                onSaveModule={(mod) => createModuleDoc(user.uid, mod)}
                onSaveNote={(note) => createSmartNoteDoc(user.uid, note)}
                onUpdateNote={(noteId, note) => updateSmartNoteDoc(user.uid, noteId, note)}
                onDeleteNote={(noteId) => deleteSmartNoteDoc(user.uid, noteId)}
                onUpdateLectureOrg={(lectureId, updates) =>
                  updateLectureOrganizationDoc(user.uid, lectureId, updates)
                }
                onUpdateModuleOrg={(moduleId, updates) =>
                  updateModuleOrganizationDoc(user.uid, moduleId, updates)
                }
                onMarkLectureActionAdded={async (lectureId, actionIndex) => {
                  const target = lectures.find((l) => l.id === lectureId);
                  if (!target) return;
                  const updated = target.actionItems.map((item, idx) =>
                    idx === actionIndex ? { ...item, addedToTracker: true } : item,
                  );
                  await updateLectureActionsDoc(user.uid, lectureId, updated);
                }}
                onAddTask={(task) => createTaskDoc(user.uid, task)}
                onDeleteLecture={async (lectureId) => {
                  await deleteLectureDoc(user.uid, lectureId);
                  if (selectedLibraryItem?.kind === 'lecture' && selectedLibraryItem.id === lectureId) {
                    setSelectedLibraryItem(null);
                  }
                }}
                onDeleteModule={async (moduleId) => {
                  await deleteModuleDoc(user.uid, moduleId);
                  if (selectedLibraryItem?.kind === 'module' && selectedLibraryItem.id === moduleId) {
                    setSelectedLibraryItem(null);
                  }
                }}
                onAskChatbotWithContext={(courseCode, question) => {
                  setPendingTutorPrompt({ courseCode, question });
                  setTutorSubTab('qa');
                  setActiveTab('tutor');
                }}
                onStartCoachWithMaterial={(courseCode, materialId, topicFocus) => {
                  setPendingSocraticFocus({ courseCode, materialId, topicFocus });
                  setTutorSubTab('socratic');
                  setActiveTab('tutor');
                }}
                onStartQuizWithMaterial={(courseCode, materialId, topicFocus) => {
                  setPendingQuizRequest({ courseCode, materialId, topicFocus });
                  setTutorSubTab('quiz');
                  setActiveTab('tutor');
                }}
              />
            )}

            {activeTab === 'tutor' && (
              <TutorView
                courses={courses}
                lectures={lectures}
                modules={modules}
                smartNotes={notes}
                emails={emails}
                qaThread={qaThread}
                socraticThread={socraticThread}
                quizzes={quizzes}
                activeSubTab={tutorSubTab}
                onChangeSubTab={setTutorSubTab}
                initialPrompt={pendingTutorPrompt}
                onClearInitialPrompt={() => setPendingTutorPrompt(null)}
                initialSocraticFocus={pendingSocraticFocus}
                onClearInitialSocraticFocus={() => setPendingSocraticFocus(null)}
                initialQuizRequest={pendingQuizRequest}
                onClearInitialQuizRequest={() => setPendingQuizRequest(null)}
                onSaveThread={async (mode, payload) => {
                  const ref = mode === 'socratic' ? socraticThreadIdRef : qaThreadIdRef;
                  const savedId = await saveTutorThreadMessagesDoc(user.uid, ref.current, {
                    mode,
                    ...payload,
                  });
                  ref.current = savedId;
                }}
                onClearThread={async (mode) => {
                  const ref = mode === 'socratic' ? socraticThreadIdRef : qaThreadIdRef;
                  const fallbackId = mode === 'socratic' ? socraticThread?.id : qaThread?.id;
                  const targetId = ref.current || fallbackId;
                  if (targetId) {
                    ref.current = null;
                    await clearTutorThreadDoc(user.uid, targetId);
                  }
                }}
                onCreateQuiz={(quiz) => createQuizDoc(user.uid, quiz)}
                onUpdateQuizProgress={(quizId, updates) =>
                  updateQuizProgressDoc(user.uid, quizId, updates)
                }
                onDeleteQuiz={(quizId) => deleteQuizDoc(user.uid, quizId)}
                onOpenCitation={handleOpenCitation}
              />
            )}

            {activeTab === 'studio' && (
              <VisualLabView
                courses={courses}
                onSaveSmartNote={(note) => createSmartNoteDoc(user.uid, note)}
              />
            )}

            {activeTab === 'workspace' && (
              <WorkspaceView
                subTab={workspaceSubTab}
                onChangeSubTab={setWorkspaceSubTab}
                userEmail={user.email}
                googleToken={gmailToken}
                courses={courses}
                tasks={tasks}
                lectures={lectures}
                modules={modules}
                sprint={sprint}
                progressReport={progressReport}
                emails={emails}
                selectedEmailId={selectedEmailId}
                onEmailsChange={setEmails}
                onSelectEmail={setSelectedEmailId}
                onConnectGoogle={() => handleGoogleSignIn({ includeWorkspace: true })}
                onTokenExpired={() => {
                  clearAccessToken();
                  setGmailToken(null);
                }}
                onAddTask={(task) => createTaskDoc(user.uid, task)}
                onSaveModuleFromDoc={(guide) => createModuleDoc(user.uid, guide)}
                onOpenLibraryModule={(moduleId) => {
                  setSelectedLibraryItem({ kind: 'module', id: moduleId });
                  setActiveTab('library');
                }}
              />
            )}
          </>
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500">
          <span>StudyTrack AI · {PROGRAM_LABEL}</span>
          <div className="flex items-center gap-4">
            <span className="font-mono">{user.email}</span>
            <button
              type="button"
              onClick={() => logout()}
              className="inline-flex items-center gap-1.5 text-slate-600 hover:text-slate-900 font-medium"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>
          </div>
        </div>
      </footer>

      <AddTaskModal
        isOpen={isAddModalOpen}
        courses={courses}
        onClose={() => setIsAddModalOpen(false)}
        onAddTask={(task) => createTaskDoc(user.uid, task)}
        onAddCourse={(course) => createCourseDoc(user.uid, course)}
      />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AccessibilityProvider>
        <SciFiCursor />
        <StudyTrackWorkspace />
      </AccessibilityProvider>
    </ErrorBoundary>
  );
}
