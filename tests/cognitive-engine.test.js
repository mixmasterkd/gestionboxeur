import test from 'node:test';
import assert from 'node:assert/strict';
import { CognitiveGame, cognitiveModeKey, MAX_SEQUENCE } from '../js/cognitive-engine.js';

function fixture(config = {}) {
  let time = 0;
  const game = new CognitiveGame({ random: () => 0, now: () => time, ...config });
  return { game, advance(ms) { time += ms; return game.tick(); }, reveal() { let guard = 0; while (game.status === 'showing' && guard++ < 3000) { time += 100; game.tick(); } return game.snapshot(); } };
}
test('seven rule variants have separate stable record keys', () => {
  assert.deepEqual([4,6,8].map(count=>cognitiveModeKey({count})),['tiles-4','tiles-6','tiles-8']);
  assert.equal(cognitiveModeKey({variant:'bag',mode:'targets',numbers:false}),'bag-targets-hidden');
  assert.equal(cognitiveModeKey({variant:'bag',numbers:true}),'bag-sequence-visible');
  assert.throws(()=>new CognitiveGame({count:7}));
  assert.throws(()=>new CognitiveGame({variant:'unknown'}));
});
test('sequence demonstrates, locks input, grows by one and only credits complete rounds', () => {
  const f=fixture(),g=f.game;
  assert.equal(g.start().score,0);assert.equal(g.hit(0).accepted,false);
  assert.equal(f.advance(550).lit,0);assert.equal(f.advance(620).lit,null);
  assert.equal(f.advance(280).status,'input');
  assert.equal(g.hit(0).score,1);assert.equal(g.status,'success');assert.equal(g.hit(0).accepted,false);
  f.advance(650);assert.equal(g.sequence.length,2);f.reveal();
  assert.equal(g.hit(0).score,1,'partial response is not a completed round');
  const mistake=g.hit(1);assert.equal(mistake.status,'finished');assert.equal(mistake.score,1);assert.equal(mistake.flash.correct,false);
  assert.equal(g.hit(0).accepted,false);
});
test('repeat tiles have a visible off gap and no phantom hit from demonstration', () => {
  const f=fixture(),g=f.game;g.start();f.reveal();g.hit(0);f.advance(650);
  assert.equal(f.advance(550).lit,0);assert.equal(f.advance(620).lit,null);assert.equal(f.advance(280).lit,0);
  assert.equal(g.hits,1);
});
test('bag sequence uses six fixed zones and a digit cue, including hidden-number mode', () => {
  const f=fixture({variant:'bag',numbers:false,random:()=>.99,count:8}),g=f.game;
  assert.equal(g.config.count,6);g.start();assert.equal(f.advance(550).lit,5);f.reveal();
  assert.equal(g.hit(5).correct,true);assert.equal(g.key,'bag-sequence-hidden');
});
test('target game runs exactly 30 seconds, penalizes errors and never repeats a successful target', () => {
  const f=fixture({variant:'bag',mode:'targets'}),g=f.game;
  assert.equal(g.start().remaining,30000);assert.equal(g.target,0);
  assert.equal(g.hit(0).score,1);assert.equal(g.target,1);
  assert.equal(g.hit(0).score,0);assert.equal(g.hit(0).score,0);
  assert.equal(g.hit(1).score,1);assert.equal(g.target,0);
  f.advance(30000);assert.equal(g.status,'finished');assert.equal(g.score,1);assert.equal(g.hit(0).accepted,false);
});
test('expired target input is rejected even without a scheduled tick', () => {
  let time=0;const g=new CognitiveGame({variant:'bag',mode:'targets',now:()=>time});g.start();time=30001;
  assert.equal(g.hit(g.target).accepted,false);assert.equal(g.status,'finished');
});
test('hidden page or missed demonstration interrupts instead of skipping cues or saving a completed result', () => {
  const f=fixture();f.game.start();assert.equal(f.advance(10000).status,'interrupted');assert.equal(f.game.active,false);
  f.game.start();f.reveal();assert.equal(f.game.interrupt().status,'interrupted');assert.equal(f.game.hit(0).accepted,false);
});
test('all six valid hits and invalid inputs are bounded', () => {
  const f=fixture();f.game.start();f.reveal();
  for(const input of [-1,6,null,NaN,1.2,'0'])assert.equal(f.game.hit(input).accepted,false);
  assert.equal(f.game.cursor,0);assert.equal(f.game.score,0);
});
test('sequence has a finite victory limit and restart clears only game progress', () => {
  const f=fixture(),g=f.game;g.start();
  g.sequence=Array(MAX_SEQUENCE).fill(0);f.reveal();
  for(let i=0;i<MAX_SEQUENCE;i++)g.hit(0);
  assert.equal(g.status,'finished');assert.equal(g.score,MAX_SEQUENCE);assert.equal(g.reason,'complete');
  g.start();assert.equal(g.score,0);assert.equal(g.sequence.length,1);
});
