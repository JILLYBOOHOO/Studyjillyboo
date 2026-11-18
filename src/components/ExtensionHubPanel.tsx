import { useEffect, useState } from 'react';
import {
  Bell,
  BookOpen,
  CalendarPlus,
  Check,
  Clipboard,
  Code2,
  Download,
  ExternalLink,
  FileText,
  Layers,
  Loader2,
  Mail,
  Plus,
  Puzzle,
} from 'lucide-react';
import type {
  ClassworkItem,
  Course,
  SmartClipActionOption,
  SmartClipAnalysis,
  SmartNoteCard,
} from '../types';

interface ExtensionHubPanelProps {
  courses: Course[];
  latestExtensionClip: SmartClipAnalysis | null;
  onClearExtensionClip: () => void;
  onSaveNote: (note: Omit<SmartNoteCard, 'id' | 'createdAt'>) => Promise<string>;
  onAddTask: (task: Omit<ClassworkItem, 'id' | 'createdAt'>) => Promise<void>;
  onOpenSmartNotebook: () => void;
  onStartCoachWithTopic: (courseCode: string, topicFocus: string) => void;
}

const SAMPLE_CLIPS = [
  {
    id: 'date',
    label: 'Sample Deadline Date',
    text: 'AIL1002 Reminder: Python Pandas & CSV Lab 4 is due Friday, November 21, 2026 at 5:00 PM on the student portal.',
  },
  {
    id: 'email',
    label: 'Sample Letter / Email',
    text: 'Dear B.M. Rajesh,\n\nI am writing to confirm whether I can submit the revised AIL1002 Python CSV Lab before Thursday evening following our revision session.\n\nThank you,\nStudent',
  },
  {
    id: 'definition',
    label: 'Sample Definition',
    text: 'Backpropagation: A supervised learning algorithm used to train artificial neural networks by computing the gradient of the loss function with respect to each weight using the chain rule, updating weights backwards from output to input.',
  },
  {
    id: 'code',
    label: 'Sample Python Code',
    text: 'import pandas as pd\ndf = pd.read_csv("grades.csv")\nclean_df = df.dropna(subset=["score"])\nprint(clean_df.groupby("course")["score"].mean())',
  },
];

function buildGmailComposeUrl(to: string, subject: string, body: string): string {
  const params = new URLSearchParams();
  params.set('view', 'cm');
  params.set('fs', '1');
  if (to) params.set('to', to);
  if (subject) params.set('su', subject);
  if (body) params.set('body', body);
  return `https://mail.google.com/mail/?${params.toString()}`;
}

function buildGoogleCalendarUrl(title: string, details: string, isoDateStr: string): string {
  const params = new URLSearchParams();
  params.set('action', 'TEMPLATE');
  params.set('text', title || 'Study Reminder');
  if (details) params.set('details', details);
  const compact = isoDateStr.replace(/[-:]/g, '');
  if (compact.length >= 13) {
    const start = compact.slice(0, 13) + '00';
    params.set('dates', `${start}/${start}`);
  }
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function ExtensionHubPanel({
  courses,
  latestExtensionClip,
  onClearExtensionClip,
  onSaveNote,
  onAddTask,
  onOpenSmartNotebook,
  onStartCoachWithTopic,
}: ExtensionHubPanelProps) {
  const [appUrl, setAppUrl] = useState(() =>
    typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000',
  );
  const [clipText, setClipText] = useState('');
  const [courseChoice, setCourseChoice] = useState('AUTO');
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<SmartClipAnalysis | null>(latestExtensionClip);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [savingActionId, setSavingActionId] = useState<string | null>(null);

  useEffect(() => {
    if (latestExtensionClip) {
      setAnalysis(latestExtensionClip);
      setActionStatus('Received live capture from Chrome Extension & auto-saved to Smart Notebook.');
    }
  }, [latestExtensionClip]);

  const downloadHref = `/api/extension/download.zip?origin=${encodeURIComponent(appUrl.trim() || window.location.origin)}`;

  const analyzeClipText = async (textOverride?: string) => {
    const targetText = (textOverride ?? clipText).trim();
    if (!targetText || analyzing) return;
    setError(null);
    setActionStatus(null);
    setAnalyzing(true);
    try {
      const resp = await fetch('/api/clip/smart-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: targetText,
          courseCode: courseChoice,
          courses,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Could not detect smart actions.');
      setAnalysis(data);
      onClearExtensionClip();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Smart action analysis failed.');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleReadClipboard = async () => {
    setError(null);
    try {
      const txt = await navigator.clipboard.readText();
      if (!txt || !txt.trim()) {
        setError('Clipboard is empty. Copy a date, email, definition, or code snippet first.');
        return;
      }
      setClipText(txt);
      await analyzeClipText(txt);
    } catch {
      setError('Browser blocked automatic clipboard read. Paste (Ctrl+V / Cmd+V) into the box below instead.');
    }
  };

  const handleRunSmartAction = async (opt: SmartClipActionOption) => {
    if (!analysis || savingActionId) return;
    setSavingActionId(opt.actionId);
    setError(null);
    try {
      if (opt.actionId === 'set_reminder') {
        await onSaveNote({
          ...analysis.smartCard,
          cardType: 'note',
          colorTag: 'amber',
          pinned: true,
          title: analysis.reminderTitle || analysis.smartCard.title,
          reminderAt:
            analysis.detectedDateIso ||
            analysis.smartCard.reminderAt ||
            new Date(Date.now() + 3600000).toISOString().slice(0, 16),
        });
        setActionStatus('Reminder pinned to Smart Notebook.');
      } else if (opt.actionId === 'add_classwork') {
        const matched = courses.find((c) => c.code === analysis.smartCard.courseCode);
        await onAddTask({
          courseCode: analysis.smartCard.courseCode,
          courseTitle: matched?.title || analysis.smartCard.courseCode,
          title: analysis.reminderTitle || analysis.smartCard.title,
          type: 'Assignment',
          status: 'Urgent Catch-Up',
          dueDate: analysis.detectedDateIso ? analysis.detectedDateIso.slice(0, 10) : 'TBD',
          estimatedMinutes: 45,
          source: 'Smart Note',
          notes: analysis.extractedText.slice(0, 1800),
        });
        setActionStatus('Added to Classwork tracker.');
      } else if (opt.actionId === 'save_template') {
        await onSaveNote({
          ...analysis.smartCard,
          cardType: 'template',
          colorTag: 'blue',
          title: analysis.emailSubject || analysis.smartCard.title || 'Saved Email Template',
          emailSubject: analysis.emailSubject || analysis.smartCard.title,
          content: analysis.emailBody || analysis.extractedText,
        });
        setActionStatus('Saved as reusable Email Template in Smart Notebook.');
      } else if (opt.actionId === 'save_flashcard') {
        await onSaveNote({
          ...analysis.smartCard,
          cardType: 'flashcard',
          colorTag: 'emerald',
          title: analysis.flashcardFront || analysis.smartCard.title,
          content: analysis.flashcardBack || analysis.extractedText,
          flashcardHint: analysis.flashcardHint || '',
        });
        setActionStatus('Saved as interactive flip Flashcard in Smart Notebook.');
      } else if (opt.actionId === 'practice_coach') {
        onStartCoachWithTopic(
          analysis.smartCard.courseCode,
          analysis.flashcardFront || analysis.smartCard.title,
        );
      } else if (
        opt.actionId === 'save_code' ||
        opt.actionId === 'save_checklist' ||
        opt.actionId === 'save_note'
      ) {
        await onSaveNote(analysis.smartCard);
        setActionStatus('Saved card to Smart Notebook.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not complete smart action.');
    } finally {
      setSavingActionId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Real Downloadable MV3 Chrome Extension */}
        <section className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                <Puzzle className="w-5 h-5 text-blue-700 shrink-0" />
                Chrome Extension for Your Computer
              </h2>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                Install the Manifest V3 StudyTrack AI Chrome Extension to capture screenshots from
                any portal tab, auto-save to your notebook, and get instant smart actions from
                copied text.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-medium text-slate-700" htmlFor="ext-origin-input">
              Connected StudyTrack AI App URL
            </label>
            <input
              id="ext-origin-input"
              type="url"
              value={appUrl}
              onChange={(e) => setAppUrl(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            />
            <p className="text-[11px] text-slate-500">
              Pre-filled with your current workspace URL. You can also switch it inside the
              extension popup anytime.
            </p>
          </div>

          <a
            href={downloadHref}
            download="studytrack-ai-chrome-extension.zip"
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap"
          >
            <Download className="w-4 h-4" />
            Download Chrome Extension (.zip)
          </a>

          <div className="pt-4 border-t border-slate-200 space-y-3">
            <h3 className="text-xs font-semibold text-slate-900">
              How to Add to Google Chrome (Takes 30 Seconds)
            </h3>
            <ol className="space-y-2 text-xs text-slate-600 list-decimal pl-4 leading-relaxed">
              <li>
                Unzip <span className="font-mono text-slate-800">studytrack-ai-chrome-extension.zip</span>{' '}
                into a folder on your computer.
              </li>
              <li>
                Open Chrome and type{' '}
                <span className="font-mono text-slate-800">chrome://extensions</span> in the address
                bar.
              </li>
              <li>
                Turn ON <span className="font-semibold text-slate-800">Developer mode</span> in the
                top-right corner.
              </li>
              <li>
                Click <span className="font-semibold text-slate-800">Load unpacked</span> and pick
                the unzipped folder. Pin the icon to your toolbar.
              </li>
            </ol>
          </div>

          <div className="pt-4 border-t border-slate-200 space-y-2 text-xs text-slate-600">
            <p className="font-semibold text-slate-900">Included Computer Shortcuts &amp; Menus</p>
            <p>
              <span className="font-mono text-slate-800">Alt + Shift + S</span> · Instant tab
              screenshot OCR + auto-save to Smart Notebook.
            </p>
            <p>
              <span className="font-medium text-slate-800">Right-click any page</span> · Screenshot
              &amp; Auto-Save to StudyTrack AI.
            </p>
            <p>
              <span className="font-medium text-slate-800">Right-click highlighted text</span> ·
              Detect Smart Action (Reminder, Email/Template, Flashcard, or Code Card).
            </p>
          </div>
        </section>

        {/* Right: Smart Clipboard & Action Simulator / Live Extension Feed */}
        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Smart Clipboard &amp; Screenshot Actions
              </h2>
              <p className="text-xs text-slate-600 mt-0.5">
                Copy a date to set a reminder, copy a letter to email or save as a template, copy a
                definition to save as a flashcard, or copy code for a formatted snippet.
              </p>
            </div>
            <button
              type="button"
              onClick={onOpenSmartNotebook}
              className="px-3 py-1.5 text-xs font-medium text-blue-700 border border-slate-300 hover:bg-blue-50 rounded-lg whitespace-nowrap shrink-0"
            >
              Open Smart Notebook
            </button>
          </div>

          {/* Quick Sample Triggers */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-500">Try a sample:</span>
            {SAMPLE_CLIPS.map((sample) => (
              <button
                key={sample.id}
                type="button"
                onClick={() => {
                  setClipText(sample.text);
                  void analyzeClipText(sample.text);
                }}
                className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0"
              >
                {sample.label}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={courseChoice}
                onChange={(e) => setCourseChoice(e.target.value)}
                aria-label="Course override"
                className="rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              >
                <option value="AUTO">Auto-detect course</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.code}>
                    {c.code} · {c.title}
                  </option>
                ))}
              </select>

              <button
                type="button"
                disabled={analyzing}
                onClick={() => void handleReadClipboard()}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 disabled:opacity-50 rounded-lg whitespace-nowrap shrink-0"
              >
                <Clipboard className="w-3.5 h-3.5" />
                Paste From Clipboard
              </button>
            </div>

            <textarea
              rows={4}
              value={clipText}
              onChange={(e) => setClipText(e.target.value)}
              placeholder="Paste any copied due date, professor letter, vocabulary definition, or code snippet..."
              className="w-full rounded-lg border border-slate-300 p-3 text-xs font-mono text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            />

            <div className="flex justify-end">
              <button
                type="button"
                disabled={!clipText.trim() || analyzing}
                onClick={() => void analyzeClipText()}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
              >
                {analyzing ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Detecting Smart Actions...
                  </>
                ) : (
                  'Detect Smart Actions'
                )}
              </button>
            </div>
          </div>

          {error && (
            <p className="text-xs font-medium text-red-700" role="alert">
              {error}
            </p>
          )}

          {actionStatus && (
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-800 flex items-center gap-2">
              <Check className="w-4 h-4 shrink-0" />
              <span>{actionStatus}</span>
            </div>
          )}

          {analysis && (
            <div className="pt-4 border-t border-slate-200 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-mono font-semibold text-blue-800">
                    {analysis.smartCard.courseCode} · {analysis.intent.replace('_', ' ')}
                  </p>
                  <h3 className="text-base font-semibold text-slate-900 mt-0.5">
                    {analysis.smartCard.title}
                  </h3>
                  <p className="text-xs text-slate-600 mt-0.5">{analysis.intentSummary}</p>
                </div>
              </div>

              {/* Intent-Specific Preview */}
              {analysis.intent === 'date_reminder' && analysis.detectedDateIso && (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-center gap-2 tabular-nums">
                  <Bell className="w-4 h-4 shrink-0 text-amber-700" />
                  <span>
                    Detected Date/Time:{' '}
                    <span className="font-semibold">
                      {Number.isNaN(Date.parse(analysis.detectedDateIso))
                        ? analysis.detectedDateIso
                        : new Date(analysis.detectedDateIso).toLocaleString()}
                    </span>
                  </span>
                </div>
              )}

              {analysis.intent === 'email_letter' && (
                <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-1.5 text-xs">
                  <p className="text-slate-700">
                    <span className="font-semibold">Subject:</span>{' '}
                    {analysis.emailSubject || analysis.smartCard.title}
                  </p>
                  <p className="text-slate-600 whitespace-pre-wrap leading-relaxed">
                    {analysis.emailBody || analysis.extractedText}
                  </p>
                </div>
              )}

              {analysis.intent === 'definition_flashcard' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                    <p className="font-semibold text-slate-500">Flashcard Front</p>
                    <p className="text-sm font-semibold text-slate-900 mt-1">
                      {analysis.flashcardFront}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-emerald-50/60 border border-emerald-200">
                    <p className="font-semibold text-emerald-800">Flashcard Back</p>
                    <p className="text-slate-800 mt-1 leading-relaxed">
                      {analysis.flashcardBack}
                    </p>
                  </div>
                </div>
              )}

              {/* Smart Action Buttons */}
              <div className="flex flex-wrap gap-2">
                {analysis.recommendedActions.map((opt) => {
                  if (opt.actionId === 'send_email') {
                    return (
                      <a
                        key={opt.actionId}
                        href={buildGmailComposeUrl(
                          analysis.emailTo,
                          analysis.emailSubject || analysis.smartCard.title,
                          analysis.emailBody || analysis.extractedText,
                        )}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg whitespace-nowrap shrink-0"
                      >
                        <Mail className="w-3.5 h-3.5" />
                        {opt.label}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    );
                  }

                  if (opt.actionId === 'open_calendar') {
                    return (
                      <a
                        key={opt.actionId}
                        href={buildGoogleCalendarUrl(
                          analysis.reminderTitle || analysis.smartCard.title,
                          analysis.extractedText,
                          analysis.detectedDateIso,
                        )}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg whitespace-nowrap shrink-0"
                      >
                        <CalendarPlus className="w-3.5 h-3.5 text-blue-700" />
                        {opt.label}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    );
                  }

                  const IconComp =
                    opt.actionId === 'set_reminder'
                      ? Bell
                      : opt.actionId === 'save_flashcard'
                        ? Layers
                        : opt.actionId === 'save_code'
                          ? Code2
                          : opt.actionId === 'practice_coach'
                            ? BookOpen
                            : opt.actionId === 'add_classwork'
                              ? Plus
                              : FileText;

                  return (
                    <button
                      key={opt.actionId}
                      type="button"
                      disabled={savingActionId === opt.actionId}
                      onClick={() => void handleRunSmartAction(opt)}
                      title={opt.description}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 rounded-lg whitespace-nowrap shrink-0"
                    >
                      {savingActionId === opt.actionId ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <IconComp className="w-3.5 h-3.5 text-blue-700" />
                      )}
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
