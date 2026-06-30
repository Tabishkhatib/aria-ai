import express from 'express';
import session from 'express-session';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import PDFParser from 'pdf2json';
import mammoth from 'mammoth';
import { Pinecone } from '@pinecone-database/pinecone';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3000;

// ── Storage paths ─────────────────────────────────────────────────
const DB_PATH = path.join(__dirname, 'data', 'db.json');
const UPLOADS_DIR = path.join(__dirname, 'data', 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ── Pinecone client ───────────────────────────────────────────────
const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pinecone.index('demo');
console.log('✅ Pinecone connected');

// ── Gemini embedding function ─────────────────────────────────────
async function getEmbedding(text) {
  const apiKey = process.env.GEMINI_API_KEY;
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: { parts: [{ text }] }
      })
    }
  );
  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.embedding.values;
}

// ── Chunk text into smaller pieces ───────────────────────────────
function chunkText(text, chunkSize = 5000, overlap = 200) {
  const words = text.split(/\s+/);
  const chunks = [];
  for (let i = 0; i < words.length; i += chunkSize - overlap) {
    const chunk = words.slice(i, i + chunkSize).join(' ');
    if (chunk.trim().length > 20) chunks.push(chunk);
  }
  return chunks;
}

// ── Add document to Pinecone ──────────────────────────────────────
async function addToVectorDB(fileId, fileName, text) {
  const chunks = chunkText(text);
  console.log(`Text length: ${text.length}, Chunks: ${chunks.length} for "${fileName}"...`);
  if (chunks.length === 0) throw new Error('No chunks generated from text');

  for (let i = 0; i < chunks.length; i++) {
    const embedding = await getEmbedding(chunks[i]);
    await index.upsert({
      records: [{
        id: `${fileId}_chunk_${i}`,
        values: embedding,
        metadata: { fileId, fileName, chunkIndex: i, text: chunks[i] }
     }]
   });
    console.log(`Upserted chunk ${i + 1}/${chunks.length}`);
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`✅ Added ${chunks.length} chunks for "${fileName}"`);
}


// ── Remove document from Pinecone ────────────────────────────────
async function removeFromVectorDB(fileId) {
  try {
    await index.deleteMany({ filter: { fileId: { '$eq': fileId } } });
    console.log(`Deleted chunks for fileId: ${fileId}`);
  } catch (err) {
    console.error('Delete error:', err.message);
  }
}

// ── Retrieve relevant chunks for a query ─────────────────────────
async function retrieveRelevantChunks(query, topK = 5) {
  try {
    const queryEmbedding = await getEmbedding(query);
    const results = await index.query({
      vector: queryEmbedding,
      topK,
      includeMetadata: true
    });
    if (!results.matches?.length) return '';
    return results.matches
      .map(m => m.metadata?.text || '')
      .filter(Boolean)
      .join('\n\n---\n\n');
  } catch (err) {
    console.error('Retrieval error:', err.message);
    return '';
  }
}

// ── Simple JSON "database" ────────────────────────────────────────
function readDB() {
  if (!fs.existsSync(DB_PATH)) {
    const init = { users: [], usage: [], chats: {}, kb: [] };
    fs.writeFileSync(DB_PATH, JSON.stringify(init, null, 2));
    return init;
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}
function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// ── Middleware ────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'aria-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

const upload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.txt', '.docx', '.doc', '.md', '.xlsx', '.xls', '.csv'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  }
});

function requireAuth(req, res, next) {
  if (req.session.userId) return next();
  res.status(401).json({ error: 'Not authenticated' });
}

// ── Auth routes ───────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, company, brand_color, brand_name } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Missing fields' });
  const db = readDB();
  if (db.users.find(u => u.email === email))
    return res.status(409).json({ error: 'Email already registered' });
  const hash = await bcrypt.hash(password, 10);
  const user = {
    id: Date.now().toString(), name, email,
    company: company || 'My Company',
    brand_color: brand_color || '#7F77DD',
    brand_name: brand_name || 'Aria AI',
    password: hash,
    role: db.users.length === 0 ? 'admin' : 'user',
    created_at: new Date().toISOString(),
    company_data: null
  };
  db.users.push(user);
  writeDB(db);
  req.session.userId = user.id;
  const { password: _, ...safe } = user;
  res.json({ user: safe });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const db = readDB();
  const user = db.users.find(u => u.email === email);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  req.session.userId = user.id;
  const { password: _, ...safe } = user;
  res.json({ user: safe });
});

app.post('/api/auth/logout', (req, res) => { req.session.destroy(); res.json({ ok: true }); });

app.get('/api/auth/me', requireAuth, (req, res) => {
  const db = readDB();
  const user = db.users.find(u => u.id === req.session.userId);
  if (!user) return res.status(401).json({ error: 'Not found' });
  const { password: _, ...safe } = user;
  res.json({ user: safe });
});

// ── Branding ──────────────────────────────────────────────────────
app.put('/api/settings/brand', requireAuth, (req, res) => {
  const { brand_name, brand_color, company } = req.body;
  const db = readDB();
  const user = db.users.find(u => u.id === req.session.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (brand_name) user.brand_name = brand_name;
  if (brand_color) user.brand_color = brand_color;
  if (company) user.company = company;
  writeDB(db);
  const { password: _, ...safe } = user;
  res.json({ user: safe });
});

// ── PDF extraction ────────────────────────────────────────────────
function extractPDF(filePath) {
  return new Promise((resolve, reject) => {
    const parser = new PDFParser();
    parser.on('pdfParser_dataReady', data => {
      const text = data.Pages?.map(p =>
        p.Texts?.map(t => decodeURIComponent(t.R?.[0]?.T || '')).join(' ')
      ).join('\n') || '';
      resolve(text);
    });
    parser.on('pdfParser_dataError', reject);
    parser.loadPDF(filePath);
  });
}

// ── Knowledge Base routes ─────────────────────────────────────────
app.get('/api/kb', requireAuth, (req, res) => {
  const db = readDB();
  res.json({ files: (db.kb || []).map(f => ({ id: f.id, name: f.name, chars: f.chars, added_at: f.added_at, added_by: f.added_by })) });
});

app.post('/api/kb/upload', requireAuth, upload.single('file'), async (req, res) => {
  const db = readDB();
  const user = db.users.find(u => u.id === req.session.userId);
  if (user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  if (!req.file) return res.status(400).json({ error: 'No file' });

  const ext = path.extname(req.file.originalname).toLowerCase();
  let text = '';
  try {
    if (ext === '.txt' || ext === '.md') text = fs.readFileSync(req.file.path, 'utf8');
    else if (ext === '.pdf') text = await extractPDF(req.file.path);
    else if (ext === '.docx' || ext === '.doc') { const r = await mammoth.extractRawText({ path: req.file.path }); text = r.value; }
    else if (ext === '.csv') text = fs.readFileSync(req.file.path, 'utf8');
    else if (ext === '.xlsx' || ext === '.xls') {
      const XLSXmod = await import('xlsx');
      const XLSX = XLSXmod.default;
      const workbook = XLSX.readFile(req.file.path);
      text = workbook.SheetNames.map(name => {
        const sheet = workbook.Sheets[name];
        return `Sheet: ${name}\n` + XLSX.utils.sheet_to_csv(sheet);
      }).join('\n\n');
    }
    fs.unlinkSync(req.file.path);
    console.log('Extracted text length:', text.length);
    console.log('Text preview:', text.slice(0, 200));


    if (!text || text.trim().length < 20) {
      return res.status(400).json({ error: 'Could not extract text from this file. Try a different PDF or paste the text manually.' });
    }

const fileId = Date.now().toString();
await addToVectorDB(fileId, req.file.originalname, text);
    if (!db.kb) db.kb = [];
    db.kb.push({ id: fileId, name: req.file.originalname, chars: text.length, added_at: new Date().toISOString(), added_by: user.name });
    writeDB(db);
    res.json({ ok: true, chars: text.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/kb/text', requireAuth, async (req, res) => {
  const db = readDB();
  const user = db.users.find(u => u.id === req.session.userId);
  if (user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { name, text } = req.body;
  if (!text) return res.status(400).json({ error: 'No text' });

  try {
    const fileId = Date.now().toString();
    await addToVectorDB(fileId, name, text);
    if (!db.kb) db.kb = [];
    db.kb.push({ id: fileId, name, chars: text.length, added_at: new Date().toISOString(), added_by: user.name });
    writeDB(db);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/kb/:id', requireAuth, async (req, res) => {
  const db = readDB();
  const user = db.users.find(u => u.id === req.session.userId);
  if (user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  try {
    await removeFromVectorDB(req.params.id);
    db.kb = (db.kb || []).filter(f => f.id !== req.params.id);
    writeDB(db);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Chat history ──────────────────────────────────────────────────
app.get('/api/chats', requireAuth, (req, res) => {
  const db = readDB();
  res.json({ chats: db.chats[req.session.userId] || [] });
});

app.post('/api/chats', requireAuth, (req, res) => {
  const { id, title, messages } = req.body;
  const db = readDB();
  if (!db.chats[req.session.userId]) db.chats[req.session.userId] = [];
  const existing = db.chats[req.session.userId].findIndex(c => c.id === id);
  const chat = { id, title, messages, updated_at: new Date().toISOString() };
  if (existing >= 0) db.chats[req.session.userId][existing] = chat;
  else db.chats[req.session.userId].unshift(chat);
  db.chats[req.session.userId] = db.chats[req.session.userId].slice(0, 50);
  writeDB(db);
  res.json({ ok: true });
});

app.delete('/api/chats/:id', requireAuth, (req, res) => {
  const db = readDB();
  if (!db.chats[req.session.userId]) return res.json({ ok: true });
  db.chats[req.session.userId] = db.chats[req.session.userId].filter(c => c.id !== req.params.id);
  writeDB(db);
  res.json({ ok: true });
});

// ── AI chat with RAG ──────────────────────────────────────────────
app.post('/api/chat', requireAuth, async (req, res) => {
  const { messages } = req.body;
  const db = readDB();
  const user = db.users.find(u => u.id === req.session.userId);
  if (!user) return res.status(401).json({ error: 'User not found' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not set in environment' });

  const lastUserMessage = [...messages].reverse().find(m => m.role === 'user')?.content || '';
  const relevantContext = await retrieveRelevantChunks(lastUserMessage, 5);
  const systemPrompt = buildSystemPrompt(user, relevantContext);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: messages.map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
          }))
        })
      }
    );

    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message });
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response';

    db.usage.push({
      user_id: user.id, user_name: user.name, user_email: user.email, company: user.company,
      tokens_in: data.usageMetadata?.promptTokenCount || 0,
      tokens_out: data.usageMetadata?.candidatesTokenCount || 0,
      timestamp: new Date().toISOString()
    });
    writeDB(db);

    res.json({ reply, usage: data.usageMetadata });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

function buildSystemPrompt(user, relevantContext) {
  let prompt = `You are ${user.brand_name || 'Aria'}, a professional and helpful AI assistant for ${user.company || 'this company'},developed by tabish.corp.

Your personality:
- Warm but professional — like a brilliant senior colleague
- Give direct, actionable answers. No fluff.
- Use clean formatting for lists and steps
- Proactively suggest follow-up actions when relevant
- Never say "As an AI language model" — you are ${user.brand_name || 'Aria'}

Keep responses appropriately concise.`;

  if (relevantContext) {
    prompt += `\n\nRELEVANT COMPANY KNOWLEDGE (retrieved for this specific question):\n${relevantContext}\n\nUse this information to give accurate, company-specific answers. If the context doesn't contain the answer, say so honestly.`;
  }

  return prompt;
}

// ── Usage dashboard ───────────────────────────────────────────────
app.get('/api/admin/usage', requireAuth, (req, res) => {
  const db = readDB();
  const user = db.users.find(u => u.id === req.session.userId);
  if (user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

  const usage = db.usage || [];
  const users = db.users.map(({ password: _, ...u }) => u);
  const totalMessages = usage.length;
  const totalTokensIn = usage.reduce((s, u) => s + (u.tokens_in || 0), 0);
  const totalTokensOut = usage.reduce((s, u) => s + (u.tokens_out || 0), 0);

  const perUser = {};
  usage.forEach(u => {
    if (!perUser[u.user_id]) perUser[u.user_id] = { name: u.user_name, email: u.user_email, messages: 0, tokens: 0 };
    perUser[u.user_id].messages++;
    perUser[u.user_id].tokens += (u.tokens_in || 0) + (u.tokens_out || 0);
  });

  const daily = {};
  const now = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate() - i);
    daily[d.toISOString().slice(0, 10)] = 0;
  }
  usage.forEach(u => { const day = u.timestamp?.slice(0, 10); if (daily[day] !== undefined) daily[day]++; });

  res.json({ totalMessages, totalTokensIn, totalTokensOut, perUser: Object.values(perUser), daily, users, recentUsage: usage.slice(-50).reverse() });
});


app.listen(PORT, () => {
  console.log(`\n✅ Aria AI running at http://localhost:${PORT}`);
  console.log(`\n📋 No ChromaDB needed — using Pinecone cloud vector DB\n`);
});