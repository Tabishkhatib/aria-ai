# Aria AI — Enterprise Chat Agent

A product-ready AI assistant with auth, branding, company knowledge base, chat history, and a usage dashboard.

\---

## What's included

* **Auth** — Register / login with sessions. First account = admin.
* **Branding** — Custom assistant name, company name, and brand colour.
* **Company knowledge base** — Paste text or upload PDF/Word/TXT files. Aria uses this in every reply.
* **Chat history** — Conversations saved per user, persistent across sessions.
* **Usage dashboard** — Admin-only view with message counts, token usage, activity chart, and team list.

\---

## How to run it

### Step 1 — Install Node.js

Download and install Node.js (version 18 or higher) from:
https://nodejs.org/en/download

To check it's installed, open your terminal and run:

```
node --version
```

You should see something like `v20.x.x`

\---

### Step 2 — Get your free Gemini API key

1\. Go to https://aistudio.google.com

2\. Sign in with Google

3\. Click Get API Key → Create API key

4\. Copy the key — it starts with AIza...---

### Step 3 — Set up the project

Open your terminal, then:

```bash
# Go into the project folder
cd aria-ai

# Install dependencies
npm install

# Create your .env file
cp .env.example .env
```

Now open the `.env` file in any text editor and replace `your\_api\_key\_here` with your actual key:

```
GEMINI\_API\_KEY=your\_key\_here
```

\---

### Step 4 — Run it

```bash
node start.js
```

You'll see:

```
✅ Aria AI running at http://localhost:3000
```

Open your browser and go to **http://localhost:3000**

\---

### Step 5 — First time setup

1. Click **Create one** to register
2. Fill in your name, company name, and pick a brand colour
3. The **first account you create is the admin** (gets access to the dashboard)
4. You're in!

\---

## Adding company data

1. Click Company data in the sidebar
2. Upload a PDF/Word/TXT file or paste text
3. Only admins can add data — it's shared with the whole team
4. Aria will now use this in every answer

\---

## Admin dashboard

If you're the first registered user (admin):

* You'll see a **Dashboard** link in the sidebar
* Shows total messages, tokens used, team members, and a 14-day activity chart

\---

## Running it for a client (selling it)

To customise it per client before handing over:

1. Change the default brand name in `public/index.html` (search for "Aria AI")
2. Change the default colour `#7F77DD` to their brand colour
3. They can also change all of this themselves in Settings once logged in

\---

## File structure

```
aria-ai/
├── server.js          ← Express server (API, auth, AI proxy)
├── start.js           ← Startup script (loads .env)
├── package.json
├── .env               ← Your API key (never share this)
├── public/
│   └── index.html     ← Full frontend app
└── data/
    ├── db.json        ← Users, chat history, usage logs (auto-created)
    └── uploads/       ← Temp file upload folder (auto-created)
```

\---

## Stopping the server

Press `Ctrl + C` in the terminal.

## Restarting

```bash
node start.js
```

That's it — no build step, no framework, just plain Node.js.

