import { useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  Mail,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { SafeImage } from './SafeImage';
import type {
  CatchUpSprint,
  ClassworkItem,
  Course,
  LectureAnalysis,
  LinkedMaterialRef,
  ModuleGuide,
  ProgressReport,
} from '../types';

interface OverviewViewProps {
  studentName: string;
  courses: Course[];
  tasks: ClassworkItem[];
  lectures: LectureAnalysis[];
  modules: ModuleGuide[];
  sprint: CatchUpSprint | null;
  progressReport: ProgressReport | null;
  syncedEmailCount: number;
  hasGmailToken: boolean;
  onNavigate: (tab: 'classwork' | 'library' | 'tutor' | 'email') => void;
  onOpenLinkedMaterial: (ref: LinkedMaterialRef) => void;
  onAnalyzeProgress: () => Promise<void>;
  onGenerateSprint: (hours: number, focusNote: string) => Promise<void>;
  onToggleSprintStep: (stepOrder: number, taskId?: string) => Promise<void>;
  onDeleteCourse: (courseId: string) => Promise<void>;
  onOpenAddModal: () => void;
  onResetStarter: () => Promise<void>;
  onClearAll: () => Promise<void>;
}

export function OverviewView({
  studentName,
  courses,
  tasks,
  lectures,
  modules,
  sprint,
  progressReport,
  syncedEmailCount,
  hasGmailToken,
  onNavigate,
  onOpenLinkedMaterial,
  onAnalyzeProgress,
  onGenerateSprint,
  onToggleSprintStep,
  onDeleteCourse,
  onOpenAddModal,
  onResetStarter,
  onClearAll,
}: OverviewViewProps) {
  const [hoursAvailable, setHoursAvailable] = useState(2);
  const [focusNote, setFocusNote] = useState('');
  const [generatingSprint, setGeneratingSprint] = useState(false);
  const [sprintError, setSprintError] = useState<string | null>(null);

  const [analyzingProgress, setAnalyzingProgress] = useState(false);
  const [progressError, setProgressError] = useState<string | null>(null);

  const [confirmClear, setConfirmClear] = useState(false);
  const [busyReset, setBusyReset] = useState(false);

  const urgentCount = tasks.filter((t) => t.status === 'Urgent Catch-Up').length;
  const openTasks = tasks.filter((t) => t.status !== 'Completed');
  const totalOpenMinutes = openTasks.reduce((acc, t) => acc + (t.estimatedMinutes || 0), 0);
  const totalHoursText = `${Math.floor(totalOpenMinutes / 60)}h ${totalOpenMinutes % 60}m`;

  const handleAnalyzeProgress = async () => {
    setProgressError(null);
    setAnalyzingProgress(true);
    try {
      await onAnalyzeProgress();
    } catch (err) {
      setProgressError(err instanceof Error ? err.message : 'Could not analyze progress.');
    } finally {
      setAnalyzingProgress(false);
    }
  };

  const handleBuildSprint = async (e: React.FormEvent) => {
    e.preventDefault();
    setSprintError(null);
    setGeneratingSprint(true);
    try {
      await onGenerateSprint(hoursAvailable, focusNote);
    } catch (err) {
      setSprintError(err instanceof Error ? err.message : 'Could not build catch-up plan.');
    } finally {
      setGeneratingSprint(false);
    }
  };

  return (
    <div className="space-y-10">
      {/* Editorial Split Header */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden grid grid-cols-1 lg:grid-cols-12 items-stretch">
        <div className="lg:col-span-7 p-6 sm:p-8 flex flex-col justify-between gap-6">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <SafeImage
                src="/src/assets/images/student_avatar_1795018668711.jpg"
                alt={studentName}
                fallbackLabel={studentName.slice(0, 2).toUpperCase()}
                className="w-11 h-11 rounded-full object-cover border border-slate-200 shrink-0"
              />
              <div>
                <p className="text-sm font-medium text-slate-900">{studentName}</p>
                <p className="text-xs text-slate-500">
                  Associate Degree in AI · Jamaica · Semester 1
                </p>
              </div>
            </div>

            <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 tracking-tight text-balance">
              Spot where you&apos;re behind and turn missed coursework into clear next steps.
            </h1>

            <p className="text-sm sm:text-base text-slate-600 leading-relaxed max-w-2xl">
              Your progress tracker combines class emails, downloaded Zoom recordings and
              transcripts, and module files to prioritize exactly what to review first.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => onNavigate('library')}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              Open Study Library
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => onNavigate('tutor')}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              Ask Course Chatbot
            </button>
            <button
              type="button"
              onClick={() => onNavigate('email')}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              {hasGmailToken ? `Gmail Connected (${syncedEmailCount})` : 'Connect Gmail'}
            </button>
          </div>
        </div>

        <div className="lg:col-span-5 min-h-[220px] lg:min-h-full border-t lg:border-t-0 lg:border-l border-slate-200">
          <SafeImage
            src="/src/assets/images/study_desk_hero_1795018668152.jpg"
            alt="Organized student study desk with notebook and laptop"
            fallbackLabel="AI Associate Degree Workspace"
            className="w-full h-full object-cover"
          />
        </div>
      </section>

      {/* Full-Width 4-Column Metric Strip */}
      <section className="bg-white border border-slate-200 rounded-xl grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 divide-x divide-slate-200">
        <div className="p-5 space-y-1">
          <p className="text-xs font-medium text-slate-500">Urgent Catch-Up</p>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-slate-900 tabular-nums">
              {urgentCount}
            </span>
            {urgentCount > 0 ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700">
                <AlertCircle className="w-3.5 h-3.5" />
                Needs attention
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Clear
              </span>
            )}
          </div>
        </div>

        <div className="p-5 space-y-1">
          <p className="text-xs font-medium text-slate-500">Open Study Backlog</p>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-slate-900 tabular-nums">
              {totalHoursText}
            </span>
            <span className="text-xs text-slate-500 tabular-nums">
              {openTasks.length} open item{openTasks.length === 1 ? '' : 's'}
            </span>
          </div>
        </div>

        <div className="p-5 space-y-1">
          <p className="text-xs font-medium text-slate-500">Organized Materials</p>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-slate-900 tabular-nums">
              {lectures.length + modules.length}
            </span>
            <span className="text-xs text-slate-500 tabular-nums">
              {lectures.length} Zoom · {modules.length} modules
            </span>
          </div>
        </div>

        <div className="p-5 space-y-1">
          <p className="text-xs font-medium text-slate-500">Synced Class Emails</p>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-slate-900 tabular-nums">
              {syncedEmailCount}
            </span>
            <button
              type="button"
              onClick={() => onNavigate('email')}
              className="text-xs font-medium text-blue-700 hover:underline whitespace-nowrap"
            >
              {hasGmailToken ? 'Refresh inbox' : 'Sync Gmail'}
            </button>
          </div>
        </div>
      </section>

      {/* Progress & Gap Analysis Section (Email + Study Materials -> Prioritized Catch-Up Topics) */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b border-slate-200">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-slate-900">
              Progress Analysis &amp; Prioritized Catch-Up Topics
            </h2>
            <p className="text-sm text-slate-600">
              Analyzes your synced Gmail updates ({syncedEmailCount}), uploaded Zoom lectures (
              {lectures.length}), module files ({modules.length}), and open tasks to pinpoint where
              you&apos;re behind.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            {!hasGmailToken && (
              <button
                type="button"
                onClick={() => onNavigate('email')}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg whitespace-nowrap"
              >
                <Mail className="w-3.5 h-3.5" />
                Connect Gmail First
              </button>
            )}
            <button
              type="button"
              disabled={analyzingProgress}
              onClick={handleAnalyzeProgress}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              {analyzingProgress ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Analyzing Progress...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4" />
                  {progressReport ? 'Refresh Gap Analysis' : 'Run Progress & Gap Analysis'}
                </>
              )}
            </button>
          </div>
        </div>

        {progressError && (
          <p className="text-xs font-medium text-red-700" role="alert">
            {progressError}
          </p>
        )}

        {!progressReport ? (
          <div className="py-8 text-center space-y-2">
            <p className="text-sm font-medium text-slate-700">
              Ready to diagnose where you stand across your courses
            </p>
            <p className="text-xs text-slate-500 max-w-lg mx-auto">
              Click Run Progress &amp; Gap Analysis to cross-check your emails, tasks, Zoom
              sessions, and module guides into a ranked catch-up list with direct material links.
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-slate-700 leading-relaxed max-w-4xl">
                  {progressReport.overallStatusSummary}
                </p>
                <span className="text-xs font-mono text-slate-500 tabular-nums">
                  {progressReport.analyzedEmailCount} email
                  {progressReport.analyzedEmailCount === 1 ? '' : 's'} scanned
                </span>
              </div>

              {/* Per-Course Progress Row */}
              {progressReport.courseProgress.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {progressReport.courseProgress.map((cp) => (
                    <div
                      key={cp.courseCode}
                      className="border border-slate-200 rounded-lg p-4 space-y-2 bg-slate-50/50"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-mono font-semibold text-slate-800">
                          {cp.courseCode}
                        </span>
                        <span
                          className={`text-xs font-medium ${
                            cp.statusLabel === 'Needs Focus'
                              ? 'text-red-700'
                              : cp.statusLabel === 'Catching Up'
                                ? 'text-amber-700'
                                : 'text-emerald-700'
                          }`}
                        >
                          {cp.statusLabel}
                        </span>
                      </div>
                      <p className="text-sm font-medium text-slate-900 line-clamp-1">
                        {cp.courseTitle}
                      </p>
                      <p className="text-xs text-slate-500 tabular-nums">
                        {cp.completedCount} completed · {cp.openCount} open
                      </p>
                      {cp.behindAreas.length > 0 && (
                        <p className="text-xs text-slate-600 line-clamp-2">
                          Gap: {cp.behindAreas.join(', ')}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Prioritized Topics List with Direct Links */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-900">
                Prioritized Topics to Catch Up On
              </h3>
              <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
                {progressReport.prioritizedTopics.map((item) => (
                  <div key={item.priorityRank} className="p-4 space-y-2.5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="space-y-0.5">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-mono font-semibold text-slate-900 tabular-nums">
                            #{item.priorityRank}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono text-slate-700">{item.courseCode}</span>
                          <span aria-hidden="true">·</span>
                          <span
                            className={`font-medium ${
                              item.urgency === 'Critical'
                                ? 'text-red-700'
                                : item.urgency === 'High'
                                  ? 'text-amber-700'
                                  : 'text-slate-600'
                            }`}
                          >
                            {item.urgency} Priority
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono text-slate-500 tabular-nums">
                            Est. {item.estimatedMinutes}m
                          </span>
                        </div>
                        <p className="text-sm font-semibold text-slate-900">{item.topic}</p>
                      </div>
                    </div>

                    <p className="text-xs text-slate-600">{item.whyBehind}</p>
                    <p className="text-sm text-slate-800">{item.recommendedAction}</p>

                    {item.linkedMaterials.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <span className="text-xs text-slate-500">Relevant materials:</span>
                        {item.linkedMaterials.map((mat, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => onOpenLinkedMaterial(mat)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors"
                          >
                            <ExternalLink className="w-3 h-3 shrink-0" />
                            <span>{mat.label}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Two-Column Lower Workspace: Catch-Up Sprint + Active Courses */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-6">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Today&apos;s Catch-Up Sprint</h2>
            <p className="text-sm text-slate-600 mt-0.5">
              Pick how many hours you have right now and get a focused order of steps.
            </p>
          </div>

          <form onSubmit={handleBuildSprint} className="space-y-4 pb-6 border-b border-slate-200">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-slate-700 mr-1">Available time:</span>
              {[1, 2, 3, 4, 6].map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => setHoursAvailable(h)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors tabular-nums whitespace-nowrap shrink-0 ${
                    hoursAvailable === h
                      ? 'bg-blue-700 text-white border-blue-700'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {h} {h === 1 ? 'hour' : 'hours'}
                </button>
              ))}
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="text"
                value={focusNote}
                onChange={(e) => setFocusNote(e.target.value)}
                placeholder="Optional note: e.g., I have a Python lab due tomorrow"
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              />
              <button
                type="submit"
                disabled={generatingSprint || openTasks.length === 0}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                {generatingSprint ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Planning...
                  </>
                ) : (
                  'Build Sprint Plan'
                )}
              </button>
            </div>

            {sprintError && (
              <p className="text-xs font-medium text-red-700" role="alert">
                {sprintError}
              </p>
            )}
          </form>

          {sprint ? (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-4">
                <p className="text-sm text-slate-700 leading-relaxed">{sprint.focusMessage}</p>
                <span className="text-xs font-mono text-slate-500 tabular-nums whitespace-nowrap shrink-0">
                  {sprint.hoursAvailable}h plan
                </span>
              </div>

              <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
                {sprint.steps.map((step) => (
                  <div
                    key={step.order}
                    className={`p-4 flex items-start gap-3 transition-colors ${
                      step.completed ? 'bg-slate-50/70' : 'bg-white'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onToggleSprintStep(step.order, step.taskId)}
                      aria-label={`Mark step ${step.order} complete`}
                      className={`mt-0.5 w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-colors ${
                        step.completed
                          ? 'bg-emerald-700 border-emerald-700 text-white'
                          : 'border-slate-300 hover:border-blue-600 bg-white'
                      }`}
                    >
                      {step.completed && <CheckCircle2 className="w-3.5 h-3.5" />}
                    </button>

                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p
                          className={`text-sm font-medium ${
                            step.completed ? 'line-through text-slate-400' : 'text-slate-900'
                          }`}
                        >
                          {String(step.order).padStart(2, '0')}. {step.title}
                        </p>
                        <span className="text-xs font-mono text-slate-500 tabular-nums whitespace-nowrap">
                          {step.courseCode} · {step.durationMinutes} min
                        </span>
                      </div>
                      <p className="text-xs text-slate-600">{step.reason}</p>
                      <p className="text-xs text-slate-500">Tip: {step.strategyTip}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="py-6 text-center space-y-2">
              <Clock className="w-6 h-6 text-slate-400 mx-auto" />
              <p className="text-sm font-medium text-slate-700">No sprint generated yet</p>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Choose your available hours above and click Build Sprint Plan to turn your backlog
                into small, manageable blocks.
              </p>
            </div>
          )}
        </div>

        {/* Courses & Workspace Controls */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Your AI Courses</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Used to automatically organize uploaded files and emails
              </p>
            </div>
            <button
              type="button"
              onClick={onOpenAddModal}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 border border-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Course / Task
            </button>
          </div>

          {courses.length === 0 ? (
            <div className="py-8 text-center space-y-3 border-t border-slate-200">
              <BookOpen className="w-6 h-6 text-slate-400 mx-auto" />
              <p className="text-sm text-slate-600">No courses added yet.</p>
              <button
                type="button"
                disabled={busyReset}
                onClick={async () => {
                  setBusyReset(true);
                  try {
                    await onResetStarter();
                  } finally {
                    setBusyReset(false);
                  }
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Load AI Associate Degree Starter Courses
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-200 border-t border-slate-200">
              {courses.map((course) => {
                const openForCourse = tasks.filter(
                  (t) => t.courseCode === course.code && t.status !== 'Completed',
                ).length;
                return (
                  <div
                    key={course.id}
                    className="py-3.5 flex items-start justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <span className="font-mono font-medium text-slate-700">
                          {course.code}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="truncate">{course.lecturer}</span>
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">{openForCourse} open</span>
                      </div>
                      <p className="text-sm font-medium text-slate-900 mt-0.5 truncate">
                        {course.title}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onDeleteCourse(course.id)}
                      aria-label={`Remove ${course.code}`}
                      className="p-1.5 text-slate-400 hover:text-red-700 hover:bg-slate-100 rounded-md transition-colors shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              disabled={busyReset}
              onClick={async () => {
                setBusyReset(true);
                try {
                  await onResetStarter();
                } finally {
                  setBusyReset(false);
                }
              }}
              className="text-xs font-medium text-slate-600 hover:text-slate-900 inline-flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Add Starter AI Modules
            </button>

            {!confirmClear ? (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                className="text-xs font-medium text-slate-500 hover:text-red-700"
              >
                Clear All Workspace Data
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={busyReset}
                  onClick={async () => {
                    setBusyReset(true);
                    try {
                      await onClearAll();
                      setConfirmClear(false);
                    } finally {
                      setBusyReset(false);
                    }
                  }}
                  className="px-2.5 py-1 text-xs font-medium text-white bg-red-700 hover:bg-red-800 rounded-md"
                >
                  Confirm Clear
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-md"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
