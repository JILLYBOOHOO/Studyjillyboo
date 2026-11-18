import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  RotateCcw,
  Trash2,
  XCircle,
} from 'lucide-react';
import type {
  Course,
  EmailMessageSummary,
  InteractiveQuiz,
  LectureAnalysis,
  ModuleGuide,
  QuizAnswerRecord,
  QuizDifficulty,
} from '../types';

interface InteractiveQuizPanelProps {
  courses: Course[];
  lectures: LectureAnalysis[];
  modules: ModuleGuide[];
  emails: EmailMessageSummary[];
  quizzes: InteractiveQuiz[];
  initialRequest: {
    courseCode: string;
    materialId?: string;
    topicFocus?: string;
  } | null;
  onClearInitialRequest: () => void;
  onCreateQuiz: (quiz: Omit<InteractiveQuiz, 'id' | 'createdAt'>) => Promise<string>;
  onUpdateQuizProgress: (
    quizId: string,
    updates: { answers: QuizAnswerRecord[]; score: number; completed: boolean },
  ) => Promise<void>;
  onDeleteQuiz: (quizId: string) => Promise<void>;
  onCoachMistake: (courseCode: string, topicFocus: string) => void;
}

const OPTION_LETTERS = ['A', 'B', 'C', 'D'];

export function InteractiveQuizPanel({
  courses,
  lectures,
  modules,
  emails,
  quizzes,
  initialRequest,
  onClearInitialRequest,
  onCreateQuiz,
  onUpdateQuizProgress,
  onDeleteQuiz,
  onCoachMistake,
}: InteractiveQuizPanelProps) {
  const [courseFilter, setCourseFilter] = useState('ALL');
  const [selectedMaterialId, setSelectedMaterialId] = useState('');
  const [topicFocus, setTopicFocus] = useState('');
  const [difficulty, setDifficulty] = useState<QuizDifficulty>('Standard');
  const [questionCount, setQuestionCount] = useState<5 | 8>(5);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [activeQuizId, setActiveQuizId] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [shortInput, setShortInput] = useState('');
  const [gradingShort, setGradingShort] = useState(false);
  const [revealedIdeal, setRevealedIdeal] = useState<Record<string, boolean>>({});
  const [viewingSummary, setViewingSummary] = useState(false);

  const activeQuiz = quizzes.find((q) => q.id === activeQuizId) || null;

  useEffect(() => {
    if (!activeQuizId && quizzes[0]) {
      setActiveQuizId(quizzes[0].id);
      setViewingSummary(quizzes[0].completed);
    }
  }, [activeQuizId, quizzes]);

  const materialOptions = useMemo(() => {
    const filterFn = (code: string) =>
      courseFilter === 'ALL' || code.toUpperCase() === courseFilter.toUpperCase();
    return [
      ...lectures
        .filter((l) => filterFn(l.courseCode))
        .map((l) => ({ id: l.id, label: `Zoom: ${l.courseCode} · ${l.title}` })),
      ...modules
        .filter((m) => filterFn(m.courseCode))
        .map((m) => ({ id: m.id, label: `Module: ${m.courseCode} · ${m.title}` })),
    ];
  }, [lectures, modules, courseFilter]);

  const generateQuiz = async (overrides?: {
    courseCode?: string;
    materialId?: string;
    topicFocus?: string;
  }) => {
    setError(null);
    setGenerating(true);
    try {
      const targetCourse = overrides?.courseCode ?? courseFilter;
      const targetMat = overrides?.materialId ?? selectedMaterialId;
      const targetTopic = overrides?.topicFocus ?? topicFocus;

      const resp = await fetch('/api/quiz/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseFilter: targetCourse,
          targetMaterialId: targetMat,
          topicFocus: targetTopic,
          difficulty,
          questionCount,
          lectures,
          modules,
          emails,
        }),
      });

      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || 'Could not generate interactive quiz.');
      }
      if (!Array.isArray(data.questions) || data.questions.length === 0) {
        throw new Error('No quiz questions were returned. Try broadening your course or topic.');
      }

      const newId = await onCreateQuiz(data);
      setActiveQuizId(newId);
      setCurrentIndex(0);
      setSelectedOption(null);
      setShortInput('');
      setRevealedIdeal({});
      setViewingSummary(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Quiz generation failed.');
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    if (initialRequest) {
      setCourseFilter(initialRequest.courseCode || 'ALL');
      setSelectedMaterialId(initialRequest.materialId || '');
      setTopicFocus(initialRequest.topicFocus || '');
      void generateQuiz(initialRequest);
      onClearInitialRequest();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRequest]);

  const currentQuestion = activeQuiz?.questions[currentIndex] || null;
  const currentRecord =
    activeQuiz && currentQuestion
      ? activeQuiz.answers.find((a) => a.questionId === currentQuestion.id) || null
      : null;

  useEffect(() => {
    if (currentRecord) {
      setSelectedOption(
        typeof currentRecord.selectedOptionIndex === 'number'
          ? currentRecord.selectedOptionIndex
          : null,
      );
      setShortInput(currentRecord.textResponse || '');
    } else {
      setSelectedOption(null);
      setShortInput('');
    }
  }, [activeQuiz?.id, currentIndex, currentRecord]);

  const saveAnswerRecord = async (record: QuizAnswerRecord) => {
    if (!activeQuiz) return;
    const filtered = activeQuiz.answers.filter((a) => a.questionId !== record.questionId);
    const nextAnswers = [...filtered, record];
    const nextScore = nextAnswers.filter((a) => a.isCorrect).length;
    const allAnswered = nextAnswers.length >= activeQuiz.questions.length;
    await onUpdateQuizProgress(activeQuiz.id, {
      answers: nextAnswers,
      score: nextScore,
      completed: activeQuiz.completed || allAnswered,
    });
  };

  const handleCheckMcq = async () => {
    if (!activeQuiz || !currentQuestion || selectedOption === null) return;
    const isCorrect = selectedOption === currentQuestion.correctOptionIndex;
    const prevAttempts = currentRecord?.attempts || 0;
    const rightLetter =
      typeof currentQuestion.correctOptionIndex === 'number'
        ? OPTION_LETTERS[currentQuestion.correctOptionIndex]
        : '';
    await saveAnswerRecord({
      questionId: currentQuestion.id,
      selectedOptionIndex: selectedOption,
      isCorrect,
      status: isCorrect ? 'correct' : 'incorrect',
      feedback: isCorrect
        ? currentQuestion.explanation
        : `Not quite — Option ${rightLetter} is correct. ${currentQuestion.explanation}`,
      attempts: prevAttempts + 1,
    });
  };

  const handleCheckShort = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeQuiz || !currentQuestion || !shortInput.trim() || gradingShort) return;
    setError(null);
    setGradingShort(true);
    try {
      const prevAttempts = currentRecord?.attempts || 0;
      const resp = await fetch('/api/quiz/grade-short', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionPrompt: currentQuestion.prompt,
          modelAnswer: currentQuestion.modelAnswer,
          conceptFocus: currentQuestion.conceptFocus,
          courseCode: currentQuestion.courseCode,
          studentAnswer: shortInput.trim(),
          attemptNumber: prevAttempts + 1,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || 'Could not grade your short answer.');
      }
      await saveAnswerRecord({
        questionId: currentQuestion.id,
        textResponse: shortInput.trim(),
        isCorrect: Boolean(data.isCorrect),
        status: data.status || 'incorrect',
        feedback: data.feedback || currentQuestion.explanation,
        attempts: prevAttempts + 1,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Grading failed.');
    } finally {
      setGradingShort(false);
    }
  };

  const handleRetakeQuiz = async () => {
    if (!activeQuiz) return;
    await onUpdateQuizProgress(activeQuiz.id, {
      answers: [],
      score: 0,
      completed: false,
    });
    setCurrentIndex(0);
    setSelectedOption(null);
    setShortInput('');
    setRevealedIdeal({});
    setViewingSummary(false);
  };

  const handleFinishQuiz = async () => {
    if (!activeQuiz) return;
    if (!activeQuiz.completed) {
      await onUpdateQuizProgress(activeQuiz.id, {
        answers: activeQuiz.answers,
        score: activeQuiz.answers.filter((a) => a.isCorrect).length,
        completed: true,
      });
    }
    setViewingSummary(true);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left Sidebar: Quiz Builder + Saved Quizzes */}
      <div className="lg:col-span-4 space-y-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void generateQuiz();
          }}
          className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
        >
          <div>
            <h2 className="text-base font-semibold text-slate-900">Build a Practice Quiz</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Mixes multiple choice and explain-in-your-own-words checks from your files.
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Course</label>
              <select
                value={courseFilter}
                onChange={(e) => {
                  setCourseFilter(e.target.value);
                  setSelectedMaterialId('');
                }}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              >
                <option value="ALL">All Courses</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.code}>
                    {c.code} · {c.title}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Study Material (Optional)
              </label>
              <select
                value={selectedMaterialId}
                onChange={(e) => setSelectedMaterialId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              >
                <option value="">All uploaded lectures &amp; modules</option>
                {materialOptions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Topic Focus (Optional)
              </label>
              <input
                type="text"
                value={topicFocus}
                onChange={(e) => setTopicFocus(e.target.value)}
                placeholder="e.g., NumPy broadcasting, SQL JOINs..."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Difficulty</label>
              <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg">
                {(['Review', 'Standard', 'Challenge'] as const).map((lvl) => (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => setDifficulty(lvl)}
                    className={`px-2 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      difficulty === lvl
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {lvl}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Length</label>
              <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
                {([5, 8] as const).map((cnt) => (
                  <button
                    key={cnt}
                    type="button"
                    onClick={() => setQuestionCount(cnt)}
                    className={`px-2 py-1.5 text-xs font-medium rounded-md transition-colors tabular-nums whitespace-nowrap ${
                      questionCount === cnt
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {cnt} Questions
                  </button>
                ))}
              </div>
            </div>
          </div>

          {error && (
            <p className="text-xs font-medium text-red-700" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={generating}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
          >
            {generating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Building Quiz...
              </>
            ) : (
              'Generate Interactive Quiz'
            )}
          </button>
        </form>

        {/* Saved Quizzes List */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-700">Saved Quizzes</h3>
            <span className="text-xs font-mono text-slate-500 tabular-nums">{quizzes.length}</span>
          </div>

          {quizzes.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">
              Your generated quizzes and scores will appear here.
            </div>
          ) : (
            <div className="divide-y divide-slate-200 max-h-80 overflow-y-auto">
              {quizzes.map((q) => {
                const selected = q.id === activeQuiz?.id;
                return (
                  <div
                    key={q.id}
                    className={`p-3.5 flex items-start justify-between gap-2 transition-colors ${
                      selected ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setActiveQuizId(q.id);
                        setCurrentIndex(0);
                        setViewingSummary(q.completed);
                      }}
                      className="text-left min-w-0 flex-1 space-y-1"
                    >
                      <p className="text-sm font-medium text-slate-900 line-clamp-1">{q.title}</p>
                      <p className="text-xs text-slate-500 tabular-nums">
                        {q.courseCode} · {q.difficulty} · {q.score}/{q.totalQuestions} correct
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (activeQuizId === q.id) setActiveQuizId(null);
                        void onDeleteQuiz(q.id);
                      }}
                      aria-label={`Delete ${q.title}`}
                      className="p-1 text-slate-400 hover:text-red-700 rounded shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Right Workspace: Interactive Quiz Runner OR Summary */}
      <div className="lg:col-span-8">
        {!activeQuiz ? (
          <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-3">
            <ClipboardCheck className="w-8 h-8 text-slate-400 mx-auto" />
            <p className="text-base font-semibold text-slate-900">
              Test your understanding with an interactive quiz
            </p>
            <p className="text-sm text-slate-600 max-w-md mx-auto">
              Choose a course, lecture, or topic on the left and click Generate Interactive Quiz to
              practice multiple-choice and short-answer questions with instant coaching.
            </p>
          </div>
        ) : viewingSummary ? (
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-4 pb-5 border-b border-slate-200">
              <div className="space-y-1">
                <p className="text-xs font-mono text-slate-500">
                  {activeQuiz.courseCode} · {activeQuiz.difficulty} · Quiz Summary
                </p>
                <h2 className="text-xl font-semibold text-slate-900">{activeQuiz.title}</h2>
              </div>
              <div className="text-right">
                <p className="text-2xl font-semibold text-slate-900 tabular-nums">
                  {activeQuiz.score} / {activeQuiz.totalQuestions}
                </p>
                <p className="text-xs text-slate-500 tabular-nums">
                  {Math.round((activeQuiz.score / Math.max(1, activeQuiz.totalQuestions)) * 100)}%
                  accuracy
                </p>
              </div>
            </div>

            <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
              {activeQuiz.questions.map((q, idx) => {
                const rec = activeQuiz.answers.find((a) => a.questionId === q.id);
                const passed = Boolean(rec?.isCorrect);
                return (
                  <div key={q.id} className="p-4 space-y-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="text-sm font-medium text-slate-900 flex-1">
                        {String(idx + 1).padStart(2, '0')}. {q.prompt}
                      </p>
                      {passed ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 shrink-0">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Correct
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 shrink-0">
                          <XCircle className="w-3.5 h-3.5" />
                          Needs Review
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-slate-500">
                      Concept: {q.conceptFocus} · Source: {q.sourceTitle}
                    </p>
                    <p className="text-xs text-slate-700">
                      {rec?.feedback || `Model answer: ${q.modelAnswer}`}
                    </p>

                    {!passed && (
                      <div className="pt-1 flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            setViewingSummary(false);
                            setCurrentIndex(idx);
                          }}
                          className="text-xs font-medium text-slate-700 hover:text-slate-900 underline"
                        >
                          Retry Question
                        </button>
                        <button
                          type="button"
                          onClick={() => onCoachMistake(q.courseCode, q.conceptFocus)}
                          className="text-xs font-medium text-blue-700 hover:underline"
                        >
                          Coach Me Until I Master This
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setViewingSummary(false)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back to Questions
              </button>

              <div className="flex flex-wrap items-center gap-2">
                {activeQuiz.questions.some(
                  (q) => !activeQuiz.answers.find((a) => a.questionId === q.id)?.isCorrect,
                ) && (
                  <button
                    type="button"
                    onClick={() => {
                      const missedConcepts = activeQuiz.questions
                        .filter(
                          (q) =>
                            !activeQuiz.answers.find((a) => a.questionId === q.id)?.isCorrect,
                        )
                        .map((q) => q.conceptFocus)
                        .slice(0, 3)
                        .join(', ');
                      onCoachMistake(activeQuiz.courseCode, missedConcepts || activeQuiz.topicFocus);
                    }}
                    className="px-4 py-2 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg"
                  >
                    Coach Me on Missed Concepts
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void handleRetakeQuiz()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Retake Quiz
                </button>
              </div>
            </div>
          </div>
        ) : (
          currentQuestion && (
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
              {/* Header & Progress Bar */}
              <div className="space-y-3 pb-5 border-b border-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-mono text-slate-500">
                      {activeQuiz.courseCode} · {activeQuiz.difficulty} · Question{' '}
                      <span className="tabular-nums">
                        {currentIndex + 1} of {activeQuiz.questions.length}
                      </span>
                    </p>
                    <h2 className="text-lg font-semibold text-slate-900 mt-0.5">
                      {activeQuiz.title}
                    </h2>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setViewingSummary(true)}
                      className="px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg whitespace-nowrap"
                    >
                      Scorecard ({activeQuiz.score}/{activeQuiz.totalQuestions})
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleRetakeQuiz()}
                      className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg whitespace-nowrap"
                    >
                      Reset
                    </button>
                  </div>
                </div>

                {/* Progress Strip */}
                <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${activeQuiz.questions.length}, minmax(0, 1fr))` }}>
                  {activeQuiz.questions.map((q, idx) => {
                    const ans = activeQuiz.answers.find((a) => a.questionId === q.id);
                    const isCurrent = idx === currentIndex;
                    return (
                      <button
                        key={q.id}
                        type="button"
                        aria-label={`Jump to question ${idx + 1}`}
                        onClick={() => setCurrentIndex(idx)}
                        className={`h-2 rounded-sm transition-colors ${
                          ans
                            ? ans.isCorrect
                              ? 'bg-emerald-600'
                              : 'bg-red-500'
                            : isCurrent
                              ? 'bg-blue-700'
                              : 'bg-slate-200 hover:bg-slate-300'
                        }`}
                      />
                    );
                  })}
                </div>
              </div>

              {/* Question Body */}
              <div className="space-y-4">
                <div className="text-xs text-slate-500 flex flex-wrap items-center gap-2">
                  <span>
                    {currentQuestion.type === 'mcq' ? 'Multiple Choice' : 'Short Answer'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>Concept: {currentQuestion.conceptFocus}</span>
                  <span aria-hidden="true">·</span>
                  <span>Source: {currentQuestion.sourceTitle}</span>
                </div>

                <p className="text-base sm:text-lg font-semibold text-slate-900 leading-snug">
                  {currentQuestion.prompt}
                </p>

                {currentQuestion.type === 'mcq' && currentQuestion.options ? (
                  <div className="space-y-2.5">
                    {currentQuestion.options.map((opt, idx) => {
                      const isPicked = selectedOption === idx;
                      const checked = Boolean(currentRecord);
                      const isRightOption = idx === currentQuestion.correctOptionIndex;

                      let styleClass =
                        'border-slate-200 bg-white hover:border-slate-300 text-slate-800';
                      if (checked) {
                        if (isRightOption) {
                          styleClass = 'border-emerald-600 bg-emerald-50/70 text-slate-900';
                        } else if (isPicked && !isRightOption) {
                          styleClass = 'border-red-500 bg-red-50/70 text-slate-900';
                        } else {
                          styleClass = 'border-slate-200 bg-slate-50/50 text-slate-500';
                        }
                      } else if (isPicked) {
                        styleClass = 'border-blue-700 bg-blue-50/70 text-slate-900';
                      }

                      return (
                        <button
                          key={idx}
                          type="button"
                          disabled={checked}
                          onClick={() => setSelectedOption(idx)}
                          className={`w-full text-left p-3.5 rounded-lg border transition-colors flex items-start gap-3 ${styleClass}`}
                        >
                          <span className="font-mono text-xs font-semibold text-slate-500 mt-0.5 shrink-0">
                            {OPTION_LETTERS[idx]}.
                          </span>
                          <span className="text-sm flex-1">{opt}</span>
                          {checked && isRightOption && (
                            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                          )}
                          {checked && isPicked && !isRightOption && (
                            <XCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
                          )}
                        </button>
                      );
                    })}

                    {!currentRecord && (
                      <div className="pt-2">
                        <button
                          type="button"
                          disabled={selectedOption === null}
                          onClick={() => void handleCheckMcq()}
                          className="px-4 py-2 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg transition-colors"
                        >
                          Check Answer
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <form onSubmit={handleCheckShort} className="space-y-3">
                    <textarea
                      rows={3}
                      value={shortInput}
                      onChange={(e) => setShortInput(e.target.value)}
                      placeholder="Explain your answer in your own words..."
                      className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                    />
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="submit"
                        disabled={gradingShort || !shortInput.trim()}
                        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg transition-colors"
                      >
                        {gradingShort ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Checking Answer...
                          </>
                        ) : currentRecord && !currentRecord.isCorrect ? (
                          'Check Revised Answer'
                        ) : (
                          'Check Answer'
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          setRevealedIdeal((prev) => ({
                            ...prev,
                            [currentQuestion.id]: !prev[currentQuestion.id],
                          }))
                        }
                        className="text-xs font-medium text-slate-600 hover:text-slate-900 underline"
                      >
                        {revealedIdeal[currentQuestion.id]
                          ? 'Hide Model Answer'
                          : 'Show Model Answer'}
                      </button>
                    </div>

                    {revealedIdeal[currentQuestion.id] && (
                      <div className="rounded-lg bg-slate-50 border border-slate-200 p-3.5 text-xs text-slate-700 space-y-1">
                        <p className="font-semibold text-slate-800">Model Answer</p>
                        <p className="leading-relaxed">{currentQuestion.modelAnswer}</p>
                      </div>
                    )}
                  </form>
                )}

                {/* Immediate Feedback Block */}
                {currentRecord && (
                  <div
                    className={`rounded-lg border p-4 space-y-2 ${
                      currentRecord.status === 'correct'
                        ? 'bg-emerald-50/60 border-emerald-200'
                        : currentRecord.status === 'partial'
                          ? 'bg-amber-50/60 border-amber-200'
                          : 'bg-red-50/60 border-red-200'
                    }`}
                  >
                    <div className="flex items-center gap-2 text-xs font-semibold">
                      {currentRecord.status === 'correct' ? (
                        <span className="inline-flex items-center gap-1.5 text-emerald-800">
                          <CheckCircle2 className="w-4 h-4" />
                          Correct
                        </span>
                      ) : currentRecord.status === 'partial' ? (
                        <span className="inline-flex items-center gap-1.5 text-amber-800">
                          <AlertCircle className="w-4 h-4" />
                          Partially Correct — Refine Your Answer
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-red-800">
                          <XCircle className="w-4 h-4" />
                          Not Quite — Review &amp; Practice
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-800 leading-relaxed">
                      {currentRecord.feedback}
                    </p>

                    {!currentRecord.isCorrect && (
                      <button
                        type="button"
                        onClick={() =>
                          onCoachMistake(currentQuestion.courseCode, currentQuestion.conceptFocus)
                        }
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 hover:underline pt-1"
                      >
                        Practice &quot;{currentQuestion.conceptFocus}&quot; with Mastery Coach
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Footer Pagination */}
              <div className="pt-4 border-t border-slate-200 flex items-center justify-between gap-4">
                <button
                  type="button"
                  disabled={currentIndex === 0}
                  onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 disabled:opacity-40 rounded-lg"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Previous
                </button>

                {currentIndex < activeQuiz.questions.length - 1 ? (
                  <button
                    type="button"
                    onClick={() => setCurrentIndex((i) => i + 1)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg"
                  >
                    Next Question
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleFinishQuiz()}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg"
                  >
                    View Quiz Scorecard
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}
