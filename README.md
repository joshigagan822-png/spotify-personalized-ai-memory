# Listening Memory

A Spotify-themed classroom project for listening discovery, playlist preferences and podcast continuation. All 300 listener histories are synthetic. The app uses the supplied Indian music catalog.

[Open the private app](https://listening-memory-lab-gagan.enthusiasticrhino3.chatgpt.site) · [Watch the demo (earlier layout)](docs/walkthrough.mp4) · [Open the executed EDA notebook](analysis/listening_eda.ipynb)

## Run on your laptop

1. Install Node.js 24, then extract the ZIP.
2. Open a terminal in the folder containing package.json and run `npm start`. The app needs no npm dependencies or Spotify account.
3. Open http://127.0.0.1:8000. Each browser gets a separate editable demo workspace.
4. Start with U0001. On Home, choose **View request** in the bottom bar. Open **View source** for the preference that recommended Tum Hi Ho. In **Memory controls**, record a play of Param Sundari, then correct Arijit Singh to Shreya Ghoshal. Run the original request again.
5. Mark an episode irrelevant, remove the preference and inspect its deletion receipt. Pause memory and run another request to see the fallback.
6. Select U0003 for podcast resume at 7:00. U0002 demonstrates playlists and starts in the memory-disabled cohort. Choose **Memory on** for a comparison. U0016 demonstrates sparse history.

![Listening desk with response and source memories](docs/listening-desk.jpg)

## EDA and evidence

The notebook contains seven executed Python cells and three charts. To rerun from this folder with Python 3.12, install `python -m pip install -r analysis/requirements.txt`, then run `python -m jupyterlab analysis/listening_eda.ipynb`. Saved results can also be inspected directly in a notebook viewer.

664 deliveries represent 661 distinct actions after three repeated listener/idempotency keys are removed. 264 of 300 listeners have exactly two actions. The notebook covers event mix, missing fields, activity per listener, surface percentages, delays, confidence and balanced cohorts. Workbook memory annotations and golden answers are evaluation references. Live memory generation starts from events.

| Question | Result |
| --- | --- |
| Did the supplied golden queries return the expected ranking, context, policy and control decisions? | 81/81 cases passed |
| Did the returned facts, timestamps, types, source lineage and relevance reasons match? | 37/37 context records |
| Did the exact confidence numbers match the workbook annotations? | 12/37. The service uses documented deterministic scores. |
| Did the graph, extraction decisions and entity resolution match the measured checks? | 81/81 graph, 147/147 extraction, 113/113 entity checks |
| How many prohibited records reached context? | 0 |
| How many regression and integration tests passed? | 19/19, including all 300 histories and limited Hindi/Hinglish probes |
| What was local HTTP P95 for 50 distinct and 50 repeated queries? | See [measured timings](docs/local-latency.json). No production load was simulated. |

Run `npm run evaluate`, `npm test` and `node scripts/benchmark.js` to reproduce the checks. [Per-case results](docs/quality.json) · [Test log](docs/test-results.txt).

## Backend and frontend

| File | Responsibility |
| --- | --- |
| frontend/app.js | Listening desk, memory controls, golden results, operations and policy views |
| backend/service.js | Durable intake, worker, scoped cache, feedback and trace |
| backend/extraction.js, backend/memory.js | Classify approved events, resolve catalog entities and manage temporal edges |
| backend/catalog.js, backend/retrieval.js | Traverse catalog connections, compute sparse TF–IDF vectors and rerank by relevance, confidence, time, repetition and feedback |
| backend/reply.js | Compose a bounded model input and select a catalog-grounded reply |
| backend/routes.js, backend/contracts.js | HTTP routes, MCP, authentication checks and typed tool schemas |
| backend/store.js, drizzle/0000_pilot.sql | Persist each subject's graph, vectors, queue and receipts under one atomic revision |
| data/listening_memory.xlsx | Original supplied workbook including policy, contracts and golden-case details |

Node.js with SQLite runs locally. The hosted Worker uses D1. The small graph and sparse catalog vectors share a subject document, so a correction can update both atomically. This classroom implementation uses the brief's data model without requiring Neo4j, Kafka and a separate vector service. The four browser profiles replay their synthetic history near the last query date. A moving demo clock keeps the seven-day episode examples reproducible.

Default answers use catalog rules. To run the model integration, serve a local Ollama chat model with structured-output support, copy .env.example to .env, set OLLAMA_URL to http://127.0.0.1:11434 and OLLAMA_MODEL to the installed model name, then restart. The model receives approved choices and a small context package. It cannot write memories or invent catalog IDs. Tests used controlled model responses. No live model weights were available in the verification environment.

[API, deployment and operations](docs/operations.md) · [Hinglish demo and viva notes](docs/viva.md)

## Submission and ownership

The private review URL, source, workflow, schema, workbook, EDA, tests and narrated walkthrough are included. The GitHub repository URL, Google Drive anyone-view link and actual member contribution evidence still belong in the final submission. Supply verified member names, work performed and commit or review evidence here. The archive does not assign contributions to people who have not confirmed them.

Real listener satisfaction, retention uplift, production identity, provider backup rotation and the two-week controlled validation window require separate evidence.
