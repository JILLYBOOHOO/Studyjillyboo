import { useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  Calendar,
  CheckCircle2,
  ExternalLink,
  FilePlus2,
  FileText,
  Loader2,
  Mail,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import type {
  CalendarEventItem,
  CatchUpSprint,
  ClassworkItem,
  Course,
  EmailMessageSummary,
  GoogleDocContent,
  GoogleDocSummary,
  LectureAnalysis,
  ModuleGuide,
  ProgressReport,
} from '../types';
import { ConfirmActionModal } from './ConfirmActionModal';
import { EmailView } from './EmailView';
import { GoogleSignInButton } from './GoogleSignInButton';

export type WorkspaceSubTab = 'gmail' | 'calendar' | 'docs';

interface WorkspaceViewProps {
  subTab: WorkspaceSubTab;
  onChangeSubTab: (tab: WorkspaceSubTab) => void;
  userEmail: string | null;
  googleToken: string | null;
  courses: Course[];
  tasks: ClassworkItem[];
  lectures: LectureAnalysis[];
  modules: ModuleGuide[];
  sprint: CatchUpSprint | null;
  progressReport: ProgressReport | null;
  emails: EmailMessageSummary[];
  selectedEmailId: string | null;
  onEmailsChange: (emails: EmailMessageSummary[]) => void;
  onSelectEmail: (emailId: string | null) => void;
  onConnectGoogle: () => Promise<string | null>;
  onTokenExpired: () => void;
  onAddTask: (task: Omit<ClassworkItem, 'id' | 'createdAt'>) => Promise<void>;
  onSaveModuleFromDoc: (guide: Omit<ModuleGuide, 'id' | 'createdAt'>) => Promise<string>;
  onOpenLibraryModule: (moduleId: string) => void;
}

interface PendingConfirmState {
  title: string;
  description: string;
  itemsPreview?: string[];
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  action: () => Promise<void>;
}

function formatEventTimeRange(ev: CalendarEventItem): string {
  if (!ev.start) return 'Time TBD';
  if (ev.isAllDay) return ev.start;
  try {
    const startDate = new Date(ev.start);
    const endDate = ev.end ? new Date(ev.end) : null;
    const datePart = startDate.toLocaleDateString('en-JM', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    const startTime = startDate.toLocaleTimeString('en-JM', {
      hour: 'numeric',
      minute: '2-digit',
    });
    const endTime = endDate
      ? endDate.toLocaleTimeString('en-JM', { hour: 'numeric', minute: '2-digit' })
      : '';
    return endTime ? `${datePart} · ${startTime} – ${endTime}` : `${datePart} · ${startTime}`;
  } catch {
    return ev.start;
  }
}

export function WorkspaceView({
  subTab,
  onChangeSubTab,
  userEmail,
  googleToken,
  courses,
  tasks,
  lectures,
  modules,
  sprint,
  progressReport,
  emails,
  selectedEmailId,
  onEmailsChange,
  onSelectEmail,
  onConnectGoogle,
  onTokenExpired,
  onAddTask,
  onSaveModuleFromDoc,
  onOpenLibraryModule,
}: WorkspaceViewProps) {
  const [connecting, setConnecting] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [workspaceNotice, setWorkspaceNotice] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirmState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  // Google Calendar state
  const [events, setEvents] = useState<CalendarEventItem[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [selectedTaskIdForCal, setSelectedTaskIdForCal] = useState('');
  const [customTitle, setCustomTitle] = useState('');
  const [customDate, setCustomDate] = useState('2026-11-30');
  const [customStartTime, setCustomStartTime] = useState('16:00');
  const [customDurationMins, setCustomDurationMins] = useState(60);
  const [customNotes, setCustomNotes] = useState('');

  // Google Docs state
  const [docsList, setDocsList] = useState<GoogleDocSummary[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [docSearch, setDocSearch] = useState('');
  const [selectedDoc, setSelectedDoc] = useState<GoogleDocContent | null>(null);
  const [loadingDocBody, setLoadingDocBody] = useState(false);
  const [importingDoc, setImportingDoc] = useState(false);
  const [newDocTitle, setNewDocTitle] = useState('StudyTrack AI — Revision & Catch-Up Summary');
  const [exportSourceId, setExportSourceId] = useState('sprint_or_progress');

  const handleAuthorize = async () => {
    setWorkspaceError(null);
    setConnecting(true);
    try {
      const token = await onConnectGoogle();
      if (token) {
        if (subTab === 'calendar') await fetchCalendarEvents(token);
        if (subTab === 'docs') await fetchGoogleDocs(token);
      }
    } catch (err) {
      setWorkspaceError(
        err instanceof Error ? err.message : 'Google Workspace sign-in was cancelled or failed.',
      );
    } finally {
      setConnecting(false);
    }
  };

  const fetchCalendarEvents = async (tokenOverride?: string | null) => {
    const token = tokenOverride ?? googleToken;
    if (!token) return;
    setWorkspaceError(null);
    setLoadingEvents(true);
    try {
      const timeMin = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      const timeMax = new Date('2026-12-20T23:59:59-05:00').toISOString();
      const resp = await fetch(
        `/api/calendar/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (resp.status === 401 || resp.status === 403) {
        onTokenExpired();
        throw new Error(
          'Google Calendar access needs authorization. Click Sign in with Google to grant Calendar access.',
        );
      }
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Could not load Google Calendar events.');
      setEvents(Array.isArray(data.events) ? data.events : []);
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : 'Failed to load Calendar.');
    } finally {
      setLoadingEvents(false);
    }
  };

  const handleScheduleCustomOrTask = (e: React.FormEvent) => {
    e.preventDefault();
    const openTask = tasks.find((t) => t.id === selectedTaskIdForCal);
    const summary = customTitle.trim() || (openTask ? `[${openTask.courseCode}] ${openTask.title}` : '');
    if (!summary) {
      setWorkspaceError('Pick an open task or enter an event title.');
      return;
    }

    const startHour = Number(customStartTime.split(':')[0] || 16);
    const startMin = Number(customStartTime.split(':')[1] || 0);
    const totalEndMins = startHour * 60 + startMin + Math.max(15, customDurationMins);
    const endHour = Math.min(23, Math.floor(totalEndMins / 60));
    const endMin = totalEndMins % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    const startIso = `${customDate}T${pad(startHour)}:${pad(startMin)}:00-05:00`;
    const endIso = `${customDate}T${pad(endHour)}:${pad(endMin)}:00-05:00`;

    setPendingConfirm({
      title: 'Create Study Event on Google Calendar?',
      description: `This will add "${summary}" on ${customDate} from ${customStartTime} for ${customDurationMins} minutes (Jamaica time).`,
      itemsPreview: [
        `Title: ${summary}`,
        `When: ${customDate} · ${pad(startHour)}:${pad(startMin)} – ${pad(endHour)}:${pad(endMin)} (UTC-5)`,
        ...(customNotes.trim() || openTask?.notes
          ? [`Notes: ${customNotes.trim() || openTask?.notes}`]
          : []),
      ],
      confirmLabel: 'Create Calendar Event',
      action: async () => {
        if (!googleToken) return;
        const resp = await fetch('/api/calendar/events', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${googleToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            summary,
            description: customNotes.trim() || openTask?.notes || 'Scheduled via StudyTrack AI',
            startDateTime: startIso,
            endDateTime: endIso,
          }),
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'Could not create Calendar event.');
        setCustomTitle('');
        setCustomNotes('');
        setSelectedTaskIdForCal('');
        setWorkspaceNotice(`Created "${summary}" on your Google Calendar.`);
        await fetchCalendarEvents();
      },
    });
  };

  const handleDeleteCalendarEventConfirm = (ev: CalendarEventItem) => {
    setPendingConfirm({
      title: 'Delete Google Calendar Event?',
      description: `Are you sure you want to delete "${ev.summary}" (${formatEventTimeRange(ev)}) from your primary Google Calendar?`,
      confirmLabel: 'Delete Event',
      tone: 'danger',
      action: async () => {
        if (!googleToken) return;
        const resp = await fetch(`/api/calendar/events/${encodeURIComponent(ev.id)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${googleToken}` },
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'Could not delete event.');
        setWorkspaceNotice(`Deleted "${ev.summary}" from Google Calendar.`);
        await fetchCalendarEvents();
      },
    });
  };

  const fetchGoogleDocs = async (tokenOverride?: string | null) => {
    const token = tokenOverride ?? googleToken;
    if (!token) return;
    setWorkspaceError(null);
    setLoadingDocs(true);
    try {
      const url = `/api/docs/list${docSearch.trim() ? `?q=${encodeURIComponent(docSearch.trim())}` : ''}`;
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (resp.status === 401 || resp.status === 403) {
        onTokenExpired();
        throw new Error(
          'Google Docs / Drive access needs authorization. Click Sign in with Google to refresh permissions.',
        );
      }
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Could not list Google Docs.');
      const files: GoogleDocSummary[] = Array.isArray(data.files) ? data.files : [];
      setDocsList(files);
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : 'Failed to list Google Docs.');
    } finally {
      setLoadingDocs(false);
    }
  };

  const handleOpenGoogleDoc = async (docSummary: GoogleDocSummary) => {
    if (!googleToken) return;
    setWorkspaceError(null);
    setLoadingDocBody(true);
    try {
      const resp = await fetch(`/api/docs/${encodeURIComponent(docSummary.id)}`, {
        headers: { Authorization: `Bearer ${googleToken}` },
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Could not open Google Doc.');
      setSelectedDoc(data);
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : 'Failed to read Google Doc.');
    } finally {
      setLoadingDocBody(false);
    }
  };

  const handleImportDocToLibrary = async () => {
    if (!selectedDoc || !selectedDoc.plainText.trim()) {
      setWorkspaceError('This Google Doc appears empty, so there is no study content to analyze.');
      return;
    }
    setWorkspaceError(null);
    setImportingDoc(true);
    try {
      const formData = new FormData();
      formData.append('courseCode', 'AUTO');
      formData.append('courses', JSON.stringify(courses));
      formData.append('title', selectedDoc.title);
      formData.append('moduleText', selectedDoc.plainText);

      const resp = await fetch('/api/analyze/module', {
        method: 'POST',
        body: formData,
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Could not organize Google Doc.');
      const newModuleId = await onSaveModuleFromDoc({
        ...data,
        fileName: `${selectedDoc.title}.gdoc`,
      });
      setWorkspaceNotice(
        `Analyzed "${selectedDoc.title}" and saved it into your Study Library under ${data.courseCode}.`,
      );
      onOpenLibraryModule(newModuleId);
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : 'Failed to import Google Doc.');
    } finally {
      setImportingDoc(false);
    }
  };

  const buildExportContentText = (): { suggestedTitle: string; bodyText: string } => {
    if (exportSourceId === 'sprint_or_progress') {
      const lines: string[] = [
        'STUDYTRACK AI — CATCH-UP & REVISION PLAN',
        'HEART/NSTA Trust · Amber Academy · Associate Degree in AI',
        '',
      ];
      if (progressReport) {
        lines.push('OVERALL PROGRESS SUMMARY:', progressReport.overallStatusSummary, '');
        if (progressReport.prioritizedTopics.length > 0) {
          lines.push('PRIORITIZED CATCH-UP TOPICS:');
          for (const t of progressReport.prioritizedTopics) {
            lines.push(
              `#${t.priorityRank} [${t.courseCode}] ${t.topic} (${t.urgency}, ~${t.estimatedMinutes}m)`,
              `  Why: ${t.whyBehind}`,
              `  Action: ${t.recommendedAction}`,
            );
          }
          lines.push('');
        }
      }
      if (sprint) {
        lines.push(`CURRENT SPRINT (${sprint.hoursAvailable}h):`, sprint.focusMessage);
        for (const s of sprint.steps) {
          lines.push(
            `- [${s.completed ? 'x' : ' '}] ${s.courseCode}: ${s.title} (${s.durationMinutes}m) — ${s.strategyTip}`,
          );
        }
      } else {
        lines.push('OPEN CLASSWORK QUEUE:');
        for (const t of tasks.filter((item) => item.status !== 'Completed')) {
          lines.push(`- [${t.courseCode}] ${t.title} (Due ${t.dueDate}, ~${t.estimatedMinutes}m)`);
        }
      }
      return {
        suggestedTitle: newDocTitle.trim() || 'StudyTrack AI — Catch-Up Plan',
        bodyText: lines.join('\n'),
      };
    }

    const mod = modules.find((m) => m.id === exportSourceId);
    if (mod) {
      const lines = [
        `${mod.courseCode} · ${mod.title}`,
        `Topic Folder: ${mod.moduleTopic}`,
        `Keywords: ${(mod.keywords || []).join(', ')}`,
        '',
        'OVERVIEW:',
        mod.overview,
        '',
        'LEARNING OBJECTIVES:',
        ...(mod.learningObjectives || []).map((o) => `- ${o}`),
        '',
        'TOPIC BREAKDOWN:',
        ...(mod.topicBreakdowns || []).flatMap((tb) => [
          `• ${tb.topic}`,
          `  Plain English: ${tb.plainEnglish}`,
          `  Key Takeaway: ${tb.keyTakeaway}`,
          tb.exampleOrCode ? `  Example:\n${tb.exampleOrCode}` : '',
        ]),
        '',
        mod.difficultyNote ? `COMMON STUMBLING BLOCK:\n${mod.difficultyNote}` : '',
      ];
      return {
        suggestedTitle: newDocTitle.trim() || `${mod.courseCode} Study Guide — ${mod.title}`,
        bodyText: lines.filter(Boolean).join('\n'),
      };
    }

    const lec = lectures.find((l) => l.id === exportSourceId);
    if (lec) {
      const lines = [
        `${lec.courseCode} · ${lec.title} (${lec.lectureDate})`,
        `Module: ${lec.moduleTopic}`,
        '',
        'PLAIN-ENGLISH SUMMARY:',
        lec.plainEnglishSummary,
        '',
        'KEY CONCEPTS:',
        ...(lec.keyConcepts || []).flatMap((c) => [
          `• ${c.term}: ${c.simpleExplanation}`,
          `  Example: ${c.analogyOrExample}`,
        ]),
        '',
        'CHECK QUESTIONS:',
        ...(lec.checkQuestions || []).map((q, i) => `Q${i + 1}: ${q.question}\nA: ${q.answer}`),
      ];
      return {
        suggestedTitle: newDocTitle.trim() || `${lec.courseCode} Lecture Notes — ${lec.title}`,
        bodyText: lines.join('\n'),
      };
    }

    return {
      suggestedTitle: newDocTitle.trim() || 'StudyTrack AI Notes',
      bodyText: 'Generated from StudyTrack AI.',
    };
  };

  const handleCreateGoogleDocConfirm = () => {
    const { suggestedTitle, bodyText } = buildExportContentText();
    setPendingConfirm({
      title: 'Create New Google Doc?',
      description: `This will create a new Google Doc titled "${suggestedTitle}" in your Google Drive and populate it with your study guide.`,
      itemsPreview: bodyText.split('\n').slice(0, 6),
      confirmLabel: 'Create Google Doc',
      action: async () => {
        if (!googleToken) return;
        const resp = await fetch('/api/docs/create', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${googleToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ title: suggestedTitle, content: bodyText }),
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'Could not create Google Doc.');
        setWorkspaceNotice(`Created Google Doc "${data.title}".`);
        await fetchGoogleDocs();
      },
    });
  };

  const handleAppendGoogleDocConfirm = () => {
    if (!selectedDoc) return;
    const { bodyText } = buildExportContentText();
    setPendingConfirm({
      title: `Append Study Notes to "${selectedDoc.title}"?`,
      description: `This will modify your existing Google Doc "${selectedDoc.title}" by appending the selected StudyTrack AI summary to the end of the document.`,
      itemsPreview: bodyText.split('\n').slice(0, 6),
      confirmLabel: 'Append to Document',
      action: async () => {
        if (!googleToken) return;
        const resp = await fetch(`/api/docs/${encodeURIComponent(selectedDoc.documentId)}/append`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${googleToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content: bodyText }),
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'Could not update Google Doc.');
        setWorkspaceNotice(`Appended study notes to "${selectedDoc.title}".`);
        await handleOpenGoogleDoc({
          id: selectedDoc.documentId,
          name: selectedDoc.title,
          modifiedTime: new Date().toISOString(),
        });
      },
    });
  };

  return (
    <div className="space-y-8">
      {/* Workspace Header & Segmented Switcher */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-slate-900">Google Workspace Sync</h1>
          <p className="text-sm text-slate-600">
            Connect Gmail class updates, Google Calendar schedules, and Google Docs study guides in
            one place.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => onChangeSubTab('gmail')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                subTab === 'gmail'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Mail className="w-3.5 h-3.5" />
              Gmail ({emails.length})
            </button>
            <button
              type="button"
              onClick={() => {
                onChangeSubTab('calendar');
                if (googleToken && events.length === 0) void fetchCalendarEvents();
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                subTab === 'calendar'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              Google Calendar
            </button>
            <button
              type="button"
              onClick={() => {
                onChangeSubTab('docs');
                if (googleToken && docsList.length === 0) void fetchGoogleDocs();
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                subTab === 'docs'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              Google Docs
            </button>
          </div>
        </div>
      </div>

      {workspaceError && (
        <div
          className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center justify-between gap-3 text-sm text-red-800"
          role="alert"
        >
          <div className="flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{workspaceError}</span>
          </div>
          <button
            type="button"
            onClick={() => setWorkspaceError(null)}
            className="text-xs font-medium underline shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {workspaceNotice && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center justify-between gap-3 text-sm text-emerald-800">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{workspaceNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setWorkspaceNotice(null)}
            className="text-xs font-medium underline shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {subTab === 'gmail' && (
        <EmailView
          userEmail={userEmail}
          gmailToken={googleToken}
          courses={courses}
          emails={emails}
          selectedEmailId={selectedEmailId}
          onEmailsChange={onEmailsChange}
          onSelectEmail={onSelectEmail}
          onConnectGmail={onConnectGoogle}
          onTokenExpired={onTokenExpired}
          onAddTask={onAddTask}
        />
      )}

      {subTab === 'calendar' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Google Calendar Class &amp; Catch-Up Schedule
              </h2>
              <p className="text-sm text-slate-600">
                Sync your HEART/NSTA Week 17–18 revision timetable and catch-up study blocks to
                Google Calendar.
              </p>
            </div>
            {googleToken ? (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={loadingEvents}
                  onClick={() => fetchCalendarEvents()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg whitespace-nowrap"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingEvents ? 'animate-spin' : ''}`} />
                  Refresh Events
                </button>
              </div>
            ) : (
              <GoogleSignInButton
                label="Authorize Google Calendar"
                loading={connecting}
                onClick={handleAuthorize}
              />
            )}
          </div>

          {!googleToken ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center space-y-4">
              <Calendar className="w-8 h-8 text-slate-400 mx-auto" />
              <div className="space-y-1 max-w-md mx-auto">
                <h3 className="text-base font-semibold text-slate-900">
                  Connect Google Calendar to view and schedule study sessions
                </h3>
                <p className="text-sm text-slate-600">
                  Your Calendar token stays strictly in memory for this session. Any new event or
                  deletion will always ask for your confirmation first.
                </p>
              </div>
              <div className="flex justify-center">
                <GoogleSignInButton
                  label="Connect Google Calendar"
                  loading={connecting}
                  onClick={handleAuthorize}
                />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Upcoming Events List */}
              <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-slate-800">
                    Upcoming Google Calendar Events
                  </h3>
                  <span className="text-xs font-mono text-slate-500 tabular-nums">
                    {events.length} events
                  </span>
                </div>

                {loadingEvents ? (
                  <div className="p-8 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading your Google Calendar...
                  </div>
                ) : events.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-500 space-y-2">
                    <p>No upcoming events loaded yet.</p>
                    <button
                      type="button"
                      onClick={() => fetchCalendarEvents()}
                      className="text-blue-700 font-medium hover:underline"
                    >
                      Load upcoming events
                    </button>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-200 max-h-[520px] overflow-y-auto">
                    {events.map((ev) => (
                      <div key={ev.id} className="p-4 flex items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                          <p className="text-sm font-medium text-slate-900">{ev.summary}</p>
                          <p className="text-xs text-slate-500 tabular-nums">
                            {formatEventTimeRange(ev)}
                            {ev.location ? ` · ${ev.location}` : ''}
                          </p>
                          {ev.description && (
                            <p className="text-xs text-slate-600 line-clamp-2">{ev.description}</p>
                          )}
                          {ev.htmlLink && (
                            <a
                              href={ev.htmlLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline pt-0.5"
                            >
                              <ExternalLink className="w-3 h-3" />
                              Open in Google Calendar
                            </a>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteCalendarEventConfirm(ev)}
                          aria-label={`Delete ${ev.summary}`}
                          className="p-1.5 text-slate-400 hover:text-red-700 hover:bg-slate-100 rounded-md shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Schedule Study Session Form */}
              <form
                onSubmit={handleScheduleCustomOrTask}
                className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4"
              >
                <div>
                  <h3 className="text-base font-semibold text-slate-900">
                    Schedule Study or Catch-Up Block
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Pick an open catch-up task or enter a custom revision block. You will confirm
                    before it saves to Google Calendar.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Quick-Fill from Open Classwork
                  </label>
                  <select
                    value={selectedTaskIdForCal}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSelectedTaskIdForCal(val);
                      const found = tasks.find((t) => t.id === val);
                      if (found) {
                        setCustomTitle(`[${found.courseCode}] ${found.title}`);
                        setCustomDurationMins(found.estimatedMinutes || 60);
                        setCustomNotes(found.notes || '');
                      }
                    }}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 bg-white"
                  >
                    <option value="">Choose an open task (optional)...</option>
                    {tasks
                      .filter((t) => t.status !== 'Completed')
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          [{t.courseCode}] {t.title}
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Event Title
                  </label>
                  <input
                    type="text"
                    value={customTitle}
                    onChange={(e) => setCustomTitle(e.target.value)}
                    placeholder="e.g., AIL1002 Python File Handling Catch-Up"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
                  />
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Date</label>
                    <input
                      type="date"
                      value={customDate}
                      onChange={(e) => setCustomDate(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs text-slate-900 tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Start</label>
                    <input
                      type="time"
                      value={customStartTime}
                      onChange={(e) => setCustomStartTime(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs text-slate-900 tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Minutes
                    </label>
                    <input
                      type="number"
                      min={15}
                      max={240}
                      step={15}
                      value={customDurationMins}
                      onChange={(e) => setCustomDurationMins(Number(e.target.value) || 60)}
                      className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs text-slate-900 tabular-nums"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Notes</label>
                  <textarea
                    rows={2}
                    value={customNotes}
                    onChange={(e) => setCustomNotes(e.target.value)}
                    placeholder="Optional Zoom link or topics to review..."
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors"
                >
                  <Calendar className="w-3.5 h-3.5" />
                  Schedule on Google Calendar
                </button>
              </form>
            </div>
          )}
        </div>
      )}

      {subTab === 'docs' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Google Docs Study Notes &amp; Export
              </h2>
              <p className="text-sm text-slate-600">
                Import your Google Docs into the Study Library or export catch-up guides straight to
                Google Docs.
              </p>
            </div>
            {googleToken ? (
              <button
                type="button"
                disabled={loadingDocs}
                onClick={() => fetchGoogleDocs()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg whitespace-nowrap shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingDocs ? 'animate-spin' : ''}`} />
                Refresh Google Docs
              </button>
            ) : (
              <GoogleSignInButton
                label="Authorize Google Docs"
                loading={connecting}
                onClick={handleAuthorize}
              />
            )}
          </div>

          {!googleToken ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center space-y-4">
              <FileText className="w-8 h-8 text-slate-400 mx-auto" />
              <div className="space-y-1 max-w-md mx-auto">
                <h3 className="text-base font-semibold text-slate-900">
                  Connect Google Docs to read notes or save catch-up guides
                </h3>
                <p className="text-sm text-slate-600">
                  Creating or editing any Google Doc always asks for your explicit confirmation
                  first.
                </p>
              </div>
              <div className="flex justify-center">
                <GoogleSignInButton
                  label="Connect Google Docs"
                  loading={connecting}
                  onClick={handleAuthorize}
                />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left: Search & List Docs + Export Box */}
              <div className="lg:col-span-5 space-y-6">
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="p-3 border-b border-slate-200 bg-slate-50">
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        fetchGoogleDocs();
                      }}
                      className="flex gap-2"
                    >
                      <div className="relative flex-1">
                        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          value={docSearch}
                          onChange={(e) => setDocSearch(e.target.value)}
                          placeholder="Search Google Docs by title..."
                          className="w-full pl-8 pr-2.5 py-1.5 text-xs rounded-md border border-slate-300 bg-white"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={loadingDocs}
                        className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-md"
                      >
                        Find
                      </button>
                    </form>
                  </div>

                  {loadingDocs ? (
                    <div className="p-6 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Loading Google Docs...
                    </div>
                  ) : docsList.length === 0 ? (
                    <div className="p-6 text-center text-xs text-slate-500 space-y-2">
                      <p>No Google Docs loaded yet.</p>
                      <button
                        type="button"
                        onClick={() => fetchGoogleDocs()}
                        className="text-blue-700 font-medium hover:underline"
                      >
                        Load recent Google Docs
                      </button>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-200 max-h-80 overflow-y-auto">
                      {docsList.map((d) => {
                        const active = selectedDoc?.documentId === d.id;
                        return (
                          <button
                            key={d.id}
                            type="button"
                            onClick={() => handleOpenGoogleDoc(d)}
                            className={`w-full text-left p-3.5 transition-colors ${
                              active ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                            }`}
                          >
                            <p className="text-sm font-medium text-slate-900 truncate">{d.name}</p>
                            <p className="text-xs text-slate-500 tabular-nums mt-0.5">
                              Modified{' '}
                              {d.modifiedTime
                                ? new Date(d.modifiedTime).toLocaleDateString('en-JM')
                                : 'Recently'}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Export to Google Docs Panel */}
                <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
                  <div className="flex items-center gap-2">
                    <FilePlus2 className="w-4 h-4 text-blue-700" />
                    <h3 className="text-sm font-semibold text-slate-900">
                      Export Study Guide to Google Docs
                    </h3>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      What to Export
                    </label>
                    <select
                      value={exportSourceId}
                      onChange={(e) => setExportSourceId(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 bg-white"
                    >
                      <option value="sprint_or_progress">
                        Current Progress Report &amp; Catch-Up Plan
                      </option>
                      {modules.map((m) => (
                        <option key={m.id} value={m.id}>
                          Module: [{m.courseCode}] {m.title}
                        </option>
                      ))}
                      {lectures.map((l) => (
                        <option key={l.id} value={l.id}>
                          Lecture: [{l.courseCode}] {l.title}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      New Google Doc Title
                    </label>
                    <input
                      type="text"
                      value={newDocTitle}
                      onChange={(e) => setNewDocTitle(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900"
                    />
                  </div>

                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      onClick={handleCreateGoogleDocConfirm}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg whitespace-nowrap"
                    >
                      Create New Doc
                    </button>
                    {selectedDoc && (
                      <button
                        type="button"
                        onClick={handleAppendGoogleDocConfirm}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg whitespace-nowrap"
                      >
                        Append to Selected Doc
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Right: Selected Google Doc Inspector + Import to Library */}
              <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
                {loadingDocBody ? (
                  <div className="py-12 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Reading document from Google Docs...
                  </div>
                ) : !selectedDoc ? (
                  <div className="py-12 text-center text-sm text-slate-500 space-y-1">
                    <p className="font-medium text-slate-700">Select a Google Doc on the left</p>
                    <p className="text-xs text-slate-500">
                      Preview its text, import it directly into your auto-tagged Study Library, or
                      append study notes to it.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-slate-200">
                      <div className="min-w-0 space-y-1">
                        <h3 className="text-lg font-semibold text-slate-900">{selectedDoc.title}</h3>
                        {selectedDoc.webViewLink && (
                          <a
                            href={selectedDoc.webViewLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline"
                          >
                            <ExternalLink className="w-3 h-3" />
                            Open in Google Docs
                          </a>
                        )}
                      </div>

                      <button
                        type="button"
                        disabled={importingDoc || !selectedDoc.plainText.trim()}
                        onClick={handleImportDocToLibrary}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg whitespace-nowrap shrink-0"
                      >
                        {importingDoc ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Organizing into Library...
                          </>
                        ) : (
                          <>
                            <BookOpen className="w-3.5 h-3.5" />
                            Import &amp; Analyze into Study Library
                          </>
                        )}
                      </button>
                    </div>

                    <div className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed max-h-[460px] overflow-y-auto bg-slate-50 border border-slate-200 rounded-lg p-4">
                      {selectedDoc.plainText || '(This Google Doc has no text yet.)'}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <ConfirmActionModal
        isOpen={Boolean(pendingConfirm)}
        title={pendingConfirm?.title || ''}
        description={pendingConfirm?.description || ''}
        itemsPreview={pendingConfirm?.itemsPreview}
        confirmLabel={pendingConfirm?.confirmLabel || 'Confirm'}
        tone={pendingConfirm?.tone}
        busy={confirmBusy}
        onCancel={() => {
          if (!confirmBusy) setPendingConfirm(null);
        }}
        onConfirm={async () => {
          if (!pendingConfirm) return;
          setConfirmBusy(true);
          setWorkspaceError(null);
          try {
            await pendingConfirm.action();
            setPendingConfirm(null);
          } catch (err) {
            setWorkspaceError(
              err instanceof Error ? err.message : 'Google Workspace action failed.',
            );
            setPendingConfirm(null);
          } finally {
            setConfirmBusy(false);
          }
        }}
      />
    </div>
  );
}
