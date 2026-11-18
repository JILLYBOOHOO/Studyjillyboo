import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { GoogleGenAI, Type, createPartFromUri } from '@google/genai';

const app = express();
const PORT = 3000;
const ROOT_DIR = process.cwd();
const UPLOADS_DIR = path.join(ROOT_DIR, 'uploads');

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

app.use(express.json({ limit: '12mb' }));

const upload = multer({
  dest: UPLOADS_DIR,
  limits: {
    fileSize: 200 * 1024 * 1024, // Up to 200 MB for Zoom video/audio recordings
  },
});

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

const MODEL_NAME = 'gemini-4-hydrogen';

function cleanTranscriptText(rawText: string): string {
  const lines = rawText.split(/\r?\n/);
  const cleaned: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed === 'WEBVTT') continue;
    if (/^\d+$/.test(trimmed)) continue;
    if (/^\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[.,]\d{3}/.test(trimmed)) continue;
    cleaned.push(trimmed);
  }
  return cleaned.join('\n');
}

function extractIpynbText(rawJson: string): string {
  try {
    const nb = JSON.parse(rawJson);
    if (!Array.isArray(nb.cells)) return rawJson;
    return nb.cells
      .map((cell: { cell_type?: string; source?: string[] | string }, idx: number) => {
        const src = Array.isArray(cell.source) ? cell.source.join('') : String(cell.source || '');
        return `[Cell ${idx + 1} - ${cell.cell_type || 'code'}]\n${src}`;
      })
      .join('\n\n');
  } catch {
    return rawJson;
  }
}

function guessMimeType(filePath: string, originalName: string, providedMime?: string): string {
  const ext = path.extname(originalName || filePath).toLowerCase();
  const map: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.m4a': 'audio/mp4',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.aac': 'audio/aac',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.vtt': 'text/plain',
    '.srt': 'text/plain',
    '.md': 'text/markdown',
    '.csv': 'text/csv',
    '.py': 'text/plain',
    '.ipynb': 'text/plain',
    '.json': 'application/json',
  };
  if (map[ext]) return map[ext];
  if (providedMime && providedMime !== 'application/octet-stream') return providedMime;
  return 'text/plain';
}

function safeUnlink(filePath?: string) {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // ignore cleanup errors
  }
}

function extractGeminiError(err: unknown): { status: number; message: string } {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('API_KEY_INVALID') || msg.includes('PERMISSION_DENIED')) {
    return {
      status: 403,
      message: 'Gemini API key issue. Please verify your GEMINI_API_KEY in Settings > Secrets.',
    };
  }
  if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429')) {
    return {
      status: 429,
      message: 'AI rate limit temporarily reached. Please wait a moment and try again.',
    };
  }
  return { status: 500, message: msg || 'Failed to process request with AI.' };
}

function parseCoursesField(rawCourses: unknown): string {
  try {
    const parsed = typeof rawCourses === 'string' ? JSON.parse(rawCourses) : rawCourses;
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed
        .map((c: { code?: string; title?: string }) => `${c.code || 'COURSE'} (${c.title || ''})`)
        .join(', ');
    }
  } catch {
    // ignore
  }
  return 'AI-101 (Foundations of Artificial Intelligence), PY-102 (Python Programming for Data Science), MTH-104 (Linear Algebra & Calculus for AI), DB-105 (Database Systems & SQL)';
}

// Analyze & Auto-Organize Zoom Transcript or Audio/Video Recording
app.post('/api/analyze/lecture', upload.single('file'), async (req: Request, res: Response) => {
  const file = req.file;
  let remoteFileName: string | undefined;

  try {
    if (!process.env.GEMINI_API_KEY) {
      res.status(500).json({ error: 'GEMINI_API_KEY is not configured in server secrets.' });
      return;
    }

    const requestedCourseCode = String(req.body.courseCode || 'AUTO').trim();
    const requestedTitle = String(req.body.title || '').trim();
    const lectureDate = String(req.body.lectureDate || new Date().toISOString().slice(0, 10)).trim();
    const pastedTranscript = String(req.body.transcriptText || '').trim();
    const knownCourses = parseCoursesField(req.body.courses);

    if (!file && !pastedTranscript) {
      res.status(400).json({ error: 'Please upload a Zoom recording/transcript file or paste transcript text.' });
      return;
    }

    const lectureSchema = {
      type: Type.OBJECT,
      properties: {
        detectedCourseCode: {
          type: Type.STRING,
          description: 'Best matching course code from the student course list, or a short inferred code like AI-101.',
        },
        moduleTopic: {
          type: Type.STRING,
          description: 'Clean module/topic label for file organization, e.g., "Module 4: Search Algorithms & Heuristics".',
        },
        suggestedTitle: {
          type: Type.STRING,
          description: 'Concise, descriptive title for the class session.',
        },
        keywords: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: '4 to 7 specific searchable keywords/concepts covered in this recording or transcript.',
        },
        plainEnglishSummary: {
          type: Type.STRING,
          description: 'Clear 2-4 sentence plain-English summary for a student catching up on what happened in class.',
        },
        keyConcepts: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              term: { type: Type.STRING },
              simpleExplanation: { type: Type.STRING },
              analogyOrExample: { type: Type.STRING },
            },
            required: ['term', 'simpleExplanation', 'analogyOrExample'],
          },
        },
        actionItems: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              type: {
                type: Type.STRING,
                enum: ['Assignment', 'Lab', 'Quiz', 'Module Reading', 'Lecture Catch-Up', 'Project'],
              },
              dueHint: { type: Type.STRING },
              estimatedMinutes: { type: Type.INTEGER },
            },
            required: ['title', 'type', 'dueHint', 'estimatedMinutes'],
          },
        },
        checkQuestions: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              question: { type: Type.STRING },
              answer: { type: Type.STRING },
            },
            required: ['question', 'answer'],
          },
        },
      },
      required: [
        'detectedCourseCode',
        'moduleTopic',
        'suggestedTitle',
        'keywords',
        'plainEnglishSummary',
        'keyConcepts',
        'actionItems',
        'checkQuestions',
      ],
    };

    const courseHint =
      requestedCourseCode === 'AUTO'
        ? `Automatically classify which course from [${knownCourses}] this belongs to based on the filename and content.`
        : `User selected course: ${requestedCourseCode} (from [${knownCourses}]).`;

    const systemInstruction =
      'You are an encouraging, crystal-clear tutor and academic organizer helping an Associate Degree in Artificial Intelligence student in Jamaica who fell behind. Automatically classify the file into the right course, assign a clear module topic folder name, tag 4-7 searchable keywords, explain concepts in plain English with everyday analogies or short Python/math examples, and extract every assignment or deadline mentioned.';

    let sourceType: 'Transcript' | 'Recording' = 'Transcript';
    let fileName = 'Pasted Transcript';
    let durationOrLines = `${pastedTranscript.split('\n').length} lines`;
    let rawExcerpt = pastedTranscript.slice(0, 6000);
    let responseText = '';

    if (file) {
      fileName = file.originalname;
      const mimeType = guessMimeType(file.path, file.originalname, file.mimetype);
      const isMedia = mimeType.startsWith('audio/') || mimeType.startsWith('video/');

      if (isMedia) {
        sourceType = 'Recording';
        const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
        durationOrLines = `${sizeMb} MB ${mimeType.startsWith('video/') ? 'video' : 'audio'}`;
        rawExcerpt = `Analyzed Zoom media file: ${file.originalname} (${durationOrLines}).`;

        const promptText = `${courseHint}\nFilename: ${file.originalname}\nTitle hint: ${requestedTitle || 'Auto-detect from lecture'}\nDate: ${lectureDate}\n\nListen to this recorded Zoom class, organize it by course and module topic, tag relevant keywords, explain every main topic in simple terms with analogies/examples, extract all homework/deadlines mentioned, and create 3 short self-check questions with answers.`;

        if (file.size <= 12 * 1024 * 1024) {
          const base64Data = fs.readFileSync(file.path).toString('base64');
          const response = await ai.models.generateContent({
            model: MODEL_NAME,
            contents: {
              parts: [
                { inlineData: { mimeType, data: base64Data } },
                { text: promptText },
              ],
            },
            config: {
              systemInstruction,
              responseMimeType: 'application/json',
              responseSchema: lectureSchema,
            },
          });
          responseText = response.text ?? '';
        } else {
          let uploaded = await ai.files.upload({
            file: file.path,
            config: { mimeType, displayName: file.originalname },
          });
          remoteFileName = uploaded.name;

          let attempts = 0;
          while (uploaded.state === 'PROCESSING' && attempts < 45) {
            await new Promise((r) => setTimeout(r, 2000));
            if (uploaded.name) {
              uploaded = await ai.files.get({ name: uploaded.name });
            }
            attempts++;
          }

          if (uploaded.state === 'FAILED') {
            throw new Error(
              'Recording file could not be processed. Try exporting audio-only (.m4a/.mp3) or uploading the Zoom .vtt transcript.',
            );
          }

          const filePart = createPartFromUri(uploaded.uri ?? '', uploaded.mimeType ?? mimeType);
          const response = await ai.models.generateContent({
            model: MODEL_NAME,
            contents: {
              parts: [filePart, { text: promptText }],
            },
            config: {
              systemInstruction,
              responseMimeType: 'application/json',
              responseSchema: lectureSchema,
            },
          });
          responseText = response.text ?? '';
        }
      } else {
        const rawFileText = fs.readFileSync(file.path, 'utf8');
        const cleaned = cleanTranscriptText(rawFileText);
        durationOrLines = `${cleaned.split('\n').length} lines`;
        rawExcerpt = cleaned.slice(0, 7500);

        const response = await ai.models.generateContent({
          model: MODEL_NAME,
          contents: `${courseHint}\nFilename: ${file.originalname}\nTitle hint: ${requestedTitle || 'Auto-detect from transcript'}\nDate: ${lectureDate}\n\nZoom Transcript:\n${cleaned.slice(0, 90000)}`,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema: lectureSchema,
          },
        });
        responseText = response.text ?? '';
      }
    } else {
      const cleaned = cleanTranscriptText(pastedTranscript);
      durationOrLines = `${cleaned.split('\n').length} lines`;
      rawExcerpt = cleaned.slice(0, 7500);

      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: `${courseHint}\nTitle hint: ${requestedTitle || 'Auto-detect from transcript'}\nDate: ${lectureDate}\n\nZoom Transcript:\n${cleaned.slice(0, 90000)}`,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: lectureSchema,
        },
      });
      responseText = response.text ?? '';
    }

    const parsed = JSON.parse(responseText || '{}');
    const finalCourseCode =
      requestedCourseCode === 'AUTO'
        ? String(parsed.detectedCourseCode || 'AI-101').trim()
        : requestedCourseCode;

    res.json({
      courseCode: finalCourseCode,
      moduleTopic: String(parsed.moduleTopic || 'General Lecture').trim(),
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords.map(String).slice(0, 10) : [],
      title: requestedTitle || String(parsed.suggestedTitle || fileName).trim(),
      lectureDate,
      sourceType,
      fileName,
      durationOrLines,
      plainEnglishSummary: parsed.plainEnglishSummary || '',
      keyConcepts: Array.isArray(parsed.keyConcepts) ? parsed.keyConcepts : [],
      actionItems: Array.isArray(parsed.actionItems)
        ? parsed.actionItems.map((item: Record<string, unknown>) => ({
            ...item,
            addedToTracker: false,
          }))
        : [],
      checkQuestions: Array.isArray(parsed.checkQuestions) ? parsed.checkQuestions : [],
      rawExcerpt,
    });
  } catch (err) {
    const gErr = extractGeminiError(err);
    res.status(gErr.status).json({ error: gErr.message });
  } finally {
    safeUnlink(file?.path);
    if (remoteFileName) {
      try {
        await ai.files.delete({ name: remoteFileName });
      } catch {
        // ignore cleanup errors
      }
    }
  }
});

// Analyze & Auto-Organize Downloaded Course Module File (PDF, TXT, MD, PY, IPYNB, CSV)
app.post('/api/analyze/module', upload.single('file'), async (req: Request, res: Response) => {
  const file = req.file;
  let remoteFileName: string | undefined;

  try {
    if (!process.env.GEMINI_API_KEY) {
      res.status(500).json({ error: 'GEMINI_API_KEY is not configured in server secrets.' });
      return;
    }

    const requestedCourseCode = String(req.body.courseCode || 'AUTO').trim();
    const requestedTitle = String(req.body.title || '').trim();
    const pastedText = String(req.body.moduleText || '').trim();
    const knownCourses = parseCoursesField(req.body.courses);

    if (!file && !pastedText) {
      res.status(400).json({ error: 'Please upload a module file (PDF, TXT, MD, PY, IPYNB) or paste module notes.' });
      return;
    }

    const moduleSchema = {
      type: Type.OBJECT,
      properties: {
        detectedCourseCode: {
          type: Type.STRING,
          description: 'Best matching course code from the student course list.',
        },
        moduleTopic: {
          type: Type.STRING,
          description: 'Clean module topic folder name, e.g. "Module 4: Gradient Descent".',
        },
        suggestedTitle: {
          type: Type.STRING,
          description: 'Clean study guide title.',
        },
        keywords: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: '4 to 7 searchable technical keywords from this module.',
        },
        overview: { type: Type.STRING },
        learningObjectives: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
        topicBreakdowns: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              topic: { type: Type.STRING },
              plainEnglish: { type: Type.STRING },
              keyTakeaway: { type: Type.STRING },
              exampleOrCode: { type: Type.STRING },
            },
            required: ['topic', 'plainEnglish', 'keyTakeaway', 'exampleOrCode'],
          },
        },
        difficultyNote: {
          type: Type.STRING,
          description: 'Common stumbling block students hit in this module and a practical tip to overcome it.',
        },
        extractedTextPreview: {
          type: Type.STRING,
          description: 'Factual summary of key definitions, code patterns, and formulas from the file for chatbot Q&A grounding.',
        },
      },
      required: [
        'detectedCourseCode',
        'moduleTopic',
        'suggestedTitle',
        'keywords',
        'overview',
        'learningObjectives',
        'topicBreakdowns',
        'difficultyNote',
        'extractedTextPreview',
      ],
    };

    const courseHint =
      requestedCourseCode === 'AUTO'
        ? `Automatically classify which course from [${knownCourses}] this module belongs to.`
        : `User selected course: ${requestedCourseCode} (from [${knownCourses}]).`;

    const systemInstruction =
      'You are a patient tutor and study library organizer helping an Associate Degree in Artificial Intelligence student in Jamaica understand downloaded course module files. Auto-classify the file by course code and module topic, tag 4-7 searchable keywords, translate academic jargon into plain English with worked Python/math examples, and capture key definitions for Q&A.';

    let fileName = 'Pasted Module Notes';
    let responseText = '';

    if (file) {
      fileName = file.originalname;
      const ext = path.extname(file.originalname).toLowerCase();
      const mimeType = guessMimeType(file.path, file.originalname, file.mimetype);

      if (ext === '.pdf' || mimeType === 'application/pdf') {
        const promptText = `${courseHint}\nFilename: ${file.originalname}\nTitle hint: ${requestedTitle || 'Auto-detect from file'}\n\nBreak down this downloaded module PDF into a beginner-friendly catch-up study guide and organize it by course, module topic, and keywords.`;
        if (file.size <= 14 * 1024 * 1024) {
          const base64Data = fs.readFileSync(file.path).toString('base64');
          const response = await ai.models.generateContent({
            model: MODEL_NAME,
            contents: {
              parts: [
                { inlineData: { mimeType: 'application/pdf', data: base64Data } },
                { text: promptText },
              ],
            },
            config: {
              systemInstruction,
              responseMimeType: 'application/json',
              responseSchema: moduleSchema,
            },
          });
          responseText = response.text ?? '';
        } else {
          const uploaded = await ai.files.upload({
            file: file.path,
            config: { mimeType: 'application/pdf', displayName: file.originalname },
          });
          remoteFileName = uploaded.name;
          const filePart = createPartFromUri(uploaded.uri ?? '', 'application/pdf');
          const response = await ai.models.generateContent({
            model: MODEL_NAME,
            contents: {
              parts: [filePart, { text: promptText }],
            },
            config: {
              systemInstruction,
              responseMimeType: 'application/json',
              responseSchema: moduleSchema,
            },
          });
          responseText = response.text ?? '';
        }
      } else {
        let rawContent = fs.readFileSync(file.path, 'utf8');
        if (ext === '.ipynb') {
          rawContent = extractIpynbText(rawContent);
        }
        const response = await ai.models.generateContent({
          model: MODEL_NAME,
          contents: `${courseHint}\nFilename: ${file.originalname}\nTitle hint: ${requestedTitle || 'Auto-detect from file'}\n\nModule File Content:\n${rawContent.slice(0, 90000)}`,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema: moduleSchema,
          },
        });
        responseText = response.text ?? '';
      }
    } else {
      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: `${courseHint}\nTitle hint: ${requestedTitle || 'Auto-detect from notes'}\n\nModule Notes:\n${pastedText.slice(0, 90000)}`,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: moduleSchema,
        },
      });
      responseText = response.text ?? '';
    }

    const parsed = JSON.parse(responseText || '{}');
    const finalCourseCode =
      requestedCourseCode === 'AUTO'
        ? String(parsed.detectedCourseCode || 'AI-101').trim()
        : requestedCourseCode;

    res.json({
      courseCode: finalCourseCode,
      moduleTopic: String(parsed.moduleTopic || 'General Module').trim(),
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords.map(String).slice(0, 10) : [],
      title: requestedTitle || String(parsed.suggestedTitle || fileName).trim(),
      fileName,
      overview: parsed.overview || '',
      learningObjectives: Array.isArray(parsed.learningObjectives) ? parsed.learningObjectives : [],
      topicBreakdowns: Array.isArray(parsed.topicBreakdowns) ? parsed.topicBreakdowns : [],
      difficultyNote: parsed.difficultyNote || '',
      extractedTextPreview: parsed.extractedTextPreview || '',
    });
  } catch (err) {
    const gErr = extractGeminiError(err);
    res.status(gErr.status).json({ error: gErr.message });
  } finally {
    safeUnlink(file?.path);
    if (remoteFileName) {
      try {
        await ai.files.delete({ name: remoteFileName });
      } catch {
        // ignore cleanup errors
      }
    }
  }
});

// Cross-Source Progress & Catch-Up Gap Analysis (Emails + Study Materials + Tasks)
app.post('/api/progress/analyze', async (req: Request, res: Response) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      res.status(500).json({ error: 'GEMINI_API_KEY is not configured in server secrets.' });
      return;
    }

    const courses = Array.isArray(req.body.courses) ? req.body.courses : [];
    const tasks = Array.isArray(req.body.tasks) ? req.body.tasks : [];
    const lectures = Array.isArray(req.body.lectures) ? req.body.lectures : [];
    const modules = Array.isArray(req.body.modules) ? req.body.modules : [];
    const emails = Array.isArray(req.body.emails) ? req.body.emails : [];

    const compactLectures = lectures.map((l: Record<string, unknown>) => ({
      id: l.id,
      courseCode: l.courseCode,
      moduleTopic: l.moduleTopic,
      title: l.title,
      lectureDate: l.lectureDate,
      keywords: l.keywords,
      summary: String(l.plainEnglishSummary || '').slice(0, 500),
      actionItems: l.actionItems,
    }));

    const compactModules = modules.map((m: Record<string, unknown>) => ({
      id: m.id,
      courseCode: m.courseCode,
      moduleTopic: m.moduleTopic,
      title: m.title,
      keywords: m.keywords,
      overview: String(m.overview || '').slice(0, 500),
      learningObjectives: m.learningObjectives,
    }));

    const compactEmails = emails.slice(0, 12).map((e: Record<string, unknown>) => ({
      id: e.id,
      subject: e.subject,
      from: e.from,
      date: e.date,
      excerpt: String(e.bodyText || e.snippet || '').slice(0, 900),
    }));

    const progressSchema = {
      type: Type.OBJECT,
      properties: {
        overallStatusSummary: {
          type: Type.STRING,
          description: 'Encouraging 2-3 sentence diagnosis of overall academic progress and biggest catch-up priorities.',
        },
        courseProgress: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              courseCode: { type: Type.STRING },
              courseTitle: { type: Type.STRING },
              statusLabel: {
                type: Type.STRING,
                enum: ['On Track', 'Catching Up', 'Needs Focus'],
              },
              completedCount: { type: Type.INTEGER },
              openCount: { type: Type.INTEGER },
              behindAreas: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
            },
            required: [
              'courseCode',
              'courseTitle',
              'statusLabel',
              'completedCount',
              'openCount',
              'behindAreas',
            ],
          },
        },
        prioritizedTopics: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              priorityRank: { type: Type.INTEGER },
              urgency: { type: Type.STRING, enum: ['Critical', 'High', 'Medium'] },
              courseCode: { type: Type.STRING },
              topic: { type: Type.STRING },
              whyBehind: { type: Type.STRING },
              recommendedAction: { type: Type.STRING },
              estimatedMinutes: { type: Type.INTEGER },
              linkedMaterials: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    kind: {
                      type: Type.STRING,
                      enum: ['lecture', 'module', 'task', 'email'],
                    },
                    targetId: {
                      type: Type.STRING,
                      description: 'Exact id of the matching lecture, module, task, or email from the input.',
                    },
                    label: { type: Type.STRING },
                  },
                  required: ['kind', 'targetId', 'label'],
                },
              },
            },
            required: [
              'priorityRank',
              'urgency',
              'courseCode',
              'topic',
              'whyBehind',
              'recommendedAction',
              'estimatedMinutes',
              'linkedMaterials',
            ],
          },
        },
      },
      required: ['overallStatusSummary', 'courseProgress', 'prioritizedTopics'],
    };

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: `Today's date: ${new Date().toISOString().slice(0, 10)}\n\nCourses:\n${JSON.stringify(courses)}\n\nTasks:\n${JSON.stringify(tasks)}\n\nUploaded Zoom Lectures:\n${JSON.stringify(compactLectures)}\n\nUploaded Module Files:\n${JSON.stringify(compactModules)}\n\nSynced Course Emails:\n${JSON.stringify(compactEmails)}`,
      config: {
        systemInstruction:
          'You are an academic progress advisor for an AI Associate Degree student in Jamaica. Cross-analyze their courses, open/completed tasks, uploaded Zoom lectures, uploaded module files, and recent lecturer emails. Identify exact topics where the student is behind or missing prerequisite understanding, rank them from most urgent (#1) to least urgent, and attach exact linkedMaterials (using the real id values from lectures, modules, tasks, or emails) so the student can click directly into the right study material.',
        responseMimeType: 'application/json',
        responseSchema: progressSchema,
      },
    });

    const parsed = JSON.parse(response.text ?? '{}');
    res.json({
      overallStatusSummary: parsed.overallStatusSummary || 'Progress analysis complete.',
      analyzedEmailCount: compactEmails.length,
      courseProgress: Array.isArray(parsed.courseProgress) ? parsed.courseProgress : [],
      prioritizedTopics: Array.isArray(parsed.prioritizedTopics) ? parsed.prioritizedTopics : [],
    });
  } catch (err) {
    const gErr = extractGeminiError(err);
    res.status(gErr.status).json({ error: gErr.message });
  }
});

// Unified Course Material Chatbot (Processes ALL lecture transcripts, module files & emails)
app.post('/api/tutor/chat', async (req: Request, res: Response) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      res.status(500).json({ error: 'GEMINI_API_KEY is not configured in server secrets.' });
      return;
    }

    const question = String(req.body.question || '').trim();
    const courseFilter = String(req.body.courseFilter || 'ALL').trim();
    const history = Array.isArray(req.body.history) ? req.body.history : [];
    const lectures = Array.isArray(req.body.lectures) ? req.body.lectures : [];
    const modules = Array.isArray(req.body.modules) ? req.body.modules : [];
    const emails = Array.isArray(req.body.emails) ? req.body.emails : [];

    if (!question) {
      res.status(400).json({ error: 'Please enter a question about your course materials.' });
      return;
    }

    const filterFn = (courseCode: unknown) =>
      courseFilter === 'ALL' || String(courseCode || '').toUpperCase() === courseFilter.toUpperCase();

    const lectureDocs = lectures.filter((l: Record<string, unknown>) => filterFn(l.courseCode)).map((l: Record<string, unknown>) => ({
      kind: 'lecture',
      id: String(l.id || ''),
      courseCode: String(l.courseCode || ''),
      moduleTopic: String(l.moduleTopic || ''),
      title: String(l.title || ''),
      keywords: Array.isArray(l.keywords) ? l.keywords : [],
      content: `${l.plainEnglishSummary || ''}\nConcepts: ${JSON.stringify(l.keyConcepts || [])}\nTranscript Excerpt: ${String(l.rawExcerpt || '').slice(0, 3500)}`,
    }));

    const moduleDocs = modules.filter((m: Record<string, unknown>) => filterFn(m.courseCode)).map((m: Record<string, unknown>) => ({
      kind: 'module',
      id: String(m.id || ''),
      courseCode: String(m.courseCode || ''),
      moduleTopic: String(m.moduleTopic || ''),
      title: String(m.title || ''),
      keywords: Array.isArray(m.keywords) ? m.keywords : [],
      content: `${m.overview || ''}\nObjectives: ${JSON.stringify(m.learningObjectives || [])}\nTopics: ${JSON.stringify(m.topicBreakdowns || [])}\nNotes: ${String(m.extractedTextPreview || '').slice(0, 3500)}`,
    }));

    const emailDocs = emails.slice(0, 8).map((e: Record<string, unknown>) => ({
      kind: 'email',
      id: String(e.id || ''),
      courseCode: 'Email',
      title: String(e.subject || ''),
      content: `From: ${e.from || ''}\n${String(e.bodyText || e.snippet || '').slice(0, 1200)}`,
    }));

    const historyText = history
      .slice(-8)
      .map((m: { role: string; text: string }) => `${m.role === 'user' ? 'Student' : 'Chatbot'}: ${m.text}`)
      .join('\n');

    const chatSchema = {
      type: Type.OBJECT,
      properties: {
        answer: {
          type: Type.STRING,
          description: 'Clear, thorough, beginner-friendly answer grounded in the provided lecture transcripts, module files, and emails. Include short code or step-by-step math explanations when relevant.',
        },
        citations: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              kind: { type: Type.STRING, enum: ['lecture', 'module', 'email'] },
              id: { type: Type.STRING },
              title: { type: Type.STRING },
              courseCode: { type: Type.STRING },
            },
            required: ['kind', 'id', 'title', 'courseCode'],
          },
          description: 'Exact sources from the provided materials used to answer the student question.',
        },
      },
      required: ['answer', 'citations'],
    };

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: `Course Focus: ${courseFilter}\n\nUploaded Zoom Lecture Transcripts & Summaries:\n${JSON.stringify(lectureDocs)}\n\nUploaded Module Files & Breakdowns:\n${JSON.stringify(moduleDocs)}\n\nRecent Course Emails:\n${JSON.stringify(emailDocs)}\n\nConversation History:\n${historyText}\n\nStudent Question: ${question}`,
      config: {
        systemInstruction:
          'You are the student’s personal AI Associate Degree Study Chatbot. Answer questions accurately using their uploaded Zoom lecture transcripts, module files, and lecturer emails whenever relevant. If a concept is not covered in their uploaded files yet, explain it clearly from AI fundamentals and note which topic they have not uploaded yet. Always populate citations using the exact id, kind, title, and courseCode of the materials you referenced.',
        responseMimeType: 'application/json',
        responseSchema: chatSchema,
      },
    });

    const parsed = JSON.parse(response.text ?? '{}');
    res.json({
      answer: parsed.answer || 'I could not generate an answer right now. Please try rephrasing.',
      citations: Array.isArray(parsed.citations) ? parsed.citations : [],
    });
  } catch (err) {
    const gErr = extractGeminiError(err);
    res.status(gErr.status).json({ error: gErr.message });
  }
});

// Helper to compact course materials for Socratic Mastery Coach & Quiz Generator
function buildCompactStudyContext(
  lectures: Array<Record<string, unknown>>,
  modules: Array<Record<string, unknown>>,
  emails: Array<Record<string, unknown>>,
  courseFilter: string,
  targetMaterialId?: string,
) {
  const filterCourse = (courseCode: unknown) =>
    courseFilter === 'ALL' || String(courseCode || '').toUpperCase() === courseFilter.toUpperCase();

  const filterTarget = (id: unknown) => !targetMaterialId || String(id || '') === targetMaterialId;

  const lectureDocs = lectures
    .filter((l) => (targetMaterialId ? filterTarget(l.id) : filterCourse(l.courseCode)))
    .map((l) => ({
      kind: 'lecture',
      id: String(l.id || ''),
      courseCode: String(l.courseCode || ''),
      moduleTopic: String(l.moduleTopic || ''),
      title: String(l.title || ''),
      keywords: Array.isArray(l.keywords) ? l.keywords : [],
      content: `${l.plainEnglishSummary || ''}\nConcepts: ${JSON.stringify(l.keyConcepts || [])}\nCheck Questions: ${JSON.stringify(l.checkQuestions || [])}\nTranscript Excerpt: ${String(l.rawExcerpt || '').slice(0, 3500)}`,
    }));

  const moduleDocs = modules
    .filter((m) => (targetMaterialId ? filterTarget(m.id) : filterCourse(m.courseCode)))
    .map((m) => ({
      kind: 'module',
      id: String(m.id || ''),
      courseCode: String(m.courseCode || ''),
      moduleTopic: String(m.moduleTopic || ''),
      title: String(m.title || ''),
      keywords: Array.isArray(m.keywords) ? m.keywords : [],
      content: `${m.overview || ''}\nObjectives: ${JSON.stringify(m.learningObjectives || [])}\nTopics: ${JSON.stringify(m.topicBreakdowns || [])}\nNotes: ${String(m.extractedTextPreview || '').slice(0, 3500)}`,
    }));

  const emailDocs = targetMaterialId
    ? []
    : emails.slice(0, 6).map((e) => ({
        kind: 'email',
        id: String(e.id || ''),
        courseCode: 'Email',
        title: String(e.subject || ''),
        content: String(e.bodyText || e.snippet || '').slice(0, 1000),
      }));

  return { lectureDocs, moduleDocs, emailDocs };
}

// Brisk-Style Socratic Mastery Chatbot (asks check questions, hints if wrong, loops until mastered)
app.post('/api/tutor/socratic', async (req: Request, res: Response) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      res.status(500).json({ error: 'GEMINI_API_KEY is not configured in server secrets.' });
      return;
    }

    const action = req.body.action === 'start' || req.body.action === 'hint' ? req.body.action : 'respond';
    const studentInput = String(req.body.studentInput || '').trim();
    const topicFocus = String(req.body.topicFocus || '').trim();
    const courseFilter = String(req.body.courseFilter || 'ALL').trim();
    const targetMaterialId = String(req.body.targetMaterialId || '').trim();
    const masteredConcepts = Array.isArray(req.body.masteredConcepts) ? req.body.masteredConcepts : [];
    const history = Array.isArray(req.body.history) ? req.body.history : [];
    const lectures = Array.isArray(req.body.lectures) ? req.body.lectures : [];
    const modules = Array.isArray(req.body.modules) ? req.body.modules : [];
    const emails = Array.isArray(req.body.emails) ? req.body.emails : [];

    if (action === 'respond' && !studentInput) {
      res.status(400).json({ error: 'Please type your answer so your coach can check it.' });
      return;
    }

    const { lectureDocs, moduleDocs, emailDocs } = buildCompactStudyContext(
      lectures,
      modules,
      emails,
      courseFilter,
      targetMaterialId || undefined,
    );

    const historyText = history
      .slice(-10)
      .map(
        (m: { role: string; text: string; conceptFocus?: string }) =>
          `${m.role === 'user' ? 'Student' : 'Mastery Coach'}${m.conceptFocus ? ` [${m.conceptFocus}]` : ''}: ${m.text}`,
      )
      .join('\n');

    const socraticSchema = {
      type: Type.OBJECT,
      properties: {
        evaluationStatus: {
          type: Type.STRING,
          enum: ['question', 'retry', 'mastered'],
          description:
            'Use "question" when starting a new session; "retry" if the student answer was wrong, incomplete, vague, or asked for a hint (do NOT advance yet—guide and ask back!); "mastered" ONLY when the student genuinely demonstrated understanding of the current concept.',
        },
        conceptFocus: {
          type: Type.STRING,
          description: 'Short 2-5 word name of the concept being checked right now.',
        },
        masteredConcept: {
          type: Type.STRING,
          description:
            'If evaluationStatus is "mastered", set this to the exact short concept name the student just mastered; otherwise empty string "".',
        },
        hintText: {
          type: Type.STRING,
          description:
            'Optional concise scaffolding hint or everyday analogy when evaluationStatus is "retry". Empty string if mastered or initial question.',
        },
        reply: {
          type: Type.STRING,
          description:
            'Warm, clear coach message ending with ONE clear question for the student to answer. When "retry", explain what was off or missing, give a clear clue/analogy without giving away the whole answer, and ask them back. When "mastered", briefly confirm why their answer was right, then ask the next check question on a new concept.',
        },
        citations: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              kind: { type: Type.STRING, enum: ['lecture', 'module', 'email'] },
              id: { type: Type.STRING },
              title: { type: Type.STRING },
              courseCode: { type: Type.STRING },
            },
            required: ['kind', 'id', 'title', 'courseCode'],
          },
        },
      },
      required: ['evaluationStatus', 'conceptFocus', 'masteredConcept', 'hintText', 'reply', 'citations'],
    };

    const actionPrompt =
      action === 'start'
        ? `Start a new Mastery Coach session${topicFocus ? ` focused on: "${topicFocus}"` : ''}. Briefly introduce the first key concept in 1-2 sentences, then ask ONE clear diagnostic check question to test if the student understands it.`
        : action === 'hint'
          ? `The student asked for a hint on the current question. Give a helpful, concrete hint with an everyday analogy or small example (without just giving away the exact answer) and ask them back to try answering.`
          : `Student's latest answer: "${studentInput}". Evaluate whether it accurately explains/answers the current question. If wrong, incomplete, or "I don't know", set evaluationStatus="retry", help them understand what they missed with a hint, and ask them back (or ask a slightly simpler stepping-stone question) until they get it right. Only set evaluationStatus="mastered" when they truly got it right, then immediately ask a check question on the next concept.`;

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: `Course Scope: ${courseFilter}\nAlready Mastered Concepts: ${JSON.stringify(masteredConcepts)}\n\nUploaded Zoom Lectures:\n${JSON.stringify(lectureDocs)}\n\nUploaded Module Files:\n${JSON.stringify(moduleDocs)}\n\nRecent Emails:\n${JSON.stringify(emailDocs)}\n\nConversation So Far:\n${historyText || '(New session)'}\n\nInstruction:\n${actionPrompt}`,
      config: {
        systemInstruction:
          'You are an encouraging Brisk-style Socratic Mastery Coach for an Associate Degree in Artificial Intelligence student in Jamaica. Your job is to ensure the student truly learns concepts by asking check-for-understanding questions one at a time. CRITICAL RULES: (1) Never accept a wrong, vague, or "I don\'t know" answer as mastered. (2) If the student gets it wrong or partially right, set evaluationStatus="retry", gently clarify the misconception with a plain-English hint/analogy, and ask them back until they get it right. (3) Only set evaluationStatus="mastered" when their explanation/answer is genuinely correct, affirm why, and immediately ask a check question on the next unmastered concept from their materials. (4) Keep replies concise, supportive, and grounded in their uploaded lectures and modules with exact citations.',
        responseMimeType: 'application/json',
        responseSchema: socraticSchema,
      },
    });

    const parsed = JSON.parse(response.text ?? '{}');
    res.json({
      evaluationStatus: parsed.evaluationStatus || (action === 'start' ? 'question' : 'retry'),
      conceptFocus: parsed.conceptFocus || topicFocus || 'Course Concept',
      masteredConcept: parsed.evaluationStatus === 'mastered' ? String(parsed.masteredConcept || '') : '',
      hintText: parsed.hintText || '',
      reply: parsed.reply || 'Let us check your understanding: can you explain this concept in your own words?',
      citations: Array.isArray(parsed.citations) ? parsed.citations : [],
    });
  } catch (err) {
    const gErr = extractGeminiError(err);
    res.status(gErr.status).json({ error: gErr.message });
  }
});

// Generate Interactive Quiz (Multiple Choice + Short Answer) from Uploaded Study Materials
app.post('/api/quiz/generate', async (req: Request, res: Response) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      res.status(500).json({ error: 'GEMINI_API_KEY is not configured in server secrets.' });
      return;
    }

    const courseFilter = String(req.body.courseFilter || 'ALL').trim();
    const targetMaterialId = String(req.body.targetMaterialId || '').trim();
    const topicFocus = String(req.body.topicFocus || '').trim();
    const difficulty =
      req.body.difficulty === 'Review' || req.body.difficulty === 'Challenge'
        ? req.body.difficulty
        : 'Standard';
    const questionCount = Math.max(3, Math.min(10, Math.round(Number(req.body.questionCount) || 5)));

    const lectures = Array.isArray(req.body.lectures) ? req.body.lectures : [];
    const modules = Array.isArray(req.body.modules) ? req.body.modules : [];
    const emails = Array.isArray(req.body.emails) ? req.body.emails : [];

    const { lectureDocs, moduleDocs } = buildCompactStudyContext(
      lectures,
      modules,
      emails,
      courseFilter,
      targetMaterialId || undefined,
    );

    const quizSchema = {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        courseCode: { type: Type.STRING },
        topicFocus: { type: Type.STRING },
        questions: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              type: { type: Type.STRING, enum: ['mcq', 'short'] },
              prompt: { type: Type.STRING },
              options: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'Exactly 4 distinct choices for "mcq" questions; empty array [] for "short" questions.',
              },
              correctOptionIndex: {
                type: Type.INTEGER,
                description: '0-based index (0 to 3) of the right option for "mcq" questions; 0 for "short" questions.',
              },
              modelAnswer: {
                type: Type.STRING,
                description: 'Clear ideal answer in plain English (used to grade short answers and show review).',
              },
              explanation: {
                type: Type.STRING,
                description: 'Helpful 1-2 sentence explanation of why the answer is right and common pitfalls.',
              },
              conceptFocus: { type: Type.STRING },
              courseCode: { type: Type.STRING },
              sourceTitle: { type: Type.STRING },
            },
            required: [
              'id',
              'type',
              'prompt',
              'options',
              'correctOptionIndex',
              'modelAnswer',
              'explanation',
              'conceptFocus',
              'courseCode',
              'sourceTitle',
            ],
          },
        },
      },
      required: ['title', 'courseCode', 'topicFocus', 'questions'],
    };

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: `Requested Course: ${courseFilter}\nRequested Topic Focus: ${topicFocus || 'Key concepts from the materials'}\nDifficulty: ${difficulty}\nTarget Question Count: ${questionCount}\n\nUploaded Zoom Lectures:\n${JSON.stringify(lectureDocs)}\n\nUploaded Module Files:\n${JSON.stringify(moduleDocs)}`,
      config: {
        systemInstruction: `You are an AI Associate Degree instructor creating a practical, interactive study quiz. Generate exactly ${questionCount} questions grounded in the provided Zoom lectures and module guides (or core AI Associate Degree topics if no materials match). Mix ~70% "mcq" (multiple choice with exactly 4 distinct options and a valid correctOptionIndex 0..3) and ~30% "short" (explain-in-your-own-words questions). Adjust depth for difficulty="${difficulty}" ("Review" = approachable foundational checks; "Standard" = Associate exam readiness; "Challenge" = applied code/math/debugging scenarios). Give every question a unique id like "q1", "q2", etc.`,
        responseMimeType: 'application/json',
        responseSchema: quizSchema,
      },
    });

    const parsed = JSON.parse(response.text ?? '{}');
    const questions = Array.isArray(parsed.questions)
      ? parsed.questions.slice(0, 10).map((q: Record<string, unknown>, idx: number) => {
          const isMcq = q.type !== 'short';
          const rawOpts = Array.isArray(q.options) ? q.options.map(String).slice(0, 4) : [];
          return {
            id: String(q.id || `q${idx + 1}`),
            type: isMcq && rawOpts.length >= 2 ? 'mcq' : 'short',
            prompt: String(q.prompt || ''),
            ...(isMcq && rawOpts.length >= 2
              ? {
                  options: rawOpts,
                  correctOptionIndex: Math.max(
                    0,
                    Math.min(rawOpts.length - 1, Number(q.correctOptionIndex) || 0),
                  ),
                }
              : {}),
            modelAnswer: String(q.modelAnswer || ''),
            explanation: String(q.explanation || ''),
            conceptFocus: String(q.conceptFocus || topicFocus || 'Core Concept'),
            courseCode: String(q.courseCode || (courseFilter === 'ALL' ? 'AI-101' : courseFilter)),
            sourceTitle: String(q.sourceTitle || 'Course Materials'),
          };
        })
      : [];

    res.json({
      title: String(parsed.title || `${courseFilter === 'ALL' ? 'AI Associate' : courseFilter} Practice Quiz`),
      courseCode: String(parsed.courseCode || courseFilter),
      topicFocus: String(parsed.topicFocus || topicFocus || 'Course Review'),
      difficulty,
      questions,
      answers: [],
      score: 0,
      totalQuestions: questions.length || 1,
      completed: false,
    });
  } catch (err) {
    const gErr = extractGeminiError(err);
    res.status(gErr.status).json({ error: gErr.message });
  }
});

// Grade Interactive Quiz Short-Answer Response with Constructive Retry Hint
app.post('/api/quiz/grade-short', async (req: Request, res: Response) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      res.status(500).json({ error: 'GEMINI_API_KEY is not configured in server secrets.' });
      return;
    }

    const questionPrompt = String(req.body.questionPrompt || '').trim();
    const modelAnswer = String(req.body.modelAnswer || '').trim();
    const conceptFocus = String(req.body.conceptFocus || '').trim();
    const courseCode = String(req.body.courseCode || 'AI-101').trim();
    const studentAnswer = String(req.body.studentAnswer || '').trim();
    const attemptNumber = Math.max(1, Number(req.body.attemptNumber || 1));

    if (!studentAnswer) {
      res.status(400).json({ error: 'Please write a short answer before checking.' });
      return;
    }

    const gradeSchema = {
      type: Type.OBJECT,
      properties: {
        status: {
          type: Type.STRING,
          enum: ['correct', 'partial', 'incorrect'],
        },
        feedback: {
          type: Type.STRING,
          description:
            'Encouraging 2-3 sentence evaluation. If incorrect or partial, explain what is missing and give a helpful hint so the student can retry or learn the concept.',
        },
      },
      required: ['status', 'feedback'],
    };

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: `Course: ${courseCode}\nConcept: ${conceptFocus}\nAttempt #: ${attemptNumber}\nQuestion: ${questionPrompt}\nReference Answer: ${modelAnswer}\nStudent's Answer: ${studentAnswer}`,
      config: {
        systemInstruction:
          'You are grading a short-answer quiz response from an AI Associate Degree student. Grade based on conceptual accuracy rather than exact wording. Use "correct" when they clearly understand the core idea, "partial" when they got part of it right but missed an important detail, and "incorrect" when the reasoning is wrong or too vague. Provide helpful, encouraging feedback with a concrete hint if partial or incorrect.',
        responseMimeType: 'application/json',
        responseSchema: gradeSchema,
      },
    });

    const parsed = JSON.parse(response.text ?? '{}');
    const status =
      parsed.status === 'correct' || parsed.status === 'partial' ? parsed.status : 'incorrect';
    res.json({
      status,
      isCorrect: status === 'correct',
      feedback: String(parsed.feedback || 'Keep going—review the key idea and give it another try!'),
    });
  } catch (err) {
    const gErr = extractGeminiError(err);
    res.status(gErr.status).json({ error: gErr.message });
  }
});

// Single-Item Study Tutor Q&A grounded in module or lecture context
app.post('/api/tutor/ask', async (req: Request, res: Response) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      res.status(500).json({ error: 'GEMINI_API_KEY is not configured in server secrets.' });
      return;
    }

    const { question, contextTitle, contextContent, courseCode, history } = req.body;
    if (!question || typeof question !== 'string') {
      res.status(400).json({ error: 'Please type a question for your study tutor.' });
      return;
    }

    const historyText = Array.isArray(history)
      ? history
          .slice(-6)
          .map((m: { role: string; text: string }) => `${m.role === 'user' ? 'Student' : 'Tutor'}: ${m.text}`)
          .join('\n')
      : '';

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: `Course: ${courseCode || 'AI Associate Degree'}\nStudy Material: ${contextTitle || 'General Coursework'}\n\nReference Material:\n${String(contextContent || '').slice(0, 30000)}\n\nRecent Conversation:\n${historyText}\n\nStudent's Question: ${question}`,
      config: {
        systemInstruction:
          'You are a patient, supportive AI Associate Degree study tutor. Explain concepts clearly in plain language, step by step, using short concrete analogies or simple Python/math examples. Never make the student feel bad for being behind. Keep answers focused, well-structured, and easy to digest in 2-3 minutes.',
      },
    });

    res.json({ answer: response.text ?? 'Sorry, I could not generate an explanation. Please try again.' });
  } catch (err) {
    const gErr = extractGeminiError(err);
    res.status(gErr.status).json({ error: gErr.message });
  }
});

// Generate Realistic Catch-Up Sprint Plan
app.post('/api/catchup/plan', async (req: Request, res: Response) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      res.status(500).json({ error: 'GEMINI_API_KEY is not configured in server secrets.' });
      return;
    }

    const hoursAvailable = Math.max(0.5, Math.min(12, Number(req.body.hoursAvailable || 3)));
    const focusNote = String(req.body.focusNote || '').trim();
    const tasks = Array.isArray(req.body.tasks) ? req.body.tasks : [];
    const openTasks = tasks.filter((t: { status: string }) => t.status !== 'Completed');

    if (openTasks.length === 0) {
      res.status(400).json({ error: 'You have no open catch-up items right now! Add classwork or sync Gmail first.' });
      return;
    }

    const sprintSchema = {
      type: Type.OBJECT,
      properties: {
        focusMessage: { type: Type.STRING },
        steps: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              order: { type: Type.INTEGER },
              taskId: { type: Type.STRING },
              title: { type: Type.STRING },
              courseCode: { type: Type.STRING },
              durationMinutes: { type: Type.INTEGER },
              reason: { type: Type.STRING },
              strategyTip: { type: Type.STRING },
            },
            required: ['order', 'title', 'courseCode', 'durationMinutes', 'reason', 'strategyTip'],
          },
        },
      },
      required: ['focusMessage', 'steps'],
    };

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: `Student available study time today: ${hoursAvailable} hours (${Math.round(hoursAvailable * 60)} minutes).\nStudent note: ${focusNote || 'Feeling behind, need the highest-impact steps first.'}\n\nOpen Classwork Items:\n${JSON.stringify(openTasks, null, 2)}`,
      config: {
        systemInstruction:
          'You are an academic catch-up coach for a Jamaican AI Associate Degree student who has fallen behind. Pick the most urgent, high-impact tasks that fit realistically inside their available study minutes (leave short 5-10 min mental breathing room; never overload). Include exact taskId values from the input list when referencing a task, plus a practical micro-strategy tip for each step.',
        responseMimeType: 'application/json',
        responseSchema: sprintSchema,
      },
    });

    const parsed = JSON.parse(response.text ?? '{}');
    res.json({
      hoursAvailable,
      focusMessage: parsed.focusMessage || 'Take it one focused block at a time.',
      steps: Array.isArray(parsed.steps)
        ? parsed.steps.map((s: Record<string, unknown>, idx: number) => ({
            ...s,
            order: typeof s.order === 'number' ? s.order : idx + 1,
            completed: false,
          }))
        : [],
    });
  } catch (err) {
    const gErr = extractGeminiError(err);
    res.status(gErr.status).json({ error: gErr.message });
  }
});

function decodeBase64Url(data: string): string {
  const norm = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(norm, 'base64').toString('utf8');
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

interface GmailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
}

function extractGmailBody(payload?: GmailPart): string {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  if (payload.parts && Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return decodeBase64Url(part.body.data);
      }
    }
    for (const part of payload.parts) {
      const nested = extractGmailBody(part);
      if (nested) return nested;
    }
  }
  if (payload.mimeType === 'text/html' && payload.body?.data) {
    return stripHtml(decodeBase64Url(payload.body.data));
  }
  if (payload.body?.data) {
    return stripHtml(decodeBase64Url(payload.body.data));
  }
  return '';
}

// Gmail Messages Endpoint (uses client-side Bearer token)
app.get('/api/gmail/messages', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing Gmail authorization token. Please sign in with Google.' });
      return;
    }

    const q = String(req.query.q || '').trim();
    const listUrl = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
    listUrl.searchParams.set('maxResults', '12');
    if (q) {
      listUrl.searchParams.set('q', q);
    }

    const listResp = await fetch(listUrl.toString(), {
      headers: { Authorization: authHeader },
    });

    if (listResp.status === 401 || listResp.status === 403) {
      res.status(listResp.status).json({
        error: 'Gmail session expired or permission needed. Please sign in with Google again.',
      });
      return;
    }

    if (!listResp.ok) {
      const errBody = await listResp.text();
      res.status(listResp.status).json({ error: `Gmail API error: ${errBody}` });
      return;
    }

    const listData = (await listResp.json()) as { messages?: Array<{ id: string; threadId: string }> };
    const refs = listData.messages || [];

    const detailed = await Promise.all(
      refs.slice(0, 12).map(async (ref) => {
        const msgResp = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${ref.id}?format=full`,
          { headers: { Authorization: authHeader } },
        );
        if (!msgResp.ok) return null;
        const msg = (await msgResp.json()) as {
          id: string;
          threadId: string;
          snippet?: string;
          payload?: GmailPart & { headers?: Array<{ name: string; value: string }> };
        };
        const headers = msg.payload?.headers || [];
        const getHeader = (name: string) =>
          headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
        const bodyText = extractGmailBody(msg.payload) || msg.snippet || '';
        return {
          id: msg.id,
          threadId: msg.threadId,
          subject: getHeader('Subject') || '(No Subject)',
          from: getHeader('From') || 'Unknown Sender',
          date: getHeader('Date') || '',
          snippet: msg.snippet || '',
          bodyText: bodyText.slice(0, 8000),
        };
      }),
    );

    res.json({ messages: detailed.filter(Boolean) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to fetch Gmail messages' });
  }
});

// Extract Classwork, Deadlines & Zoom Links from Email or Pasted Announcement
app.post('/api/gmail/extract', async (req: Request, res: Response) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      res.status(500).json({ error: 'GEMINI_API_KEY is not configured in server secrets.' });
      return;
    }

    const { subject, from, date, bodyText, courses } = req.body;
    if (!bodyText || typeof bodyText !== 'string') {
      res.status(400).json({ error: 'Email content is required to extract classwork.' });
      return;
    }

    const courseCodes = Array.isArray(courses)
      ? courses.map((c: { code: string; title: string }) => `${c.code} (${c.title})`).join(', ')
      : 'AI-101, PY-102, MTH-104, DB-105';

    const extractSchema = {
      type: Type.OBJECT,
      properties: {
        summary: { type: Type.STRING },
        urgency: { type: Type.STRING, enum: ['High', 'Medium', 'Low'] },
        zoomLinks: { type: Type.ARRAY, items: { type: Type.STRING } },
        actionItems: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              type: {
                type: Type.STRING,
                enum: ['Assignment', 'Lab', 'Quiz', 'Module Reading', 'Lecture Catch-Up', 'Project'],
              },
              courseCode: { type: Type.STRING },
              dueDate: {
                type: Type.STRING,
                description: 'YYYY-MM-DD if known or inferred, otherwise TBD',
              },
              estimatedMinutes: { type: Type.INTEGER },
              notes: { type: Type.STRING },
            },
            required: ['title', 'type', 'courseCode', 'dueDate', 'estimatedMinutes', 'notes'],
          },
        },
      },
      required: ['summary', 'urgency', 'zoomLinks', 'actionItems'],
    };

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: `Known courses: ${courseCodes}\nEmail From: ${from || 'Lecturer'}\nDate: ${date || 'Recent'}\nSubject: ${subject || 'Class Update'}\n\nBody:\n${bodyText.slice(0, 15000)}`,
      config: {
        systemInstruction:
          'Extract classwork tasks, quizzes, readings, Zoom recording/meeting links, and deadlines from this student email or class announcement. Keep summaries concise and calming.',
        responseMimeType: 'application/json',
        responseSchema: extractSchema,
      },
    });

    const parsed = JSON.parse(response.text ?? '{}');
    res.json({
      summary: parsed.summary || '',
      urgency: parsed.urgency || 'Medium',
      zoomLinks: Array.isArray(parsed.zoomLinks) ? parsed.zoomLinks : [],
      actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
    });
  } catch (err) {
    const gErr = extractGeminiError(err);
    res.status(gErr.status).json({ error: gErr.message });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(ROOT_DIR, 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`StudyTrack AI server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
