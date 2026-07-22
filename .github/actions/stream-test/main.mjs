let i = 0;
const timer = setInterval(() => {
  i += 1;
  console.log(`[stream-test][node-action] line ${i} of 20 — if you can read this in the live UI before line 20, streaming works`);
  if (i >= 20) {
    clearInterval(timer);
  }
}, 2000);
