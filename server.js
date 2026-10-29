const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const { promisify } = require("node:util");
const express = require("express");
const { Server } = require("socket.io");

const scrypt = promisify(crypto.scrypt);
const app = express();
app.disable("x-powered-by");
const server = http.createServer(app);
const DATA_DIRECTORY = path.join(__dirname, "data");
const AVATAR_DIRECTORY = path.join(DATA_DIRECTORY, "avatars");
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_AVATAR_SIZE = 2 * 1024 * 1024;
const DEFAULT_MAX_FILE_SIZE = 12_000_000_000;
const MAX_FILE_SIZE = process.env.MAX_FILE_SIZE === undefined
  ? DEFAULT_MAX_FILE_SIZE
  : Number(process.env.MAX_FILE_SIZE);
if (!Number.isSafeInteger(MAX_FILE_SIZE) || MAX_FILE_SIZE < 1 || MAX_FILE_SIZE > DEFAULT_MAX_FILE_SIZE) {
  throw new Error("MAX_FILE_SIZE must be an integer between 1 and 12000000000 bytes.");
}
let users = [];
let profiles = {};
let sessions = [];
let storageQueue = Promise.resolve();
const authAttempts = new Map();
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
const MAX_PENDING_FILES_PER_ROOM = 12;
const MAX_ROOM_MEMBERS = 8;
const FILE_REQUEST_WINDOW_MS = 60 * 1000;
const MAX_FILE_REQUESTS_PER_WINDOW = 4;
const FILE_REQUEST_TTL_MS = 60 * 1000;
const SIGNAL_WINDOW_MS = 10 * 1000;
const MAX_SIGNALS_PER_WINDOW = 100;
const MAX_CHAT_MESSAGE_LENGTH = 800;
const MAX_CHAT_HISTORY = 80;
const MAX_SHARED_FILES_PER_ROOM = 40;
const MAX_SHARED_FILES_PER_MEMBER = 15;
const MAX_ROOM_DIRECTORY_ENTRIES = 60;
const EVENT_LIMITS = {
  "join-room": { count: 5, windowMs: 60 * 1000 },
  "peer-status": { count: 30, windowMs: 10 * 1000 },
  "file-response": { count: 20, windowMs: 10 * 1000 },
  "file-cancel": { count: 30, windowMs: 10 * 1000 },
  "file-finish": { count: 30, windowMs: 10 * 1000 },
  "chat-message": { count: 20, windowMs: 10 * 1000 },
  "chat-typing": { count: 40, windowMs: 10 * 1000 },
  "hand": { count: 15, windowMs: 10 * 1000 },
  "room-directory": { count: 20, windowMs: 60 * 1000 },
  "file-share-add": { count: 10, windowMs: 60 * 1000 },
  "file-share-remove": { count: 20, windowMs: 60 * 1000 },
  "file-share-request": { count: 10, windowMs: 60 * 1000 },
  "file-share-decline": { count: 20, windowMs: 60 * 1000 }
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
app.use("/api", express.json({ limit: "3mb", strict: true }));

function publicProfile(userId) {
  const profile = profiles[userId];
  if (!profile) return null;
  return {
    displayName: profile.displayName,
    avatarUrl: profile.avatarFileName
      ? `/api/avatars/${userId}?v=${encodeURIComponent(profile.avatarFileName)}`
      : null
  };
}

function requestSession(request) {
  const token = request.headers.cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("sout_session="))
    ?.slice("sout_session=".length);
  if (!token || !/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  return sessions.find((session) => session.tokenHash === tokenHash && session.expiresAt > Date.now()) || null;
}

function sessionUser(session) {
  if (!session) return null;
  const user = users.find((entry) => entry.id === session.userId);
  const profile = publicProfile(session.userId);
  return user && profile ? { id: user.id, username: user.username, ...profile } : null;
}

function requestHasAllowedOrigin(request) {
  const origin = request.get("origin");
  if (!origin) return true;
  let parsedOrigin;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    return false;
  }
  if (!["http:", "https:"].includes(parsedOrigin.protocol)) return false;
  if (allowedOriginSet.size) return allowedOriginSet.has(parsedOrigin.origin);
  return Boolean(request.get("host")) && parsedOrigin.host.toLowerCase() === request.get("host").toLowerCase();
}

function verifyCsrf(request, response, session) {
  const token = request.get("x-csrf-token");
  if (
    !requestHasAllowedOrigin(request) ||
    !token ||
    token.length !== session.csrfToken.length ||
    !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(session.csrfToken))
  ) {
    response.status(403).json({ error: "انتهت صلاحية الجلسة أو تعذّر التحقق من الطلب." });
    return false;
  }
  return true;
}

function setSessionCookie(response, token, maxAgeSeconds) {
  const flags = ["Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSeconds}`];
  if (process.env.NODE_ENV === "production") flags.push("Secure");
  response.setHeader("Set-Cookie", `sout_session=${token}; ${flags.join("; ")}`);
}

function clearSessionCookie(response) {
  const flags = ["Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (process.env.NODE_ENV === "production") flags.push("Secure");
  response.setHeader("Set-Cookie", `sout_session=; ${flags.join("; ")}`);
}

async function createSession(response, user) {
  const token = crypto.randomBytes(32).toString("base64url");
  const session = {
    tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
    userId: user.id,
    csrfToken: crypto.randomBytes(32).toString("base64url"),
    expiresAt: Date.now() + SESSION_TTL_MS
  };
  sessions = sessions.filter((entry) => entry.expiresAt > Date.now());
  sessions.push(session);
  try {
    await writeJsonFile("sessions.json", sessions);
  } catch (error) {
    sessions = sessions.filter((entry) => entry.tokenHash !== session.tokenHash);
    throw error;
  }
  setSessionCookie(response, token, Math.floor(SESSION_TTL_MS / 1000));
  return session;
}

function authRateLimited(request, kind) {
  const now = Date.now();
  const key = `${kind}:${request.ip}`;
  const limit = kind === "register" ? 5 : 10;
  const windowMs = 15 * 60 * 1000;
  const existing = authAttempts.get(key);
  if (!existing || existing.resetAt <= now) {
    authAttempts.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  existing.count += 1;
  return existing.count > limit;
}

function normalizeUsername(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function validUsername(value) {
  return /^[a-z0-9_-]{3,32}$/.test(value);
}

function validPassword(value) {
  return typeof value === "string" && value.length >= 10 && value.length <= 128;
}

function validDisplayName(value) {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= 32 &&
    !/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(value);
}

function avatarFromDataUrl(dataUrl) {
  if (typeof dataUrl !== "string" || dataUrl.length > Math.ceil(MAX_AVATAR_SIZE * 4 / 3) + 128) {
    throw new Error("حجم الصورة يتجاوز 2 MiB.");
  }
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) throw new Error("اختر صورة JPG أو PNG أو WebP صالحة.");
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > MAX_AVATAR_SIZE || buffer.toString("base64") !== match[2]) {
    throw new Error("حجم الصورة أو ترميزها غير صالح.");
  }
  const mimeType = `image/${match[1]}`;
  const validSignature =
    (mimeType === "image/jpeg" && buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) ||
    (mimeType === "image/png" && buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
    (mimeType === "image/webp" && buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP");
  if (!validSignature) throw new Error("محتوى الصورة لا يطابق نوع الملف.");
  return { buffer, mimeType, extension: match[1] === "jpeg" ? "jpg" : match[1] };
}

function authenticated(request, response) {
  const session = requestSession(request);
  const user = sessionUser(session);
  if (!session || !user) {
    response.status(401).json({ error: "سجّل الدخول أولاً." });
    return null;
  }
  return { session, user };
}

app.get("/api/me", (request, response) => {
  const session = requestSession(request);
  const user = sessionUser(session);
  response.setHeader("Cache-Control", "no-store");
  response.status(200).json({ user, csrfToken: user ? session.csrfToken : null });
});

app.post("/api/auth/register", async (request, response) => {
  if (!requestHasAllowedOrigin(request)) {
    response.status(403).json({ error: "مصدر الطلب غير مسموح." });
    return;
  }
  if (authRateLimited(request, "register")) {
    response.status(429).json({ error: "محاولات كثيرة. انتظر قليلاً ثم حاول مجدداً." });
    return;
  }
  const { username: rawUsername, password } = request.body || {};
  const username = normalizeUsername(rawUsername);
  if (!hasOnlyKeys(request.body, ["username", "password"]) || !validUsername(username) || !validPassword(password)) {
    response.status(400).json({ error: "اسم المستخدم 3–32 حرفاً إنجليزياً أو رقماً، وكلمة المرور 10–128 محرفاً." });
    return;
  }
  if (users.some((user) => user.username === username)) {
    response.status(409).json({ error: "اسم المستخدم مستخدم بالفعل." });
    return;
  }

  try {
    const salt = crypto.randomBytes(16);
    const passwordHash = await scrypt(password, salt, 64, { N: 32_768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    if (users.some((user) => user.username === username)) {
      response.status(409).json({ error: "اسم المستخدم مستخدم بالفعل." });
      return;
    }
    const user = { id: crypto.randomUUID(), username, salt: salt.toString("hex"), passwordHash: passwordHash.toString("hex") };
    users.push(user);
    profiles[user.id] = { displayName: username, avatarFileName: null, avatarMimeType: null };
    try {
      await writeJsonFile("accounts.json", { users, profiles });
    } catch (error) {
      users = users.filter((entry) => entry.id !== user.id);
      delete profiles[user.id];
      throw error;
    }
    const session = await createSession(response, user);
    response.setHeader("Cache-Control", "no-store");
    response.status(201).json({ user: sessionUser(session), csrfToken: session.csrfToken });
  } catch (error) {
    console.error(JSON.stringify({ event: "account_registration_failed", error: error.message }));
    response.status(500).json({ error: "تعذّر إنشاء الحساب الآن. حاول مجدداً." });
  }
});

app.post("/api/auth/login", async (request, response) => {
  if (!requestHasAllowedOrigin(request)) {
    response.status(403).json({ error: "مصدر الطلب غير مسموح." });
    return;
  }
  if (authRateLimited(request, "login")) {
    response.status(429).json({ error: "محاولات كثيرة. انتظر قليلاً ثم حاول مجدداً." });
    return;
  }
  const { username: rawUsername, password } = request.body || {};
  const username = normalizeUsername(rawUsername);
  if (!hasOnlyKeys(request.body, ["username", "password"]) || !validUsername(username) || typeof password !== "string" || password.length > 128) {
    response.status(400).json({ error: "اسم المستخدم أو كلمة المرور غير صالحين." });
    return;
  }

  try {
    const user = users.find((entry) => entry.username === username);
    const salt = user ? Buffer.from(user.salt, "hex") : Buffer.alloc(16, 0x5a);
    const passwordHash = await scrypt(password, salt, 64, { N: 32_768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    const expectedHash = user ? Buffer.from(user.passwordHash, "hex") : Buffer.alloc(64);
    if (!user || expectedHash.length !== passwordHash.length || !crypto.timingSafeEqual(expectedHash, passwordHash)) {
      response.status(401).json({ error: "اسم المستخدم أو كلمة المرور غير صحيحة." });
      return;
    }
    const session = await createSession(response, user);
    response.setHeader("Cache-Control", "no-store");
    response.status(200).json({ user: sessionUser(session), csrfToken: session.csrfToken });
  } catch (error) {
    console.error(JSON.stringify({ event: "account_login_failed", error: error.message }));
    response.status(500).json({ error: "تعذّر تسجيل الدخول الآن. حاول مجدداً." });
  }
});

app.put("/api/profile", async (request, response) => {
  const context = authenticated(request, response);
  if (!context || !verifyCsrf(request, response, context.session)) return;
  if (!hasOnlyKeys(request.body, ["displayName", "avatar"])) {
    response.status(400).json({ error: "بيانات الملف الشخصي غير صالحة." });
    return;
  }
  const { displayName, avatar } = request.body;
  if (!validDisplayName(displayName) || (avatar !== undefined && avatar !== null && typeof avatar !== "string")) {
    response.status(400).json({ error: "تحقق من الاسم والصورة الشخصية." });
    return;
  }

  let nextAvatar = null;
  try {
    if (typeof avatar === "string") nextAvatar = avatarFromDataUrl(avatar);
  } catch (error) {
    response.status(400).json({ error: error.message });
    return;
  }

  const previousProfile = profiles[context.user.id];
  let newAvatarFileName = previousProfile.avatarFileName;
  try {
    if (nextAvatar) {
      newAvatarFileName = `${context.user.id}-${crypto.randomUUID()}.${nextAvatar.extension}`;
      await fs.writeFile(path.join(AVATAR_DIRECTORY, newAvatarFileName), nextAvatar.buffer, { flag: "wx", mode: 0o600 });
    } else if (avatar === null) {
      newAvatarFileName = null;
    }

    profiles[context.user.id] = {
      displayName: displayName.trim(),
      avatarFileName: newAvatarFileName,
      avatarMimeType: nextAvatar?.mimeType ?? (newAvatarFileName ? previousProfile.avatarMimeType : null)
    };
    await writeJsonFile("accounts.json", { users, profiles });
  } catch (error) {
    profiles[context.user.id] = previousProfile;
    if (nextAvatar && newAvatarFileName !== previousProfile.avatarFileName) {
      await fs.unlink(path.join(AVATAR_DIRECTORY, newAvatarFileName)).catch((unlinkError) => {
        console.error(JSON.stringify({ event: "avatar_cleanup_failed", error: unlinkError.message }));
      });
    }
    console.error(JSON.stringify({ event: "profile_update_failed", error: error.message }));
    response.status(500).json({ error: "تعذّر حفظ الملف الشخصي." });
    return;
  }

  if (previousProfile.avatarFileName && previousProfile.avatarFileName !== newAvatarFileName) {
    await fs.unlink(path.join(AVATAR_DIRECTORY, previousProfile.avatarFileName)).catch((error) => {
      console.error(JSON.stringify({ event: "old_avatar_cleanup_failed", error: error.message }));
    });
  }
  const userProfile = publicProfile(context.user.id);
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.userId !== context.user.id || !socket.data.roomId) continue;
    const channel = rooms.get(socket.data.roomId);
    const member = channel?.members.get(socket.id);
    if (member) {
      member.name = userProfile.displayName;
      member.avatarUrl = userProfile.avatarUrl;
      socket.to(socket.data.roomId).emit("peer-profile", { id: socket.id, ...userProfile });
    }
  }
  response.setHeader("Cache-Control", "no-store");
  response.status(200).json({ user: { id: context.user.id, username: context.user.username, ...userProfile } });
});

app.post("/api/auth/logout", async (request, response) => {
  const context = authenticated(request, response);
  if (!context || !verifyCsrf(request, response, context.session)) return;
  const previousSessions = sessions;
  sessions = sessions.filter((session) => session.tokenHash !== context.session.tokenHash);
  try {
    await writeJsonFile("sessions.json", sessions);
  } catch (error) {
    sessions = previousSessions;
    console.error(JSON.stringify({ event: "account_logout_failed", error: error.message }));
    response.status(500).json({ error: "تعذّر إنهاء الجلسة. حاول مجدداً." });
    return;
  }
  clearSessionCookie(response);
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.sessionTokenHash === context.session.tokenHash) socket.disconnect(true);
  }
  response.setHeader("Cache-Control", "no-store");
  response.status(200).json({ ok: true });
});

app.get("/api/avatars/:userId", async (request, response) => {
  const { userId } = request.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
    response.sendStatus(404);
    return;
  }
  const profile = profiles[userId];
  if (!profile?.avatarFileName || !profile.avatarMimeType) {
    response.sendStatus(404);
    return;
  }
  try {
    const image = await fs.readFile(path.join(AVATAR_DIRECTORY, profile.avatarFileName));
    response.setHeader("Content-Type", profile.avatarMimeType);
    response.setHeader("Cache-Control", "public, max-age=3600");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.send(image);
  } catch (error) {
    if (error.code === "ENOENT") {
      response.sendStatus(404);
      return;
    }
    console.error(JSON.stringify({ event: "avatar_read_failed", error: error.message }));
    response.sendStatus(500);
  }
});

app.use((error, request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 500 ? error.status : 500;
  console.error(JSON.stringify({ event: "http_request_failed", status, code: error.code || "internal_error" }));
  response.status(status).json({
    error: status === 413 ? "الطلب يتجاوز الحجم المسموح." : "تعذّر إكمال الطلب."
  });
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

async function loadJsonFile(fileName, fallback) {
  try {
    return JSON.parse(await fs.readFile(path.join(DATA_DIRECTORY, fileName), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

function writeJsonFile(fileName, value) {
  const contents = `${JSON.stringify(value)}\n`;
  const operation = storageQueue.then(async () => {
    const filePath = path.join(DATA_DIRECTORY, fileName);
    const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporaryPath, contents, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await fs.rename(temporaryPath, filePath);
  });
  storageQueue = operation.then(() => undefined, () => undefined);
  return operation;
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

function sanitizeChatText(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/\r\n/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "")
    .trim()
    .slice(0, MAX_CHAT_MESSAGE_LENGTH);
}

function publicSharedFile(share) {
  return {
    id: share.id,
    owner: share.owner,
    ownerName: share.ownerName,
    file: { ...share.file },
    addedAt: share.addedAt,
    downloads: share.downloads
  };
}

function roomSummary(roomId, channel) {
  return {
    id: roomId,
    name: channel.name,
    members: channel.members.size,
    files: channel.sharedFiles.size,
    listed: channel.listed,
    createdAt: channel.createdAt
  };
}

function broadcastDirectory() {
  io.emit("directory-updated");
}

function removeSharedFilesForSocket(channel, socketId) {
  if (!channel) return;
  for (const [shareId, share] of channel.sharedFiles) {
    if (share.owner !== socketId) continue;
    channel.sharedFiles.delete(shareId);
    io.to(channel.roomId).emit("file-share-removed", { shareId });
  }
}

io.use((socket, next) => {
  const session = requestSession({ headers: { cookie: socket.request.headers.cookie } });
  const user = sessionUser(session);
  socket.data.userId = user?.id || null;
  socket.data.sessionTokenHash = session?.tokenHash || null;
  socket.data.user = user;
  next();
});

io.on("connection", (socket) => {
  socket.on("join-room", (payload, acknowledge) => {
    if (typeof acknowledge !== "function") {
      acknowledge = () => {};
    }

    if (!hasOnlyKeys(payload, ["roomId", "name", "roomName", "muted", "listed"]) || !allowEvent(socket, "join-room")) {
      acknowledge({ error: "بيانات الانضمام غير صالحة أو أرسلت طلبات كثيرة." });
      return;
    }

    const { roomId, name, roomName, muted, listed } = payload;
    const room = typeof roomId === "string" ? roomId.trim() : "";
    const requestedDisplayName = typeof name === "string" ? name.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "").trim().slice(0, 32) : "";
    const displayName = socket.data.user?.displayName || requestedDisplayName;
    const avatarUrl = socket.data.user?.avatarUrl || null;
    const requestedRoomName = typeof roomName === "string" ? roomName.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "").trim().slice(0, 48) : "";

    if (
      !/^[\w-]{8,80}$/.test(room) ||
      !displayName ||
      !requestedRoomName ||
      (muted !== undefined && typeof muted !== "boolean") ||
      (listed !== undefined && typeof listed !== "boolean")
    ) {
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
      channel = {
        roomId: room,
        name: requestedRoomName,
        members: new Map(),
        fileRequests: new Map(),
        messages: [],
        sharedFiles: new Map(),
        listed: listed !== false,
        createdAt: Date.now()
      };
      rooms.set(room, channel);
    }

    const peers = Array.from(channel.members, ([id, member]) => ({
      id,
      name: member.name,
      muted: member.muted,
      raised: Boolean(member.raised),
      avatarUrl: member.avatarUrl
    }));

    const isMuted = muted === true;
    channel.members.set(socket.id, { name: displayName, muted: isMuted, raised: false, avatarUrl, userId: socket.data.userId });
    socket.data.roomId = room;
    socket.join(room);
    acknowledge({
      peers,
      roomName: channel.name,
      listed: channel.listed,
      chatHistory: channel.messages.slice(-40),
      sharedFiles: Array.from(channel.sharedFiles.values(), publicSharedFile)
    });
    socket.to(room).emit("peer-joined", { id: socket.id, name: displayName, muted: isMuted, raised: false, avatarUrl });
    broadcastDirectory();
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

  socket.on("hand", (payload) => {
    if (!hasOnlyKeys(payload, ["raised"]) || !allowEvent(socket, "hand")) return;
    const { raised } = payload;
    const room = socket.data.roomId;
    const member = room && rooms.get(room)?.members.get(socket.id);
    if (!member || typeof raised !== "boolean") return;
    member.raised = raised;
    io.to(room).emit("hand", { id: socket.id, name: member.name, raised });
  });

  socket.on("chat-message", (payload, acknowledge) => {
    const reply = typeof acknowledge === "function" ? acknowledge : () => {};
    if (!hasOnlyKeys(payload, ["text"]) || !allowEvent(socket, "chat-message")) {
      reply({ error: "تعذّر إرسال الرسالة. حاول بعد قليل." });
      return;
    }
    const room = socket.data.roomId;
    const channel = room && rooms.get(room);
    const member = channel?.members.get(socket.id);
    const text = sanitizeChatText(payload.text);
    if (!member) {
      reply({ error: "انضم إلى القناة أولاً." });
      return;
    }
    if (!text) {
      reply({ error: "اكتب رسالة قبل الإرسال." });
      return;
    }
    const message = {
      id: crypto.randomUUID(),
      from: socket.id,
      name: member.name,
      text,
      at: Date.now()
    };
    channel.messages.push(message);
    if (channel.messages.length > MAX_CHAT_HISTORY) {
      channel.messages.splice(0, channel.messages.length - MAX_CHAT_HISTORY);
    }
    io.to(room).emit("chat-message", message);
    reply({ ok: true });
  });

  socket.on("chat-typing", (payload) => {
    if (!hasOnlyKeys(payload, ["typing"]) || typeof payload.typing !== "boolean" || !allowEvent(socket, "chat-typing")) return;
    const room = socket.data.roomId;
    const member = room && rooms.get(room)?.members.get(socket.id);
    if (!member) return;
    socket.to(room).emit("chat-typing", { id: socket.id, name: member.name, typing: payload.typing });
  });

  socket.on("room-directory", (payload, acknowledge) => {
    const reply = typeof acknowledge === "function" ? acknowledge : () => {};
    if (!hasOnlyKeys(payload ?? {}, []) || !allowEvent(socket, "room-directory")) {
      reply({ error: "تعذّر تحميل مستودع القنوات." });
      return;
    }
    const entries = Array.from(rooms, ([roomId, channel]) => roomSummary(roomId, channel))
      .filter((entry) => entry.listed)
      .sort((left, right) => right.members - left.members || right.files - left.files)
      .slice(0, MAX_ROOM_DIRECTORY_ENTRIES);
    reply({ rooms: entries });
  });

  socket.on("file-share-add", (payload, acknowledge) => {
    const reply = typeof acknowledge === "function" ? acknowledge : () => {};
    if (!hasOnlyKeys(payload, ["shareId", "file"]) || !allowEvent(socket, "file-share-add")) {
      reply({ error: "بيانات الملف المشترك غير صالحة." });
      return;
    }
    const { shareId, file } = payload;
    const room = socket.data.roomId;
    const channel = room && rooms.get(room);
    const member = channel?.members.get(socket.id);
    if (!channel || !member || !isRequestId(shareId) || !validFileMetadata(file)) {
      reply({ error: "تعذّر إضافة الملف إلى المستودع." });
      return;
    }
    if (channel.sharedFiles.has(shareId)) {
      reply({ error: "الملف موجود في المستودع مسبقاً." });
      return;
    }
    if (channel.sharedFiles.size >= MAX_SHARED_FILES_PER_ROOM) {
      reply({ error: "وصل مستودع القناة إلى الحد الأقصى من الملفات." });
      return;
    }
    const ownedByMember = [...channel.sharedFiles.values()].filter((share) => share.owner === socket.id).length;
    if (ownedByMember >= MAX_SHARED_FILES_PER_MEMBER) {
      reply({ error: "يمكنك إضافة 15 ملفاً كحد أقصى إلى المستودع." });
      return;
    }
    const share = {
      id: shareId,
      owner: socket.id,
      ownerName: member.name,
      file: { ...file },
      addedAt: Date.now(),
      downloads: 0
    };
    channel.sharedFiles.set(shareId, share);
    io.to(room).emit("file-share-added", publicSharedFile(share));
    broadcastDirectory();
    reply({ ok: true });
  });

  socket.on("file-share-remove", (payload, acknowledge) => {
    const reply = typeof acknowledge === "function" ? acknowledge : () => {};
    if (!hasOnlyKeys(payload, ["shareId"]) || !allowEvent(socket, "file-share-remove")) {
      reply({ error: "تعذّر حذف الملف." });
      return;
    }
    const room = socket.data.roomId;
    const channel = room && rooms.get(room);
    const share = channel?.sharedFiles.get(payload.shareId);
    if (!channel || !share || share.owner !== socket.id) {
      reply({ error: "لا يمكنك حذف هذا الملف." });
      return;
    }
    channel.sharedFiles.delete(payload.shareId);
    io.to(room).emit("file-share-removed", { shareId: payload.shareId });
    broadcastDirectory();
    reply({ ok: true });
  });

  socket.on("file-share-request", (payload, acknowledge) => {
    const reply = typeof acknowledge === "function" ? acknowledge : () => {};
    if (!hasOnlyKeys(payload, ["shareId"]) || !allowEvent(socket, "file-share-request")) {
      reply({ error: "تعذّر طلب الملف الآن." });
      return;
    }
    const room = socket.data.roomId;
    const channel = room && rooms.get(room);
    const member = channel?.members.get(socket.id);
    const share = channel?.sharedFiles.get(payload.shareId);
    if (!channel || !member || !share) {
      reply({ error: "الملف غير متوفر في مستودع القناة." });
      return;
    }
    if (share.owner === socket.id) {
      reply({ error: "هذا الملف مضاف من حسابك." });
      return;
    }
    if (!channel.members.has(share.owner)) {
      reply({ error: "صاحب الملف غير متصل الآن. لا يمكن تنزيل الملف إلا عبر P2P." });
      return;
    }
    share.downloads += 1;
    io.to(share.owner).emit("file-share-request", {
      shareId: share.id,
      requester: socket.id,
      requesterName: member.name,
      file: { ...share.file }
    });
    io.to(room).emit("file-share-updated", publicSharedFile(share));
    reply({ ok: true });
  });

  socket.on("file-share-decline", (payload) => {
    if (
      !hasOnlyKeys(payload, ["shareId", "requester"]) ||
      typeof payload.requester !== "string" ||
      !allowEvent(socket, "file-share-decline")
    ) return;
    const room = socket.data.roomId;
    const channel = room && rooms.get(room);
    const share = channel?.sharedFiles.get(payload.shareId);
    if (!channel || !share || share.owner !== socket.id || !channel.members.has(payload.requester)) return;
    io.to(payload.requester).emit("file-share-declined", {
      shareId: payload.shareId,
      reason: "رفض صاحب الملف طلب التنزيل. يمكنك المحاولة لاحقاً أو اختيار ملف آخر."
    });
  });

  socket.on("file-share-unavailable", (payload) => {
    if (!hasOnlyKeys(payload, ["shareId", "requester"]) || typeof payload.requester !== "string") return;
    const room = socket.data.roomId;
    const channel = room && rooms.get(room);
    const share = channel?.sharedFiles.get(payload.shareId);
    if (!channel || !share || share.owner !== socket.id || !channel.members.has(payload.requester)) return;
    io.to(payload.requester).emit("file-share-failed", {
      shareId: payload.shareId,
      reason: "صاحب الملف لم يعد يملك نسخة متاحة على جهازه."
    });
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
    removeSharedFilesForSocket(channel, socket.id);
    channel?.members.delete(socket.id);
    if (channel?.members.size === 0) {
      rooms.delete(room);
    } else {
      socket.to(room).emit("peer-left", { id: socket.id });
    }
    broadcastDirectory();
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

async function initializeStorage() {
  await fs.mkdir(AVATAR_DIRECTORY, { recursive: true, mode: 0o700 });
  const accounts = await loadJsonFile("accounts.json", { users: [], profiles: {} });
  if (
    !isRecord(accounts) ||
    !Array.isArray(accounts.users) ||
    !isRecord(accounts.profiles) ||
    Array.isArray(accounts.profiles)
  ) {
    throw new Error("data/accounts.json has an invalid structure.");
  }
  users = accounts.users;
  profiles = accounts.profiles;
  sessions = await loadJsonFile("sessions.json", []);
  if (!Array.isArray(sessions)) throw new Error("data/sessions.json has an invalid structure.");
  sessions = sessions.filter((session) =>
    isRecord(session) &&
    typeof session.tokenHash === "string" &&
    typeof session.csrfToken === "string" &&
    typeof session.userId === "string" &&
    Number.isSafeInteger(session.expiresAt) &&
    session.expiresAt > Date.now() &&
    users.some((user) => user.id === session.userId)
  );
  await writeJsonFile("sessions.json", sessions);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, () => {
      server.removeListener("error", reject);
      console.log(JSON.stringify({ event: "server_listening", port: PORT, maxFileSize: MAX_FILE_SIZE }));
      resolve();
    });
  });
}

const maintenanceTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, attempt] of authAttempts) {
    if (attempt.resetAt <= now) authAttempts.delete(key);
  }
  const activeSessions = sessions.filter((session) => session.expiresAt > now);
  if (activeSessions.length !== sessions.length) {
    sessions = activeSessions;
    writeJsonFile("sessions.json", sessions).catch((error) => {
      console.error(JSON.stringify({ event: "session_cleanup_failed", error: error.message }));
    });
  }
}, 15 * 60 * 1000);
maintenanceTimer.unref();

initializeStorage().catch((error) => {
  console.error(JSON.stringify({ event: "storage_initialization_failed", error: error.message }));
  process.exitCode = 1;
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    clearInterval(maintenanceTimer);
    console.log(JSON.stringify({ event: "shutdown_started", signal }));
    io.close(() => {
      console.log(JSON.stringify({ event: "server_stopped" }));
    });
  });
}
