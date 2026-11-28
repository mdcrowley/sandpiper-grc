import { z } from 'zod';
import { findGuidePage, guidePages, guideText } from './guide.ts';
import { PROMPTS } from './prompts.ts';
import { fail, type ToolSpec } from './toolkit.ts';

// The user guide and the ready-made prompts as tools (E18-97): some MCP clients (Claude Desktop among
// them) offer an assistant the server's tools but not its prompts or resources. These two give the
// same text: read_guide the sandpiper://guide/<page> resources, get_prompt the prompts of prompts.ts.
// Read only, always offered.

const MAX_CHARS = 200_000;

const readGuide: ToolSpec = {
  name: 'read_guide', title: 'Read the user guide', group: 'Records', idempotent: true,
  description: 'The Sandpiper GRC user guide, for clients that cannot read MCP resources. Without a page: the list of pages (title and page name). '
    + 'With a page (its name such as "21-ai-assistants-and-mcp", the name without the number, the number or the title): that page in Markdown, '
    + 'the same text as the resource sandpiper://guide/<page>.',
  input: {
    page: z.string().max(200).optional().describe('The page: its name (e.g. "09-administration"), its number (e.g. "9") or its title. Leave out for the list of pages.'),
  },
  async run(args) {
    const pages = guidePages();
    if (!args.page) {
      return {
        text: pages.length
          ? `${pages.length} pages in the user guide. Read one with read_guide and its page name:\n${pages.map((p) => `- ${p.slug}: ${p.title}`).join('\n')}`
          : 'The user guide is not part of this installation.',
        data: { pages: pages.map((p) => ({ page: p.slug, title: p.title, uri: `sandpiper://guide/${p.slug}` })) },
      };
    }
    const page = findGuidePage(args.page);
    if (!page) fail(`There is no user guide page "${args.page}". Call read_guide without a page for the list.`, 'not_found');
    const text = guideText(page!);
    const clipped = text.length > MAX_CHARS;
    return {
      text: clipped ? `${text.slice(0, MAX_CHARS)}\n…` : text,
      data: { page: page!.slug, title: page!.title, uri: `sandpiper://guide/${page!.slug}`, characters: text.length, truncated: clipped },
    };
  },
};

const getPrompt: ToolSpec = {
  name: 'get_prompt', title: 'Get a ready-made prompt', group: 'Records', idempotent: true,
  description: 'The ready-made requests this server offers as MCP prompts, for clients that cannot use prompts. Without a name: the list of prompts with their arguments. '
    + 'With a name (such as "load_records_from_sources" or "load_document_package"): the prompt\'s text with the arguments you give filled in; then follow it as if I had asked it.',
  input: {
    name: z.string().max(100).optional().describe('The prompt\'s name, e.g. "load_records_from_sources". Leave out for the list.'),
    args: z.record(z.string(), z.string()).optional().describe('The prompt\'s arguments by name, e.g. {"record_type": "vendor", "sources": "the vendor list spreadsheet"}.'),
  },
  async run(args) {
    if (!args.name) {
      return {
        text: `${PROMPTS.length} ready-made prompts. Get one with get_prompt and its name:\n${PROMPTS.map((p) => `- ${p.name}: ${p.description}${Object.keys(p.args).length ? ` Arguments: ${Object.entries(p.args).map(([k, d]) => `${k} (${d})`).join('; ')}` : ''}`).join('\n')}`,
        data: { prompts: PROMPTS.map((p) => ({ name: p.name, title: p.title, description: p.description, args: p.args })) },
      };
    }
    const wanted = String(args.name).trim().toLowerCase();
    const p = PROMPTS.find((x) => x.name === wanted || x.title.toLowerCase() === wanted);
    if (!p) fail(`There is no prompt "${args.name}". Call get_prompt without a name for the list: ${PROMPTS.map((x) => x.name).join(', ')}.`, 'not_found');
    const given = (args.args ?? {}) as Record<string, string>;
    const unknown = Object.keys(given).filter((k) => !(k in p!.args));
    if (unknown.length) fail(`The prompt ${p!.name} has no argument ${unknown.join(', ')}. Its arguments: ${Object.keys(p!.args).join(', ') || 'none'}.`, 'validation');
    const text = p!.text(Object.fromEntries(Object.keys(p!.args).map((k) => [k, given[k]?.trim() || undefined])));
    return { text, data: { name: p!.name, title: p!.title, description: p!.description, args: given, text } };
  },
};

export const GUIDE_TOOLS: ToolSpec[] = [readGuide, getPrompt];
