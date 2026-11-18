import { useState } from 'react';
import {
  AlertCircle,
  Check,
  ExternalLink,
  Loader2,
  Mail,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { GoogleSignInButton } from './GoogleSignInButton';
import type {
  ClassworkItem,
  Course,
  EmailMessageSummary,
  ExtractedEmailWork,
} from '../types';

interface EmailViewProps {
  userEmail: string | null;
  gmailToken: string | null;
  courses: Course[];
  emails: EmailMessageSummary[];
  selectedEmailId: string | null;
  onEmailsChange: (emails: EmailMessageSummary[]) => void;
  onSelectEmail: (emailId: string | null) => void;
  onConnectGmail: () => Promise<string | null>;
  onTokenExpired: () => void;
  onAddTask: (task: Omit<ClassworkItem, 'id' | 'createdAt'>) => Promise<void>;
}

export const DEFAULT_CLASS_QUERY =
  'assignment OR homework OR zoom OR lecture OR module OR deadline OR quiz OR lab OR syllabus OR class';

export function EmailView({
  userEmail,
  gmailToken,
  courses,
  emails,
  selectedEmailId,
  onEmailsChange,
  onSelectEmail,
  onConnectGmail,
  onTokenExpired,
  onAddTask,
}: EmailViewProps) {
  const [filterMode, setFilterMode] = useState<'class' | 'all'>('class');
  const [customSearch, setCustomSearch] = useState('');
  const [loadingInbox, setLoadingInbox] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [extracting, setExtracting] = useState(false);
  const [extractedByEmailId, setExtractedByEmailId] = useState<
    Record<string, ExtractedEmailWork>
  >({});

  // Manual / WhatsApp / Portal paste fallback
  const [pasteText, setPasteText] = useState('');
  const [pasteExtracting, setPasteExtracting] = useState(false);
  const [pasteExtracted, setPasteExtracted] = useState<ExtractedEmailWork | null>(null);

  const selectedEmail = emails.find((m) => m.id === selectedEmailId) || null;
  const activeExtraction = selectedEmail ? extractedByEmailId[selectedEmail.id] : null;

  const fetchMessages = async (tokenOverride?: string | null, modeOverride?: 'class' | 'all') => {
    const activeToken = tokenOverride ?? gmailToken;
    if (!activeToken) return;

    setError(null);
    setLoadingInbox(true);
    try {
      const mode = modeOverride ?? filterMode;
      const q = customSearch.trim() || (mode === 'class' ? DEFAULT_CLASS_QUERY : '');
      const url = `/api/gmail/messages${q ? `?q=${encodeURIComponent(q)}` : ''}`;
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${activeToken}` },
      });

      if (resp.status === 401 || resp.status === 403) {
        onTokenExpired();
        throw new Error('Your Gmail session expired. Click Sign in with Google to refresh access.');
      }

      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || 'Could not load Gmail messages.');
      }

      const list: EmailMessageSummary[] = Array.isArray(data.messages) ? data.messages : [];
      onEmailsChange(list);
      if (list.length > 0 && !list.some((m) => m.id === selectedEmailId)) {
        onSelectEmail(list[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync Gmail.');
    } finally {
      setLoadingInbox(false);
    }
  };

  const handleConnect = async () => {
    setError(null);
    setConnecting(true);
    try {
      const token = await onConnectGmail();
      if (token) {
        await fetchMessages(token);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in was cancelled or failed.');
    } finally {
      setConnecting(false);
    }
  };

  const handleExtractEmail = async (email: EmailMessageSummary) => {
    setError(null);
    setExtracting(true);
    try {
      const resp = await fetch('/api/gmail/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: email.subject,
          from: email.from,
          date: email.date,
          bodyText: email.bodyText || email.snippet,
          courses,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Could not analyze email.');
      setExtractedByEmailId((prev) => ({ ...prev, [email.id]: data }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to extract classwork from email.');
    } finally {
      setExtracting(false);
    }
  };

  const handleExtractPaste = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pasteText.trim()) return;
    setError(null);
    setPasteExtracting(true);
    try {
      const resp = await fetch('/api/gmail/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: 'Pasted Class Announcement',
          from: 'Lecturer / Portal',
          date: new Date().toISOString().slice(0, 10),
          bodyText: pasteText.trim(),
          courses,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Could not analyze message.');
      setPasteExtracted(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to extract tasks from pasted text.');
    } finally {
      setPasteExtracting(false);
    }
  };

  const addExtractedAction = async (
    action: ExtractedEmailWork['actionItems'][number],
    onDone: () => void,
  ) => {
    const matched = courses.find((c) => c.code === action.courseCode);
    await onAddTask({
      courseCode: action.courseCode || 'AI-101',
      courseTitle: matched?.title || action.courseCode || 'AI Associate Degree',
      title: action.title,
      type: action.type,
      status: 'Urgent Catch-Up',
      dueDate: action.dueDate || 'TBD',
      estimatedMinutes: action.estimatedMinutes || 45,
      source: 'Gmail',
      notes: action.notes || 'Extracted from class email.',
    });
    onDone();
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Gmail Classwork Inbox</h1>
          <p className="text-sm text-slate-600 mt-1">
            Pull lecturer emails, Zoom links, and assignment deadlines straight into your catch-up
            queue.
          </p>
        </div>

        {gmailToken ? (
          <div className="flex items-center gap-3">
            {userEmail && (
              <span className="text-xs text-slate-600 font-mono truncate max-w-[220px]">
                {userEmail}
              </span>
            )}
            <button
              type="button"
              disabled={loadingInbox}
              onClick={() => fetchMessages()}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-4 h-4 ${loadingInbox ? 'animate-spin' : ''}`} />
              {loadingInbox ? 'Syncing...' : 'Sync Gmail'}
            </button>
          </div>
        ) : (
          <GoogleSignInButton
            label={userEmail ? 'Authorize Gmail Access' : 'Sign in with Google'}
            loading={connecting}
            onClick={handleConnect}
          />
        )}
      </div>

      {error && (
        <div
          className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-2.5 text-sm text-red-800"
          role="alert"
        >
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!gmailToken ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center space-y-4">
          <Mail className="w-8 h-8 text-slate-400 mx-auto" />
          <div className="space-y-1 max-w-md mx-auto">
            <h2 className="text-base font-semibold text-slate-900">
              Connect your Gmail session to read class emails
            </h2>
            <p className="text-sm text-slate-600">
              For your privacy, Gmail access stays strictly in memory for your current session and
              is never stored permanently.
            </p>
          </div>
          <div className="flex justify-center pt-1">
            <GoogleSignInButton
              label="Connect Gmail Inbox"
              loading={connecting}
              onClick={handleConnect}
            />
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Search & Filter Controls */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start">
              <button
                type="button"
                onClick={() => {
                  setFilterMode('class');
                  fetchMessages(gmailToken, 'class');
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  filterMode === 'class'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Class &amp; Zoom Emails
              </button>
              <button
                type="button"
                onClick={() => {
                  setFilterMode('all');
                  fetchMessages(gmailToken, 'all');
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  filterMode === 'all'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                All Recent Inbox
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                fetchMessages();
              }}
              className="flex gap-2"
            >
              <input
                type="text"
                value={customSearch}
                onChange={(e) => setCustomSearch(e.target.value)}
                placeholder="Search lecturer, course, or Zoom..."
                className="w-full sm:w-64 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              />
              <button
                type="submit"
                disabled={loadingInbox}
                className="px-3.5 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg whitespace-nowrap shrink-0"
              >
                Search
              </button>
            </form>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Message List */}
            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                <h2 className="text-xs font-semibold text-slate-700">Fetched Messages</h2>
                <span className="text-xs font-mono text-slate-500 tabular-nums">
                  {emails.length}
                </span>
              </div>

              {loadingInbox ? (
                <div className="p-8 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading your Gmail messages...
                </div>
              ) : emails.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500 space-y-2">
                  <p>No messages loaded yet.</p>
                  <button
                    type="button"
                    onClick={() => fetchMessages()}
                    className="text-blue-700 font-medium hover:underline"
                  >
                    Fetch recent emails
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-slate-200 max-h-[540px] overflow-y-auto">
                  {emails.map((msg) => {
                    const isSelected = msg.id === selectedEmail?.id;
                    return (
                      <button
                        key={msg.id}
                        type="button"
                        onClick={() => onSelectEmail(msg.id)}
                        className={`w-full text-left p-4 transition-colors ${
                          isSelected ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                        }`}
                      >
                        <p className="text-xs text-slate-500 truncate">{msg.from}</p>
                        <p className="text-sm font-medium text-slate-900 mt-0.5 line-clamp-1">
                          {msg.subject}
                        </p>
                        <p className="text-xs text-slate-500 mt-1 line-clamp-2">{msg.snippet}</p>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Selected Email + Extraction */}
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-6">
              {!selectedEmail ? (
                <div className="py-12 text-center text-sm text-slate-500">
                  Select an email on the left to read it and extract deadlines or Zoom links.
                </div>
              ) : (
                <>
                  <div className="space-y-2 pb-5 border-b border-slate-200">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1 min-w-0 flex-1">
                        <h2 className="text-lg font-semibold text-slate-900">
                          {selectedEmail.subject}
                        </h2>
                        <p className="text-xs text-slate-500">
                          {selectedEmail.from} · {selectedEmail.date}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={extracting}
                        onClick={() => handleExtractEmail(selectedEmail)}
                        className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
                      >
                        {extracting ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Extracting...
                          </>
                        ) : (
                          'Extract Deadlines & Links'
                        )}
                      </button>
                    </div>
                  </div>

                  {activeExtraction && (
                    <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 space-y-4">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-800">
                          Extracted Classwork Summary
                        </span>
                        <span
                          className={`text-xs font-medium ${
                            activeExtraction.urgency === 'High'
                              ? 'text-red-700'
                              : activeExtraction.urgency === 'Medium'
                                ? 'text-amber-700'
                                : 'text-emerald-700'
                          }`}
                        >
                          {activeExtraction.urgency} Urgency
                        </span>
                      </div>
                      <p className="text-sm text-slate-700 leading-relaxed">
                        {activeExtraction.summary}
                      </p>

                      {activeExtraction.zoomLinks.length > 0 && (
                        <div className="space-y-1.5">
                          <p className="text-xs font-medium text-slate-700">Zoom Links Found:</p>
                          <div className="space-y-1">
                            {activeExtraction.zoomLinks.map((link, idx) => (
                              <a
                                key={idx}
                                href={link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 text-xs text-blue-700 hover:underline break-all"
                              >
                                <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                                {link}
                              </a>
                            ))}
                          </div>
                        </div>
                      )}

                      {activeExtraction.actionItems.length > 0 && (
                        <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg bg-white">
                          {activeExtraction.actionItems.map((item, idx) => (
                            <div
                              key={idx}
                              className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                            >
                              <div>
                                <p className="text-sm font-medium text-slate-900">{item.title}</p>
                                <p className="text-xs text-slate-500 tabular-nums">
                                  {item.courseCode} · {item.type} · Due {item.dueDate} · Est.{' '}
                                  {item.estimatedMinutes}m
                                </p>
                              </div>
                              <button
                                type="button"
                                disabled={item.addedToTracker}
                                onClick={() =>
                                  addExtractedAction(item, () => {
                                    setExtractedByEmailId((prev) => {
                                      const cur = prev[selectedEmail.id];
                                      if (!cur) return prev;
                                      const nextItems = cur.actionItems.map((a, i) =>
                                        i === idx ? { ...a, addedToTracker: true } : a,
                                      );
                                      return {
                                        ...prev,
                                        [selectedEmail.id]: { ...cur, actionItems: nextItems },
                                      };
                                    });
                                  })
                                }
                                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap shrink-0 ${
                                  item.addedToTracker
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                    : 'bg-blue-700 text-white hover:bg-blue-800'
                                }`}
                              >
                                {item.addedToTracker ? (
                                  <>
                                    <Check className="w-3.5 h-3.5" />
                                    Added
                                  </>
                                ) : (
                                  <>
                                    <Plus className="w-3.5 h-3.5" />
                                    Add to Classwork
                                  </>
                                )}
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto">
                    {selectedEmail.bodyText || selectedEmail.snippet}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Paste Any Class Message / Portal Announcement Fallback */}
      <form
        onSubmit={handleExtractPaste}
        className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
      >
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Paste a Class Announcement or WhatsApp Update
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Got an update on your school portal or class group chat? Paste it here to extract tasks
            and due dates.
          </p>
        </div>

        <textarea
          rows={3}
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          placeholder="Paste lecturer message, Moodle announcement, or Zoom recording email..."
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
        />

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={pasteExtracting || !pasteText.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            {pasteExtracting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Scanning Text...
              </>
            ) : (
              'Extract Classwork Items'
            )}
          </button>
        </div>

        {pasteExtracted && (
          <div className="pt-4 border-t border-slate-200 space-y-3">
            <p className="text-sm text-slate-700">{pasteExtracted.summary}</p>
            {pasteExtracted.actionItems.length > 0 && (
              <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
                {pasteExtracted.actionItems.map((item, idx) => (
                  <div
                    key={idx}
                    className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-900">{item.title}</p>
                      <p className="text-xs text-slate-500 tabular-nums">
                        {item.courseCode} · {item.type} · Due {item.dueDate} · Est.{' '}
                        {item.estimatedMinutes}m
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={item.addedToTracker}
                      onClick={() =>
                        addExtractedAction(item, () => {
                          setPasteExtracted((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  actionItems: prev.actionItems.map((a, i) =>
                                    i === idx ? { ...a, addedToTracker: true } : a,
                                  ),
                                }
                              : null,
                          );
                        })
                      }
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap shrink-0 ${
                        item.addedToTracker
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-blue-700 text-white hover:bg-blue-800'
                      }`}
                    >
                      {item.addedToTracker ? 'Added' : 'Add to Classwork'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
