import { useMemo, useState } from 'react';
import {
  Bell,
  CalendarPlus,
  Check,
  CheckSquare,
  Code2,
  Copy,
  Edit3,
  ExternalLink,
  FileText,
  Layers,
  Loader2,
  Mail,
  Pin,
  Plus,
  RotateCw,
  Search,
  Settings2,
  Sigma,
  Square,
  Trash2,
} from 'lucide-react';
import { LATEX_SNIPPETS, MathText, containsLatex } from './MathText';
import type {
  ClassworkItem,
  Course,
  SmartClipAnalysis,
  SmartNoteCard,
  SmartNoteCardType,
  SmartNoteCodeSettings,
  SmartNoteColorTag,
} from '../types';

interface SmartNotebookPanelProps {
  courses: Course[];
  notes: SmartNoteCard[];
  onCreateNote: (note: Omit<SmartNoteCard, 'id' | 'createdAt'>) => Promise<string>;
  onUpdateNote: (noteId: string, note: Omit<SmartNoteCard, 'id' | 'createdAt'>) => Promise<void>;
  onDeleteNote: (noteId: string) => Promise<void>;
  onAddTask: (task: Omit<ClassworkItem, 'id' | 'createdAt'>) => Promise<void>;
  onAskChatbotWithContext: (courseCode: string, question: string) => void;
  onStartCoachWithTopic: (courseCode: string, topicFocus: string) => void;
}

const CODE_LANGUAGES = [
  'python',
  'javascript',
  'typescript',
  'sql',
  'bash',
  'json',
  'html',
  'css',
  'text',
];

const COLOR_HEADER_STYLES: Record<SmartNoteColorTag, string> = {
  slate: 'bg-slate-800 text-white',
  blue: 'bg-blue-700 text-white',
  amber: 'bg-amber-600 text-white',
  emerald: 'bg-emerald-700 text-white',
  rose: 'bg-rose-700 text-white',
};

const COLOR_DOT_CLASSES: Record<SmartNoteColorTag, string> = {
  slate: 'bg-slate-700',
  blue: 'bg-blue-600',
  amber: 'bg-amber-500',
  emerald: 'bg-emerald-600',
  rose: 'bg-rose-600',
};

function looksLikeCode(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const codePatterns = [
    /\b(def|class|import|from|return|async|await|function|const|let|var|SELECT|INSERT|UPDATE|CREATE TABLE)\b/,
    /[{};]\s*$/m,
    /=>/,
    /^\s*(pip|npm|python3?|git|docker)\s+/m,
    /print\(|console\.log\(|pd\.read_csv\(/,
  ];
  return codePatterns.some((rx) => rx.test(trimmed));
}

function toNoteUpdatePayload(note: SmartNoteCard): Omit<SmartNoteCard, 'id' | 'createdAt'> {
  return {
    courseCode: note.courseCode,
    title: note.title,
    cardType: note.cardType,
    colorTag: note.colorTag,
    pinned: note.pinned,
    content: note.content,
    codeLanguage: note.codeLanguage,
    codeSettings: note.codeSettings,
    checklistItems: note.checklistItems,
    keywords: note.keywords,
    reminderAt: note.reminderAt,
    sourceLabel: note.sourceLabel,
    emailSubject: note.emailSubject || '',
    flashcardHint: note.flashcardHint || '',
  };
}

export function SmartNotebookPanel({
  courses,
  notes,
  onCreateNote,
  onUpdateNote,
  onDeleteNote,
  onAddTask,
  onAskChatbotWithContext,
  onStartCoachWithTopic,
}: SmartNotebookPanelProps) {
  // Smart Auto-Categorizing Composer
  const [pasteText, setPasteText] = useState('');
  const [composerCourse, setComposerCourse] = useState('AUTO');
  const [composerTitle, setComposerTitle] = useState('');
  const [composerReminder, setComposerReminder] = useState('');
  const [categorizing, setCategorizing] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [showComposerLatex, setShowComposerLatex] = useState(false);
  const [showEditLatex, setShowEditLatex] = useState(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [courseFilter, setCourseFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState<'all' | SmartNoteCardType | 'reminders'>('all');

  // Per-card interactive state
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [openSettingsId, setOpenSettingsId] = useState<string | null>(null);
  const [flippedCards, setFlippedCards] = useState<Record<string, boolean>>({});
  const [hintRevealed, setHintRevealed] = useState<Record<string, boolean>>({});
  const [lastSmartClip, setLastSmartClip] = useState<SmartClipAnalysis | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editCourse, setEditCourse] = useState('AIL1001');
  const [editReminder, setEditReminder] = useState('');
  const [newCheckItemMap, setNewCheckItemMap] = useState<Record<string, string>>({});

  const handleSmartCategorizeSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pasteText.trim() || categorizing) return;
    setComposerError(null);
    setCategorizing(true);

    try {
      const resp = await fetch('/api/clip/smart-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: pasteText,
          courseCode: composerCourse,
          courses,
        }),
      });
      const data: SmartClipAnalysis & { error?: string } = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Could not auto-categorize content.');

      await onCreateNote({
        ...data.smartCard,
        title: composerTitle.trim() || data.smartCard.title,
        reminderAt: composerReminder || data.smartCard.reminderAt || '',
      });
      setLastSmartClip(data);
      setPasteText('');
      setComposerTitle('');
      setComposerReminder('');
    } catch (err) {
      setComposerError(err instanceof Error ? err.message : 'Auto-categorize failed.');
    } finally {
      setCategorizing(false);
    }
  };

  const handleManualSaveAs = async (cardType: SmartNoteCardType) => {
    if (!pasteText.trim() || categorizing) return;
    setComposerError(null);
    const chosenCourse = composerCourse === 'AUTO' ? courses[0]?.code || 'AIL1002' : composerCourse;
    const lines = pasteText
      .split(/\r?\n/)
      .map((l) => l.replace(/^[-*•\d.)\s]+/, '').trim())
      .filter(Boolean);

    const colorTag: SmartNoteColorTag =
      cardType === 'code'
        ? 'slate'
        : cardType === 'checklist'
          ? 'amber'
          : cardType === 'flashcard'
            ? 'emerald'
            : 'blue';

    await onCreateNote({
      courseCode: chosenCourse,
      title:
        composerTitle.trim() ||
        (cardType === 'code'
          ? 'Saved Code Snippet'
          : cardType === 'checklist'
            ? 'Study Checklist'
            : cardType === 'flashcard'
              ? lines[0]?.slice(0, 120) || 'Concept Flashcard'
              : cardType === 'template'
                ? 'Saved Email Template'
                : 'Study Note'),
      cardType,
      colorTag,
      pinned: false,
      content: cardType === 'checklist' ? `${lines.length} checklist items.` : pasteText.trim(),
      codeLanguage: cardType === 'code' ? 'python' : 'text',
      codeSettings: {
        theme: 'dark',
        showLineNumbers: true,
        wordWrap: false,
        fontSize: 'md',
      },
      checklistItems: cardType === 'checklist' ? lines.map((text) => ({ text, done: false })) : [],
      keywords: [chosenCourse.toLowerCase(), cardType],
      reminderAt: composerReminder || '',
      sourceLabel: 'Smart Notebook Composer',
      emailSubject: cardType === 'template' ? composerTitle.trim() || 'Course Email Template' : '',
      flashcardHint: '',
    });

    setPasteText('');
    setComposerTitle('');
    setComposerReminder('');
  };

  const filteredNotes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return [...notes]
      .filter((n) => {
        if (courseFilter !== 'ALL' && n.courseCode !== courseFilter) return false;
        if (typeFilter === 'reminders' && !n.reminderAt && !n.pinned) return false;
        if (
          typeFilter !== 'all' &&
          typeFilter !== 'reminders' &&
          n.cardType !== typeFilter
        ) {
          return false;
        }
        if (!q) return true;
        return (
          n.title.toLowerCase().includes(q) ||
          n.content.toLowerCase().includes(q) ||
          n.courseCode.toLowerCase().includes(q) ||
          n.codeLanguage.toLowerCase().includes(q) ||
          n.keywords.some((k) => k.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => Number(b.pinned) - Number(a.pinned));
  }, [notes, searchQuery, courseFilter, typeFilter]);

  const detectedPreviewIsCode = useMemo(() => looksLikeCode(pasteText), [pasteText]);

  return (
    <div className="space-y-6">
      {/* Zoho Notebook-style Smart Paste & Auto-Categorizer */}
      <form
        onSubmit={handleSmartCategorizeSave}
        className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Smart Notebook Cards (Auto-Categorized)
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Paste Python/SQL code, assignment checklists, or class notes — code automatically saves
              into a formatted Code Snippet Card with language &amp; editor settings.
            </p>
          </div>
          {pasteText.trim() && (
            <span className="text-xs font-mono font-medium text-blue-800">
              {detectedPreviewIsCode ? 'Code syntax detected' : 'Ready to auto-categorize'}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="md:col-span-5">
            <input
              type="text"
              value={composerTitle}
              onChange={(e) => setComposerTitle(e.target.value)}
              placeholder="Optional title (auto-generated if left blank)..."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            />
          </div>
          <div className="md:col-span-4">
            <select
              value={composerCourse}
              onChange={(e) => setComposerCourse(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            >
              <option value="AUTO">Auto-detect course</option>
              {courses.map((c) => (
                <option key={c.id} value={c.code}>
                  {c.code} · {c.title}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-3">
            <input
              type="datetime-local"
              value={composerReminder}
              onChange={(e) => setComposerReminder(e.target.value)}
              aria-label="Optional reminder time"
              className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs text-slate-900 tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            />
          </div>
        </div>

        <textarea
          rows={4}
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          placeholder="Paste Python/JS/SQL code, LaTeX equations ($...$ / $$...$$), a syllabus checklist, or lecture notes here..."
          className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-xs font-mono text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
        />

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowComposerLatex((v) => !v)}
            className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
              showComposerLatex
                ? 'bg-blue-50 text-blue-800 border-blue-300'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
            }`}
          >
            <Sigma className="w-3.5 h-3.5" />
            Insert LaTeX
          </button>
          {showComposerLatex &&
            LATEX_SNIPPETS.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() =>
                  setPasteText((prev) => (prev ? `${prev}\n${item.snippet}` : item.snippet))
                }
                className="px-2 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md whitespace-nowrap"
              >
                {item.label}
              </button>
            ))}
        </div>

        {!detectedPreviewIsCode && containsLatex(pasteText) && (
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-1">
            <span className="block text-[11px] font-medium text-slate-500">
              Live LaTeX Preview
            </span>
            <MathText text={pasteText} className="text-xs text-slate-800 leading-relaxed" />
          </div>
        )}

        {composerError && (
          <p className="text-xs font-medium text-red-700" role="alert">
            {composerError}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-500">Or save directly as:</span>
            <button
              type="button"
              disabled={!pasteText.trim() || categorizing}
              onClick={() => void handleManualSaveAs('code')}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 disabled:opacity-40 rounded-lg whitespace-nowrap"
            >
              <Code2 className="w-3.5 h-3.5" />
              Code Card
            </button>
            <button
              type="button"
              disabled={!pasteText.trim() || categorizing}
              onClick={() => void handleManualSaveAs('flashcard')}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 disabled:opacity-40 rounded-lg whitespace-nowrap"
            >
              <Layers className="w-3.5 h-3.5" />
              Flashcard
            </button>
            <button
              type="button"
              disabled={!pasteText.trim() || categorizing}
              onClick={() => void handleManualSaveAs('template')}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 disabled:opacity-40 rounded-lg whitespace-nowrap"
            >
              <Mail className="w-3.5 h-3.5" />
              Email Template
            </button>
            <button
              type="button"
              disabled={!pasteText.trim() || categorizing}
              onClick={() => void handleManualSaveAs('checklist')}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 disabled:opacity-40 rounded-lg whitespace-nowrap"
            >
              <CheckSquare className="w-3.5 h-3.5" />
              Checklist
            </button>
            <button
              type="button"
              disabled={!pasteText.trim() || categorizing}
              onClick={() => void handleManualSaveAs('note')}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 disabled:opacity-40 rounded-lg whitespace-nowrap"
            >
              <FileText className="w-3.5 h-3.5" />
              Note
            </button>
          </div>

          <button
            type="submit"
            disabled={!pasteText.trim() || categorizing}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
          >
            {categorizing ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Detecting Smart Action...
              </>
            ) : (
              'Auto-Categorize & Save Card'
            )}
          </button>
        </div>

        {lastSmartClip && (
          <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
            <span className="text-slate-600">{lastSmartClip.intentSummary}</span>
            <div className="flex flex-wrap items-center gap-2">
              {lastSmartClip.intent === 'email_letter' && (
                <a
                  href={`https://mail.google.com/mail/?view=cm&fs=1&su=${encodeURIComponent(lastSmartClip.emailSubject || lastSmartClip.smartCard.title)}&body=${encodeURIComponent(lastSmartClip.emailBody || lastSmartClip.extractedText)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md whitespace-nowrap"
                >
                  <Mail className="w-3.5 h-3.5" />
                  Open in Gmail
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
              {lastSmartClip.intent === 'date_reminder' && lastSmartClip.detectedDateIso && (
                <a
                  href={`https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(lastSmartClip.reminderTitle || lastSmartClip.smartCard.title)}&details=${encodeURIComponent(lastSmartClip.extractedText)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md whitespace-nowrap"
                >
                  <CalendarPlus className="w-3.5 h-3.5 text-blue-700" />
                  Add to Google Calendar
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
              <button
                type="button"
                onClick={() => setLastSmartClip(null)}
                className="text-slate-500 hover:text-slate-900 px-2 py-1"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
      </form>

      {/* Filter & Search Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
          {[
            { id: 'all' as const, label: 'All Cards' },
            { id: 'code' as const, label: 'Code Snippets' },
            { id: 'flashcard' as const, label: 'Flashcards' },
            { id: 'template' as const, label: 'Email Templates' },
            { id: 'checklist' as const, label: 'Checklists' },
            { id: 'note' as const, label: 'Study Notes' },
            { id: 'reminders' as const, label: 'Pinned & Reminders' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setTypeFilter(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                typeFilter === tab.id
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 flex-1 lg:max-w-md">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search code, tags, or notes..."
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            />
          </div>

          <select
            value={courseFilter}
            onChange={(e) => setCourseFilter(e.target.value)}
            aria-label="Filter smart cards by course"
            className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
          >
            <option value="ALL">All Courses</option>
            {courses.map((c) => (
              <option key={c.id} value={c.code}>
                {c.code}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Zoho Notebook-Inspired Card Grid */}
      {filteredNotes.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-2">
          <Code2 className="w-7 h-7 text-slate-400 mx-auto" />
          <p className="text-sm font-semibold text-slate-800">No smart notebook cards yet</p>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Paste code above or extract text from a screenshot in the Snip &amp; Record Studio to
            create auto-formatted Code Cards, Checklists, and Study Notes.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {filteredNotes.map((note) => {
            const isEditing = editingId === note.id;
            const showSettings = openSettingsId === note.id;
            const codeLines = note.content.split('\n');
            const isDarkCode = note.codeSettings.theme === 'dark';
            const codeTextSize =
              note.codeSettings.fontSize === 'sm'
                ? 'text-[11px]'
                : note.codeSettings.fontSize === 'lg'
                  ? 'text-sm'
                  : 'text-xs';

            return (
              <article
                key={note.id}
                className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col"
              >
                {/* Zoho Notebook Card Header Strip */}
                <div
                  className={`px-4 py-3 flex items-center justify-between gap-3 ${
                    COLOR_HEADER_STYLES[note.colorTag]
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs opacity-90">
                      <span className="font-mono font-semibold">{note.courseCode}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {note.cardType === 'code'
                          ? `Code (${note.codeLanguage.toUpperCase()})`
                          : note.cardType === 'checklist'
                            ? 'Checklist'
                            : note.cardType === 'flashcard'
                              ? 'Flashcard'
                              : note.cardType === 'template'
                                ? 'Email Template'
                                : 'Study Note'}
                      </span>
                    </div>
                    <h3 className="text-sm font-semibold truncate mt-0.5">{note.title}</h3>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        void onUpdateNote(note.id, {
                          ...toNoteUpdatePayload(note),
                          pinned: !note.pinned,
                        })
                      }
                      aria-label={note.pinned ? 'Unpin card' : 'Pin card'}
                      className={`p-1.5 rounded-md transition-colors ${
                        note.pinned ? 'bg-white/25' : 'hover:bg-white/15'
                      }`}
                    >
                      <Pin className="w-3.5 h-3.5" />
                    </button>

                    {note.cardType === 'code' && (
                      <button
                        type="button"
                        onClick={() => setOpenSettingsId(showSettings ? null : note.id)}
                        aria-label="Code editor settings"
                        className={`p-1.5 rounded-md transition-colors ${
                          showSettings ? 'bg-white/25' : 'hover:bg-white/15'
                        }`}
                      >
                        <Settings2 className="w-3.5 h-3.5" />
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        if (isEditing) {
                          setEditingId(null);
                        } else {
                          setEditingId(note.id);
                          setEditTitle(note.title);
                          setEditContent(note.content);
                          setEditCourse(note.courseCode);
                          setEditReminder(note.reminderAt);
                        }
                      }}
                      aria-label="Edit card"
                      className="p-1.5 rounded-md hover:bg-white/15 transition-colors"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => void onDeleteNote(note.id)}
                      aria-label={`Delete ${note.title}`}
                      className="p-1.5 rounded-md hover:bg-white/15 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Code Snippet Settings Bar (Language, Theme, Line Numbers, Wrap, Font Size) */}
                {note.cardType === 'code' && showSettings && (
                  <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center gap-3 text-xs">
                    <label className="flex items-center gap-1.5 text-slate-700">
                      <span>Lang</span>
                      <select
                        value={note.codeLanguage}
                        onChange={(e) =>
                          void onUpdateNote(note.id, {
                            ...toNoteUpdatePayload(note),
                            codeLanguage: e.target.value,
                          })
                        }
                        className="rounded border border-slate-300 px-2 py-1 bg-white text-slate-900 font-mono"
                      >
                        {CODE_LANGUAGES.map((lang) => (
                          <option key={lang} value={lang}>
                            {lang}
                          </option>
                        ))}
                      </select>
                    </label>

                    <button
                      type="button"
                      onClick={() =>
                        void onUpdateNote(note.id, {
                          ...toNoteUpdatePayload(note),
                          codeSettings: {
                            ...note.codeSettings,
                            theme: isDarkCode ? 'light' : 'dark',
                          },
                        })
                      }
                      className="px-2.5 py-1 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                    >
                      Theme: {isDarkCode ? 'Dark' : 'Light'}
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        void onUpdateNote(note.id, {
                          ...toNoteUpdatePayload(note),
                          codeSettings: {
                            ...note.codeSettings,
                            showLineNumbers: !note.codeSettings.showLineNumbers,
                          },
                        })
                      }
                      className="px-2.5 py-1 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                    >
                      Line #: {note.codeSettings.showLineNumbers ? 'On' : 'Off'}
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        void onUpdateNote(note.id, {
                          ...toNoteUpdatePayload(note),
                          codeSettings: {
                            ...note.codeSettings,
                            wordWrap: !note.codeSettings.wordWrap,
                          },
                        })
                      }
                      className="px-2.5 py-1 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                    >
                      Wrap: {note.codeSettings.wordWrap ? 'On' : 'Off'}
                    </button>

                    <select
                      value={note.codeSettings.fontSize}
                      onChange={(e) =>
                        void onUpdateNote(note.id, {
                          ...toNoteUpdatePayload(note),
                          codeSettings: {
                            ...note.codeSettings,
                            fontSize: e.target.value as SmartNoteCodeSettings['fontSize'],
                          },
                        })
                      }
                      aria-label="Code font size"
                      className="rounded border border-slate-300 px-2 py-1 bg-white text-slate-900"
                    >
                      <option value="sm">Font: Small</option>
                      <option value="md">Font: Medium</option>
                      <option value="lg">Font: Large</option>
                    </select>
                  </div>
                )}

                {/* Card Body */}
                <div className="p-4 space-y-3 flex-1">
                  {note.reminderAt && (
                    <div className="flex items-center gap-1.5 text-xs font-medium text-amber-800 tabular-nums">
                      <Bell className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        Reminder:{' '}
                        {Number.isNaN(Date.parse(note.reminderAt))
                          ? note.reminderAt
                          : new Date(note.reminderAt).toLocaleString()}
                      </span>
                    </div>
                  )}

                  {isEditing ? (
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-900"
                        />
                        <div className="flex gap-2">
                          <select
                            value={editCourse}
                            onChange={(e) => setEditCourse(e.target.value)}
                            className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-900 bg-white"
                          >
                            {courses.map((c) => (
                              <option key={c.id} value={c.code}>
                                {c.code}
                              </option>
                            ))}
                          </select>
                          <input
                            type="datetime-local"
                            value={editReminder}
                            onChange={(e) => setEditReminder(e.target.value)}
                            className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-900 tabular-nums"
                          />
                        </div>
                      </div>
                      <textarea
                        rows={6}
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 p-3 text-xs font-mono text-slate-900"
                      />
                      {note.cardType !== 'code' && (
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setShowEditLatex((v) => !v)}
                              className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md border whitespace-nowrap ${
                                showEditLatex
                                  ? 'bg-blue-50 text-blue-800 border-blue-300'
                                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                              }`}
                            >
                              <Sigma className="w-3 h-3" />
                              Insert LaTeX
                            </button>
                            {showEditLatex &&
                              LATEX_SNIPPETS.map((item) => (
                                <button
                                  key={item.label}
                                  type="button"
                                  onClick={() =>
                                    setEditContent((prev) =>
                                      prev ? `${prev}\n${item.snippet}` : item.snippet,
                                    )
                                  }
                                  className="px-2 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md whitespace-nowrap"
                                >
                                  {item.label}
                                </button>
                              ))}
                          </div>
                          {containsLatex(editContent) && (
                            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-1">
                              <span className="block text-[11px] font-medium text-slate-500">
                                Live LaTeX Preview
                              </span>
                              <MathText
                                text={editContent}
                                className="text-xs text-slate-800 leading-relaxed"
                              />
                            </div>
                          )}
                        </div>
                      )}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          {(Object.keys(COLOR_DOT_CLASSES) as SmartNoteColorTag[]).map((cTag) => (
                            <button
                              key={cTag}
                              type="button"
                              onClick={() =>
                                void onUpdateNote(note.id, {
                                  ...toNoteUpdatePayload(note),
                                  colorTag: cTag,
                                })
                              }
                              aria-label={`Set card color ${cTag}`}
                              className={`w-4 h-4 rounded-full ${COLOR_DOT_CLASSES[cTag]} ${
                                note.colorTag === cTag ? 'ring-2 ring-blue-700 ring-offset-1' : ''
                              }`}
                            />
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-900"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              await onUpdateNote(note.id, {
                                ...toNoteUpdatePayload(note),
                                title: editTitle.trim() || note.title,
                                courseCode: editCourse,
                                content: editContent,
                                reminderAt: editReminder,
                              });
                              setEditingId(null);
                            }}
                            className="px-3 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg"
                          >
                            Save Changes
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : note.cardType === 'code' ? (
                    <div
                      className={`rounded-lg border overflow-x-auto ${
                        isDarkCode
                          ? 'bg-slate-900 border-slate-800 text-slate-100'
                          : 'bg-slate-50 border-slate-200 text-slate-900'
                      }`}
                    >
                      <div
                        className={`px-3 py-1.5 border-b flex items-center justify-between text-[11px] font-mono ${
                          isDarkCode
                            ? 'border-slate-800 text-slate-400'
                            : 'border-slate-200 text-slate-500'
                        }`}
                      >
                        <span className="uppercase">{note.codeLanguage}</span>
                        <span className="tabular-nums">{codeLines.length} lines</span>
                      </div>
                      <div className={`p-3 font-mono ${codeTextSize} leading-relaxed`}>
                        {codeLines.map((line, lineIdx) => (
                          <div key={lineIdx} className="flex">
                            {note.codeSettings.showLineNumbers && (
                              <span
                                className={`select-none w-8 pr-3 text-right shrink-0 tabular-nums ${
                                  isDarkCode ? 'text-slate-600' : 'text-slate-400'
                                }`}
                              >
                                {lineIdx + 1}
                              </span>
                            )}
                            <span
                              className={
                                note.codeSettings.wordWrap
                                  ? 'whitespace-pre-wrap break-all'
                                  : 'whitespace-pre'
                              }
                            >
                              {line || ' '}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : note.cardType === 'checklist' ? (
                    <div className="space-y-2.5">
                      {note.content && (
                        <MathText
                          text={note.content}
                          className="text-xs text-slate-600 leading-relaxed"
                        />
                      )}
                      <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                        {note.checklistItems.map((item, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => {
                              const next = note.checklistItems.map((it, i) =>
                                i === idx ? { ...it, done: !it.done } : it,
                              );
                              void onUpdateNote(note.id, {
                                ...toNoteUpdatePayload(note),
                                checklistItems: next,
                              });
                            }}
                            className="w-full px-3 py-2 flex items-start gap-2.5 text-left hover:bg-slate-50 transition-colors"
                          >
                            {item.done ? (
                              <CheckSquare className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                            ) : (
                              <Square className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                            )}
                            <MathText
                              text={item.text}
                              as="span"
                              className={`text-xs leading-snug ${
                                item.done ? 'line-through text-slate-400' : 'text-slate-800'
                              }`}
                            />
                          </button>
                        ))}
                      </div>

                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const val = (newCheckItemMap[note.id] || '').trim();
                          if (!val) return;
                          const next = [...note.checklistItems, { text: val, done: false }];
                          void onUpdateNote(note.id, {
                            ...toNoteUpdatePayload(note),
                            checklistItems: next,
                          });
                          setNewCheckItemMap((prev) => ({ ...prev, [note.id]: '' }));
                        }}
                        className="flex gap-2"
                      >
                        <input
                          type="text"
                          value={newCheckItemMap[note.id] || ''}
                          onChange={(e) =>
                            setNewCheckItemMap((prev) => ({ ...prev, [note.id]: e.target.value }))
                          }
                          placeholder="Add checklist item..."
                          className="flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900"
                        />
                        <button
                          type="submit"
                          className="px-2.5 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </form>
                    </div>
                  ) : note.cardType === 'flashcard' ? (
                    <div className="space-y-3">
                      <button
                        type="button"
                        onClick={() =>
                          setFlippedCards((prev) => ({ ...prev, [note.id]: !prev[note.id] }))
                        }
                        className={`w-full text-left rounded-lg border p-4 transition-colors ${
                          flippedCards[note.id]
                            ? 'bg-emerald-50/70 border-emerald-200'
                            : 'bg-slate-50 border-slate-200 hover:border-blue-300'
                        }`}
                      >
                        <div className="flex items-center justify-between text-[11px] font-medium text-slate-500">
                          <span>
                            {flippedCards[note.id] ? 'Definition / Answer' : 'Term / Prompt'}
                          </span>
                          <span className="inline-flex items-center gap-1 text-blue-700">
                            <RotateCw className="w-3 h-3" />
                            Click to flip
                          </span>
                        </div>
                        <MathText
                          text={flippedCards[note.id] ? note.content : note.title}
                          as="span"
                          className="block text-sm font-medium text-slate-900 mt-2 leading-relaxed"
                        />
                      </button>

                      {note.flashcardHint && (
                        <div className="text-xs">
                          <button
                            type="button"
                            onClick={() =>
                              setHintRevealed((prev) => ({ ...prev, [note.id]: !prev[note.id] }))
                            }
                            className="text-blue-700 hover:underline font-medium"
                          >
                            {hintRevealed[note.id] ? 'Hide Hint' : 'Show Memory Hint'}
                          </button>
                          {hintRevealed[note.id] && (
                            <MathText
                              text={note.flashcardHint}
                              className="text-slate-600 mt-1"
                            />
                          )}
                        </div>
                      )}
                    </div>
                  ) : note.cardType === 'template' ? (
                    <div className="space-y-2.5">
                      <div className="text-xs text-slate-700">
                        <span className="font-semibold">Subject:</span>{' '}
                        {note.emailSubject || note.title}
                      </div>
                      <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                        <MathText
                          text={note.content}
                          className="text-xs text-slate-700 leading-relaxed"
                        />
                      </div>
                    </div>
                  ) : (
                    <MathText
                      text={note.content}
                      className="text-xs text-slate-700 leading-relaxed"
                    />
                  )}
                </div>

                {/* Card Footer Actions */}
                <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="text-slate-500 truncate max-w-[200px]">
                    {note.keywords.length > 0 ? note.keywords.join(' · ') : note.sourceLabel}
                  </span>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        const textToCopy =
                          note.cardType === 'checklist'
                            ? note.checklistItems.map((i) => `- [${i.done ? 'x' : ' '}] ${i.text}`).join('\n')
                            : note.content;
                        await navigator.clipboard.writeText(textToCopy);
                        setCopiedId(note.id);
                        setTimeout(() => setCopiedId(null), 1500);
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md"
                    >
                      {copiedId === note.id ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-700" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          Copy
                        </>
                      )}
                    </button>

                    {note.cardType === 'checklist' &&
                      note.checklistItems.some((i) => !i.done) && (
                        <button
                          type="button"
                          onClick={async () => {
                            const matched = courses.find((c) => c.code === note.courseCode);
                            const openItems = note.checklistItems.filter((i) => !i.done);
                            for (const it of openItems.slice(0, 5)) {
                              await onAddTask({
                                courseCode: note.courseCode,
                                courseTitle: matched?.title || note.courseCode,
                                title: it.text,
                                type: 'Assignment',
                                status: 'In Progress',
                                dueDate: note.reminderAt ? note.reminderAt.slice(0, 10) : 'TBD',
                                estimatedMinutes: 30,
                                source: 'Smart Note',
                                notes: `From Smart Notebook checklist "${note.title}".`,
                              });
                            }
                          }}
                          className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md whitespace-nowrap"
                        >
                          Send to Classwork
                        </button>
                      )}

                    {note.cardType === 'template' && (
                      <a
                        href={`https://mail.google.com/mail/?view=cm&fs=1&su=${encodeURIComponent(note.emailSubject || note.title)}&body=${encodeURIComponent(note.content)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md whitespace-nowrap"
                      >
                        <Mail className="w-3 h-3" />
                        Open in Gmail
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}

                    <button
                      type="button"
                      onClick={() =>
                        onAskChatbotWithContext(
                          note.courseCode,
                          `Help me understand this ${note.cardType === 'code' ? `${note.codeLanguage} code snippet` : note.cardType === 'flashcard' ? 'flashcard concept' : 'note'} titled "${note.title}":\n\n${note.content.slice(0, 1500)}`,
                        )
                      }
                      className="px-2.5 py-1 text-xs font-medium text-blue-700 bg-white border border-slate-300 hover:bg-blue-50 rounded-md whitespace-nowrap"
                    >
                      Explain in Tutor
                    </button>

                    <button
                      type="button"
                      onClick={() => onStartCoachWithTopic(note.courseCode, note.title)}
                      className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md whitespace-nowrap"
                    >
                      Coach Me
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
