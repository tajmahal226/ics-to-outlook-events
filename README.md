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
- [Anthropic SDK](https://github.com/anthropics/anthropic-sdk-typescript) – event extraction, called directly from the browser with your own key
- [pdfjs-dist](https://mozilla.github.io/pdf.js/), [mammoth](https://github.com/mwilliamson/mammoth.js), [postal-mime](https://github.com/postalsys/postal-mime) – document parsing, in the browser
- [ical.js](https://github.com/kewisch/ical.js) – reading and writing `.ics`

---

## Bring your own API key

There is no backend and no server-side key. You supply your own API key in
**Settings**, and it is stored in that browser's `localStorage` and sent only to the
provider you chose. Documents are parsed on your device; only the extracted text is
sent on.

`.ics` files are read entirely locally by `ical.js` and need no key at all, so the
app is useful before you configure anything.

> **Security note:** a key in browser storage is readable by any script on the page.
> Use a key with a spend limit, and revoke it if you ever suspect a problem. This is
> the deliberate trade for having no backend to run.

Anthropic is wired up today. OpenAI, OpenRouter, x.ai and Google Gemini are planned;
the provider seam and settings UI already account for them.

---

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | `^20.19.0 \|\| >=22.12.0` (see `engines` in `package.json`) |
| npm / bun | any recent version |
| An API key | from [Anthropic](https://console.anthropic.com/settings/keys), entered in Settings at runtime |

---

## Local Development

### 1. Install dependencies

```bash
npm install
# or
bun install
```

### 2. Configure

Nothing to configure at build time. There are no environment variables: start the
app and add your API key in **Settings**.

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

No environment variables are needed. Each visitor supplies their own API key at
runtime through Settings, so there is nothing to configure in the Vercel dashboard.

### Option 2 – Netlify

1. Push your repository to GitHub.
2. Go to [netlify.com](https://netlify.com) and click **Add new site → Import an existing project**.
3. Set build settings:
   - **Build command:** `npm run build`
   - **Publish directory:** `dist`
4. Click **Deploy**. No environment variables are required.

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

   > **Note:** no secrets are needed at build time — each visitor enters their own API key in Settings.

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

None. The app reads no build-time configuration.

Credentials are supplied per-browser at runtime in **Settings** and kept in
`localStorage` under `smart-schedule.provider-settings`. Nothing is baked into the
bundle, so the same deployment serves everyone with their own key.

---

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start the development server at `http://localhost:3000` |
| `npm run build` | Build for production into `dist/` |
| `npm run preview` | Preview the production build locally |
| `npm run lint` | Type-check plus CSS lint and the custom CSS guards (there is no ESLint) |
