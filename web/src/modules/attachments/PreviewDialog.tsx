// Shows an attached image or PDF in the browser without downloading it (E41-16). The bytes come from
// GET /api/attachments/:id/preview, which serves only those types. An image is drawn from a blob
// address (the page's policy allows blob: images); a PDF is drawn page by page onto canvases by
// pdf.js, loaded only when a PDF is first previewed, so no PDF script, form or plugin ever runs and
// the application's content security policy stays as it is.
import { useEffect, useRef, useState } from 'react';
import { api, Button, ErrorState, errorMessage, Loading, Modal, useToast } from '../../core';
import { downloadAttachment, type Attachment } from './shared';

/** Pages drawn at most; the rest of a longer PDF is in the download. */
const MAX_PAGES = 30;

interface Props {
  attachment: Attachment;
  onClose: () => void;
}

export function PreviewDialog({ attachment, onClose }: Props) {
  const toast = useToast();
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const kind = attachment.preview;

  const download = async () => {
    try { await downloadAttachment(attachment); } catch (err) { toast.error(errorMessage(err)); }
  };

  return (
    <Modal
      open title={`Preview of ${attachment.file_name}`} onClose={onClose} size="lg"
      footer={(
        <>
          <Button onClick={() => void download()} icon="download">Download</Button>
          <Button variant="primary" onClick={onClose}>Close</Button>
        </>
      )}
    >
      {error ? (
        <ErrorState title="The preview could not be shown" error={error} onRetry={() => { setError(null); setAttempt((n) => n + 1); }} />
      ) : kind === 'image' ? (
        <ImagePreview key={attempt} attachment={attachment} onError={setError} />
      ) : kind === 'pdf' ? (
        <PdfPreview key={attempt} attachment={attachment} onError={setError} />
      ) : (
        <p>This kind of file cannot be shown here. Download it instead.</p>
      )}
    </Modal>
  );
}

function ImagePreview({ attachment, onError }: { attachment: Attachment; onError: (e: unknown) => void }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let href: string | null = null;
    let live = true;
    api.blob(`/api/attachments/${attachment.id}/preview`).then((blob) => {
      href = URL.createObjectURL(blob);
      if (live) setSrc(href); else URL.revokeObjectURL(href);
    }, (err) => { if (live) onError(err); });
    return () => { live = false; if (href) URL.revokeObjectURL(href); };
  }, [attachment.id, onError]);
  if (!src) return <Loading label="Loading the image" lines={4} />;
  return (
    <div className="att-preview">
      <img className="att-preview-image" src={src} alt={attachment.description || attachment.file_name} />
    </div>
  );
}

function PdfPreview({ attachment, onError }: { attachment: Attachment; onError: (e: unknown) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ pages: number; shown: number } | null>(null);

  useEffect(() => {
    let live = true;
    let destroy: (() => void) | null = null;
    (async () => {
      const [{ getDocument, GlobalWorkerOptions }, worker] = await Promise.all([
        import('pdfjs-dist'),
        import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
      ]);
      GlobalWorkerOptions.workerSrc = worker.default;
      const data = new Uint8Array(await (await api.blob(`/api/attachments/${attachment.id}/preview`)).arrayBuffer());
      if (!live) return;
      // No scripts in the document, no forms, nothing fetched from elsewhere.
      const task = getDocument({ data, enableXfa: false, disableAutoFetch: true, disableStream: true });
      destroy = () => { void task.destroy(); };
      const doc = await task.promise;
      const shown = Math.min(doc.numPages, MAX_PAGES);
      if (!live || !host.current) return;
      setState({ pages: doc.numPages, shown });
      const width = Math.max(320, host.current.clientWidth - 2);
      const ratio = window.devicePixelRatio || 1;
      for (let n = 1; n <= shown && live; n++) {
        const page = await doc.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: (width / base.width) * ratio });
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / ratio)}px`;
        canvas.className = 'att-preview-page';
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', `Page ${n} of ${doc.numPages}`);
        host.current?.appendChild(canvas);
        await page.render({ canvas, viewport }).promise;
      }
    })().catch((err) => { if (live) onError(err); });
    return () => {
      live = false;
      destroy?.();
      if (host.current) host.current.replaceChildren();
    };
  }, [attachment.id, onError]);

  return (
    <div className="att-preview">
      {!state && <Loading label="Loading the document" lines={4} />}
      {state && state.pages > state.shown && (
        <p className="att-preview-note">Showing the first {state.shown} of {state.pages} pages. Download the file to see the rest.</p>
      )}
      <div ref={host} className="att-preview-pages" />
    </div>
  );
}
