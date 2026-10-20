# rsl-blockchain-pqc

Password-protected viewer for the results of a systematic literature review on
blockchain-based decentralized architectures for securing legacy systems in the
post-quantum era.

Static site hosted on GitHub Pages. The data is encrypted (AES-256-GCM, key derived
with PBKDF2-SHA256, 1,000,000 iterations) in `data/studies.enc` and is only decrypted
in the browser of whoever types the password. The UI is in Brazilian Portuguese; the
code is in English.

## Layout

| Path                               | Purpose                                                                    |
| ---------------------------------- | -------------------------------------------------------------------------- |
| `index.html`, `assets/`            | The page, styles and the obfuscated bundle                                 |
| `data/studies.enc`                 | Encrypted data (versioned)                                                 |
| `scripts/`                         | Encryption, build, dev server, test runner                                 |
| `tools/`                           | Parsifal extraction and LLM audit (see below); outputs are gitignored      |
| `test/`                            | Tests (`node:test`)                                                        |
| `.githooks/`                       | `pre-commit` (blocks sensitive files, runs tests) and `pre-push`           |
| `Dockerfile`, `docker-compose.yml` | One environment for dev, tests and CI                                      |
| `src/`, `raw/`, `deliverables/`    | Original source, plaintext data, PDFs/DOCX. Never committed (`.gitignore`) |

## Audit pipeline

`tools/` reads the review's accepted articles from Parsifal, has an LLM re-judge each
abstract against the protocol criteria, and writes `raw/approved.json` + `raw/rejected.json`.
It only issues GETs to Parsifal: nothing is ever modified there, and the triage changes stay
manual. Secrets live in `.env` (gitignored): `PARSIFAL_SESSION`, `GROQ_API_KEY`,
`GEMINI_API_KEY`, `DATA_PASSWORD`.

```bash
npm run extrair   # GET accepted articles -> tools/artigos.json
npm run avaliar   # LLM audit -> tools/cache.json + raw/approved.json + raw/rejected.json
LIMIT=5 npm run avaliar   # smoke test: only the next 5
```

The audit uses Groq first (1000 req/min, high quota) and falls back to Gemini models when a
provider runs out of quota. Results are cached per article, so re-running only evaluates what
is new, and the site's "Reprovados" tab plus the "Só divergentes" filter list exactly the
articles that are `Accepted` in Parsifal but rejected by the audit — the manual review queue.

The Parsifal session cookie expires every few weeks; when it does, copy a fresh `sessionid`
from your browser's devtools (Network → parsif.al → Cookies) into `.env`.

## Development

Everything runs in the same container CI uses:

```bash
npm install            # activates the git hooks (core.hooksPath)
npm run docker:test    # format check (Prettier) + tests
npm run docker:dev     # http://localhost:8000
npm run docker:build   # obfuscated bundle -> assets/js/app.js
npm run docker:package # dist/ for Pages, fails if plaintext data is in it
npm run docker:encrypt # data/studies.enc from raw/*.json
```

Format with `npm run format`. Without Docker, `npm run check`, `npm test`, `npm run dev`, `npm run build` and `npm run encrypt` run on
local Node (>= 20). Tests that need `src/` are skipped when it is absent, as in CI.

To change the code, edit `src/` and run the build. Back up `src/`: it is the only editable copy.

## Data

`raw/approved.json` and `raw/rejected.json` hold the plaintext studies. To update the data or
change the password:

```bash
npm run docker:encrypt   # prompts for the password (min. 16 characters)
git add data/studies.enc
git commit -m "Update data"
git push
```

## Publishing

1. Create an empty repository on GitHub (no README, `.gitignore` or license).
2. Connect and push:
   ```bash
   git remote add origin git@github.com:<user>/rsl-blockchain-pqc.git
   git push -u origin main --follow-tags
   ```
3. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
4. If the first run happened before step 3, re-run it: Actions → _Deploy GitHub Pages_ → Run workflow.
5. Open `https://<user>.github.io/rsl-blockchain-pqc/` and enter the password.

The workflow builds the project image (cached), runs the format check and the tests in it, then
assembles `dist/` in the same container (only `index.html`, `assets/` and `data/`) and fails if any
plaintext study data ends up there. CI and local development use the same image.

## Security limits

The encrypted file is public, so protection rests on the password: use a long random
passphrase and keep it in a password manager. Anyone with the password can copy the data, and an
old password keeps opening old copies of the file. Obfuscating the JavaScript slows down reading it
but is not a security boundary; the encryption is.
