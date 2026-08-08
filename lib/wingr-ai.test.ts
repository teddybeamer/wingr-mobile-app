import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeReplyBatch } from './wingr-ai';

test('normalizes every reply tone to its first generated reply', () => {
  const firstReply = { id: 'playful-1', text: 'First reply', tone: 'playful' as const };
  const secondReply = { id: 'playful-2', text: 'Second reply', tone: 'playful' as const };

  const replyBatch = normalizeReplyBatch({
    playful: [firstReply, secondReply],
  });

  assert.deepEqual(replyBatch.playful, [firstReply]);
  assert.equal(replyBatch.direct, undefined);
  assert.equal(replyBatch.casualSmallTalk, undefined);
});
