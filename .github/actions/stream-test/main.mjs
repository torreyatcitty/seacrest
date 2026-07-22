// Emit an annotation immediately: annotations travel to GitHub via a
// different channel than step logs, so this tests whether a running step
// can surface a WalletConnect-style URI mid-step even when logs buffer.
console.log("::notice title=stream-test annotation::emitted at node-action line 0 — if this is visible while the step is still running, annotations work mid-step");

let i = 0;
const timer = setInterval(() => {
  i += 1;
  console.log(`[stream-test][node-action] line ${i} of 90 — if you can read this in the live UI before line 90, streaming works`);
  if (i >= 90) {
    clearInterval(timer);
  }
}, 2000);
