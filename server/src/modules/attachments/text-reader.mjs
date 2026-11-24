// The separate process that reads the text of one attached file (E41-16; S1 of the wave 23
// security review). text.ts starts it with `child_process.fork` for each file, sends the file's
// bytes, and kills it when it takes too long, so a file that makes the reader run away can never
// take the server down with it.
//
// Inside, the reading itself runs in a worker thread (text-worker.mjs) with its own heap limit,
// while this process's main thread stays free to watch the memory of the whole process. A heap
// limit does not cover the buffers a PDF's compressed streams are unpacked into (external memory),
// so the whole process's resident memory is checked every few milliseconds and the process ends
// itself, with a reason, as soon as it passes the cap. Plain JavaScript, so the same file runs under
// the development runner, the tests and the container's Node.
import { Worker } from 'node:worker_threads';

/** The exit code of a reader that ended itself for using too much memory. */
const MEMORY_EXIT = 77;

function finish(result, code = 0) {
  const leave = () => process.exit(code);
  try {
    if (process.connected) process.send(result, leave);
    else leave();
  } catch {
    leave();
  }
  setTimeout(leave, 1000).unref();
}

process.once('message', (job) => {
  const capBytes = Number(job.maxMemoryMb) * 1024 * 1024;
  let done = false;
  const end = (result, code) => { if (!done) { done = true; clearInterval(watch); finish(result, code); } };

  const worker = new Worker(new URL('./text-worker.mjs', import.meta.url), {
    workerData: { bytes: job.bytes, extension: job.extension, maxChars: job.maxChars, maxPages: job.maxPages, maxUnpacked: job.maxUnpacked },
    resourceLimits: { maxOldGenerationSizeMb: 384, maxYoungGenerationSizeMb: 64, stackSizeMb: 8 },
    stdout: true, stderr: true, // pdf.js warnings about damaged files stay out of the log
  });
  worker.stdout.resume();
  worker.stderr.resume();

  const watch = setInterval(() => {
    if (process.memoryUsage.rss() > capBytes) {
      void worker.terminate();
      end({ ok: false, error: 'needed too much memory', stopped: true }, MEMORY_EXIT);
    }
  }, 20);

  worker.once('message', (m) => end(m, 0));
  worker.once('error', (err) => end({ ok: false, error: /memory/i.test(err.message) ? 'needed too much memory' : String(err.message).slice(0, 300), stopped: /memory/i.test(err.message) }, 0));
  worker.once('exit', (code) => end({ ok: false, error: `the reader stopped (${code})`, stopped: true }, 0));
});

// The server went away: nothing to report to.
process.once('disconnect', () => process.exit(0));
