import { useMemo, useRef, useState } from 'react';
import {
  Camera,
  Check,
  Clock,
  Code2,
  Copy,
  Download,
  Film,
  Loader2,
  MessageSquare,
  Plus,
  Scissors,
  Search,
  Send,
  UserCheck,
} from 'lucide-react';
import { MathText } from './MathText';
import type {
  ClassworkItem,
  Course,
  LectureAnalysis,
  SmartNoteCard,
  VideoAskResponse,
  VideoClassifiedMoment,
  VideoMomentCategory,
  VideoScreenshotItem,
  VideoSessionResult,
} from '../types';

interface VideoCatchUpPanelProps {
  studentName: string;
  courses: Course[];
  lectures: LectureAnalysis[];
  onSaveLecture: (lecture: Omit<LectureAnalysis, 'id' | 'createdAt'>) => Promise<string>;
  onSaveNote: (note: Omit<SmartNoteCard, 'id' | 'createdAt'>) => Promise<string>;
  onAddTask: (task: Omit<ClassworkItem, 'id' | 'createdAt'>) => Promise<void>;
  onOpenSmartNotebook: () => void;
}

interface VideoChatMessage {
  role: 'user' | 'assistant';
  text: string;
  timestampRefs?: VideoAskResponse['timestampRefs'];
}

const MOMENT_CATEGORIES: Array<'ALL' | VideoMomentCategory> = [
  'ALL',
  'Key Point',
  'Tip / Warning',
  'Code Shown',
  'Action Item',
  'Name Mentioned',
  'Concept',
];

function parseClockToSeconds(input: string): number {
  const parts = input
    .trim()
    .split(':')
    .map((p) => Number(p));
  if (parts.some((n) => Number.isNaN(n) || n < 0)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

function formatSecToClock(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function VideoCatchUpPanel({
  studentName,
  courses,
  lectures,
  onSaveLecture,
  onSaveNote,
  onAddTask,
  onOpenSmartNotebook,
}: VideoCatchUpPanelProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Upload & processing form
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [courseChoice, setCourseChoice] = useState('AUTO');
  const [titleInput, setTitleInput] = useState('');
  const [lectureDate, setLectureDate] = useState(new Date().toISOString().slice(0, 10));
  const [watchName, setWatchName] = useState(studentName || '');
  const [processing, setProcessing] = useState(false);
  const [processingStage, setProcessingStage] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Active video session OR loaded saved lecture
  const [session, setSession] = useState<VideoSessionResult | null>(null);
  const [loadedLectureId, setLoadedLectureId] = useState<string>('');

  // Interactive player & clip cutter controls
  const [clipStartStr, setClipStartStr] = useState('00:00');
  const [clipEndStr, setClipEndStr] = useState('00:45');
  const [momentFilter, setMomentFilter] = useState<'ALL' | VideoMomentCategory>('ALL');
  const [transcriptSearch, setTranscriptSearch] = useState('');
  const [showTranscript, setShowTranscript] = useState(false);

  // YouTube-style Q&A about this video
  const [qaMessages, setQaMessages] = useState<VideoChatMessage[]>([]);
  const [qaInput, setQaInput] = useState('');
  const [qaLoading, setQaLoading] = useState(false);

  // Feedback / saved trackers
  const [savedCardKeys, setSavedCardKeys] = useState<Record<string, boolean>>({});
  const [addedTaskKeys, setAddedTaskKeys] = useState<Record<number, boolean>>({});
  const [copiedTranscript, setCopiedTranscript] = useState(false);
  const [copiedCodeKey, setCopiedCodeKey] = useState<string | null>(null);

  const savedRecordings = useMemo(
    () =>
      lectures.filter(
        (l) =>
          (l.classifiedMoments && l.classifiedMoments.length > 0) ||
          (l.fullTranscript && l.fullTranscript.trim().length > 0) ||
          l.sourceType === 'Recording',
      ),
    [lectures],
  );

  const activeLecture: Omit<LectureAnalysis, 'id' | 'createdAt'> | null = useMemo(() => {
    if (session) return session.lecture;
    if (loadedLectureId) {
      const found = lectures.find((l) => l.id === loadedLectureId);
      if (found) return found;
    }
    return null;
  }, [session, loadedLectureId, lectures]);

  const filteredMoments = useMemo(() => {
    const list = activeLecture?.classifiedMoments || [];
    if (momentFilter === 'ALL') return list;
    return list.filter((m) => m.category === momentFilter);
  }, [activeLecture, momentFilter]);

  const seekMediaTo = (seconds: number) => {
    const safeSec = Math.max(0, Number(seconds) || 0);
    if (videoRef.current) {
      videoRef.current.currentTime = safeSec;
      void videoRef.current.play().catch(() => {});
      videoRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else if (audioRef.current) {
      audioRef.current.currentTime = safeSec;
      void audioRef.current.play().catch(() => {});
    }
  };

  const handleAnalyzeVideo = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!selectedFile) {
      setError('Please choose a video or audio recording (.mp4, .mov, .mkv, .webm, .m4a, .mp3).');
      return;
    }

    setProcessing(true);
    setProcessingStage(
      'Uploading recording & auto-compressing video frames + enhancing speech audio...',
    );
    setSavedCardKeys({});
    setAddedTaskKeys({});
    setQaMessages([]);

    const stageTimer = setTimeout(() => {
      setProcessingStage(
        'Transcribing Indian/Jamaican English lecture audio, scanning for your name, classifying moments & capturing key screenshots...',
      );
    }, 6000);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('courseCode', courseChoice);
      formData.append('courses', JSON.stringify(courses));
      formData.append('lectureDate', lectureDate);
      if (titleInput.trim()) formData.append('title', titleInput.trim());
      if (watchName.trim()) formData.append('studentName', watchName.trim());

      const resp = await fetch('/api/video/analyze-deep', {
        method: 'POST',
        body: formData,
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || 'Could not process video recording.');
      }

      const savedId = await onSaveLecture(data.lecture);
      const result: VideoSessionResult = {
        sessionId: data.sessionId,
        videoStats: data.videoStats,
        screenshots: Array.isArray(data.screenshots) ? data.screenshots : [],
        lecture: data.lecture,
        savedLectureId: savedId,
      };
      setSession(result);
      setLoadedLectureId('');
      setClipStartStr('00:00');
      setClipEndStr(
        formatSecToClock(Math.min(45, Math.max(15, data.videoStats?.durationSeconds || 45))),
      );
      setSelectedFile(null);
      setTitleInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Video catch-up processing failed.');
    } finally {
      clearTimeout(stageTimer);
      setProcessing(false);
      setProcessingStage('');
    }
  };

  const handleAskVideo = async (questionOverride?: string) => {
    const q = (questionOverride ?? qaInput).trim();
    if (!q || !activeLecture || qaLoading) return;
    if (!questionOverride) setQaInput('');
    setError(null);

    const nextHistory = [...qaMessages, { role: 'user' as const, text: q }];
    setQaMessages(nextHistory);
    setQaLoading(true);

    try {
      const resp = await fetch('/api/video/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: session?.sessionId || '',
          question: q,
          lectureTitle: activeLecture.title,
          courseCode: activeLecture.courseCode,
          plainEnglishSummary: activeLecture.plainEnglishSummary,
          classifiedMoments: activeLecture.classifiedMoments || [],
          fullTranscript: activeLecture.fullTranscript || activeLecture.rawExcerpt || '',
          history: nextHistory.map((m) => ({ role: m.role, text: m.text })),
        }),
      });
      const data = (await resp.json()) as VideoAskResponse & { error?: string };
      if (!resp.ok) throw new Error(data.error || 'Could not answer question about this video.');
      setQaMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: data.answer,
          timestampRefs: Array.isArray(data.timestampRefs) ? data.timestampRefs : [],
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to answer question.');
    } finally {
      setQaLoading(false);
    }
  };

  const handleSaveMomentCodeCard = async (m: VideoClassifiedMoment, key: string) => {
    if (!activeLecture) return;
    await onSaveNote({
      courseCode: activeLecture.courseCode,
      title: `${m.title} (${m.timestamp})`,
      cardType: m.codeSnippet ? 'code' : 'note',
      colorTag: m.codeSnippet ? 'slate' : 'blue',
      pinned: false,
      content: m.codeSnippet || m.summary,
      codeLanguage: m.codeLanguage || 'python',
      codeSettings: { theme: 'dark', showLineNumbers: true, wordWrap: false, fontSize: 'md' },
      checklistItems: [],
      keywords: [activeLecture.courseCode.toLowerCase(), m.category.toLowerCase(), m.timestamp],
      reminderAt: '',
      sourceLabel: `Video Moment · ${activeLecture.title.slice(0, 60)}`,
    });
    setSavedCardKeys((prev) => ({ ...prev, [key]: true }));
  };

  const handleSaveScreenshotCard = async (shot: VideoScreenshotItem) => {
    if (!activeLecture) return;
    const key = `shot_${shot.index}`;
    const hasCode = Boolean(shot.codeSnippet && shot.codeSnippet.trim());
    await onSaveNote({
      courseCode: activeLecture.courseCode,
      title: `[${shot.timestamp}] ${shot.caption.slice(0, 100)}`,
      cardType: hasCode ? 'code' : 'note',
      colorTag: hasCode ? 'slate' : 'amber',
      pinned: false,
      content: hasCode
        ? shot.codeSnippet!
        : `${shot.caption}\n\nCaptured from lecture "${activeLecture.title}" at ${shot.timestamp}.`,
      codeLanguage: shot.codeLanguage || (hasCode ? 'python' : 'text'),
      codeSettings: { theme: 'dark', showLineNumbers: true, wordWrap: false, fontSize: 'md' },
      checklistItems: [],
      keywords: [activeLecture.courseCode.toLowerCase(), 'video-frame', shot.timestamp],
      reminderAt: '',
      sourceLabel: `Video Frame ${shot.timestamp} · ${activeLecture.title.slice(0, 50)}`,
    });
    setSavedCardKeys((prev) => ({ ...prev, [key]: true }));
  };

  const cutHref = useMemo(() => {
    if (!session?.sessionId) return '#';
    const startSec = parseClockToSeconds(clipStartStr);
    const endSec = Math.max(startSec + 2, parseClockToSeconds(clipEndStr));
    return `/api/video/cut/${encodeURIComponent(session.sessionId)}?start=${startSec}&end=${endSec}`;
  }, [session?.sessionId, clipStartStr, clipEndStr]);

  const transcriptLines = useMemo(() => {
    const raw = activeLecture?.fullTranscript || activeLecture?.rawExcerpt || '';
    if (!raw) return [];
    const lines = raw.split(/\r?\n/).filter((l) => l.trim());
    const q = transcriptSearch.trim().toLowerCase();
    if (!q) return lines;
    return lines.filter((l) => l.toLowerCase().includes(q));
  }, [activeLecture, transcriptSearch]);

  return (
    <div className="space-y-6">
      {/* Large Video Upload & Webex Catch-Up Pipeline Card */}
      <form
        onSubmit={handleAnalyzeVideo}
        className="bg-white border border-slate-200 rounded-xl p-6 space-y-5"
      >
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
          <div className="space-y-1 max-w-3xl">
            <h2 className="text-lg font-semibold text-slate-900">
              Long-Lecture Video Catch-Up, Accent Transcript &amp; Clip Cutter
            </h2>
            <p className="text-xs text-slate-600 leading-relaxed">
              Upload 1-hour+ Zoom/Webex videos directly (up to 1.5 GB) without manual compression.
              The server automatically downscales video frames for fast processing, cleans fast
              Indian &amp; Jamaican English accents via 16 kHz speech enhancement, checks if your
              name was called, classifies every moment &amp; code screen, captures up to 7 key frame
              screenshots, and lets you ask questions or cut MP4 clips.
            </p>
          </div>

          {savedRecordings.length > 0 && (
            <div className="shrink-0 w-full lg:w-72">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Load Saved Lecture Catch-Up
              </label>
              <select
                value={loadedLectureId}
                onChange={(e) => {
                  setLoadedLectureId(e.target.value);
                  if (e.target.value) {
                    setSession(null);
                    setQaMessages([]);
                  }
                }}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              >
                <option value="">Select a saved recording...</option>
                {savedRecordings.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.courseCode} · {l.title} ({l.lectureDate})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Course</label>
            <select
              value={courseChoice}
              onChange={(e) => setCourseChoice(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            >
              <option value="AUTO">Auto-detect course</option>
              {courses.map((c) => (
                <option key={c.id} value={c.code}>
                  {c.code} · {c.title}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Watch For Your Name
            </label>
            <input
              type="text"
              value={watchName}
              onChange={(e) => setWatchName(e.target.value)}
              placeholder="e.g., Kake or Buchanan"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Optional Title Override
            </label>
            <input
              type="text"
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              placeholder="Auto-name from lecture"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Class Date</label>
            <input
              type="date"
              value={lectureDate}
              onChange={(e) => setLectureDate(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            />
          </div>
        </div>

        <label className="flex flex-col sm:flex-row items-center justify-between gap-4 border border-dashed border-slate-300 hover:border-blue-600 rounded-xl p-5 bg-slate-50/70 cursor-pointer transition-colors">
          <div className="flex items-center gap-3.5 text-left">
            <div className="w-10 h-10 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center shrink-0">
              <Film className="w-5 h-5 text-blue-700" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-900">
                {selectedFile
                  ? `${selectedFile.name} (${(selectedFile.size / (1024 * 1024)).toFixed(1)} MB)`
                  : 'Choose Zoom / Webex recording or lecture audio'}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                Supports .mp4, .mov, .mkv, .webm, .m4a, .mp3, .wav up to 1.5 GB — automatically
                compressed on upload
              </p>
            </div>
          </div>
          <span className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg whitespace-nowrap shrink-0">
            Browse Video / Audio
          </span>
          <input
            type="file"
            accept=".mp4,.mov,.mkv,.webm,.m4a,.mp3,.wav,.ogg,video/*,audio/*"
            onChange={(e) => {
              setSelectedFile(e.target.files?.[0] || null);
              setError(null);
            }}
            className="hidden"
          />
        </label>

        {error && (
          <p className="text-xs font-medium text-red-700" role="alert">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-500">
            {processing ? processingStage : 'Results automatically save to your Study Library.'}
          </p>
          <button
            type="submit"
            disabled={processing}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            {processing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Compressing &amp; Catching You Up...
              </>
            ) : (
              'Analyze Lecture Video & Catch Me Up'
            )}
          </button>
        </div>
      </form>

      {/* Active Session OR Saved Lecture Catch-Up Results */}
      {activeLecture && (
        <div className="space-y-6">
          {/* Top Webex-style Catch-Up Summary & Name Mentions */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-200">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 tabular-nums">
                  <span className="font-mono font-semibold text-blue-800">
                    {activeLecture.courseCode}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{activeLecture.moduleTopic}</span>
                  <span aria-hidden="true">·</span>
                  <span>{activeLecture.durationOrLines}</span>
                </div>
                <h3 className="text-xl font-semibold text-slate-900">{activeLecture.title}</h3>
                {activeLecture.keywords.length > 0 && (
                  <p className="text-xs text-slate-500">
                    Keywords: {activeLecture.keywords.join(' · ')}
                  </p>
                )}
              </div>

              {session?.videoStats && (
                <div className="text-right text-xs text-slate-600 tabular-nums">
                  <p className="font-medium text-slate-800">
                    Duration: {session.videoStats.durationFormatted}
                  </p>
                  <p>
                    {session.videoStats.wasCompressed
                      ? `Auto-compressed: ${session.videoStats.originalSizeMb} MB -> ${session.videoStats.compressedSizeMb} MB`
                      : `File size: ${session.videoStats.originalSizeMb} MB`}
                  </p>
                </div>
              )}
            </div>

            {/* Catch Me Up Summary */}
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-slate-900">Webex Catch-Me-Up Summary</h4>
              <MathText
                text={activeLecture.plainEnglishSummary}
                className="text-sm text-slate-700 leading-relaxed"
              />
            </div>

            {/* Name Mentions + Tips & Action Items */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 pt-2">
              <div className="border border-slate-200 rounded-lg p-4 bg-slate-50/70 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <UserCheck className="w-4 h-4 text-blue-700" />
                    Was Your Name Mentioned?
                  </div>
                  <span className="text-xs font-medium text-slate-600 tabular-nums">
                    {(activeLecture.studentNameMentions || []).length} match
                    {(activeLecture.studentNameMentions || []).length === 1 ? '' : 'es'}
                  </span>
                </div>

                {!activeLecture.studentNameMentions ||
                activeLecture.studentNameMentions.length === 0 ? (
                  <p className="text-xs text-slate-600 leading-relaxed">
                    No direct mention of your name was detected in this lecture recording.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-200 border border-slate-200 rounded-md bg-white">
                    {activeLecture.studentNameMentions.map((m, idx) => (
                      <div key={idx} className="p-3 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-slate-900">{m.reason}</span>
                          <button
                            type="button"
                            disabled={!session}
                            onClick={() => seekMediaTo(m.startSeconds)}
                            className="text-xs font-mono font-semibold text-blue-700 hover:underline disabled:text-slate-500 disabled:no-underline tabular-nums"
                          >
                            [{m.timestamp}]
                          </button>
                        </div>
                        <MathText text={m.context} className="text-xs text-slate-600 leading-relaxed" />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="border border-slate-200 rounded-lg p-4 bg-slate-50/70 space-y-3">
                <h4 className="text-sm font-semibold text-slate-900">
                  Key Tips, Exam Warnings &amp; Pitfalls
                </h4>
                {!activeLecture.tipsAndWarnings || activeLecture.tipsAndWarnings.length === 0 ? (
                  <p className="text-xs text-slate-600">
                    No separate exam warnings flagged — see the classified moments below for
                    details.
                  </p>
                ) : (
                  <ul className="list-disc pl-5 space-y-1.5 text-xs text-slate-700 leading-relaxed">
                    {activeLecture.tipsAndWarnings.map((tip, idx) => (
                      <li key={idx}>
                        <MathText text={tip} as="span" />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {activeLecture.actionItems.length > 0 && (
              <div className="space-y-2.5 pt-2">
                <h4 className="text-sm font-semibold text-slate-900">
                  Action Items &amp; Deadlines Mentioned
                </h4>
                <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
                  {activeLecture.actionItems.map((item, idx) => {
                    const added = Boolean(item.addedToTracker || addedTaskKeys[idx]);
                    return (
                      <div
                        key={idx}
                        className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div>
                          <p className="text-sm font-medium text-slate-900">{item.title}</p>
                          <p className="text-xs text-slate-500 tabular-nums">
                            {item.type} · Due: {item.dueHint || 'TBD'} · Est.{' '}
                            {item.estimatedMinutes || 40}m
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={added}
                          onClick={async () => {
                            const matched = courses.find(
                              (c) => c.code === activeLecture.courseCode,
                            );
                            await onAddTask({
                              courseCode: activeLecture.courseCode,
                              courseTitle: matched?.title || activeLecture.courseCode,
                              title: item.title,
                              type: item.type,
                              status: 'Urgent Catch-Up',
                              dueDate: item.dueHint || 'TBD',
                              estimatedMinutes: item.estimatedMinutes || 45,
                              source: 'Zoom Recording',
                              notes: `From Video Catch-Up "${activeLecture.title}" (${activeLecture.lectureDate}).`,
                            });
                            setAddedTaskKeys((prev) => ({ ...prev, [idx]: true }));
                          }}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap shrink-0 ${
                            added
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-blue-700 text-white hover:bg-blue-800'
                          }`}
                        >
                          {added ? (
                            <>
                              <Check className="w-3.5 h-3.5" />
                              Added to Classwork
                            </>
                          ) : (
                            <>
                              <Plus className="w-3.5 h-3.5" />
                              Add to Classwork
                            </>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Interactive Video Player + Clip Cutter (left) & YouTube-style Video Q&A (right) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Player & Clip Cutter */}
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-sm font-semibold text-slate-900">
                  {session
                    ? session.videoStats.isAudioOnly
                      ? 'Audio Playback & Timestamp Jump'
                      : 'Interactive Lecture Player & Video Clip Cutter'
                    : 'Playback Preview'}
                </h4>
                {session && (
                  <span className="text-xs text-slate-500 tabular-nums">
                    Click any [MM:SS] timestamp below to jump
                  </span>
                )}
              </div>

              {session ? (
                session.videoStats.isAudioOnly ? (
                  <audio
                    ref={audioRef}
                    controls
                    className="w-full"
                    src={`/api/video/stream/${encodeURIComponent(session.sessionId)}`}
                  />
                ) : (
                  <>
                    <video
                      ref={videoRef}
                      controls
                      playsInline
                      className="w-full aspect-video rounded-lg bg-slate-900"
                      src={`/api/video/stream/${encodeURIComponent(session.sessionId)}`}
                    />

                    {/* Snippet Cutter Bar */}
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 flex flex-wrap items-end justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            Clip Start (MM:SS)
                          </label>
                          <input
                            type="text"
                            value={clipStartStr}
                            onChange={(e) => setClipStartStr(e.target.value)}
                            className="w-24 rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-mono bg-white tabular-nums"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            Clip End (MM:SS)
                          </label>
                          <input
                            type="text"
                            value={clipEndStr}
                            onChange={(e) => setClipEndStr(e.target.value)}
                            className="w-24 rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-mono bg-white tabular-nums"
                          />
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (videoRef.current) {
                              setClipStartStr(formatSecToClock(videoRef.current.currentTime));
                            }
                          }}
                          className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg whitespace-nowrap"
                        >
                          Use Current Time
                        </button>
                        <a
                          href={cutHref}
                          download
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg whitespace-nowrap"
                        >
                          <Scissors className="w-3.5 h-3.5" />
                          Cut &amp; Download MP4 Clip
                        </a>
                      </div>
                    </div>
                  </>
                )
              ) : (
                <div className="rounded-lg bg-slate-50 border border-slate-200 p-6 text-xs text-slate-600 leading-relaxed">
                  You are viewing a saved catch-up breakdown from Firestore. Re-upload the video file
                  above whenever you want live video playback, MP4 clip cutting, or fresh frame
                  screenshots — all text Q&amp;A, classified moments, and transcript search work
                  right away.
                </div>
              )}
            </div>

            {/* YouTube-Style Video Q&A */}
            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 flex flex-col space-y-4">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-blue-700" />
                <h4 className="text-sm font-semibold text-slate-900">
                  Ask Questions About This Video
                </h4>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {[
                  'Explain the code shown on screen step by step',
                  'What assignment or exam tips did the teacher mention?',
                  'Summarize the hardest part in simple English',
                ].map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    disabled={qaLoading}
                    onClick={() => handleAskVideo(prompt)}
                    className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md text-left"
                  >
                    {prompt}
                  </button>
                ))}
              </div>

              <div className="border border-slate-200 rounded-lg bg-slate-50/70 p-3.5 h-72 overflow-y-auto space-y-3">
                {qaMessages.length === 0 ? (
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Ask anything you missed or couldn&apos;t catch clearly due to accent or pace.
                    Answers cite exact timestamps you can click to jump right into the video.
                  </p>
                ) : (
                  qaMessages.map((msg, idx) => (
                    <div
                      key={idx}
                      className={`rounded-lg p-3 text-xs leading-relaxed ${
                        msg.role === 'user'
                          ? 'bg-blue-700 text-white ml-6'
                          : 'bg-white border border-slate-200 text-slate-800 mr-4 space-y-2'
                      }`}
                    >
                      <MathText text={msg.text} className="leading-relaxed" />
                      {msg.timestampRefs && msg.timestampRefs.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {msg.timestampRefs.map((ref, rIdx) => (
                            <button
                              key={rIdx}
                              type="button"
                              onClick={() => seekMediaTo(ref.seconds)}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-mono font-medium bg-blue-50 text-blue-800 hover:bg-blue-100 rounded-md tabular-nums"
                            >
                              <Clock className="w-3 h-3" />
                              {ref.timestamp} · {ref.note}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
                {qaLoading && (
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-700" />
                    Searching video moments &amp; transcript...
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={qaInput}
                  onChange={(e) => setQaInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleAskVideo();
                    }
                  }}
                  placeholder="Ask what the lecturer meant at a timestamp..."
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                />
                <button
                  type="button"
                  disabled={qaLoading || !qaInput.trim()}
                  onClick={() => handleAskVideo()}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg whitespace-nowrap shrink-0"
                >
                  <Send className="w-3.5 h-3.5" />
                  Ask
                </button>
              </div>
            </div>
          </div>

          {/* Auto-Captured Key Frame Screenshots (Up to 7 Frames) */}
          {session && session.screenshots.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Camera className="w-4 h-4 text-blue-700" />
                  <h4 className="text-base font-semibold text-slate-900">
                    Auto-Captured Key Moments ({session.screenshots.length} Video Screenshots)
                  </h4>
                </div>
                <button
                  type="button"
                  onClick={onOpenSmartNotebook}
                  className="text-xs font-medium text-blue-700 hover:underline whitespace-nowrap"
                >
                  Open Smart Notebook
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {session.screenshots.map((shot) => {
                  const savedKey = `shot_${shot.index}`;
                  const isSaved = Boolean(savedCardKeys[savedKey]);
                  return (
                    <div
                      key={shot.index}
                      className="border border-slate-200 rounded-lg overflow-hidden bg-slate-50/70 flex flex-col justify-between"
                    >
                      <div>
                        <img
                          src={shot.imageUrl}
                          alt={`Lecture frame at ${shot.timestamp}`}
                          className="w-full h-44 object-cover bg-slate-900 cursor-pointer"
                          onClick={() => seekMediaTo(shot.seconds)}
                        />
                        <div className="p-3.5 space-y-1.5">
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <button
                              type="button"
                              onClick={() => seekMediaTo(shot.seconds)}
                              className="font-mono font-semibold text-blue-700 hover:underline tabular-nums"
                            >
                              [{shot.timestamp}]
                            </button>
                            <span className="text-slate-600 font-medium">{shot.category}</span>
                          </div>
                          <MathText
                            text={shot.caption}
                            className="text-xs text-slate-700 leading-relaxed"
                          />
                        </div>
                      </div>

                      <div className="px-3.5 pb-3.5 flex items-center justify-between gap-2">
                        <a
                          href={shot.imageUrl}
                          download={`lecture_${shot.timestamp.replace(':', '-')}.jpg`}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-md whitespace-nowrap"
                        >
                          <Download className="w-3.5 h-3.5" />
                          JPG
                        </a>
                        <button
                          type="button"
                          disabled={isSaved}
                          onClick={() => handleSaveScreenshotCard(shot)}
                          className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md whitespace-nowrap ${
                            isSaved
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-blue-700 text-white hover:bg-blue-800'
                          }`}
                        >
                          {isSaved ? (
                            <>
                              <Check className="w-3.5 h-3.5" />
                              Saved
                            </>
                          ) : (
                            'Save to Smart Notebook'
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Classified Timestamped Map + Extracted Code */}
          {(activeLecture.classifiedMoments || []).length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h4 className="text-base font-semibold text-slate-900">
                  Classified Timestamp Map &amp; Code Shown ({filteredMoments.length})
                </h4>
                <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
                  {MOMENT_CATEGORIES.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setMomentFilter(cat)}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                        momentFilter === cat
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {cat === 'ALL' ? 'All' : cat}
                    </button>
                  ))}
                </div>
              </div>

              <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
                {filteredMoments.map((m, idx) => {
                  const key = `moment_${idx}_${m.timestamp}`;
                  const isSaved = Boolean(savedCardKeys[key]);
                  return (
                    <div key={key} className="p-4 space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <button
                            type="button"
                            disabled={!session}
                            onClick={() => seekMediaTo(m.startSeconds)}
                            className="font-mono font-semibold text-blue-700 hover:underline disabled:text-slate-700 disabled:no-underline tabular-nums"
                          >
                            [{m.timestamp}]
                          </button>
                          <span className="font-semibold text-slate-700">{m.category}</span>
                          <span aria-hidden="true" className="text-slate-400">
                            ·
                          </span>
                          <span className="font-semibold text-slate-900 text-sm">{m.title}</span>
                        </div>

                        <div className="flex items-center gap-2">
                          {session && !session.videoStats.isAudioOnly && (
                            <button
                              type="button"
                              onClick={() => {
                                setClipStartStr(formatSecToClock(m.startSeconds));
                                setClipEndStr(formatSecToClock(m.endSeconds));
                                seekMediaTo(m.startSeconds);
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md whitespace-nowrap"
                            >
                              <Scissors className="w-3 h-3" />
                              Load Clip Range
                            </button>
                          )}
                          {(m.codeSnippet || m.category === 'Code Shown') && (
                            <button
                              type="button"
                              disabled={isSaved}
                              onClick={() => handleSaveMomentCodeCard(m, key)}
                              className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap ${
                                isSaved
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                  : 'bg-blue-700 text-white hover:bg-blue-800'
                              }`}
                            >
                              <Code2 className="w-3 h-3" />
                              {isSaved ? 'Saved Code Card' : 'Save Code Card'}
                            </button>
                          )}
                        </div>
                      </div>

                      <MathText
                        text={m.summary}
                        className="text-sm text-slate-700 leading-relaxed"
                      />

                      {m.codeSnippet && (
                        <div className="rounded-lg bg-slate-900 text-slate-100 p-3.5 space-y-2">
                          <div className="flex items-center justify-between text-xs text-slate-400">
                            <span className="font-mono uppercase">
                              {m.codeLanguage || 'python'}
                            </span>
                            <button
                              type="button"
                              onClick={async () => {
                                await navigator.clipboard.writeText(m.codeSnippet || '');
                                setCopiedCodeKey(key);
                              }}
                              className="inline-flex items-center gap-1 text-slate-300 hover:text-white"
                            >
                              {copiedCodeKey === key ? (
                                <>
                                  <Check className="w-3 h-3 text-emerald-400" />
                                  Copied
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3" />
                                  Copy Code
                                </>
                              )}
                            </button>
                          </div>
                          <pre className="text-xs font-mono overflow-x-auto leading-relaxed">
                            <code>{m.codeSnippet}</code>
                          </pre>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Accent-Cleaned Full Timestamped Transcript */}
          {(activeLecture.fullTranscript || activeLecture.rawExcerpt) && (
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h4 className="text-base font-semibold text-slate-900">
                    Accent-Cleaned Timestamped Transcript
                  </h4>
                  <p className="text-xs text-slate-500">
                    Generated from speech-enhanced 16 kHz audio for clearer accent recognition.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      await navigator.clipboard.writeText(
                        activeLecture.fullTranscript || activeLecture.rawExcerpt || '',
                      );
                      setCopiedTranscript(true);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg whitespace-nowrap"
                  >
                    {copiedTranscript ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-700" />
                        Copied Transcript
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        Copy Transcript
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowTranscript((v) => !v)}
                    className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg whitespace-nowrap"
                  >
                    {showTranscript ? 'Hide Transcript' : 'Show Full Transcript'}
                  </button>
                </div>
              </div>

              {showTranscript && (
                <div className="space-y-3">
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={transcriptSearch}
                      onChange={(e) => setTranscriptSearch(e.target.value)}
                      placeholder="Search transcript for any keyword, topic, or your name..."
                      className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-300 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                    />
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 max-h-96 overflow-y-auto space-y-1.5 text-xs font-mono text-slate-700 leading-relaxed">
                    {transcriptLines.map((line, idx) => (
                      <p key={idx} className="whitespace-pre-wrap">
                        {line}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
