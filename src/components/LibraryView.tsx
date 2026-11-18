import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Edit3,
  FileAudio,
  FileCode2,
  FileText,
  FolderOpen,
  Loader2,
  Plus,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import type {
  ClassworkItem,
  Course,
  LectureAnalysis,
  ModuleGuide,
} from '../types';

export type LibrarySelection =
  | { kind: 'lecture'; id: string }
  | { kind: 'module'; id: string }
  | null;

interface LibraryViewProps {
  courses: Course[];
  lectures: LectureAnalysis[];
  modules: ModuleGuide[];
  selectedItem: LibrarySelection;
  onSelectItem: (item: LibrarySelection) => void;
  onSaveLecture: (lecture: Omit<LectureAnalysis, 'id' | 'createdAt'>) => Promise<string>;
  onSaveModule: (guide: Omit<ModuleGuide, 'id' | 'createdAt'>) => Promise<string>;
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
  courses,
  lectures,
  modules,
  selectedItem,
  onSelectItem,
  onSaveLecture,
  onSaveModule,
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
  const [uploadKind, setUploadKind] = useState<'lecture' | 'module'>('lecture');
  const [courseChoice, setCourseChoice] = useState('AUTO');
  const [titleInput, setTitleInput] = useState('');
  const [lectureDate, setLectureDate] = useState(new Date().toISOString().slice(0, 10));
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [pastedText, setPastedText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

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
  }, [selectedItem?.kind, selectedItem?.id]);

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
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">
          Auto-Organized Study Library
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          Upload downloaded Zoom recordings, transcripts, and course modules. Files are
          automatically organized by course and module topic and tagged with searchable keywords.
        </p>
      </div>

      {/* Unified Upload & Auto-Tagging Card */}
      <form
        onSubmit={handleUploadSubmit}
        className="bg-white border border-slate-200 rounded-xl p-6 space-y-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => {
                setUploadKind('lecture');
                setSelectedFile(null);
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
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                uploadKind === 'module'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Course Module File
            </button>
          </div>

          <span className="text-xs text-slate-500">
            Course, module topic, and keyword tags are detected automatically on upload
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
              <option value="AUTO">Auto-detect course from file</option>
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
              placeholder="Leave blank to auto-name from content"
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
                Organizing &amp; Analyzing...
              </>
            ) : (
              'Analyze, Tag & Organize'
            )}
          </button>
        </div>
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
                  <p className="text-sm text-slate-700 leading-relaxed">
                    {activeLecture.plainEnglishSummary}
                  </p>

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
                          <p className="text-sm text-slate-700 leading-relaxed">
                            {concept.simpleExplanation}
                          </p>
                          <p className="text-xs text-slate-500 leading-relaxed">
                            Example: {concept.analogyOrExample}
                          </p>
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
                                  {idx + 1}. {q.question}
                                </span>
                                {open ? (
                                  <ChevronUp className="w-4 h-4 text-slate-500 shrink-0" />
                                ) : (
                                  <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
                                )}
                              </button>
                              {open && (
                                <p className="text-sm text-slate-700 pt-1 leading-relaxed">
                                  {q.answer}
                                </p>
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
                    <p className="text-sm text-slate-700 leading-relaxed">
                      {activeModule.overview}
                    </p>

                    {activeModule.learningObjectives.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-slate-700 mb-1.5">
                          Learning Objectives:
                        </p>
                        <ul className="list-disc pl-5 space-y-1 text-sm text-slate-600">
                          {activeModule.learningObjectives.map((obj, idx) => (
                            <li key={idx}>{obj}</li>
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
                            <p className="text-sm text-slate-700 leading-relaxed">
                              {topic.plainEnglish}
                            </p>
                            <p className="text-xs font-medium text-blue-800">
                              Key takeaway: {topic.keyTakeaway}
                            </p>
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
                        <p className="text-sm text-slate-700 leading-relaxed">
                          {activeModule.difficultyNote}
                        </p>
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
  );
}
