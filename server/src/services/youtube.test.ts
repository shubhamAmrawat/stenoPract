import { describe, expect, it } from 'vitest';
import { extractPlaylistId, parseVideoTitle } from './youtube.js';

describe('parseVideoTitle', () => {
  it('reads speed and exercise number', () => {
    expect(parseVideoTitle('100 WPM | Exercise 507 | Kailash Chandra Vol 24')).toEqual({ baseWpm: 100, exerciseNo: 507 });
    expect(parseVideoTitle('80 wpm - Exercise No. 12')).toEqual({ baseWpm: 80, exerciseNo: 12 });
    expect(parseVideoTitle('Exercise 9 @ 120WPM')).toEqual({ baseWpm: 120, exerciseNo: 9 });
  });
  it('returns null when a part is missing', () => {
    expect(parseVideoTitle('Kailash Chandra Vol 24 intro')).toBeNull();
    expect(parseVideoTitle('100 WPM dictation')).toBeNull();
    expect(parseVideoTitle('Exercise 507')).toBeNull();
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
