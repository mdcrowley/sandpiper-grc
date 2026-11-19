// Copyable request examples for one operation of the API reference: curl and PowerShell, with a
// token placeholder (never a real token). Read-only documentation: nothing here sends a request.
import { useState } from 'react';
import { Button } from '../../core';
import { examples, type ExampleOperation, type ExampleSchema } from './exampleRequests';

function CopyBlock({ label, code }: { label: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="api-example">
      <div className="api-example-head">
        <span className="api-example-label">{label}</span>
        <Button size="sm" variant="ghost" icon={copied ? 'check' : 'clipboard'} onClick={copy} aria-label={`Copy the ${label} example`}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <pre className="api-snippet" tabIndex={0} aria-label={`${label} example`}><code>{code}</code></pre>
    </div>
  );
}

export default function ApiExamples({ method, path, op, schemas }: { method: string; path: string; op: ExampleOperation; schemas: Record<string, ExampleSchema> | undefined }) {
  const { curl, powershell } = examples(method, path, op, schemas, window.location.origin);
  return (
    <section>
      <h4>Examples</h4>
      <p className="muted api-example-note">
        Set <code>GRC_TOKEN</code> to a personal API token first. Replace the parts in braces, such as <code>{'{id}'}</code>.
        These are examples to copy: this page does not send requests.
      </p>
      <div className="api-examples">
        <CopyBlock label="curl" code={curl} />
        <CopyBlock label="PowerShell" code={powershell} />
      </div>
    </section>
  );
}
