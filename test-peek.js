const sleep = ms => new Promise(r => setTimeout(r, ms));
async function* myGen() {
  await sleep(5000);
  yield { type: 'hello' };
}
async function run() {
  const iter = myGen()[Symbol.asyncIterator]();
  const first = await Promise.race([
    iter.next(),
    sleep(1000).then(() => ({ _timeout: true }))
  ]);
  console.log(first);
}
run();
