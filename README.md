# Steno Practice

A personal dictation-practice platform for SSC Stenographer aspirants. You listen to a dictation video, write it on paper, then transcribe it on screen against the clock. The server marks your typing against the stored master transcript and shows every mistake, your weak words and your progress over time.

English only for now. Sign-in is by Google and the app is invite-only.

## How a practice session works

1. Pick a book (for example "Kailash Chandra Volume 24") and an exercise. Each exercise plays a YouTube dictation video.
2. Listen and write in your notebook.
3. Press "Transcribe now" and type what you wrote, against the timer.
4. Submit. The server compares your text with the verified master transcript, word by word, and shows a detailed analysis: full mistakes, half mistakes, added and missing words, error percentage, weak words, and a history you can revisit.

### Marking rules

- The evaluator aligns your text to the transcript at word level (dynamic-programming alignment).
- A full mistake counts 1, a half mistake counts 0.5.
- Error % = (full + half / 2) / total words x 100.
- The allowed error limits per exam (Grade C, Grade D, common practice) are seeded as starting values and are editable by an admin under "Rules and exams". They have not been checked against the latest SSC notice yet, so verify them before relying on them.

## Tech stack

| Part | What |
| --- | --- |
| Server | Node 24+, Express 5, TypeScript (ESM), Mongoose 9 on MongoDB Atlas, zod 4, express-session with connect-mongo, google-auth-library, helmet, express-rate-limit, pino |
| Client | React 19, Vite 8, TypeScript, react-router 8, TanStack Query 5, plain CSS with design tokens, oxlint |
| Tests | Vitest, supertest, mongodb-memory-server (no real database needed) |

## Project layout

```
client/            React app (student side and the /admin console); vercel.json holds the Vercel rewrites
  src/pages/       student pages: login, home, book, dictation, write, analysis, history, dashboard
  src/admin/       admin console pages
  src/auth/        Google sign-in button, auth context, route guards
server/
  src/modules/     routes by area: auth, catalog, attempts, analytics, library, reports, resources, admin
  src/evaluator/   the marking engine
  src/services/    Google sign-in, YouTube and Drive imports, content import, access rules
  src/models/      Mongoose models
  content/         content packs (JSON) loaded with `npm run content:load`
  postman/         Postman collection for the API
```

## Getting started

You need Node 24 or newer and a MongoDB database (an Atlas free cluster is fine).

### 1. Server

```bash
cd server
npm install
cp .env.example .env      # then fill in the values (see the table below)
npm run dev               # API on http://localhost:4000
```

The first start builds the indexes and seeds the exam profiles and spelling data.

Load the sample content pack (Kailash Chandra Volume 24 transcripts). It is safe to run again:

```bash
npm run content:load
```

Exercises only appear to students once they have a verified transcript and a video. Add the video links afterwards in Admin, Content, "Paste video links".

### 2. Client

```bash
cd client
npm install
cp .env.example .env.local   # set VITE_GOOGLE_CLIENT_ID
npm run dev                  # http://localhost:5173
```

The Vite dev server proxies `/api` to `localhost:4000`, so the browser sees a single origin and the session cookie works without CORS settings.

## Configuration

Server (`server/.env`):

| Variable | Required | Purpose |
| --- | --- | --- |
| `DB_URL` | yes | MongoDB connection string |
| `SESSION_SECRET` | in production | Long random string that signs the session cookie |
| `GOOGLE_CLIENT_ID` | for Google sign-in | OAuth client ID, the same value as the client's `VITE_GOOGLE_CLIENT_ID` |
| `ADMIN_EMAILS` | recommended | Comma-separated emails that become admins when they sign in |
| `ALLOWED_EMAILS` | optional | Bootstrap list of emails that can always sign in. Day to day, invite people from Admin, Access instead |
| `CLIENT_ORIGIN` | in production | The site(s) that open the app in a browser. Several allowed, comma-separated. Default `http://localhost:5173` |
| `TRUST_PROXY` | no | How many reverse proxies sit in front of the API. Default `1` in production, none locally. A number or `false` |
| `COOKIE_SAMESITE` | no | `lax` (default). Use `none` (needs HTTPS) only if the client and API are on different sites |
| `PORT`, `LOG_LEVEL` | no | Default `4000` and `info` |
| `AUTH_DEV_LOGIN` | no | `true` enables an email-only dev login. Ignored in production |
| `YOUTUBE_API_KEY` | for playlist import | YouTube Data API v3 key |
| `GOOGLE_DRIVE_API_KEY` | for Drive folder import | Drive API key. Falls back to the YouTube key if that key also allows the Drive API |

Client (`client/.env.local`, or the Vercel project's environment variables):

| Variable | Required | Purpose |
| --- | --- | --- |
| `VITE_GOOGLE_CLIENT_ID` | for Google sign-in | The same OAuth client ID as the server's `GOOGLE_CLIENT_ID` |
| `VITE_API_URL` | no | Where the API lives, for example `https://api.example.com` (no trailing slash). Leave empty to call the same origin: Vite proxies `/api` in development and `vercel.json` rewrites it on Vercel |

Only `VITE_` variables reach the browser, so never put secrets here. They are baked in at build time, so redeploy after changing one.

Never commit `.env` files. They are ignored by git; only the `.env.example` files are tracked.

## Google sign-in

The login page uses Google Identity Services: One Tap plus the "Continue with Google" button. The server verifies Google's ID token and starts a session (httpOnly cookie `steno.sid`, 30 days, stored in MongoDB).

To set it up, in the Google Cloud console open Google Auth Platform:

1. Configure the app (name, support email, audience External, contact email).
2. Clients, Create client, application type Web application.
3. Under Authorized JavaScript origins add `http://localhost:5173` and `http://localhost`, plus your deployed origin later. Changes can take from a few minutes to a few hours to apply.
4. Put the client ID in both `.env` files as described above.

The app only requests name, email and profile photo.

## Access control

- Production is always invite-only. Admin emails and `ALLOWED_EMAILS` may always sign in; everyone else must be invited under Admin, Access.
- A person who is not invited sees a "Not invited yet" message naming the email they used.
- Removing someone's access blocks their next sign-in and ends an open session on its next request.
- When running locally with no invites and no allow-list, sign-in is open so a fresh database is easy to try.

## Admin console

Open `/admin` while signed in as an admin. It has its own layout, and "Student preview" shows the student side.

- **Content**: books and exercises, transcript versions (draft, then verified), video links, delete an exercise.
- **Reports**: transcript errors and video problems that students report.
- **Resources**: the files students see on the home page. Only links are stored. Import a whole shared Google Drive folder at once, or add links by hand.
- **Access**: invite people and remove access.
- **Rules and exams**: exam settings and error limits, words accepted for each other, and abbreviations used by the marking engine.

## Scripts

Server: `npm run dev`, `npm run build`, `npm start`, `npm run typecheck`, `npm test`, `npm run content:load`.

Client: `npm run dev`, `npm run build`, `npm run lint`, `npm run preview`.

Run the server tests with `npm test` inside `server`. On the first run mongodb-memory-server downloads a MongoDB binary, so the first run is slower.

## API

All routes live under `/api/v1`. A health check is at `/api/v1/health`. The Postman collection in `server/postman` covers the API, but it may not include the newest endpoints yet.

## Deploying

The API runs on Render and the client on Vercel. The browser only ever talks to the Vercel site, and Vercel forwards `/api/*` to Render (see `client/vercel.json`). That keeps the session cookie first-party, so no CORS setup or `COOKIE_SAMESITE=none` is needed, and a custom domain later is just an extra domain on the Vercel project.

### 1. API on Render (Web Service)

- Root directory `server`. Build command `npm install --include=dev && npm run build` (TypeScript is a dev dependency). Start command `npm start`. Health check path `/api/v1/health`.
- Environment variables: `NODE_VERSION=24`, `NODE_ENV=production`, `DB_URL`, `SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `ADMIN_EMAILS`, and `CLIENT_ORIGIN` set to your Vercel URL (for example `https://your-app.vercel.app`). Add `YOUTUBE_API_KEY` and `GOOGLE_DRIVE_API_KEY` if you use the imports. The server refuses to start in production without `SESSION_SECRET` and `DB_URL`.
- In Atlas, Network Access must allow Render. Render publishes IP ranges rather than one fixed address, so the simplest setting is `0.0.0.0/0`, protected by the database password.
- Free instances sleep after 15 minutes without traffic, and the first request afterwards takes about a minute.

### 2. Client on Vercel

- Import the repository and set the Root Directory to `client`. The Vite preset is detected: build `npm run build`, output `dist`.
- Environment variable: `VITE_GOOGLE_CLIENT_ID`. Leave `VITE_API_URL` empty.
- In `client/vercel.json`, replace `YOUR-API-SERVICE.onrender.com` with your Render host. The `/api` rewrite must stay above the catch-all that serves `index.html`.

### 3. Google sign-in

Add the Vercel URL to the OAuth client's Authorized JavaScript origins (and your custom domain later). One Tap needs HTTPS.

### 4. Check it

Open `https://<your-vercel-url>/api/v1/health`; it should return `{"status":"ok", ...}`. Then sign in. Finally open the Render logs: each request line has an `ip` field, which should be your own public IP. If it shows a Vercel or Render address instead, every visitor shares one rate-limit bucket, so try `TRUST_PROXY=2` (or `1`) until it matches.

### Own domain later

With `app.example.com` and `api.example.com` on one domain you can call the API directly: set `VITE_API_URL=https://api.example.com` on Vercel, list `https://app.example.com` in `CLIENT_ORIGIN`, and add the Google origin. Both are subdomains of one site, so the default `COOKIE_SAMESITE=lax` still works.

## Security notes

Helmet headers, rate limits on the API and sign-in, an Origin check on state-changing requests, and a fresh session id on every sign-in.

## Content and licence

`server/content/kailash-chandra-vol-24.json` holds transcripts taken from a published book, and the practice videos come from a third-party YouTube channel. This is a private study project: keep the repository private and do not redistribute the content.

## Planned

- A real typing-speed test (shown as "Coming soon" on the home page).
- Upload files from the computer on the Resources page (storage not chosen yet).
- Viewing PDFs inside the page instead of a new tab.
