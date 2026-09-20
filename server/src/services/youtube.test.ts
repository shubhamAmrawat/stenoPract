import { describe, expect, it } from 'vitest';
import { extractPlaylistId, parseVideoTitle } from './youtube.js';

describe('parseVideoTitle', () => {
  it('reads speed and exercise number', () => {
    expect(parseVideoTitle('100 WPM | Exercise 507 | Kailash Chandra Vol 24')).toEqual({ baseWpm: 100, exerciseNo: 507 });
    expect(parseVideoTitle('80 wpm - Exercise No. 12')).toEqual({ baseWpm: 80, exerciseNo: 12 });
    expect(parseVideoTitle('Exercise 9 @ 120WPM')).toEqual({ baseWpm: 120, exerciseNo: 9 });
    expect(parseVideoTitle('Transcript #14 | 90 words per minute')).toEqual({ baseWpm: 90, exerciseNo: 14 });
  });
  it('reads "Transcription No. N" titles, with or without a speed', () => {
    expect(parseVideoTitle('Transcription No. 485 | Kailash Chandra Shorthand Dictation | Shorthand 100 WPM')).toEqual({ baseWpm: 100, exerciseNo: 485 });
    expect(parseVideoTitle('Transcription No. 485 | Kailash Chandra Shorthand Dictation | Shorthand')).toEqual({ baseWpm: null, exerciseNo: 485 });
    expect(parseVideoTitle('Transcription 2, Vol.1, Page 1 - Shorthand Dictation @ 50wpm')).toEqual({ baseWpm: 50, exerciseNo: 2 });
  });
  it('accepts a marked "Dictation No." but never mistakes a speed for the exercise number', () => {
    expect(parseVideoTitle('Dictation No. 33 - 110 WPM')).toEqual({ baseWpm: 110, exerciseNo: 33 });
    expect(parseVideoTitle('Shorthand Dictation 100 WPM')).toBeNull();
    expect(parseVideoTitle('Exercise 100 WPM')).toBeNull();
  });
  it('ignores speeds outside the supported range', () => {
    expect(parseVideoTitle('Exercise 5 | 10 WPM')).toEqual({ baseWpm: null, exerciseNo: 5 });
    expect(parseVideoTitle('Exercise 5 | 500 WPM | 80 WPM')).toEqual({ baseWpm: 80, exerciseNo: 5 });
  });
  it('returns null when there is no exercise number', () => {
    expect(parseVideoTitle('Kailash Chandra Vol 24 intro')).toBeNull();
    expect(parseVideoTitle('100 WPM dictation')).toBeNull();
  });
});

describe('extractPlaylistId', () => {
  it('accepts URLs and bare ids', () => {
    expect(extractPlaylistId('https://www.youtube.com/watch?v=TKMAnZMQwaM&list=PLyE_bKmpWrl_oo1RJLMNCIfyQOFUw9v68')).toBe('PLyE_bKmpWrl_oo1RJLMNCIfyQOFUw9v68');
    expect(extractPlaylistId('PLyE_bKmpWrl_oo1RJLMNCIfyQOFUw9v68')).toBe('PLyE_bKmpWrl_oo1RJLMNCIfyQOFUw9v68');
    expect(extractPlaylistId('nonsense url')).toBeNull();
    expect(extractPlaylistId('')).toBeNull();
  });
});
