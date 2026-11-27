// The separate process for one board book job (wave 25): reading or appending PDF papers.
// book-sandbox.ts starts it with `child_process.fork`, sends the job and kills it when it takes too
// long. The work runs in a worker thread (book-worker.mjs) with its own heap limit, while this
// process's main thread watches the memory of the whole process and ends it, with a reason, once it
// passes the cap. The same pattern as the document library's sandbox (policies/convert).
import { Worker } from 'node:worker_threads';

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

  const worker = new Worker(new URL('./book-worker.mjs', import.meta.url), {
    workerData: { task: job.task, payload: job.payload },
    resourceLimits: { maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 64, stackSizeMb: 8 },
    stdout: true, stderr: true, // library warnings about damaged files stay out of the log
  });
  worker.stdout.resume();
  worker.stderr.resume();

  const watch = setInterval(() => {
    if (process.memoryUsage.rss() > capBytes) {
      void worker.terminate();
      end({ ok: false, error: 'needed too much memory', code: 'memory', stopped: true }, MEMORY_EXIT);
    }
  }, 20);

  worker.once('message', (m) => end(m, 0));
  worker.once('error', (err) => end({ ok: false, error: /memory/i.test(err.message) ? 'needed too much memory' : String(err.message).slice(0, 300), code: /memory/i.test(err.message) ? 'memory' : null, stopped: /memory/i.test(err.message) }, 0));
  worker.once('exit', (code) => end({ ok: false, error: `the book maker stopped (${code})`, stopped: true }, 0));
});

process.once('disconnect', () => process.exit(0));
