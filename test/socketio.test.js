import { onInitialize, onUpdate, onGet, _reset } from "../main.js";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { io } from "socket.io-client";

const PREFIX = "3db/";

// shared suite state
let httpServer;
let ioServer;
let port;
let tester; // driver client: sends events into the plugin, observes the server
let apiCalls = []; // runApi calls made through the plugin
let serverReqs = []; // [eventName, argsArray] received by the server from any client
let connections = 0;

// records runApi invocations, mirroring how the core would dispatch them
async function stubRunApi(api, ...args) {
  apiCalls.push([api, ...args]);
  return undefined;
}

// polls until condition() is truthy (or the timeout elapses).
// default is below bun test's 5s per-test timeout so the explicit timeout
// error (with context) fires before the bare test timeout does.
async function waitFor(condition, timeout = 4000, interval = 10) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  return condition();
}

// deep-equal on the most recent apiCalls entry
function lastApiCall() {
  return apiCalls[apiCalls.length - 1];
}

// waits until an apiCall entry deep-equals the expected [api, ...args]
function waitForApiCall(expected, timeout = 4000) {
  return waitFor(() => {
    for (let i = apiCalls.length - 1; i >= 0; i--) {
      if (JSON.stringify(apiCalls[i]) === JSON.stringify(expected)) return true;
    }
    return false;
  }, timeout).then((ok) => {
    if (!ok) throw new Error(`timed out waiting for api call: ${JSON.stringify(expected)}`);
  });
}

// waits until the server received [eventName, [data...]]
function waitForServerEvent(eventName, args, timeout = 4000) {
  return waitFor(() => {
    return serverReqs.some(([name, a]) => name === eventName && JSON.stringify(a) === JSON.stringify(args));
  }, timeout).then((ok) => {
    if (!ok) throw new Error(`timed out waiting for server event: ${eventName} ${JSON.stringify(args)}`);
  });
}

let consolePatches;

beforeAll(async () => {
  // silence the plugin's console output for clean test output
  consolePatches = { log: console.log, error: console.error };
  console.log = () => {};
  console.error = () => {};

  httpServer = createServer();
  ioServer = new Server(httpServer);
  ioServer.on("connection", (socket) => {
    connections++;
    // mirror the production 3suite-socketio server: relay every event to all
    // other connected clients (broadcast excludes the sender)
    socket.onAny((name, ...args) => {
      serverReqs.push([name, args]);
      socket.broadcast.emit(name, ...args);
    });
  });
  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  port = httpServer.address().port;

  tester = io("ws://127.0.0.1:" + port);
  await waitFor(() => tester.connected);

  await onInitialize(
    { serverUrl: "127.0.0.1:" + port, socketioPrefix: PREFIX, verbose: false },
    stubRunApi
  );
  // the plugin's socket is the second connection the server sees
  await waitFor(() => connections >= 2);
});

afterAll(async () => {
  _reset();
  tester.disconnect();
  await ioServer.close();
  await new Promise((resolve) => httpServer.close(resolve));
  console.log = consolePatches.log;
  console.error = consolePatches.error;
});

test("initialize connects the plugin to the server", async () => {
  expect(connections).toBe(2);
  expect(apiCalls).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// receive path: tester -> plugin -> runApi
// ---------------------------------------------------------------------------

test("receive: number payloads reach runApi intact", async () => {
  const cases = [0, 42, -7, 3.14, 9007199254740991];
  for (let i = 0; i < cases.length; i++) {
    const before = apiCalls.length;
    tester.emit(PREFIX + "update/num" + i, cases[i]);
    await waitForApiCall(["update/num" + i, cases[i]]);
    expect(apiCalls.slice(before)).toEqual([["update/num" + i, cases[i]]]);
  }
});

test("receive: boolean payloads reach runApi intact", async () => {
  for (const [i, value] of [true, false].entries()) {
    const before = apiCalls.length;
    tester.emit(PREFIX + "update/bool" + i, value);
    await waitForApiCall(["update/bool" + i, value]);
    expect(apiCalls.slice(before)).toEqual([["update/bool" + i, value]]);
  }
});

test("receive: string payloads reach runApi intact", async () => {
  const cases = ["world", "", "🎉 émoji 漢字", "x".repeat(10000)];
  for (let i = 0; i < cases.length; i++) {
    const before = apiCalls.length;
    tester.emit(PREFIX + "update/str" + i, cases[i]);
    await waitForApiCall(["update/str" + i, cases[i]]);
    expect(apiCalls.slice(before)).toEqual([["update/str" + i, cases[i]]]);
  }
});

test("receive: object payloads reach runApi intact", async () => {
  const cases = [
    {},
    { a: 1 },
    { a: { b: [1, { c: "x" }] } },
    { s: "str", n: 1, b: true, o: { deep: [{ x: null }] }, arr: [1, "two", false] },
    { nullKey: null },
  ];
  for (let i = 0; i < cases.length; i++) {
    const before = apiCalls.length;
    tester.emit(PREFIX + "update/obj" + i, cases[i]);
    await waitForApiCall(["update/obj" + i, cases[i]]);
    expect(apiCalls.slice(before)).toEqual([["update/obj" + i, cases[i]]]);
  }
});

test("receive: array payloads reach runApi intact (not unwrapped)", async () => {
  const cases = [
    [],
    [1, 2, 3],
    ["a", "b"],
    [true, false, null],
    [{ id: "a", v: 1 }, { id: "b", v: 2 }],
    [[1, 2], [3]],
  ];
  for (let i = 0; i < cases.length; i++) {
    const before = apiCalls.length;
    tester.emit(PREFIX + "update/arr" + i, cases[i]);
    await waitForApiCall(["update/arr" + i, cases[i]]);
    expect(apiCalls.slice(before)).toEqual([["update/arr" + i, cases[i]]]);
  }
});

test("receive: null payload reaches runApi intact", async () => {
  tester.emit(PREFIX + "update/null", null);
  await waitForApiCall(["update/null", null]);
  expect(lastApiCall()).toEqual(["update/null", null]);
});

test("receive: undefined payload arrives as null (JSON wire semantics)", async () => {
  tester.emit(PREFIX + "update/undef", undefined);
  await waitFor(() => apiCalls.some((c) => c[0] === "update/undef"));
  const call = apiCalls.find((c) => c[0] === "update/undef");
  // JSON.stringify([undefined]) === "[null]": the wire cannot carry undefined
  expect(call.length).toBe(2);
  expect(call[1]).toBeNull();
});

test("receive: no-arg emit reaches runApi with no data", async () => {
  const before = apiCalls.length;
  tester.emit(PREFIX + "update/noargs");
  await waitFor(() => apiCalls.length > before);
  expect(apiCalls.slice(before)).toEqual([["update/noargs"]]);
});

test("receive: multiple args reach runApi in order", async () => {
  const before = apiCalls.length;
  tester.emit(PREFIX + "update/multi", "arg1", 42);
  await waitFor(() => apiCalls.length > before);
  expect(apiCalls.slice(before)).toEqual([["update/multi", "arg1", 42]]);
});

test("receive: events without the configured prefix are ignored", async () => {
  const before = apiCalls.length;
  tester.emit("other/event", "x");
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(apiCalls.length).toBe(before);
});

test("receive: batch of 100 mixed-type events arrives in order intact", 15000, async () => {
  const payloads = [
    1, "two", true, 3.5, false, null, { a: [1, { b: "x" }] }, [4, "five"],
    0, -1, "🎉", { deep: { deeper: [{ list: [true, null] }] } }, 9007199254740991,
  ];
  const before = apiCalls.length;
  const expected = [];
  for (let i = 0; i < 100; i++) {
    const payload = payloads[i % payloads.length];
    const id = "batch" + i;
    tester.emit(PREFIX + "update/" + id, payload);
    expected.push(["update/" + id, payload]);
  }
  await waitFor(() => apiCalls.length >= before + 100, 12000);
  expect(apiCalls.slice(before, before + 100)).toEqual(expected);
});

// ---------------------------------------------------------------------------
// send path: plugin -> server
// ---------------------------------------------------------------------------

test("send: onUpdate emits prefixed events with number payloads and returns the data", async () => {
  const cases = [0, 42, -7, 3.14, 9007199254740991];
  for (let i = 0; i < cases.length; i++) {
    const id = "out-num" + i;
    const result = await onUpdate({ socketioPrefix: PREFIX, verbose: false }, stubRunApi, id, cases[i]);
    expect(result).toBe(cases[i]);
    await waitForServerEvent(PREFIX + id, [cases[i]]);
  }
});

test("send: onUpdate emits boolean payloads and returns the data", async () => {
  for (const [i, value] of [true, false].entries()) {
    const id = "out-bool" + i;
    const result = await onUpdate({ socketioPrefix: PREFIX, verbose: false }, stubRunApi, id, value);
    expect(result).toBe(value);
    await waitForServerEvent(PREFIX + id, [value]);
  }
});

test("send: onUpdate emits string payloads and returns the data", async () => {
  const cases = ["world", "", "🎉 émoji 漢字", "x".repeat(10000)];
  for (let i = 0; i < cases.length; i++) {
    const id = "out-str" + i;
    const result = await onUpdate({ socketioPrefix: PREFIX, verbose: false }, stubRunApi, id, cases[i]);
    expect(result).toBe(cases[i]);
    await waitForServerEvent(PREFIX + id, [cases[i]]);
  }
});

test("send: onUpdate emits object payloads and returns the data", async () => {
  const cases = [
    {},
    { a: 1 },
    { a: { b: [1, { c: "x" }] } },
    { s: "str", n: 1, b: true, o: { deep: [{ x: null }] }, arr: [1, "two", false] },
    { nullKey: null },
  ];
  for (let i = 0; i < cases.length; i++) {
    const id = "out-obj" + i;
    const data = cases[i];
    const result = await onUpdate({ socketioPrefix: PREFIX, verbose: false }, stubRunApi, id, data);
    expect(result).toBe(data);
    await waitForServerEvent(PREFIX + id, [data]);
  }
});

test("send: onUpdate emits array payloads intact (not unwrapped)", async () => {
  const cases = [
    [],
    [1, 2, 3],
    ["a", "b"],
    [true, false, null],
    [{ id: "a", v: 1 }, { id: "b", v: 2 }],
    [[1, 2], [3]],
  ];
  for (let i = 0; i < cases.length; i++) {
    const id = "out-arr" + i;
    const data = cases[i];
    const result = await onUpdate({ socketioPrefix: PREFIX, verbose: false }, stubRunApi, id, data);
    expect(result).toBe(data);
    await waitForServerEvent(PREFIX + id, [data]);
  }
});

test("send: onUpdate emits null payload and returns the data", async () => {
  const id = "out-null";
  const result = await onUpdate({ socketioPrefix: PREFIX, verbose: false }, stubRunApi, id, null);
  expect(result).toBeNull();
  await waitForServerEvent(PREFIX + id, [null]);
});

test("send: onUpdate with undefined payload emits null (JSON wire semantics) and resolves", async () => {
  const id = "out-undef";
  const result = await onUpdate({ socketioPrefix: PREFIX, verbose: false }, stubRunApi, id, undefined);
  expect(result).toBeUndefined();
  // the wire cannot carry undefined; the server observes null
  await waitFor(() => serverReqs.some(([name]) => name === PREFIX + id));
  const [, args] = serverReqs.find(([name]) => name === PREFIX + id);
  expect(args).toHaveLength(1);
  expect(args[0]).toBeNull();
});

test("send: onGet uses the same emit contract (string and object payloads)", async () => {
  const r1 = await onGet({ socketioPrefix: PREFIX, verbose: false }, stubRunApi, "get-str", "hello");
  expect(r1).toBe("hello");
  await waitForServerEvent(PREFIX + "get-str", ["hello"]);

  const obj = { id: "g", value: [1, 2, 3] };
  const r2 = await onGet({ socketioPrefix: PREFIX, verbose: false }, stubRunApi, "get-obj", obj);
  expect(r2).toBe(obj);
  await waitForServerEvent(PREFIX + "get-obj", [obj]);
});

test("send: ids with special characters become the full event name", async () => {
  await onUpdate({ socketioPrefix: PREFIX, verbose: false }, stubRunApi, "hello world", 1);
  await waitForServerEvent(PREFIX + "hello world", [1]);
  await onUpdate({ socketioPrefix: PREFIX, verbose: false }, stubRunApi, "a/b", 2);
  await waitForServerEvent(PREFIX + "a/b", [2]);
});

// ---------------------------------------------------------------------------
// multi-client full loop: plugin -> server -> another client
// ---------------------------------------------------------------------------

test("full loop: another connected client receives the plugin's emits for each data type", async () => {
  const remote = io("ws://127.0.0.1:" + port);
  const received = [];
  await waitFor(() => remote.connected);
  remote.onAny((name, ...args) => received.push([name, ...args]));

  const cases = [42, "world", { a: [1, { b: true }] }, [1, "two", false], 3.14];
  for (let i = 0; i < cases.length; i++) {
    const id = "loop" + i;
    await onUpdate({ socketioPrefix: PREFIX, verbose: false }, stubRunApi, id, cases[i]);
    await waitFor(() => received.some(([name]) => name === PREFIX + id));
  }

  for (let i = 0; i < cases.length; i++) {
    const [name, ...args] = received.find(([n]) => n === PREFIX + "loop" + i);
    expect(args).toEqual([cases[i]]);
  }

  remote.disconnect();
});

// ---------------------------------------------------------------------------
// prefix configurability (uses _reset + re-init)
// ---------------------------------------------------------------------------

test("prefix: a different socketioPrefix is honored in both directions", async () => {
  _reset();
  apiCalls.length = 0;
  await onInitialize(
    { serverUrl: "127.0.0.1:" + port, socketioPrefix: "core/", verbose: false },
    stubRunApi
  );
  const connectionsBefore = connections;
  await waitFor(() => connections >= connectionsBefore + 1);

  // incoming: only core/-prefixed events are processed, prefix is stripped
  tester.emit("core/update/x", 5);
  await waitForApiCall(["update/x", 5]);
  tester.emit("3db/should-be-ignored", 1);
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(apiCalls.filter((c) => c[0] === "should-be-ignored")).toHaveLength(0);

  // outgoing: the new prefix is applied
  await onUpdate({ socketioPrefix: "core/", verbose: false }, stubRunApi, "y", { ok: true });
  await waitForServerEvent("core/y", [{ ok: true }]);

  // restore the default prefix for the remaining tests
  _reset();
  await onInitialize(
    { serverUrl: "127.0.0.1:" + port, socketioPrefix: PREFIX, verbose: false },
    stubRunApi
  );
  await waitFor(() => connections >= connectionsBefore + 2);
});

// ---------------------------------------------------------------------------
// lifecycle
// ---------------------------------------------------------------------------

test("lifecycle: emit before initialize returns the data without emitting", async () => {
  _reset();
  const before = serverReqs.length;
  const result = await onUpdate({ socketioPrefix: PREFIX, verbose: false }, stubRunApi, "x", { a: 1 });
  expect(result).toEqual({ a: 1 });
  expect(serverReqs.length).toBe(before);

  // restore the shared connection
  await onInitialize(
    { serverUrl: "127.0.0.1:" + port, socketioPrefix: PREFIX, verbose: false },
    stubRunApi
  );
  const connectionsBefore = connections;
  await waitFor(() => connections >= connectionsBefore + 1);
});

test("lifecycle: emit while the socket is disconnected returns the data without emitting", async () => {
  _reset();
  // point the plugin at a closed port: the socket object exists but never connects
  await onInitialize({ serverUrl: "127.0.0.1:1", socketioPrefix: PREFIX, verbose: false }, stubRunApi);
  await new Promise((resolve) => setTimeout(resolve, 300));

  const before = serverReqs.length;
  const result = await onUpdate({ socketioPrefix: PREFIX, verbose: false }, stubRunApi, "dc", [1, 2]);
  expect(result).toEqual([1, 2]);
  expect(serverReqs.length).toBe(before);
});

test("lifecycle: initialize against a dead server resolves without throwing", async () => {
  _reset();
  const connectionsBefore = connections;
  await expect(
    onInitialize({ serverUrl: "127.0.0.1:1", socketioPrefix: PREFIX, verbose: false }, stubRunApi)
  ).resolves.toBeUndefined();
  await new Promise((resolve) => setTimeout(resolve, 300));
  // the dead server (and this server) never saw a plugin connection
  expect(connections).toBe(connectionsBefore);
  _reset();

  // restore the shared connection
  await onInitialize(
    { serverUrl: "127.0.0.1:" + port, socketioPrefix: PREFIX, verbose: false },
    stubRunApi
  );
  await waitFor(() => connections >= connectionsBefore + 1);
});

test("lifecycle: the plugin automatically reconnects after a server restart", 20000, async () => {
  // dedicated second server so the shared suite server is untouched.
  // (a server-side socket.disconnect() is a *permanent* disconnect for the
  // client by socket.io design, so the realistic reconnect scenario is a
  // server restart: transport close, then the port comes back)
  let http2 = createServer();
  let io2 = new Server(http2);
  let connections2 = 0;
  const io2Reqs = [];
  io2.on("connection", (socket) => {
    connections2++;
    socket.onAny((name, ...args) => io2Reqs.push([name, args]));
  });
  await new Promise((resolve) => http2.listen(0, "127.0.0.1", resolve));
  const port2 = http2.address().port;

  _reset();
  await onInitialize({ serverUrl: "127.0.0.1:" + port2, socketioPrefix: PREFIX, verbose: false }, stubRunApi);
  await waitFor(() => connections2 >= 1);

  // kill the server: the client's transport closes
  await io2.close();

  // bring a fresh server back up on the same port
  http2 = createServer();
  io2 = new Server(http2);
  io2.on("connection", (socket) => {
    connections2++;
    socket.onAny((name, ...args) => io2Reqs.push([name, args]));
  });
  await new Promise((resolve) => http2.listen(port2, "127.0.0.1", resolve));

  // the client should reconnect on its own (default backoff, infinite attempts)
  await waitFor(() => connections2 >= 2, 15000);
  expect(connections2).toBeGreaterThanOrEqual(2);

  // the reconnected plugin socket is functional: retry the round-trip until
  // the client has finished processing the handshake (onUpdate silently
  // skips emits while socket.connected is still false)
  let delivered = false;
  for (let i = 0; i < 100 && !delivered; i++) {
    await onUpdate({ socketioPrefix: PREFIX, verbose: false }, stubRunApi, "reconnect-check", { ok: true });
    delivered = io2Reqs.some(([name]) => name === PREFIX + "reconnect-check");
    if (!delivered) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  expect(delivered).toBe(true);

  _reset();
  await io2.close();
});
