# Large File Random-Access Seekable Streaming (5 GB to 100 GB+)

## 1. Problem Statement: V8's 4 GiB Buffer Ceiling

In 64-bit Node.js and V8, `Buffer.alloc` and `fs.readFileSync` are constrained by `buffer.constants.MAX_LENGTH`:
$$\text{MAX\_LENGTH} = 2^{32} - 1 \approx 4.29\text{ GB}$$

Attempting to read or allocate a buffer exceeding 4 GiB results in an immediate, uncatchable or fatal exception:
```text
RangeError [ERR_BUFFER_TOO_LARGE]: Cannot create a Buffer larger than 4294967296 bytes
```

Furthermore, prepress production and commercial print shops frequently process 5 GB, 20 GB, or 100 GB files (e.g. 500-page high-resolution PDF catalogs, full-bleed billboards, or multi-gigabyte archival TIFF/PSD files). Loading entire multi-gigabyte files into RAM is both dangerous (triggering Out-Of-Memory termination) and fundamentally unnecessary.

---

## 2. Architecture: Bounded Sliding-Window Random-Access (`SeekableSource`)

Poltergeist solves this via the `SeekableSource` abstraction and `FileSeekableSource` implementation under `src/io/`.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        SeekableSource Interface                         │
│   size: number (supports 64-bit offsets up to exabytes)                │
│   read(offset, length): Promise<Uint8Array>                            │
│   readSync(offset, length): Uint8Array                                 │
│   slice(offset, length): SeekableSource                                │
└───────────────────▲────────────────────────────────▲───────────────────┘
                    │                                │
      ┌─────────────┴──────────────┐   ┌─────────────┴──────────────┐
      │     FileSeekableSource     │   │     HttpSeekableSource     │
      │  (node:fs File Descriptor) │   │  (S3 / HTTP Range Requests)│
      │  • 1 MB Sliding-Window     │   │  • Range: bytes=start-end  │
      │  • O(page) Memory < 50 MB  │   │  • LRU Chunk Cache         │
      │  • Zero heap accumulation  │   │  • Zero full download      │
      └────────────────────────────┘   └────────────────────────────┘
```

### Key Principles

1. **Sliding-Window Cache (1 MB)**:
   Sequential token reads in `PdfLexer` do not trigger an OS syscall per byte. Instead, `FileSeekableSource` buffers up to 1 MB into a sliding window. Sequential reads hit L1 cache in memory (< 5 ns). Non-sequential seeks (e.g. hopping to XRef tables or embedded images) slide the window.
2. **Transparent Array-Like Indexing (`WindowedProxy`)**:
   `createSeekableBytes(source)` wraps `SeekableSource` in a lightweight JavaScript `Proxy`. Parsers and tokenizers can access `bytes[i]` and `bytes.subarray(start, end)` with standard typed array syntax, completely agnostic to whether the backing storage is an in-memory 50 KB buffer or a 100 GB file on disk.
3. **Bounded Memory Footprint**:
   Regardless of whether the source PDF is 500 MB or 50 GB, Poltergeist maintains a fixed peak memory footprint of **under 50 MB RAM** during ingestion.

---

## 3. PDF Ingestion Mechanics: How Poltergeist Reads 5 GB in Milliseconds

PDF is intrinsically a random-access file format:
1. **Trailer & `startxref`**: Located in the last 1–2 KB of the file. Poltergeist reads only the final 2048 bytes of the file, completely ignoring the preceding 5 GB.
2. **XRef Table / XRef Stream**: Parsed into a byte-offset index.
3. **On-Demand Page Resolution**: When page 42 is requested, Poltergeist seeks directly to byte offset `X` in the file descriptor, reads only that page's dictionary and content stream, renders the page, and releases the buffer.

```javascript
import { FileSeekableSource, PdfDecoder, convert } from 'poltergeist';

// Ingest a 50 GB PDF file with < 50 MB RAM
const source = new FileSeekableSource('/mnt/storage/massive_catalog_50gb.pdf');

try {
  // Extract and render only page 14
  const result = convert(source, {
    targetFormat: 'jpeg',
    page: 14,
    dpi: 300
  });
} finally {
  source.close();
}
```
