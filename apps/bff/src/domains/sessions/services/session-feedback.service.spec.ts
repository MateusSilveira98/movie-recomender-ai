import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyFeedbackToHistory } from './session-feedback.service.js';

describe('feedback da sessão', () => {
  it('deve manter apenas o sinal positivo ao curtir um filme', () => {
    const history = applyFeedbackToHistory(
      { disliked: ['movie-a'], liked: [], watched: ['movie-a'] },
      'movie-a',
      'liked',
    );

    assert.deepEqual(history, { disliked: [], liked: ['movie-a'], watched: ['movie-a'] });
  });

  it('deve manter o filme assistido sem rótulo quando o feedback for neutro', () => {
    const history = applyFeedbackToHistory(
      { disliked: [], liked: ['movie-a'], watched: ['movie-a'] },
      'movie-a',
      'watched_neutral',
    );

    assert.deepEqual(history, { disliked: [], liked: [], watched: ['movie-a'] });
  });
});
