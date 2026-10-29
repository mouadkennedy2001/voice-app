const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");
const express = require("express");
const { Server } = require("socket.io");

const app = express();
app.disable("x-powered-by");
const server = http.createServer(app);
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean)
  .map((origin) => {
    const parsedOrigin = new URL(origin);
    if (
      !["http:", "https:"].includes(parsedOrigin.protocol) ||
      parsedOrigin.username ||
      parsedOrigin.password ||
      parsedOrigin.pathname !== "/" ||
      parsedOrigin.search ||
      parsedOrigin.hash
    ) {
      throw new Error("ALLOWED_ORIGINS entries must be plain HTTP or HTTPS origins.");
    }
    return parsedOrigin.origin;
  });
const allowedOriginSet = new Set(allowedOrigins);
const turnUrls = (process.env.TURN_URLS || "")
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);
const turnSharedSecret = process.env.TURN_SHARED_SECRET || "";
const turnCredentialTtlSeconds = process.env.TURN_CREDENTIAL_TTL_SECONDS === undefined
  ? 3600
  : Number(process.env.TURN_CREDENTIAL_TTL_SECONDS);
if (turnUrls.some((url) => !/^turns?:/i.test(url))) {
  throw new Error("TURN_URLS may contain only turn: or turns: URLs.");
}
if (turnUrls.length && !turnSharedSecret) {
  throw new Error("TURN_SHARED_SECRET is required when TURN_URLS is configured.");
}
if (!Number.isInteger(turnCredentialTtlSeconds) || turnCredentialTtlSeconds < 60 || turnCredentialTtlSeconds > 86_400) {
  throw new Error("TURN_CREDENTIAL_TTL_SECONDS must be an integer between 60 and 86400.");
}
const io = new Server(server, {
  maxHttpBufferSize: 128 * 1024,
  ...(allowedOrigins.length ? { cors: { origin: allowedOrigins } } : {}),
  allowRequest: (request, callback) => {
    const origin = request.headers.origin;
    if (!origin) {
      callback(null, true);
      return;
    }

    let parsedOrigin;
    try {
      parsedOrigin = new URL(origin);
    } catch {
      callback(null, false);
      return;
    }
    const requestProtocol = request.socket.encrypted ? "https:" : "http:";
    const requestOrigin = request.headers.host ? new URL(`${requestProtocol}//${request.headers.host}`).origin : "";
    const sameOrigin = parsedOrigin.origin === requestOrigin;
    const allowed = ["http:", "https:"].includes(parsedOrigin.protocol) &&
      (allowedOriginSet.size ? allowedOriginSet.has(parsedOrigin.origin) : sameOrigin);
    callback(null, allowed);
  }
});
const rooms = new Map();
const PORT = Number(process.env.PORT) || 3000;
const DEFAULT_MAX_FILE_SIZE = 8 * 1024 * 1024;
const MAX_FILE_SIZE = process.env.MAX_FILE_SIZE === undefined
  ? DEFAULT_MAX_FILE_SIZE
  : Number(process.env.MAX_FILE_SIZE);
if (!Number.isSafeInteger(MAX_FILE_SIZE) || MAX_FILE_SIZE < 1 || MAX_FILE_SIZE > DEFAULT_MAX_FILE_SIZE) {
  throw new Error("MAX_FILE_SIZE must be an integer between 1 and 8388608 bytes.");
}
const MAX_PENDING_FILES_PER_ROOM = 12;
const MAX_ROOM_MEMBERS = 8;
const FILE_REQUEST_WINDOW_MS = 60 * 1000;
const MAX_FILE_REQUESTS_PER_WINDOW = 4;
const FILE_REQUEST_TTL_MS = 60 * 1000;
const SIGNAL_WINDOW_MS = 10 * 1000;
const MAX_SIGNALS_PER_WINDOW = 100;
const EVENT_LIMITS = {
  "join-room": { count: 5, windowMs: 60 * 1000 },
  "peer-status": { count: 30, windowMs: 10 * 1000 },
  "file-response": { count: 20, windowMs: 10 * 1000 },
  "file-cancel": { count: 30, windowMs: 10 * 1000 },
  "file-finish": { count: 30, windowMs: 10 * 1000 }
};
const BLOCKED_FILE_EXTENSIONS = new Set([
  "app", "asp", "aspx", "bat", "cgi", "cmd", "com", "cpl", "css", "dll", "dmg",
  "exe", "htm", "html", "hta", "jar", "js", "jse", "lnk", "mjs", "msi", "php",
  "pl", "ps1", "py", "rb", "reg", "scr", "sh", "svg", "vbs", "wasm", "wsf", "xhtml"
]);

app.use((request, response, next) => {
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' ws: wss: stun: stuns: turn: turns:; media-src 'self' blob:; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
  );
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Permissions-Policy", "microphone=(self), camera=(), display-capture=(self), geolocation=()");
  next();
});
app.get("/healthz", (request, response) => {
  response.status(200).json({ status: "ok" });
});
app.get("/api/ice", (request, response) => {
  const iceServers = [{ urls: "stun:stun.l.google.com:19302" }];
  if (turnUrls.length) {
    const expiresAt = Math.floor(Date.now() / 1000) + turnCredentialTtlSeconds;
    const username = `${expiresAt}:sout`;
    const credential = crypto.createHmac("sha1", turnSharedSecret).update(username).digest("base64");
    iceServers.push({ urls: turnUrls, username, credential });
  }
  response.setHeader("Cache-Control", "no-store");
  response.status(200).json({ iceServers, maxFileSize: MAX_FILE_SIZE });
});
app.use(express.static(path.join(__dirname, "public")));

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value, allowedKeys) {
  return isRecord(value) && Object.keys(value).every((key) => allowedKeys.includes(key));
}

function validSignal(signal) {
  if (!isRecord(signal)) return null;
  if (signal.description) {
    if (!hasOnlyKeys(signal, ["description"]) || !hasOnlyKeys(signal.description, ["type", "sdp"])) return null;
    const { type, sdp } = signal.description;
    if (!["offer", "answer"].includes(type) || typeof sdp !== "string" || sdp.length > 100_000) return null;
    return { description: { type, sdp } };
  }
  if (signal.candidate) {
    const candidate = signal.candidate;
    if (!hasOnlyKeys(signal, ["candidate"]) || !hasOnlyKeys(candidate, ["candidate", "sdpMid", "sdpMLineIndex", "usernameFragment"])) return null;
    if (
      typeof candidate.candidate !== "string" ||
      candidate.candidate.length > 4_096 ||
      (candidate.sdpMid != null && (typeof candidate.sdpMid !== "string" || candidate.sdpMid.length > 256)) ||
      (candidate.sdpMLineIndex != null && (!Number.isInteger(candidate.sdpMLineIndex) || candidate.sdpMLineIndex < 0 || candidate.sdpMLineIndex > 65_535)) ||
      (candidate.usernameFragment != null && (typeof candidate.usernameFragment !== "string" || candidate.usernameFragment.length > 256))
    ) return null;
    return { candidate: {
      candidate: candidate.candidate,
      sdpMid: candidate.sdpMid ?? null,
      sdpMLineIndex: candidate.sdpMLineIndex ?? null,
      usernameFragment: candidate.usernameFragment ?? null
    } };
  }
  return null;
}

function validFileMetadata(file) {
  if (!hasOnlyKeys(file, ["name", "size", "type"])) return false;
  if (typeof file.name !== "string" || file.name.length < 1 || file.name.length > 180) return false;
  if (/[\\/\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(file.name)) return false;
  if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_FILE_SIZE) return false;
  if (typeof file.type !== "string" || file.type.length > 128) return false;
  if (/[. ]$/.test(file.name)) return false;
  const extension = file.name.split(".").pop()?.trim().replace(/\.+$/, "").toLowerCase() || "";
  return !BLOCKED_FILE_EXTENSIONS.has(extension);
}

function clearFileRequest(channel, requestId) {
  const request = channel.fileRequests.get(requestId);
  if (!request) return;
  clearTimeout(request.timer);
  channel.fileRequests.delete(requestId);
}

function allowEvent(socket, eventName) {
  const limit = EVENT_LIMITS[eventName];
  if (!limit) return true;
  const now = Date.now();
  const eventTimes = socket.data.eventTimes || (socket.data.eventTimes = new Map());
  const timestamps = (eventTimes.get(eventName) || []).filter((timestamp) => now - timestamp < limit.windowMs);
  if (timestamps.length >= limit.count) return false;
  timestamps.push(now);
  eventTimes.set(eventName, timestamps);
  return true;
}

function isRequestId(value) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

io.on("connection", (socket) => {
  socket.on("join-room", (payload, acknowledge) => {
    if (typeof acknowledge !== "function") {
      acknowledge = () => {};
    }

    if (!hasOnlyKeys(payload, ["roomId", "name", "roomName", "muted"]) || !allowEvent(socket, "join-room")) {
      acknowledge({ error: "بيانات الانضمام غير صالحة أو أرسلت طلبات كثيرة." });
      return;
    }

    const { roomId, name, roomName, muted } = payload;
    const room = typeof roomId === "string" ? roomId.trim() : "";
    const displayName = typeof name === "string" ? name.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "").trim().slice(0, 32) : "";
    const requestedRoomName = typeof roomName === "string" ? roomName.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "").trim().slice(0, 48) : "";

    if (!/^[\w-]{8,80}$/.test(room) || !displayName || !requestedRoomName || (muted !== undefined && typeof muted !== "boolean")) {
      acknowledge({ error: "تحقق من اسمك واسم القناة ورابط الدعوة." });
      return;
    }

    if (socket.data.roomId) {
      acknowledge({ error: "أنت متصل بغرفة بالفعل." });
      return;
    }

    let channel = rooms.get(room);
    if (channel?.members.size >= MAX_ROOM_MEMBERS) {
      acknowledge({ error: "وصلت القناة إلى الحد الأقصى وهو 8 مشاركين." });
      return;
    }
    if (!channel) {
      channel = { name: requestedRoomName, members: new Map(), fileRequests: new Map() };
      rooms.set(room, channel);
    }

    const peers = Array.from(channel.members, ([id, member]) => ({ id, name: member.name, muted: member.muted }));

    const isMuted = muted === true;
    channel.members.set(socket.id, { name: displayName, muted: isMuted });
    socket.data.roomId = room;
    socket.join(room);
    acknowledge({ peers, roomName: channel.name });
    socket.to(room).emit("peer-joined", { id: socket.id, name: displayName, muted: isMuted });
  });

  socket.on("peer-status", (payload) => {
    if (!hasOnlyKeys(payload, ["muted"]) || !allowEvent(socket, "peer-status")) return;
    const { muted } = payload;
    const room = socket.data.roomId;
    const member = room && rooms.get(room)?.members.get(socket.id);
    if (!member || typeof muted !== "boolean") {
      return;
    }

    member.muted = muted;
    socket.to(room).emit("peer-status", { id: socket.id, muted });
  });

  socket.on("signal", (payload) => {
    if (!hasOnlyKeys(payload, ["target", "signal"])) return;
    const { target, signal } = payload;
    const room = socket.data.roomId;
    const safeSignal = validSignal(signal);
    if (!room || typeof target !== "string" || !safeSignal || !rooms.get(room)?.members.has(target) || !allowSignal(socket)) {
      return;
    }

    io.to(target).emit("signal", { from: socket.id, signal: safeSignal });
  });

  socket.on("file-request", (payload, acknowledge) => {
    const reply = typeof acknowledge === "function" ? acknowledge : () => {};
    if (!hasOnlyKeys(payload, ["target", "requestId", "file"])) {
      reply({ error: "بيانات طلب الملف غير صالحة." });
      return;
    }
    const { target, requestId, file } = payload;
    const room = socket.data.roomId;
    const channel = room && rooms.get(room);
    if (!channel || typeof target !== "string" || target === socket.id || !channel.members.has(target)) {
      reply({ error: "المستلم غير موجود في القناة." });
      return;
    }

    if (
      !isRequestId(requestId) ||
      !validFileMetadata(file) ||
      channel.fileRequests.has(requestId)
    ) {
      reply({ error: "بيانات الملف غير صالحة أو يتجاوز الحد المسموح." });
      return;
    }

    socket.data.fileRequestTimes = (socket.data.fileRequestTimes || [])
      .filter((timestamp) => Date.now() - timestamp < FILE_REQUEST_WINDOW_MS);
    if (socket.data.fileRequestTimes.length >= MAX_FILE_REQUESTS_PER_WINDOW) {
      reply({ error: "أرسلت طلبات كثيرة. انتظر قليلاً ثم حاول مجدداً." });
      return;
    }
    if (channel.fileRequests.size >= MAX_PENDING_FILES_PER_ROOM) {
      reply({ error: "القناة مشغولة بطلبات ملفات حالياً." });
      return;
    }
    if ([...channel.fileRequests.values()].some((request) => request.to === target)) {
      reply({ error: "لدى المستلم طلب ملف آخر قيد المراجعة أو النقل." });
      return;
    }

    socket.data.fileRequestTimes.push(Date.now());
    const timer = setTimeout(() => {
      const request = channel.fileRequests.get(requestId);
      if (!request) return;
      io.to(request.from).emit("file-expired", { requestId });
      io.to(request.to).emit("file-expired", { requestId });
      clearFileRequest(channel, requestId);
    }, FILE_REQUEST_TTL_MS);
    channel.fileRequests.set(requestId, {
      from: socket.id,
      to: target,
      file: { ...file },
      status: "pending",
      timer,
      signalCounts: new Map()
    });
    io.to(target).emit("file-request", {
      requestId,
      from: socket.id,
      senderName: channel.members.get(socket.id).name,
      file: { ...file }
    });
    reply({ ok: true });
  });

  socket.on("file-response", (payload) => {
    if (!hasOnlyKeys(payload, ["requestId", "accepted"]) || !allowEvent(socket, "file-response")) return;
    const { requestId, accepted } = payload;
    if (!isRequestId(requestId)) return;
    const room = socket.data.roomId;
    const channel = room && rooms.get(room);
    const request = channel?.fileRequests.get(requestId);
    if (!request || request.to !== socket.id || typeof accepted !== "boolean") return;

    if (!accepted) {
      io.to(request.from).emit("file-response", { requestId, accepted: false });
      clearFileRequest(channel, requestId);
      return;
    }

    request.status = "accepted";
    clearTimeout(request.timer);
    request.timer = setTimeout(() => {
      const current = channel.fileRequests.get(requestId);
      if (!current) return;
      io.to(current.from).emit("file-expired", { requestId });
      io.to(current.to).emit("file-expired", { requestId });
      clearFileRequest(channel, requestId);
    }, 5 * 60 * 1000);
    io.to(request.from).emit("file-response", { requestId, accepted: true });
  });

  socket.on("file-signal", (payload) => {
    if (!hasOnlyKeys(payload, ["requestId", "target", "signal"])) return;
    const { requestId, target, signal } = payload;
    if (!isRequestId(requestId)) return;
    const room = socket.data.roomId;
    const channel = room && rooms.get(room);
    const request = channel?.fileRequests.get(requestId);
    if (
      !request ||
      request.status !== "accepted" ||
      ![request.from, request.to].includes(socket.id) ||
      ![request.from, request.to].includes(target) ||
      target === socket.id ||
      !signal ||
      typeof signal !== "object"
    ) return;

    const safeSignal = validSignal(signal);
    if (!safeSignal || !allowSignal(socket)) return;
    const count = request.signalCounts.get(socket.id) || 0;
    if (count >= 100) return;
    request.signalCounts.set(socket.id, count + 1);

    io.to(target).emit("file-signal", { requestId, from: socket.id, signal: safeSignal });
  });

  socket.on("file-cancel", (payload) => {
    if (!hasOnlyKeys(payload, ["requestId"]) || !allowEvent(socket, "file-cancel")) return;
    const { requestId } = payload;
    if (!isRequestId(requestId)) return;
    const room = socket.data.roomId;
    const channel = room && rooms.get(room);
    const request = channel?.fileRequests.get(requestId);
    if (!request || ![request.from, request.to].includes(socket.id)) return;

    const other = request.from === socket.id ? request.to : request.from;
    io.to(other).emit("file-cancel", { requestId });
    clearFileRequest(channel, requestId);
  });

  socket.on("file-finish", (payload) => {
    if (!hasOnlyKeys(payload, ["requestId"]) || !allowEvent(socket, "file-finish")) return;
    const { requestId } = payload;
    if (!isRequestId(requestId)) return;
    const room = socket.data.roomId;
    const channel = room && rooms.get(room);
    const request = channel?.fileRequests.get(requestId);
    if (request?.status === "accepted" && [request.from, request.to].includes(socket.id)) {
      clearFileRequest(channel, requestId);
    }
  });

  socket.on("disconnect", () => {
    const room = socket.data.roomId;
    if (!room) {
      return;
    }

    const channel = rooms.get(room);
    for (const [requestId, request] of channel?.fileRequests || []) {
      if (request.from === socket.id || request.to === socket.id) {
        const other = request.from === socket.id ? request.to : request.from;
        io.to(other).emit("file-cancel", { requestId });
        clearFileRequest(channel, requestId);
      }
    }
    channel?.members.delete(socket.id);
    if (channel?.members.size === 0) {
      rooms.delete(room);
    } else {
      socket.to(room).emit("peer-left", { id: socket.id });
    }
  });
});

function allowSignal(socket) {
  const now = Date.now();
  socket.data.signalTimes = (socket.data.signalTimes || [])
    .filter((timestamp) => now - timestamp < SIGNAL_WINDOW_MS);
  if (socket.data.signalTimes.length >= MAX_SIGNALS_PER_WINDOW) return false;
  socket.data.signalTimes.push(now);
  return true;
}

server.listen(PORT, () => {
  console.log(JSON.stringify({ event: "server_listening", port: PORT }));
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    console.log(JSON.stringify({ event: "shutdown_started", signal }));
    io.close(() => {
      console.log(JSON.stringify({ event: "server_stopped" }));
    });
  });
}
