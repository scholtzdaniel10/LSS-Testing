import JSZip from 'jszip';
import type { LocalFileEntry } from './localProjectStore';

/** Build a zip of kept source files for IG-19 upload. */
export async function zipLocalFiles(
  files: LocalFileEntry[],
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  const zip = new JSZip();
  let done = 0;
  const total = files.length;

  for (const file of files) {
    if (file.content) {
      zip.file(file.path, file.content);
    } else {
      // Metadata-only entries: skip content (should be rare for pilot after ingest).
      zip.file(file.path, '');
    }
    done += 1;
    onProgress?.(done, total);
  }

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
