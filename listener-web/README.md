# listener-web

React/Vite client for joining a listener session and viewing live transcription and translation over SSE.

## Scripts

- `npm run dev`: start the local Vite server
- `npm run build`: type-check and build production assets
- `npm run lint`: run ESLint
- `npm run preview`: preview the production build

## Runtime

- `/entrance`: enter a session PIN
- `/session/:sessionId`: connect to `/api/broadcast/:sessionId` and render live session output
- Vite dev server proxies `/api` to `http://localhost:8000`
