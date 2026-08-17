# ICS to Outlook Events

A React + Vite web application that converts any document (PDF, email, text) into Outlook-ready calendar events using AI. Upload a conference schedule, email, or plain-text list, and the app extracts events and generates a downloadable `.ics` file you can import directly into Outlook.

## Features

- **AI-powered extraction** – Upload PDFs, emails, or text documents; the AI detects event titles, dates, times, and descriptions automatically.
- **Native `.ics` support** – Drop in an existing `.ics` file and the app parses it instantly, no AI required.
- **Outlook optimized** – Generated `.ics` files follow Microsoft Outlook's requirements, including correct time-zone handling.
- **Per-event export** – Download individual events or export the entire schedule in a single `.ics` file.
- **AI description polish** – Cleans up messy extracted descriptions into professional bullet points.

## Tech Stack

- [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- [Vite](https://vitejs.dev/) (bundler / dev server)
- [Tailwind CSS](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/)
- [Blink SDK](https://blink.new) – AI text extraction, object generation, and file storage

---

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | 18 or later |
| npm / bun | any recent version |
| [Blink](https://blink.new) account | free tier available |

---

## Local Development

### 1. Install dependencies

```bash
npm install
# or
bun install
```

### 2. Configure environment variables

Create a `.env.local` file in the project root (or copy the existing one):

```env
VITE_BLINK_PROJECT_ID=your-blink-project-id
VITE_BLINK_PUBLISHABLE_KEY=your-blink-publishable-key
```

You can find these values in your [Blink dashboard](https://blink.new/dashboard) under your project's settings.

### 3. Start the dev server

```bash
npm run dev
# or
bun run dev
```

The app will be available at `http://localhost:3000`.

---

## Building for Production

```bash
npm run build
# or
bun run build
```

This generates a production-ready static bundle in the `dist/` directory.

Preview the build locally:

```bash
npm run preview
# or
bun run preview
```

---

## Deployment

Because the output is a static site (HTML + JS + CSS), it can be deployed to any static-hosting provider.

### Option 1 – Vercel (recommended)

Build settings are committed in [`vercel.json`](./vercel.json), so there is nothing to
configure in the import wizard:

- **Framework:** Vite
- **Build command:** `npm run build`
- **Output directory:** `dist`
- **Rewrites:** all unmatched paths fall through to `/index.html` (static files in
  `dist/` still win, since Vercel checks the filesystem before applying rewrites)
- **Headers:** hashed files under `/assets/` get a one-year immutable cache

**Deploy via the dashboard**

1. Push the repository to GitHub.
2. Go to [vercel.com/new](https://vercel.com/new) and import it.
3. Click **Deploy**.

**Deploy via the CLI**

```bash
npm i -g vercel
vercel link      # once, to associate the directory with a Vercel project
vercel --prod
```

Because `.env.local` is checked into the repository, the Blink project ID and
publishable key are already picked up at build time and no dashboard configuration is
required. To point a deployment at a different Blink project, set
`VITE_BLINK_PROJECT_ID` and `VITE_BLINK_PUBLISHABLE_KEY` under **Settings →
Environment Variables** — real environment variables take precedence over `.env.local`.

### Option 2 – Netlify

1. Push your repository to GitHub.
2. Go to [netlify.com](https://netlify.com) and click **Add new site → Import an existing project**.
3. Set build settings:
   - **Build command:** `npm run build`
   - **Publish directory:** `dist`
4. Add environment variables in **Site settings → Environment variables**:
   - `VITE_BLINK_PROJECT_ID`
   - `VITE_BLINK_PUBLISHABLE_KEY`
5. Click **Deploy**.

### Option 3 – GitHub Pages

1. Install the `gh-pages` package:

   ```bash
   npm install --save-dev gh-pages
   ```

2. Add a `homepage` field and deploy scripts to `package.json`:

   ```json
   {
     "homepage": "https://<your-username>.github.io/<your-repo-name>",
     "scripts": {
       "predeploy": "npm run build",
       "deploy": "gh-pages -d dist"
     }
   }
   ```

3. If the app is not served from the root path, set the `base` option in `vite.config.ts`:

   ```ts
   export default defineConfig({
     base: '/<your-repo-name>/',
     // ...
   })
   ```

4. Run:

   ```bash
   npm run deploy
   ```

   > **Note:** GitHub Pages does not support server-side environment variables. Store your Blink keys directly in the `vite.config.ts` `define` block or use a CI/CD secret that replaces them at build time.

### Option 4 – Self-hosted / Docker

Serve the `dist/` directory with any static file server (nginx, Apache, Caddy, etc.).

**nginx example** (`/etc/nginx/sites-available/ics-app`):

```nginx
server {
    listen 80;
    server_name your-domain.com;
    root /var/www/ics-app/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Build and copy the files to the server:

```bash
npm run build
scp -r dist/ user@your-server:/var/www/ics-app/
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_BLINK_PROJECT_ID` | Yes | Your Blink project ID (found in the Blink dashboard) |
| `VITE_BLINK_PUBLISHABLE_KEY` | Yes | Your Blink publishable API key |

> **Security note:** These are *publishable* (client-side) keys intended to be embedded in the browser bundle. Never commit or expose your Blink *secret* keys.

---

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start the development server at `http://localhost:3000` |
| `npm run build` | Build for production into `dist/` |
| `npm run preview` | Preview the production build locally |
| `npm run lint` | Run all linters (TypeScript, ESLint, CSS) |
