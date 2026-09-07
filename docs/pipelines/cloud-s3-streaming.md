# Cloud S3 & HTTP Range Stream Ingestion Protocol

## 1. Overview

Traditional document converters and Ghostscript require downloading entire files to local scratch disk before processing can commence. For a 5 GB print-ready PDF stored on Amazon S3 or Google Cloud Storage, downloading 5 GB over a 100 Mbps link introduces a **7-minute blocking latency** and consumes 5 GB of local disk space.

Poltergeist eliminates downloading entirely via **HTTP byte-range streaming (`HttpSeekableSource`)**:
- Uses standard RFC 7233 / RFC 9110 HTTP Range headers (`Range: bytes=start-end`).
- Employs suffix byte-range prefetch (`Range: bytes=-4096`) to retrieve the PDF trailer and `startxref` in a single initial RTT.
- Caches accessed chunks with an in-memory LRU cache.
- Delivers a single-page proof from a 5 GB remote file in **under 200 ms** using less than **5 MB of network bandwidth**.

---

## 2. Streaming Sequence Diagram

```
Poltergeist Main Thread             HttpSeekableSource                     Amazon S3 / HTTP CDN
         │                                   │                                      │
         │─── new HttpSeekableSource(url) ──>│                                      │
         │                                   │─── GET (Range: bytes=0-1023) ───────>│
         │                                   │<── 206 Partial Content (Total Size) ─│
         │                                   │                                      │
         │                                   │─── GET (Range: bytes=-4096) ────────>│
         │                                   │<── 206 Partial Content (Trailer/Xref)│
         │<── Ready (Source opened) ─────────│                                      │
         │                                   │                                      │
         │─── convert(source, {page: 1}) ───>│                                      │
         │                                   │─── GET (Range: bytes=X-Y Page 1) ───>│
         │                                   │<── 206 Partial Content ──────────────│
         │<── Rendered Page Proof ───────────│                                      │
```

---

## 3. Supported Cloud Storage Services

The HTTP Range protocol is supported out-of-the-box by all major cloud object stores and CDNs:
- **Amazon S3**: Standard S3 URLs, Pre-signed URLs, CloudFront distributions.
- **Google Cloud Storage (GCS)**: Signed URLs and public buckets.
- **Microsoft Azure Blob Storage**: Blob URLs with SAS tokens.
- **Cloudflare R2**: Range request enabled endpoints.
- **Any RFC 7233 compliant web server** (Nginx, Apache, Caddy).

---

## 4. Programmatic API & CLI Usage

### CLI Usage
```bash
# Render page 1 directly from a remote S3 URL without local file download
poltergeist -i "https://my-bucket.s3.amazonaws.com/massive_catalog.pdf" -o page_1.jpg --page 1 -f jpeg
```

### Node.js Programmatic API
```javascript
import { HttpSeekableSource, convert } from 'poltergeist';

// Initialize HTTP stream
const source = await HttpSeekableSource.create('https://my-bucket.s3.amazonaws.com/massive_catalog.pdf', {
  chunkSize: 256 * 1024, // 256 KB chunk size
  maxCachedChunks: 64     // 16 MB max cache
});

try {
  const proof = convert(source, {
    targetFormat: 'jpeg',
    page: 1,
    dpi: 150
  });
  console.log(`Generated proof (${proof.length} bytes) with zero full file download!`);
} finally {
  await source.close();
}
```
