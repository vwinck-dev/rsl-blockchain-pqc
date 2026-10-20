// Extrai do Parsifal os artigos ja aceitos da review, via endpoints GET (leitura pura).
// Nada e escrito no Parsifal: este script so faz GET e grava tools/artigos.json local.
//
// shortcut: a sessao vem de PARSIFAL_SESSION no .env (cookie sessionid do seu navegador);
// quando expirar (semanas), copie de novo via devtools > Rede > parsif.al > Cookies.
// upgrade: migrar para login persistente em Playwright quando isso virar problema.
import { writeFile } from "node:fs/promises";

const BASE = "https://parsif.al";
const REVIEW_ID = "77708";
const OUT = new URL("./artigos.json", import.meta.url);
const CONCURRENCY = 4;

try {
  process.loadEnvFile(new URL("../.env", import.meta.url));
} catch {
  // .env opcional: as variaveis podem vir do ambiente.
}

const SESSION = process.env.PARSIFAL_SESSION;
if (!SESSION) {
  console.error(
    "Falta PARSIFAL_SESSION no .env (cookie sessionid do Parsifal).",
  );
  process.exit(1);
}

const STATUS = {
  A: "Accepted",
  R: "Rejected",
  U: "Unclassified",
  D: "Duplicated",
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const decode = (text) =>
  String(text ?? "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCodePoint(parseInt(n, 16)),
    )
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
const stripTags = (html) => decode(String(html).replace(/<[^>]*>/g, ""));
// O Parsifal grava a string "None" quando o campo esta vazio.
const vazio = (value) => (value === "None" ? "" : value);

// Guarda de leitura: so existem GETs daqui, sempre para o parsif.al.
async function get(path, { xhr = false, retries = 2 } = {}) {
  const url = new URL(path, BASE);
  if (url.origin !== BASE)
    throw new Error(`bloqueado: origem fora de parsif.al (${url})`);
  const headers = { cookie: `sessionid=${SESSION}` };
  if (xhr) headers["x-requested-with"] = "XMLHttpRequest";
  let res;
  for (let attempt = 0; ; attempt--) {
    res = await fetch(url, {
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status < 500 || attempt >= retries) break;
    await sleep(1000 * (attempt + 1));
  }
  if (res.status >= 300 && res.status < 400) {
    throw new Error(
      "sessao expirada (redirect). Atualize PARSIFAL_SESSION no .env.",
    );
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url.pathname}`);
  return res.text();
}

function parseRows(html) {
  const rows = [];
  const rowRe = /<tr oid="(\d+)" article-status="([ARUD])">([\s\S]*?)<\/tr>/g;
  for (const [, oid, statusCode, body] of html.matchAll(rowRe)) {
    const tds = [...body.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) =>
      stripTags(m[1]),
    );
    rows.push({
      oid,
      status: STATUS[statusCode],
      status_parsifal: STATUS[statusCode],
      title: tds[2] ?? "",
      authors: tds[3] ?? "",
      journal: tds[4] ?? "",
      year: tds[5] ?? "",
    });
  }
  return rows;
}

function input(html, name) {
  const tag =
    html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0] ?? "";
  const value = vazio(decode(tag.match(/value="([^"]*)"/)?.[1] ?? ""));
  // DOI costuma vir sem esquema ("10.1109/..."); sem isso o link vira caminho
  // relativo no site. URL ja chega completa.
  return name === "doi" && value && !/^https?:\/\//i.test(value)
    ? `https://doi.org/${value}`
    : value;
}

function textarea(html, name) {
  const m = html.match(
    new RegExp(`<textarea[^>]*name="${name}"[^>]*>([\\s\\S]*?)</textarea>`),
  );
  return m ? vazio(decode(m[1])) : "";
}

function select(html, name) {
  return (
    html.match(
      new RegExp(`<select[^>]*name="${name}"[^>]*>([\\s\\S]*?)</select>`),
    )?.[1] ?? ""
  );
}

function criteriaCatalog(html) {
  const block = select(html, "selection_criteria");
  const catalog = { inclusao: [], exclusao: [] };
  const groupRe = /<optgroup label="([^"]+)">([\s\S]*?)<\/optgroup>/g;
  for (const [, label, body] of block.matchAll(groupRe)) {
    const target = /inclusion/i.test(label)
      ? catalog.inclusao
      : catalog.exclusao;
    for (const [, id, text] of body.matchAll(
      /<option value="(\d+)">([^<]*)<\/option>/g,
    )) {
      target.push({ id: Number(id), texto: decode(text) });
    }
  }
  return catalog;
}

function parseDetail(html) {
  const criteriaBlock = select(html, "selection_criteria");
  const chosen = criteriaBlock.match(
    /<option value="(\d+)" selected>([^<]*)<\/option>/,
  );
  let criterio = null;
  if (chosen) {
    const groups = [
      ...criteriaBlock
        .slice(0, chosen.index)
        .matchAll(/<optgroup label="([^"]+)">/g),
    ];
    criterio = {
      id: Number(chosen[1]),
      tipo: groups.length ? groups[groups.length - 1][1] : null,
      texto: decode(chosen[2]),
    };
  }
  const statusCode = select(html, "status").match(
    /<option value="([ARUD])" selected>/,
  )?.[1];
  return {
    status: STATUS[statusCode] ?? null,
    criterio,
    title: input(html, "title"),
    authors: input(html, "author"),
    journal: input(html, "journal"),
    year: input(html, "year"),
    keywords: input(html, "keywords"),
    doi: input(html, "doi"),
    url: input(html, "url"),
    abstract: textarea(html, "abstract"),
    motivo_parsifal: textarea(html, "comments"),
  };
}

async function mapPool(items, limit, worker) {
  const results = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await worker(items[index], index);
      }
    }),
  );
  return results;
}

const studiesPage = await get(
  "/Lima.Lavinia/arquiteturas-descentralizadas-baseadas-em-blockchain-para-seguranca-de-sistemas-legados-na-era-pos-quantica/conducting/studies/",
);
if (!studiesPage.includes("logout")) {
  console.error(
    "Sessao invalida: a pagina veio deslogada. Atualize PARSIFAL_SESSION no .env.",
  );
  process.exit(1);
}

const rowsHtml = await get(
  `/reviews/conducting/source_articles/?review-id=${REVIEW_ID}&source-id=None`,
  { xhr: true },
);
const rows = parseRows(rowsHtml);
const accepted = rows.filter((row) => row.status === "Accepted");
console.log(`Artigos na review: ${rows.length} · Accepted: ${accepted.length}`);

let done = 0;
const artigos = await mapPool(accepted, CONCURRENCY, async (row) => {
  const detailHtml = await get(
    `/reviews/conducting/article_details/?review-id=${REVIEW_ID}&article-id=${row.oid}`,
    { xhr: true },
  );
  const detail = parseDetail(detailHtml);
  done++;
  if (done % 50 === 0 || done === accepted.length) {
    console.log(`  ${done}/${accepted.length} artigos lidos`);
  }
  if (detail.status && detail.status !== "Accepted") {
    console.warn(
      `  ! ${row.oid} mudou de status (${detail.status}) — mantendo o visto na lista`,
    );
  }
  return { ...row, ...detail, oid: row.oid };
});

const catalog = criteriaCatalog(
  await get(
    `/reviews/conducting/article_details/?review-id=${REVIEW_ID}&article-id=${accepted[0].oid}`,
    { xhr: true },
  ),
);

const payload = {
  review_id: Number(REVIEW_ID),
  extraido_em: new Date().toISOString(),
  total_na_review: rows.length,
  aceitos: artigos.length,
  criterios_parsifal: catalog,
  artigos,
};
await writeFile(OUT, JSON.stringify(payload, null, 2));
console.log(`OK: ${artigos.length} artigos em ${OUT.pathname}`);
