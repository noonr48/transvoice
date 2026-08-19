import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseVoiceTutorSourceHtml } from './standalone-dom';

// Entry-page parity — the guard for the HTML that is actually SERVED.
//
// `preset-parity.test.ts` parses `getVoiceTutorStandaloneTemplateHtml()`, so it
// can only see the template strings under src/voice. It is structurally blind to
// `frontend/voice-tutor.html`, which vite copies to `dist/voice-tutor.html` and
// `server.js` serves at `/`. That blind spot is how a THIRD copy of the retired
// "Masculinizing" option survived two rounds of removal: it was fixed in
// standalone-template.ts and templates/voice-tutor-template.html, and missed on
// the page a visitor to `/` actually loads.
//
// Every list here is READ FROM ITS AUTHORITY rather than restated, for the same
// reason preset-parity reads the DSP: a hardcoded twin keeps passing while the
// two sides drift.
const ENTRY_PAGES = ['voice-tutor.html', 'voice-tutor-app.html'] as const;

function readEntryPage(name: string): string {
  return readFileSync(resolve(process.cwd(), name), 'utf8');
}

/**
 * The learner-profile directions the BACKEND will actually store, read out of
 * `learner-context-service.normalizeDirection`. Anything else it maps to
 * 'unspecified', which is exactly what made the retired "Masculinizing" option
 * a silent discard rather than a visible error.
 */
function readBackendAcceptedDirections(): string[] {
  const source = readFileSync(
    resolve(process.cwd(), '../backend/learner-context-service.js'),
    'utf8',
  );
  const body = source.match(/function normalizeDirection\([\s\S]*?\n\}/);
  if (!body) throw new Error('Could not locate normalizeDirection in learner-context-service.js');
  const list = body[0].match(/\[([^\]]*)\]\s*\.includes\(/);
  if (!list) throw new Error('normalizeDirection no longer uses an .includes() allow-list');
  const ids = Array.from(list[1].matchAll(/'([a-z-]+)'/g)).map((match) => match[1]);
  if (ids.length === 0) throw new Error('Parsed normalizeDirection but found no direction ids');
  return ids;
}

describe('served entry-page parity', () => {
  const RETIRED = /masculin|\bftm\b|masc-/i;

  for (const page of ENTRY_PAGES) {
    it(`${page} offers no retired target or direction anywhere`, () => {
      const html = readEntryPage(page);
      const document_ = parseVoiceTutorSourceHtml(html);
      const options = Array.from(document_.querySelectorAll('option')) as HTMLOptionElement[];
      expect(options.filter((option) => RETIRED.test(option.value)).map((o) => o.value))
        .toEqual([]);
      expect(options.filter((option) => RETIRED.test(option.textContent || ''))
        .map((o) => o.textContent)).toEqual([]);
      // Nothing outside a comment may name a retired id either — a data
      // attribute or an inline script is just as reachable as an <option>.
      // Comments explaining the retirement are the one allowed mention.
      const withoutComments = html.replace(/<!--[\s\S]*?-->/g, '');
      expect(withoutComments.match(RETIRED)?.[0] ?? null).toBeNull();
    });
  }

  it('the learner-profile Direction select offers exactly what the backend stores', () => {
    const document_ = parseVoiceTutorSourceHtml(readEntryPage('voice-tutor.html'));
    const select = document_.getElementById('voice-memory-direction') as HTMLSelectElement | null;
    expect(select).not.toBeNull();

    const values = Array.from(select!.querySelectorAll('option'))
      .map((option) => (option as HTMLOptionElement).value);
    // Set-equal against the backend allow-list, so retiring or adding a direction
    // on either side fails here instead of silently discarding a learner's choice.
    expect([...values].sort()).toEqual([...readBackendAcceptedDirections()].sort());
  });
});
