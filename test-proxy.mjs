const proxy = "http://127.0.0.1:7890";
process.env.HTTP_PROXY = proxy;
process.env.HTTPS_PROXY = proxy;
process.env.NO_PROXY = ".aliyuncs.com";

// If we had bun we could test it, but we are in Node.
// Node fetch respects proxy only if we use an agent, but bun fetch uses it natively.
console.log(process.env.NO_PROXY);
