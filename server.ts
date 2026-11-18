import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { GoogleGenAI, Type, createPartFromUri } from '@google/genai';
import { buildChromeExtensionZip } from './server/extensionBundle.ts';
import {
  SESSION_TTL_MS,
  createVideoSessionId,
  cutVideoClip,
  extractFrameJpg,
  formatDurationClock,
  getVideoSession,
  getVideoSessionsRoot,
  prepareLectureMedia,
  pruneVideoSessions,
  registerVideoSession,
} from './server/videoProcessor.ts';

const app = express();
const PORT = 3000;
const ROOT_DIR = process.cwd();
const UPLOADS_DIR = path.join(ROOT_DIR, 'uploads');

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

app.use((req: Request, res: Response, next) => {
  if (
    req.path.startsWith('/api/clip') ||
    req.path.startsWith('/api/extension') ||
    req.path === '/api/analyze/screenshot'
  ) {
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
  }
  next();
});

app.use(express.json({ limit: '15mb' }));

const upload = multer({
  dest: UPLOADS_DIR,
  limits: {
    fileSize: 1500 * 1024 * 1024, // Up to 1.5 GB for 1-hour+ Zoom / Webex HD recordings
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
const TRANSCRIBE_MODEL = MODEL_NAME;

const LATEX_GUIDANCE =
  ' When writing mathematical formulas, Discrete Math logic/set expressions (e.g., $\\forall x \\in S$, $p \\rightarrow q$, $A \\subseteq B$), Probability/Statistics equations (e.g., $P(A|B) = \\frac{P(B|A)P(A)}{P(B)}$, $\\mu$, $\\sigma^2$), linear algebra ($\\mathbf{W}\\mathbf{x} + \\mathbf{b}$), or ML loss/gradient formulas ($$\\nabla_\\theta J(\\theta)$$), format math using standard KaTeX-compatible LaTeX wrapped in $...$ for inline math and $$...$$ for display equations. Never wrap plain dollar currency amounts (like $50) or programming source code in LaTeX math delimiters.';

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
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
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
  if (msg.includes('503') || msg.includes('UNAVAILABLE')) {
    return {
      status: 503,
      message: 'The AI service is temporarily experiencing high demand. Please retry in a few seconds.',
    };
  }
  return { status: 500, message: msg || 'Failed to process request with AI.' };
}

const HEART_AMBER_CURRICULUM_CONTEXT = `HEART/NSTA Trust · National AI Lab · Amber Academy (Jamaica) — Associate Degree in Artificial Intelligence (52 Weeks):
Enrolled Portal Courses & Lecturers:
- AIL1001: Introduction to AI (B.C. Rajesh) — Friday 8:30–11:30 AM Revision
- AIL1002: Programming I (Python) (B.M. Rajesh; portal shows 50% progress) — Thursday 8:30–11:30 AM Revision
- AIL1003: Discrete Mathematics (B.C. Rajesh & B.M. Rajesh alternating weekly) — Wednesday 8:30–11:30 AM Revision
- STAT101: Statistics & Probability (Completed)
- AIL1004: Communication Skills for Engineers (S. Moffatt) — Monday 12:30–3:30 PM Revision
- ETH101: AI Law & Ethics / Ethics and Responsible AI (S. Moffatt) — Thursday 12:30–3:30 PM Revision
- AGD101: Agentic Development (Mon 8:30 B.C. Rajesh, Tue 8:30 B.M. Rajesh, Wed 12:30 Lab S. Jones, Fri 12:30 Lab J. Burrowes)
- DSA101: Data Structures & AI Project Work Labs (J. Burrowes — DSA concluded; Tue 12:30–3:30 PM AI Project Work Labs; Week 18 afternoons Dec 7–11 = Revision & Holiday Project Work)

52-Week 4-Phase & 9-Stage Roadmap:
- Phase 1 (Weeks 1–12 Foundations): Python (variables, conditionals, loops/functions, file handling, NumPy, Pandas, CSV reader, calculator, student record system), Math for AI, Data Science (preprocessing, visualization, feature engineering), Machine Learning Basics (Supervised regression/classification, Unsupervised clustering), Mini Capstone.
- Phase 2 (Weeks 13–24 AI Product Development): MLOps (Collect->Train->Evaluate->Deploy->Monitor->Retrain, MLflow, CI/CD, Git/GitHub), Docker Containers, REST API/FastAPI, Cloud Deployment (Colab, AWS, Azure AI, Google Cloud AI), Real-time AI Apps.
- Phase 3 (Weeks 25–40 LLMs & Deep Learning): NLP (Weeks 17–20: text cleaning, tokenization, stemming/lemmatization, NER, sentiment, summarization, BERT, chatbots), Neural Networks & Deep Learning (neurons, activation functions, backpropagation, TensorFlow, PyTorch, CNNs, Hugging Face), Transformer Architecture (tokenizer, embeddings, positional encoding, multi-head self-attention, decoder), Prompt Engineering (zero-shot, few-shot, CoT, role, structured), Fine-tuning & RLHF, Responsible AI & Ethics (bias, fairness, XAI, privacy, security, hallucinations), Model Optimization (quantization, pruning, compression, distillation, Edge AI).
- Phase 4 (Weeks 41–52 Industry Capstone): Problem ID, dataset collection, preprocessing, model dev, testing, deployment, documentation, final presentation.`;

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
  return 'AIL1001 (Introduction to AI), AIL1002 (Programming I Python), AIL1003 (Discrete Mathematics), STAT101 (Statistics & Probability), AIL1004 (Communication Skills for Engineers), ETH101 (AI Law & Ethics), AGD101 (Agentic Development), DSA101 (Data Structures & AI Project Work)';
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
      `You are an encouraging, crystal-clear tutor and academic organizer helping an Associate Degree in Artificial Intelligence student in Jamaica who fell behind. Automatically classify the file into the right course, assign a clear module topic folder name, tag 4-7 searchable keywords, explain concepts in plain English with everyday analogies or short Python/math examples, and extract every assignment or deadline mentioned.${LATEX_GUIDANCE}`;

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
        ? String(parsed.detectedCourseCode || 'AIL1001').trim()
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
      `You are a patient tutor and study library organizer helping an Associate Degree in Artificial Intelligence student in Jamaica understand downloaded course module files. Auto-classify the file by course code and module topic, tag 4-7 searchable keywords, translate academic jargon into plain English with worked Python/math examples, and capture key definitions for Q&A.${LATEX_GUIDANCE}`;

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
        ? String(parsed.detectedCourseCode || 'AIL1001').trim()
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

// Portal Screenshot OCR & Coursework Extractor (Lens-style multimodal vision extraction)
app.post('/api/analyze/screenshot', upload.array('files', 6), async (req: Request, res: Response) => {
  const uploadedFiles = Array.isArray(req.files) ? (req.files as Express.Multer.File[]) : [];

  try {
    if (!process.env.GEMINI_API_KEY) {
      res.status(500).json({ error: 'GEMINI_API_KEY is not configured in server secrets.' });
      return;
    }

    if (uploadedFiles.length === 0) {
      res.status(400).json({
        error: 'Please upload or paste at least one screenshot image (.png, .jpg, .webp).',
      });
      return;
    }

    const requestedCourseCode = String(req.body.courseCode || 'AUTO').trim();
    const requestedTitle = String(req.body.title || '').trim();
    const extraContext = String(req.body.extraContext || '').trim();
    const knownCourses = parseCoursesField(req.body.courses);

    const imageParts = uploadedFiles.map((f) => {
      const mimeType = guessMimeType(f.path, f.originalname, f.mimetype);
      const safeMime = mimeType.startsWith('image/') ? mimeType : 'image/png';
      const base64Data = fs.readFileSync(f.path).toString('base64');
      return {
        inlineData: {
          mimeType: safeMime,
          data: base64Data,
        },
      };
    });

    const screenshotSchema = {
      type: Type.OBJECT,
      properties: {
        extractedText: {
          type: Type.STRING,
          description:
            'Complete, cleanly formatted verbatim text read from all uploaded screenshot(s), preserving headings, bullet points, dates, percentages, and any code or tables.',
        },
        detectedCourseCode: {
          type: Type.STRING,
          description: 'Best matching course code from the student course list.',
        },
        moduleTopic: {
          type: Type.STRING,
          description:
            'Clean module topic folder name, e.g., "Portal Screenshot · Module 3 Progress" or "Slide Capture · NLP Pipelines".',
        },
        suggestedTitle: {
          type: Type.STRING,
          description: 'Concise, descriptive title for what the screenshot(s) show.',
        },
        keywords: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: '4 to 7 specific searchable keywords found in the screenshot.',
        },
        overview: {
          type: Type.STRING,
          description: 'Clear 2-3 sentence plain-English explanation of what the screenshot shows and what the student should do next.',
        },
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
          description: 'Helpful tip on deadlines, incomplete modules, or tricky concepts visible in the screenshot.',
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
              dueDate: { type: Type.STRING },
              estimatedMinutes: { type: Type.INTEGER },
              notes: { type: Type.STRING },
            },
            required: ['title', 'type', 'dueDate', 'estimatedMinutes', 'notes'],
          },
          description:
            'Any assignments, quizzes, incomplete modules, labs, or deadlines spotted in the screenshot(s). Empty array if none.',
        },
        detectedCardType: {
          type: Type.STRING,
          enum: ['code', 'checklist', 'note'],
          description:
            'Auto-categorize the main extracted content like Zoho Notebook: "code" if the screenshot primarily contains source code, terminal commands, SQL, JSON, or Jupyter cells; "checklist" if it is a list of assignments/steps/requirements; otherwise "note".',
        },
        codeLanguage: {
          type: Type.STRING,
          description:
            'Detected programming language when detectedCardType is "code" (e.g., "python", "javascript", "typescript", "sql", "bash", "json", "html", "css"), or "text" otherwise.',
        },
        formattedContent: {
          type: Type.STRING,
          description:
            'If detectedCardType is "code", output ONLY the cleanly formatted, properly indented source code extracted from the screenshot (preserve syntax accurately, no markdown fences). Otherwise output clean structured study notes.',
        },
        checklistItems: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description:
            'If detectedCardType is "checklist" (or tasks exist), concise actionable checklist lines; otherwise empty array [].',
        },
      },
      required: [
        'extractedText',
        'detectedCourseCode',
        'moduleTopic',
        'suggestedTitle',
        'keywords',
        'overview',
        'learningObjectives',
        'topicBreakdowns',
        'difficultyNote',
        'actionItems',
        'detectedCardType',
        'codeLanguage',
        'formattedContent',
        'checklistItems',
      ],
    };

    const courseHint =
      requestedCourseCode === 'AUTO'
        ? `Automatically classify which course from [${knownCourses}] this screenshot belongs to.`
        : `User selected course: ${requestedCourseCode} (from [${knownCourses}]).`;

    const fileNames = uploadedFiles.map((f) => f.originalname).join(', ');
    const promptText = `${courseHint}
Uploaded Screenshot File(s): ${fileNames}
Title hint: ${requestedTitle || 'Auto-detect from screenshot'}
${extraContext ? `Student note: ${extraContext}` : ''}

Official Curriculum Reference:
${HEART_AMBER_CURRICULUM_CONTEXT}

Perform accurate OCR on every screenshot image:
1. Transcribe all visible text cleanly into "extractedText" (headings, bullet items, portal percentages, due dates, code, slide content).
2. Auto-categorize what kind of content was captured in "detectedCardType" ("code" for Python/JS/SQL/terminal/Jupyter snippets, "checklist" for task/module lists, or "note" for general slides/notes). If "code", set "codeLanguage" and place clean properly indented code in "formattedContent" without markdown backticks.
3. Auto-tag course code, moduleTopic, and searchable keywords.
4. Explain the captured concepts or portal instructions in plain English with topicBreakdowns.
5. Extract any incomplete modules, quizzes, labs, or deadlines into "actionItems".`;

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: {
        parts: [...imageParts, { text: promptText }],
      },
      config: {
        systemInstruction:
          `You are an accurate academic OCR scanner, smart note categorizer, and AI tutor for a HEART/NSTA Amber Academy AI Associate Degree student in Jamaica. Read every detail on school portal screenshots, IDE/Jupyter code captures, class slides, Moodle/LMS pages, and assignment prompts with high precision, extract the full readable text cleanly, auto-categorize code vs checklist vs note cleanly like Zoho Notebook, and surface any deadlines or catch-up items.${LATEX_GUIDANCE}`,
        responseMimeType: 'application/json',
        responseSchema: screenshotSchema,
      },
    });

    const parsed = JSON.parse(response.text ?? '{}');
    const finalCourseCode =
      requestedCourseCode === 'AUTO'
        ? String(parsed.detectedCourseCode || 'AIL1001').trim()
        : requestedCourseCode;

    const extractedText = String(parsed.extractedText || '').trim();
    const displayFileName =
      uploadedFiles.length === 1
        ? uploadedFiles[0].originalname
        : `${uploadedFiles[0].originalname} (+${uploadedFiles.length - 1} more)`;

    const cardType =
      parsed.detectedCardType === 'code' || parsed.detectedCardType === 'checklist'
        ? parsed.detectedCardType
        : 'note';
    const rawChecklist = Array.isArray(parsed.checklistItems)
      ? parsed.checklistItems.map(String).filter(Boolean).slice(0, 30)
      : [];

    res.json({
      extractedText,
      actionItems: Array.isArray(parsed.actionItems)
        ? parsed.actionItems.map((item: Record<string, unknown>) => ({
            ...item,
            addedToTracker: false,
          }))
        : [],
      smartCard: {
        courseCode: finalCourseCode,
        title: requestedTitle || String(parsed.suggestedTitle || displayFileName).trim(),
        cardType,
        colorTag: cardType === 'code' ? 'slate' : cardType === 'checklist' ? 'amber' : 'blue',
        pinned: false,
        content: String(parsed.formattedContent || extractedText).trim(),
        codeLanguage: String(parsed.codeLanguage || (cardType === 'code' ? 'python' : 'text')).toLowerCase(),
        codeSettings: {
          theme: 'dark',
          showLineNumbers: true,
          wordWrap: false,
          fontSize: 'md',
        },
        checklistItems: rawChecklist.map((text: string) => ({ text, done: false })),
        keywords: Array.isArray(parsed.keywords) ? parsed.keywords.map(String).slice(0, 10) : [],
        reminderAt: '',
        sourceLabel: `Snip OCR · ${displayFileName}`,
      },
      moduleGuide: {
        courseCode: finalCourseCode,
        moduleTopic: String(parsed.moduleTopic || 'Portal Screenshot Scan').trim(),
        keywords: Array.isArray(parsed.keywords) ? parsed.keywords.map(String).slice(0, 10) : [],
        title: requestedTitle || String(parsed.suggestedTitle || displayFileName).trim(),
        fileName: displayFileName,
        overview: String(parsed.overview || '').trim(),
        learningObjectives: Array.isArray(parsed.learningObjectives)
          ? parsed.learningObjectives
          : [],
        topicBreakdowns: Array.isArray(parsed.topicBreakdowns) ? parsed.topicBreakdowns : [],
        difficultyNote: String(parsed.difficultyNote || '').trim(),
        extractedTextPreview: extractedText.slice(0, 7500),
      },
    });
  } catch (err) {
    const gErr = extractGeminiError(err);
    res.status(gErr.status).json({ error: gErr.message });
  } finally {
    for (const f of uploadedFiles) {
      safeUnlink(f.path);
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
      contents: `Today's date: ${new Date().toISOString().slice(0, 10)}\n\nProgram Syllabus Reference:\n${HEART_AMBER_CURRICULUM_CONTEXT}\n\nCourses:\n${JSON.stringify(courses)}\n\nTasks:\n${JSON.stringify(tasks)}\n\nUploaded Zoom Lectures:\n${JSON.stringify(compactLectures)}\n\nUploaded Module Files:\n${JSON.stringify(compactModules)}\n\nSynced Course Emails:\n${JSON.stringify(compactEmails)}`,
      config: {
        systemInstruction:
          'You are an academic progress advisor for a HEART/NSTA Trust · Amber Academy AI Associate Degree student in Jamaica. Cross-analyze their courses, open/completed tasks, uploaded Zoom lectures, uploaded module files, recent lecturer emails, and their 52-week curriculum & Week 17–18 revision schedule. Identify exact topics where the student is behind or missing prerequisite understanding, rank them from most urgent (#1) to least urgent, and attach exact linkedMaterials (using the real id values from lectures, modules, tasks, or emails) so the student can click directly into the right study material.',
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
    const smartNotes = Array.isArray(req.body.smartNotes) ? req.body.smartNotes : [];

    if (!question) {
      res.status(400).json({ error: 'Please enter a question about your course materials.' });
      return;
    }

    const filterFn = (courseCode: unknown) =>
      courseFilter === 'ALL' || String(courseCode || '').toUpperCase() === courseFilter.toUpperCase();

    const noteDocs = smartNotes
      .filter((n: Record<string, unknown>) => filterFn(n.courseCode))
      .slice(0, 12)
      .map((n: Record<string, unknown>) => ({
        kind: 'note',
        id: String(n.id || ''),
        courseCode: String(n.courseCode || ''),
        title: String(n.title || ''),
        cardType: String(n.cardType || 'note'),
        codeLanguage: String(n.codeLanguage || ''),
        content: String(n.content || '').slice(0, 1800),
      }));

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
      contents: `Course Focus: ${courseFilter}\n\nCurriculum Outline:\n${HEART_AMBER_CURRICULUM_CONTEXT}\n\nUploaded Zoom Lecture Transcripts & Summaries:\n${JSON.stringify(lectureDocs)}\n\nUploaded Module Files & Breakdowns:\n${JSON.stringify(moduleDocs)}\n\nSaved Smart Notebook Cards:\n${JSON.stringify(noteDocs)}\n\nRecent Course Emails:\n${JSON.stringify(emailDocs)}\n\nConversation History:\n${historyText}\n\nStudent Question: ${question}`,
      config: {
        systemInstruction:
          `You are the student’s personal AI Associate Degree Study Chatbot for HEART/NSTA Amber Academy in Jamaica. Answer questions accurately using their uploaded Zoom lecture transcripts, module files, and lecturer emails whenever relevant. If a concept is from their official syllabus but not uploaded yet, explain it clearly from AI fundamentals and mention which file/module they can upload next. Always populate citations using the exact id, kind, title, and courseCode of the materials you referenced.${LATEX_GUIDANCE}`,
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
      contents: `Course Scope: ${courseFilter}\nAlready Mastered Concepts: ${JSON.stringify(masteredConcepts)}\n\nOfficial Curriculum Context:\n${HEART_AMBER_CURRICULUM_CONTEXT}\n\nUploaded Zoom Lectures:\n${JSON.stringify(lectureDocs)}\n\nUploaded Module Files:\n${JSON.stringify(moduleDocs)}\n\nRecent Emails:\n${JSON.stringify(emailDocs)}\n\nConversation So Far:\n${historyText || '(New session)'}\n\nInstruction:\n${actionPrompt}`,
      config: {
        systemInstruction:
          `You are an encouraging Brisk-style Socratic Mastery Coach for a HEART/NSTA Amber Academy AI Associate Degree student in Jamaica. Your job is to ensure the student truly learns concepts by asking check-for-understanding questions one at a time. CRITICAL RULES: (1) Never accept a wrong, vague, or "I don't know" answer as mastered. (2) If the student gets it wrong or partially right, set evaluationStatus="retry", gently clarify the misconception with a plain-English hint/analogy, and ask them back until they get it right. (3) Only set evaluationStatus="mastered" when their explanation/answer is genuinely correct, affirm why, and immediately ask a check question on the next unmastered concept from their materials or official curriculum topics. (4) Keep replies concise, supportive, and cite uploaded lectures/modules whenever used.${LATEX_GUIDANCE}`,
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
      contents: `Requested Course: ${courseFilter}\nRequested Topic Focus: ${topicFocus || 'Key concepts from the materials'}\nDifficulty: ${difficulty}\nTarget Question Count: ${questionCount}\n\nOfficial Curriculum Context:\n${HEART_AMBER_CURRICULUM_CONTEXT}\n\nUploaded Zoom Lectures:\n${JSON.stringify(lectureDocs)}\n\nUploaded Module Files:\n${JSON.stringify(moduleDocs)}`,
      config: {
        systemInstruction: `You are a HEART/NSTA Amber Academy AI Associate Degree instructor creating a practical, interactive study quiz. Generate exactly ${questionCount} questions grounded in the provided Zoom lectures and module guides (or aligned to the requested course/topic from the official curriculum if no files match yet). Mix ~70% "mcq" (multiple choice with exactly 4 distinct options and a valid correctOptionIndex 0..3) and ~30% "short" (explain-in-your-own-words questions). Adjust depth for difficulty="${difficulty}" ("Review" = approachable foundational checks; "Standard" = Associate exam readiness; "Challenge" = applied code/math/debugging scenarios). Give every question a unique id like "q1", "q2", etc.${LATEX_GUIDANCE}`,
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
            courseCode: String(q.courseCode || (courseFilter === 'ALL' ? 'AIL1001' : courseFilter)),
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
    const courseCode = String(req.body.courseCode || 'AIL1001').trim();
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
          `You are grading a short-answer quiz response from an AI Associate Degree student. Grade based on conceptual accuracy rather than exact wording (accept valid LaTeX or plain-text mathematical equivalents). Use "correct" when they clearly understand the core idea, "partial" when they got part of it right but missed an important detail, and "incorrect" when the reasoning is wrong or too vague. Provide helpful, encouraging feedback with a concrete hint if partial or incorrect.${LATEX_GUIDANCE}`,
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
          `You are a patient, supportive AI Associate Degree study tutor. Explain concepts clearly in plain language, step by step, using short concrete analogies or simple Python/math examples. Never make the student feel bad for being behind. Keep answers focused, well-structured, and easy to digest in 2-3 minutes.${LATEX_GUIDANCE}`,
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

    const courseCodes = Array.isArray(courses) && courses.length > 0
      ? courses.map((c: { code: string; title: string }) => `${c.code} (${c.title})`).join(', ')
      : 'AIL1001, AIL1002, AIL1003, STAT101, AIL1004, ETH101, AGD101, DSA101';

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

// Google Calendar Endpoints (uses client-side Bearer token)
app.get('/api/calendar/events', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing Google Calendar authorization token. Please sign in with Google.' });
      return;
    }

    const timeMin = String(req.query.timeMin || new Date().toISOString());
    const timeMax = String(
      req.query.timeMax || new Date(Date.now() + 35 * 24 * 60 * 60 * 1000).toISOString(),
    );
    const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
    url.searchParams.set('singleEvents', 'true');
    url.searchParams.set('orderBy', 'startTime');
    url.searchParams.set('maxResults', '40');
    url.searchParams.set('timeMin', timeMin);
    url.searchParams.set('timeMax', timeMax);

    const resp = await fetch(url.toString(), {
      headers: { Authorization: authHeader },
    });

    if (resp.status === 401 || resp.status === 403) {
      res.status(resp.status).json({
        error: 'Google Calendar authorization expired or missing. Please re-authorize Google Workspace.',
      });
      return;
    }

    if (!resp.ok) {
      const errBody = await resp.text();
      res.status(resp.status).json({ error: `Google Calendar error: ${errBody}` });
      return;
    }

    const data = (await resp.json()) as {
      items?: Array<{
        id: string;
        summary?: string;
        description?: string;
        location?: string;
        htmlLink?: string;
        start?: { dateTime?: string; date?: string };
        end?: { dateTime?: string; date?: string };
      }>;
    };

    const events = (data.items || []).map((ev) => ({
      id: ev.id,
      summary: ev.summary || '(Untitled Event)',
      description: ev.description || '',
      location: ev.location || '',
      htmlLink: ev.htmlLink || '',
      start: ev.start?.dateTime || ev.start?.date || '',
      end: ev.end?.dateTime || ev.end?.date || '',
      isAllDay: Boolean(ev.start?.date && !ev.start?.dateTime),
    }));

    res.json({ events });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to fetch Calendar events.' });
  }
});

app.post('/api/calendar/events', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing Google Calendar authorization token.' });
      return;
    }

    const rawEvents = Array.isArray(req.body.events)
      ? req.body.events
      : req.body.summary
        ? [req.body]
        : [];

    if (rawEvents.length === 0) {
      res.status(400).json({ error: 'At least one calendar event payload is required.' });
      return;
    }

    const created: Array<Record<string, unknown>> = [];

    for (const item of rawEvents.slice(0, 20)) {
      const summary = String(item.summary || '').trim();
      const description = String(item.description || '').trim();
      const location = String(item.location || '').trim();
      const startTime = String(item.startDateTime || '').trim();
      const endTime = String(item.endDateTime || '').trim();
      const dateOnly = String(item.date || '').trim();

      if (!summary) continue;

      const bodyPayload: Record<string, unknown> = {
        summary,
        description,
        ...(location ? { location } : {}),
      };

      if (startTime && endTime) {
        bodyPayload.start = { dateTime: startTime, timeZone: 'America/Jamaica' };
        bodyPayload.end = { dateTime: endTime, timeZone: 'America/Jamaica' };
      } else if (dateOnly) {
        bodyPayload.start = { date: dateOnly };
        bodyPayload.end = { date: dateOnly };
      } else {
        continue;
      }

      const resp = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(bodyPayload),
      });

      if (resp.status === 401 || resp.status === 403) {
        res.status(resp.status).json({
          error: 'Google Calendar write permission needed. Please re-authorize Google Workspace.',
        });
        return;
      }

      if (!resp.ok) {
        const errText = await resp.text();
        res.status(resp.status).json({ error: `Could not create calendar event: ${errText}` });
        return;
      }

      const ev = (await resp.json()) as {
        id: string;
        summary?: string;
        htmlLink?: string;
        start?: { dateTime?: string; date?: string };
        end?: { dateTime?: string; date?: string };
      };
      created.push({
        id: ev.id,
        summary: ev.summary || summary,
        htmlLink: ev.htmlLink || '',
        start: ev.start?.dateTime || ev.start?.date || '',
        end: ev.end?.dateTime || ev.end?.date || '',
      });
    }

    res.json({ created });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create Calendar events.' });
  }
});

app.delete('/api/calendar/events/:eventId', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing Google Calendar authorization token.' });
      return;
    }

    const eventId = encodeURIComponent(String(req.params.eventId || '').trim());
    if (!eventId) {
      res.status(400).json({ error: 'Event ID is required.' });
      return;
    }

    const resp = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
      {
        method: 'DELETE',
        headers: { Authorization: authHeader },
      },
    );

    if (resp.status === 401 || resp.status === 403) {
      res.status(resp.status).json({
        error: 'Google Calendar authorization expired or missing. Please re-authorize Google Workspace.',
      });
      return;
    }

    if (!resp.ok && resp.status !== 204) {
      const errBody = await resp.text();
      res.status(resp.status).json({ error: `Failed to delete calendar event: ${errBody}` });
      return;
    }

    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to delete Calendar event.' });
  }
});

// Helper to flatten Google Docs StructuralElement tree into readable plain text
function extractGoogleDocPlainText(docJson: {
  body?: {
    content?: Array<{
      paragraph?: { elements?: Array<{ textRun?: { content?: string } }> };
      table?: {
        tableRows?: Array<{
          tableCells?: Array<{
            content?: Array<{
              paragraph?: { elements?: Array<{ textRun?: { content?: string } }> };
            }>;
          }>;
        }>;
      };
    }>;
  };
}): { plainText: string; endIndex: number } {
  const parts: string[] = [];
  const content = docJson.body?.content || [];
  let maxEndIndex = 1;

  for (const item of content as Array<Record<string, unknown>>) {
    if (typeof item.endIndex === 'number' && item.endIndex > maxEndIndex) {
      maxEndIndex = item.endIndex;
    }
    const para = item.paragraph as
      | { elements?: Array<{ textRun?: { content?: string } }> }
      | undefined;
    if (para?.elements) {
      const line = para.elements.map((el) => el.textRun?.content || '').join('');
      if (line) parts.push(line);
    }
    const tbl = item.table as
      | {
          tableRows?: Array<{
            tableCells?: Array<{
              content?: Array<{
                paragraph?: { elements?: Array<{ textRun?: { content?: string } }> };
              }>;
            }>;
          }>;
        }
      | undefined;
    if (tbl?.tableRows) {
      for (const row of tbl.tableRows) {
        const rowCells: string[] = [];
        for (const cell of row.tableCells || []) {
          const cellText = (cell.content || [])
            .map((c) => (c.paragraph?.elements || []).map((e) => e.textRun?.content || '').join(''))
            .join(' ')
            .trim();
          if (cellText) rowCells.push(cellText);
        }
        if (rowCells.length > 0) parts.push(rowCells.join(' | ') + '\n');
      }
    }
  }

  return { plainText: parts.join('').trim(), endIndex: maxEndIndex };
}

// Google Docs & Drive Listing Endpoints (uses client-side Bearer token)
app.get('/api/docs/list', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing Google Docs authorization token. Please sign in with Google.' });
      return;
    }

    const search = String(req.query.q || '').trim().replace(/'/g, "\\'");
    const qParts = ["mimeType='application/vnd.google-apps.document'", 'trashed=false'];
    if (search) {
      qParts.push(`name contains '${search}'`);
    }

    const url = new URL('https://www.googleapis.com/drive/v3/files');
    url.searchParams.set('q', qParts.join(' and '));
    url.searchParams.set('orderBy', 'modifiedTime desc');
    url.searchParams.set('pageSize', '20');
    url.searchParams.set('fields', 'files(id,name,modifiedTime,webViewLink)');

    const resp = await fetch(url.toString(), {
      headers: { Authorization: authHeader },
    });

    if (resp.status === 401 || resp.status === 403) {
      res.status(resp.status).json({
        error: 'Google Docs/Drive authorization expired or missing. Please re-authorize Google Workspace.',
      });
      return;
    }

    if (!resp.ok) {
      const errBody = await resp.text();
      res.status(resp.status).json({ error: `Google Drive error: ${errBody}` });
      return;
    }

    const data = (await resp.json()) as {
      files?: Array<{ id: string; name: string; modifiedTime?: string; webViewLink?: string }>;
    };
    res.json({
      files: (data.files || []).map((f) => ({
        id: f.id,
        name: f.name,
        modifiedTime: f.modifiedTime || '',
        webViewLink: f.webViewLink || '',
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to list Google Docs.' });
  }
});

app.get('/api/docs/:documentId', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing Google Docs authorization token.' });
      return;
    }

    const documentId = encodeURIComponent(String(req.params.documentId || '').trim());
    const resp = await fetch(`https://docs.googleapis.com/v1/documents/${documentId}`, {
      headers: { Authorization: authHeader },
    });

    if (resp.status === 401 || resp.status === 403) {
      res.status(resp.status).json({
        error: 'Google Docs permission needed. Please re-authorize Google Workspace.',
      });
      return;
    }

    if (!resp.ok) {
      const errBody = await resp.text();
      res.status(resp.status).json({ error: `Google Docs error: ${errBody}` });
      return;
    }

    const docJson = (await resp.json()) as {
      documentId: string;
      title?: string;
      revisionId?: string;
      body?: Record<string, unknown>;
    };
    const { plainText } = extractGoogleDocPlainText(docJson as never);

    res.json({
      documentId: docJson.documentId,
      title: docJson.title || 'Untitled Document',
      plainText,
      revisionId: docJson.revisionId || '',
      webViewLink: `https://docs.google.com/document/d/${docJson.documentId}/edit`,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to read Google Doc.' });
  }
});

app.post('/api/docs/create', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing Google Docs authorization token.' });
      return;
    }

    const title = String(req.body.title || 'StudyTrack AI Catch-Up Notes').trim().slice(0, 200);
    const content = String(req.body.content || '').trim();

    const createResp = await fetch('https://docs.googleapis.com/v1/documents', {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title }),
    });

    if (createResp.status === 401 || createResp.status === 403) {
      res.status(createResp.status).json({
        error: 'Google Docs creation permission needed. Please re-authorize Google Workspace.',
      });
      return;
    }

    if (!createResp.ok) {
      const errText = await createResp.text();
      res.status(createResp.status).json({ error: `Could not create Google Doc: ${errText}` });
      return;
    }

    const created = (await createResp.json()) as { documentId: string; title: string };

    if (content) {
      const batchResp = await fetch(
        `https://docs.googleapis.com/v1/documents/${created.documentId}:batchUpdate`,
        {
          method: 'POST',
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            requests: [
              {
                insertText: {
                  location: { index: 1 },
                  text: content,
                },
              },
            ],
          }),
        },
      );
      if (!batchResp.ok) {
        const errText = await batchResp.text();
        res.status(batchResp.status).json({ error: `Created Doc but failed writing text: ${errText}` });
        return;
      }
    }

    res.json({
      documentId: created.documentId,
      title: created.title,
      webViewLink: `https://docs.google.com/document/d/${created.documentId}/edit`,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create Google Doc.' });
  }
});

app.post('/api/docs/:documentId/append', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing Google Docs authorization token.' });
      return;
    }

    const documentId = encodeURIComponent(String(req.params.documentId || '').trim());
    const content = String(req.body.content || '').trim();
    if (!content) {
      res.status(400).json({ error: 'Content to append is required.' });
      return;
    }

    const getResp = await fetch(`https://docs.googleapis.com/v1/documents/${documentId}`, {
      headers: { Authorization: authHeader },
    });
    if (!getResp.ok) {
      const errText = await getResp.text();
      res.status(getResp.status).json({ error: `Could not inspect target Google Doc: ${errText}` });
      return;
    }

    const docJson = (await getResp.json()) as Record<string, unknown>;
    const { endIndex } = extractGoogleDocPlainText(docJson as never);
    const insertIndex = Math.max(1, endIndex - 1);

    const updateResp = await fetch(
      `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: [
            {
              insertText: {
                location: { index: insertIndex },
                text: `\n\n${content}`,
              },
            },
          ],
        }),
      },
    );

    if (!updateResp.ok) {
      const errText = await updateResp.text();
      res.status(updateResp.status).json({ error: `Failed to append to Google Doc: ${errText}` });
      return;
    }

    res.json({
      documentId: String(docJson.documentId || req.params.documentId),
      webViewLink: `https://docs.google.com/document/d/${String(docJson.documentId || req.params.documentId)}/edit`,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update Google Doc.' });
  }
});

// Zoho Notebook-style Smart Auto-Categorization for Pasted Text or Code
app.post('/api/notes/categorize', async (req: Request, res: Response) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      res.status(500).json({ error: 'GEMINI_API_KEY is not configured in server secrets.' });
      return;
    }

    const rawText = String(req.body.rawText || '').trim();
    const requestedCourseCode = String(req.body.courseCode || 'AUTO').trim();
    const knownCourses = parseCoursesField(req.body.courses);

    if (!rawText) {
      res.status(400).json({ error: 'Paste code, checklist items, or study notes first.' });
      return;
    }

    const noteSchema = {
      type: Type.OBJECT,
      properties: {
        cardType: {
          type: Type.STRING,
          enum: ['code', 'checklist', 'note'],
          description:
            'Use "code" if the pasted content is source code, SQL, terminal commands, JSON, HTML/CSS, or a script; "checklist" if it is a list of tasks/steps/todo items; otherwise "note".',
        },
        codeLanguage: {
          type: Type.STRING,
          description:
            'Exact lowercase language identifier for code ("python", "javascript", "typescript", "sql", "bash", "json", "html", "css"), or "text" for non-code.',
        },
        title: {
          type: Type.STRING,
          description: 'Concise descriptive title for the card (3 to 8 words).',
        },
        courseCode: {
          type: Type.STRING,
          description: 'Best matching course code from the student course list.',
        },
        formattedContent: {
          type: Type.STRING,
          description:
            'If cardType is "code", output clean, properly indented source code with NO markdown backticks. If "note", clean structured note prose. If "checklist", a short 1-sentence intro.',
        },
        checklistItems: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'Actionable checklist items if cardType is "checklist", else empty array [].',
        },
        keywords: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: '3 to 6 searchable keywords.',
        },
      },
      required: [
        'cardType',
        'codeLanguage',
        'title',
        'courseCode',
        'formattedContent',
        'checklistItems',
        'keywords',
      ],
    };

    const courseHint =
      requestedCourseCode === 'AUTO'
        ? `Pick the best course from [${knownCourses}].`
        : `Use course ${requestedCourseCode}.`;

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: `${courseHint}\n\nPasted Student Content:\n${rawText.slice(0, 14000)}`,
      config: {
        systemInstruction:
          'You are a smart Zoho Notebook auto-organizer for an AI Associate Degree student. Inspect pasted text or OCR output, detect whether it is a Code Snippet, an interactive Checklist, or a Study Note, detect the programming language accurately, clean formatting/indentation without markdown fences, and tag it cleanly.',
        responseMimeType: 'application/json',
        responseSchema: noteSchema,
      },
    });

    const parsed = JSON.parse(response.text ?? '{}');
    const cardType =
      parsed.cardType === 'code' || parsed.cardType === 'checklist' ? parsed.cardType : 'note';

    res.json({
      courseCode:
        requestedCourseCode === 'AUTO'
          ? String(parsed.courseCode || 'AIL1002').trim()
          : requestedCourseCode,
      title: String(parsed.title || 'Captured Study Card').trim(),
      cardType,
      colorTag: cardType === 'code' ? 'slate' : cardType === 'checklist' ? 'amber' : 'emerald',
      pinned: false,
      content: String(parsed.formattedContent || rawText).trim(),
      codeLanguage: String(parsed.codeLanguage || (cardType === 'code' ? 'python' : 'text')).toLowerCase(),
      codeSettings: {
        theme: 'dark',
        showLineNumbers: true,
        wordWrap: false,
        fontSize: 'md',
      },
      checklistItems: Array.isArray(parsed.checklistItems)
        ? parsed.checklistItems.map((t: unknown) => ({ text: String(t || ''), done: false })).filter((i: { text: string }) => i.text)
        : [],
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords.map(String).slice(0, 8) : [],
      reminderAt: '',
      sourceLabel: 'Smart Auto-Categorized Paste',
    });
  } catch (err) {
    const gErr = extractGeminiError(err);
    res.status(gErr.status).json({ error: gErr.message });
  }
});

// NotebookLM-Inspired Study Studio (Briefing, Dual-Host Podcast Script, Mind Map & Flip Flashcards)
app.post('/api/studio/notebooklm', async (req: Request, res: Response) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      res.status(500).json({ error: 'GEMINI_API_KEY is not configured in server secrets.' });
      return;
    }

    const courseFilter = String(req.body.courseFilter || 'ALL').trim();
    const lectures = Array.isArray(req.body.lectures) ? req.body.lectures : [];
    const modules = Array.isArray(req.body.modules) ? req.body.modules : [];
    const smartNotes = Array.isArray(req.body.smartNotes) ? req.body.smartNotes : [];

    const { lectureDocs, moduleDocs } = buildCompactStudyContext(
      lectures,
      modules,
      [],
      courseFilter,
    );

    const noteDocs = smartNotes
      .filter(
        (n: Record<string, unknown>) =>
          courseFilter === 'ALL' ||
          String(n.courseCode || '').toUpperCase() === courseFilter.toUpperCase(),
      )
      .slice(0, 12)
      .map((n: Record<string, unknown>) => ({
        courseCode: String(n.courseCode || ''),
        title: String(n.title || ''),
        cardType: String(n.cardType || 'note'),
        codeLanguage: String(n.codeLanguage || ''),
        content: String(n.content || '').slice(0, 1500),
      }));

    const studioSchema = {
      type: Type.OBJECT,
      properties: {
        briefingTitle: { type: Type.STRING },
        briefingSummary: {
          type: Type.STRING,
          description:
            'Focused 3-4 sentence NotebookLM-style study briefing tying together key themes across the selected materials.',
        },
        podcastDialogue: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              speaker: { type: Type.STRING, enum: ['Alex', 'Sam'] },
              line: {
                type: Type.STRING,
                description:
                  'Conversational 1-2 sentence spoken dialogue line explaining concepts clearly with real-world examples.',
              },
            },
            required: ['speaker', 'line'],
          },
          description: '8 to 10 alternating turns between Alex (energetic guide) and Sam (curious co-host).',
        },
        mindMap: {
          type: Type.OBJECT,
          properties: {
            rootTitle: { type: Type.STRING },
            rootSummary: { type: Type.STRING },
            branches: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  summary: { type: Type.STRING },
                  courseCode: { type: Type.STRING },
                  children: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        label: { type: Type.STRING },
                        detail: { type: Type.STRING },
                      },
                      required: ['label', 'detail'],
                    },
                  },
                },
                required: ['title', 'summary', 'courseCode', 'children'],
              },
              description: '4 to 6 main concept branches, each with 2 to 4 child concepts.',
            },
          },
          required: ['rootTitle', 'rootSummary', 'branches'],
        },
        flashcards: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              front: { type: Type.STRING },
              back: { type: Type.STRING },
              hint: { type: Type.STRING },
              courseCode: { type: Type.STRING },
            },
            required: ['id', 'front', 'back', 'hint', 'courseCode'],
          },
          description: '6 to 8 high-yield active-recall flashcards.',
        },
      },
      required: ['briefingTitle', 'briefingSummary', 'podcastDialogue', 'mindMap', 'flashcards'],
    };

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: `Course Filter: ${courseFilter}\n\nCurriculum Outline:\n${HEART_AMBER_CURRICULUM_CONTEXT}\n\nZoom Lectures:\n${JSON.stringify(lectureDocs)}\n\nModule Guides:\n${JSON.stringify(moduleDocs)}\n\nSmart Notebook Cards:\n${JSON.stringify(noteDocs)}`,
      config: {
        systemInstruction:
          `You are a NotebookLM-inspired Study Studio for a HEART/NSTA Amber Academy AI Associate Degree student. Synthesize the student’s uploaded lectures, modules, code snippets, and curriculum into: (1) an executive Study Briefing, (2) a natural, lively 2-host Audio Overview podcast script between Alex and Sam (8-10 turns, conversational, crisp, easy to follow while commuting—keep spoken podcastDialogue lines in plain spoken words without raw LaTeX backslashes), (3) a hierarchical Mind Map connecting concepts across courses, and (4) 6-8 sharp active-recall Flashcards.${LATEX_GUIDANCE}`,
        responseMimeType: 'application/json',
        responseSchema: studioSchema,
      },
    });

    const parsed = JSON.parse(response.text ?? '{}');
    res.json({
      briefingTitle: String(parsed.briefingTitle || 'Course Study Studio'),
      briefingSummary: String(parsed.briefingSummary || ''),
      podcastDialogue: Array.isArray(parsed.podcastDialogue) ? parsed.podcastDialogue.slice(0, 12) : [],
      mindMap: parsed.mindMap || { rootTitle: 'AI Study Map', rootSummary: '', branches: [] },
      flashcards: Array.isArray(parsed.flashcards) ? parsed.flashcards.slice(0, 10) : [],
    });
  } catch (err) {
    const gErr = extractGeminiError(err);
    res.status(gErr.status).json({ error: gErr.message });
  }
});

// Synthesize Dual-Host NotebookLM Audio Overview WAV using gemini-3.8-flash-tts
app.post('/api/studio/audio-overview', async (req: Request, res: Response) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      res.status(500).json({ error: 'GEMINI_API_KEY is not configured in server secrets.' });
      return;
    }

    type DialogueTurnInput = { speaker?: string; line?: string };
    const dialogue: DialogueTurnInput[] = Array.isArray(req.body.dialogue) ? req.body.dialogue : [];
    if (dialogue.length === 0) {
      res.status(400).json({ error: 'Generate a study briefing first before synthesizing audio.' });
      return;
    }

    const parts = dialogue.slice(0, 12).flatMap((turn) => {
      const speaker = turn.speaker === 'Sam' ? 'Sam' : 'Alex';
      const line = String(turn.line || '').trim();
      if (!line) return [];
      return [
        {
          text: `${speaker}: ${line}`,
          speechMetadata: {
            speaker,
            style:
              speaker === 'Alex'
                ? 'Warm, energetic study podcast host'
                : 'Curious, clear co-host asking sharp questions',
          },
        },
      ];
    });

    if (parts.length === 0) {
      res.status(400).json({ error: 'Dialogue lines were empty.' });
      return;
    }

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash-tts',
      contents: [{ role: 'user', parts }],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          multiSpeakerVoiceConfig: {
            speakerVoiceConfigs: [
              {
                speaker: 'Alex',
                voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } },
              },
              {
                speaker: 'Sam',
                voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
              },
            ],
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) {
      res.status(500).json({ error: 'Audio synthesis did not return WAV data. Please try again.' });
      return;
    }

    res.json({
      audioBase64: base64Audio,
      mimeType: 'audio/wav',
    });
  } catch (err) {
    const gErr = extractGeminiError(err);
    res.status(gErr.status).json({ error: gErr.message });
  }
});

// Bounded server-side handoff store for Chrome Extension -> Web App auto-save sync
const clipHandoffStore = new Map<string, { clip: unknown; expiresAt: number }>();

function storeClipHandoff(clip: unknown): string {
  const now = Date.now();
  for (const [key, entry] of clipHandoffStore.entries()) {
    if (entry.expiresAt <= now) clipHandoffStore.delete(key);
  }
  while (clipHandoffStore.size >= 200) {
    const oldestKey = clipHandoffStore.keys().next().value;
    if (!oldestKey) break;
    clipHandoffStore.delete(oldestKey);
  }
  const id = `clip_${now}_${Math.random().toString(36).slice(2, 8)}`;
  clipHandoffStore.set(id, { clip, expiresAt: now + 30 * 60 * 1000 });
  return id;
}

// Smart Clipboard & Screenshot Action Detector (Date->Reminder, Letter->Email/Template, Definition->Flashcard, Code->Code Card)
app.post('/api/clip/smart-action', async (req: Request, res: Response) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      res.status(500).json({ error: 'GEMINI_API_KEY is not configured in server secrets.' });
      return;
    }

    const rawText = String(req.body.text || '').trim();
    const imageBase64 = String(req.body.imageBase64 || '').trim();
    const mimeType = String(req.body.mimeType || 'image/png').trim();
    const pageUrl = String(req.body.pageUrl || '').trim();
    const pageTitle = String(req.body.pageTitle || '').trim();
    const requestedCourseCode = String(req.body.courseCode || 'AUTO').trim();
    const knownCourses = parseCoursesField(req.body.courses);

    if (!rawText && !imageBase64) {
      res.status(400).json({ error: 'Provide copied text or a screenshot image to analyze.' });
      return;
    }

    const smartSchema = {
      type: Type.OBJECT,
      properties: {
        extractedText: {
          type: Type.STRING,
          description:
            'Exact text extracted from the screenshot (or the cleaned input text if no image was provided).',
        },
        intent: {
          type: Type.STRING,
          enum: [
            'date_reminder',
            'email_letter',
            'definition_flashcard',
            'code_snippet',
            'checklist_tasks',
            'study_note',
          ],
          description:
            'Use "date_reminder" if text highlights a due date, exam/quiz date, schedule, or appointment; "email_letter" if it is a letter, email draft, formal message, or communication to send/reuse; "definition_flashcard" if it is a glossary term, vocabulary definition, formula, or concept explanation; "code_snippet" if it is source code, SQL, terminal command, or JSON; "checklist_tasks" if it is a todo/step list; otherwise "study_note".',
        },
        intentSummary: {
          type: Type.STRING,
          description: '1 concise sentence explaining what was detected and why these smart actions fit.',
        },
        courseCode: {
          type: Type.STRING,
          description: 'Best matching course code from the student course list.',
        },
        title: {
          type: Type.STRING,
          description: 'Short descriptive card title (3 to 8 words).',
        },
        detectedDateIso: {
          type: Type.STRING,
          description:
            'Local reminder datetime formatted strictly as YYYY-MM-DDTHH:MM (e.g. "2026-11-21T17:00") if a date/time is present, otherwise "".',
        },
        reminderTitle: {
          type: Type.STRING,
          description: 'Actionable reminder title if a date was detected, else "".',
        },
        emailSubject: {
          type: Type.STRING,
          description: 'Suggested email subject line if intent is email_letter, else "".',
        },
        emailTo: {
          type: Type.STRING,
          description: 'Email recipient address if visible in text, else "".',
        },
        emailBody: {
          type: Type.STRING,
          description: 'Clean formatted email/letter body ready to send or save as template, else "".',
        },
        flashcardFront: {
          type: Type.STRING,
          description: 'Concise term or question for the front of a flashcard if definition/concept.',
        },
        flashcardBack: {
          type: Type.STRING,
          description: 'Clear definition/answer for the back of the flashcard.',
        },
        flashcardHint: {
          type: Type.STRING,
          description: 'Short memory clue/hint for active recall.',
        },
        codeLanguage: {
          type: Type.STRING,
          description:
            'Lowercase language id ("python", "javascript", "typescript", "sql", "bash", "json", "html", "css") or "text".',
        },
        formattedContent: {
          type: Type.STRING,
          description:
            'Cleaned main content. If code_snippet, formatted code WITHOUT markdown backticks.',
        },
        checklistItems: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'Checklist steps if checklist_tasks, else [].',
        },
        keywords: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: '3 to 6 searchable keywords.',
        },
      },
      required: [
        'extractedText',
        'intent',
        'intentSummary',
        'courseCode',
        'title',
        'detectedDateIso',
        'reminderTitle',
        'emailSubject',
        'emailTo',
        'emailBody',
        'flashcardFront',
        'flashcardBack',
        'flashcardHint',
        'codeLanguage',
        'formattedContent',
        'checklistItems',
        'keywords',
      ],
    };

    const parts: Array<{ inlineData: { mimeType: string; data: string } } | { text: string }> = [];
    if (imageBase64) {
      parts.push({ inlineData: { mimeType, data: imageBase64 } });
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const courseHint =
      requestedCourseCode === 'AUTO'
        ? `Pick best matching course from [${knownCourses}].`
        : `Use course ${requestedCourseCode}.`;

    parts.push({
      text: `${courseHint}
Today's date is ${todayStr}.
${pageTitle ? `Page Title: ${pageTitle}\n` : ''}${pageUrl ? `Page URL: ${pageUrl}\n` : ''}
${rawText ? `Copied/Pasted Text:\n${rawText.slice(0, 14000)}` : 'Extract all readable text from this screenshot and detect the best smart actions.'}`,
    });

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: { parts },
      config: {
        systemInstruction:
          `You are the StudyTrack AI Smart Clipper & Action Engine. Inspect copied text or a browser screenshot, extract the text cleanly, and classify the smartest next action: (1) date/deadline -> date_reminder with exact YYYY-MM-DDTHH:MM; (2) letter/email -> email_letter with subject & template body; (3) definition/concept -> definition_flashcard with Front/Back/Hint; (4) source code/SQL/commands -> code_snippet with clean indentation and no markdown fences; (5) steps/todos -> checklist_tasks; (6) general notes -> study_note.${LATEX_GUIDANCE}`,
        responseMimeType: 'application/json',
        responseSchema: smartSchema,
      },
    });

    const parsed = JSON.parse(response.text ?? '{}');
    const intent = parsed.intent || 'study_note';
    const courseCode =
      requestedCourseCode === 'AUTO'
        ? String(parsed.courseCode || 'AIL1001').trim()
        : requestedCourseCode;

    let cardType: 'code' | 'checklist' | 'note' | 'flashcard' | 'template' = 'note';
    let colorTag: 'slate' | 'blue' | 'amber' | 'emerald' | 'rose' = 'slate';
    let cardTitle = String(parsed.title || 'Captured Clip').trim();
    let cardContent = String(parsed.formattedContent || parsed.extractedText || rawText).trim();

    if (intent === 'code_snippet') {
      cardType = 'code';
      colorTag = 'slate';
    } else if (intent === 'checklist_tasks') {
      cardType = 'checklist';
      colorTag = 'amber';
    } else if (intent === 'email_letter') {
      cardType = 'template';
      colorTag = 'blue';
      cardTitle = String(parsed.emailSubject || parsed.title || 'Email Template').trim();
      cardContent = String(parsed.emailBody || cardContent).trim();
    } else if (intent === 'definition_flashcard') {
      cardType = 'flashcard';
      colorTag = 'emerald';
      cardTitle = String(parsed.flashcardFront || parsed.title || 'Concept Flashcard').trim();
      cardContent = String(parsed.flashcardBack || cardContent).trim();
    } else if (intent === 'date_reminder') {
      cardType = 'note';
      colorTag = 'amber';
      cardTitle = String(parsed.reminderTitle || parsed.title || 'Study Reminder').trim();
    }

    const recommendedActions: Array<{ actionId: string; label: string; description: string }> = [];
    if (intent === 'date_reminder') {
      recommendedActions.push(
        {
          actionId: 'set_reminder',
          label: 'Set Study Reminder',
          description: 'Pin reminder card with date alert and schedule alarm.',
        },
        {
          actionId: 'open_calendar',
          label: 'Add to Google Calendar',
          description: 'Open Google Calendar event template with this date.',
        },
        {
          actionId: 'add_classwork',
          label: 'Add to Classwork',
          description: 'Create an open Classwork task with this due date.',
        },
      );
    } else if (intent === 'email_letter') {
      recommendedActions.push(
        {
          actionId: 'send_email',
          label: 'Open in Gmail (Send)',
          description: 'Launch Gmail compose pre-filled with subject and letter body.',
        },
        {
          actionId: 'save_template',
          label: 'Save as Email Template',
          description: 'Store reusable email template in Smart Notebook.',
        },
      );
    } else if (intent === 'definition_flashcard') {
      recommendedActions.push(
        {
          actionId: 'save_flashcard',
          label: 'Save as Flashcard',
          description: 'Add interactive flip flashcard to Smart Notebook.',
        },
        {
          actionId: 'practice_coach',
          label: 'Practice in Mastery Coach',
          description: 'Test understanding with the Socratic ask-back coach.',
        },
      );
    } else if (intent === 'code_snippet') {
      recommendedActions.push(
        {
          actionId: 'save_code',
          label: 'Save Formatted Code Card',
          description: 'Save with language formatting, line numbers, and theme settings.',
        },
        {
          actionId: 'practice_coach',
          label: 'Explain & Practice Code',
          description: 'Walk through this code step by step in AI Tutor.',
        },
      );
    } else if (intent === 'checklist_tasks') {
      recommendedActions.push(
        {
          actionId: 'save_checklist',
          label: 'Save Checklist Card',
          description: 'Create toggleable checklist card in Smart Notebook.',
        },
        {
          actionId: 'add_classwork',
          label: 'Add to Classwork',
          description: 'Create tracked Classwork item from these steps.',
        },
      );
    } else {
      recommendedActions.push(
        {
          actionId: 'save_note',
          label: 'Save Study Note',
          description: 'Save clean organized note card in Smart Notebook.',
        },
        {
          actionId: 'save_flashcard',
          label: 'Turn into Flashcard',
          description: 'Convert this excerpt into a flip flashcard.',
        },
      );
    }

    const smartCard = {
      courseCode,
      title: cardTitle.slice(0, 190),
      cardType,
      colorTag,
      pinned: intent === 'date_reminder',
      content: cardContent.slice(0, 11800),
      codeLanguage: String(parsed.codeLanguage || (cardType === 'code' ? 'python' : 'text'))
        .toLowerCase()
        .slice(0, 30),
      codeSettings: {
        theme: 'dark' as const,
        showLineNumbers: true,
        wordWrap: false,
        fontSize: 'md' as const,
      },
      checklistItems: Array.isArray(parsed.checklistItems)
        ? parsed.checklistItems
            .map((t: unknown) => ({ text: String(t || '').trim(), done: false }))
            .filter((i: { text: string }) => i.text)
            .slice(0, 30)
        : [],
      keywords: Array.isArray(parsed.keywords)
        ? parsed.keywords.map((k: unknown) => String(k || '').trim()).filter(Boolean).slice(0, 8)
        : [courseCode.toLowerCase()],
      reminderAt: String(parsed.detectedDateIso || '').trim().slice(0, 40),
      sourceLabel: imageBase64
        ? `Extension Screenshot${pageTitle ? ` · ${pageTitle.slice(0, 60)}` : ''}`
        : `Smart Clipboard${pageTitle ? ` · ${pageTitle.slice(0, 60)}` : ''}`,
      emailSubject: String(parsed.emailSubject || '').trim().slice(0, 240),
      flashcardHint: String(parsed.flashcardHint || '').trim().slice(0, 400),
    };

    const resultPayload = {
      extractedText: String(parsed.extractedText || rawText || '').trim(),
      intent,
      intentSummary: String(parsed.intentSummary || 'Smart actions ready for your captured content.').trim(),
      detectedDateIso: String(parsed.detectedDateIso || '').trim(),
      reminderTitle: String(parsed.reminderTitle || cardTitle).trim(),
      emailSubject: String(parsed.emailSubject || '').trim(),
      emailTo: String(parsed.emailTo || '').trim(),
      emailBody: String(parsed.emailBody || '').trim(),
      flashcardFront: String(parsed.flashcardFront || cardTitle).trim(),
      flashcardBack: String(parsed.flashcardBack || cardContent).trim(),
      flashcardHint: String(parsed.flashcardHint || '').trim(),
      smartCard,
      recommendedActions,
    };

    const handoffId = storeClipHandoff(resultPayload);
    res.json({
      handoffId,
      ...resultPayload,
    });
  } catch (err) {
    const gErr = extractGeminiError(err);
    res.status(gErr.status).json({ error: gErr.message });
  }
});

// Retrieve pending clip captured by Chrome Extension via ?clip=<handoffId>
app.get('/api/clip/handoff/:id', (req: Request, res: Response) => {
  const id = String(req.params.id || '').trim();
  const entry = clipHandoffStore.get(id);
  if (!entry || entry.expiresAt <= Date.now()) {
    clipHandoffStore.delete(id);
    res.status(404).json({ error: 'Captured clip expired or already consumed.' });
    return;
  }
  res.json({ clip: entry.clip });
});

// Deep Large Video Catch-Up Pipeline:
// Auto-compress -> Accent-resilient transcription (gemini-3.5-transcribe) -> Webex summary & Name Mentions + Code/Moment Classification -> Up to 7 real JPG screenshots
app.post('/api/video/analyze-deep', upload.single('file'), async (req: Request, res: Response) => {
  req.setTimeout(0);
  res.setTimeout(0);
  const file = req.file;
  const remoteFilesToDelete: string[] = [];

  try {
    if (!process.env.GEMINI_API_KEY) {
      res.status(500).json({ error: 'GEMINI_API_KEY is not configured in server secrets.' });
      return;
    }

    if (!file) {
      res.status(400).json({ error: 'Please choose a lecture video or audio recording to analyze.' });
      return;
    }

    const requestedCourseCode = String(req.body.courseCode || 'AUTO').trim();
    const requestedTitle = String(req.body.title || '').trim();
    const lectureDate = String(req.body.lectureDate || new Date().toISOString().slice(0, 10)).trim();
    const studentName = String(req.body.studentName || '').trim();
    const knownCourses = parseCoursesField(req.body.courses);

    pruneVideoSessions(UPLOADS_DIR);
    const sessionId = createVideoSessionId();
    const sessionDir = path.join(getVideoSessionsRoot(UPLOADS_DIR), sessionId);

    // 1. Probe, auto-compress huge video -> crisp slide-readable MP4, and extract 16kHz speech-enhanced MP3
    const prepared = await prepareLectureMedia(file.path, sessionDir, file.originalname);
    const durationSec = prepared.probe.durationSeconds;
    const durationFormatted = formatDurationClock(durationSec);

    // 2. Accent-resilient Speech-to-Text via gemini-3.5-transcribe
    let timestampedTranscript = '';
    const speechSource = prepared.audioPath || prepared.videoPath || file.path;
    const speechMime = prepared.audioPath ? 'audio/mpeg' : guessMimeType(file.path, file.originalname, file.mimetype);
    const speechSize = fs.statSync(speechSource).size;

    const transcribePrompt = `Transcribe this full university AI / Programming lecture recording into clean, accurate English.
Important acoustic context:
- The lecturer frequently speaks with an Indian English accent (e.g., B.C. Rajesh, B.M. Rajesh), and students may speak with Jamaican English accents.
- Preserve exact technical terminology: Python, NumPy, Pandas, TensorFlow, PyTorch, Hugging Face, Transformers, BERT, LLM, RLHF, MLOps, FastAPI, Docker, GitHub, Colab, tokenization, stemming, lemmatization, NER, backpropagation, quantization, gradient descent, hyperparameter.
- Output ONLY the clean transcript formatted with [MM:SS] timestamps at natural speaker/topic breaks every 20 to 40 seconds so timestamps match the timeline cleanly.
${studentName ? `- Listen closely for any mention of the student name "${studentName}" (or first/last name parts) and spell it accurately if spoken.` : ''}`;

    try {
      if (speechSize <= 12 * 1024 * 1024) {
        const audioBase64 = fs.readFileSync(speechSource).toString('base64');
        const transcribeResp = await ai.models.generateContent({
          model: TRANSCRIBE_MODEL,
          contents: {
            parts: [
              { inlineData: { mimeType: speechMime, data: audioBase64 } },
              { text: transcribePrompt },
            ],
          },
        });
        timestampedTranscript = String(transcribeResp.text || '').trim();
      } else {
        let uploadedAudio = await ai.files.upload({
          file: speechSource,
          config: { mimeType: speechMime, displayName: `${file.originalname}_speech` },
        });
        if (uploadedAudio.name) remoteFilesToDelete.push(uploadedAudio.name);
        let audioWait = 0;
        while (uploadedAudio.state === 'PROCESSING' && audioWait < 60) {
          await new Promise((r) => setTimeout(r, 2000));
          if (uploadedAudio.name) {
            uploadedAudio = await ai.files.get({ name: uploadedAudio.name });
          }
          audioWait++;
        }
        if (uploadedAudio.state !== 'FAILED') {
          const audioPart = createPartFromUri(uploadedAudio.uri ?? '', uploadedAudio.mimeType ?? speechMime);
          const transcribeResp = await ai.models.generateContent({
            model: TRANSCRIBE_MODEL,
            contents: { parts: [audioPart, { text: transcribePrompt }] },
          });
          timestampedTranscript = String(transcribeResp.text || '').trim();
        }
      }
    } catch {
      timestampedTranscript = '';
    }

    // 3. Multimodal Catch-Up Analysis (Compressed Video + Clean Timestamped Transcript) via gemini-4-hydrogen
    const deepVideoSchema = {
      type: Type.OBJECT,
      properties: {
        detectedCourseCode: { type: Type.STRING },
        moduleTopic: { type: Type.STRING },
        suggestedTitle: { type: Type.STRING },
        keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
        plainEnglishSummary: {
          type: Type.STRING,
          description:
            'Webex-style catch-up summary in clear, everyday plain English covering what was taught, why it matters, and key conclusions.',
        },
        studentNameMentions: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              timestamp: { type: Type.STRING, description: 'MM:SS timestamp' },
              startSeconds: { type: Type.INTEGER },
              context: { type: Type.STRING, description: 'Exact quote or paraphrase of what was said.' },
              reason: { type: Type.STRING, description: 'Why the name was mentioned (e.g., attendance, question, task).' },
            },
            required: ['timestamp', 'startSeconds', 'context', 'reason'],
          },
        },
        tipsAndWarnings: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'Important lecturer tips, exam warnings, common mistakes, or deadline reminders.',
        },
        classifiedMoments: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              timestamp: { type: Type.STRING, description: 'MM:SS timestamp' },
              startSeconds: { type: Type.INTEGER },
              endSeconds: { type: Type.INTEGER },
              category: {
                type: Type.STRING,
                enum: ['Key Point', 'Tip / Warning', 'Code Shown', 'Action Item', 'Name Mentioned', 'Concept'],
              },
              title: { type: Type.STRING },
              summary: { type: Type.STRING },
              codeSnippet: {
                type: Type.STRING,
                description: 'If code or terminal commands were shown or dictated here, transcribe the clean code; otherwise empty string.',
              },
              codeLanguage: {
                type: Type.STRING,
                description: 'e.g. python, bash, sql, json, or empty string if no code.',
              },
              screenshotNeeded: {
                type: Type.BOOLEAN,
                description: 'True for up to 7 highest-value visual timestamps (code on screen, key diagrams, exam tips, deadlines).',
              },
            },
            required: [
              'timestamp',
              'startSeconds',
              'endSeconds',
              'category',
              'title',
              'summary',
              'codeSnippet',
              'codeLanguage',
              'screenshotNeeded',
            ],
          },
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
        'studentNameMentions',
        'tipsAndWarnings',
        'classifiedMoments',
        'keyConcepts',
        'actionItems',
        'checkQuestions',
      ],
    };

    const courseHint =
      requestedCourseCode === 'AUTO'
        ? `Auto-classify which course from [${knownCourses}] this class recording belongs to.`
        : `Student selected course: ${requestedCourseCode} (from [${knownCourses}]).`;

    const analysisPrompt = `${courseHint}
Filename: ${file.originalname}
Title hint: ${requestedTitle || 'Auto-detect from lecture'}
Date: ${lectureDate}
Media Duration: ${durationFormatted} (${durationSec} seconds)
Student Name to Watch For: "${studentName || 'Student (check for any direct student callouts if visible/spoken)'}"

Official HEART/NSTA Amber Academy Context:
${HEART_AMBER_CURRICULUM_CONTEXT}

Accent-Cleaned Timestamped Transcript:
${timestampedTranscript.slice(0, 65000)}

Analyze BOTH the video frames (any slides, diagrams, or code shown on screen) AND the cleaned transcript:
1. Deliver a crisp Webex-style "Catch Me Up" summary in plain, understandable English.
2. Check carefully whether the student's name ("${studentName || 'N/A'}") was mentioned or called on in the lecture/chat—list every occurrence in studentNameMentions with exact timestamps and why. (Return [] if not mentioned.)
3. Extract practical lecturer tips, exam warnings, and common pitfalls in tipsAndWarnings.
4. Build a rich chronological timeline in classifiedMoments (around 6 to 18 key moments across the video) categorized into: "Key Point", "Tip / Warning", "Code Shown", "Action Item", "Name Mentioned", or "Concept". Include startSeconds and endSeconds (for snippet cutting), plus transcribed codeSnippet & codeLanguage whenever code or terminal commands appear on screen or are explained. Mark screenshotNeeded=true on up to 7 visually valuable timestamps.
5. Extract keyConcepts (simple explanation + everyday analogy/Python example), actionItems (assignments, labs, homework), and 3 checkQuestions.`;

    const analysisMediaPath = prepared.videoPath || prepared.audioPath || file.path;
    const analysisMime = prepared.videoPath
      ? 'video/mp4'
      : prepared.audioPath
        ? 'audio/mpeg'
        : guessMimeType(file.path, file.originalname, file.mimetype);
    const analysisSize = fs.statSync(analysisMediaPath).size;

    let responseText = '';
    if (analysisSize <= 12 * 1024 * 1024) {
      const mediaB64 = fs.readFileSync(analysisMediaPath).toString('base64');
      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: {
          parts: [
            { inlineData: { mimeType: analysisMime, data: mediaB64 } },
            { text: analysisPrompt },
          ],
        },
        config: {
          systemInstruction:
            `You are an encouraging AI teaching assistant and Webex-style lecture summarizer helping an Associate Degree in AI student understand long classes even when the lecturer speaks fast or with a heavy accent. Always produce crystal-clear English, exact timestamps, accurate code extraction from screen shares, and zero fabricated mentions.${LATEX_GUIDANCE}`,
          responseMimeType: 'application/json',
          responseSchema: deepVideoSchema,
        },
      });
      responseText = response.text ?? '';
    } else {
      let uploadedMedia = await ai.files.upload({
        file: analysisMediaPath,
        config: { mimeType: analysisMime, displayName: file.originalname },
      });
      if (uploadedMedia.name) remoteFilesToDelete.push(uploadedMedia.name);

      let waitAttempts = 0;
      while (uploadedMedia.state === 'PROCESSING' && waitAttempts < 75) {
        await new Promise((r) => setTimeout(r, 2000));
        if (uploadedMedia.name) {
          uploadedMedia = await ai.files.get({ name: uploadedMedia.name });
        }
        waitAttempts++;
      }

      if (uploadedMedia.state === 'FAILED') {
        throw new Error('Could not process compressed media file with Gemini Files API.');
      }

      const filePart = createPartFromUri(
        uploadedMedia.uri ?? '',
        uploadedMedia.mimeType ?? analysisMime,
      );
      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: { parts: [filePart, { text: analysisPrompt }] },
        config: {
          systemInstruction:
            `You are an encouraging AI teaching assistant and Webex-style lecture summarizer helping an Associate Degree in AI student understand long classes even when the lecturer speaks fast or with a heavy accent. Always produce crystal-clear English, exact timestamps, accurate code extraction from screen shares, and zero fabricated mentions.${LATEX_GUIDANCE}`,
          responseMimeType: 'application/json',
          responseSchema: deepVideoSchema,
        },
      });
      responseText = response.text ?? '';
    }

    const parsed = JSON.parse(responseText || '{}') as {
      detectedCourseCode?: string;
      moduleTopic?: string;
      suggestedTitle?: string;
      keywords?: unknown[];
      plainEnglishSummary?: string;
      studentNameMentions?: Array<{
        timestamp?: string;
        startSeconds?: number;
        context?: string;
        reason?: string;
      }>;
      tipsAndWarnings?: unknown[];
      classifiedMoments?: Array<{
        timestamp?: string;
        startSeconds?: number;
        endSeconds?: number;
        category?: string;
        title?: string;
        summary?: string;
        codeSnippet?: string;
        codeLanguage?: string;
        screenshotNeeded?: boolean;
      }>;
      keyConcepts?: Array<{ term: string; simpleExplanation: string; analogyOrExample: string }>;
      actionItems?: Array<Record<string, unknown>>;
      checkQuestions?: Array<{ question: string; answer: string }>;
    };

    const validCategories = new Set([
      'Key Point',
      'Tip / Warning',
      'Code Shown',
      'Action Item',
      'Name Mentioned',
      'Concept',
    ]);

    const rawMoments = Array.isArray(parsed.classifiedMoments) ? parsed.classifiedMoments : [];
    const classifiedMoments = rawMoments.slice(0, 45).map((m) => {
      const startSec = Math.max(0, Math.min(durationSec || 86400, Math.round(Number(m.startSeconds) || 0)));
      const endSec = Math.max(startSec + 10, Math.min(durationSec || startSec + 60, Math.round(Number(m.endSeconds) || startSec + 30)));
      const category = validCategories.has(String(m.category || ''))
        ? (String(m.category) as
            | 'Key Point'
            | 'Tip / Warning'
            | 'Code Shown'
            | 'Action Item'
            | 'Name Mentioned'
            | 'Concept')
        : 'Key Point';
      return {
        timestamp: String(m.timestamp || formatDurationClock(startSec)).trim(),
        startSeconds: startSec,
        endSeconds: endSec,
        category,
        title: String(m.title || category).trim(),
        summary: String(m.summary || '').trim(),
        codeSnippet: String(m.codeSnippet || '').trim(),
        codeLanguage: String(m.codeLanguage || '').trim(),
        screenshotNeeded: Boolean(m.screenshotNeeded),
      };
    });

    // 4. Auto-extract up to 7 real JPG screenshots from compressed video at key moments
    const screenshotPaths: string[] = [];
    const screenshots: Array<{
      index: number;
      timestamp: string;
      seconds: number;
      category: string;
      caption: string;
      imageUrl: string;
      codeSnippet?: string;
      codeLanguage?: string;
    }> = [];

    if (prepared.videoPath && fs.existsSync(prepared.videoPath)) {
      const prioritized = [
        ...classifiedMoments.filter((m) => m.category === 'Code Shown'),
        ...classifiedMoments.filter((m) => m.category !== 'Code Shown' && m.screenshotNeeded),
        ...classifiedMoments.filter((m) => m.category !== 'Code Shown' && !m.screenshotNeeded),
      ];

      const chosenMoments: typeof classifiedMoments = [];
      for (const candidate of prioritized) {
        if (chosenMoments.length >= 7) break;
        const tooClose = chosenMoments.some(
          (existing) => Math.abs(existing.startSeconds - candidate.startSeconds) < 4,
        );
        if (!tooClose) {
          chosenMoments.push(candidate);
        }
      }

      // Sort chosen screenshots chronologically
      chosenMoments.sort((a, b) => a.startSeconds - b.startSeconds);

      for (let i = 0; i < chosenMoments.length; i++) {
        const m = chosenMoments[i];
        const seekSec = Math.max(0, Math.min(Math.max(0, durationSec - 1), m.startSeconds + 1));
        const jpgPath = path.join(sessionDir, `frame_${i}.jpg`);
        const ok = await extractFrameJpg(prepared.videoPath, seekSec, jpgPath);
        if (ok) {
          const idx = screenshotPaths.length;
          screenshotPaths.push(jpgPath);
          screenshots.push({
            index: idx,
            timestamp: m.timestamp,
            seconds: m.startSeconds,
            category: m.category,
            caption: `${m.title} — ${m.summary}`.slice(0, 220),
            imageUrl: `/api/video/frame/${sessionId}/${idx}`,
            ...(m.codeSnippet ? { codeSnippet: m.codeSnippet, codeLanguage: m.codeLanguage } : {}),
          });
        }
      }
    }

    registerVideoSession({
      sessionId,
      dirPath: sessionDir,
      videoPath: prepared.videoPath,
      audioPath: prepared.audioPath,
      originalFileName: file.originalname,
      mimeType: prepared.videoPath ? 'video/mp4' : 'audio/mpeg',
      durationSeconds: durationSec,
      screenshotPaths,
      createdAt: Date.now(),
      expiresAt: Date.now() + SESSION_TTL_MS,
    });

    const finalCourseCode =
      requestedCourseCode === 'AUTO'
        ? String(parsed.detectedCourseCode || 'AIL1001').trim()
        : requestedCourseCode;

    const lecturePayload = {
      courseCode: finalCourseCode,
      moduleTopic: String(parsed.moduleTopic || 'Recorded Class Session').trim(),
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords.map(String).slice(0, 10) : [],
      title: requestedTitle || String(parsed.suggestedTitle || file.originalname).trim(),
      lectureDate,
      sourceType: 'Recording' as const,
      fileName: file.originalname,
      durationOrLines: `${durationFormatted} · ${prepared.originalSizeMb} MB${prepared.wasCompressed ? ` -> ${prepared.compressedSizeMb} MB` : ''}`,
      plainEnglishSummary: String(parsed.plainEnglishSummary || '').trim(),
      keyConcepts: Array.isArray(parsed.keyConcepts) ? parsed.keyConcepts : [],
      actionItems: Array.isArray(parsed.actionItems)
        ? parsed.actionItems.map((item) => ({
            ...item,
            addedToTracker: false,
          }))
        : [],
      checkQuestions: Array.isArray(parsed.checkQuestions) ? parsed.checkQuestions : [],
      rawExcerpt: (timestampedTranscript || parsed.plainEnglishSummary || '').slice(0, 7500),
      studentNameMentions: Array.isArray(parsed.studentNameMentions)
        ? parsed.studentNameMentions.slice(0, 25).map((m) => ({
            timestamp: String(m.timestamp || '00:00').trim(),
            startSeconds: Math.max(0, Math.round(Number(m.startSeconds) || 0)),
            context: String(m.context || '').trim(),
            reason: String(m.reason || '').trim(),
          }))
        : [],
      classifiedMoments,
      tipsAndWarnings: Array.isArray(parsed.tipsAndWarnings)
        ? parsed.tipsAndWarnings.map((t) => String(t || '').trim()).filter(Boolean).slice(0, 25)
        : [],
      fullTranscript: timestampedTranscript.slice(0, 24500),
    };

    res.json({
      sessionId,
      videoStats: {
        originalSizeMb: prepared.originalSizeMb,
        compressedSizeMb: prepared.compressedSizeMb,
        durationSeconds: durationSec,
        durationFormatted,
        wasCompressed: prepared.wasCompressed,
        isAudioOnly: !prepared.videoPath,
      },
      screenshots,
      lecture: lecturePayload,
    });
  } catch (err) {
    const gErr = extractGeminiError(err);
    res.status(gErr.status).json({ error: gErr.message });
  } finally {
    safeUnlink(file?.path);
    for (const remoteName of remoteFilesToDelete) {
      try {
        await ai.files.delete({ name: remoteName });
      } catch {
        // ignore cleanup errors
      }
    }
  }
});

// Range-enabled streaming endpoint for in-browser playback & timestamp seeking
app.get('/api/video/stream/:sessionId', (req: Request, res: Response) => {
  const sessionId = String(req.params.sessionId || '').trim();
  const rec = getVideoSession(sessionId);
  const mediaPath = rec?.videoPath || rec?.audioPath;
  if (!rec || !mediaPath || !fs.existsSync(mediaPath)) {
    res.status(404).json({ error: 'Video playback session expired or unavailable.' });
    return;
  }

  const stat = fs.statSync(mediaPath);
  const fileSize = stat.size;
  const contentType = rec.videoPath ? 'video/mp4' : 'audio/mpeg';
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    if (Number.isNaN(start) || start >= fileSize || end >= fileSize) {
      res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
      return;
    }
    const chunkSize = end - start + 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': contentType,
    });
    fs.createReadStream(mediaPath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Accept-Ranges': 'bytes',
      'Content-Type': contentType,
    });
    fs.createReadStream(mediaPath).pipe(res);
  }
});

// Serve extracted JPG frame screenshot for a key timestamp
app.get('/api/video/frame/:sessionId/:idx', (req: Request, res: Response) => {
  const sessionId = String(req.params.sessionId || '').trim();
  const idx = Number(req.params.idx);
  const rec = getVideoSession(sessionId);
  if (!rec || Number.isNaN(idx) || idx < 0 || idx >= rec.screenshotPaths.length) {
    res.status(404).json({ error: 'Screenshot not found or expired.' });
    return;
  }
  const jpgPath = rec.screenshotPaths[idx];
  if (!fs.existsSync(jpgPath)) {
    res.status(404).json({ error: 'Screenshot file missing.' });
    return;
  }
  res.setHeader('Content-Type', 'image/jpeg');
  res.sendFile(jpgPath);
});

// Cut & download an MP4 video snippet between [start, end] seconds
app.get('/api/video/cut/:sessionId', async (req: Request, res: Response) => {
  const sessionId = String(req.params.sessionId || '').trim();
  const rec = getVideoSession(sessionId);
  if (!rec || !rec.videoPath || !fs.existsSync(rec.videoPath)) {
    res.status(404).json({ error: 'Active video session not found for snippet cutting.' });
    return;
  }

  const startSec = Math.max(0, Math.round(Number(req.query.start) || 0));
  const rawEnd = Math.round(Number(req.query.end) || startSec + 30);
  const endSec = Math.max(startSec + 2, Math.min(startSec + 600, rawEnd));
  const outName = `snippet_${startSec}s_to_${endSec}s_${Date.now()}.mp4`;
  const outPath = path.join(rec.dirPath, outName);

  try {
    const ok = await cutVideoClip(rec.videoPath, startSec, endSec, outPath);
    if (!ok) {
      res.status(500).json({ error: 'Could not cut requested snippet range.' });
      return;
    }
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="lecture_clip_${startSec}s_${endSec}s.mp4"`);
    res.sendFile(outPath, () => {
      safeUnlink(outPath);
    });
  } catch (err) {
    safeUnlink(outPath);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to cut video snippet.',
    });
  }
});

// YouTube-Style "Ask Questions About This Video" with clickable timestamp citations
app.post('/api/video/ask', async (req: Request, res: Response) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      res.status(500).json({ error: 'GEMINI_API_KEY is not configured in server secrets.' });
      return;
    }

    const question = String(req.body.question || '').trim();
    const lectureTitle = String(req.body.lectureTitle || 'Recorded Lecture').trim();
    const courseCode = String(req.body.courseCode || 'AIL1001').trim();
    const fullTranscript = String(req.body.fullTranscript || '').trim();
    const plainEnglishSummary = String(req.body.plainEnglishSummary || '').trim();
    const classifiedMoments = Array.isArray(req.body.classifiedMoments) ? req.body.classifiedMoments : [];
    const history = Array.isArray(req.body.history) ? req.body.history : [];

    if (!question) {
      res.status(400).json({ error: 'Please ask a question about this video lecture.' });
      return;
    }

    const askSchema = {
      type: Type.OBJECT,
      properties: {
        answer: {
          type: Type.STRING,
          description:
            'Clear, plain-English answer grounded in the lecture transcript and moments. If the teacher used an accent or rushed, explain it simply with worked examples or exact code if asked.',
        },
        timestampRefs: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              timestamp: { type: Type.STRING, description: 'MM:SS timestamp where this was covered' },
              startSeconds: { type: Type.INTEGER },
              note: { type: Type.STRING, description: 'Short 4-8 word label of what happens at that timestamp' },
            },
            required: ['timestamp', 'startSeconds', 'note'],
          },
        },
      },
      required: ['answer', 'timestampRefs'],
    };

    const historyText = history
      .slice(-6)
      .map((m: { role?: string; text?: string }) => `${m.role === 'user' ? 'Student' : 'Assistant'}: ${m.text || ''}`)
      .join('\n');

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: `Lecture: [${courseCode}] ${lectureTitle}
Summary: ${plainEnglishSummary}

Classified Moments & Code Shown:
${JSON.stringify(classifiedMoments.slice(0, 45))}

Timestamped Transcript:
${fullTranscript.slice(0, 50000)}

${historyText ? `Recent Q&A:\n${historyText}\n` : ''}
Student Question: ${question}`,
      config: {
        systemInstruction:
          `You are an interactive YouTube-style video study assistant. Answer questions strictly from this recorded class lecture, translate any complex/fast instructor explanations into clear everyday English, include code snippets when asked about code shown, and ALWAYS attach accurate clickable timestampRefs (MM:SS + startSeconds) so the student can jump directly to that part of the video.${LATEX_GUIDANCE}`,
        responseMimeType: 'application/json',
        responseSchema: askSchema,
      },
    });

    const parsed = JSON.parse(response.text ?? '{}') as {
      answer?: string;
      timestampRefs?: Array<{ timestamp?: string; startSeconds?: number; note?: string }>;
    };

    res.json({
      answer: String(parsed.answer || 'I could not find that topic in this video recording.').trim(),
      timestampRefs: Array.isArray(parsed.timestampRefs)
        ? parsed.timestampRefs.slice(0, 6).map((r) => ({
            timestamp: String(r.timestamp || '00:00').trim(),
            seconds: Math.max(0, Math.round(Number(r.startSeconds) || 0)),
            note: String(r.note || 'Jump to moment').trim(),
          }))
        : [],
    });
  } catch (err) {
    const gErr = extractGeminiError(err);
    res.status(gErr.status).json({ error: gErr.message });
  }
});

// Transcribe a browser-recorded Voice Memo audio blob and convert it into a structured SmartNoteCard
app.post('/api/voice-memo/transcribe', upload.single('audio'), async (req: Request, res: Response) => {
  const file = req.file;
  let remoteFileName: string | undefined;

  try {
    if (!process.env.GEMINI_API_KEY) {
      res.status(500).json({ error: 'GEMINI_API_KEY is not configured in server secrets.' });
      return;
    }

    if (!file || file.size === 0) {
      res.status(400).json({ error: 'No audio recording was received. Please try recording again.' });
      return;
    }

    const requestedCourseCode = String(req.body.courseCode || 'AUTO').trim();
    const durationSeconds = Math.max(0, Math.round(Number(req.body.durationSeconds) || 0));
    const knownCourses = parseCoursesField(req.body.courses);

    // Strip codec parameters like "audio/webm;codecs=opus" -> "audio/webm"
    const rawMime = String(file.mimetype || 'audio/webm').split(';')[0].trim().toLowerCase();
    const mimeType = rawMime.startsWith('audio/') || rawMime.startsWith('video/')
      ? rawMime === 'video/webm'
        ? 'audio/webm'
        : rawMime
      : 'audio/webm';

    const transcribePrompt =
      'Transcribe this student voice memo accurately in clear English. Preserve AI, Machine Learning, Python, math, and course terminology (e.g., AIL1001, AIL1002, AIL1003, AIL1004, ETH101, AGD101, DSA101, STAT101), dates/deadlines, and spoken equations. Output ONLY the clean transcript text.';

    let transcript = '';

    if (file.size <= 12 * 1024 * 1024) {
      const audioBase64 = fs.readFileSync(file.path).toString('base64');
      const transcribeResp = await ai.models.generateContent({
        model: 'gemini-3.5-transcribe',
        contents: {
          parts: [
            { inlineData: { mimeType, data: audioBase64 } },
            { text: transcribePrompt },
          ],
        },
      });
      transcript = String(transcribeResp.text || '').trim();
    } else {
      let uploadedAudio = await ai.files.upload({
        file: file.path,
        config: { mimeType, displayName: file.originalname || 'voice_memo.webm' },
      });
      remoteFileName = uploadedAudio.name;
      let audioWait = 0;
      while (uploadedAudio.state === 'PROCESSING' && audioWait < 45) {
        await new Promise((r) => setTimeout(r, 1500));
        if (uploadedAudio.name) {
          uploadedAudio = await ai.files.get({ name: uploadedAudio.name });
        }
        audioWait++;
      }
      if (uploadedAudio.state === 'FAILED' || !uploadedAudio.uri) {
        throw new Error('Could not process the voice memo audio file.');
      }
      const transcribeResp = await ai.models.generateContent({
        model: 'gemini-3.5-transcribe',
        contents: {
          parts: [
            createPartFromUri(uploadedAudio.uri, uploadedAudio.mimeType || mimeType),
            { text: transcribePrompt },
          ],
        },
      });
      transcript = String(transcribeResp.text || '').trim();
    }

    if (!transcript) {
      res.status(400).json({
        error: 'No clear speech was detected in your voice memo. Please speak closer to the mic and try again.',
      });
      return;
    }

    const noteSchema = {
      type: Type.OBJECT,
      properties: {
        courseCode: { type: Type.STRING },
        title: { type: Type.STRING },
        cardType: { type: Type.STRING },
        colorTag: { type: Type.STRING },
        content: { type: Type.STRING },
        codeLanguage: { type: Type.STRING },
        checklistItems: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
        keywords: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
        reminderAt: { type: Type.STRING },
        flashcardHint: { type: Type.STRING },
      },
      required: ['courseCode', 'title', 'cardType', 'colorTag', 'content', 'keywords'],
    };

    const courseHint =
      requestedCourseCode && requestedCourseCode !== 'AUTO'
        ? `Target course code: ${requestedCourseCode}`
        : 'Infer the best matching courseCode from the student courses list (or GENERAL if unclear).';

    const structureResp = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: `Known courses: ${knownCourses}
${courseHint}

Student Voice Memo Transcript:
${transcript.slice(0, 24000)}`,
      config: {
        systemInstruction: `Convert this student voice memo transcript into a structured SmartNoteCard for StudyTrack AI.
Rules:
- cardType must be one of: "note", "checklist", "flashcard", "code", "template".
  - Use "checklist" if the student dictated tasks, action items, reminders, or study steps (populate checklistItems with concise tasks).
  - Use "flashcard" if the student dictated a definition, concept check, or "question / answer" study prompt (put the question in title or top of content, answer in content, and a short clue in flashcardHint).
  - Use "code" if the student dictated code or algorithm logic (set codeLanguage like "python", "sql", or "javascript").
  - Otherwise use "note" with clean structured takeaways followed by a "**Transcript:**" section containing the cleaned verbatim memo.
- colorTag must be one of: "slate", "blue", "amber", "emerald", "rose" ("amber" for reminders/checklists, "emerald" for flashcards, "slate" for code, "blue" for study notes).
- Include 3 to 6 relevant lowercase keywords (always include "voice-memo").
- If a specific date/deadline was spoken, put an ISO date/datetime string (YYYY-MM-DD or YYYY-MM-DDTHH:mm) in reminderAt, otherwise "".${LATEX_GUIDANCE}`,
        responseMimeType: 'application/json',
        responseSchema: noteSchema,
      },
    });

    const parsed = JSON.parse(structureResp.text ?? '{}') as {
      courseCode?: string;
      title?: string;
      cardType?: string;
      colorTag?: string;
      content?: string;
      codeLanguage?: string;
      checklistItems?: string[];
      keywords?: string[];
      reminderAt?: string;
      flashcardHint?: string;
    };

    const allowedTypes = new Set(['code', 'checklist', 'note', 'flashcard', 'template']);
    const allowedColors = new Set(['slate', 'blue', 'amber', 'emerald', 'rose']);
    const cardType = (
      allowedTypes.has(String(parsed.cardType || '')) ? String(parsed.cardType) : 'note'
    ) as 'code' | 'checklist' | 'note' | 'flashcard' | 'template';
    const colorTag = (
      allowedColors.has(String(parsed.colorTag || '')) ? String(parsed.colorTag) : 'blue'
    ) as 'slate' | 'blue' | 'amber' | 'emerald' | 'rose';

    const courseCode =
      requestedCourseCode && requestedCourseCode !== 'AUTO'
        ? requestedCourseCode
        : String(parsed.courseCode || 'GENERAL').trim() || 'GENERAL';

    const durationLabel =
      durationSeconds > 0
        ? `${Math.floor(durationSeconds / 60)}:${String(durationSeconds % 60).padStart(2, '0')}`
        : '';

    const rawKeywords = Array.isArray(parsed.keywords)
      ? parsed.keywords.map((k) => String(k || '').trim()).filter(Boolean)
      : [];
    if (!rawKeywords.some((k) => k.toLowerCase() === 'voice-memo')) {
      rawKeywords.unshift('voice-memo');
    }

    const smartCard = {
      courseCode,
      title: String(parsed.title || 'Voice Memo Note').trim().slice(0, 190),
      cardType,
      colorTag,
      pinned: Boolean(parsed.reminderAt && String(parsed.reminderAt).trim()),
      content: String(parsed.content || transcript).trim().slice(0, 11800),
      codeLanguage: String(parsed.codeLanguage || (cardType === 'code' ? 'python' : 'text'))
        .toLowerCase()
        .slice(0, 30),
      codeSettings: {
        theme: 'dark' as const,
        showLineNumbers: true,
        wordWrap: false,
        fontSize: 'md' as const,
      },
      checklistItems: Array.isArray(parsed.checklistItems)
        ? parsed.checklistItems
            .map((t) => ({ text: String(t || '').trim(), done: false }))
            .filter((i) => i.text)
            .slice(0, 30)
        : [],
      keywords: rawKeywords.slice(0, 8),
      reminderAt: String(parsed.reminderAt || '').trim().slice(0, 40),
      sourceLabel: durationLabel ? `Voice Memo · ${durationLabel}` : 'Voice Memo',
      emailSubject: '',
      flashcardHint: String(parsed.flashcardHint || '').trim().slice(0, 400),
    };

    res.json({
      transcript,
      smartCard,
    });
  } catch (err) {
    const gErr = extractGeminiError(err);
    res.status(gErr.status).json({ error: gErr.message });
  } finally {
    if (file?.path && fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
    if (remoteFileName) {
      ai.files.delete({ name: remoteFileName }).catch(() => {});
    }
  }
});

function parseGitHubRepoSlug(input: string): { owner: string; repo: string } | null {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const cleaned = raw
    .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '');
  const parts = cleaned.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0];
  const repo = parts[1];
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
    return null;
  }
  return { owner, repo };
}

function buildGitHubHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'StudyTrack-AI-Visual-Lab',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const trimmed = String(token || '').trim();
  if (trimmed) {
    headers.Authorization = `Bearer ${trimmed}`;
  }
  return headers;
}

// Visual-learner AI coding assistant + Antigravity/Codex task bundle generator
app.post('/api/code/assist', async (req: Request, res: Response) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      res.status(500).json({ error: 'GEMINI_API_KEY is not configured in server secrets.' });
      return;
    }

    const code = String(req.body.code || '').slice(0, 30000);
    const language = String(req.body.language || 'html').trim().slice(0, 40);
    const prompt = String(req.body.prompt || '').trim().slice(0, 4000);
    const action = String(req.body.action || 'visual_trace').trim();
    const githubContext = String(req.body.githubContext || '').trim().slice(0, 500);

    if (!code && !prompt) {
      res.status(400).json({ error: 'Provide either code in the editor or a coding prompt.' });
      return;
    }

    const assistSchema = {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        plainEnglishSummary: { type: Type.STRING },
        visualSteps: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              stepNumber: { type: Type.INTEGER },
              title: { type: Type.STRING },
              stateSummary: { type: Type.STRING },
              visualAnalogy: { type: Type.STRING },
              lineRange: { type: Type.STRING },
            },
            required: ['stepNumber', 'title', 'stateSummary', 'visualAnalogy', 'lineRange'],
          },
        },
        suggestedCode: { type: Type.STRING },
        antigravityCodexPrompt: { type: Type.STRING },
        speakableWalkthrough: { type: Type.STRING },
      },
      required: [
        'title',
        'plainEnglishSummary',
        'visualSteps',
        'suggestedCode',
        'antigravityCodexPrompt',
        'speakableWalkthrough',
      ],
    };

    const actionDirective: Record<string, string> = {
      explain:
        'Explain what this code does for a visual learner using vivid spatial/real-world analogies and clear step-by-step data flow. Keep suggestedCode equal to the cleaned/commented version of the user code.',
      debug:
        'Find any bugs, accessibility issues (WCAG contrast, missing aria labels, keyboard traps), or runtime issues. Fix them in suggestedCode and walk through every fix visually.',
      visual_trace:
        'Trace the execution step-by-step like a visual storyboard: show what inputs enter, how variables/tensors/DOM change at each step, and what renders on screen. Keep suggestedCode runnable or improved.',
      generate:
        'Generate clean, WCAG 2.1 AA accessible, visually engaging code matching the student prompt and language. For HTML, include clean self-contained styling and keyboard-accessible controls.',
      refactor:
        'Refactor this code for clarity, modularity, and WCAG 2.1 AA keyboard/screen-reader accessibility without breaking behavior.',
      antigravity_prompt:
        'Design a comprehensive engineering handoff specification and prompt bundle tailored for Antigravity, Codex, or GitHub Copilot workspace agents, including architecture steps, files, and accessibility verification checks.',
    };

    const directive = actionDirective[action] || actionDirective.visual_trace;

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: `Action: ${action}
Target Language: ${language}
${githubContext ? `GitHub Repository Context: ${githubContext}\n` : ''}
Student Request / Prompt: ${prompt || 'Analyze and visually walk through the current code.'}

Current Code:
\`\`\`${language}
${code || '// (empty editor)'}
\`\`\``,
      config: {
        systemInstruction: `You are an expert AI/CS visual coding mentor inside StudyTrack AI.
${directive}

Output strict JSON matching the schema:
- title: Short descriptive title (under 80 chars).
- plainEnglishSummary: Clear 2-4 sentence summary written for a visual learner.
- visualSteps: 3 to 6 ordered storyboard nodes showing how execution flows visually (each with stepNumber, title, stateSummary, visualAnalogy, lineRange like "Lines 4-12").
- suggestedCode: Complete runnable ${language} code (never wrapped in markdown backticks inside the JSON string).
- antigravityCodexPrompt: A crisp, structured prompt & spec ready to paste into Antigravity, Codex, or GitHub Copilot CLI to extend or test this module, including WCAG 2.1 AA requirements.
- speakableWalkthrough: Natural 3-5 sentence spoken explanation suitable for text-to-speech TalkBack with no markdown symbols or backticks.${LATEX_GUIDANCE}`,
        responseMimeType: 'application/json',
        responseSchema: assistSchema,
      },
    });

    const parsed = JSON.parse(response.text ?? '{}') as {
      title?: string;
      plainEnglishSummary?: string;
      visualSteps?: Array<{
        stepNumber?: number;
        title?: string;
        stateSummary?: string;
        visualAnalogy?: string;
        lineRange?: string;
      }>;
      suggestedCode?: string;
      antigravityCodexPrompt?: string;
      speakableWalkthrough?: string;
    };

    res.json({
      title: String(parsed.title || 'Visual Code Walkthrough').trim(),
      plainEnglishSummary: String(parsed.plainEnglishSummary || '').trim(),
      visualSteps: Array.isArray(parsed.visualSteps)
        ? parsed.visualSteps.slice(0, 8).map((step, idx) => ({
            stepNumber: Number(step.stepNumber) || idx + 1,
            title: String(step.title || `Step ${idx + 1}`).trim(),
            stateSummary: String(step.stateSummary || '').trim(),
            visualAnalogy: String(step.visualAnalogy || '').trim(),
            lineRange: String(step.lineRange || 'Full snippet').trim(),
          }))
        : [],
      suggestedCode: String(parsed.suggestedCode || code),
      antigravityCodexPrompt: String(parsed.antigravityCodexPrompt || '').trim(),
      speakableWalkthrough: String(parsed.speakableWalkthrough || parsed.plainEnglishSummary || '').trim(),
    });
  } catch (err) {
    const gErr = extractGeminiError(err);
    res.status(gErr.status).json({ error: gErr.message });
  }
});

// GitHub repository tree loader (code + .glb/.gltf 3D models)
app.post('/api/github/tree', async (req: Request, res: Response) => {
  try {
    const parsed = parseGitHubRepoSlug(String(req.body.repo || ''));
    if (!parsed) {
      res.status(400).json({
        error: 'Enter a valid GitHub repository like "owner/repo" or "https://github.com/owner/repo".',
      });
      return;
    }

    const token = String(req.body.githubToken || '').trim();
    const headers = buildGitHubHeaders(token);

    let branch = String(req.body.branch || '').trim();
    if (!branch) {
      const repoResp = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`,
        { headers },
      );
      const repoJson = (await repoResp.json()) as { default_branch?: string; message?: string };
      if (!repoResp.ok) {
        res.status(repoResp.status).json({
          error: repoJson.message || `Could not access GitHub repo ${parsed.owner}/${parsed.repo}.`,
        });
        return;
      }
      branch = repoJson.default_branch || 'main';
    }

    const treeResp = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
      { headers },
    );
    const treeJson = (await treeResp.json()) as {
      tree?: Array<{ path?: string; type?: string; size?: number }>;
      message?: string;
    };
    if (!treeResp.ok) {
      res.status(treeResp.status).json({
        error: treeJson.message || `Could not list files on branch "${branch}".`,
      });
      return;
    }

    const codeExt = /\.(html|htm|css|js|jsx|ts|tsx|py|json|md|glsl|sql|txt)$/i;
    const modelExt = /\.(glb|gltf)$/i;

    const allBlobs = (treeJson.tree || [])
      .filter((entry) => entry.type === 'blob' && entry.path)
      .map((entry) => {
        const filePath = String(entry.path);
        const is3DModel = modelExt.test(filePath);
        const isCode = codeExt.test(filePath);
        return {
          path: filePath,
          size: Number(entry.size) || 0,
          is3DModel,
          isCode,
        };
      })
      .filter((item) => item.is3DModel || item.isCode)
      .sort((a, b) => {
        if (a.is3DModel !== b.is3DModel) return a.is3DModel ? -1 : 1;
        return a.path.localeCompare(b.path);
      })
      .slice(0, 250);

    res.json({
      owner: parsed.owner,
      repo: parsed.repo,
      branch,
      files: allBlobs,
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Could not fetch GitHub repository tree.',
    });
  }
});

// GitHub single file loader (code text or .glb/.gltf binary)
app.post('/api/github/file', async (req: Request, res: Response) => {
  try {
    const owner = String(req.body.owner || '').trim();
    const repo = String(req.body.repo || '').trim();
    const branch = String(req.body.branch || 'main').trim();
    const filePath = String(req.body.path || '').trim();
    const token = String(req.body.githubToken || '').trim();

    if (!owner || !repo || !filePath) {
      res.status(400).json({ error: 'owner, repo, and path are required.' });
      return;
    }

    const encodedPath = filePath
      .split('/')
      .map((seg) => encodeURIComponent(seg))
      .join('/');
    const apiUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;
    const resp = await fetch(apiUrl, { headers: buildGitHubHeaders(token) });
    const data = (await resp.json()) as {
      content?: string;
      encoding?: string;
      download_url?: string;
      size?: number;
      message?: string;
    };

    if (!resp.ok) {
      res.status(resp.status).json({
        error: data.message || `Could not load "${filePath}" from GitHub.`,
      });
      return;
    }

    const isBinary = /\.(glb)$/i.test(filePath);
    if (Number(data.size) > 15 * 1024 * 1024) {
      res.status(413).json({ error: 'File exceeds the 15 MB browser preview limit.' });
      return;
    }

    let rawBuffer: Buffer | null = null;
    if (data.content && data.encoding === 'base64') {
      rawBuffer = Buffer.from(data.content.replace(/\s+/g, ''), 'base64');
    } else if (data.download_url) {
      const dlResp = await fetch(data.download_url, { headers: buildGitHubHeaders(token) });
      if (!dlResp.ok) {
        res.status(dlResp.status).json({ error: 'Could not download large file from GitHub.' });
        return;
      }
      rawBuffer = Buffer.from(await dlResp.arrayBuffer());
    }

    if (!rawBuffer) {
      res.status(422).json({ error: 'GitHub file had no readable content.' });
      return;
    }

    if (isBinary) {
      res.json({
        isBinary: true,
        path: filePath,
        mimeType: 'model/gltf-binary',
        base64: rawBuffer.toString('base64'),
      });
      return;
    }

    res.json({
      isBinary: false,
      path: filePath,
      size: rawBuffer.length,
      content: rawBuffer.toString('utf8'),
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Could not fetch GitHub file.',
    });
  }
});

// Publish active code snippet as a GitHub Gist using a session PAT
app.post('/api/github/gist', async (req: Request, res: Response) => {
  try {
    const token = String(req.body.githubToken || '').trim();
    const filename = String(req.body.filename || 'studytrack_snippet.html').trim() || 'snippet.txt';
    const content = String(req.body.content || '');
    const description = String(req.body.description || 'Exported from StudyTrack AI Visual Lab').trim();
    const isPublic = Boolean(req.body.isPublic);

    if (!token) {
      res.status(400).json({ error: 'Provide a GitHub Personal Access Token (gist scope) to publish a Gist.' });
      return;
    }
    if (!content.trim()) {
      res.status(400).json({ error: 'Cannot publish an empty snippet.' });
      return;
    }

    const resp = await fetch('https://api.github.com/gists', {
      method: 'POST',
      headers: {
        ...buildGitHubHeaders(token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        description,
        public: isPublic,
        files: {
          [filename]: { content },
        },
      }),
    });

    const data = (await resp.json()) as { html_url?: string; id?: string; message?: string };
    if (!resp.ok) {
      res.status(resp.status).json({
        error: data.message || 'GitHub rejected Gist creation. Check token permissions.',
      });
      return;
    }

    res.json({
      id: data.id || '',
      url: data.html_url || '',
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Could not create GitHub Gist.',
    });
  }
});

// Gemini Natural Text-to-Speech (TalkBack Read Aloud) returning WAV audio
app.post('/api/tts/speak', async (req: Request, res: Response) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      res.status(500).json({ error: 'GEMINI_API_KEY is not configured in server secrets.' });
      return;
    }

    const text = String(req.body.text || '').trim().slice(0, 3500);
    if (!text) {
      res.status(400).json({ error: 'Provide text to speak aloud.' });
      return;
    }

    const allowedVoices = new Set(['Kore', 'Puck', 'Aoede', 'Charon', 'Fenrir']);
    const voiceName = allowedVoices.has(String(req.body.voiceName || ''))
      ? String(req.body.voiceName)
      : 'Kore';

    const ttsResp = await ai.models.generateContent({
      model: 'gemini-3.8-flash-lite-tts',
      contents: `Read the following study walkthrough clearly and naturally for a visual learner:\n\n${text}`,
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      },
    });

    const part = ttsResp.candidates?.[0]?.content?.parts?.[0];
    const inlineAudio = part?.inlineData;
    if (!inlineAudio?.data) {
      res.status(502).json({ error: 'TTS model did not return audio output.' });
      return;
    }

    res.json({
      mimeType: inlineAudio.mimeType || 'audio/wav',
      audioBase64: inlineAudio.data,
    });
  } catch (err) {
    const gErr = extractGeminiError(err);
    res.status(gErr.status).json({ error: gErr.message });
  }
});

// Download ready-to-load Manifest V3 Chrome Extension ZIP configured for this app origin
app.get('/api/extension/download.zip', (req: Request, res: Response) => {
  try {
    const requestedOrigin = String(req.query.origin || '').trim();
    const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000').trim();
    const fallbackOrigin = `${proto}://${host}`;
    const targetOrigin = /^https?:\/\/.+/.test(requestedOrigin) ? requestedOrigin : fallbackOrigin;

    const zipBuf = buildChromeExtensionZip(targetOrigin);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="studytrack-ai-chrome-extension.zip"');
    res.setHeader('Content-Length', String(zipBuf.length));
    res.send(zipBuf);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Could not package Chrome Extension ZIP.',
    });
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
