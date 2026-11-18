import { useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { AlertCircle, Loader2, LogOut, Plus } from 'lucide-react';
import { AddTaskModal } from './components/AddTaskModal';
import { ClassworkView } from './components/ClassworkView';
import { DEFAULT_CLASS_QUERY, EmailView } from './components/EmailView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { GoogleSignInButton } from './components/GoogleSignInButton';
import { type LibrarySelection, LibraryView } from './components/LibraryView';
import { OverviewView } from './components/OverviewView';
import { SafeImage } from './components/SafeImage';
import { type TutorSubTab, TutorView } from './components/TutorView';
import {
  clearAllUserData,
  clearTutorThreadDoc,
  createCourseDoc,
  createLectureDoc,
  createModuleDoc,
  createProgressReportDoc,
  createQuizDoc,
  createSprintDoc,
  createTaskDoc,
  deleteCourseDoc,
  deleteLectureDoc,
  deleteModuleDoc,
  deleteQuizDoc,
  deleteTaskDoc,
  ensureUserProfileAndSeed,
  saveTutorThreadMessagesDoc,
  seedStarterWorkspace,
  subscribeWorkspace,
  updateLectureActionsDoc,
  updateLectureOrganizationDoc,
  updateModuleOrganizationDoc,
  updateQuizProgressDoc,
  updateSprintStepsDoc,
  updateTaskStatusDoc,
} from './lib/firestoreStore';
import {
  clearAccessToken,
  googleSignIn,
  initAuth,
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
  TutorCitation,
  TutorThread,
} from './types';

type ActiveTab = 'overview' | 'classwork' | 'library' | 'tutor' | 'email';

const NAV_ITEMS: Array<{ id: ActiveTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'classwork', label: 'Classwork' },
  { id: 'library', label: 'Library' },
  { id: 'tutor', label: 'Tutor' },
  { id: 'email', label: 'Email' },
];

function StudyTrackWorkspace() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [gmailToken, setGmailToken] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  const [activeTab, setActiveTab] = useState<ActiveTab>('overview');
  const [tutorSubTab, setTutorSubTab] = useState<TutorSubTab>('qa');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  const [courses, setCourses] = useState<Course[]>([]);
  const [tasks, setTasks] = useState<ClassworkItem[]>([]);
  const [lectures, setLectures] = useState<LectureAnalysis[]>([]);
  const [modules, setModules] = useState<ModuleGuide[]>([]);
  const [sprint, setSprint] = useState<CatchUpSprint | null>(null);
  const [progressReport, setProgressReport] = useState<ProgressReport | null>(null);
  const [tutorThreads, setTutorThreads] = useState<TutorThread[]>([]);
  const [quizzes, setQuizzes] = useState<InteractiveQuiz[]>([]);

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

  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  useEffect(() => {
    qaThreadIdRef.current = qaThread?.id || null;
  }, [qaThread?.id]);

  useEffect(() => {
    socraticThreadIdRef.current = socraticThread?.id || null;
  }, [socraticThread?.id]);

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
    const unsub = initAuth((firebaseUser, token) => {
      setUser(firebaseUser);
      setGmailToken(token);
      setAuthReady(true);
      if (firebaseUser && token) {
        void syncEmailsSilently(token);
      }
    });
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

  const handleGoogleSignIn = async (): Promise<string | null> => {
    setGlobalError(null);
    setSigningIn(true);
    try {
      const res = await googleSignIn();
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
      setGlobalError(
        err instanceof Error ? err.message : 'Google sign-in did not complete. Please try again.',
      );
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
      setActiveTab('email');
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
      setActiveTab('email');
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
            <GoogleSignInButton loading={signingIn} onClick={handleGoogleSignIn} />
          </div>
        </header>

        <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-12 flex items-center">
          <div className="w-full bg-white border border-slate-200 rounded-xl overflow-hidden grid grid-cols-1 lg:grid-cols-12 items-stretch">
            <div className="lg:col-span-7 p-8 sm:p-10 flex flex-col justify-between gap-8">
              <div className="space-y-4">
                <p className="text-xs font-medium text-slate-500">
                  Associate Degree in Artificial Intelligence · Jamaica
                </p>
                <h1 className="text-3xl sm:text-4xl font-semibold text-slate-900 tracking-tight text-balance">
                  Catch up on missed classes, understand every module, and stay ahead.
                </h1>
                <p className="text-base text-slate-600 leading-relaxed max-w-xl">
                  Sign in with your Google account to track coursework, organize Zoom recordings and
                  modules, practice with an ask-back Mastery Coach, and take interactive quizzes.
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
                    <p className="font-semibold text-slate-900">Auto-Organized Study Library</p>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Group Zoom recordings, transcripts, and modules by course and keyword tags.
                    </p>
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900">Progress &amp; Gmail Sync</p>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Cross-check emails and materials to prioritize exactly where you are behind.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                {globalError && (
                  <p className="text-xs font-medium text-red-700" role="alert">
                    {globalError}
                  </p>
                )}
                <GoogleSignInButton
                  label="Sign in with Google to Open Workspace"
                  loading={signingIn}
                  onClick={handleGoogleSignIn}
                />
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

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Brand wordmark only */}
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            StudyTrack AI
          </button>

          {/* Zone 2: 5 concise single-line nav links */}
          <nav
            aria-label="Primary"
            className="hidden md:flex items-center gap-6 text-sm font-medium"
          >
            {NAV_ITEMS.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
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

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-8">
        {globalError && (
          <div
            className="mb-6 bg-red-50 border border-red-200 rounded-xl p-4 flex items-center justify-between gap-3 text-sm text-red-800"
            role="alert"
          >
            <div className="flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{globalError}</span>
            </div>
            <button
              type="button"
              onClick={() => setGlobalError(null)}
              className="text-xs font-medium underline shrink-0"
            >
              Dismiss
            </button>
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
                onNavigate={(tab) => setActiveTab(tab)}
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
                courses={courses}
                lectures={lectures}
                modules={modules}
                selectedItem={selectedLibraryItem}
                onSelectItem={setSelectedLibraryItem}
                onSaveLecture={(lecture) => createLectureDoc(user.uid, lecture)}
                onSaveModule={(mod) => createModuleDoc(user.uid, mod)}
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

            {activeTab === 'email' && (
              <EmailView
                userEmail={user.email}
                gmailToken={gmailToken}
                courses={courses}
                emails={emails}
                selectedEmailId={selectedEmailId}
                onEmailsChange={setEmails}
                onSelectEmail={setSelectedEmailId}
                onConnectGmail={handleGoogleSignIn}
                onTokenExpired={() => {
                  clearAccessToken();
                  setGmailToken(null);
                }}
                onAddTask={(task) => createTaskDoc(user.uid, task)}
              />
            )}
          </>
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500">
          <span>StudyTrack AI · Associate Degree Study Workspace</span>
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
      <StudyTrackWorkspace />
    </ErrorBoundary>
  );
}
