// Reading a mailbox, whichever way it is reached (E15-06, E14-25): POP3, Microsoft Graph or the
// Gmail API. Email-to-ticket works only with this interface.
import { Pop3, type Pop3Options } from './pop3.ts';

export interface InboundItem {
  /** Position in this listing. */
  number: number;
  /** Stable across sessions, unique across sources ("graph:..." and "gmail:..." for the web interfaces). */
  uid: string;
  /** Size in bytes, or 0 when the source does not say before the message is read. */
  size: number;
  /** The source's own id for the message. */
  ref?: string;
}

export interface InboundMailbox {
  /** Messages waiting: for POP3 every message; for the web interfaces unread messages in the inbox, at most 50. */
  list(): Promise<InboundItem[]>;
  /** The raw message (RFC 5322). */
  retrieve(item: InboundItem, maxBytes?: number): Promise<Buffer>;
  /** Done with: POP3 deletes it; the web interfaces move it to Deleted Items (Graph) or Trash (Gmail), where it can be recovered. */
  delete(item: InboundItem): Promise<void>;
  /** Read and left in the mailbox: the web interfaces mark it read, so it is not listed again. */
  keep?(item: InboundItem): Promise<void>;
  quit(): Promise<void>;
  close(): void;
}

export async function pop3Mailbox(opts: Pop3Options): Promise<InboundMailbox> {
  const box = await Pop3.connect(opts);
  return {
    list: () => box.list(),
    retrieve: (item, maxBytes) => box.retrieve(item.number, maxBytes),
    delete: (item) => box.delete(item.number),
    quit: () => box.quit(),
    close: () => box.close(),
  };
}
