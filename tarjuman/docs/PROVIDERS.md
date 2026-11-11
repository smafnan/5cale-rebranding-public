# Providers

Every step of the pipeline has several interchangeable providers behind a fallback chain.
This page lists them, what each costs, and how to change models or add your own.

Free-tier limits are what the providers or community trackers stated in November 2026.
They change often and some are not published at all, so Tarjuman does not rely on the
numbers: it reacts to what the provider answers (rate-limit responses, retry hints) and
moves on. `npm run doctor` shows the truth for your account.

## Keys

| Key                     | Where to get it                                                       | Unlocks                                                              |
| ----------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `GROQ_API_KEY`          | <https://console.groq.com/keys> (free, no card)                       | Whisper speech recognition; three translation models                 |
| `GEMINI_API_KEY`        | <https://aistudio.google.com/apikey> (free, no card)                  | One-call audio translation (best Urdu); Gemini and Gemma translation |
| `AZURE_SPEECH_KEY`      | Azure portal → Speech resource (free F0 tier; needs an Azure account) | Official neural voices                                               |
| `OPENAI_COMPAT_API_KEY` | your provider                                                         | Any OpenAI-compatible chat endpoint as an extra translator           |

Keys can be set in `.env` or pasted in the app (Settings → API keys). The environment wins.

## Speech recognition

| Id                            | Service · model                  | Free tier (approx.)                           | Notes                                                                                           |
| ----------------------------- | -------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `gemini-audio`                | Google · `gemini-3.5-flash-lite` | ~10–15 requests/min, ~500/day, unpublished    | Hears the audio and returns transcript **and** translations in one call. First choice for Urdu. |
| `groq-whisper-large-v3`       | Groq · `whisper-large-v3`        | 20 requests/min, 2,000/day, 2 h of audio/hour | First choice for German and English.                                                            |
| `groq-whisper-large-v3-turbo` | Groq · `whisper-large-v3-turbo`  | same, separate bucket                         | Overflow.                                                                                       |

Whisper's published word error rate is about 5 % for German and about 20 % for Urdu,
rising sharply when English terms are mixed in. That is why Urdu goes to Gemini when a key
is present. The language is always pinned (never auto-detected), which is what prevents
Urdu from coming back as Hindi in Devanagari script.

## Translation

| Id                  | Service · model                  | Free tier (approx.)                          | Notes                                                                |
| ------------------- | -------------------------------- | -------------------------------------------- | -------------------------------------------------------------------- |
| `gemini-flash-lite` | Google · `gemini-3.5-flash-lite` | shared with `gemini-audio`                   | Strongest evidence for Urdu quality.                                 |
| `gemma`             | Google · `gemma-4-31b-it`        | ~15 requests/min, ~1,500/day, unpublished    | Same key, separate quota.                                            |
| `groq-gpt-oss-120b` | Groq · `openai/gpt-oss-120b`     | 30 requests/min, 1,000/day, 8,000 tokens/min | Fast. Urdu quality is unproven.                                      |
| `groq-qwen3-8-27b`  | Groq · `qwen/qwen3.8-27b`        | same, separate bucket                        |                                                                      |
| `groq-gpt-oss-20b`  | Groq · `openai/gpt-oss-20b`      | same, separate bucket                        |                                                                      |
| `custom`            | whatever you configure           | —                                            | `OPENAI_COMPAT_BASE_URL` + `OPENAI_COMPAT_MODEL` (+ key).            |
| `mymemory`          | MyMemory                         | 5,000 characters/day without key             | Keyless safety net. No context, glossary or register; basic quality. |

All LLM providers receive the same interpreter prompt: the last few turns of the
conversation, your glossary, the meeting description and the form of address.

## Voice

| Id            | Service                            | Free tier                         | Notes                                                                                         |
| ------------- | ---------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------- |
| `azure`       | Azure AI Speech                    | 0.5 million characters/month (F0) | Official API. Tried first when a key is present.                                              |
| `edge`        | Microsoft Edge read-aloud endpoint | no key, limits unpublished        | Same neural voices. Unofficial: may change or stop without notice.                            |
| browser voice | the browser's speech synthesis     | free                              | Last resort when the server cannot produce audio. Cannot be routed to the virtual microphone. |

Voices: Urdu `ur-PK-UzmaNeural`, `ur-PK-AsadNeural`, `ur-IN-GulNeural`, `ur-IN-SalmanNeural`;
German `de-DE-KatjaNeural`, `de-DE-ConradNeural` and others; English multilingual voices.
The list is in `src/server/providers/tts/voices.ts`.

## Changing models

Providers retire models regularly. All ids are configurable in `.env`:

```bash
GEMINI_MODEL=gemini-3.5-flash-lite            # candidates, first preferred
GEMMA_MODEL=gemma-4-31b-it
GROQ_STT_MODELS=whisper-large-v3,whisper-large-v3-turbo
GROQ_MT_MODELS=openai/gpt-oss-120b,qwen/qwen3.8-27b,openai/gpt-oss-20b
```

Gemini providers also carry built-in fallback ids and move to the next one automatically
when Google answers "model not found". For Groq, each listed model becomes its own
provider (id `groq-<model name>`), so a retired model only disables that one entry.

## Choosing which providers are used

```bash
STT_PROVIDERS=groq-whisper-large-v3,groq-whisper-large-v3-turbo   # e.g. never send audio to Google
MT_PROVIDERS=groq-gpt-oss-120b,gemini-flash-lite
TTS_PROVIDERS=azure,edge
```

A list is **exclusive**: only the listed providers are used, in that order. Anything not
listed is never contacted, which is what makes "keep audio away from provider X" or
"translate locally only" a guarantee. Unknown ids are reported when the server starts.
Without a list, all providers are used in their default order. Setting `STT_PROVIDERS` also
switches off the per-language preference (the multimodal recognizer first for Urdu, Whisper
first for German and English).

The Gemini recognizer normally translates in the same call. With an `MT_PROVIDERS` list
that does not contain `gemini-flash-lite` it only transcribes, and the translation is done
by the translators you listed.

The ids are shown in square brackets by `npm run doctor`, and in the list that opens when
you click a status chip in the app.

Note that the keyless MyMemory translator is part of the default chain: when every other
translator fails or is slow, the sentence is sent to it. Leave it out of `MT_PROVIDERS` if
that is not acceptable.

## A fully local translator

Any OpenAI-compatible server works, for example [Ollama](https://ollama.com):

```bash
OPENAI_COMPAT_BASE_URL=http://localhost:11434/v1
OPENAI_COMPAT_MODEL=gemma3:12b
MT_PROVIDERS=custom
```

No key, no quota, and because the list is exclusive nothing leaves the machine for the
translation step. Quality and speed depend on the model and your hardware.

## Paying for it later

The upgrade path needs configuration, not code:

| Step                      | Free now         | Paid upgrade                                     | What you gain                                    |
| ------------------------- | ---------------- | ------------------------------------------------ | ------------------------------------------------ |
| Voice                     | Edge endpoint    | Azure AI Speech (same voices)                    | A supported API, EU regions, no surprise outages |
| Recognition + translation | Gemini free tier | The same key with billing enabled                | Higher limits, paid-tier data terms              |
| Recognition               | Groq free tier   | Groq developer tier                              | Higher limits                                    |
| Translation               | free models      | Any stronger model through the `custom` endpoint | Quality                                          |

## Adding a provider

1. Implement `SttProvider`, `MtProvider` or `TtsProvider` from
   `src/server/providers/types.ts` in its own file. Throw `ProviderError` with the right
   kind; use `httpRequest` from `http.ts` so failures are classified consistently.
2. Construct it in `buildProviders` in `src/server/services.ts`; add its key to
   `KEY_DEFINITIONS` if it needs one.
3. Add tests with an injected `fetch` (see `models.test.ts`).
4. Document it here and in `.env.example`.

Nothing else changes: the chain, the pipeline, diagnostics and the interface pick it up.
