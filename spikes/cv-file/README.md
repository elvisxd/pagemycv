# CV-file spikes: reading a PDF or a Word file before writing the code that does

The importer read Markdown, and nobody has a CV in Markdown: they have a PDF
or a Word document. Three things had to be measured before building the file
import, because each one would have shaped the design differently had it
come out the other way.

## `pdf-rows.mjs` — what pdf.js gives back, read by line

pdf.js returns positioned runs of text, not lines. The obvious reconstruction
— group runs by their baseline, sort top to bottom — works on a one-column CV
and produces exactly the text a person reads. On a **two-column** CV it
interleaves the columns line by line:

```
elvis@example.testMarzo 2023 – Actualidad
Teléfono: +58 412 555 0199Automatización de procesos con microservicios.
linkedin.com/in/elvisreyDesarrollador Backend — Banco Ficticio, Caracas
```

No parser recovers from that, and two-column templates are the common case
for a designed CV.

## `pdf-columns.mjs` — a gutter nobody's text crosses

Before grouping by line, look for a vertical position between 20% and 80% of
the page width that **no run of text spans**, with at least 15% of the page's
runs on each side. If one exists, read everything left of it top to bottom,
then everything right of it. Measured on the same two files:

| file | columns found | result |
|---|---|---|
| `cv/one-col.pdf` | 1 | identical to the by-line reading |
| `cv/two-col.pdf` | 2 | left column whole, then right column whole, each in order |

The one-column case staying at one column is the half that matters: a split
that fired on a wide table or a right-aligned date would break the simple
CVs to help the designed ones. This rule is `splitColumns` in
`src/import/pdf-text.ts`.

## `docx-native.mjs` — a Word file without a dependency

A `.docx` is a zip holding `word/document.xml`. Chrome has a zip inflater
(`DecompressionStream('deflate-raw')`) and an XML parser (`DOMParser`), so
the question was only whether they are enough. The probe walks the zip's
central directory, inflates the one entry, and reads paragraphs. Against a
hand-built file with Word heading styles and runs **split mid-word** (what
Word leaves behind after edits), every paragraph came out whole and every
heading style was visible:

```
Title         | Ada M. Lovelace
Heading1      | Experience
              | Founder & Full-Stack Developer, Nesty C.A. — Remote
ListParagraph | Founded a consultancy focused on automation and API integration.
```

Table cells come out cell by cell, which puts a two-column Word CV's columns
in reading order without any of the geometry the PDF path needs. This is
`src/import/docx-text.ts`, and it costs nothing in the dependency table.

## `make-pdfs.cjs` — where the sample PDFs come from

LibreOffice is installed in this container but cannot load HTML (every
conversion fails with *source file could not be loaded*), so the sample PDFs
are printed from `cv/*.html` by the same Chromium the gate runs. The gate
does the same at run time rather than committing binaries. The sample
`.docx` is built by hand, zip entry by zip entry, for the same reason.

## What was not measured here

- **pdf.js inside the extension page.** Node ran these probes. Whether the
  bundled worker starts under the extension's content security policy is
  measured by the gate uploading a real PDF through the panel, which is the
  only place that can be measured.
- **A Word file made by Word.** The hand-built file follows the format;
  Word's own output has more parts (styles, numbering, settings) and the
  reader ignores all of them by construction. One real file from Elvis is the
  test that closes this.
- **Accuracy on CVs this was not written against.** Two samples calibrate
  the heuristics; they do not prove them. That is why nothing the reader
  returns is stored without being shown first.
