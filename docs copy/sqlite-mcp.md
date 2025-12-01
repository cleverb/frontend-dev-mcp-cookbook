# MCP & SQLite

It’s not hard at all to use `sqlite-vec` **without** the OpenAI API — you just need *some* way to turn text into vectors. The OpenAI bit in that tutorial is just one example, not a requirement.

Let me break it into:

1. **What sqlite-vec actually expects**
2. **Alternatives to OpenAI embeddings**
3. **How hard it is in practice (for your stack)**
4. **How this plugs into your Chirp MCP idea**

---

## 1. What sqlite-vec actually cares about

`sqlite-vec` is *just* a SQLite extension for storing and querying vectors. From its perspective, an embedding is:

* a fixed-length list of numbers (float32, int8, etc.) that you insert into a `vec0` virtual table,
* then you query with `... WHERE embedding MATCH ... ORDER BY distance LIMIT k`.

It doesn’t care *where* those vectors came from. OpenAI, HF, a tiny local model, random noise (please don’t) — it’s all the same at the DB layer.

So the pipeline is:

1. **Text → vector** (your job, using *any* model)
2. **Vector → sqlite-vec** (SQL `INSERT` with JSON or binary)

The EdIzaguirre / stephenc222 tutorials show OpenAI simply because it’s convenient for a demo, not because sqlite-vec is tied to it.

---

## 2. Non-OpenAI options for embeddings

You’ve got several “no OpenAI API” routes:

### a) Local / browser-friendly models (JS/TS friendly)

* **Xenova Transformers** (runs in Node or browser):
  Example: `Xenova/gte-base` or `all-MiniLM-L6-v2`.
  The sqlite-vec job-matching tutorial does exactly this: use Xenova locally, then store the vectors in SQLite.

Rough JS flow:

```ts
// pseudo-code
import { pipeline } from "@xenova/transformers";
const embed = await pipeline("feature-extraction", "Xenova/gte-base");

// 1. Turn text into embedding
const output = await embed("Some Storybook doc text", { pooling: "mean", normalize: true });
// output.data is a Float32Array or number[]

// 2. Insert into sqlite-vec as JSON (or binary)
db.run(
  `INSERT INTO doc_embeddings(rowid, embedding) VALUES (?, json(?))`,
  [docId, JSON.stringify(Array.from(output.data))]
);
```

You’ll then query with:

```sql
SELECT rowid, distance
FROM doc_embeddings
WHERE embedding MATCH '[0.123, -0.456, ...]'
ORDER BY distance
LIMIT 5;
```

### b) Local Python models

If you’re okay doing indexing in Python (CI pipeline):

* SentenceTransformers (`all-mpnet-base-v2`, MiniLM, etc.)
* Or HF `text-embedding` models

Then serialize vectors as JSON or binary (sqlite-vec supports both).

### c) Other local JS options

* TensorFlow.js with Universal Sentence Encoder – there’s even an older article with sqlite-vss showing this pattern; the same idea ports to sqlite-vec.

Bottom line: **any model that gives you a `Float32Array`/`number[]` is enough**.

---

## 3. How difficult is it really?

If you zoom in on “developer calories,” there are two pieces:

### A. One-time setup complexity

* Install `sqlite-vec` (via bindings or loading extension)
* Create your vector table, e.g.:

```sql
CREATE VIRTUAL TABLE doc_embeddings
USING vec0(
  embedding FLOAT[768]  -- match your model dimension
);
```

* Decide on embedding model + dimension
* Build a small script that:

  1. walks Storybook/Markdown content,
  2. chunks it,
  3. calls *your* embedding function (local model),
  4. inserts into SQLite.

This is all pretty standard RAG plumbing. The sqlite-vec specifics are just a handful of SQL statements.

### B. Per-run / per-doc work

Once you’ve got your embedding pipeline:

* Adding new docs = run the script in CI (or locally) → updates the `.sqlite` file.
* No OpenAI calls needed; everything is local.

Difficulty-wise, for someone already thinking about MCPs and RAG, I’d rate it as:

> **“Weekend spike” level** to get from zero to:
> *“I can semantically search a handful of docs via sqlite-vec using a local embedding model.”*

The EdIzaguirre / stephenc222 tutorials basically give you an almost-complete reference for the SQLite / vec side; you’re mostly swapping out “call OpenAI embeddings” for “call Xenova / sentence-transformers”.

---

## 4. How this maps to your Chirp MCP idea

For your **Chirp Docs / Storybook / Markdown MCP**:

1. **Indexing step (no OpenAI):**

   * Use Xenova (Node) or Python sentence-transformers in CI.
   * Generate embeddings for each chunk.
   * Insert into sqlite-vec.
   * Emit `chirp-docs.sqlite` as part of the build.

2. **Runtime MCP (totally API-free if you want):**

   * Either:

     * The *caller* (ChatGPT / orchestrator) generates the query embedding and passes that vector into the MCP (so MCP only does vector search), **or**
     * MCP itself uses the same local model for query embeddings.

3. **No OpenAI involvement required anywhere in that flow.**

So: **difficulty is low-to-moderate** (mostly standard embedding plumbing), and there is zero hard dependency on OpenAI. sqlite-vec is happily agnostic; it just wants floats.

If you’d like, I can sketch a concrete **TypeScript CLI script** that:

* loads a local embedding model (Xenova),
* walks a simple `docs/` folder of Markdown,
* builds a `docs.sqlite` with sqlite-vec,
* and is ready to be bundled with an `npx`-style MCP.
