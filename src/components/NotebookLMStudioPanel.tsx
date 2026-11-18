import { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  GitBranch,
  Headphones,
  HelpCircle,
  Layers,
  Loader2,
  RotateCw,
  Volume2,
} from 'lucide-react';
import { MathText } from './MathText';
import type {
  Course,
  LectureAnalysis,
  ModuleGuide,
  NotebookStudioBundle,
  SmartNoteCard,
} from '../types';

interface NotebookLMStudioPanelProps {
  courses: Course[];
  lectures: LectureAnalysis[];
  modules: ModuleGuide[];
  smartNotes: SmartNoteCard[];
  onStartCoachTopic: (courseCode: string, topicFocus: string) => void;
  onStartQuizTopic: (courseCode: string, topicFocus: string) => void;
}

export function NotebookLMStudioPanel({
  courses,
  lectures,
  modules,
  smartNotes,
  onStartCoachTopic,
  onStartQuizTopic,
}: NotebookLMStudioPanelProps) {
  const [courseFilter, setCourseFilter] = useState('ALL');
  const [bundle, setBundle] = useState<NotebookStudioBundle | null>(null);
  const [generating, setGenerating] = useState(false);
  const [studioError, setStudioError] = useState<string | null>(null);
  const [studioMode, setStudioMode] = useState<'audio' | 'mindmap' | 'flashcards'>('audio');

  // Audio Overview TTS state
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [synthesizingAudio, setSynthesizingAudio] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);

  // Mind Map selection state
  const [selectedNode, setSelectedNode] = useState<{
    title: string;
    detail: string;
    courseCode: string;
  } | null>(null);

  // Flashcards state
  const [cardIndex, setCardIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [knownIds, setKnownIds] = useState<string[]>([]);

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const sourceCounts = useMemo(() => {
    const match = (code: string) =>
      courseFilter === 'ALL' || code.toUpperCase() === courseFilter.toUpperCase();
    return {
      lectures: lectures.filter((l) => match(l.courseCode)).length,
      modules: modules.filter((m) => match(m.courseCode)).length,
      notes: smartNotes.filter((n) => match(n.courseCode)).length,
    };
  }, [courseFilter, lectures, modules, smartNotes]);

  const handleGenerateStudio = async () => {
    if (generating) return;
    setStudioError(null);
    setAudioError(null);
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }
    setGenerating(true);

    try {
      const resp = await fetch('/api/studio/notebooklm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseFilter,
          lectures,
          modules,
          smartNotes,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Could not generate NotebookLM Studio bundle.');

      setBundle(data);
      setCardIndex(0);
      setFlipped(false);
      setShowHint(false);
      setKnownIds([]);
      if (data.mindMap?.branches?.[0]) {
        const b = data.mindMap.branches[0];
        setSelectedNode({
          title: b.title,
          detail: b.summary,
          courseCode: b.courseCode || (courseFilter === 'ALL' ? 'AIL1001' : courseFilter),
        });
      }
    } catch (err) {
      setStudioError(err instanceof Error ? err.message : 'Studio generation failed.');
    } finally {
      setGenerating(false);
    }
  };

  const handleSynthesizeAudio = async () => {
    if (!bundle?.podcastDialogue?.length || synthesizingAudio) return;
    setAudioError(null);
    setSynthesizingAudio(true);

    try {
      const resp = await fetch('/api/studio/audio-overview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dialogue: bundle.podcastDialogue }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Audio synthesis failed.');

      const binary = atob(data.audioBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: data.mimeType || 'audio/wav' });
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setAudioUrl(URL.createObjectURL(blob));
    } catch (err) {
      setAudioError(err instanceof Error ? err.message : 'Could not synthesize audio.');
    } finally {
      setSynthesizingAudio(false);
    }
  };

  const activeFlashcard = bundle?.flashcards?.[cardIndex] || null;

  return (
    <div className="space-y-6">
      {/* Studio Control Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              NotebookLM Study Studio
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Turn your Zoom lectures, module guides, and Smart Notebook code/note cards into a
              2-host Audio Overview podcast, interactive Mind Map, and flip Flashcards.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <select
              value={courseFilter}
              onChange={(e) => setCourseFilter(e.target.value)}
              aria-label="Filter NotebookLM Studio course scope"
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            >
              <option value="ALL">All Courses &amp; Smart Cards</option>
              {courses.map((c) => (
                <option key={c.id} value={c.code}>
                  {c.code} · {c.title}
                </option>
              ))}
            </select>

            <button
              type="button"
              disabled={generating}
              onClick={() => void handleGenerateStudio()}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
            >
              {generating ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Building Study Studio...
                </>
              ) : bundle ? (
                'Regenerate Study Studio'
              ) : (
                'Generate Audio, Mind Map & Flashcards'
              )}
            </button>
          </div>
        </div>

        <div className="pt-2 border-t border-slate-200 flex flex-wrap items-center gap-2 text-xs text-slate-600 tabular-nums">
          <BookOpen className="w-3.5 h-3.5 text-blue-700 shrink-0" />
          <span>
            Grounded in {sourceCounts.lectures} Zoom lecture{sourceCounts.lectures === 1 ? '' : 's'}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {sourceCounts.modules} module guide{sourceCounts.modules === 1 ? '' : 's'}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {sourceCounts.notes} Smart Notebook card{sourceCounts.notes === 1 ? '' : 's'}
          </span>
        </div>

        {studioError && (
          <p className="text-xs font-medium text-red-700" role="alert">
            {studioError}
          </p>
        )}
      </div>

      {!bundle ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-4">
          <Headphones className="w-8 h-8 text-blue-700 mx-auto" />
          <div className="max-w-lg mx-auto space-y-1.5">
            <p className="text-base font-semibold text-slate-900">
              Synthesize your course materials into active study formats
            </p>
            <p className="text-xs text-slate-600 leading-relaxed">
              Click Generate above to create an executive Briefing Doc, a 2-host Audio Overview
              podcast you can listen to, a clickable Mind Map of concepts, and flip Flashcards.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Executive Briefing & Mode Switcher */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <p className="text-xs font-mono font-semibold text-blue-800">Study Briefing</p>
                <h3 className="text-lg font-semibold text-slate-900">{bundle.briefingTitle}</h3>
              </div>

              <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg shrink-0">
                <button
                  type="button"
                  onClick={() => setStudioMode('audio')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    studioMode === 'audio'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Headphones className="w-3.5 h-3.5" />
                  Audio Overview
                </button>
                <button
                  type="button"
                  onClick={() => setStudioMode('mindmap')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    studioMode === 'mindmap'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <GitBranch className="w-3.5 h-3.5" />
                  Mind Map
                </button>
                <button
                  type="button"
                  onClick={() => setStudioMode('flashcards')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    studioMode === 'flashcards'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  Flashcards ({bundle.flashcards.length})
                </button>
              </div>
            </div>

            <MathText
              text={bundle.briefingSummary}
              className="text-sm text-slate-700 leading-relaxed"
            />
          </div>

          {/* MODE 1: Audio Overview Podcast */}
          {studioMode === 'audio' && (
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">
                    2-Host Audio Overview (Alex &amp; Sam)
                  </h3>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Listen to a conversational breakdown of your lectures, modules, and code notes.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {audioUrl && (
                    <a
                      href={audioUrl}
                      download="studytrack_audio_overview.wav"
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg whitespace-nowrap"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download WAV
                    </a>
                  )}
                  <button
                    type="button"
                    disabled={synthesizingAudio}
                    onClick={() => void handleSynthesizeAudio()}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg whitespace-nowrap"
                  >
                    {synthesizingAudio ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Synthesizing Dual Voices...
                      </>
                    ) : (
                      <>
                        <Volume2 className="w-3.5 h-3.5" />
                        {audioUrl ? 'Regenerate Audio' : 'Generate Podcast Audio'}
                      </>
                    )}
                  </button>
                </div>
              </div>

              {audioError && (
                <p className="text-xs font-medium text-red-700" role="alert">
                  {audioError}
                </p>
              )}

              {audioUrl && (
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                  <audio controls src={audioUrl} className="w-full" />
                </div>
              )}

              <div className="space-y-3">
                {bundle.podcastDialogue.map((turn, idx) => (
                  <div
                    key={idx}
                    className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/70 space-y-1"
                  >
                    <p
                      className={`text-xs font-semibold ${
                        turn.speaker === 'Alex' ? 'text-blue-800' : 'text-emerald-800'
                      }`}
                    >
                      {turn.speaker}
                    </p>
                    <MathText
                      text={turn.line}
                      className="text-sm text-slate-800 leading-relaxed"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* MODE 2: Interactive Visual Mind Map */}
          {studioMode === 'mindmap' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
                <div className="pb-4 border-b border-slate-200">
                  <p className="text-xs font-mono font-semibold text-blue-800">Central Concept</p>
                  <h3 className="text-lg font-semibold text-slate-900">
                    {bundle.mindMap.rootTitle}
                  </h3>
                  <MathText
                    text={bundle.mindMap.rootSummary}
                    className="text-xs text-slate-600 mt-1"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {bundle.mindMap.branches.map((branch, bIdx) => {
                    const branchSelected = selectedNode?.title === branch.title;
                    return (
                      <div
                        key={bIdx}
                        className="border border-slate-200 rounded-xl p-4 bg-slate-50/60 space-y-3"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedNode({
                              title: branch.title,
                              detail: branch.summary,
                              courseCode: branch.courseCode || 'AIL1001',
                            })
                          }
                          className={`w-full text-left rounded-lg p-2.5 transition-colors border ${
                            branchSelected
                              ? 'bg-blue-700 text-white border-blue-700'
                              : 'bg-white text-slate-900 border-slate-200 hover:border-blue-400'
                          }`}
                        >
                          <p
                            className={`text-[11px] font-mono ${
                              branchSelected ? 'text-blue-100' : 'text-blue-800'
                            }`}
                          >
                            {branch.courseCode}
                          </p>
                          <p className="text-sm font-semibold mt-0.5">{branch.title}</p>
                        </button>

                        <div className="space-y-1.5 pl-3">
                          {branch.children.map((child, cIdx) => {
                            const childSelected = selectedNode?.title === child.label;
                            return (
                              <button
                                key={cIdx}
                                type="button"
                                onClick={() =>
                                  setSelectedNode({
                                    title: child.label,
                                    detail: child.detail,
                                    courseCode: branch.courseCode || 'AIL1001',
                                  })
                                }
                                className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors border ${
                                  childSelected
                                    ? 'bg-blue-50 text-blue-900 border-blue-400'
                                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                                }`}
                              >
                                {child.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                {selectedNode ? (
                  <>
                    <div>
                      <p className="text-xs font-mono font-semibold text-blue-800">
                        {selectedNode.courseCode} · Concept Inspector
                      </p>
                      <h4 className="text-base font-semibold text-slate-900 mt-1">
                        {selectedNode.title}
                      </h4>
                    </div>
                    <MathText
                      text={selectedNode.detail}
                      className="text-sm text-slate-700 leading-relaxed"
                    />
                    <div className="pt-3 border-t border-slate-200 flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          onStartCoachTopic(selectedNode.courseCode, selectedNode.title)
                        }
                        className="w-full px-3.5 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg"
                      >
                        Practice with Mastery Coach
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onStartQuizTopic(selectedNode.courseCode, selectedNode.title)
                        }
                        className="w-full px-3.5 py-2 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg"
                      >
                        Generate Quiz on Concept
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-slate-500">
                    Click any node in the mind map to inspect its explanation and start practicing.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* MODE 3: Flip Flashcards */}
          {studioMode === 'flashcards' && activeFlashcard && (
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5 max-w-2xl mx-auto">
              <div className="flex items-center justify-between gap-3 text-xs text-slate-600 tabular-nums">
                <span>
                  Card {cardIndex + 1} of {bundle.flashcards.length} · {activeFlashcard.courseCode}
                </span>
                <span className="inline-flex items-center gap-1.5 text-emerald-700 font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {knownIds.length} / {bundle.flashcards.length} mastered
                </span>
              </div>

              <button
                type="button"
                onClick={() => setFlipped((f) => !f)}
                className={`w-full min-h-[220px] rounded-xl border p-6 text-left flex flex-col justify-between transition-colors ${
                  flipped
                    ? 'bg-slate-900 border-slate-800 text-white'
                    : 'bg-slate-50 border-slate-200 text-slate-900 hover:border-blue-300'
                }`}
              >
                <div className="flex items-center justify-between text-xs opacity-75">
                  <span className="font-mono uppercase">
                    {flipped ? 'Answer / Explanation' : 'Prompt — Click Card to Flip'}
                  </span>
                  <RotateCw className="w-3.5 h-3.5" />
                </div>

                <MathText
                  text={flipped ? activeFlashcard.back : activeFlashcard.front}
                  as="span"
                  className="block text-base sm:text-lg font-medium leading-relaxed py-4"
                />

                <span className="text-xs opacity-70">
                  {flipped ? 'Click to see question again' : 'Try recalling aloud before flipping'}
                </span>
              </button>

              {showHint && activeFlashcard.hint && (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-1.5">
                  <span className="font-semibold shrink-0">Hint:</span>
                  <MathText text={activeFlashcard.hint} as="span" />
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={cardIndex === 0}
                    onClick={() => {
                      setCardIndex((i) => Math.max(0, i - 1));
                      setFlipped(false);
                      setShowHint(false);
                    }}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 disabled:opacity-40 rounded-lg"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    Prev
                  </button>
                  <button
                    type="button"
                    disabled={cardIndex >= bundle.flashcards.length - 1}
                    onClick={() => {
                      setCardIndex((i) => Math.min(bundle.flashcards.length - 1, i + 1));
                      setFlipped(false);
                      setShowHint(false);
                    }}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 disabled:opacity-40 rounded-lg"
                  >
                    Next
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowHint((h) => !h)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg"
                  >
                    <HelpCircle className="w-3.5 h-3.5" />
                    {showHint ? 'Hide Hint' : 'Hint'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setKnownIds((prev) =>
                        prev.includes(activeFlashcard.id)
                          ? prev.filter((id) => id !== activeFlashcard.id)
                          : [...prev, activeFlashcard.id],
                      );
                    }}
                    className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg ${
                      knownIds.includes(activeFlashcard.id)
                        ? 'bg-emerald-700 text-white'
                        : 'bg-blue-700 text-white hover:bg-blue-800'
                    }`}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {knownIds.includes(activeFlashcard.id) ? 'Mastered' : 'Mark Known'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
