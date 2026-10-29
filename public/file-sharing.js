(() => {
  const DEFAULT_MAX_FILE_SIZE = 12_000_000_000;
  const MAX_IN_MEMORY_FILE_SIZE = 200 * 1024 * 1024;
  const MIN_CHUNK_SIZE = 16 * 1024;
  const ACK_WINDOW_SIZE = 16;
  let maxFileSize = DEFAULT_MAX_FILE_SIZE;
  const CHUNK_SIZE = 64 * 1024;
  const BUFFER_LIMIT = 512 * 1024;
  const BLOCKED_EXTENSIONS = new Set([
    "app", "asp", "aspx", "bat", "cgi", "cmd", "com", "cpl", "css", "dll", "dmg",
    "exe", "htm", "html", "hta", "jar", "js", "jse", "lnk", "mjs", "msi", "php",
    "pl", "ps1", "py", "rb", "reg", "scr", "sh", "svg", "vbs", "wasm", "wsf", "xhtml"
  ]);
  const fileInput = document.getElementById("file-input");
  const recipientSelect = document.getElementById("file-recipient");
  const transferList = document.getElementById("transfer-list");
  const downloadList = document.getElementById("download-list");
  const incomingDialog = document.getElementById("incoming-file-dialog");
  const filePanel = document.getElementById("file-panel");
  const incomingDetails = document.getElementById("incoming-file-details");
  const acceptButton = document.getElementById("accept-file");
  const declineButton = document.getElementById("decline-file");
  const downloadRequestDialog = document.getElementById("download-request-dialog");
  const downloadRequestDetails = document.getElementById("download-request-details");
  const downloadAcceptButton = document.getElementById("accept-download-request");
  const downloadDeclineButton = document.getElementById("decline-download-request");
  const transfers = new Map();
  const incomingQueue = [];
  const downloadQueue = [];
  const sharedFiles = new Map();
  let activeRequest;
  let activeDownloadRequest;
  let socket;
  let iceServers = [{ urls: "stun:stun.l.google.com:19302" }];

  function safeFileName(name) {
    return name.replace(/[\\/\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "_").slice(0, 180);
  }

  function validFile(file) {
    if (!file || !(file instanceof File) || file.size < 0 || file.size > maxFileSize) return false;
    if (/[\\/\u0000-\u001f\u007f]/.test(file.name) || /[. ]$/.test(file.name)) return false;
    const extension = file.name.split(".").pop()?.trim().replace(/\.+$/, "").toLowerCase() || "";
    return !BLOCKED_EXTENSIONS.has(extension) && !/[\\/\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(file.name);
  }

  function formatSize(bytes) {
    if (bytes < 1000) return `${bytes} B`;
    if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} KB`;
    if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
    return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  }

  function setStatus(state, status, progress) {
    state.status.textContent = status;
    if (typeof progress === "number") {
      state.progress.value = Math.max(0, Math.min(100, progress));
      const direction = state.direction === "send" ? "الإرسال" : "الاستلام";
      state.progress.setAttribute("aria-label", `تقدم ${direction} ${Math.round(state.progress.value)}%`);
    }
  }

  function createTransfer(id, name, direction) {
    const item = document.createElement("article");
    item.className = "transfer-item";
    const detail = document.createElement("div");
    detail.className = "transfer-detail";
    const title = document.createElement("strong");
    title.textContent = name;
    const status = document.createElement("span");
    status.textContent = direction === "send" ? "بانتظار موافقة المستلم" : "جارٍ الاستلام";
    detail.append(title, status);
    const progress = document.createElement("progress");
    progress.max = 100;
    progress.value = 0;
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "transfer-cancel";
    cancel.textContent = "إلغاء";
    cancel.setAttribute("aria-label", `إلغاء نقل ${name}`);
    item.append(detail, progress, cancel);
    transferList.prepend(item);
    const state = {
      id, name, direction, item, status, progress, cancel, pc: null, channel: null,
      bytes: 0, chunks: [], expectedSize: 0, expectedDigest: "", expectedMime: "",
      readerTimer: null, cancelled: false, pendingCandidates: [], completed: false,
      hashManifest: null, expectedChunkCount: 0, nextChunkIndex: 0, pendingChunk: null,
      sink: null, messageQueue: Promise.resolve(), speedSamples: [], startedAt: 0, waitingAcks: new Map()
    };
    transfers.set(id, state);
    cancel.addEventListener("click", () => cancelTransfer(state, true));
    return state;
  }

  function failTransfer(state, reason) {
    if (!transfers.has(state.id)) return;
    setStatus(state, reason, state.progress.value);
    state.cancel.disabled = true;
    state.channel?.close();
    state.pc?.close();
    state.sink?.abort().catch((error) => console.error("Could not discard incomplete file:", error));
    for (const pending of [...state.waitingAcks.values()]) pending.reject(new Error("Transfer cancelled"));
    if (!state.cancelled) socket?.emit("file-cancel", { requestId: state.id });
    state.cancelled = true;
    state.chunks.length = 0;
    state.hashManifest = null;
    state.file = null;
    clearTimeout(state.readerTimer);
    setTimeout(() => {
      if (transfers.get(state.id) === state) {
        state.item.remove();
        transfers.delete(state.id);
      }
    }, 9000);
  }

  function cancelTransfer(state, notifyPeer) {
    if (!transfers.has(state.id) || state.cancelled) return;
    state.cancelled = true;
    if (notifyPeer) socket?.emit("file-cancel", { requestId: state.id });
    setStatus(state, "تم إلغاء النقل", state.progress.value);
    state.cancel.disabled = true;
    state.channel?.close();
    state.pc?.close();
    state.sink?.abort().catch((error) => console.error("Could not discard cancelled file:", error));
    for (const pending of [...state.waitingAcks.values()]) pending.reject(new Error("Transfer cancelled"));
    state.chunks.length = 0;
    state.hashManifest = null;
    state.file = null;
    clearTimeout(state.readerTimer);
    transfers.delete(state.id);
    setTimeout(() => state.item.remove(), 5000);
  }

  function removeTransfer(state) {
    if (!state) return;
    state.cancelled = true;
    state.channel?.close();
    state.pc?.close();
    state.sink?.abort().catch((error) => console.error("Could not discard disconnected file:", error));
    for (const pending of [...state.waitingAcks.values()]) pending.reject(new Error("Transfer cancelled"));
    state.chunks.length = 0;
    state.hashManifest = null;
    state.file = null;
    clearTimeout(state.readerTimer);
    state.item.remove();
    transfers.delete(state.id);
  }

  function isChannelOpen(channel) {
    return channel.readyState === "open";
  }

  function waitForBuffer(channel, state) {
    if (state.cancelled) return Promise.reject(new Error("Transfer cancelled"));
    if (channel.bufferedAmount <= BUFFER_LIMIT) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        channel.removeEventListener("bufferedamountlow", resume);
        channel.removeEventListener("close", closed);
        reject(new Error("انقطع تقدم النقل أكثر من دقيقتين."));
      }, 120_000);
      const resume = () => {
        clearTimeout(timeout);
        channel.removeEventListener("close", closed);
        if (state.cancelled || !isChannelOpen(channel)) reject(new Error("Transfer cancelled"));
        else resolve();
      };
      const closed = () => {
        clearTimeout(timeout);
        channel.removeEventListener("bufferedamountlow", resume);
        reject(new Error("أُغلق اتصال النقل."));
      };
      channel.addEventListener("bufferedamountlow", resume, { once: true });
      channel.addEventListener("close", closed, { once: true });
    });
  }

  function waitForOpen(channel, state) {
    if (isChannelOpen(channel)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      state.readerTimer = setTimeout(() => reject(new Error("Connection timed out")), 30_000);
      channel.addEventListener("open", () => {
        clearTimeout(state.readerTimer);
        resolve();
      }, { once: true });
      channel.addEventListener("close", () => {
        clearTimeout(state.readerTimer);
        reject(new Error("Connection closed"));
      }, { once: true });
    });
  }

  function bytesToHex(bytes) {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function hasExactKeys(value, keys) {
    return value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === keys.length &&
      keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
  }

  function formatRate(bytesPerSecond) {
    return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MiB/s`;
  }

  function formatDuration(seconds) {
    if (seconds < 60) return `${seconds} ث`;
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return minutes < 60 ? `${minutes} د ${remainder} ث` : `${Math.floor(minutes / 60)} س ${minutes % 60} د`;
  }

  function movingTransferRate(state, bytes) {
    const now = performance.now();
    const lastSample = state.speedSamples[state.speedSamples.length - 1];
    if (!lastSample || now - lastSample.time >= 300) state.speedSamples.push({ time: now, bytes });
    while (state.speedSamples.length > 1 && now - state.speedSamples[0].time > 5_000) state.speedSamples.shift();
    const first = state.speedSamples[0];
    return first && now > first.time ? (bytes - first.bytes) / ((now - first.time) / 1000) : 0;
  }

  function waitForAcknowledgement(state, key) {
    const channel = state.channel;
    if (state.waitingAcks.has(key)) return Promise.reject(new Error("A transfer acknowledgement is already pending."));
    return new Promise((resolve, reject) => {
      const finish = (error) => {
        clearTimeout(timer);
        channel.removeEventListener("close", onClose);
        state.waitingAcks.delete(key);
        if (error) reject(error);
        else resolve();
      };
      const onClose = () => finish(new Error("أُغلق اتصال النقل."));
      const timer = setTimeout(() => finish(new Error("لم يؤكد المستلم حفظ كتلة الملف.")), 120_000);
      state.waitingAcks.set(key, {
        resolve: () => finish(),
        reject: (error) => finish(error)
      });
      channel.addEventListener("close", onClose, { once: true });
    });
  }

  function setupSenderChannel(state, channel) {
    channel.addEventListener("message", (event) => {
      if (typeof event.data !== "string" || event.data.length > 256) {
        failTransfer(state, "وصل رد غير صالح من المستلم.");
        return;
      }
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        failTransfer(state, "تعذّر قراءة إقرار المستلم.");
        return;
      }
      if (!message || typeof message !== "object" || Array.isArray(message)) {
        failTransfer(state, "وصل رد غير صالح من المستلم.");
        return;
      }
      const expectedKey = message.type === "ack" && Number.isSafeInteger(message.index)
        ? message.index
        : message.type === "complete-ack" ? "complete" : null;
      const pending = state.waitingAcks.get(expectedKey);
      const validMessage = expectedKey === "complete"
        ? hasExactKeys(message, ["type"])
        : hasExactKeys(message, ["type", "index"]);
      if (expectedKey === null || !validMessage || !pending) {
        failTransfer(state, "وصل إقرار نقل غير متوقع.");
        return;
      }
      pending.resolve();
    });
  }

  async function sendFile(state, file, target) {
    const channel = state.channel;
    channel.bufferedAmountLowThreshold = BUFFER_LIMIT;
    await waitForOpen(channel, state);
    const negotiatedSize = state.pc.sctp?.maxMessageSize;
    if (Number.isSafeInteger(negotiatedSize) && negotiatedSize < MIN_CHUNK_SIZE) {
      throw new Error("حجم الرسائل الآمن الذي تفاوض عليه المتصفح صغير جداً.");
    }
    const chunkSize = Number.isSafeInteger(negotiatedSize) && negotiatedSize > 0
      ? Math.min(CHUNK_SIZE, negotiatedSize)
      : 16 * 1024;
    const chunkCount = Math.ceil(file.size / chunkSize);
    state.hashManifest = new Uint8Array(chunkCount * 32);
    state.expectedChunkCount = chunkCount;
    state.startedAt = performance.now();
    channel.send(JSON.stringify({
      type: "start",
      name: safeFileName(file.name),
      size: file.size,
      mime: file.type.slice(0, 128),
      chunkSize,
      chunks: chunkCount
    }));

    let acknowledgementBatch = [];
    for (let offset = 0, index = 0; offset < file.size; offset += chunkSize, index += 1) {
      if (state.cancelled) return;
      await waitForBuffer(channel, state);
      const chunk = await file.slice(offset, Math.min(offset + chunkSize, file.size)).arrayBuffer();
      if (state.cancelled) return;
      const chunkHash = new Uint8Array(await crypto.subtle.digest("SHA-256", chunk));
      state.hashManifest.set(chunkHash, index * 32);
      const acknowledgement = waitForAcknowledgement(state, index);
      acknowledgement.catch(() => {});
      acknowledgementBatch.push(acknowledgement);
      channel.send(JSON.stringify({ type: "chunk", index, sha256: bytesToHex(chunkHash) }));
      channel.send(chunk);
      const bytesSent = offset + chunk.byteLength;
      const bytesPerSecond = movingTransferRate(state, bytesSent) || bytesSent / Math.max(0.001, (performance.now() - state.startedAt) / 1000);
      const remainingSeconds = bytesPerSecond ? Math.ceil((file.size - bytesSent) / bytesPerSecond) : 0;
      setStatus(
        state,
        `جارٍ الإرسال · ${formatRate(bytesPerSecond)} · متبقٍ ${formatDuration(remainingSeconds)}`,
        (bytesSent / file.size) * 100
      );
      if (acknowledgementBatch.length >= ACK_WINDOW_SIZE || bytesSent === file.size) {
        await Promise.all(acknowledgementBatch);
        acknowledgementBatch = [];
      }
    }

    const manifestDigest = bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", state.hashManifest)));
    const completionAcknowledgement = waitForAcknowledgement(state, "complete");
    channel.send(JSON.stringify({ type: "complete", requestId: state.id, chunks: chunkCount, manifestDigest }));
    await completionAcknowledgement;
    state.hashManifest = null;
    setStatus(state, "اكتمل الإرسال وتم التحقق من كتل SHA-256", 100);
    state.completed = true;
    state.cancel.disabled = true;
    socket?.emit("file-finish", { requestId: state.id });
    state.pc?.close();
    state.file = null;
    setTimeout(() => transfers.delete(state.id), 5 * 60 * 1000);
  }

  function showDownload(state, blob) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.className = "download-link";
    link.href = url;
    link.download = safeFileName(state.name);
    link.textContent = `تنزيل ${state.name}`;
    const item = document.createElement("div");
    item.className = "download-item";
    const detail = document.createElement("span");
    detail.textContent = `${state.name} · ${formatSize(blob.size)} · تم التحقق من البصمة`;
    item.append(detail, link);
    downloadList.prepend(item);
    setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
  }

  async function finishReceive(state) {
    if (
      state.bytes !== state.expectedSize ||
      state.nextChunkIndex !== state.expectedChunkCount ||
      state.pendingChunk !== null
    ) throw new Error("حجم الملف أو عدد كتل النقل لا يطابق البيانات المعلنة.");
    const digest = await crypto.subtle.digest("SHA-256", state.hashManifest);
    const actualDigest = bytesToHex(new Uint8Array(digest));
    if (actualDigest !== state.expectedDigest) throw new Error("فشل التحقق من سلامة الملف");
    if (state.sink) {
      await state.sink.close();
      state.sink = null;
    } else {
      const blob = new Blob(state.chunks, { type: state.expectedMime || "application/octet-stream" });
      showDownload(state, blob);
    }
    state.chunks.length = 0;
    state.hashManifest = null;
    state.file = null;
    state.completed = true;
    setStatus(
      state,
      state.direction === "receive" && state.expectedSize > MAX_IN_MEMORY_FILE_SIZE
        ? "اكتمل الاستلام وحُفظ الملف؛ تم التحقق من جميع كتل SHA-256"
        : "اكتمل الاستلام — اختر التنزيل؛ تم التحقق من جميع كتل SHA-256",
      100
    );
    state.cancel.disabled = true;
    state.channel?.send(JSON.stringify({ type: "complete-ack" }));
    socket?.emit("file-finish", { requestId: state.id });
  }

  async function processReceiveMessage(state, data) {
    if (state.cancelled) return;
    if (typeof data === "string") {
      if (data.length > 2048) throw new Error("بيانات النقل الوصفية أكبر من الحد المسموح.");
      const message = JSON.parse(data);
      if (message.type === "start") {
        const validChunkCount = Number.isSafeInteger(message.chunks) && message.chunks >= 0;
        const validChunkSize = Number.isSafeInteger(message.chunkSize) &&
          message.chunkSize >= MIN_CHUNK_SIZE && message.chunkSize <= CHUNK_SIZE;
        if (
          state.started ||
          !hasExactKeys(message, ["type", "name", "size", "mime", "chunkSize", "chunks"]) ||
          message.name !== state.name ||
          message.size !== state.file.size ||
          message.mime !== (state.file.type || "") ||
          !Number.isSafeInteger(message.size) ||
          message.size < 0 ||
          message.size > maxFileSize ||
          !validChunkCount ||
          !validChunkSize ||
          message.chunks !== Math.ceil(message.size / message.chunkSize)
        ) throw new Error("بيانات الملف لا تطابق طلب الاستلام.");
        state.expectedSize = message.size;
        state.expectedMime = message.mime;
        state.chunkSize = message.chunkSize;
        state.expectedChunkCount = message.chunks;
        state.hashManifest = new Uint8Array(message.chunks * 32);
        state.startedAt = performance.now();
        state.started = true;
        return;
      }

      if (message.type === "chunk") {
        if (
          !hasExactKeys(message, ["type", "index", "sha256"]) ||
          !state.started ||
          state.pendingChunk ||
          message.index !== state.nextChunkIndex ||
          typeof message.sha256 !== "string" ||
          !/^[0-9a-f]{64}$/.test(message.sha256) ||
          message.index >= state.expectedChunkCount
        ) throw new Error("ترقيم كتلة الملف أو بصمتها غير صالحة.");
        const remaining = state.expectedSize - state.bytes;
        state.pendingChunk = {
          index: message.index,
          hash: message.sha256,
          size: Math.min(state.chunkSize, remaining)
        };
        return;
      }

      if (message.type === "complete") {
        if (
          !hasExactKeys(message, ["type", "requestId", "chunks", "manifestDigest"]) ||
          message.requestId !== state.id ||
          !state.started ||
          message.chunks !== state.expectedChunkCount ||
          typeof message.manifestDigest !== "string" ||
          !/^[0-9a-f]{64}$/.test(message.manifestDigest)
        ) throw new Error("لم يصل الملف كاملاً أو كانت بصمة بيان الكتل غير صالحة.");
        state.expectedDigest = message.manifestDigest;
        await finishReceive(state);
        return;
      }

      throw new Error("نوع رسالة نقل الملف غير معروف.");
    }

    if (!(data instanceof ArrayBuffer) || !state.started || !state.pendingChunk) {
      throw new Error("وصلت كتلة ملف دون بياناتها الوصفية.");
    }
    const pending = state.pendingChunk;
    if (data.byteLength !== pending.size || state.bytes + data.byteLength > state.expectedSize) {
      throw new Error("حجم كتلة الملف لا يطابق القيمة المعلنة.");
    }
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
    if (bytesToHex(hash) !== pending.hash) throw new Error("فشل التحقق من بصمة كتلة الملف.");
    state.hashManifest.set(hash, pending.index * 32);
    if (state.sink) await state.sink.write(data);
    else state.chunks.push(data);
    state.bytes += data.byteLength;
    state.nextChunkIndex += 1;
    state.pendingChunk = null;
    const bytesPerSecond = movingTransferRate(state, state.bytes);
    const remainingSeconds = bytesPerSecond
      ? Math.ceil((state.expectedSize - state.bytes) / bytesPerSecond)
      : 0;
    setStatus(
      state,
      `جارٍ الاستلام · ${formatRate(bytesPerSecond)} · متبقٍ ${formatDuration(remainingSeconds)}`,
      state.expectedSize ? (state.bytes / state.expectedSize) * 100 : 100
    );
    state.channel.send(JSON.stringify({ type: "ack", index: pending.index }));
  }

  function setupReceiverChannel(state, channel) {
    state.channel = channel;
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = BUFFER_LIMIT;
    channel.addEventListener("message", (event) => {
      state.messageQueue = state.messageQueue
        .then(() => processReceiveMessage(state, event.data))
        .catch((error) => {
        console.error("File receive failed:", error);
        failTransfer(state, error.message || "تعذر استلام الملف");
        });
    });
    channel.addEventListener("open", () => {
      clearTimeout(state.readerTimer);
      setStatus(state, "اتصل الطرفان، جارٍ استلام الملف", 0);
    });
    channel.addEventListener("close", () => {
      if (!state.cancelled && !state.completed) failTransfer(state, "انقطع الاتصال قبل اكتمال الملف");
    });
  }

  function sendSignal(state, target, signal) {
    socket?.emit("file-signal", { requestId: state.id, target, signal });
  }

  async function handleFileSignal(message) {
    const { requestId, from, signal } = message || {};
    const state = transfers.get(requestId);
    if (!state || state.cancelled) return;
    const expectedPeer = state.direction === "send" ? state.target : state.sender;
    if (from !== expectedPeer) return;

    try {
      if (state.direction === "send" && signal.description?.type === "answer") {
        await state.pc.setRemoteDescription(signal.description);
      } else if (state.direction === "receive" && signal.description?.type === "offer" && !state.pc) {
        state.pc = new RTCPeerConnection({ iceServers });
        state.pc.ondatachannel = (event) => setupReceiverChannel(state, event.channel);
        state.pc.onicecandidate = (event) => {
          if (event.candidate) sendSignal(state, state.sender, { candidate: event.candidate.toJSON() });
        };
        state.pc.onconnectionstatechange = () => {
          if (state.pc?.connectionState === "failed") failTransfer(state, "تعذر إنشاء اتصال آمن");
        };
        await state.pc.setRemoteDescription(signal.description);
        const answer = await state.pc.createAnswer();
        await state.pc.setLocalDescription(answer);
        sendSignal(state, state.sender, { description: state.pc.localDescription });
      } else if (signal.candidate) {
        if (state.pc?.remoteDescription) await state.pc.addIceCandidate(signal.candidate);
        else state.pendingCandidates.push(signal.candidate);
      } else {
        return;
      }

      if (signal.description && state.pendingCandidates.length) {
        for (const candidate of state.pendingCandidates.splice(0)) {
          await state.pc.addIceCandidate(candidate);
        }
      }
    } catch (error) {
      console.error("File connection negotiation failed:", error);
      failTransfer(state, "تعذر بدء اتصال الملفات");
    }
  }

  async function beginSender(state, target) {
    state.target = target;
    state.pc = new RTCPeerConnection({ iceServers });
    state.channel = state.pc.createDataChannel("sout-file", { ordered: true });
    setupSenderChannel(state, state.channel);
    state.pc.onicecandidate = (event) => {
      if (event.candidate) sendSignal(state, target, { candidate: event.candidate.toJSON() });
    };
    state.pc.onconnectionstatechange = () => {
      if (state.pc?.connectionState === "failed") failTransfer(state, "تعذر إنشاء اتصال آمن");
    };
    state.pc.createOffer()
      .then((offer) => state.pc.setLocalDescription(offer))
      .then(() => sendSignal(state, target, { description: state.pc.localDescription }))
      .then(() => sendFile(state, state.file, target))
      .catch((error) => {
        if (state.cancelled) return;
        console.error("File send failed:", error);
        failTransfer(state, "تعذر إرسال الملف. تحقق من اتصال الطرفين.");
      });
    setStatus(state, "الطرف الآخر وافق، جارٍ الاتصال");
  }

  function showNextRequest() {
    if (activeRequest || !incomingQueue.length) return;
    activeRequest = incomingQueue.shift();
    const { file, senderName } = activeRequest;
    const diskSaveAvailable = typeof window.showSaveFilePicker === "function";
    const saveNote = file.size > MAX_IN_MEMORY_FILE_SIZE
      ? diskSaveAvailable
        ? " سيُحفظ مباشرةً إلى القرص بعد اختيار مكان الحفظ."
        : " لا يدعم هذا المتصفح حفظ الملفات الكبيرة؛ يمكنك الرفض أو فتح التطبيق بمتصفح يدعم اختيار مكان الحفظ."
      : " سيبقى الملف في ذاكرة المتصفح حتى تختار تنزيله.";
    incomingDetails.textContent = `${senderName} يريد إرسال «${file.name}» (${formatSize(file.size)}). لن يبدأ التخزين إلا بعد موافقتك.${saveNote}`;
    acceptButton.disabled = file.size > MAX_IN_MEMORY_FILE_SIZE && !diskSaveAvailable;
    incomingDialog.showModal();
  }

  function showNextDownloadRequest() {
    if (activeDownloadRequest || !downloadQueue.length) return;
    if (incomingDialog.open || activeRequest) return;

    const request = downloadQueue.shift();
    const entry = sharedFiles.get(request.shareId);
    if (!entry) {
      socket?.emit("file-share-unavailable", { shareId: request.shareId, requester: request.requester });
      window.showToast?.("تعذّر العثور على الملف المشترك على جهازك. أعد إضافته إلى المستودع.");
      showNextDownloadRequest();
      return;
    }

    activeDownloadRequest = { ...request, file: entry.file };
    downloadRequestDetails.textContent =
      `${request.requesterName || "أحد المشاركين"} يريد تنزيل «${entry.file.name}» (${formatSize(entry.file.size)}) من جهازك. ` +
      "لن يُرسل أي جزء من الملف قبل موافقتك، وسيُطلب من المستلم قبول الاستلام أيضاً.";
    downloadRequestDialog.showModal();
  }

  async function chooseReceiveSink(request) {
    if (request.file.size <= MAX_IN_MEMORY_FILE_SIZE) return null;
    if (typeof window.showSaveFilePicker !== "function") {
      throw new Error("هذا المتصفح لا يدعم الحفظ المباشر للملفات الأكبر من 200 MiB.");
    }
    const handle = await window.showSaveFilePicker({
      suggestedName: safeFileName(request.file.name)
    });
    return handle.createWritable();
  }

  acceptButton.addEventListener("click", async () => {
    if (!activeRequest || [...transfers.values()].some((state) => state.direction === "receive" && !state.completed)) return;
    const request = activeRequest;
    acceptButton.disabled = true;
    try {
      const sink = await chooseReceiveSink(request);
      if (activeRequest !== request) {
        await sink?.abort();
        return;
      }
      activeRequest = null;
      incomingDialog.close();
      const state = createTransfer(request.requestId, request.file.name, "receive");
      state.sender = request.from;
      state.file = request.file;
      state.sink = sink;
      socket?.emit("file-response", { requestId: request.requestId, accepted: true });
      state.readerTimer = setTimeout(() => failTransfer(state, "انتهت مهلة الاتصال بالمرسل"), 60_000);
      showNextRequest();
      showNextDownloadRequest();
    } catch (error) {
      if (error.name === "AbortError") {
        acceptButton.disabled = false;
        return;
      }
      console.error("Could not prepare the receive destination:", error);
      socket?.emit("file-response", { requestId: request.requestId, accepted: false });
      activeRequest = null;
      incomingDialog.close();
      window.showToast?.(error.message || "تعذر اختيار مكان حفظ الملف.");
      showNextRequest();
      showNextDownloadRequest();
    }
  });

  declineButton.addEventListener("click", () => {
    if (!activeRequest) return;
    socket?.emit("file-response", { requestId: activeRequest.requestId, accepted: false });
    activeRequest = null;
    incomingDialog.close();
    showNextRequest();
    showNextDownloadRequest();
  });
  incomingDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    declineButton.click();
  });

  downloadAcceptButton.addEventListener("click", () => {
    const request = activeDownloadRequest;
    if (!request) return;
    activeDownloadRequest = null;
    downloadRequestDialog.close();
    const entry = sharedFiles.get(request.shareId);
    if (!entry) {
      socket?.emit("file-share-unavailable", { shareId: request.shareId, requester: request.requester });
      window.showToast?.("الملف لم يعد متوفراً على جهازك.");
    } else {
      const started = startFileTransfer(entry.file, request.requester);
      window.showToast?.(started
        ? "بدأ إرسال الملف. بانتظار قبول المستلم."
        : "تعذّر بدء إرسال الملف. تحقق من اتصالك ثم حاول مجدداً.");
    }
    showNextDownloadRequest();
  });

  downloadDeclineButton.addEventListener("click", () => {
    const request = activeDownloadRequest;
    if (!request) return;
    activeDownloadRequest = null;
    downloadRequestDialog.close();
    socket?.emit("file-share-decline", { shareId: request.shareId, requester: request.requester });
    window.showToast?.("أُبلغ صاحب الطلب برفض التنزيل.");
    showNextDownloadRequest();
  });
  downloadRequestDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    downloadDeclineButton.click();
  });

  function startFileTransfer(file, explicitTarget) {
    if (!file) return false;
    if (!validFile(file)) {
      window.showToast?.(`الملف غير مدعوم أو يتجاوز الحد الأقصى ${formatSize(maxFileSize)}.`);
      return false;
    }
    const target = explicitTarget || recipientSelect.value;
    if (!target || !socket?.connected) {
      window.showToast?.("اختر مشاركاً متصلاً أولاً.");
      return false;
    }

    const id = crypto.randomUUID();
    const state = createTransfer(id, file.name, "send");
    state.file = file;
    state.target = target;
    socket.emit("file-request", {
      requestId: id,
      target,
      file: { name: safeFileName(file.name), size: file.size, type: file.type.slice(0, 128) }
    }, (result) => {
      if (result?.error) failTransfer(state, result.error);
    });

    state.readerTimer = setTimeout(() => failTransfer(state, "لم يصل رد المستلم خلال دقيقة"), 60_000);
    return true;
  }

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    startFileTransfer(file);
  });
  filePanel.addEventListener("dragover", (event) => {
    event.preventDefault();
    filePanel.classList.add("is-dragging");
  });
  filePanel.addEventListener("dragleave", (event) => {
    if (!filePanel.contains(event.relatedTarget)) filePanel.classList.remove("is-dragging");
  });
  filePanel.addEventListener("drop", (event) => {
    event.preventDefault();
    filePanel.classList.remove("is-dragging");
    startFileTransfer(event.dataTransfer?.files?.[0]);
  });

  function updatePeers(peerList) {
    const previous = recipientSelect.value;
    recipientSelect.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = peerList.length ? "اختر مستلماً" : "بانتظار مشارك آخر";
    recipientSelect.append(placeholder);
    for (const peer of peerList) {
      const option = document.createElement("option");
      option.value = peer.id;
      option.textContent = peer.name;
      recipientSelect.append(option);
    }
    if (peerList.some((peer) => peer.id === previous)) recipientSelect.value = previous;
  }

  function shareFile(file, acknowledge) {
    const reply = typeof acknowledge === "function" ? acknowledge : () => {};
    if (!file || !validFile(file)) {
      reply({ error: `الملف غير مدعوم أو يتجاوز الحد الأقصى ${formatSize(maxFileSize)}.` });
      return;
    }
    if (!socket?.connected) {
      reply({ error: "انضم إلى القناة أولاً." });
      return;
    }
    if (sharedFiles.size >= 15) {
      reply({ error: "يمكنك إضافة 15 ملفاً كحد أقصى إلى المستودع." });
      return;
    }
    const shareId = crypto.randomUUID();
    sharedFiles.set(shareId, { id: shareId, file });
    socket.emit("file-share-add", {
      shareId,
      file: { name: safeFileName(file.name), size: file.size, type: file.type.slice(0, 128) }
    }, (result) => {
      if (result?.error) {
        sharedFiles.delete(shareId);
        reply(result);
        return;
      }
      reply({ ok: true, shareId });
    });
  }

  function unshareFile(shareId) {
    if (typeof shareId !== "string" || !socket?.connected) return;
    sharedFiles.delete(shareId);
    socket.emit("file-share-remove", { shareId });
  }

  function requestSharedFile(shareId) {
    if (typeof shareId !== "string" || !socket?.connected) return;
    socket.emit("file-share-request", { shareId }, (result) => {
      if (result?.error) {
        window.showToast?.(result.error);
        return;
      }
      window.showToast?.("أُرسل طلب التنزيل إلى صاحب الملف. انتظر موافقته ثم اقبل الاستلام.");
    });
  }

  function handleSharedFileRequest(message) {
    if (!message?.shareId || !message?.requester) return;
    const entry = sharedFiles.get(message.shareId);
    if (!entry) {
      window.showToast?.("تعذّر العثور على الملف المشترك على جهازك. أعد إضافته إلى المستودع.");
      socket?.emit("file-share-unavailable", { shareId: message.shareId, requester: message.requester });
      return;
    }
    const duplicate = downloadQueue.some((request) =>
      request.shareId === message.shareId && request.requester === message.requester
    );
    if (duplicate || (activeDownloadRequest?.shareId === message.shareId && activeDownloadRequest?.requester === message.requester)) {
      return;
    }
    downloadQueue.push(message);
    window.showToast?.(`${message.requesterName || "أحد المشاركين"} يطلب تنزيل «${entry.file.name}»`);
    showNextDownloadRequest();
  }

  function attach(nextSocket, nextIceServers = iceServers, nextMaxFileSize = maxFileSize) {
    if (socket === nextSocket) return;
    cleanup();
    socket = nextSocket;
    iceServers = nextIceServers;
    if (!Number.isSafeInteger(nextMaxFileSize) || nextMaxFileSize < 1 || nextMaxFileSize > DEFAULT_MAX_FILE_SIZE) {
      throw new Error("The server returned an invalid maximum file size.");
    }
    maxFileSize = nextMaxFileSize;
    document.getElementById("file-security-note").textContent =
      `بموافقة المستلم · حتى ${formatSize(maxFileSize)}`;
    if (!socket) return;
    socket.on("file-request", (request) => {
      if (transfers.has(request.requestId) || activeRequest?.requestId === request.requestId) return;
      if (!request.file || !Number.isSafeInteger(request.file.size) || request.file.size < 0 || request.file.size > maxFileSize) {
        socket.emit("file-response", { requestId: request.requestId, accepted: false });
        return;
      }
      incomingQueue.push(request);
      showNextRequest();
    });
    socket.on("file-response", ({ requestId, accepted }) => {
      const state = transfers.get(requestId);
      if (!state || state.direction !== "send") return;
      clearTimeout(state.readerTimer);
      if (!accepted) {
        failTransfer(state, "رفض المستلم الملف");
        return;
      }
      beginSender(state, state.target);
    });
    socket.on("file-signal", handleFileSignal);
    socket.on("file-share-request", handleSharedFileRequest);
    socket.on("file-share-declined", ({ reason } = {}) => {
      window.showToast?.(reason || "رفض صاحب الملف طلب التنزيل.");
    });
    socket.on("file-share-failed", ({ reason } = {}) => {
      window.showToast?.(reason || "تعذّر طلب الملف من صاحبه.");
    });
    socket.on("file-expired", ({ requestId }) => {
      const state = transfers.get(requestId);
      if (state) failTransfer(state, "انتهت صلاحية طلب الملف");
      if (activeRequest?.requestId === requestId) {
        activeRequest = null;
        incomingDialog.close();
        showNextRequest();
      }
      const queuedIndex = incomingQueue.findIndex((request) => request.requestId === requestId);
      if (queuedIndex !== -1) incomingQueue.splice(queuedIndex, 1);
    });
    socket.on("file-cancel", ({ requestId }) => {
      const state = transfers.get(requestId);
      if (state) cancelTransfer(state, false);
      if (activeRequest?.requestId === requestId) {
        activeRequest = null;
        incomingDialog.close();
        showNextRequest();
      }
      const queuedIndex = incomingQueue.findIndex((request) => request.requestId === requestId);
      if (queuedIndex !== -1) incomingQueue.splice(queuedIndex, 1);
    });
    socket.on("disconnect", cleanup);
  }

  function cleanup() {
    for (const state of [...transfers.values()]) {
      removeTransfer(state);
    }
    sharedFiles.clear();
    activeRequest = null;
    incomingQueue.length = 0;
    downloadQueue.length = 0;
    activeDownloadRequest = null;
    if (incomingDialog.open) incomingDialog.close();
    if (downloadRequestDialog.open) downloadRequestDialog.close();
    if (socket) {
      socket.off("file-request");
      socket.off("file-response");
      socket.off("file-signal");
      socket.off("file-share-request");
      socket.off("file-share-declined");
      socket.off("file-share-failed");
      socket.off("file-expired");
      socket.off("file-cancel");
      socket.off("disconnect", cleanup);
    }
    socket = null;
  }

  window.fileSharing = {
    attach,
    updatePeers,
    cleanup,
    shareFile,
    unshareFile,
    requestSharedFile,
    sendFileTo: (file, target) => startFileTransfer(file, target),
    get maxFileSize() { return maxFileSize; }
  };
})();
