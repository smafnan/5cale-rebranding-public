# Working on Tarjuman

Tarjuman is a live voice interpreter used alongside Microsoft Teams calls: what you say
(Urdu) is spoken to the other side in German, what they say is spoken to you in Urdu, and
both are shown as captions (plus English). A Node server talks to free-tier speech and
translation providers; a browser app captures audio, detects speech, and plays the result
to a virtual microphone and to your headphones.

Start with `README.md` and `docs/ARCHITECTURE.md`.

## Layout

| Path | What lives there |
| --- | --- |
| `src/shared/` | Wire protocol, settings, REST contracts, language registry. No dependencies. |
| `src/server/providers/` | One file per provider, the provider interfaces (`types.ts`) and the fallback chain (`chain.ts`). |
| `src/server/pipeline/` | Per-call logic: ordering, hallucination filter, speech chunking, conversation memory. |
| `src/server/http/` | Fastify app, WebSocket transport, validation, origin checks. |
| `src/server/services.ts` | Composition root: which providers exist, their order, their keys. |
| `src/web/src/audio/` | Capture, speech segmentation, output buses. |
| `src/web/src/app/` | The controller: the only writer of the store. |
| `src/web/src/ui/` | React components. Read the store, call the controller, nothing else. |
| `tests/e2e/` | Playwright tests against the real server with mock providers. |

## Rules that keep it healthy

- **Contracts first.** `src/shared/` is the source of truth for anything that crosses the
  socket. Change it there, then the server, then the browser. Bump `PROTOCOL_VERSION` for
  incompatible changes.
- **Providers are stateless** and throw `ProviderError` with the right `kind`; health,
  cooldowns and budgets live in `FallbackChain`. Never retry around the chain.
- **Every provider gets tests with an injected `fetch`** (or a local fake service). These
  APIs cannot be called in CI, so request shapes are pinned by tests.
- **The UI never writes to the store** (except `ui/demo.ts`) and never touches audio or the
  network; it calls `controller()`.
- **Nothing on the capture path may depend on timers.** Browsers slow timers to once a
  second (or minute) when the window is hidden behind Teams. Drive logic from audio frames.
- **Never log meeting content or keys.** Transcripts are logged only with `LOG_TRANSCRIPTS=1`.
- **No third-party assets at run time**: fonts, the speech-detection model and the ONNX
  runtime are bundled.
- Comments say why, not what. No placeholders or TODOs in committed code.

## Commands

```
npm run dev        # server on :8787 (watch) + web on :5173
npm run check      # typecheck + lint + unit tests
npm run test:e2e   # browser tests (builds first, uses mock providers)
npm run doctor     # test every configured provider with one real request
npm run build && npm start
```

`TARJUMAN_MOCK=1` replaces all providers with offline fakes; `http://localhost:5173/?demo=1`
shows the interface filled with sample data.

## Recipes

**Add a language**: add it to `src/shared/languages.ts`, add voices in
`src/server/providers/tts/voices.ts`, a Whisper prompt lead in
`src/server/providers/stt/groqWhisper.ts`, and stock phrases in
`src/server/pipeline/hallucination.ts`.

**Add a provider**: implement `SttProvider` / `MtProvider` / `TtsProvider` from
`src/server/providers/types.ts` in its own file, construct it in `buildProviders` in
`src/server/services.ts`, describe its key in `KEY_DEFINITIONS` if it needs one, document
it in `docs/PROVIDERS.md` and `.env.example`, and add tests.
