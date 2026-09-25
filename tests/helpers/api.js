// Calls the /api/decide handler in-process with mock req/res objects.
// Each call gets its own client address so the module-level rate limiter
// never interferes with a test that is not about rate limiting.
import handler from "../../pages/api/decide.js";

let n = 0;
function nextIp() {
  n++;
  return `172.${16 + ((n >> 16) & 15)}.${(n >> 8) & 255}.${n & 255}`;
}

export async function callApi(body) {
  const req = { method: "POST", body, headers: { "x-forwarded-for": nextIp() }, socket: { remoteAddress: "127.0.0.1" } };
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
  };
  await handler(req, res);
  return res;
}

// The first message the API reports for a path, the same one the form shows.
export function firstIssue(res, path) {
  return res.body?.issues?.find((i) => i.path === path)?.message;
}
