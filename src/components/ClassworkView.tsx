import { useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  Clock,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import type { ClassworkItem, ClassworkStatus, Course } from '../types';

interface ClassworkViewProps {
  tasks: ClassworkItem[];
  courses: Course[];
  onUpdateStatus: (taskId: string, status: ClassworkStatus) => Promise<void>;
  onDeleteTask: (taskId: string) => Promise<void>;
  onOpenAddModal: () => void;
}

const STATUS_FILTERS: Array<'All' | ClassworkStatus> = [
  'All',
  'Urgent Catch-Up',
  'In Progress',
  'Upcoming',
  'Completed',
];

function StatusLabel({ status }: { status: ClassworkStatus }) {
  if (status === 'Urgent Catch-Up') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 whitespace-nowrap">
        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
        Urgent Catch-Up
      </span>
    );
  }
  if (status === 'In Progress') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 whitespace-nowrap">
        <Clock className="w-3.5 h-3.5 shrink-0" />
        In Progress
      </span>
    );
  }
  if (status === 'Completed') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 whitespace-nowrap">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
        Completed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 whitespace-nowrap">
      <Circle className="w-3.5 h-3.5 shrink-0" />
      Upcoming
    </span>
  );
}

export function ClassworkView({
  tasks,
  courses,
  onUpdateStatus,
  onDeleteTask,
  onOpenAddModal,
}: ClassworkViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | ClassworkStatus>('All');
  const [courseFilter, setCourseFilter] = useState('ALL');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filteredTasks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return tasks.filter((task) => {
      if (statusFilter !== 'All' && task.status !== statusFilter) return false;
      if (courseFilter !== 'ALL' && task.courseCode !== courseFilter) return false;
      if (!q) return true;
      return (
        task.title.toLowerCase().includes(q) ||
        task.courseCode.toLowerCase().includes(q) ||
        task.notes.toLowerCase().includes(q)
      );
    });
  }, [tasks, searchQuery, statusFilter, courseFilter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Classwork & Catch-Up Queue</h1>
          <p className="text-sm text-slate-600 mt-1">
            Track every missed Zoom lecture, lab, reading, and assignment in one place.
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenAddModal}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          Add Classwork
        </button>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
          {STATUS_FILTERS.map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setStatusFilter(status)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                statusFilter === status
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {status}
            </button>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search tasks or notes..."
              className="w-full sm:w-56 pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-300 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            />
          </div>

          <select
            value={courseFilter}
            onChange={(e) => setCourseFilter(e.target.value)}
            aria-label="Filter by course"
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
      </div>

      {/* High-Density Classwork Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {filteredTasks.length === 0 ? (
          <div className="py-12 px-6 text-center space-y-3">
            <p className="text-sm font-medium text-slate-700">
              {tasks.length === 0
                ? 'Your classwork tracker is empty.'
                : 'No classwork items match your current filter.'}
            </p>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Add an assignment manually, or extract deadlines automatically from a Zoom lecture or
              Gmail class email.
            </p>
            <button
              type="button"
              onClick={onOpenAddModal}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg"
            >
              <Plus className="w-3.5 h-3.5" />
              Add First Catch-Up Item
            </button>
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            <div className="hidden md:grid md:grid-cols-12 gap-4 px-5 py-3 bg-slate-50 text-xs font-medium text-slate-500">
              <div className="col-span-5">Item & Course</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-2">Due Date</div>
              <div className="col-span-1 text-right">Est.</div>
              <div className="col-span-2 text-right">Update</div>
            </div>

            {filteredTasks.map((task) => {
              const isExpanded = expandedId === task.id;
              return (
                <div key={task.id} className="px-5 py-4 hover:bg-slate-50/70 transition-colors">
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3 md:gap-4 items-center">
                    <div className="md:col-span-5 min-w-0">
                      <button
                        type="button"
                        onClick={() => setExpandedId(isExpanded ? null : task.id)}
                        className="text-left w-full group"
                      >
                        <p
                          className={`text-sm font-medium group-hover:text-blue-700 transition-colors ${
                            task.status === 'Completed'
                              ? 'line-through text-slate-400'
                              : 'text-slate-900'
                          }`}
                        >
                          {task.title}
                        </p>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mt-0.5">
                          <span className="font-mono text-slate-700">{task.courseCode}</span>
                          <span aria-hidden="true">·</span>
                          <span>{task.type}</span>
                          <span aria-hidden="true">·</span>
                          <span>{task.source}</span>
                        </div>
                      </button>
                    </div>

                    <div className="md:col-span-2">
                      <StatusLabel status={task.status} />
                    </div>

                    <div className="md:col-span-2 text-xs font-mono text-slate-600 tabular-nums">
                      {task.dueDate}
                    </div>

                    <div className="md:col-span-1 md:text-right text-xs font-mono text-slate-600 tabular-nums">
                      {task.estimatedMinutes}m
                    </div>

                    <div className="md:col-span-2 flex items-center md:justify-end gap-2">
                      <select
                        value={task.status}
                        aria-label={`Change status for ${task.title}`}
                        onChange={(e) =>
                          onUpdateStatus(task.id, e.target.value as ClassworkStatus)
                        }
                        className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                      >
                        <option value="Urgent Catch-Up">Urgent Catch-Up</option>
                        <option value="In Progress">In Progress</option>
                        <option value="Upcoming">Upcoming</option>
                        <option value="Completed">Completed</option>
                      </select>

                      <button
                        type="button"
                        onClick={() => onDeleteTask(task.id)}
                        aria-label={`Delete ${task.title}`}
                        className="p-1.5 text-slate-400 hover:text-red-700 hover:bg-slate-100 rounded-md transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-3 pt-3 border-t border-slate-200 text-xs text-slate-600 space-y-1">
                      <p className="font-medium text-slate-700">Course: {task.courseTitle}</p>
                      <p>{task.notes ? task.notes : 'No additional notes attached to this item.'}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
