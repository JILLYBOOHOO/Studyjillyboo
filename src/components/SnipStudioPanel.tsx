import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Bell,
  CalendarPlus,
  Camera,
  Check,
  Circle as CircleIcon,
  Clock,
  Copy,
  Download,
  Eraser,
  Highlighter,
  Image as ImageIcon,
  Loader2,
  Pause,
  Pen,
  Play,
  Plus,
  RotateCcw,
  RotateCw,
  Square,
  Trash2,
  Type as TypeIcon,
  Upload,
  Video,
} from 'lucide-react';
import { ConfirmActionModal } from './ConfirmActionModal';
import type {
  ClassworkItem,
  ClassworkType,
  Course,
  LectureAnalysis,
  ModuleGuide,
  SmartNoteCard,
} from '../types';

type AnnotationTool = 'pen' | 'highlighter' | 'rect' | 'circle' | 'arrow' | 'text' | 'eraser';

interface DrawAction {
  id: string;
  tool: AnnotationTool;
  color: string;
  size: number;
  points?: Array<{ x: number; y: number }>;
  start?: { x: number; y: number };
  end?: { x: number; y: number };
  text?: string;
}

interface ScreenshotActionItem {
  title: string;
  type: ClassworkType;
  dueDate: string;
  estimatedMinutes: number;
  notes: string;
  addedToTracker?: boolean;
}

interface SnipExtractionResult {
  extractedText: string;
  smartCard: Omit<SmartNoteCard, 'id' | 'createdAt'>;
  savedNoteId: string;
  actionItems: ScreenshotActionItem[];
}

interface SnipStudioPanelProps {
  courses: Course[];
  googleToken: string | null;
  onSaveNote: (note: Omit<SmartNoteCard, 'id' | 'createdAt'>) => Promise<string>;
  onSaveModule: (guide: Omit<ModuleGuide, 'id' | 'createdAt'>) => Promise<string>;
  onSaveLecture: (lecture: Omit<LectureAnalysis, 'id' | 'createdAt'>) => Promise<string>;
  onAddTask: (task: Omit<ClassworkItem, 'id' | 'createdAt'>) => Promise<void>;
  onOpenSmartNotebook: () => void;
  onOpenLectureInLibrary: (lectureId: string) => void;
  onAskChatbotWithContext: (courseCode: string, question: string) => void;
}

const SWATCH_COLORS = ['#dc2626', '#1d4ed8', '#ca8a04', '#15803d', '#0f172a', '#ffffff'];

function formatClock(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function playChime() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    [523.25, 659.25, 783.99].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.14);
      gain.gain.setValueAtTime(0.08, now + i * 0.14);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.14 + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.14);
      osc.stop(now + i * 0.14 + 0.36);
    });
  } catch {
    // ignore audio chime errors
  }
}

export function SnipStudioPanel({
  courses,
  googleToken,
  onSaveNote,
  onSaveModule,
  onSaveLecture,
  onAddTask,
  onOpenSmartNotebook,
  onOpenLectureInLibrary,
  onAskChatbotWithContext,
}: SnipStudioPanelProps) {
  // Canvas & Image State
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bgImageRef = useRef<HTMLImageElement | null>(null);
  const [hasBackgroundImage, setHasBackgroundImage] = useState(false);
  const [imageLabel, setImageLabel] = useState('Blank Sketchpad');
  const [tool, setTool] = useState<AnnotationTool>('pen');
  const [color, setColor] = useState('#dc2626');
  const [strokeSize, setStrokeSize] = useState(4);
  const [actions, setActions] = useState<DrawAction[]>([]);
  const [redoStack, setRedoStack] = useState<DrawAction[]>([]);
  const [draftAction, setDraftAction] = useState<DrawAction | null>(null);
  const isDrawingRef = useRef(false);

  // Text Annotation Input
  const [pendingTextPos, setPendingTextPos] = useState<{ x: number; y: number } | null>(null);
  const [pendingTextValue, setPendingTextValue] = useState('');

  // Capture & Screen Recorder State
  const [captureNotice, setCaptureNotice] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isRecPaused, setIsRecPaused] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [analyzingRecording, setAnalyzingRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  // OCR & Smart Categorization State
  const [courseChoice, setCourseChoice] = useState('AUTO');
  const [titleInput, setTitleInput] = useState('');
  const [extraContext, setExtraContext] = useState('');
  const [alsoSaveToLibrary, setAlsoSaveToLibrary] = useState(true);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [result, setResult] = useState<SnipExtractionResult | null>(null);
  const [copiedResult, setCopiedResult] = useState(false);

  // Study Focus Timer State
  const [timerPresetMins, setTimerPresetMins] = useState(25);
  const [timerSecondsLeft, setTimerSecondsLeft] = useState(25 * 60);
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerFinished, setTimerFinished] = useState(false);

  // Quick Reminder State
  const [reminderTitle, setReminderTitle] = useState('');
  const [reminderCourse, setReminderCourse] = useState(courses[0]?.code || 'AIL1001');
  const [reminderDateTime, setReminderDateTime] = useState('');
  const [savingReminder, setSavingReminder] = useState(false);
  const [reminderNotice, setReminderNotice] = useState<string | null>(null);
  const [pendingCalendarConfirm, setPendingCalendarConfirm] = useState(false);
  const [syncingCalendar, setSyncingCalendar] = useState(false);

  // Timer tick
  useEffect(() => {
    if (!timerRunning) return;
    const id = window.setInterval(() => {
      setTimerSecondsLeft((prev) => {
        if (prev <= 1) {
          setTimerRunning(false);
          setTimerFinished(true);
          playChime();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [timerRunning]);

  // Recording elapsed tick
  useEffect(() => {
    if (!isRecording || isRecPaused) return;
    const id = window.setInterval(() => {
      setRecordSeconds((s) => s + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [isRecording, isRecPaused]);

  // Cleanup recording object URL & stream
  useEffect(() => {
    return () => {
      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [recordedUrl]);

  // Draw helper
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (bgImageRef.current) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bgImageRef.current, 0, 0, canvas.width, canvas.height);
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = '#f1f5f9';
      ctx.lineWidth = 1;
      for (let gx = 32; gx < canvas.width; gx += 32) {
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, canvas.height);
        ctx.stroke();
      }
      for (let gy = 32; gy < canvas.height; gy += 32) {
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(canvas.width, gy);
        ctx.stroke();
      }
    }

    const drawItem = (act: DrawAction) => {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (act.tool === 'eraser') {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = act.size * 3.5;
        if (act.points && act.points.length > 0) {
          ctx.beginPath();
          ctx.moveTo(act.points[0].x, act.points[0].y);
          for (let i = 1; i < act.points.length; i++) {
            ctx.lineTo(act.points[i].x, act.points[i].y);
          }
          ctx.stroke();
        }
        ctx.restore();
        return;
      }

      if (act.tool === 'highlighter') {
        ctx.globalAlpha = 0.34;
        ctx.strokeStyle = act.color;
        ctx.lineWidth = Math.max(14, act.size * 3.5);
        if (act.points && act.points.length > 0) {
          ctx.beginPath();
          ctx.moveTo(act.points[0].x, act.points[0].y);
          for (let i = 1; i < act.points.length; i++) {
            ctx.lineTo(act.points[i].x, act.points[i].y);
          }
          ctx.stroke();
        }
        ctx.restore();
        return;
      }

      ctx.strokeStyle = act.color;
      ctx.fillStyle = act.color;
      ctx.lineWidth = act.size;

      if (act.tool === 'pen' && act.points && act.points.length > 0) {
        ctx.beginPath();
        ctx.moveTo(act.points[0].x, act.points[0].y);
        for (let i = 1; i < act.points.length; i++) {
          ctx.lineTo(act.points[i].x, act.points[i].y);
        }
        ctx.stroke();
      } else if (act.tool === 'rect' && act.start && act.end) {
        const w = act.end.x - act.start.x;
        const h = act.end.y - act.start.y;
        ctx.strokeRect(act.start.x, act.start.y, w, h);
      } else if (act.tool === 'circle' && act.start && act.end) {
        const rx = Math.abs(act.end.x - act.start.x) / 2;
        const ry = Math.abs(act.end.y - act.start.y) / 2;
        const cx = (act.start.x + act.end.x) / 2;
        const cy = (act.start.y + act.end.y) / 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (act.tool === 'arrow' && act.start && act.end) {
        const { x: x1, y: y1 } = act.start;
        const { x: x2, y: y2 } = act.end;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        const angle = Math.atan2(y2 - y1, x2 - x1);
        const headLen = Math.max(12, act.size * 3.2);
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
        ctx.stroke();
      } else if (act.tool === 'text' && act.start && act.text) {
        const fontPx = Math.max(16, act.size * 4);
        ctx.font = `600 ${fontPx}px "Plus Jakarta Sans", system-ui, sans-serif`;
        ctx.fillText(act.text, act.start.x, act.start.y);
      }

      ctx.restore();
    };

    for (const act of actions) {
      drawItem(act);
    }
    if (draftAction) {
      drawItem(draftAction);
    }
  }, [actions, draftAction]);

  useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  const loadImageSrcToCanvas = useCallback(
    (src: string, label: string, revokeAfterLoad = false) => {
      const img = new Image();
      img.onload = () => {
        const canvas = canvasRef.current;
        if (canvas) {
          const maxW = 1280;
          const scale = img.width > maxW ? maxW / img.width : 1;
          canvas.width = Math.max(480, Math.round(img.width * scale));
          canvas.height = Math.max(300, Math.round(img.height * scale));
        }
        bgImageRef.current = img;
        setHasBackgroundImage(true);
        setImageLabel(label);
        setActions([]);
        setRedoStack([]);
        setCaptureNotice(null);
        setExtractError(null);
        renderCanvas();
        if (revokeAfterLoad) URL.revokeObjectURL(src);
      };
      img.src = src;
    },
    [renderCanvas],
  );

  const loadFileToCanvas = useCallback(
    (file: File) => {
      if (!file.type.startsWith('image/')) return;
      const url = URL.createObjectURL(file);
      loadImageSrcToCanvas(url, file.name, true);
    },
    [loadImageSrcToCanvas],
  );

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData?.items || []);
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        if (blob) {
          e.preventDefault();
          loadFileToCanvas(new File([blob], `pasted_snip_${Date.now()}.png`, { type: blob.type }));
          return;
        }
      }
    }
  };

  // Capture live screen / tab frame via getDisplayMedia
  const handleCaptureScreen = async () => {
    setCaptureNotice(null);
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setCaptureNotice(
        'Screen capture is unavailable in this browser context. Press Ctrl+V / Cmd+V to paste a screenshot or upload an image file.',
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always' } as MediaTrackConstraints,
        audio: false,
      });
      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      await video.play();

      await new Promise((r) => setTimeout(r, 150));
      const tmp = document.createElement('canvas');
      tmp.width = video.videoWidth || 1280;
      tmp.height = video.videoHeight || 720;
      const ctx = tmp.getContext('2d');
      ctx?.drawImage(video, 0, 0, tmp.width, tmp.height);
      stream.getTracks().forEach((t) => t.stop());

      const dataUrl = tmp.toDataURL('image/png');
      loadImageSrcToCanvas(dataUrl, `Screen Snip (${new Date().toLocaleTimeString()})`);
    } catch {
      setCaptureNotice(
        'Screen capture permission was cancelled or blocked by the embedded preview frame. Use Ctrl+V / Cmd+V to paste a screenshot or upload an image directly.',
      );
    }
  };

  // Start / Pause / Stop Screen Recording
  const handleStartRecording = async () => {
    setCaptureNotice(null);
    if (!navigator.mediaDevices?.getDisplayMedia || typeof MediaRecorder === 'undefined') {
      setCaptureNotice(
        'Live screen recording is unavailable in this browser frame. You can upload any Zoom .mp4/.webm recording in the Study Materials tab.',
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      mediaStreamRef.current = stream;
      recordedChunksRef.current = [];
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : 'video/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          recordedChunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
        setRecordedBlob(blob);
        if (recordedUrl) URL.revokeObjectURL(recordedUrl);
        setRecordedUrl(URL.createObjectURL(blob));
        setIsRecording(false);
        setIsRecPaused(false);
        stream.getTracks().forEach((t) => t.stop());
      };

      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (recorder.state !== 'inactive') recorder.stop();
      });

      recorder.start(500);
      setRecordSeconds(0);
      setRecordedBlob(null);
      if (recordedUrl) {
        URL.revokeObjectURL(recordedUrl);
        setRecordedUrl(null);
      }
      setIsRecording(true);
      setIsRecPaused(false);
    } catch {
      setCaptureNotice(
        'Screen recording could not start (cancelled or blocked by iframe policy). Open the app in a standalone tab to record directly, or upload a recorded file in Study Materials.',
      );
    }
  };

  const handleStopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  const handleTogglePauseRecording = () => {
    const rec = mediaRecorderRef.current;
    if (!rec) return;
    if (rec.state === 'recording') {
      rec.pause();
      setIsRecPaused(true);
    } else if (rec.state === 'paused') {
      rec.resume();
      setIsRecPaused(false);
    }
  };

  const handleAnalyzeRecording = async () => {
    if (!recordedBlob || analyzingRecording) return;
    setAnalyzingRecording(true);
    setCaptureNotice(null);
    try {
      const file = new File([recordedBlob], `screen_recording_${Date.now()}.webm`, {
        type: 'video/webm',
      });
      const formData = new FormData();
      formData.append('courseCode', courseChoice);
      formData.append('courses', JSON.stringify(courses));
      if (titleInput.trim()) formData.append('title', titleInput.trim());
      formData.append('lectureDate', new Date().toISOString().slice(0, 10));
      formData.append('file', file);

      const resp = await fetch('/api/analyze/lecture', { method: 'POST', body: formData });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Could not analyze screen recording.');
      const newId = await onSaveLecture(data);
      onOpenLectureInLibrary(newId);
    } catch (err) {
      setCaptureNotice(err instanceof Error ? err.message : 'Recording analysis failed.');
    } finally {
      setAnalyzingRecording(false);
    }
  };

  // Canvas pointer events
  const getCanvasPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const pt = getCanvasPoint(e);
    if (tool === 'text') {
      setPendingTextPos(pt);
      setPendingTextValue('');
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    isDrawingRef.current = true;
    const id = `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    if (tool === 'pen' || tool === 'highlighter' || tool === 'eraser') {
      setDraftAction({ id, tool, color, size: strokeSize, points: [pt] });
    } else {
      setDraftAction({ id, tool, color, size: strokeSize, start: pt, end: pt });
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current || !draftAction) return;
    const pt = getCanvasPoint(e);
    if (draftAction.points) {
      setDraftAction({ ...draftAction, points: [...draftAction.points, pt] });
    } else {
      setDraftAction({ ...draftAction, end: pt });
    }
  };

  const handlePointerUp = () => {
    if (!isDrawingRef.current || !draftAction) return;
    isDrawingRef.current = false;
    setActions((prev) => [...prev, draftAction]);
    setRedoStack([]);
    setDraftAction(null);
  };

  const handleCommitText = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingTextPos || !pendingTextValue.trim()) {
      setPendingTextPos(null);
      return;
    }
    setActions((prev) => [
      ...prev,
      {
        id: `txt_${Date.now()}`,
        tool: 'text',
        color,
        size: strokeSize,
        start: pendingTextPos,
        text: pendingTextValue.trim(),
      },
    ]);
    setRedoStack([]);
    setPendingTextPos(null);
    setPendingTextValue('');
  };

  const handleDownloadPng = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `studytrack_snip_${Date.now()}.png`;
    a.click();
  };

  const handleClearCanvas = () => {
    setActions([]);
    setRedoStack([]);
    bgImageRef.current = null;
    setHasBackgroundImage(false);
    setImageLabel('Blank Sketchpad');
    if (canvasRef.current) {
      canvasRef.current.width = 960;
      canvasRef.current.height = 540;
    }
    renderCanvas();
  };

  const handleExtractAndAutoSave = async () => {
    const canvas = canvasRef.current;
    if (!canvas || extracting) return;

    if (!hasBackgroundImage && actions.length === 0) {
      setExtractError(
        'Capture, paste (Ctrl+V), upload an image, or draw on the canvas first before extracting text.',
      );
      return;
    }

    setExtractError(null);
    setExtracting(true);
    setCopiedResult(false);

    try {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/png'),
      );
      if (!blob) throw new Error('Could not export canvas image.');

      const file = new File([blob], `snip_capture_${Date.now()}.png`, { type: 'image/png' });
      const formData = new FormData();
      formData.append('courseCode', courseChoice);
      formData.append('courses', JSON.stringify(courses));
      if (titleInput.trim()) formData.append('title', titleInput.trim());
      if (extraContext.trim()) formData.append('extraContext', extraContext.trim());
      formData.append('files', file);

      const resp = await fetch('/api/analyze/screenshot', { method: 'POST', body: formData });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Could not extract text from snip.');

      const smartCardPayload: Omit<SmartNoteCard, 'id' | 'createdAt'> = data.smartCard || {
        courseCode: data.moduleGuide?.courseCode || 'AIL1001',
        title: data.moduleGuide?.title || 'Snip Note',
        cardType: 'note',
        colorTag: 'blue',
        pinned: false,
        content: data.extractedText || '',
        codeLanguage: 'text',
        codeSettings: { theme: 'dark', showLineNumbers: true, wordWrap: false, fontSize: 'md' },
        checklistItems: [],
        keywords: data.moduleGuide?.keywords || [],
        reminderAt: '',
        sourceLabel: `Snip OCR · ${imageLabel}`,
      };

      const savedNoteId = await onSaveNote(smartCardPayload);
      if (alsoSaveToLibrary && data.moduleGuide) {
        await onSaveModule(data.moduleGuide);
      }

      setResult({
        extractedText: String(data.extractedText || ''),
        smartCard: smartCardPayload,
        savedNoteId,
        actionItems: Array.isArray(data.actionItems) ? data.actionItems : [],
      });
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : 'OCR extraction failed.');
    } finally {
      setExtracting(false);
    }
  };

  const handleSaveReminderNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reminderTitle.trim() || savingReminder) return;
    setSavingReminder(true);
    setReminderNotice(null);
    try {
      await onSaveNote({
        courseCode: reminderCourse || 'AIL1001',
        title: reminderTitle.trim(),
        cardType: 'checklist',
        colorTag: 'amber',
        pinned: true,
        content: reminderDateTime
          ? `Study reminder scheduled for ${new Date(reminderDateTime).toLocaleString()}.`
          : 'Pinned study reminder card.',
        codeLanguage: 'text',
        codeSettings: { theme: 'dark', showLineNumbers: true, wordWrap: false, fontSize: 'md' },
        checklistItems: [{ text: reminderTitle.trim(), done: false }],
        keywords: ['reminder', reminderCourse || 'study'],
        reminderAt: reminderDateTime || new Date().toISOString().slice(0, 16),
        sourceLabel: 'Snip Studio Reminder',
      });
      setReminderNotice('Reminder card pinned to your Smart Notebook.');
      setReminderTitle('');
    } finally {
      setSavingReminder(false);
    }
  };

  const handleConfirmCalendarReminder = async () => {
    if (!googleToken || !reminderTitle.trim()) return;
    setSyncingCalendar(true);
    try {
      const startDate = reminderDateTime
        ? new Date(reminderDateTime)
        : new Date(Date.now() + 60 * 60 * 1000);
      const endDate = new Date(startDate.getTime() + 45 * 60 * 1000);
      const resp = await fetch('/api/calendar/events', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${googleToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          summary: `[Study Reminder · ${reminderCourse}] ${reminderTitle.trim()}`,
          description: 'Created from StudyTrack AI Snip & Study Studio.',
          startDateTime: startDate.toISOString(),
          endDateTime: endDate.toISOString(),
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Could not add reminder to Google Calendar.');
      setReminderNotice('Reminder saved to Google Calendar.');
      setPendingCalendarConfirm(false);
    } catch (err) {
      setReminderNotice(err instanceof Error ? err.message : 'Calendar sync failed.');
      setPendingCalendarConfirm(false);
    } finally {
      setSyncingCalendar(false);
    }
  };

  return (
    <div className="space-y-6" onPaste={handlePaste}>
      {/* Top Capture & Recording Controls */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Snip, Annotate &amp; Screen Record Studio
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Snap your school portal, record a demo, annotate with shapes or highlighter, and
              auto-save extracted code or checklists straight into Smart Notebook cards.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleCaptureScreen()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Camera className="w-3.5 h-3.5" />
              Capture Screen
            </button>

            {!isRecording ? (
              <button
                type="button"
                onClick={() => void handleStartRecording()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <Video className="w-3.5 h-3.5 text-red-700" />
                Record Screen
              </button>
            ) : (
              <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5">
                <span className="text-xs font-mono font-semibold text-red-800 tabular-nums">
                  REC {formatClock(recordSeconds)}
                </span>
                <button
                  type="button"
                  onClick={handleTogglePauseRecording}
                  className="text-xs font-medium text-slate-700 hover:text-slate-900 px-1.5 py-0.5 bg-white border border-slate-200 rounded"
                >
                  {isRecPaused ? 'Resume' : 'Pause'}
                </button>
                <button
                  type="button"
                  onClick={handleStopRecording}
                  className="text-xs font-medium text-white bg-red-700 hover:bg-red-800 px-2 py-0.5 rounded"
                >
                  Stop
                </button>
              </div>
            )}

            <label className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer transition-colors whitespace-nowrap shrink-0">
              <Upload className="w-3.5 h-3.5" />
              Upload Image
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) loadFileToCanvas(file);
                }}
                className="hidden"
              />
            </label>
          </div>
        </div>

        {captureNotice && (
          <div
            className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-xs text-amber-900"
            role="status"
          >
            {captureNotice}
          </div>
        )}

        {/* Screen Recording Preview Bar */}
        {recordedUrl && recordedBlob && (
          <div className="border border-slate-200 rounded-xl p-4 bg-slate-50 flex flex-col lg:flex-row lg:items-center gap-4">
            <video
              src={recordedUrl}
              controls
              className="w-full lg:w-72 h-40 rounded-lg bg-slate-900 object-contain border border-slate-200"
            />
            <div className="flex-1 space-y-2">
              <p className="text-sm font-semibold text-slate-900">
                Screen Recording Ready ({(recordedBlob.size / (1024 * 1024)).toFixed(1)} MB)
              </p>
              <p className="text-xs text-slate-600">
                Download your `.webm` clip or send it directly to AI Library analysis to extract key
                concepts, plain-English notes, and tasks.
              </p>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <a
                  href={recordedUrl}
                  download={`studytrack_recording_${Date.now()}.webm`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download .webm
                </a>
                <button
                  type="button"
                  disabled={analyzingRecording}
                  onClick={() => void handleAnalyzeRecording()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg whitespace-nowrap"
                >
                  {analyzingRecording ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Analyzing Recording...
                    </>
                  ) : (
                    'Analyze Recording in Library'
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Snipping Tool Annotation Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200">
          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {[
              { id: 'pen' as const, label: 'Pen', Icon: Pen },
              { id: 'highlighter' as const, label: 'Highlight', Icon: Highlighter },
              { id: 'rect' as const, label: 'Box', Icon: Square },
              { id: 'circle' as const, label: 'Circle', Icon: CircleIcon },
              { id: 'arrow' as const, label: 'Arrow', Icon: ArrowUpRight },
              { id: 'text' as const, label: 'Text', Icon: TypeIcon },
              { id: 'eraser' as const, label: 'Eraser', Icon: Eraser },
            ].map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setTool(id);
                  setPendingTextPos(null);
                }}
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  tool === id
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Color Swatches */}
            <div className="flex items-center gap-1.5" role="group" aria-label="Annotation colors">
              {SWATCH_COLORS.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  onClick={() => setColor(swatch)}
                  aria-label={`Color ${swatch}`}
                  style={{ backgroundColor: swatch }}
                  className={`w-5 h-5 rounded-full border transition-transform ${
                    color === swatch
                      ? 'ring-2 ring-blue-700 ring-offset-1 scale-110 border-slate-400'
                      : 'border-slate-300'
                  }`}
                />
              ))}
            </div>

            {/* Stroke Width */}
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
              {[2, 4, 8].map((sz) => (
                <button
                  key={sz}
                  type="button"
                  onClick={() => setStrokeSize(sz)}
                  className={`px-2 py-1 text-xs font-mono rounded-md tabular-nums ${
                    strokeSize === sz
                      ? 'bg-white text-slate-900 shadow-sm font-semibold'
                      : 'text-slate-600'
                  }`}
                >
                  {sz}px
                </button>
              ))}
            </div>

            {/* Undo / Redo / Download / Clear */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={actions.length === 0}
                onClick={() => {
                  const last = actions[actions.length - 1];
                  if (!last) return;
                  setActions((prev) => prev.slice(0, -1));
                  setRedoStack((prev) => [...prev, last]);
                }}
                aria-label="Undo annotation"
                className="p-2 text-slate-600 hover:text-slate-900 disabled:opacity-40 border border-slate-200 rounded-lg bg-white"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                disabled={redoStack.length === 0}
                onClick={() => {
                  const next = redoStack[redoStack.length - 1];
                  if (!next) return;
                  setRedoStack((prev) => prev.slice(0, -1));
                  setActions((prev) => [...prev, next]);
                }}
                aria-label="Redo annotation"
                className="p-2 text-slate-600 hover:text-slate-900 disabled:opacity-40 border border-slate-200 rounded-lg bg-white"
              >
                <RotateCw className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={handleDownloadPng}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg bg-white whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                Save PNG
              </button>
              <button
                type="button"
                onClick={handleClearCanvas}
                aria-label="Clear canvas"
                className="p-2 text-slate-500 hover:text-red-700 border border-slate-200 rounded-lg bg-white"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Interactive Canvas Area */}
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) loadFileToCanvas(f);
          }}
          className="relative border border-slate-200 rounded-xl overflow-hidden bg-slate-100"
        >
          <div className="px-3.5 py-2 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
            <span className="flex items-center gap-1.5 font-medium text-slate-700">
              <ImageIcon className="w-3.5 h-3.5 text-blue-700" />
              {imageLabel}
            </span>
            <span>
              Tip: Press <span className="font-mono font-semibold">Ctrl+V</span> /{' '}
              <span className="font-mono font-semibold">Cmd+V</span> anywhere here to paste a
              screenshot onto the canvas
            </span>
          </div>

          <div className="relative flex justify-center p-3 overflow-auto max-h-[520px]">
            <canvas
              ref={canvasRef}
              width={960}
              height={540}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              className="max-w-full h-auto bg-white border border-slate-200 rounded shadow-sm touch-none cursor-crosshair"
            />
          </div>

          {pendingTextPos && (
            <form
              onSubmit={handleCommitText}
              className="p-3 bg-white border-t border-slate-200 flex items-center gap-2"
            >
              <input
                type="text"
                autoFocus
                value={pendingTextValue}
                onChange={(e) => setPendingTextValue(e.target.value)}
                placeholder="Type annotation label and press Enter..."
                className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              />
              <button
                type="submit"
                className="px-3 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg whitespace-nowrap"
              >
                Place Text
              </button>
              <button
                type="button"
                onClick={() => setPendingTextPos(null)}
                className="px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
              >
                Cancel
              </button>
            </form>
          )}
        </div>

        {/* OCR Auto-Categorization Bar */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end pt-2">
          <div className="md:col-span-3">
            <label className="block text-xs font-medium text-slate-700 mb-1">Course</label>
            <select
              value={courseChoice}
              onChange={(e) => setCourseChoice(e.target.value)}
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
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Optional Title
            </label>
            <input
              type="text"
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              placeholder="Auto-named from OCR..."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            />
          </div>

          <div className="md:col-span-3">
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Note for AI Scanner
            </label>
            <input
              type="text"
              value={extraContext}
              onChange={(e) => setExtraContext(e.target.value)}
              placeholder="e.g., Save code snippet & explain..."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            />
          </div>

          <div className="md:col-span-3 flex flex-col gap-1.5">
            <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={alsoSaveToLibrary}
                onChange={(e) => setAlsoSaveToLibrary(e.target.checked)}
                className="rounded border-slate-300 text-blue-700"
              />
              Also add breakdown to Study Library
            </label>
            <button
              type="button"
              disabled={extracting}
              onClick={() => void handleExtractAndAutoSave()}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
            >
              {extracting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Extracting &amp; Categorizing...
                </>
              ) : (
                'Extract Text & Auto-Save Card'
              )}
            </button>
          </div>
        </div>

        {extractError && (
          <p className="text-xs font-medium text-red-700" role="alert">
            {extractError}
          </p>
        )}

        {/* Auto-Categorized OCR Result Preview */}
        {result && (
          <div className="pt-4 border-t border-slate-200 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-mono font-semibold text-blue-800">
                  Auto-Categorized as{' '}
                  {result.smartCard.cardType === 'code'
                    ? `Code Snippet (${result.smartCard.codeLanguage.toUpperCase()})`
                    : result.smartCard.cardType === 'checklist'
                      ? 'Interactive Checklist Card'
                      : 'Study Note Card'}{' '}
                  · {result.smartCard.courseCode}
                </p>
                <h3 className="text-base font-semibold text-slate-900">
                  {result.smartCard.title}
                </h3>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={onOpenSmartNotebook}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg whitespace-nowrap"
                >
                  Open in Smart Notebook
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onAskChatbotWithContext(
                      result.smartCard.courseCode,
                      `Explain this extracted ${result.smartCard.cardType === 'code' ? `${result.smartCard.codeLanguage} code` : 'note'} step by step:\n\n${result.smartCard.content.slice(0, 1200)}`,
                    )
                  }
                  className="px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 bg-white hover:bg-slate-50 rounded-lg whitespace-nowrap"
                >
                  Explain in Tutor
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(result.smartCard.content || result.extractedText);
                    setCopiedResult(true);
                  }}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 bg-white hover:bg-slate-50 rounded-lg whitespace-nowrap"
                >
                  {copiedResult ? <Check className="w-3.5 h-3.5 text-emerald-700" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedResult ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>

            {result.smartCard.cardType === 'code' ? (
              <div className="rounded-lg bg-slate-900 text-slate-100 p-4 overflow-x-auto border border-slate-800">
                <div className="flex items-center justify-between text-xs text-slate-400 pb-2 mb-2 border-b border-slate-800">
                  <span className="font-mono uppercase">{result.smartCard.codeLanguage}</span>
                  <span>Formatted Code Card Saved</span>
                </div>
                <pre className="text-xs font-mono leading-relaxed whitespace-pre">
                  {result.smartCard.content}
                </pre>
              </div>
            ) : (
              <div className="rounded-lg bg-slate-50 border border-slate-200 p-4">
                <pre className="text-xs font-mono text-slate-800 whitespace-pre-wrap leading-relaxed">
                  {result.smartCard.content || result.extractedText}
                </pre>
              </div>
            )}

            {result.actionItems.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-700">
                  Deadlines &amp; Tasks Found in Snip
                </p>
                <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg bg-white">
                  {result.actionItems.map((item, idx) => (
                    <div
                      key={idx}
                      className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
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
                          const matched = courses.find((c) => c.code === result.smartCard.courseCode);
                          await onAddTask({
                            courseCode: result.smartCard.courseCode,
                            courseTitle: matched?.title || result.smartCard.courseCode,
                            title: item.title,
                            type: item.type,
                            status: 'Urgent Catch-Up',
                            dueDate: item.dueDate || 'TBD',
                            estimatedMinutes: item.estimatedMinutes || 45,
                            source: 'Smart Note',
                            notes: item.notes || `Extracted from snip "${result.smartCard.title}".`,
                          });
                          setResult((prev) =>
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
                        className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap shrink-0 ${
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
          </div>
        )}
      </div>

      {/* Study Focus Timer & Quick Reminder Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Focus Timer */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-blue-700" />
              <h3 className="text-sm font-semibold text-slate-900">Study Focus Timer</h3>
            </div>
            <div className="flex items-center gap-1">
              {[15, 25, 45].map((mins) => (
                <button
                  key={mins}
                  type="button"
                  onClick={() => {
                    setTimerRunning(false);
                    setTimerFinished(false);
                    setTimerPresetMins(mins);
                    setTimerSecondsLeft(mins * 60);
                  }}
                  className={`px-2 py-1 text-xs font-mono rounded-md tabular-nums ${
                    timerPresetMins === mins
                      ? 'bg-blue-50 text-blue-800 font-semibold'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {mins}m
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 py-2">
            <span className="text-4xl font-mono font-semibold text-slate-900 tabular-nums">
              {formatClock(timerSecondsLeft)}
            </span>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setTimerFinished(false);
                  if (timerSecondsLeft === 0) setTimerSecondsLeft(timerPresetMins * 60);
                  setTimerRunning((r) => !r);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg whitespace-nowrap"
              >
                {timerRunning ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                {timerRunning ? 'Pause' : 'Start'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setTimerRunning(false);
                  setTimerFinished(false);
                  setTimerSecondsLeft(timerPresetMins * 60);
                }}
                className="px-3 py-2 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg"
              >
                Reset
              </button>
            </div>
          </div>

          <p className="text-xs text-slate-500">
            {timerFinished
              ? 'Focus session complete. Take a short 5-minute break before your next block.'
              : 'Runs locally while you annotate screenshots, review modules, or take quizzes.'}
          </p>
        </div>

        {/* Add Study Reminder Card + Optional Calendar Event */}
        <form
          onSubmit={handleSaveReminderNote}
          className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-3"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-amber-700" />
              <h3 className="text-sm font-semibold text-slate-900">Quick Study Reminder</h3>
            </div>
            <span className="text-xs text-slate-500">Pins to Smart Notebook</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
            <input
              type="text"
              value={reminderTitle}
              onChange={(e) => setReminderTitle(e.target.value)}
              placeholder="e.g., Review AIL1002 file handling before Thursday lab"
              className="sm:col-span-6 rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            />
            <select
              value={reminderCourse}
              onChange={(e) => setReminderCourse(e.target.value)}
              className="sm:col-span-3 rounded-lg border border-slate-300 px-2.5 py-2 text-xs text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            >
              {courses.map((c) => (
                <option key={c.id} value={c.code}>
                  {c.code}
                </option>
              ))}
            </select>
            <input
              type="datetime-local"
              value={reminderDateTime}
              onChange={(e) => setReminderDateTime(e.target.value)}
              className="sm:col-span-3 rounded-lg border border-slate-300 px-2.5 py-2 text-xs text-slate-900 tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-emerald-700 font-medium">{reminderNotice || ''}</span>
            <div className="flex items-center gap-2">
              {googleToken && (
                <button
                  type="button"
                  disabled={!reminderTitle.trim()}
                  onClick={() => setPendingCalendarConfirm(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 disabled:opacity-50 rounded-lg whitespace-nowrap"
                >
                  <CalendarPlus className="w-3.5 h-3.5" />
                  Add to Google Calendar
                </button>
              )}
              <button
                type="submit"
                disabled={savingReminder || !reminderTitle.trim()}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                Save Reminder
              </button>
            </div>
          </div>
        </form>
      </div>

      <ConfirmActionModal
        isOpen={pendingCalendarConfirm}
        title="Add Reminder to Google Calendar"
        description="StudyTrack AI will add this 45-minute study reminder block to your primary Google Calendar."
        itemsPreview={[
          `${reminderCourse} · ${reminderTitle || 'Study Reminder'} (${
            reminderDateTime ? new Date(reminderDateTime).toLocaleString() : 'Next hour'
          })`,
        ]}
        confirmLabel="Add Calendar Event"
        busy={syncingCalendar}
        onConfirm={handleConfirmCalendarReminder}
        onCancel={() => setPendingCalendarConfirm(false)}
      />
    </div>
  );
}
