(() => {
  const MAX_FILE_SIZE = 8 * 1024 * 1024;
  const CHUNK_SIZE = 64 * 1024;
  const BUFFER_LIMIT = 256 * 1024;
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
  const transfers = new Map();
  const incomingQueue = [];
  let activeRequest;
  let socket;

  function safeFileName(name) {
    return name.replace(/[\\/\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "_").slice(0, 180);
  }

  function validFile(file) {
    if (!file || !(file instanceof File) || file.size < 0 || file.size > MAX_FILE_SIZE) return false;
    if (/[\\/\u0000-\u001f\u007f]/.test(file.name) || /[. ]$/.test(file.name)) return false;
    const extension = file.name.split(".").pop()?.trim().replace(/\.+$/, "").toLowerCase() || "";
    return !BLOCKED_EXTENSIONS.has(extension) && !/[\\/\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(file.name);
  }

  function formatSize(bytes) {
    return bytes < 1024 * 1024
      ? `${Math.max(1, Math.round(bytes / 1024))} KB`
      : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function setStatus(state, status, progress) {
    state.status.textContent = status;
    if (typeof progress === "number") {
      state.progress.value = Math.max(0, Math.min(100, progress));
      state.progress.setAttribute("aria-label", `تقدم الإرسال ${Math.round(state.progress.value)}%`);
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
    const state = { id, name, direction, item, status, progress, cancel, pc: null, channel: null, bytes: 0, chunks: [], expectedSize: 0, expectedDigest: "", readerTimer: null, cancelled: false, pendingCandidates: [], completed: false };
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
    if (!state.cancelled) socket?.emit("file-cancel", { requestId: state.id });
    state.cancelled = true;
    state.chunks.length = 0;
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
    state.chunks.length = 0;
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
    state.chunks.length = 0;
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
        reject(new Error("Network transfer stalled"));
      }, 20_000);
      const resume = () => {
        clearTimeout(timeout);
        if (state.cancelled || !isChannelOpen(channel)) reject(new Error("Transfer cancelled"));
        else resolve();
      };
      channel.addEventListener("bufferedamountlow", resume, { once: true });
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

  async function sendFile(state, file, target) {
    let bytes = await file.arrayBuffer();
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    bytes = null;
    const digest = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const channel = state.channel;
    channel.bufferedAmountLowThreshold = BUFFER_LIMIT;
    await waitForOpen(channel, state);
    channel.send(JSON.stringify({
      type: "start",
      name: safeFileName(file.name),
      size: file.size,
      mime: file.type.slice(0, 128),
      digest
    }));

    for (let offset = 0; offset < file.size; offset += CHUNK_SIZE) {
      if (state.cancelled) return;
      await waitForBuffer(channel, state);
      const chunk = await file.slice(offset, Math.min(offset + CHUNK_SIZE, file.size)).arrayBuffer();
      if (state.cancelled) return;
      channel.send(chunk);
      setStatus(state, "جارٍ الإرسال", ((offset + chunk.byteLength) / file.size) * 100);
    }

    channel.send(JSON.stringify({ type: "complete", requestId: state.id }));
    setStatus(state, "اكتمل الإرسال والتحقق من بصمة الملف", 100);
    state.completed = true;
    state.cancel.disabled = true;
    socket.emit("file-finish", { requestId: state.id });
    state.pc.close();
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
    if (state.bytes !== state.expectedSize) throw new Error("حجم الملف المستلم لا يطابق الطلب");
    const data = new Uint8Array(state.bytes);
    let offset = 0;
    for (const chunk of state.chunks) {
      data.set(new Uint8Array(chunk), offset);
      offset += chunk.byteLength;
    }
    const digest = await crypto.subtle.digest("SHA-256", data);
    const actualDigest = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (actualDigest !== state.expectedDigest) throw new Error("فشل التحقق من سلامة الملف");
    const blob = new Blob([data], { type: "application/octet-stream" });
    state.chunks.length = 0;
    state.file = null;
    state.completed = true;
    setStatus(state, "اكتمل الاستلام — اختر التنزيل", 100);
    state.cancel.disabled = true;
    showDownload(state, blob);
    socket.emit("file-finish", { requestId: state.id });
    state.pc?.close();
  }

  function setupReceiverChannel(state, channel) {
    state.channel = channel;
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = BUFFER_LIMIT;
    channel.addEventListener("message", async (event) => {
      if (state.cancelled) return;
      try {
        if (typeof event.data === "string") {
          if (event.data.length > 1024) throw new Error("رسالة الملف غير صالحة");
          const message = JSON.parse(event.data);
          if (message.type === "start") {
            if (
              state.started ||
              message.name !== state.name ||
              message.size !== state.file.size ||
              message.mime !== (state.file.type || "") ||
              !Number.isSafeInteger(message.size) ||
              message.size < 0 ||
              message.size > MAX_FILE_SIZE ||
              typeof message.digest !== "string" ||
              !/^[0-9a-f]{64}$/.test(message.digest)
            ) throw new Error("بيانات الملف لا تطابق الطلب");
            state.expectedSize = message.size;
            state.expectedDigest = message.digest;
            state.started = true;
            return;
          }
          if (message.type === "complete") {
            if (message.requestId !== state.id || !state.started || !state.expectedDigest) throw new Error("لم يصل الملف كاملاً");
            await finishReceive(state);
          }
          return;
        }

        if (!(event.data instanceof ArrayBuffer) || event.data.byteLength > CHUNK_SIZE || !state.expectedDigest) {
          throw new Error("بيانات الملف غير متوقعة");
        }
        if (state.bytes + event.data.byteLength > state.expectedSize || state.bytes + event.data.byteLength > MAX_FILE_SIZE) {
          throw new Error("تجاوز الملف الحجم المتوقع");
        }
        state.chunks.push(event.data);
        state.bytes += event.data.byteLength;
        setStatus(state, "جارٍ الاستلام", (state.bytes / state.expectedSize) * 100);
      } catch (error) {
        console.error("File receive failed:", error);
        failTransfer(state, error.message || "تعذر استلام الملف");
      }
    });
    channel.addEventListener("open", () => {
      clearTimeout(state.readerTimer);
      setStatus(state, "اتصل الطرفان، جارٍ استلام الملف", 0);
    });
    channel.addEventListener("close", () => {
      if (!state.cancelled && state.progress.value < 100) failTransfer(state, "انقطع الاتصال قبل اكتمال الملف");
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
        state.pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
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
    state.pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    state.channel = state.pc.createDataChannel("sout-file", { ordered: true });
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
    incomingDetails.textContent = `${senderName} يريد إرسال «${file.name}» (${formatSize(file.size)}). لن يُنزّل الملف تلقائياً.`;
    incomingDialog.showModal();
  }

  acceptButton.addEventListener("click", () => {
    if (!activeRequest || [...transfers.values()].some((state) => state.direction === "receive" && !state.completed)) return;
    const request = activeRequest;
    activeRequest = null;
    incomingDialog.close();
    const state = createTransfer(request.requestId, request.file.name, "receive");
    state.sender = request.from;
    state.file = request.file;
    socket?.emit("file-response", { requestId: request.requestId, accepted: true });
    state.readerTimer = setTimeout(() => failTransfer(state, "انتهت مهلة الاتصال بالمرسل"), 60_000);
    showNextRequest();
  });

  declineButton.addEventListener("click", () => {
    if (!activeRequest) return;
    socket?.emit("file-response", { requestId: activeRequest.requestId, accepted: false });
    activeRequest = null;
    incomingDialog.close();
    showNextRequest();
  });
  incomingDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    declineButton.click();
  });

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    if (!validFile(file)) {
      window.showToast?.("الملف غير مدعوم أو يتجاوز الحد الأقصى 8 MB.");
      return;
    }
    const target = recipientSelect.value;
    if (!target || !socket?.connected) {
      window.showToast?.("اختر مشاركاً متصلاً أولاً.");
      return;
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
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;
      if (!validFile(file)) {
        window.showToast?.("الملف غير مدعوم أو يتجاوز الحد الأقصى 8 MB.");
        return;
      }
      if (!fileInput.files || typeof DataTransfer === "undefined") {
        window.showToast?.("اختر الملف باستخدام زر اختيار ملف.");
        return;
      }
      const transfer = new DataTransfer();
      transfer.items.add(file);
      fileInput.files = transfer.files;
      fileInput.dispatchEvent(new Event("change"));
    });
    state.readerTimer = setTimeout(() => failTransfer(state, "لم يصل رد المستلم خلال دقيقة"), 60_000);
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

  function attach(nextSocket) {
    if (socket === nextSocket) return;
    cleanup();
    socket = nextSocket;
    if (!socket) return;
    socket.on("file-request", (request) => {
      if (transfers.has(request.requestId) || activeRequest?.requestId === request.requestId) return;
      if (!request.file || !Number.isSafeInteger(request.file.size) || request.file.size < 0 || request.file.size > MAX_FILE_SIZE) {
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
    activeRequest = null;
    incomingQueue.length = 0;
    if (incomingDialog.open) incomingDialog.close();
    if (socket) {
      socket.off("file-request");
      socket.off("file-response");
      socket.off("file-signal");
      socket.off("file-expired");
      socket.off("file-cancel");
      socket.off("disconnect", cleanup);
    }
    socket = null;
  }

  window.fileSharing = { attach, updatePeers, cleanup, maxFileSize: MAX_FILE_SIZE };
})();
