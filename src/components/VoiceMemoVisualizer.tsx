import { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, Volume2 } from 'lucide-react';
import { MathText } from './MathText';
import type { SmartNoteCard } from '../types';

interface LiveVoiceVisualizerProps {
  stream: MediaStream | null;
  elapsedSeconds: number;
  liveFinalText: string;
  liveInterimText: string;
  speechSupported: boolean;
}

export function LiveVoiceVisualizer({
  stream,
  elapsedSeconds,
  liveFinalText,
  liveInterimText,
  speechSupported,
}: LiveVoiceVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [visualMode, setVisualMode] = useState<'waveform' | 'spectrum'>('waveform');
  const [inputLevelPct, setInputLevelPct] = useState(0);

  useEffect(() => {
    if (!stream || typeof window === 'undefined') return;

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    let audioCtx: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let analyser: AnalyserNode | null = null;
    let rafId = 0;
    let disposed = false;

    const prefersReducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    try {
      audioCtx = new AudioCtx();
      if (audioCtx.state === 'suspended') {
        void audioCtx.resume();
      }
      source = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
    } catch {
      return;
    }

    const freqData = new Uint8Array(analyser.frequencyBinCount);
    const timeData = new Uint8Array(analyser.fftSize);
    let lastLevelUpdate = 0;
    let lastFrameTime = 0;

    const draw = (now: number) => {
      if (disposed || !analyser) return;
      rafId = window.requestAnimationFrame(draw);

      if (prefersReducedMotion && now - lastFrameTime < 150) {
        return;
      }
      lastFrameTime = now;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth || 560;
      const height = canvas.clientHeight || 88;
      if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      // Subtle centerline
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.stroke();

      analyser.getByteTimeDomainData(timeData);
      analyser.getByteFrequencyData(freqData);

      // Compute real RMS input level from time-domain samples
      let sumSquares = 0;
      for (let i = 0; i < timeData.length; i++) {
        const normalized = (timeData[i] - 128) / 128;
        sumSquares += normalized * normalized;
      }
      const rms = Math.sqrt(sumSquares / timeData.length);
      const levelPct = Math.min(100, Math.round(rms * 280));
      if (now - lastLevelUpdate > 90) {
        lastLevelUpdate = now;
        setInputLevelPct(levelPct);
      }

      if (visualMode === 'spectrum') {
        const barCount = 44;
        const gap = 3;
        const barWidth = Math.max(3, (width - gap * (barCount - 1)) / barCount);
        const usableBins = Math.min(freqData.length, 64);

        for (let i = 0; i < barCount; i++) {
          const binIdx = Math.floor((i / barCount) * usableBins);
          const amp = freqData[binIdx] / 255;
          const barHeight = Math.max(4, amp * (height - 12));
          const x = i * (barWidth + gap);
          const y = (height - barHeight) / 2;

          ctx.fillStyle = amp > 0.55 ? '#dc2626' : amp > 0.2 ? '#1d4ed8' : '#94a3b8';
          ctx.beginPath();
          ctx.roundRect(x, y, barWidth, barHeight, 2);
          ctx.fill();
        }
      } else {
        // Oscilloscope waveform + subtle filled envelope
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#1d4ed8';
        ctx.beginPath();
        const sliceWidth = width / timeData.length;
        for (let i = 0; i < timeData.length; i++) {
          const v = (timeData[i] - 128) / 128;
          const y = height / 2 + v * (height * 0.42);
          const x = i * sliceWidth;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      ctx.restore();
    };

    rafId = window.requestAnimationFrame(draw);

    return () => {
      disposed = true;
      if (rafId) window.cancelAnimationFrame(rafId);
      try {
        source?.disconnect();
      } catch {
        // ignore disconnect errors
      }
      if (audioCtx && audioCtx.state !== 'closed') {
        void audioCtx.close().catch(() => {});
      }
    };
  }, [stream, visualMode]);

  const combinedText = `${liveFinalText} ${liveInterimText}`.trim();
  const liveWordCount = combinedText ? combinedText.split(/\s+/).length : 0;

  const mins = Math.floor(elapsedSeconds / 60);
  const secs = elapsedSeconds % 60;
  const formattedClock = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 pt-2 border-t border-red-200/80">
      {/* Real-Time Audio Signal Canvas */}
      <div className="lg:col-span-6 bg-white border border-slate-200 rounded-lg p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-slate-700">
            <Volume2 className="w-3.5 h-3.5 text-blue-700" />
            <span className="font-semibold text-slate-900">Audio Signal</span>
            <span aria-hidden="true" className="text-slate-300">·</span>
            <span className="font-mono tabular-nums text-slate-600">
              {formattedClock}
            </span>
            <span aria-hidden="true" className="text-slate-300">·</span>
            <span className="font-mono tabular-nums text-slate-600">
              Level {inputLevelPct}%
            </span>
          </div>

          <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-md">
            <button
              type="button"
              onClick={() => setVisualMode('waveform')}
              className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors ${
                visualMode === 'waveform'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Waveform
            </button>
            <button
              type="button"
              onClick={() => setVisualMode('spectrum')}
              className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors ${
                visualMode === 'spectrum'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Spectrum
            </button>
          </div>
        </div>

        <canvas
          ref={canvasRef}
          aria-label="Live microphone audio waveform visualization"
          className="w-full h-[84px] block rounded bg-slate-50 border border-slate-100"
        />
      </div>

      {/* Real-Time Speech-to-Text Stream */}
      <div className="lg:col-span-6 bg-white border border-slate-200 rounded-lg p-3 flex flex-col justify-between space-y-2">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="font-semibold text-slate-900">Live Speech Preview</span>
          <span className="font-mono tabular-nums text-slate-500">
            {speechSupported ? `${liveWordCount} words` : 'AI transcription on stop'}
          </span>
        </div>

        <div className="min-h-[84px] max-h-[112px] overflow-y-auto rounded bg-slate-50 border border-slate-100 px-3 py-2 text-xs leading-relaxed text-slate-800">
          {!speechSupported ? (
            <p className="text-slate-500">
              Audio waveform is recording cleanly. Full AI transcription and Smart Note formatting
              will run automatically when you click Stop Memo.
            </p>
          ) : combinedText ? (
            <p>
              <span>{liveFinalText}</span>
              {liveFinalText && liveInterimText ? ' ' : ''}
              {liveInterimText && (
                <span className="text-blue-700 italic">{liveInterimText}</span>
              )}
            </p>
          ) : (
            <p className="text-slate-500">
              Start speaking to see live captions appear here while your audio records...
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'have', 'from', 'they', 'will',
  'would', 'there', 'their', 'what', 'about', 'which', 'when', 'make', 'like',
  'just', 'know', 'take', 'into', 'your', 'some', 'could', 'them', 'than',
  'then', 'also', 'need', 'been', 'more', 'very', 'here', 'note', 'memo',
  'voice', 'want', 'should', 'going', 'because', 'were', 'are', 'was', 'you',
  'can', 'all', 'but', 'not', 'use', 'how', 'our', 'has', 'had',
]);

interface VoiceMemoResultVisualizerProps {
  audioUrl: string | null;
  audioBlob: Blob | null;
  transcript: string;
  smartCard: Omit<SmartNoteCard, 'id' | 'createdAt'>;
  onOpenNotebook?: () => void;
  onDismiss: () => void;
}

export function VoiceMemoResultVisualizer({
  audioUrl,
  audioBlob,
  transcript,
  smartCard,
  onOpenNotebook,
  onDismiss,
}: VoiceMemoResultVisualizerProps) {
  const waveformCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  const [peaks, setPeaks] = useState<number[]>([]);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeView, setActiveView] = useState<'card' | 'analysis'>('card');

  // Decode recorded audio blob into normalized amplitude peaks for interactive waveform
  useEffect(() => {
    if (!audioBlob || typeof window === 'undefined') {
      setPeaks([]);
      return;
    }

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    let cancelled = false;
    let audioCtx: AudioContext | null = null;

    (async () => {
      try {
        const buffer = await audioBlob.arrayBuffer();
        audioCtx = new AudioCtx();
        const decoded = await audioCtx.decodeAudioData(buffer.slice(0));
        if (cancelled) return;

        setDuration((prev) => (prev > 0 ? prev : decoded.duration));
        const channel = decoded.getChannelData(0);
        const barCount = 80;
        const blockSize = Math.max(1, Math.floor(channel.length / barCount));
        const computed: number[] = [];

        for (let i = 0; i < barCount; i++) {
          const start = i * blockSize;
          const end = Math.min(channel.length, start + blockSize);
          let maxAmp = 0;
          for (let j = start; j < end; j++) {
            const val = Math.abs(channel[j]);
            if (val > maxAmp) maxAmp = val;
          }
          computed.push(maxAmp);
        }

        const peakMax = Math.max(...computed, 0.05);
        setPeaks(computed.map((p) => Math.max(0.08, p / peakMax)));
      } catch {
        // Fallback flat envelope if browser cannot decode compressed codec offline
        if (!cancelled) {
          setPeaks(Array.from({ length: 64 }, () => 0.25));
        }
      } finally {
        if (audioCtx && audioCtx.state !== 'closed') {
          void audioCtx.close().catch(() => {});
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [audioBlob]);

  // Draw static/playback-synced waveform canvas
  useEffect(() => {
    const canvas = waveformCanvasRef.current;
    if (!canvas || peaks.length === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || 520;
    const height = canvas.clientHeight || 56;
    if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const progressRatio = duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;
    const gap = 2;
    const barWidth = Math.max(2, (width - gap * (peaks.length - 1)) / peaks.length);

    peaks.forEach((amp, idx) => {
      const barRatio = idx / peaks.length;
      const barH = Math.max(4, amp * (height - 10));
      const x = idx * (barWidth + gap);
      const y = (height - barH) / 2;
      ctx.fillStyle = barRatio <= progressRatio ? '#1d4ed8' : '#cbd5e1';
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barH, 1.5);
      ctx.fill();
    });

    ctx.restore();
  }, [peaks, currentTime, duration]);

  const handleTogglePlay = () => {
    const el = audioElRef.current;
    if (!el) return;
    if (el.paused) {
      void el.play();
    } else {
      el.pause();
    }
  };

  const handleSeekWaveform = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const el = audioElRef.current;
    const canvas = waveformCanvasRef.current;
    if (!el || !canvas || !duration) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    el.currentTime = ratio * duration;
    setCurrentTime(el.currentTime);
  };

  const formatSec = (secs: number) => {
    const safe = Math.max(0, Math.floor(secs));
    return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
  };

  // Text analytics derived strictly from the real transcript
  const textStats = useMemo(() => {
    const words = transcript.trim() ? transcript.trim().split(/\s+/) : [];
    const sentences = transcript
      .split(/[.!?]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const freq = new Map<string, number>();
    for (const rawWord of words) {
      const clean = rawWord.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (clean.length < 3 || STOPWORDS.has(clean)) continue;
      freq.set(clean, (freq.get(clean) || 0) + 1);
    }

    const topTerms = Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([term, count]) => ({ term, count }));

    const maxTermCount = topTerms[0]?.count || 1;

    return {
      wordCount: words.length,
      sentenceCount: sentences.length,
      topTerms,
      maxTermCount,
    };
  }, [transcript]);

  // Highlight matched keywords inside transcript segments cleanly
  const highlightedTranscriptParts = useMemo(() => {
    const keywords = (smartCard.keywords || [])
      .map((k) => k.trim())
      .filter((k) => k.length >= 3 && k.toLowerCase() !== 'voice-memo');
    if (keywords.length === 0 || !transcript) return [{ text: transcript, match: false }];

    const escaped = keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const regex = new RegExp(`(${escaped.join('|')})`, 'gi');
    return transcript.split(regex).map((part) => ({
      text: part,
      match: keywords.some((k) => k.toLowerCase() === part.toLowerCase()),
    }));
  }, [transcript, smartCard.keywords]);

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="font-semibold text-emerald-700">Voice Memo Saved</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono font-medium text-slate-800">{smartCard.courseCode}</span>
            <span aria-hidden="true">·</span>
            <span className="capitalize">{smartCard.cardType}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">{textStats.wordCount} words</span>
            {smartCard.reminderAt && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums text-amber-700">
                  Reminder: {smartCard.reminderAt}
                </span>
              </>
            )}
          </div>
          <h3 className="text-base font-semibold text-slate-900">{smartCard.title}</h3>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setActiveView('card')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                activeView === 'card'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Smart Note Card
            </button>
            <button
              type="button"
              onClick={() => setActiveView('analysis')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                activeView === 'analysis'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Text Visualization
            </button>
          </div>

          {onOpenNotebook && (
            <button
              type="button"
              onClick={onOpenNotebook}
              className="px-3 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap"
            >
              Open Smart Notebook
            </button>
          )}
          <button
            type="button"
            onClick={onDismiss}
            className="px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
          >
            Dismiss
          </button>
        </div>
      </div>

      {/* Interactive Playback Waveform */}
      {audioUrl && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 flex items-center gap-3">
          <audio
            ref={audioElRef}
            src={audioUrl}
            onLoadedMetadata={(e) => {
              const d = e.currentTarget.duration;
              if (Number.isFinite(d) && d > 0) setDuration(d);
            }}
            onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={() => {
              setIsPlaying(false);
              setCurrentTime(0);
            }}
            className="hidden"
          />
          <button
            type="button"
            onClick={handleTogglePlay}
            aria-label={isPlaying ? 'Pause recorded voice memo' : 'Play recorded voice memo'}
            className="w-9 h-9 rounded-lg bg-blue-700 hover:bg-blue-800 text-white flex items-center justify-center shrink-0 transition-colors"
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
          </button>

          <canvas
            ref={waveformCanvasRef}
            onClick={handleSeekWaveform}
            title="Click anywhere on waveform to seek"
            aria-label="Recorded voice memo audio waveform"
            className="flex-1 h-[48px] cursor-pointer block"
          />

          <span className="text-xs font-mono tabular-nums text-slate-600 shrink-0">
            {formatSec(currentTime)} / {formatSec(duration)}
          </span>
        </div>
      )}

      {/* Dual Content View: Formatted Smart Card vs Transcript & Keyword Frequency Visualization */}
      {activeView === 'card' ? (
        <div className="space-y-3 pt-1">
          {smartCard.cardType === 'checklist' && smartCard.checklistItems.length > 0 ? (
            <ul className="space-y-1.5 text-sm text-slate-800">
              {smartCard.checklistItems.map((item, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="mt-1 w-3.5 h-3.5 rounded border border-slate-300 shrink-0" />
                  <MathText text={item.text} as="span" />
                </li>
              ))}
            </ul>
          ) : smartCard.cardType === 'code' ? (
            <pre className="rounded-lg bg-slate-900 text-slate-100 p-3.5 text-xs font-mono overflow-x-auto leading-relaxed">
              {smartCard.content}
            </pre>
          ) : (
            <div className="text-sm text-slate-800 leading-relaxed">
              <MathText text={smartCard.content} />
            </div>
          )}

          {smartCard.keywords.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 text-xs text-slate-500">
              <span className="font-medium text-slate-700">Tags:</span>
              {smartCard.keywords.map((kw, idx) => (
                <span key={kw} className="font-mono">
                  #{kw}
                  {idx < smartCard.keywords.length - 1 ? ' ·' : ''}
                </span>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 pt-1">
          {/* Highlighted Transcript */}
          <div className="lg:col-span-7 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-600">
              <span className="font-semibold text-slate-900">
                Highlighted Verbatim Transcript
              </span>
              <span className="font-mono tabular-nums">
                {textStats.sentenceCount} sentences · {textStats.wordCount} words
              </span>
            </div>
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3.5 text-sm leading-relaxed text-slate-800">
              {highlightedTranscriptParts.map((seg, i) =>
                seg.match ? (
                  <mark
                    key={i}
                    className="bg-blue-100 text-blue-900 font-medium px-1 rounded"
                  >
                    {seg.text}
                  </mark>
                ) : (
                  <span key={i}>{seg.text}</span>
                ),
              )}
            </div>
          </div>

          {/* Top Spoken Terms Frequency Bars */}
          <div className="lg:col-span-5 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-600">
              <span className="font-semibold text-slate-900">Key Term Frequency</span>
              <span className="text-slate-500">From spoken memo</span>
            </div>
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3.5 space-y-2.5">
              {textStats.topTerms.length === 0 ? (
                <p className="text-xs text-slate-500">
                  Short memo — speak a few sentences to inspect recurring study terms.
                </p>
              ) : (
                textStats.topTerms.map((item) => {
                  const pct = Math.max(12, Math.round((item.count / textStats.maxTermCount) * 100));
                  return (
                    <div key={item.term} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-slate-800">{item.term}</span>
                        <span className="font-mono tabular-nums text-slate-500">
                          {item.count}×
                        </span>
                      </div>
                      <div className="h-2 w-full rounded bg-slate-200 overflow-hidden">
                        <div
                          className="h-full bg-blue-700 rounded transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
