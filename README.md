# Steno Practice

A personal dictation-practice platform for SSC Stenographer aspirants. You listen to a dictation video, write it on paper, then transcribe it on screen against the clock. The server marks your typing against the stored master transcript and shows every mistake, your weak words and your progress over time.

English only for now. People sign in with Google or with an email and password, and anyone can create an account (an admin can switch this to invite-only).

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
  src/auth/        Google sign-in button, auth context, route guards (the login and create-account form is in src/pages/LoginPage.tsx)
server/
  src/modules/     routes by area: auth, catalog, attempts, analytics, library, reports, resources, admin
  src/evaluator/   the marking engine
  src/services/    Google sign-in, password hashing, YouTube and Drive imports, content import, access rules
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
| `ALLOWED_EMAILS` | optional | Emails that can always sign in, even when sign-up is invite-only. Day to day, invite people from Admin, Access instead |
| `CLIENT_ORIGIN` | in production | The site(s) that open the app in a browser. Several allowed, comma-separated. Default `http://localhost:5173` |
| `TRUST_PROXY` | no | How many reverse proxies sit in front of the API. Default `1` in production, none locally. A number or `false` |
| `COOKIE_SAMESITE` | no | `lax` (default). Use `none` (needs HTTPS) only if the client and API are on different sites |
| `PORT`, `LOG_LEVEL` | no | Default `4000` and `info` |
| `AUTH_DEV_LOGIN` | no | `true` enables an email-only dev login. Ignored in production |
| `YOUTUBE_API_KEY` | for playlist import | YouTube Data API v3 key |
| `GOOGLE_DRIVE_API_KEY` | for Drive folder import | Drive API key. Falls back to the YouTube key if that key also allows the Drive API |
| `R2_ACCOUNT_ID` (or `R2_ENDPOINT`), `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_URL` | for photos and PDF uploads | Cloudflare R2 bucket. Photo and PDF upload are switched on only when all of them are set. Optional `R2_KEY_PREFIX` puts everything in one folder of the bucket. See "File storage" below |

Client (`client/.env.local`, or the Vercel project's environment variables):

| Variable | Required | Purpose |
| --- | --- | --- |
| `VITE_GOOGLE_CLIENT_ID` | for Google sign-in | The same OAuth client ID as the server's `GOOGLE_CLIENT_ID` |
| `VITE_API_URL` | no | Where the API lives, for example `https://api.example.com` (no trailing slash). Leave empty to call the same origin: Vite proxies `/api` in development and `vercel.json` rewrites it on Vercel |

Only `VITE_` variables reach the browser, so never put secrets here. They are baked in at build time, so redeploy after changing one.

Never commit `.env` files. They are ignored by git; only the `.env.example` files are tracked.

## Sign-in and accounts

Two ways in, both on the login page:

- **Continue with Google**: Google Identity Services (One Tap plus the button). The server verifies Google's ID token and starts a session (httpOnly cookie `steno.sid`, 30 days, stored in MongoDB).
- **Email and password**: "Create an account" asks for name, email, password and confirmation. Passwords are stored only as salted scrypt hashes.

To set up Google, in the Google Cloud console open Google Auth Platform:

1. Configure the app (name, support email, audience External, contact email).
2. Clients, Create client, application type Web application.
3. Under Authorized JavaScript origins add `http://localhost:5173` and `http://localhost`, plus your deployed origin later. Changes can take from a few minutes to a few hours to apply.
4. Put the client ID in both `.env` files as described above.

The app only requests name, email and profile photo from Google.

### Rules to know

- Passwords need 8 to 128 characters and cannot be a very common password or the email address itself.
- After 8 wrong passwords in a row an account is locked for 15 minutes.
- **Admins sign in with Google only.** Emails in `ADMIN_EMAILS` cannot register with a password, and a password sign-in never opens an admin session. Anyone can type someone else's email into "Create an account" because email addresses are not verified yet, so the admin role is only ever granted after Google has verified the address.
- If a password account and a Google sign-in share an email, the Google sign-in takes the account over and the password is removed, so nobody can pre-register another person's email and keep access.
- There is no "forgot password" yet (it needs an email service). Until then a person who forgot their password can use Google with the same email, or an admin can remove and restore their access.

## Access control

- Open sign-up is the default: anyone can create an account. In Admin, Access, an admin can switch to "Invited people only". Then admin emails, `ALLOWED_EMAILS` and invited emails can join, and everyone else sees "Not invited yet".
- Admin, Access lists every person with how they sign in, when they joined and when they last signed in. From there an admin can sign someone out on all devices, remove access, or restore it.
- Removing someone's access blocks their next sign-in (either method) and ends an open session on its next request. Signing someone out only ends their sessions; they can sign in again.

## Admin console

Open `/admin` while signed in as an admin. It has its own layout, and "Student preview" shows the student side.

- **Content**: books and exercises, transcript versions (draft, then verified), video links, delete an exercise.
- **Reports**: transcript errors and video problems that students report.
- **Resources**: the files students see on the home page, arranged in groups you create (KC Magazines, Syllabus, Announcements, and so on). Upload PDFs from your computer (files or whole folders, needs the R2 settings), import a shared Google Drive folder at once, or add links by hand.
- **Access**: choose who can create an account, invite people, see everyone who joined, sign people out and remove access.
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
- Environment variables: `NODE_VERSION=24`, `NODE_ENV=production`, `DB_URL`, `SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `ADMIN_EMAILS`, and `CLIENT_ORIGIN` set to your Vercel URL (for example `https://your-app.vercel.app`). Add `YOUTUBE_API_KEY` and `GOOGLE_DRIVE_API_KEY` if you use the imports, and the `R2_*` variables for photos and PDF uploads. The server refuses to start in production without `SESSION_SECRET` and `DB_URL`.
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

### File storage (Cloudflare R2, optional)

R2 holds two things: student profile photos, and PDFs an admin uploads on the Resources page. Without the settings below, the Profile page hides the photo button and Resources keeps working with links and Drive folders only.

- **Profile photos** are cropped to a 512 px square WebP by the API (which also strips metadata such as GPS) and stored as `avatars/<user id>/<random>.webp`.
- **Resource PDFs** go from the admin's browser straight to R2 through a short-lived signed address, so big files never pass through the API. They are stored as `resources/<group>/<random>/<file name>.pdf`, and the Resources page then adds them to the group.

Setup:

1. Create an R2 bucket (a separate one for this app is simplest) and turn on public access for it (the `r2.dev` address for testing, or a custom domain for real use). Everything in the bucket can be read by anyone who has a file's address. Uploaded PDF addresses contain a random part and are not listed anywhere, but treat them like a Drive "anyone with the link" share.
2. Create an R2 API token with Object Read & Write, limited to that bucket.
3. Add a CORS policy to the bucket (bucket Settings, CORS Policy, Add CORS policy, JSON). The browser needs it to upload PDFs and to save them under their own name. Use your real site addresses, with no trailing slash:

   ```json
   [
     {
       "AllowedOrigins": ["https://your-app.vercel.app", "http://localhost:5173"],
       "AllowedMethods": ["GET", "PUT"],
       "AllowedHeaders": ["Content-Type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

4. Set these on the API (`server/.env` locally, and in the Render environment): `R2_ACCOUNT_ID` (Cloudflare dashboard, R2 overview), `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_PUBLIC_URL` (the public address, no trailing slash). Instead of the account id you can set `R2_ENDPOINT` (`https://<account id>.r2.cloudflarestorage.com`). To share a bucket with another project, also set `R2_KEY_PREFIX=steno` (any name): every file then lives under that folder. Pick it once and keep it.
5. The server needs these packages (`cd server && npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner sharp`).

Files an admin deletes on the Resources page are deleted from the bucket too. An upload that was started but never finished (the browser was closed halfway) can leave a stray file in the bucket; it is never shown to students, and you can delete it from the Cloudflare dashboard.

### Own domain later

With `app.example.com` and `api.example.com` on one domain you can call the API directly: set `VITE_API_URL=https://api.example.com` on Vercel, list `https://app.example.com` in `CLIENT_ORIGIN`, and add the Google origin. Both are subdomains of one site, so the default `COOKIE_SAMESITE=lax` still works.

## Security notes

Helmet headers, rate limits on the API and sign-in, a per-account lock after repeated wrong passwords, salted scrypt password hashes, an Origin check on state-changing requests, and a fresh session id on every sign-in.

## Content and licence

`server/content/kailash-chandra-vol-24.json` holds transcripts taken from a published book, and the practice videos come from a third-party YouTube channel. This is a private study project: keep the repository private and do not redistribute the content.

## Planned

- Email verification and password reset (needs an email-sending service, best with your own domain).
- A real typing-speed test (shown as "Coming soon" on the home page).
- Viewing PDFs inside the page instead of a new tab.
- Audio fallback for videos that cannot be embedded (owner disabled embedding). For now the exercise page shows a "Watch on YouTube" panel instead. Parked idea: generate dictation audio from the verified transcript with a text-to-speech voice.
  - Sarvam Bulbul v3 was trialled (en-IN, API key in `server/.env`, ₹3 per 1,000 characters, about ₹14 per exercise). Quality was good, but at pace 1.0 it speaks about 210 wpm, so words blur. Use pace around 0.7.
  - To hit an exact dictation speed: split the text into phrases (never split at "U.S." style abbreviations), synthesise each, trim silence, and stitch with measured gaps. Limits: 2,500 characters per request, 30 requests per minute, no SSML.
  - Cache per phrase, encode to MP3, keep in object storage (R2 or Vercel Blob), play with the same speed buttons, and mark the audio outdated when the transcript version changes. Optionally run speech recognition over the result as a quality check.
  - Check the copyright and licence of the book text before publishing generated audio.
- Optional admin check that flags videos which cannot be embedded (YouTube's oEmbed endpoint answers 401 for them), so they can be found before students hit them.
