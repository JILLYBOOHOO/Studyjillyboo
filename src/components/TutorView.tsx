import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  CheckCircle2,
  ExternalLink,
  HelpCircle,
  Lightbulb,
  Loader2,
  MessageSquare,
  RotateCcw,
  Send,
  Sigma,
  Trash2,
} from 'lucide-react';
import { InteractiveQuizPanel } from './InteractiveQuizPanel';
import { LATEX_SNIPPETS, MathText, containsLatex } from './MathText';
import { NotebookLMStudioPanel } from './NotebookLMStudioPanel';
import type {
  Course,
  EmailMessageSummary,
  InteractiveQuiz,
  LectureAnalysis,
  ModuleGuide,
  QuizAnswerRecord,
  SmartNoteCard,
  TutorCitation,
  TutorMessage,
  TutorMode,
  TutorThread,
} from '../types';

export type TutorSubTab = 'qa' | 'socratic' | 'quiz' | 'studio';

interface TutorViewProps {
  courses: Course[];
  lectures: LectureAnalysis[];
  modules: ModuleGuide[];
  smartNotes: SmartNoteCard[];
  emails: EmailMessageSummary[];
  qaThread: TutorThread | null;
  socraticThread: TutorThread | null;
  quizzes: InteractiveQuiz[];
  activeSubTab: TutorSubTab;
  onChangeSubTab: (tab: TutorSubTab) => void;
  initialPrompt: { courseCode: string; question: string } | null;
  onClearInitialPrompt: () => void;
  initialSocraticFocus: {
    courseCode: string;
    topicFocus: string;
    materialId?: string;
  } | null;
  onClearInitialSocraticFocus: () => void;
  initialQuizRequest: {
    courseCode: string;
    materialId?: string;
    topicFocus?: string;
  } | null;
  onClearInitialQuizRequest: () => void;
  onSaveThread: (
    mode: TutorMode,
    payload: {
      focusCourse: string;
      masteredConcepts: string[];
      messages: TutorMessage[];
      title?: string;
    },
  ) => Promise<void>;
  onClearThread: (mode: TutorMode) => Promise<void>;
  onCreateQuiz: (quiz: Omit<InteractiveQuiz, 'id' | 'createdAt'>) => Promise<string>;
  onUpdateQuizProgress: (
    quizId: string,
    updates: { answers: QuizAnswerRecord[]; score: number; completed: boolean },
  ) => Promise<void>;
  onDeleteQuiz: (quizId: string) => Promise<void>;
  onOpenCitation: (citation: TutorCitation) => void;
}

export function TutorView({
  courses,
  lectures,
  modules,
  smartNotes,
  emails,
  qaThread,
  socraticThread,
  quizzes,
  activeSubTab,
  onChangeSubTab,
  initialPrompt,
  onClearInitialPrompt,
  initialSocraticFocus,
  onClearInitialSocraticFocus,
  initialQuizRequest,
  onClearInitialQuizRequest,
  onSaveThread,
  onClearThread,
  onCreateQuiz,
  onUpdateQuizProgress,
  onDeleteQuiz,
  onOpenCitation,
}: TutorViewProps) {
  const [courseFilter, setCourseFilter] = useState('ALL');
  const [qaInput, setQaInput] = useState('');
  const [qaLoading, setQaLoading] = useState(false);
  const [qaError, setQaError] = useState<string | null>(null);
  const [showQaMath, setShowQaMath] = useState(false);

  // Socratic Mastery Coach state
  const [socraticTopicInput, setSocraticTopicInput] = useState('');
  const [socraticMaterialId, setSocraticMaterialId] = useState('');
  const [socraticAnswerInput, setSocraticAnswerInput] = useState('');
  const [socraticLoading, setSocraticLoading] = useState(false);
  const [socraticError, setSocraticError] = useState<string | null>(null);
  const [showSocraticMath, setShowSocraticMath] = useState(false);
  const [studioQuizRequest, setStudioQuizRequest] = useState<{
    courseCode: string;
    materialId?: string;
    topicFocus?: string;
  } | null>(null);

  const qaEndRef = useRef<HTMLDivElement | null>(null);
  const socraticEndRef = useRef<HTMLDivElement | null>(null);

  const qaMessages = qaThread?.messages || [];
  const socraticMessages = socraticThread?.messages || [];
  const masteredConcepts = socraticThread?.masteredConcepts || [];

  useEffect(() => {
    if (activeSubTab === 'qa') {
      qaEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    } else if (activeSubTab === 'socratic') {
      socraticEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeSubTab, qaMessages.length, socraticMessages.length, qaLoading, socraticLoading]);

  const materialOptions = useMemo(() => {
    const filterFn = (code: string) =>
      courseFilter === 'ALL' || code.toUpperCase() === courseFilter.toUpperCase();
    return [
      ...lectures
        .filter((l) => filterFn(l.courseCode))
        .map((l) => ({ id: l.id, title: l.title, courseCode: l.courseCode, label: `Zoom: ${l.courseCode} · ${l.title}` })),
      ...modules
        .filter((m) => filterFn(m.courseCode))
        .map((m) => ({ id: m.id, title: m.title, courseCode: m.courseCode, label: `Module: ${m.courseCode} · ${m.title}` })),
    ];
  }, [lectures, modules, courseFilter]);

  const sendQaQuestion = async (questionText: string, filterOverride?: string) => {
    const q = questionText.trim();
    if (!q || qaLoading) return;

    setQaError(null);
    const activeFilter = filterOverride ?? courseFilter;
    const nextUserMessages: TutorMessage[] = [...qaMessages, { role: 'user', text: q }];
    setQaInput('');
    setQaLoading(true);

    try {
      await onSaveThread('qa', {
        focusCourse: activeFilter,
        masteredConcepts: [],
        messages: nextUserMessages,
      });

      const resp = await fetch('/api/tutor/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: q,
          courseFilter: activeFilter,
          history: nextUserMessages,
          lectures,
          modules,
          smartNotes,
          emails,
        }),
      });

      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || 'Could not get response from course chatbot.');
      }

      const finalMessages: TutorMessage[] = [
        ...nextUserMessages,
        {
          role: 'assistant',
          text: data.answer,
          citations: Array.isArray(data.citations) ? data.citations : [],
        },
      ];
      await onSaveThread('qa', {
        focusCourse: activeFilter,
        masteredConcepts: [],
        messages: finalMessages,
      });
    } catch (err) {
      setQaError(err instanceof Error ? err.message : 'Chatbot request failed.');
    } finally {
      setQaLoading(false);
    }
  };

  const runSocraticTurn = async (params: {
    action: 'start' | 'respond' | 'hint';
    studentInput?: string;
    topicFocus?: string;
    courseOverride?: string;
    materialOverride?: string;
    resetHistory?: boolean;
  }) => {
    if (socraticLoading) return;
    setSocraticError(null);

    const activeFilter = params.courseOverride ?? courseFilter;
    const activeMatId = params.materialOverride ?? socraticMaterialId;
    const baseHistory = params.resetHistory ? [] : socraticMessages;
    const baseMastered = params.resetHistory ? [] : masteredConcepts;

    let workingMessages = [...baseHistory];
    if (params.action === 'respond' && params.studentInput?.trim()) {
      workingMessages = [...workingMessages, { role: 'user', text: params.studentInput.trim() }];
      setSocraticAnswerInput('');
    } else if (params.action === 'hint') {
      workingMessages = [...workingMessages, { role: 'user', text: 'Can I get a hint for this question?' }];
    }

    setSocraticLoading(true);
    try {
      if (workingMessages.length > 0) {
        await onSaveThread('socratic', {
          focusCourse: activeFilter,
          masteredConcepts: baseMastered,
          messages: workingMessages,
          title: params.topicFocus ? `Mastery Coach: ${params.topicFocus}` : socraticThread?.title,
        });
      }

      const resp = await fetch('/api/tutor/socratic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: params.action,
          studentInput: params.studentInput?.trim() || '',
          topicFocus: params.topicFocus?.trim() || socraticTopicInput.trim(),
          courseFilter: activeFilter,
          targetMaterialId: activeMatId,
          masteredConcepts: baseMastered,
          history: workingMessages,
          lectures,
          modules,
          emails,
        }),
      });

      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || 'Could not reach Mastery Coach.');
      }

      const nextMastered =
        data.evaluationStatus === 'mastered' && data.masteredConcept
          ? Array.from(new Set([...baseMastered, String(data.masteredConcept)]))
          : baseMastered;

      const assistantMsg: TutorMessage = {
        role: 'assistant',
        text: data.reply,
        evaluationStatus: data.evaluationStatus,
        conceptFocus: data.conceptFocus,
        hintText: data.hintText || '',
        citations: Array.isArray(data.citations) ? data.citations : [],
      };

      await onSaveThread('socratic', {
        focusCourse: activeFilter,
        masteredConcepts: nextMastered,
        messages: [...workingMessages, assistantMsg],
        title: params.topicFocus
          ? `Mastery Coach: ${params.topicFocus}`
          : socraticThread?.title || `Mastery Coach: ${data.conceptFocus}`,
      });
    } catch (err) {
      setSocraticError(err instanceof Error ? err.message : 'Mastery Coach failed.');
    } finally {
      setSocraticLoading(false);
    }
  };

  useEffect(() => {
    if (initialPrompt) {
      setCourseFilter(initialPrompt.courseCode || 'ALL');
      onChangeSubTab('qa');
      void sendQaQuestion(initialPrompt.question, initialPrompt.courseCode || 'ALL');
      onClearInitialPrompt();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt]);

  useEffect(() => {
    if (initialSocraticFocus) {
      const nextCourse = initialSocraticFocus.courseCode || 'ALL';
      setCourseFilter(nextCourse);
      setSocraticTopicInput(initialSocraticFocus.topicFocus || '');
      setSocraticMaterialId(initialSocraticFocus.materialId || '');
      onChangeSubTab('socratic');
      void runSocraticTurn({
        action: 'start',
        topicFocus: initialSocraticFocus.topicFocus,
        courseOverride: nextCourse,
        materialOverride: initialSocraticFocus.materialId || '',
        resetHistory: true,
      });
      onClearInitialSocraticFocus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSocraticFocus]);

  const handleLaunchCoachFromQuiz = (courseCode: string, topicFocus: string) => {
    const nextCourse = courseCode || 'ALL';
    setCourseFilter(nextCourse);
    setSocraticTopicInput(topicFocus);
    setSocraticMaterialId('');
    onChangeSubTab('socratic');
    void runSocraticTurn({
      action: 'start',
      topicFocus,
      courseOverride: nextCourse,
      materialOverride: '',
      resetHistory: true,
    });
  };

  return (
    <div className="space-y-6">
      {/* Header + Sub-Mode Switcher */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            Interactive Study Tutor &amp; Quizzes
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Ask questions across your Zoom transcripts and modules, practice with a Brisk-style
            ask-back mastery coach, or take interactive quizzes.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => onChangeSubTab('qa')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                activeSubTab === 'qa'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Ask Chatbot
            </button>
            <button
              type="button"
              onClick={() => onChangeSubTab('socratic')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                activeSubTab === 'socratic'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Mastery Coach (Ask-Back)
            </button>
            <button
              type="button"
              onClick={() => onChangeSubTab('quiz')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                activeSubTab === 'quiz'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Interactive Quizzes
            </button>
            <button
              type="button"
              onClick={() => onChangeSubTab('studio')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                activeSubTab === 'studio'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              NotebookLM Studio
            </button>
          </div>
        </div>
      </div>

      {/* TAB 1: Multi-Source Q&A Chatbot */}
      {activeSubTab === 'qa' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <BookOpen className="w-3.5 h-3.5 text-blue-700 shrink-0" />
              <span className="tabular-nums">
                Grounded in {lectures.length} Zoom lecture{lectures.length === 1 ? '' : 's'},{' '}
                {modules.length} module guide{modules.length === 1 ? '' : 's'}, and {emails.length}{' '}
                email{emails.length === 1 ? '' : 's'}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <select
                value={courseFilter}
                onChange={(e) => setCourseFilter(e.target.value)}
                aria-label="Filter chatbot course context"
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              >
                <option value="ALL">All Courses &amp; Materials</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.code}>
                    {c.code} · {c.title}
                  </option>
                ))}
              </select>

              {qaMessages.length > 0 && (
                <button
                  type="button"
                  onClick={() => void onClearThread('qa')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-red-700 border border-slate-300 bg-white rounded-lg whitespace-nowrap"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  New Chat
                </button>
              )}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col min-h-[520px]">
            <div className="flex-1 p-5 sm:p-6 space-y-6 overflow-y-auto max-h-[500px]">
              {qaMessages.length === 0 ? (
                <div className="py-10 text-center space-y-5 max-w-xl mx-auto">
                  <MessageSquare className="w-8 h-8 text-slate-400 mx-auto" />
                  <div className="space-y-1">
                    <p className="text-base font-semibold text-slate-900">
                      Ask anything about your classes, modules, or assignments
                    </p>
                    <p className="text-sm text-slate-600">
                      Every answer references the exact lecture transcript, module file, or email it
                      came from so you can jump straight to the source.
                    </p>
                  </div>

                  <div className="flex flex-wrap justify-center gap-2">
                    {[
                      'Summarize what I missed across my uploaded lectures and modules',
                      'Explain supervised learning vs NumPy arrays simply',
                      'What assignments or deadlines were mentioned recently?',
                    ].map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        onClick={() => void sendQaQuestion(prompt)}
                        className="px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors text-left"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                qaMessages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`flex flex-col ${
                      msg.role === 'user' ? 'items-end' : 'items-start'
                    }`}
                  >
                    <div
                      className={`max-w-3xl rounded-xl px-4 py-3 space-y-2.5 ${
                        msg.role === 'user'
                          ? 'bg-blue-700 text-white'
                          : 'bg-slate-50 border border-slate-200 text-slate-900'
                      }`}
                    >
                      <p className="text-xs font-semibold opacity-75">
                        {msg.role === 'user' ? 'You' : 'StudyTrack Course Chatbot'}
                      </p>
                      <MathText text={msg.text} className="text-sm leading-relaxed" />

                      {msg.role === 'assistant' && msg.citations && msg.citations.length > 0 && (
                        <div className="pt-2 border-t border-slate-200 flex flex-wrap items-center gap-2">
                          <span className="text-xs text-slate-500">Sources:</span>
                          {msg.citations.map((cit, cIdx) => (
                            <button
                              key={cIdx}
                              type="button"
                              onClick={() => onOpenCitation(cit)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-700 bg-white border border-slate-200 hover:bg-blue-50 rounded-md transition-colors"
                            >
                              <ExternalLink className="w-3 h-3 shrink-0" />
                              <span>
                                {cit.courseCode} · {cit.title}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}

              {qaLoading && (
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Loader2 className="w-4 h-4 animate-spin text-blue-700" />
                  Searching your lecture transcripts and module files...
                </div>
              )}
              <div ref={qaEndRef} />
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void sendQaQuestion(qaInput);
              }}
              className="p-4 border-t border-slate-200 bg-white space-y-2"
            >
              {qaError && (
                <p className="text-xs font-medium text-red-700" role="alert">
                  {qaError}
                </p>
              )}
              {containsLatex(qaInput) && (
                <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 space-y-1">
                  <span className="block text-[11px] font-medium text-slate-500">
                    LaTeX Math Preview
                  </span>
                  <MathText text={qaInput} className="text-sm text-slate-900" />
                </div>
              )}
              {showQaMath && (
                <div className="flex flex-wrap items-center gap-1.5 pb-1">
                  {LATEX_SNIPPETS.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() =>
                        setQaInput((prev) => (prev ? `${prev} ${item.snippet}` : item.snippet))
                      }
                      className="px-2 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md whitespace-nowrap"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowQaMath((v) => !v)}
                  title="Insert LaTeX math formula"
                  className={`inline-flex items-center gap-1 px-2.5 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                    showQaMath
                      ? 'bg-blue-50 text-blue-800 border-blue-300'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <Sigma className="w-3.5 h-3.5" />
                  LaTeX
                </button>
                <input
                  type="text"
                  value={qaInput}
                  onChange={(e) => setQaInput(e.target.value)}
                  placeholder="Ask a question or paste LaTeX ($...$ / $$...$$) about any lecture or module..."
                  className="flex-1 rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                />
                <button
                  type="submit"
                  disabled={qaLoading || !qaInput.trim()}
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <Send className="w-4 h-4" />
                  Send
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* TAB 2: Brisk-Style Socratic Mastery Coach (Ask-Back Until Correct) */}
      {activeSubTab === 'socratic' && (
        <div className="space-y-4">
          {/* Session Setup & Mastery Strip */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
              <div className="md:col-span-3">
                <label className="block text-xs font-medium text-slate-700 mb-1">Course</label>
                <select
                  value={courseFilter}
                  onChange={(e) => {
                    setCourseFilter(e.target.value);
                    setSocraticMaterialId('');
                  }}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                >
                  <option value="ALL">All Courses</option>
                  {courses.map((c) => (
                    <option key={c.id} value={c.code}>
                      {c.code} · {c.title}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-4">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Study Material (Optional)
                </label>
                <select
                  value={socraticMaterialId}
                  onChange={(e) => setSocraticMaterialId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                >
                  <option value="">All materials in scope</option>
                  {materialOptions.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-3">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Concept or Topic
                </label>
                <input
                  type="text"
                  value={socraticTopicInput}
                  onChange={(e) => setSocraticTopicInput(e.target.value)}
                  placeholder="e.g., Regression loss, NumPy shape..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                />
              </div>

              <div className="md:col-span-2 flex gap-2">
                <button
                  type="button"
                  disabled={socraticLoading}
                  onClick={() =>
                    void runSocraticTurn({
                      action: 'start',
                      topicFocus: socraticTopicInput,
                      resetHistory: true,
                    })
                  }
                  className="flex-1 px-3 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
                >
                  {socraticMessages.length > 0 ? 'New Session' : 'Start Coaching'}
                </button>
              </div>
            </div>

            {/* Quiet Unboxed Mastery Counter */}
            <div className="pt-2 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
              <div className="flex flex-wrap items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                <span className="font-medium text-slate-800 tabular-nums">
                  {masteredConcepts.length} concept{masteredConcepts.length === 1 ? '' : 's'}{' '}
                  mastered
                </span>
                {masteredConcepts.length > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-slate-600">{masteredConcepts.join(' · ')}</span>
                  </>
                )}
              </div>

              {socraticMessages.length > 0 && (
                <button
                  type="button"
                  onClick={() => void onClearThread('socratic')}
                  className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-red-700"
                >
                  <Trash2 className="w-3 h-3" />
                  Clear Session
                </button>
              )}
            </div>
          </div>

          {/* Socratic Coach Dialogue Container */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col min-h-[480px]">
            <div className="flex-1 p-5 sm:p-6 space-y-6 overflow-y-auto max-h-[480px]">
              {socraticMessages.length === 0 ? (
                <div className="py-8 text-center space-y-5 max-w-xl mx-auto">
                  <HelpCircle className="w-8 h-8 text-blue-700 mx-auto" />
                  <div className="space-y-1">
                    <p className="text-base font-semibold text-slate-900">
                      Master concepts by answering back — step by step
                    </p>
                    <p className="text-sm text-slate-600">
                      Instead of just reading notes, your Mastery Coach tests you one concept at a
                      time. If you get something wrong, it gives a clear hint and asks you back
                      until you nail it.
                    </p>
                  </div>

                  <div className="flex flex-wrap justify-center gap-2">
                    {[
                      ...lectures.slice(0, 2).map((l) => ({
                        courseCode: l.courseCode,
                        topicFocus: l.moduleTopic || l.title,
                        materialId: l.id,
                        label: `Check me on ${l.courseCode}: ${l.title}`,
                      })),
                      ...modules.slice(0, 2).map((m) => ({
                        courseCode: m.courseCode,
                        topicFocus: m.moduleTopic || m.title,
                        materialId: m.id,
                        label: `Check me on ${m.courseCode}: ${m.title}`,
                      })),
                    ].map((starter, idx) => (
                      <button
                        key={idx}
                        type="button"
                        disabled={socraticLoading}
                        onClick={() => {
                          setCourseFilter(starter.courseCode);
                          setSocraticMaterialId(starter.materialId);
                          setSocraticTopicInput(starter.topicFocus);
                          void runSocraticTurn({
                            action: 'start',
                            topicFocus: starter.topicFocus,
                            courseOverride: starter.courseCode,
                            materialOverride: starter.materialId,
                            resetHistory: true,
                          });
                        }}
                        className="px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors text-left"
                      >
                        {starter.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                socraticMessages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`flex flex-col ${
                      msg.role === 'user' ? 'items-end' : 'items-start'
                    }`}
                  >
                    <div
                      className={`max-w-3xl rounded-xl px-4 py-3 space-y-2 ${
                        msg.role === 'user'
                          ? 'bg-blue-700 text-white'
                          : 'bg-slate-50 border border-slate-200 text-slate-900'
                      }`}
                    >
                      {msg.role === 'user' ? (
                        <p className="text-xs font-semibold opacity-75">Your Answer</p>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                          {msg.evaluationStatus === 'mastered' ? (
                            <span className="inline-flex items-center gap-1.5 text-emerald-700">
                              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                              Mastered · Next Question
                            </span>
                          ) : msg.evaluationStatus === 'retry' ? (
                            <span className="inline-flex items-center gap-1.5 text-amber-700">
                              <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                              Hint &amp; Try Again
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-blue-700">
                              <HelpCircle className="w-3.5 h-3.5 shrink-0" />
                              Understanding Check
                            </span>
                          )}
                          {msg.conceptFocus && (
                            <>
                              <span aria-hidden="true" className="text-slate-400">
                                ·
                              </span>
                              <span className="text-slate-600 font-medium">{msg.conceptFocus}</span>
                            </>
                          )}
                        </div>
                      )}

                      <MathText text={msg.text} className="text-sm leading-relaxed" />

                      {msg.role === 'assistant' && msg.citations && msg.citations.length > 0 && (
                        <div className="pt-2 border-t border-slate-200 flex flex-wrap items-center gap-2">
                          <span className="text-xs text-slate-500">Reference:</span>
                          {msg.citations.map((cit, cIdx) => (
                            <button
                              key={cIdx}
                              type="button"
                              onClick={() => onOpenCitation(cit)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-700 bg-white border border-slate-200 hover:bg-blue-50 rounded-md transition-colors"
                            >
                              <ExternalLink className="w-3 h-3 shrink-0" />
                              <span>
                                {cit.courseCode} · {cit.title}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}

              {socraticLoading && (
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Loader2 className="w-4 h-4 animate-spin text-blue-700" />
                  Checking your reasoning against your course notes...
                </div>
              )}
              <div ref={socraticEndRef} />
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (socraticMessages.length === 0) {
                  void runSocraticTurn({
                    action: 'start',
                    topicFocus: socraticAnswerInput || socraticTopicInput,
                    resetHistory: true,
                  });
                  setSocraticAnswerInput('');
                } else {
                  void runSocraticTurn({
                    action: 'respond',
                    studentInput: socraticAnswerInput,
                  });
                }
              }}
              className="p-4 border-t border-slate-200 bg-white space-y-2"
            >
              {socraticError && (
                <p className="text-xs font-medium text-red-700" role="alert">
                  {socraticError}
                </p>
              )}

              {containsLatex(socraticAnswerInput) && (
                <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 space-y-1">
                  <span className="block text-[11px] font-medium text-slate-500">
                    LaTeX Math Preview
                  </span>
                  <MathText text={socraticAnswerInput} className="text-sm text-slate-900" />
                </div>
              )}

              {showSocraticMath && (
                <div className="flex flex-wrap items-center gap-1.5 pb-1">
                  {LATEX_SNIPPETS.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() =>
                        setSocraticAnswerInput((prev) =>
                          prev ? `${prev} ${item.snippet}` : item.snippet,
                        )
                      }
                      className="px-2 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md whitespace-nowrap"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  onClick={() => setShowSocraticMath((v) => !v)}
                  title="Insert LaTeX math formula"
                  className={`inline-flex items-center gap-1 px-2.5 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                    showSocraticMath
                      ? 'bg-blue-50 text-blue-800 border-blue-300'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <Sigma className="w-3.5 h-3.5" />
                  LaTeX
                </button>
                <input
                  type="text"
                  value={socraticAnswerInput}
                  onChange={(e) => setSocraticAnswerInput(e.target.value)}
                  placeholder={
                    socraticMessages.length === 0
                      ? 'Type a topic you want to master (or click Start Coaching above)...'
                      : 'Explain your answer here (supports LaTeX $...$ math)...'
                  }
                  className="flex-1 rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                />

                <div className="flex gap-2 shrink-0">
                  {socraticMessages.length > 0 && (
                    <button
                      type="button"
                      disabled={socraticLoading}
                      onClick={() => void runSocraticTurn({ action: 'hint' })}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
                    >
                      <Lightbulb className="w-3.5 h-3.5" />
                      Need a Hint
                    </button>
                  )}

                  <button
                    type="submit"
                    disabled={socraticLoading || (!socraticAnswerInput.trim() && socraticMessages.length > 0)}
                    className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
                  >
                    <Send className="w-4 h-4" />
                    {socraticMessages.length === 0 ? 'Start' : 'Check Answer'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* TAB 3: Interactive Quizzes */}
      {activeSubTab === 'quiz' && (
        <InteractiveQuizPanel
          courses={courses}
          lectures={lectures}
          modules={modules}
          emails={emails}
          quizzes={quizzes}
          initialRequest={studioQuizRequest || initialQuizRequest}
          onClearInitialRequest={() => {
            setStudioQuizRequest(null);
            onClearInitialQuizRequest();
          }}
          onCreateQuiz={onCreateQuiz}
          onUpdateQuizProgress={onUpdateQuizProgress}
          onDeleteQuiz={onDeleteQuiz}
          onCoachMistake={handleLaunchCoachFromQuiz}
        />
      )}

      {/* TAB 4: NotebookLM Study Studio */}
      {activeSubTab === 'studio' && (
        <NotebookLMStudioPanel
          courses={courses}
          lectures={lectures}
          modules={modules}
          smartNotes={smartNotes}
          onStartCoachTopic={(courseCode, topicFocus) =>
            handleLaunchCoachFromQuiz(courseCode, topicFocus)
          }
          onStartQuizTopic={(courseCode, topicFocus) => {
            setCourseFilter(courseCode || 'ALL');
            setStudioQuizRequest({
              courseCode: courseCode || 'ALL',
              topicFocus,
            });
            onChangeSubTab('quiz');
          }}
        />
      )}
    </div>
  );
}
