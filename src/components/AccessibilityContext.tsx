import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

interface SpeakOptions {
  hd?: boolean;
  voiceName?: 'Kore' | 'Puck' | 'Aoede' | 'Charon' | 'Fenrir';
  interrupt?: boolean;
}

interface AccessibilityContextValue {
  talkBackEnabled: boolean;
  setTalkBackEnabled: (enabled: boolean) => void;
  highContrast: boolean;
  setHighContrast: (enabled: boolean) => void;
  largeText: boolean;
  setLargeText: (enabled: boolean) => void;
  colorMode: 'light' | 'dark';
  setColorMode: (mode: 'light' | 'dark') => void;
  toggleColorMode: () => void;
  sciFiMode: boolean;
  setSciFiMode: (enabled: boolean) => void;
  customCursorEnabled: boolean;
  setCustomCursorEnabled: (enabled: boolean) => void;
  speechRate: number;
  setSpeechRate: (rate: number) => void;
  isSpeaking: boolean;
  ttsLoading: boolean;
  liveAnnouncement: string;
  announce: (message: string, shouldSpeak?: boolean) => void;
  speak: (text: string, options?: SpeakOptions) => Promise<void>;
  stopSpeaking: () => void;
  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;
}

const AccessibilityContext = createContext<AccessibilityContextValue | null>(null);

function extractAccessibleElementLabel(el: HTMLElement): string {
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel?.trim()) return ariaLabel.trim();

  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelEl = document.getElementById(labelledBy);
    if (labelEl?.textContent?.trim()) return labelEl.textContent.trim();
  }

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    const id = el.id;
    if (id) {
      const explicitLabel = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (explicitLabel?.textContent?.trim()) {
        const typeLabel =
          el instanceof HTMLSelectElement
            ? 'selector'
            : el instanceof HTMLTextAreaElement
              ? 'text area'
              : el.type || 'input';
        return `${explicitLabel.textContent.trim()}, ${typeLabel}`;
      }
    }
    const placeholder = el.getAttribute('placeholder');
    if (placeholder?.trim()) return placeholder.trim();
  }

  const text = el.innerText?.replace(/\s+/g, ' ').trim();
  if (text && text.length <= 160) return text;
  if (text) return `${text.slice(0, 150)}...`;

  const title = el.getAttribute('title');
  if (title?.trim()) return title.trim();

  const role = el.getAttribute('role') || el.tagName.toLowerCase();
  return `${role} control`;
}

export function AccessibilityProvider({ children }: { children: ReactNode }) {
  const [talkBackEnabled, setTalkBackEnabledState] = useState(false);
  const [highContrast, setHighContrast] = useState(false);
  const [largeText, setLargeText] = useState(false);
  const [colorMode, setColorMode] = useState<'light' | 'dark'>('dark');
  const [sciFiMode, setSciFiMode] = useState(true);
  const [customCursorEnabled, setCustomCursorEnabled] = useState(true);
  const [speechRate, setSpeechRate] = useState(1);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [ttsLoading, setTtsLoading] = useState(false);
  const [liveAnnouncement, setLiveAnnouncement] = useState('');
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  const stopSpeaking = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    setIsSpeaking(false);
    setTtsLoading(false);
  }, []);

  const speakWithBrowser = useCallback(
    (text: string, interrupt = true) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
      const clean = text.replace(/[`*_#<>]/g, ' ').replace(/\s+/g, ' ').trim();
      if (!clean) return;
      if (interrupt) {
        window.speechSynthesis.cancel();
      }
      const utterance = new SpeechSynthesisUtterance(clean);
      utterance.rate = speechRate;
      utterance.lang = 'en-US';
      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);
      window.speechSynthesis.speak(utterance);
    },
    [speechRate],
  );

  const speak = useCallback(
    async (text: string, options?: SpeakOptions) => {
      const clean = text.replace(/[`*_#]/g, ' ').replace(/\s+/g, ' ').trim();
      if (!clean) return;
      setLiveAnnouncement(clean.slice(0, 260));

      if (options?.interrupt !== false) {
        stopSpeaking();
      }

      if (options?.hd) {
        setTtsLoading(true);
        try {
          const resp = await fetch('/api/tts/speak', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: clean.slice(0, 3200),
              voiceName: options.voiceName || 'Kore',
            }),
          });
          if (resp.ok) {
            const data = (await resp.json()) as { audioBase64?: string; mimeType?: string };
            if (data.audioBase64) {
              const bin = atob(data.audioBase64);
              const bytes = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) {
                bytes[i] = bin.charCodeAt(i);
              }
              const blob = new Blob([bytes], { type: data.mimeType || 'audio/wav' });
              const url = URL.createObjectURL(blob);
              audioUrlRef.current = url;
              const audio = new Audio(url);
              audio.playbackRate = speechRate;
              audioRef.current = audio;
              audio.onended = () => {
                setIsSpeaking(false);
              };
              audio.onerror = () => {
                setIsSpeaking(false);
              };
              setTtsLoading(false);
              setIsSpeaking(true);
              await audio.play();
              return;
            }
          }
        } catch {
          // Gracefully fall back to browser Web Speech API
        } finally {
          setTtsLoading(false);
        }
      }

      speakWithBrowser(clean, options?.interrupt !== false);
    },
    [speechRate, speakWithBrowser, stopSpeaking],
  );

  const announce = useCallback(
    (message: string, shouldSpeak?: boolean) => {
      const clean = message.trim();
      if (!clean) return;
      setLiveAnnouncement(clean);
      if (shouldSpeak ?? talkBackEnabled) {
        speakWithBrowser(clean, true);
      }
    },
    [speakWithBrowser, talkBackEnabled],
  );

  const setTalkBackEnabled = useCallback(
    (enabled: boolean) => {
      setTalkBackEnabledState(enabled);
      if (enabled) {
        const msg =
          'TalkBack focus reader enabled. Use Tab or Arrow keys to navigate and hear controls spoken aloud.';
        setLiveAnnouncement(msg);
        speakWithBrowser(msg, true);
      } else {
        stopSpeaking();
        setLiveAnnouncement('TalkBack focus reader paused.');
      }
    },
    [speakWithBrowser, stopSpeaking],
  );

  const toggleColorMode = useCallback(() => {
    setColorMode((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      announce(next === 'dark' ? 'Dark sci-fi mode enabled.' : 'Light mode enabled.');
      return next;
    });
  }, [announce]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('wcag-high-contrast', highContrast);
    root.classList.toggle('wcag-large-text', largeText);
    root.classList.toggle('dark', colorMode === 'dark');
    root.classList.toggle('scifi-theme', sciFiMode);
  }, [colorMode, highContrast, largeText, sciFiMode]);

  useEffect(() => {
    if (!talkBackEnabled) return;

    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.dataset.skipTalkback === 'true') return;

      const label = extractAccessibleElementLabel(target);
      const role = target.getAttribute('role');
      const isTab = role === 'tab';
      const isSelected = target.getAttribute('aria-selected') === 'true' || target.getAttribute('aria-current') === 'page';
      const prefix = isTab ? (isSelected ? 'Selected tab: ' : 'Tab: ') : '';
      const spoken = `${prefix}${label}`;
      setLiveAnnouncement(spoken);
      speakWithBrowser(spoken, true);
    };

    document.addEventListener('focusin', handleFocusIn);
    return () => document.removeEventListener('focusin', handleFocusIn);
  }, [talkBackEnabled, speakWithBrowser]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const inEditable =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;

      if (event.key === '?' && event.shiftKey && !inEditable) {
        event.preventDefault();
        setShortcutsOpen((prev) => !prev);
      } else if (event.altKey && event.key.toLowerCase() === 't') {
        event.preventDefault();
        setTalkBackEnabled(!talkBackEnabled);
      } else if (event.altKey && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        toggleColorMode();
      } else if (event.altKey && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        setHighContrast((prev) => {
          const next = !prev;
          announce(next ? 'High contrast mode on.' : 'High contrast mode off.');
          return next;
        });
      } else if (event.key === 'Escape') {
        if (shortcutsOpen) {
          setShortcutsOpen(false);
        } else if (isSpeaking) {
          stopSpeaking();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [announce, isSpeaking, setTalkBackEnabled, shortcutsOpen, stopSpeaking, talkBackEnabled, toggleColorMode]);

  useEffect(() => {
    return () => {
      stopSpeaking();
    };
  }, [stopSpeaking]);

  return (
    <AccessibilityContext.Provider
      value={{
        talkBackEnabled,
        setTalkBackEnabled,
        highContrast,
        setHighContrast,
        largeText,
        setLargeText,
        colorMode,
        setColorMode,
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
      }}
    >
      {children}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {liveAnnouncement}
      </div>
    </AccessibilityContext.Provider>
  );
}

export function useAccessibility(): AccessibilityContextValue {
  const ctx = useContext(AccessibilityContext);
  if (!ctx) {
    throw new Error('useAccessibility must be used inside AccessibilityProvider');
  }
  return ctx;
}
