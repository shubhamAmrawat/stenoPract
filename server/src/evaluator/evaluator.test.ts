import { describe, expect, it } from 'vitest';
import { evaluate } from './index.js';

const kinds = (r: ReturnType<typeof evaluate>) => r.mistakes.map((m) => m.kind).sort();

describe('evaluate: perfect and trivial cases', () => {
  it('identical text has no mistakes', () => {
    const r = evaluate('The Minister said that the work is done.', 'The Minister said that the work is done.');
    expect(r.full).toBe(0);
    expect(r.half).toBe(0);
    expect(r.errorPct).toBe(0);
    expect(r.masterWords).toBe(8);
  });

  it('ignores extra spaces and line breaks', () => {
    const r = evaluate('The work is done.', '  The   work\n is\tdone.  ');
    expect(r.errorPct).toBe(0);
  });

  it('empty attempt = every word omitted', () => {
    const r = evaluate('one two three four', '');
    expect(r.full).toBe(4);
    expect(r.errorPct).toBe(100);
    expect(kinds(r)).toEqual(['omission', 'omission', 'omission', 'omission']);
  });
});

describe('full mistakes', () => {
  it('omission', () => {
    const r = evaluate('The quick brown fox jumps.', 'The quick fox jumps.');
    expect(r.full).toBe(1);
    expect(r.half).toBe(0);
    expect(r.mistakes[0]).toMatchObject({ kind: 'omission', master: 'brown' });
  });

  it('addition', () => {
    const r = evaluate('The quick fox jumps.', 'The quick brown fox jumps.');
    expect(r.full).toBe(1);
    expect(r.mistakes[0]).toMatchObject({ kind: 'addition', attempt: 'brown' });
  });

  it('repetition', () => {
    const r = evaluate('The quick fox jumps.', 'The quick quick fox jumps.');
    expect(r.full).toBe(1);
    expect(r.mistakes[0]!.kind).toBe('repetition');
  });

  it('substitution with a different valid word', () => {
    const r = evaluate('The quick fox jumps.', 'The slow fox jumps.');
    expect(r.full).toBe(1);
    expect(r.half).toBe(0);
    expect(r.mistakes[0]).toMatchObject({ kind: 'substitution', master: 'quick', attempt: 'slow' });
  });

  it('a real but wrong word is a substitution, not a spelling slip', () => {
    const r = evaluate('They went to their house.', 'They went to there house.');
    expect(kinds(r)).toEqual(['substitution']);
    expect(r.full).toBe(1);
  });

  it('incomplete word', () => {
    const r = evaluate('The government has decided.', 'The govern has decided.');
    expect(kinds(r)).toEqual(['incomplete_word']);
    expect(r.full).toBe(1);
  });

  it('abbreviation instead of the full word', () => {
    const r = evaluate('The government has decided.', 'The govt has decided.');
    expect(kinds(r)).toEqual(['abbreviation']);
    expect(r.full).toBe(1);
  });

  it('expansion instead of the abbreviation', () => {
    const r = evaluate('The Govt. has decided.', 'The government has decided.');
    expect(kinds(r)).toEqual(['abbreviation']);
  });

  it('a word typed in ALL CAPS', () => {
    const r = evaluate('The Minister said so.', 'The MINISTER said so.');
    expect(kinds(r)).toEqual(['all_caps']);
    expect(r.full).toBe(1);
  });

  it('acronyms typed correctly are fine', () => {
    const r = evaluate('The UPSC and SSC exams.', 'The UPSC and SSC exams.');
    expect(r.errorPct).toBe(0);
  });
});

describe('half mistakes', () => {
  it('spelling error (not a dictionary word, close to the master word)', () => {
    const r = evaluate('The government has decided.', 'The goverment has decided.');
    expect(kinds(r)).toEqual(['spelling']);
    expect(r.full).toBe(0);
    expect(r.half).toBe(1);
  });

  it('transposed letters count as one edit', () => {
    const r = evaluate('We shall receive it.', 'We shall recieve it.');
    expect(kinds(r)).toEqual(['spelling']);
  });

  it('plural instead of singular and vice versa', () => {
    expect(kinds(evaluate('The member spoke.', 'The members spoke.'))).toEqual(['plural']);
    expect(kinds(evaluate('The members spoke.', 'The member spoke.'))).toEqual(['plural']);
    expect(kinds(evaluate('Many cities grew.', 'Many city grew.'))).toEqual(['plural']);
  });

  it('missing full stop', () => {
    const r = evaluate('It is done. We agree.', 'It is done We agree.');
    expect(kinds(r)).toEqual(['full_stop']);
    expect(r.half).toBe(1);
  });

  it('extra full stop', () => {
    const r = evaluate('It is done and we agree.', 'It is done. and we agree.');
    expect(kinds(r)).toEqual(['full_stop']);
  });

  it('a full stop typed as its own word still counts', () => {
    const r = evaluate('It is done. We agree.', 'It is done . We agree.');
    expect(r.errorPct).toBe(0);
  });

  it('small letter at sentence start / proper noun', () => {
    expect(kinds(evaluate('It is done. We agree.', 'It is done. we agree.'))).toEqual(['capitalisation']);
    expect(kinds(evaluate('He went to Delhi.', 'He went to delhi.'))).toEqual(['capitalisation']);
  });

  it('capital letter on a common word is not penalised by default', () => {
    const r = evaluate('He went to the market.', 'He went to The market.');
    expect(r.errorPct).toBe(0);
  });

  it('missing full stop and small letter on the same word = two half mistakes', () => {
    const r = evaluate('We agree. Then we left.', 'We agree then we left.');
    // "agree." loses its stop, "Then" loses its capital.
    expect(r.half).toBe(2);
    expect(r.full).toBe(0);
  });
});

describe('things that are NOT mistakes', () => {
  it('commas are ignored by default', () => {
    const r = evaluate('Sir, the work, as agreed, is done.', 'Sir the work as agreed is done.');
    expect(r.errorPct).toBe(0);
  });

  it('commas can be made half mistakes', () => {
    const r = evaluate('Sir, the work is done.', 'Sir the work is done.', { rules: { commas: 'half' } });
    expect(kinds(r)).toEqual(['comma']);
  });

  it('numerals and number words are equal', () => {
    expect(evaluate('There were 25 members.', 'There were twenty five members.').errorPct).toBe(0);
    expect(evaluate('There were twenty-five members.', 'There were 25 members.').errorPct).toBe(0);
    expect(evaluate('He paid Rs. 5,000 today.', 'He paid Rs. five thousand today.').errorPct).toBe(0);
    expect(evaluate('It costs one hundred and five rupees.', 'It costs 105 rupees.').errorPct).toBe(0);
    expect(evaluate('Two lakh people came.', '2,00,000 people came.').errorPct).toBe(0);
    expect(evaluate('It rose by 5 per cent.', 'It rose by 5 percent.').errorPct).toBe(0);
    expect(evaluate('It rose by 5 per cent.', 'It rose by 5%.').errorPct).toBe(0);
  });

  it('wrong numbers are mistakes', () => {
    const r = evaluate('There were 25 members.', 'There were 26 members.');
    expect(r.full).toBe(1);
  });

  it('a different ordinal is a wrong word, not a spelling slip', () => {
    const r = evaluate('The 5th item.', 'The 6th item.');
    expect(kinds(r)).toEqual(['substitution']);
  });

  it('hyphenated words may be typed with or without the hyphen', () => {
    expect(evaluate('A well-known author.', 'A well known author.').errorPct).toBe(0);
    expect(evaluate('A well known author.', 'A well-known author.').errorPct).toBe(0);
  });

  it('listed alternate forms are accepted', () => {
    expect(evaluate('The Honourable Speaker.', "The Hon'ble Speaker.").errorPct).toBe(0);
    expect(evaluate("The Hon'ble Speaker.", 'The Honourable Speaker.').errorPct).toBe(0);
    expect(evaluate('The Honourable Speaker.', 'The Hon. Speaker.').errorPct).toBe(0);
  });

  it('curly quotes and apostrophes are treated as straight ones', () => {
    expect(evaluate("It's the member's right.", 'It’s the member’s right.').errorPct).toBe(0);
  });
});

describe('scoring', () => {
  it('error % = (full + half/2) / master words * 100', () => {
    const master = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango';
    // "delta" omitted (1 full) and "foxtrot" misspelt (1 half): 1.5 / 20 = 7.5 %
    const attempt = master.replace('delta ', '').replace('foxtrot', 'foxtrott');
    const r = evaluate(master, attempt);
    expect(r).toMatchObject({ masterWords: 20, full: 1, half: 1, errorPct: 7.5 });
  });

  it('rounds to two decimals', () => {
    const r = evaluate('one two three', 'one two');
    expect(r.errorPct).toBe(33.33);
  });

  it('pass / fail against a limit', () => {
    const words = Array.from({ length: 100 }, (_, i) => `word${String.fromCharCode(97 + (i % 26))}${Math.floor(i / 26)}x`);
    const master = words.join(' ');
    const fiveWrong = words.map((w, i) => (i < 5 ? 'zzzzzzzz' : w)).join(' ');
    const sixWrong = words.map((w, i) => (i < 6 ? 'zzzzzzzz' : w)).join(' ');
    expect(evaluate(master, fiveWrong, { limitPct: 5 })).toMatchObject({ errorPct: 5, passed: true });
    expect(evaluate(master, sixWrong, { limitPct: 5 })).toMatchObject({ errorPct: 6, passed: false });
    expect(evaluate(master, master).passed).toBeNull();
  });

  it('diff covers every master word and every attempt word exactly once', () => {
    const master = 'The Honourable Minister said that the government has decided to act.';
    const attempt = 'The minister siad the govt decided to to act';
    const r = evaluate(master, attempt);
    const masterSide = r.diff.filter((d) => d.t !== 'i').length;
    const attemptSide = r.diff.filter((d) => d.t !== 'd').length;
    expect(masterSide).toBe(11);
    expect(attemptSide).toBe(9);
    expect(r.mistakes.length).toBeGreaterThan(0);
  });
});

describe('performance', () => {
  it('evaluates a 1000-word dictation with many errors in well under a second', () => {
    const vocab = ['government', 'minister', 'committee', 'the', 'of', 'and', 'members', 'report', 'house', 'speaker', 'question', 'answer'];
    let seed = 42;
    const rand = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const master = Array.from({ length: 1000 }, () => vocab[Math.floor(rand() * vocab.length)]!).join(' ');
    const attempt = master
      .split(' ')
      .filter(() => rand() > 0.05)
      .map((w) => (rand() < 0.05 ? w.slice(0, -1) : w))
      .join(' ');
    const t0 = performance.now();
    const r = evaluate(master, attempt);
    const ms = performance.now() - t0;
    console.log(`1000-word evaluation took ${Math.round(ms)}ms`);
    expect(r.masterWords).toBe(1000);
    expect(ms).toBeLessThan(1000);
  });
});
