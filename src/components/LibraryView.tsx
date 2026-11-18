import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Edit3,
  FileAudio,
  FileCode2,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  Mic,
  Plus,
  Search,
  Square,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { ExtensionHubPanel } from './ExtensionHubPanel';
import { MathText } from './MathText';
import { SmartNotebookPanel } from './SmartNotebookPanel';
import { SnipStudioPanel } from './SnipStudioPanel';
import { VideoCatchUpPanel } from './VideoCatchUpPanel';
import {
  LiveVoiceVisualizer,
  VoiceMemoResultVisualizer,
} from './VoiceMemoVisualizer';
import type {
  ClassworkItem,
  ClassworkType,
  Course,
  LectureAnalysis,
  ModuleGuide,
  SmartClipAnalysis,
  SmartNoteCard,
} from '../types';

interface ScreenshotActionItem {
  title: string;
  type: ClassworkType;
  dueDate: string;
  estimatedMinutes: number;
  notes: string;
  addedToTracker?: boolean;
}

interface ScreenshotScanResult {
  extractedText: string;
  moduleId: string;
  courseCode: string;
  title: string;
  actionItems: ScreenshotActionItem[];
}

export type LibrarySelection =
  | { kind: 'lecture'; id: string }
  | { kind: 'module'; id: string }
  | null;

export type LibrarySubTab = 'materials' | 'video' | 'snip' | 'notebook' | 'extension';

interface LibraryViewProps {
  studentName: string;
  courses: Course[];
  lectures: LectureAnalysis[];
  modules: ModuleGuide[];
  notes: SmartNoteCard[];
  googleToken: string | null;
  activeSubTab: LibrarySubTab;
  onChangeSubTab: (tab: LibrarySubTab) => void;
  latestExtensionClip: SmartClipAnalysis | null;
  onClearExtensionClip: () => void;
  selectedItem: LibrarySelection;
  onSelectItem: (item: LibrarySelection) => void;
  onSaveLecture: (lecture: Omit<LectureAnalysis, 'id' | 'createdAt'>) => Promise<string>;
  onSaveModule: (guide: Omit<ModuleGuide, 'id' | 'createdAt'>) => Promise<string>;
  onSaveNote: (note: Omit<SmartNoteCard, 'id' | 'createdAt'>) => Promise<string>;
  onUpdateNote: (noteId: string, note: Omit<SmartNoteCard, 'id' | 'createdAt'>) => Promise<void>;
  onDeleteNote: (noteId: string) => Promise<void>;
  onUpdateLectureOrg: (
    lectureId: string,
    updates: { courseCode: string; moduleTopic: string; keywords: string[]; title: string },
  ) => Promise<void>;
  onUpdateModuleOrg: (
    moduleId: string,
    updates: { courseCode: string; moduleTopic: string; keywords: string[]; title: string },
  ) => Promise<void>;
  onMarkLectureActionAdded: (lectureId: string, actionIndex: number) => Promise<void>;
  onAddTask: (task: Omit<ClassworkItem, 'id' | 'createdAt'>) => Promise<void>;
  onDeleteLecture: (lectureId: string) => Promise<void>;
  onDeleteModule: (moduleId: string) => Promise<void>;
  onAskChatbotWithContext: (courseCode: string, question: string) => void;
  onStartCoachWithMaterial: (courseCode: string, materialId: string, topicFocus: string) => void;
  onStartQuizWithMaterial: (courseCode: string, materialId: string, topicFocus: string) => void;
}

export function LibraryView({
  studentName,
  courses,
  lectures,
  modules,
  notes,
  googleToken,
  activeSubTab: librarySubTab,
  onChangeSubTab: setLibrarySubTab,
  latestExtensionClip,
  onClearExtensionClip,
  selectedItem,
  onSelectItem,
  onSaveLecture,
  onSaveModule,
  onSaveNote,
  onUpdateNote,
  onDeleteNote,
  onUpdateLectureOrg,
  onUpdateModuleOrg,
  onMarkLectureActionAdded,
  onAddTask,
  onDeleteLecture,
  onDeleteModule,
  onAskChatbotWithContext,
  onStartCoachWithMaterial,
  onStartQuizWithMaterial,
}: LibraryViewProps) {
  const [uploadKind, setUploadKind] = useState<'lecture' | 'module' | 'screenshot'>('lecture');
  const [courseChoice, setCourseChoice] = useState('AUTO');
  const [titleInput, setTitleInput] = useState('');
  const [lectureDate, setLectureDate] = useState(new Date().toISOString().slice(0, 10));
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [screenshotFiles, setScreenshotFiles] = useState<File[]>([]);
  const [screenshotPreviews, setScreenshotPreviews] = useState<string[]>([]);
  const [pastedText, setPastedText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<ScreenshotScanResult | null>(null);
  const [copiedScanText, setCopiedScanText] = useState(false);
  const [copiedModuleText, setCopiedModuleText] = useState(false);

  // Search & Organization filters
  const [searchQuery, setSearchQuery] = useState('');
  const [courseFilter, setCourseFilter] = useState('ALL');
  const [activeKeyword, setActiveKeyword] = useState<string | null>(null);

  // Detail state
  const [revealedAnswers, setRevealedAnswers] = useState<Record<number, boolean>>({});
  const [editingOrg, setEditingOrg] = useState(false);
  const [editCourse, setEditCourse] = useState('');
  const [editTopic, setEditTopic] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editKeywords, setEditKeywords] = useState('');
  const [savingOrg, setSavingOrg] = useState(false);

  // Voice Memo MediaRecorder + Web Audio & Speech visualization state
  const [voiceState, setVoiceState] = useState<'idle' | 'recording' | 'transcribing'>('idle');
  const [voiceSeconds, setVoiceSeconds] = useState(0);
  const [voiceCourseCode, setVoiceCourseCode] = useState('AUTO');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [activeVoiceStream, setActiveVoiceStream] = useState<MediaStream | null>(null);
  const [liveFinalText, setLiveFinalText] = useState('');
  const [liveInterimText, setLiveInterimText] = useState('');
  const [speechSupported, setSpeechSupported] = useState(false);
  const [voiceSavedResult, setVoiceSavedResult] = useState<{
    audioUrl: string | null;
    audioBlob: Blob | null;
    transcript: string;
    smartCard: Omit<SmartNoteCard, 'id' | 'createdAt'>;
  } | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const speechRecognitionRef = useRef<{ stop: () => void; abort?: () => void } | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const voiceTimerRef = useRef<number | null>(null);
  const voiceSecondsRef = useRef(0);
  const voiceCancelRef = useRef(false);

  const activeLecture =
    selectedItem?.kind === 'lecture'
      ? lectures.find((l) => l.id === selectedItem.id) || null
      : null;
  const activeModule =
    selectedItem?.kind === 'module'
      ? modules.find((m) => m.id === selectedItem.id) || null
      : null;

  useEffect(() => {
    if (!selectedItem) {
      if (lectures[0]) onSelectItem({ kind: 'lecture', id: lectures[0].id });
      else if (modules[0]) onSelectItem({ kind: 'module', id: modules[0].id });
    }
  }, [selectedItem, lectures, modules, onSelectItem]);

  useEffect(() => {
    setEditingOrg(false);
    setRevealedAnswers({});
    setCopiedModuleText(false);
  }, [selectedItem?.kind, selectedItem?.id]);

  useEffect(() => {
    const urls = screenshotFiles.map((file) => URL.createObjectURL(file));
    setScreenshotPreviews(urls);
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [screenshotFiles]);

  useEffect(() => {
    const url = voiceSavedResult?.audioUrl;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [voiceSavedResult?.audioUrl]);

  const cleanupVoiceResources = () => {
    if (voiceTimerRef.current !== null) {
      window.clearInterval(voiceTimerRef.current);
      voiceTimerRef.current = null;
    }
    if (speechRecognitionRef.current) {
      try {
        speechRecognitionRef.current.stop();
      } catch {
        // ignore speech stop errors
      }
      speechRecognitionRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    setActiveVoiceStream(null);
  };

  useEffect(() => {
    return () => {
      voiceCancelRef.current = true;
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try {
          mediaRecorderRef.current.stop();
        } catch {
          // ignore cleanup stop errors
        }
      }
      cleanupVoiceResources();
    };
  }, []);

  const formatMemoTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const rem = secs % 60;
    return `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  };

  const handleStartVoiceMemo = async () => {
    if (voiceState !== 'idle') return;
    setVoiceError(null);
    setVoiceSavedResult(null);
    setLiveFinalText('');
    setLiveInterimText('');

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      setVoiceError(
        'Voice recording is not supported in this browser. Try Chrome, Edge, or Safari over HTTPS.',
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      setActiveVoiceStream(stream);

      const preferredTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus',
        'audio/ogg',
      ];
      const supportedMime =
        typeof MediaRecorder.isTypeSupported === 'function'
          ? preferredTypes.find((t) => MediaRecorder.isTypeSupported(t)) || ''
          : '';

      const recorder = supportedMime
        ? new MediaRecorder(stream, { mimeType: supportedMime })
        : new MediaRecorder(stream);

      audioChunksRef.current = [];
      voiceCancelRef.current = false;
      voiceSecondsRef.current = 0;
      setVoiceSeconds(0);
      mediaRecorderRef.current = recorder;

      // Optional live speech-to-text preview alongside Web Audio waveform
      const SpeechRecCtor =
        (
          window as unknown as {
            SpeechRecognition?: new () => {
              continuous: boolean;
              interimResults: boolean;
              lang: string;
              onresult: ((ev: {
                resultIndex: number;
                results: ArrayLike<{
                  isFinal: boolean;
                  0: { transcript: string };
                }>;
              }) => void) | null;
              onerror: (() => void) | null;
              start: () => void;
              stop: () => void;
            };
            webkitSpeechRecognition?: new () => {
              continuous: boolean;
              interimResults: boolean;
              lang: string;
              onresult: ((ev: {
                resultIndex: number;
                results: ArrayLike<{
                  isFinal: boolean;
                  0: { transcript: string };
                }>;
              }) => void) | null;
              onerror: (() => void) | null;
              start: () => void;
              stop: () => void;
            };
          }
        ).SpeechRecognition ||
        (
          window as unknown as {
            webkitSpeechRecognition?: new () => {
              continuous: boolean;
              interimResults: boolean;
              lang: string;
              onresult: ((ev: {
                resultIndex: number;
                results: ArrayLike<{
                  isFinal: boolean;
                  0: { transcript: string };
                }>;
              }) => void) | null;
              onerror: (() => void) | null;
              start: () => void;
              stop: () => void;
            };
          }
        ).webkitSpeechRecognition;

      if (SpeechRecCtor) {
        try {
          const rec = new SpeechRecCtor();
          rec.continuous = true;
          rec.interimResults = true;
          rec.lang = 'en-US';
          rec.onresult = (event) => {
            let finals = '';
            let interim = '';
            for (let i = 0; i < event.results.length; i++) {
              const res = event.results[i];
              const chunk = res[0]?.transcript || '';
              if (res.isFinal) {
                finals += `${chunk} `;
              } else {
                interim += chunk;
              }
            }
            setLiveFinalText(finals.trim());
            setLiveInterimText(interim.trim());
          };
          rec.onerror = () => {
            // Live preview is supplemental; MediaRecorder + Gemini transcription remains authoritative
          };
          rec.start();
          speechRecognitionRef.current = rec;
          setSpeechSupported(true);
        } catch {
          setSpeechSupported(false);
        }
      } else {
        setSpeechSupported(false);
      }

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        cleanupVoiceResources();
        setVoiceState('idle');
        setVoiceError('Microphone recording encountered an error. Please try again.');
      };

      recorder.onstop = async () => {
        const wasCancelled = voiceCancelRef.current;
        const duration = voiceSecondsRef.current;
        const finalMime = (recorder.mimeType || supportedMime || 'audio/webm').split(';')[0];
        const chunks = audioChunksRef.current;
        audioChunksRef.current = [];
        mediaRecorderRef.current = null;
        cleanupVoiceResources();

        if (wasCancelled) {
          setVoiceState('idle');
          return;
        }

        const audioBlob = new Blob(chunks, { type: finalMime });
        if (audioBlob.size === 0) {
          setVoiceState('idle');
          setVoiceError('No audio was captured. Please check your microphone and try again.');
          return;
        }

        setVoiceState('transcribing');
        try {
          const ext = finalMime.includes('mp4')
            ? 'm4a'
            : finalMime.includes('ogg')
              ? 'ogg'
              : finalMime.includes('wav')
                ? 'wav'
                : 'webm';
          const formData = new FormData();
          formData.append('audio', audioBlob, `voice_memo_${Date.now()}.${ext}`);
          formData.append('courseCode', voiceCourseCode);
          formData.append('durationSeconds', String(duration));
          formData.append(
            'courses',
            JSON.stringify(courses.map((c) => ({ code: c.code, title: c.title }))),
          );

          const resp = await fetch('/api/voice-memo/transcribe', {
            method: 'POST',
            body: formData,
          });
          const data = await resp.json();
          if (!resp.ok) {
            throw new Error(data.error || 'Could not transcribe voice memo.');
          }

          if (data.smartCard) {
            const cardPayload = data.smartCard as Omit<SmartNoteCard, 'id' | 'createdAt'>;
            await onSaveNote(cardPayload);
            const playbackUrl = URL.createObjectURL(audioBlob);
            setVoiceSavedResult({
              audioUrl: playbackUrl,
              audioBlob,
              transcript: String(data.transcript || ''),
              smartCard: cardPayload,
            });
          }
        } catch (err) {
          setVoiceError(
            err instanceof Error ? err.message : 'Failed to transcribe voice memo into a note.',
          );
        } finally {
          setVoiceState('idle');
        }
      };

      recorder.start(250);
      setVoiceState('recording');
      voiceTimerRef.current = window.setInterval(() => {
        voiceSecondsRef.current += 1;
        setVoiceSeconds(voiceSecondsRef.current);
      }, 1000);
    } catch (err) {
      cleanupVoiceResources();
      setVoiceState('idle');
      const domName = err instanceof DOMException ? err.name : '';
      if (domName === 'NotAllowedError' || domName === 'PermissionDeniedError') {
        setVoiceError(
          'Microphone permission was denied. Please allow microphone access in your browser to record a Voice Memo.',
        );
      } else if (domName === 'NotFoundError') {
        setVoiceError('No microphone device was found on this device.');
      } else {
        setVoiceError(
          err instanceof Error ? err.message : 'Could not start Voice Memo recording.',
        );
      }
    }
  };

  const handleStopVoiceMemo = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  const handleCancelVoiceMemo = () => {
    voiceCancelRef.current = true;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    } else {
      cleanupVoiceResources();
      setVoiceState('idle');
    }
  };

  const appendScreenshots = (incoming: File[]) => {
    const imageFiles = incoming.filter((f) => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;
    setScreenshotFiles((prev) => [...prev, ...imageFiles].slice(0, 6));
    setUploadError(null);
  };

  const handlePasteScreenshot = (e: React.ClipboardEvent) => {
    if (uploadKind !== 'screenshot') return;
    const items = Array.from(e.clipboardData?.items || []);
    const pastedImages: File[] = [];
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        if (blob) {
          const ext = blob.type.split('/')[1] || 'png';
          pastedImages.push(
            new File([blob], `portal_screenshot_${Date.now()}.${ext}`, { type: blob.type }),
          );
        }
      }
    }
    if (pastedImages.length > 0) {
      e.preventDefault();
      appendScreenshots(pastedImages);
    }
  };

  // Collect top keywords across all materials for quick tag filtering
  const topKeywords = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of lectures) {
      for (const kw of l.keywords || []) {
        const clean = kw.trim();
        if (clean) counts.set(clean, (counts.get(clean) || 0) + 1);
      }
    }
    for (const m of modules) {
      for (const kw of m.keywords || []) {
        const clean = kw.trim();
        if (clean) counts.set(clean, (counts.get(clean) || 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 14)
      .map(([kw]) => kw);
  }, [lectures, modules]);

  // Unified organized structure: Course -> Module Topic -> Materials
  const organizedGroups = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    type UnifiedItem =
      | { kind: 'lecture'; data: LectureAnalysis }
      | { kind: 'module'; data: ModuleGuide };

    const allItems: UnifiedItem[] = [
      ...lectures.map((l) => ({ kind: 'lecture' as const, data: l })),
      ...modules.map((m) => ({ kind: 'module' as const, data: m })),
    ];

    const filtered = allItems.filter((item) => {
      const d = item.data;
      if (courseFilter !== 'ALL' && d.courseCode !== courseFilter) return false;
      if (
        activeKeyword &&
        !(d.keywords || []).some((k) => k.toLowerCase() === activeKeyword.toLowerCase())
      ) {
        return false;
      }
      if (!q) return true;
      return (
        d.title.toLowerCase().includes(q) ||
        d.courseCode.toLowerCase().includes(q) ||
        d.moduleTopic.toLowerCase().includes(q) ||
        d.fileName.toLowerCase().includes(q) ||
        (d.keywords || []).some((k) => k.toLowerCase().includes(q))
      );
    });

    const courseMap = new Map<string, Map<string, UnifiedItem[]>>();
    for (const item of filtered) {
      const cCode = item.data.courseCode || 'GENERAL';
      const topic = item.data.moduleTopic || 'General Materials';
      if (!courseMap.has(cCode)) courseMap.set(cCode, new Map());
      const topicMap = courseMap.get(cCode)!;
      if (!topicMap.has(topic)) topicMap.set(topic, []);
      topicMap.get(topic)!.push(item);
    }

    return Array.from(courseMap.entries()).map(([cCode, topicMap]) => {
      const courseObj = courses.find((c) => c.code === cCode);
      return {
        courseCode: cCode,
        courseTitle: courseObj?.title || cCode,
        topics: Array.from(topicMap.entries()).map(([topicName, items]) => ({
          topicName,
          items,
        })),
      };
    });
  }, [lectures, modules, courses, searchQuery, courseFilter, activeKeyword]);

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setUploadError(null);

    if (uploadKind === 'screenshot') {
      if (screenshotFiles.length === 0) {
        setUploadError(
          'Upload or paste (Ctrl+V / Cmd+V) at least one portal screenshot image first.',
        );
        return;
      }

      setUploading(true);
      setCopiedScanText(false);
      try {
        const formData = new FormData();
        formData.append('courseCode', courseChoice);
        formData.append('courses', JSON.stringify(courses));
        if (titleInput.trim()) formData.append('title', titleInput.trim());
        if (pastedText.trim()) formData.append('extraContext', pastedText.trim());
        for (const f of screenshotFiles) {
          formData.append('files', f);
        }

        const resp = await fetch('/api/analyze/screenshot', { method: 'POST', body: formData });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'Could not extract text from screenshot.');

        const newId = await onSaveModule(data.moduleGuide);
        if (data.smartCard) {
          await onSaveNote(data.smartCard);
        }
        onSelectItem({ kind: 'module', id: newId });

        setScanResult({
          extractedText: String(data.extractedText || ''),
          moduleId: newId,
          courseCode: String(data.moduleGuide?.courseCode || 'AIL1001'),
          title: String(data.moduleGuide?.title || 'Portal Screenshot'),
          actionItems: Array.isArray(data.actionItems) ? data.actionItems : [],
        });

        setTitleInput('');
        setScreenshotFiles([]);
        setPastedText('');
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : 'Screenshot scan failed.');
      } finally {
        setUploading(false);
      }
      return;
    }

    if (!selectedFile && !pastedText.trim()) {
      setUploadError(
        uploadKind === 'lecture'
          ? 'Choose a Zoom recording/transcript file or paste transcript text.'
          : 'Choose a module file or paste module notes.',
      );
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('courseCode', courseChoice);
      formData.append('courses', JSON.stringify(courses));
      if (titleInput.trim()) formData.append('title', titleInput.trim());
      if (selectedFile) formData.append('file', selectedFile);

      if (uploadKind === 'lecture') {
        formData.append('lectureDate', lectureDate);
        if (pastedText.trim()) formData.append('transcriptText', pastedText.trim());
        const resp = await fetch('/api/analyze/lecture', { method: 'POST', body: formData });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'Failed to analyze Zoom class.');
        const newId = await onSaveLecture(data);
        onSelectItem({ kind: 'lecture', id: newId });
      } else {
        if (pastedText.trim()) formData.append('moduleText', pastedText.trim());
        const resp = await fetch('/api/analyze/module', { method: 'POST', body: formData });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'Failed to analyze module file.');
        const newId = await onSaveModule(data);
        onSelectItem({ kind: 'module', id: newId });
      }

      setTitleInput('');
      setSelectedFile(null);
      setPastedText('');
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const openEditOrganization = () => {
    if (activeLecture) {
      setEditCourse(activeLecture.courseCode);
      setEditTopic(activeLecture.moduleTopic);
      setEditTitle(activeLecture.title);
      setEditKeywords((activeLecture.keywords || []).join(', '));
      setEditingOrg(true);
    } else if (activeModule) {
      setEditCourse(activeModule.courseCode);
      setEditTopic(activeModule.moduleTopic);
      setEditTitle(activeModule.title);
      setEditKeywords((activeModule.keywords || []).join(', '));
      setEditingOrg(true);
    }
  };

  const handleSaveOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    const keywords = editKeywords
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    setSavingOrg(true);
    try {
      if (activeLecture) {
        await onUpdateLectureOrg(activeLecture.id, {
          courseCode: editCourse.trim() || activeLecture.courseCode,
          moduleTopic: editTopic.trim() || 'General Lecture',
          title: editTitle.trim() || activeLecture.title,
          keywords,
        });
      } else if (activeModule) {
        await onUpdateModuleOrg(activeModule.id, {
          courseCode: editCourse.trim() || activeModule.courseCode,
          moduleTopic: editTopic.trim() || 'General Module',
          title: editTitle.trim() || activeModule.title,
          keywords,
        });
      }
      setEditingOrg(false);
    } finally {
      setSavingOrg(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            Study Library, Snip Studio &amp; Smart Notebook
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Organize Zoom recordings and modules, capture or record screens with annotations, and
            save auto-formatted Code Cards, Checklists, and Reminders.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {voiceState === 'recording' ? (
            <div className="inline-flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleStopVoiceMemo}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <Square className="w-3 h-3 fill-current" />
                Stop Memo · <span className="font-mono tabular-nums">{formatMemoTime(voiceSeconds)}</span>
              </button>
              <button
                type="button"
                onClick={handleCancelVoiceMemo}
                className="px-2.5 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white border border-slate-300 rounded-lg transition-colors whitespace-nowrap"
              >
                Cancel
              </button>
            </div>
          ) : voiceState === 'transcribing' ? (
            <button
              type="button"
              disabled
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-blue-800 bg-blue-50 border border-blue-200 rounded-lg whitespace-nowrap shrink-0"
            >
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Transcribing Memo...
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleStartVoiceMemo()}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Mic className="w-3.5 h-3.5" />
              Voice Memo
            </button>
          )}

          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setLibrarySubTab('materials')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                librarySubTab === 'materials'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Study Materials ({lectures.length + modules.length})
            </button>
            <button
              type="button"
              onClick={() => setLibrarySubTab('video')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                librarySubTab === 'video'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Video Catch-Up
            </button>
            <button
              type="button"
              onClick={() => setLibrarySubTab('snip')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                librarySubTab === 'snip'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Snip &amp; Record Studio
            </button>
            <button
              type="button"
              onClick={() => setLibrarySubTab('notebook')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                librarySubTab === 'notebook'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Smart Notebook ({notes.length})
            </button>
            <button
              type="button"
              onClick={() => setLibrarySubTab('extension')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                librarySubTab === 'extension'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Chrome Extension
            </button>
          </div>
        </div>
      </div>

      {voiceState === 'recording' && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-xs text-red-900">
              <Mic className="w-4 h-4 text-red-700 shrink-0" />
              <span className="font-semibold">Recording Voice Memo</span>
              <span className="font-mono tabular-nums text-red-700">
                {formatMemoTime(voiceSeconds)}
              </span>
              <span className="text-red-700 hidden md:inline">
                — Speak study notes, reminders, flashcards, or code ideas, then click Stop Memo.
              </span>
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="voice-memo-course" className="text-[11px] font-medium text-red-800">
                Course:
              </label>
              <select
                id="voice-memo-course"
                value={voiceCourseCode}
                onChange={(e) => setVoiceCourseCode(e.target.value)}
                className="rounded-lg border border-red-200 bg-white px-2.5 py-1 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-500/20"
              >
                <option value="AUTO">Auto-detect course</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.code}>
                    {c.code} · {c.title}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <LiveVoiceVisualizer
            stream={activeVoiceStream}
            elapsedSeconds={voiceSeconds}
            liveFinalText={liveFinalText}
            liveInterimText={liveInterimText}
            speechSupported={speechSupported}
          />
        </div>
      )}

      {voiceError && (
        <div
          className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3 text-xs text-red-800"
          role="alert"
        >
          <span>{voiceError}</span>
          <button
            type="button"
            onClick={() => setVoiceError(null)}
            className="text-red-700 hover:text-red-900 font-medium shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {voiceSavedResult && (
        <VoiceMemoResultVisualizer
          audioUrl={voiceSavedResult.audioUrl}
          audioBlob={voiceSavedResult.audioBlob}
          transcript={voiceSavedResult.transcript}
          smartCard={voiceSavedResult.smartCard}
          onOpenNotebook={
            librarySubTab !== 'notebook' ? () => setLibrarySubTab('notebook') : undefined
          }
          onDismiss={() => setVoiceSavedResult(null)}
        />
      )}

      {librarySubTab === 'video' && (
        <VideoCatchUpPanel
          studentName={studentName}
          courses={courses}
          lectures={lectures}
          onSaveLecture={onSaveLecture}
          onSaveNote={onSaveNote}
          onAddTask={onAddTask}
          onOpenSmartNotebook={() => setLibrarySubTab('notebook')}
        />
      )}

      {librarySubTab === 'snip' && (
        <SnipStudioPanel
          courses={courses}
          googleToken={googleToken}
          onSaveNote={onSaveNote}
          onSaveModule={onSaveModule}
          onSaveLecture={onSaveLecture}
          onAddTask={onAddTask}
          onOpenSmartNotebook={() => setLibrarySubTab('notebook')}
          onOpenLectureInLibrary={(lectureId) => {
            onSelectItem({ kind: 'lecture', id: lectureId });
            setLibrarySubTab('materials');
          }}
          onAskChatbotWithContext={onAskChatbotWithContext}
        />
      )}

      {librarySubTab === 'notebook' && (
        <SmartNotebookPanel
          courses={courses}
          notes={notes}
          onCreateNote={onSaveNote}
          onUpdateNote={onUpdateNote}
          onDeleteNote={onDeleteNote}
          onAddTask={onAddTask}
          onAskChatbotWithContext={onAskChatbotWithContext}
          onStartCoachWithTopic={(courseCode, topicFocus) =>
            onStartCoachWithMaterial(courseCode, '', topicFocus)
          }
        />
      )}

      {librarySubTab === 'extension' && (
        <ExtensionHubPanel
          courses={courses}
          latestExtensionClip={latestExtensionClip}
          onClearExtensionClip={onClearExtensionClip}
          onSaveNote={onSaveNote}
          onAddTask={onAddTask}
          onOpenSmartNotebook={() => setLibrarySubTab('notebook')}
          onStartCoachWithTopic={(courseCode, topicFocus) =>
            onStartCoachWithMaterial(courseCode, '', topicFocus)
          }
        />
      )}

      {librarySubTab === 'materials' && (
        <div className="space-y-8">
      {/* Unified Upload, Screenshot OCR & Auto-Tagging Card */}
      <form
        onSubmit={handleUploadSubmit}
        onPaste={handlePasteScreenshot}
        className="bg-white border border-slate-200 rounded-xl p-6 space-y-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => {
                setUploadKind('lecture');
                setSelectedFile(null);
                setUploadError(null);
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                uploadKind === 'lecture'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Zoom Recording / Transcript
            </button>
            <button
              type="button"
              onClick={() => {
                setUploadKind('module');
                setSelectedFile(null);
                setUploadError(null);
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                uploadKind === 'module'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Course Module File
            </button>
            <button
              type="button"
              onClick={() => {
                setUploadKind('screenshot');
                setSelectedFile(null);
                setUploadError(null);
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                uploadKind === 'screenshot'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Camera className="w-3.5 h-3.5" />
              Portal Screenshot (OCR)
            </button>
          </div>

          <span className="text-xs text-slate-500">
            {uploadKind === 'screenshot'
              ? 'Built-in Lens-style OCR: paste (Ctrl+V / Cmd+V) or upload portal screenshots'
              : 'Course, module topic, and keyword tags are detected automatically on upload'}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Course Assignment
            </label>
            <select
              value={courseChoice}
              onChange={(e) => setCourseChoice(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            >
              <option value="AUTO">Auto-detect course from content</option>
              {courses.map((c) => (
                <option key={c.id} value={c.code}>
                  {c.code} · {c.title}
                </option>
              ))}
            </select>
          </div>

          <div className={uploadKind === 'lecture' ? 'md:col-span-2' : 'md:col-span-3'}>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Optional Title Override
            </label>
            <input
              type="text"
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              placeholder={
                uploadKind === 'screenshot'
                  ? 'e.g., AIL1002 Portal Assignment Instructions'
                  : 'Leave blank to auto-name from content'
              }
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            />
          </div>

          {uploadKind === 'lecture' && (
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">Class Date</label>
              <input
                type="date"
                value={lectureDate}
                onChange={(e) => setLectureDate(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              />
            </div>
          )}
        </div>

        {uploadKind === 'screenshot' ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <label
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  appendScreenshots(Array.from(e.dataTransfer.files || []));
                }}
                className="flex flex-col items-center justify-center border border-dashed border-slate-300 hover:border-blue-600 rounded-xl p-6 bg-slate-50/70 cursor-pointer transition-colors text-center"
              >
                <ImageIcon className="w-6 h-6 text-blue-700 mb-2" />
                <span className="text-sm font-medium text-slate-800">
                  {screenshotFiles.length > 0
                    ? `${screenshotFiles.length} screenshot${screenshotFiles.length === 1 ? '' : 's'} ready to scan`
                    : 'Upload, drop, or paste (Ctrl+V / Cmd+V) portal screenshots'}
                </span>
                <span className="text-xs text-slate-500 mt-1">
                  Snap your school portal, Moodle page, slide, or code error (.png, .jpg, .webp — up
                  to 6 images)
                </span>
                <input
                  type="file"
                  multiple
                  accept="image/*"
                  onChange={(e) => appendScreenshots(Array.from(e.target.files || []))}
                  className="hidden"
                />
              </label>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Optional Note or Question About the Screenshot
                </label>
                <textarea
                  rows={4}
                  value={pastedText}
                  onChange={(e) => setPastedText(e.target.value)}
                  placeholder="Optional: e.g., Extract the assignment steps and explain the Python code shown..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                />
              </div>
            </div>

            {screenshotFiles.length > 0 && (
              <div className="flex flex-wrap gap-3">
                {screenshotFiles.map((f, idx) => (
                  <div
                    key={`${f.name}-${idx}`}
                    className="relative w-32 border border-slate-200 rounded-lg overflow-hidden bg-slate-50"
                  >
                    {screenshotPreviews[idx] && (
                      <img
                        src={screenshotPreviews[idx]}
                        alt={f.name}
                        className="w-full h-20 object-cover"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        setScreenshotFiles((prev) => prev.filter((_, i) => i !== idx))
                      }
                      aria-label={`Remove ${f.name}`}
                      className="absolute top-1 right-1 w-5 h-5 rounded-full bg-slate-900/75 text-white flex items-center justify-center hover:bg-red-700"
                    >
                      <X className="w-3 h-3" />
                    </button>
                    <p className="px-2 py-1 text-xs text-slate-600 truncate">{f.name}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <label className="flex flex-col items-center justify-center border border-dashed border-slate-300 hover:border-blue-600 rounded-xl p-5 bg-slate-50/70 cursor-pointer transition-colors text-center">
              <Upload className="w-6 h-6 text-slate-500 mb-2" />
              <span className="text-sm font-medium text-slate-800">
                {selectedFile
                  ? selectedFile.name
                  : uploadKind === 'lecture'
                    ? 'Choose Zoom video, audio, or transcript'
                    : 'Choose downloaded module file'}
              </span>
              <span className="text-xs text-slate-500 mt-1">
                {uploadKind === 'lecture'
                  ? 'Supports .mp4, .webm, .m4a, .mp3, .wav, .vtt, .srt, .txt'
                  : 'Supports .pdf, .ipynb, .py, .txt, .md, .csv'}
              </span>
              <input
                type="file"
                accept={
                  uploadKind === 'lecture'
                    ? '.vtt,.srt,.txt,.mp4,.webm,.mov,.m4a,.mp3,.wav,.ogg,audio/*,video/*,text/plain'
                    : '.pdf,.ipynb,.py,.txt,.md,.csv,.json,application/pdf,text/plain'
                }
                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                className="hidden"
              />
            </label>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                {uploadKind === 'lecture'
                  ? 'Or paste Zoom transcript text'
                  : 'Or paste module notes / instructions'}
              </label>
              <textarea
                rows={4}
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                placeholder={
                  uploadKind === 'lecture'
                    ? 'Paste Zoom transcript lines here...'
                    : 'Paste sections from your module document here...'
                }
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              />
            </div>
          </div>
        )}

        {uploadError && (
          <p className="text-xs font-medium text-red-700" role="alert">
            {uploadError}
          </p>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={uploading}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            {uploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {uploadKind === 'screenshot'
                  ? 'Extracting Text & Analyzing...'
                  : 'Organizing & Analyzing...'}
              </>
            ) : uploadKind === 'screenshot' ? (
              'Extract Text & Save to Library'
            ) : (
              'Analyze, Tag & Organize'
            )}
          </button>
        </div>

        {/* Immediate Extracted Screenshot Text (OCR) + Tasks Result Card */}
        {scanResult && (
          <div className="pt-5 border-t border-slate-200 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-mono font-semibold text-blue-800">
                  OCR Extracted &amp; Saved under {scanResult.courseCode}
                </p>
                <h2 className="text-base font-semibold text-slate-900">{scanResult.title}</h2>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(scanResult.extractedText);
                    setCopiedScanText(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg whitespace-nowrap"
                >
                  {copiedScanText ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-700" />
                      Copied Text
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      Copy Extracted Text
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setScanResult(null)}
                  className="text-xs text-slate-500 hover:text-slate-900 px-2 py-1"
                >
                  Dismiss
                </button>
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 max-h-64 overflow-y-auto">
              <p className="text-xs font-semibold text-slate-700 mb-2">
                Extracted Text from Screenshot
              </p>
              <pre className="text-xs font-mono text-slate-800 whitespace-pre-wrap leading-relaxed">
                {scanResult.extractedText || '(No readable text detected.)'}
              </pre>
            </div>

            {scanResult.actionItems.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-700">
                  Deadlines &amp; Tasks Detected in Screenshot
                </p>
                <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg bg-white">
                  {scanResult.actionItems.map((item, idx) => (
                    <div
                      key={idx}
                      className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div>
                        <p className="text-sm font-medium text-slate-900">{item.title}</p>
                        <p className="text-xs text-slate-500 tabular-nums">
                          {item.type} · Due {item.dueDate || 'TBD'} · Est. {item.estimatedMinutes}m
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={item.addedToTracker}
                        onClick={async () => {
                          const matched = courses.find((c) => c.code === scanResult.courseCode);
                          await onAddTask({
                            courseCode: scanResult.courseCode,
                            courseTitle: matched?.title || scanResult.courseCode,
                            title: item.title,
                            type: item.type,
                            status: 'Urgent Catch-Up',
                            dueDate: item.dueDate || 'TBD',
                            estimatedMinutes: item.estimatedMinutes || 45,
                            source: 'Module File',
                            notes: `${item.notes ? `${item.notes} ` : ''}(Extracted from portal screenshot "${scanResult.title}").`,
                          });
                          setScanResult((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  actionItems: prev.actionItems.map((a, i) =>
                                    i === idx ? { ...a, addedToTracker: true } : a,
                                  ),
                                }
                              : null,
                          );
                        }}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap shrink-0 ${
                          item.addedToTracker
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-blue-700 text-white hover:bg-blue-800'
                        }`}
                      >
                        {item.addedToTracker ? (
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
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </form>

      {/* Search & Keyword Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by keyword tag, module topic, course code, or filename..."
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-300 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            />
          </div>

          <select
            value={courseFilter}
            onChange={(e) => setCourseFilter(e.target.value)}
            aria-label="Filter library by course"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
          >
            <option value="ALL">All Courses</option>
            {courses.map((c) => (
              <option key={c.id} value={c.code}>
                {c.code} · {c.title}
              </option>
            ))}
          </select>
        </div>

        {topKeywords.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-xs text-slate-500 mr-1">Filter by keyword:</span>
            {activeKeyword && (
              <button
                type="button"
                onClick={() => setActiveKeyword(null)}
                className="px-2.5 py-1 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-md transition-colors whitespace-nowrap"
              >
                Clear ({activeKeyword})
              </button>
            )}
            {topKeywords.map((kw) => {
              const selected = activeKeyword?.toLowerCase() === kw.toLowerCase();
              return (
                <button
                  key={kw}
                  type="button"
                  onClick={() => setActiveKeyword(selected ? null : kw)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    selected
                      ? 'bg-blue-700 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {kw}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Organized Folders (Left) + Material Inspector (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <div className="lg:col-span-4 space-y-4">
          {organizedGroups.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-xs text-slate-500">
              No study materials match your search or tag filter.
            </div>
          ) : (
            organizedGroups.map((group) => (
              <div
                key={group.courseCode}
                className="bg-white border border-slate-200 rounded-xl overflow-hidden"
              >
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-mono font-semibold text-blue-800">
                      {group.courseCode}
                    </p>
                    <p className="text-xs text-slate-600 truncate">{group.courseTitle}</p>
                  </div>
                </div>

                <div className="divide-y divide-slate-200">
                  {group.topics.map((topicGroup) => (
                    <div key={topicGroup.topicName} className="p-3 space-y-2">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 px-1">
                        <FolderOpen className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                        <span className="truncate">{topicGroup.topicName}</span>
                      </div>

                      <div className="space-y-1">
                        {topicGroup.items.map((item) => {
                          const isSelected =
                            selectedItem?.kind === item.kind &&
                            selectedItem.id === item.data.id;
                          return (
                            <div
                              key={`${item.kind}-${item.data.id}`}
                              className={`rounded-lg p-2.5 flex items-start justify-between gap-2 transition-colors ${
                                isSelected ? 'bg-blue-50/80' : 'hover:bg-slate-50'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  onSelectItem({ kind: item.kind, id: item.data.id })
                                }
                                className="text-left min-w-0 flex-1 space-y-1"
                              >
                                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                                  {item.kind === 'lecture' ? (
                                    item.data.sourceType === 'Recording' ? (
                                      <FileAudio className="w-3.5 h-3.5 text-blue-700 shrink-0" />
                                    ) : (
                                      <FileText className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                                    )
                                  ) : (
                                    <FileCode2 className="w-3.5 h-3.5 text-blue-700 shrink-0" />
                                  )}
                                  <span className="truncate">{item.data.fileName}</span>
                                </div>
                                <p className="text-sm font-medium text-slate-900 line-clamp-2">
                                  {item.data.title}
                                </p>
                                {(item.data.keywords || []).length > 0 && (
                                  <p className="text-xs text-slate-500 truncate">
                                    {(item.data.keywords || []).join(' · ')}
                                  </p>
                                )}
                              </button>

                              <button
                                type="button"
                                onClick={() =>
                                  item.kind === 'lecture'
                                    ? onDeleteLecture(item.data.id)
                                    : onDeleteModule(item.data.id)
                                }
                                aria-label={`Delete ${item.data.title}`}
                                className="p-1 text-slate-400 hover:text-red-700 rounded shrink-0"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Material Detail View */}
        <div className="lg:col-span-8">
          {!activeLecture && !activeModule ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-2">
              <FolderOpen className="w-7 h-7 text-slate-400 mx-auto" />
              <p className="text-sm font-medium text-slate-700">
                Select any organized file on the left
              </p>
              <p className="text-xs text-slate-500">
                View plain-English breakdowns, keyword tags, worked examples, and extracted tasks.
              </p>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-7">
              {/* Organization & Metadata Header */}
              <div className="pb-5 border-b border-slate-200 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="font-mono font-semibold text-slate-800">
                        {activeLecture ? activeLecture.courseCode : activeModule?.courseCode}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {activeLecture ? activeLecture.moduleTopic : activeModule?.moduleTopic}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{activeLecture ? activeLecture.fileName : activeModule?.fileName}</span>
                    </div>
                    <h2 className="text-xl font-semibold text-slate-900">
                      {activeLecture ? activeLecture.title : activeModule?.title}
                    </h2>
                    <p className="text-xs text-slate-500">
                      Tags:{' '}
                      {(activeLecture ? activeLecture.keywords : activeModule?.keywords || []).join(
                        ' · ',
                      ) || 'None'}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={openEditOrganization}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg whitespace-nowrap"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      Edit Tags
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const target = activeLecture || activeModule!;
                        onStartCoachWithMaterial(target.courseCode, target.id, target.title);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg whitespace-nowrap"
                    >
                      Mastery Coach
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const target = activeLecture || activeModule!;
                        onStartQuizWithMaterial(target.courseCode, target.id, target.title);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg whitespace-nowrap"
                    >
                      Quiz Me
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onAskChatbotWithContext(
                          activeLecture ? activeLecture.courseCode : activeModule!.courseCode,
                          `Help me understand "${activeLecture ? activeLecture.title : activeModule!.title}" step by step.`,
                        )
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg whitespace-nowrap"
                    >
                      Ask Chatbot
                    </button>
                  </div>
                </div>

                {editingOrg && (
                  <form
                    onSubmit={handleSaveOrg}
                    className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3 mt-3"
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Course Code
                        </label>
                        <input
                          type="text"
                          value={editCourse}
                          onChange={(e) => setEditCourse(e.target.value)}
                          className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs bg-white"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Module Topic Folder
                        </label>
                        <input
                          type="text"
                          value={editTopic}
                          onChange={(e) => setEditTopic(e.target.value)}
                          className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs bg-white"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Title</label>
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Keywords (comma-separated)
                      </label>
                      <input
                        type="text"
                        value={editKeywords}
                        onChange={(e) => setEditKeywords(e.target.value)}
                        className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs bg-white"
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingOrg(false)}
                        className="px-3 py-1 text-xs text-slate-600 hover:bg-slate-200 rounded-md"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={savingOrg}
                        className="px-3 py-1 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md"
                      >
                        {savingOrg ? 'Saving...' : 'Save Organization'}
                      </button>
                    </div>
                  </form>
                )}
              </div>

              {/* Render Lecture Breakdown OR Module Guide */}
              {activeLecture ? (
                <div className="space-y-7">
                  <MathText
                    text={activeLecture.plainEnglishSummary}
                    className="text-sm text-slate-700 leading-relaxed"
                  />

                  {activeLecture.studentNameMentions &&
                    activeLecture.studentNameMentions.length > 0 && (
                      <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 space-y-2">
                        <h3 className="text-xs font-semibold text-slate-900">
                          Your Name Mentioned ({activeLecture.studentNameMentions.length})
                        </h3>
                        <div className="divide-y divide-slate-200 border border-slate-200 rounded-md bg-white">
                          {activeLecture.studentNameMentions.map((m, idx) => (
                            <div key={idx} className="p-3 space-y-0.5 text-xs">
                              <p className="font-semibold text-slate-900">
                                <span className="font-mono text-blue-700 mr-2">[{m.timestamp}]</span>
                                {m.reason}
                              </p>
                              <MathText text={m.context} className="text-slate-600 leading-relaxed" />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                  {activeLecture.tipsAndWarnings && activeLecture.tipsAndWarnings.length > 0 && (
                    <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 space-y-2">
                      <h3 className="text-xs font-semibold text-slate-900">
                        Lecturer Tips &amp; Exam Warnings
                      </h3>
                      <ul className="list-disc pl-5 space-y-1 text-xs text-slate-700 leading-relaxed">
                        {activeLecture.tipsAndWarnings.map((tip, idx) => (
                          <li key={idx}>
                            <MathText text={tip} as="span" />
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {activeLecture.classifiedMoments &&
                    activeLecture.classifiedMoments.length > 0 && (
                      <div className="space-y-2.5">
                        <h3 className="text-sm font-semibold text-slate-900">
                          Timestamped Highlights &amp; Code Shown
                        </h3>
                        <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
                          {activeLecture.classifiedMoments.map((m, idx) => (
                            <div key={idx} className="p-3.5 space-y-1.5">
                              <div className="flex flex-wrap items-center gap-2 text-xs">
                                <span className="font-mono font-semibold text-blue-700 tabular-nums">
                                  [{m.timestamp}]
                                </span>
                                <span className="font-semibold text-slate-700">{m.category}</span>
                                <span aria-hidden="true" className="text-slate-400">
                                  ·
                                </span>
                                <span className="font-semibold text-slate-900">{m.title}</span>
                              </div>
                              <MathText
                                text={m.summary}
                                className="text-xs text-slate-700 leading-relaxed"
                              />
                              {m.codeSnippet && (
                                <pre className="rounded-lg bg-slate-900 text-slate-100 p-3 text-xs font-mono overflow-x-auto leading-relaxed">
                                  <code>{m.codeSnippet}</code>
                                </pre>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                  {activeLecture.actionItems.length > 0 && (
                    <div className="space-y-2.5">
                      <h3 className="text-sm font-semibold text-slate-900">
                        Tasks Mentioned in Class
                      </h3>
                      <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
                        {activeLecture.actionItems.map((item, idx) => (
                          <div
                            key={idx}
                            className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                          >
                            <div>
                              <p className="text-sm font-medium text-slate-900">{item.title}</p>
                              <p className="text-xs text-slate-500 tabular-nums">
                                {item.type} · Due: {item.dueHint} · Est. {item.estimatedMinutes}m
                              </p>
                            </div>
                            <button
                              type="button"
                              disabled={item.addedToTracker}
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
                                  source:
                                    activeLecture.sourceType === 'Recording'
                                      ? 'Zoom Recording'
                                      : 'Zoom Transcript',
                                  notes: `From Zoom class "${activeLecture.title}" (${activeLecture.lectureDate}).`,
                                });
                                await onMarkLectureActionAdded(activeLecture.id, idx);
                              }}
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
                    </div>
                  )}

                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-slate-900">
                      Key Concepts Explained Simply
                    </h3>
                    <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
                      {activeLecture.keyConcepts.map((concept, idx) => (
                        <div key={idx} className="p-4 space-y-1.5">
                          <h4 className="text-sm font-semibold text-slate-900">{concept.term}</h4>
                          <MathText
                            text={concept.simpleExplanation}
                            className="text-sm text-slate-700 leading-relaxed"
                          />
                          <div className="text-xs text-slate-500 leading-relaxed flex items-start gap-1">
                            <span className="font-medium shrink-0">Example:</span>
                            <MathText text={concept.analogyOrExample} as="span" />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {activeLecture.checkQuestions.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="text-sm font-semibold text-slate-900">
                        Quick Understanding Check
                      </h3>
                      <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
                        {activeLecture.checkQuestions.map((q, idx) => {
                          const open = Boolean(revealedAnswers[idx]);
                          return (
                            <div key={idx} className="p-4 space-y-2">
                              <button
                                type="button"
                                onClick={() =>
                                  setRevealedAnswers((prev) => ({ ...prev, [idx]: !prev[idx] }))
                                }
                                className="w-full flex items-center justify-between gap-3 text-left"
                              >
                                <span className="text-sm font-medium text-slate-900">
                                  <span className="mr-1.5">{idx + 1}.</span>
                                  <MathText text={q.question} as="span" />
                                </span>
                                {open ? (
                                  <ChevronUp className="w-4 h-4 text-slate-500 shrink-0" />
                                ) : (
                                  <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
                                )}
                              </button>
                              {open && (
                                <MathText
                                  text={q.answer}
                                  className="text-sm text-slate-700 pt-1 leading-relaxed"
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                activeModule && (
                  <div className="space-y-7">
                    <MathText
                      text={activeModule.overview}
                      className="text-sm text-slate-700 leading-relaxed"
                    />

                    {activeModule.learningObjectives.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-slate-700 mb-1.5">
                          Learning Objectives:
                        </p>
                        <ul className="list-disc pl-5 space-y-1 text-sm text-slate-600">
                          {activeModule.learningObjectives.map((obj, idx) => (
                            <li key={idx}>
                              <MathText text={obj} as="span" />
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="space-y-3">
                      <h3 className="text-sm font-semibold text-slate-900">
                        Topic-by-Topic Breakdown
                      </h3>
                      <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
                        {activeModule.topicBreakdowns.map((topic, idx) => (
                          <div key={idx} className="p-4 space-y-2">
                            <h4 className="text-sm font-semibold text-slate-900">
                              {String(idx + 1).padStart(2, '0')}. {topic.topic}
                            </h4>
                            <MathText
                              text={topic.plainEnglish}
                              className="text-sm text-slate-700 leading-relaxed"
                            />
                            <div className="text-xs font-medium text-blue-800 flex items-start gap-1">
                              <span className="shrink-0">Key takeaway:</span>
                              <MathText text={topic.keyTakeaway} as="span" />
                            </div>
                            {topic.exampleOrCode && (
                              <pre className="rounded-lg bg-slate-900 text-slate-100 p-3.5 text-xs font-mono overflow-x-auto leading-relaxed">
                                <code>{topic.exampleOrCode}</code>
                              </pre>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {activeModule.difficultyNote && (
                      <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 space-y-1">
                        <p className="text-xs font-semibold text-slate-800">
                          Common Stumbling Block Tip
                        </p>
                        <MathText
                          text={activeModule.difficultyNote}
                          className="text-sm text-slate-700 leading-relaxed"
                        />
                      </div>
                    )}

                    {activeModule.extractedTextPreview && (
                      <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-slate-800">
                            Extracted Text / Reference Preview
                          </p>
                          <button
                            type="button"
                            onClick={async () => {
                              await navigator.clipboard.writeText(
                                activeModule.extractedTextPreview,
                              );
                              setCopiedModuleText(true);
                            }}
                            className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline"
                          >
                            {copiedModuleText ? (
                              <>
                                <Check className="w-3 h-3 text-emerald-700" />
                                Copied
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" />
                                Copy Text
                              </>
                            )}
                          </button>
                        </div>
                        <pre className="text-xs font-mono text-slate-700 whitespace-pre-wrap leading-relaxed max-h-56 overflow-y-auto">
                          {activeModule.extractedTextPreview}
                        </pre>
                      </div>
                    )}
                  </div>
                )
              )}
            </div>
          )}
        </div>
      </div>
        </div>
      )}
    </div>
  );
}
