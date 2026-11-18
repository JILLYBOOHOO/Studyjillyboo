import { useEffect, useRef, useState } from 'react';
import {
  Contrast,
  Keyboard,
  Loader2,
  Mic,
  Moon,
  MousePointer2,
  Puzzle,
  Sparkles,
  Square,
  Sun,
  Type as TypeIcon,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type { Course, SmartNoteCard } from '../types';
import { useAccessibility } from './AccessibilityContext';

interface AccessibilityBarProps {
  courses: Course[];
  activeTabLabel: string;
  onSaveVoiceNote?: (note: Omit<SmartNoteCard, 'id' | 'createdAt'>) => Promise<string | void>;
  onOpenLibraryNotes?: () => void;
  onOpenExtensionHub?: () => void;
}

export function AccessibilityBar({
  courses,
  activeTabLabel,
  onSaveVoiceNote,
  onOpenLibraryNotes,
  onOpenExtensionHub,
}: AccessibilityBarProps) {
  const {
    talkBackEnabled,
    setTalkBackEnabled,
    highContrast,
    setHighContrast,
    largeText,
    setLargeText,
    colorMode,
    toggleColorMode,
    sciFiMode,
    setSciFiMode,
    customCursorEnabled,
    setCustomCursorEnabled,
    speechRate,
    setSpeechRate,
    isSpeaking,
    ttsLoading,
    liveAnnouncement,
    announce,
    speak,
    stopSpeaking,
    shortcutsOpen,
    setShortcutsOpen,
  } = useAccessibility();

  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [voiceNoteStatus, setVoiceNoteStatus] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<number | null>(null);
  const elapsedRef = useRef(0);

  const stopTracks = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
  };

  useEffect(() => {
    return () => {
      stopTracks();
    };
  }, []);

  const handleToggleVoiceNote = async () => {
    if (!onSaveVoiceNote) return;

    if (recording && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setRecording(false);
      return;
    }

    setVoiceNoteStatus(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        throw new Error('Microphone recording is not supported in this browser.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      chunksRef.current = [];
      elapsedRef.current = 0;
      setElapsedSeconds(0);

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        stopTracks();
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        if (blob.size === 0) {
          setVoiceNoteStatus('No audio captured.');
          return;
        }

        setTranscribing(true);
        announce('Transcribing your voice note into a Smart Note.', false);
        try {
          const formData = new FormData();
          formData.append('audio', blob, 'quick_voice_note.webm');
          formData.append('courseCode', 'AUTO');
          formData.append('durationSeconds', String(elapsedRef.current));
          formData.append(
            'courses',
            JSON.stringify(courses.map((c) => ({ code: c.code, title: c.title }))),
          );

          const resp = await fetch('/api/voice-memo/transcribe', {
            method: 'POST',
            body: formData,
          });
          const data = (await resp.json()) as {
            error?: string;
            smartCard?: Omit<SmartNoteCard, 'id' | 'createdAt'>;
          };
          if (!resp.ok || !data.smartCard) {
            throw new Error(data.error || 'Could not transcribe voice note.');
          }

          await onSaveVoiceNote(data.smartCard);
          const msg = `Saved voice note "${data.smartCard.title}" to Library Smart Notes.`;
          setVoiceNoteStatus(msg);
          announce(msg, talkBackEnabled);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : 'Voice-to-note failed.';
          setVoiceNoteStatus(errMsg);
          announce(errMsg, talkBackEnabled);
        } finally {
          setTranscribing(false);
        }
      };

      recorder.start(250);
      setRecording(true);
      announce('Voice-to-note recording started. Speak your note, then press Stop.', talkBackEnabled);

      timerRef.current = window.setInterval(() => {
        elapsedRef.current += 1;
        setElapsedSeconds(elapsedRef.current);
      }, 1000);
    } catch (err) {
      stopTracks();
      const errMsg = err instanceof Error ? err.message : 'Could not access microphone.';
      setVoiceNoteStatus(errMsg);
      announce(errMsg, talkBackEnabled);
    }
  };

  useEffect(() => {
    const onShortcut = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        void handleToggleVoiceNote();
      }
    };
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  });

  const handleReadCurrentView = () => {
    const mainEl = document.getElementById('main-content');
    const headings = Array.from(mainEl?.querySelectorAll('h1, h2') || [])
      .map((h) => h.textContent?.trim())
      .filter(Boolean)
      .slice(0, 4);
    const summaryText = `You are in ${activeTabLabel}. Visible sections: ${headings.join(', ') || 'Workspace content'}. Use Tab to move through controls, or press Shift and Question Mark for keyboard shortcuts.`;
    void speak(summaryText, { hd: true });
  };

  return (
    <>
      <section
        aria-label="Sci-Fi Theme, Accessibility, TalkBack, and Voice-to-Note Controls"
        className={`border-b transition-colors ${
          colorMode === 'dark'
            ? 'bg-slate-950/95 text-slate-100 border-cyan-500/25'
            : 'bg-slate-900 text-slate-100 border-slate-800'
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={toggleColorMode}
              aria-pressed={colorMode === 'dark'}
              aria-label={`Switch to ${colorMode === 'dark' ? 'Light' : 'Dark'} mode (Alt+D)`}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md font-medium transition-colors border ${
                colorMode === 'dark'
                  ? 'bg-cyan-500/20 text-cyan-200 border-cyan-400/40 hover:bg-cyan-500/30'
                  : 'bg-amber-400 text-slate-950 border-amber-300 hover:bg-amber-300'
              }`}
            >
              {colorMode === 'dark' ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
              {colorMode === 'dark' ? 'Dark Mode' : 'Light Mode'}
            </button>

            <button
              type="button"
              onClick={() => {
                const next = !sciFiMode;
                setSciFiMode(next);
                announce(next ? 'Sci-Fi GSAP visual mode enabled.' : 'Minimal mode enabled.');
              }}
              aria-pressed={sciFiMode}
              aria-label="Toggle Sci-Fi GSAP animation and glow mode"
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md font-medium transition-colors border ${
                sciFiMode
                  ? 'bg-indigo-600/80 text-white border-indigo-400/50 hover:bg-indigo-500'
                  : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              Sci-Fi FX
            </button>

            <button
              type="button"
              onClick={() => {
                const next = !customCursorEnabled;
                setCustomCursorEnabled(next);
                announce(next ? 'Custom metallic gold cursor enabled.' : 'Standard OS cursor restored.');
              }}
              aria-pressed={customCursorEnabled}
              aria-label="Toggle custom sci-fi desktop cursor"
              className={`hidden md:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md font-medium transition-colors border ${
                customCursorEnabled
                  ? 'gold-foil-badge'
                  : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700'
              }`}
            >
              <MousePointer2 className="w-3.5 h-3.5" />
              Cursor
            </button>

            <button
              type="button"
              onClick={() => setTalkBackEnabled(!talkBackEnabled)}
              aria-pressed={talkBackEnabled}
              aria-label={
                talkBackEnabled
                  ? 'Turn off TalkBack focus speech reader (Alt+T)'
                  : 'Turn on TalkBack focus speech reader (Alt+T)'
              }
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md font-medium transition-colors ${
                talkBackEnabled
                  ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
                  : 'bg-slate-800 text-slate-100 hover:bg-slate-700'
              }`}
            >
              {talkBackEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
              TalkBack: {talkBackEnabled ? 'On' : 'Off'}
            </button>

            <button
              type="button"
              onClick={isSpeaking ? stopSpeaking : handleReadCurrentView}
              disabled={ttsLoading}
              aria-label={isSpeaking ? 'Stop speaking' : `Read ${activeTabLabel} overview aloud`}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md font-medium bg-slate-800 text-slate-100 hover:bg-slate-700 disabled:opacity-60 transition-colors"
            >
              {ttsLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : isSpeaking ? (
                <Square className="w-3.5 h-3.5 fill-current" />
              ) : (
                <Volume2 className="w-3.5 h-3.5" />
              )}
              {isSpeaking ? 'Stop Speech' : 'Read Page'}
            </button>

            <label className="inline-flex items-center gap-1.5 text-slate-300">
              <span className="sr-only">Speech playback rate</span>
              <select
                aria-label="Speech playback rate"
                value={speechRate}
                onChange={(e) => setSpeechRate(Number(e.target.value))}
                className="bg-slate-800 text-slate-100 border border-slate-700 rounded-md px-2 py-1 text-xs"
              >
                <option value={0.85}>0.85x Slow</option>
                <option value={1}>1.0x Normal</option>
                <option value={1.25}>1.25x Fast</option>
              </select>
            </label>

            <button
              type="button"
              onClick={() => {
                const next = !highContrast;
                setHighContrast(next);
                announce(next ? 'High contrast mode enabled.' : 'High contrast mode disabled.');
              }}
              aria-pressed={highContrast}
              aria-label="Toggle WCAG high contrast mode (Alt+C)"
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md font-medium transition-colors ${
                highContrast
                  ? 'bg-amber-400 text-slate-950'
                  : 'bg-slate-800 text-slate-100 hover:bg-slate-700'
              }`}
            >
              <Contrast className="w-3.5 h-3.5" />
              Contrast
            </button>

            <button
              type="button"
              onClick={() => {
                const next = !largeText;
                setLargeText(next);
                announce(next ? 'Large readable text enabled.' : 'Standard text size restored.');
              }}
              aria-pressed={largeText}
              aria-label="Toggle larger text size"
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md font-medium transition-colors ${
                largeText
                  ? 'bg-blue-500 text-white'
                  : 'bg-slate-800 text-slate-100 hover:bg-slate-700'
              }`}
            >
              <TypeIcon className="w-3.5 h-3.5" />
              Text Size
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            {onOpenExtensionHub && (
              <button
                type="button"
                onClick={onOpenExtensionHub}
                aria-label="Open Chrome Extension download and smart clipper hub"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md font-medium bg-slate-800 text-cyan-200 border border-cyan-500/30 hover:bg-slate-700 transition-colors"
              >
                <Puzzle className="w-3.5 h-3.5" />
                Chrome Extension
              </button>
            )}

            {onSaveVoiceNote && (
              <button
                type="button"
                onClick={() => void handleToggleVoiceNote()}
                disabled={transcribing}
                aria-pressed={recording}
                aria-label="Record a voice note directly into Smart Notes (Alt+V)"
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md font-medium transition-colors ${
                  recording
                    ? 'bg-red-600 text-white hover:bg-red-500'
                    : 'bg-blue-600 text-white hover:bg-blue-500'
                }`}
              >
                {transcribing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : recording ? (
                  <Square className="w-3.5 h-3.5 fill-current" />
                ) : (
                  <Mic className="w-3.5 h-3.5" />
                )}
                {transcribing
                  ? 'Saving Note...'
                  : recording
                    ? `Stop (${Math.floor(elapsedSeconds / 60)}:${String(elapsedSeconds % 60).padStart(2, '0')})`
                    : 'Voice-to-Note'}
              </button>
            )}

            <button
              type="button"
              onClick={() => setShortcutsOpen(true)}
              aria-label="Open keyboard shortcuts guide (Shift+?)"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md font-medium bg-slate-800 text-slate-100 hover:bg-slate-700 transition-colors"
            >
              <Keyboard className="w-3.5 h-3.5" />
              Shortcuts (?)
            </button>
          </div>
        </div>

        {(voiceNoteStatus || (talkBackEnabled && liveAnnouncement)) && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 pb-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-300">
            <span className="truncate">
              {voiceNoteStatus ? voiceNoteStatus : `TalkBack: ${liveAnnouncement}`}
            </span>
            {voiceNoteStatus && onOpenLibraryNotes && (
              <button
                type="button"
                onClick={onOpenLibraryNotes}
                className="underline text-cyan-300 hover:text-cyan-200 font-medium shrink-0"
              >
                Open Smart Notes
              </button>
            )}
          </div>
        )}
      </section>

      {shortcutsOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/70 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="wcag-shortcuts-title"
        >
          <div className="bg-white text-slate-900 border border-slate-200 rounded-xl max-w-lg w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 id="wcag-shortcuts-title" className="text-base font-bold text-slate-900">
                WCAG Keyboard Navigation, Theme &amp; TalkBack Guide
              </h2>
              <button
                type="button"
                onClick={() => setShortcutsOpen(false)}
                aria-label="Close keyboard shortcuts modal"
                className="p-2 rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <ul className="space-y-2 text-sm text-slate-700">
              <li className="flex justify-between gap-4 border-b border-slate-100 pb-1.5">
                <span>Move across interactive buttons &amp; inputs</span>
                <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-300 rounded font-mono text-xs">
                  Tab / Shift+Tab
                </kbd>
              </li>
              <li className="flex justify-between gap-4 border-b border-slate-100 pb-1.5">
                <span>Switch top navigation tabs</span>
                <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-300 rounded font-mono text-xs">
                  Alt + 1 .. 6
                </kbd>
              </li>
              <li className="flex justify-between gap-4 border-b border-slate-100 pb-1.5">
                <span>Switch Dark / Light Mode</span>
                <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-300 rounded font-mono text-xs">
                  Alt + D
                </kbd>
              </li>
              <li className="flex justify-between gap-4 border-b border-slate-100 pb-1.5">
                <span>Toggle TalkBack Focus Reader</span>
                <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-300 rounded font-mono text-xs">
                  Alt + T
                </kbd>
              </li>
              <li className="flex justify-between gap-4 border-b border-slate-100 pb-1.5">
                <span>Start / Stop Voice-to-Note Recording</span>
                <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-300 rounded font-mono text-xs">
                  Alt + V
                </kbd>
              </li>
              <li className="flex justify-between gap-4 border-b border-slate-100 pb-1.5">
                <span>Toggle High Contrast Mode</span>
                <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-300 rounded font-mono text-xs">
                  Alt + C
                </kbd>
              </li>
              <li className="flex justify-between gap-4 border-b border-slate-100 pb-1.5">
                <span>Exit Code Editor (No Keyboard Trap) / Stop Speech</span>
                <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-300 rounded font-mono text-xs">
                  Escape
                </kbd>
              </li>
              <li className="flex justify-between gap-4">
                <span>Inspect 3D Modules in Visual Lab</span>
                <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-300 rounded font-mono text-xs">
                  Arrow Left / Right
                </kbd>
              </li>
            </ul>
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setShortcutsOpen(false)}
                className="px-4 py-2 text-sm font-medium bg-blue-700 text-white rounded-lg hover:bg-blue-800"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
