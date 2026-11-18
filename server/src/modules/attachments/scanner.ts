// The malware-scanning hook. Every file is offered to the registered scanner after it has
// been received and before it is accepted. Nothing is built in: the default records that the
// file was not scanned.
//
// To plug a scanner in, write a module (or extend one) that registers it at start-up:
//
//   async register(ctx) {
//     ctx.app.addHook('onReady', async () => {
//       if (!ctx.app.hasDecorator('fileScanner')) return;        // attachments module not loaded
//       ctx.app.fileScanner.use({
//         name: 'my-scanner',
//         async scan(file) {
//           const stream = await file.open();                    // the stored bytes
//           // ...hand the stream to the scanning engine...
//           return { verdict: 'clean' };                         // or 'infected', or 'error'
//         },
//       });
//     });
//   }
//
// Verdicts: `clean` accepts the file and records the engine and time; `infected` refuses it,
// removes the stored bytes and writes an audit event; `error` (or a thrown error) refuses it
// too, because a file that could not be checked is not accepted while a scanner is installed.
// A scanner that calls an outside service breaks the prototype's "no outbound connections"
// rule: use an engine that runs on the same machine.
import type { Readable } from 'node:stream';

export interface ScanInput {
  /** Sanitised display name. */
  fileName: string;
  extension: string;
  size: number;
  sha256: string;
  /** Opens a fresh stream of the stored bytes. May be called more than once. */
  open(): Promise<Readable>;
}

export interface ScanResult {
  verdict: 'clean' | 'infected' | 'error' | 'not_scanned';
  /** For the audit log: the signature name, or why the scan failed. Never shown to the uploader. */
  detail?: string;
}

export interface FileScanner {
  /** Recorded with each accepted file as the engine that checked it. */
  name: string;
  scan(file: ScanInput): Promise<ScanResult>;
}

export interface ScannerRegistry {
  /** Installs the scanner used for every later upload, replacing any earlier one. */
  use(scanner: FileScanner): void;
  /** Goes back to the built-in "not scanned" behaviour. */
  reset(): void;
  current(): FileScanner;
}

/** The default: accepts the file and says honestly that nothing looked at it. */
export const noScanner: FileScanner = {
  name: 'none',
  async scan() {
    return { verdict: 'not_scanned' };
  },
};

export function makeScannerRegistry(): ScannerRegistry {
  let active: FileScanner = noScanner;
  return {
    use(scanner) {
      if (!scanner || typeof scanner.scan !== 'function' || !scanner.name) throw new Error('A file scanner needs a name and a scan function');
      active = scanner;
    },
    reset() {
      active = noScanner;
    },
    current: () => active,
  };
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Present when the attachments module is loaded. See server/src/modules/attachments/scanner.ts. */
    fileScanner: ScannerRegistry;
  }
}
