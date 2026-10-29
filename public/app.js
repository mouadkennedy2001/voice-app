const root = document.documentElement;
const themeButton = document.getElementById("theme-toggle");
const nameInput = document.getElementById("name-input");
const joinButton = document.getElementById("join-button");
const joinPanel = document.getElementById("join-panel");
const controlPanel = document.getElementById("control-panel");
const formError = document.getElementById("form-error");
const participants = document.getElementById("participants");
const emptyNote = document.getElementById("empty-note");
const selfName = document.getElementById("self-name");
const selfInitial = document.getElementById("self-initial");
const selfAvatar = document.getElementById("self-avatar");
const selfCaption = document.getElementById("self-caption");
const connectionLabel = document.getElementById("connection-label");
const muteButton = document.getElementById("mute-button");
const muteIcon = document.getElementById("mute-icon");
const muteLabel = document.getElementById("mute-label");
const copyButton = document.getElementById("copy-button");
const copyLabel = document.getElementById("copy-label");
const soundButton = document.getElementById("sound-toggle");
const channelTitle = document.getElementById("channel-title");
const channelDialog = document.getElementById("channel-dialog");
const channelForm = document.getElementById("channel-form");
const channelInput = document.getElementById("channel-input");
const channelError = document.getElementById("channel-error");
const toast = document.getElementById("toast");
const filePanel = document.getElementById("file-panel");
const audioDialog = document.getElementById("audio-dialog");
const microphoneSelect = document.getElementById("microphone-select");
const voiceBoost = document.getElementById("voice-boost");
const voiceBoostValue = document.getElementById("voice-boost-value");
const speakerVolume = document.getElementById("speaker-volume");
const speakerVolumeValue = document.getElementById("speaker-volume-value");
const microphoneMeter = document.getElementById("microphone-meter");
const pushToTalk = document.getElementById("push-to-talk");
const microphoneFilter = document.getElementById("microphone-filter");
const screenShareButton = document.getElementById("screen-share-button");
const screenShareLabel = document.getElementById("screen-share-label");
const screenPanel = document.getElementById("screen-panel");
const screenGrid = document.getElementById("screen-grid");
const enableAudioButton = document.getElementById("enable-audio-button");

const params = new URLSearchParams(window.location.search);
let roomId = params.get("room") || crypto.randomUUID();
let roomName = params.get("title")?.trim().slice(0, 48) || "غرفة صوتية";
let currentName = "";
let soundEnabled = localStorage.getItem("sout-sounds") !== "false";
function storedRange(key, fallback, min, max) {
  const stored = localStorage.getItem(key);
  if (stored === null || !Number.isFinite(Number(stored))) return fallback;
  return Math.max(min, Math.min(max, Number(stored)));
}

let audioContext;
let localMonitorCleanup;
let microphoneSource;
let microphoneHighPass;
let microphoneLowPass;
let microphoneGain;
let microphoneCompressor;
let processedStream;
let screenShareStream;
let localScreenTile;
let manualMicMuted = false;
let pushToTalkPressed = false;
let microphonePreferences = {
  deviceId: localStorage.getItem("sout-device") || "",
  noiseSuppression: localStorage.getItem("sout-noise") !== "false",
  microphoneFilter: localStorage.getItem("sout-filter") !== "false",
  echoCancellation: localStorage.getItem("sout-echo") !== "false",
  autoGainControl: localStorage.getItem("sout-autogain") !== "false",
  voiceBoost: storedRange("sout-boost", 1.4, 1, 2.5),
  speakerVolume: storedRange("sout-volume", 1, 0, 1),
  pushToTalk: localStorage.getItem("sout-ptt") === "true"
};
const peers = new Map();
const defaultIceServers = [{ urls: "stun:stun.l.google.com:19302" }];
const defaultMaxFileSize = 8 * 1024 * 1024;
let rtcIceServers = defaultIceServers;
let maxFileSize = defaultMaxFileSize;
let socket;
let localStream;
let toastTimer;
let intentionalLeave = false;

function updateRoomUrl() {
  const urlParams = new URLSearchParams(window.location.search);
  urlParams.set("room", roomId);
  urlParams.set("title", roomName);
  history.replaceState(null, "", `${window.location.pathname}?${urlParams.toString()}`);
}

async function loadIceServers() {
  const response = await fetch("/api/ice", { cache: "no-store" });
  if (!response.ok) throw new Error(`ICE configuration request failed: ${response.status}`);
  const configuration = await response.json();
  if (
    !Array.isArray(configuration.iceServers) ||
    configuration.iceServers.length === 0 ||
    !Number.isSafeInteger(configuration.maxFileSize) ||
    configuration.maxFileSize < 1 ||
    configuration.maxFileSize > defaultMaxFileSize
  ) {
    throw new Error("The server returned invalid connection or file-transfer settings.");
  }
  return configuration;
}

if (!params.has("room") || !params.has("title")) updateRoomUrl();
setRoomName(roomName);

function applyTheme(theme) {
  root.dataset.theme = theme;
  localStorage.setItem("sout-theme", theme);
  document.querySelector('meta[name="theme-color"]').content = theme === "dark" ? "#111116" : "#c4c3b6";
  themeButton.setAttribute("aria-label", theme === "dark" ? "تفعيل المظهر الفاتح" : "تفعيل المظهر الداكن");
}

const savedTheme = localStorage.getItem("sout-theme");
applyTheme(savedTheme === "light" || savedTheme === "dark"
  ? savedTheme
  : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

function updateSoundButton() {
  soundButton.classList.toggle("is-disabled", !soundEnabled);
  soundButton.setAttribute("aria-label", soundEnabled ? "إيقاف أصوات التنبيهات" : "تفعيل أصوات التنبيهات");
  soundButton.title = soundEnabled ? "أصوات التنبيهات مفعّلة" : "أصوات التنبيهات متوقفة";
}

updateSoundButton();

soundButton.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  localStorage.setItem("sout-sounds", String(soundEnabled));
  updateSoundButton();
  showToast(soundEnabled ? "تم تفعيل أصوات التنبيهات" : "تم إيقاف أصوات التنبيهات");
  if (soundEnabled) playNotification("join");
});

function getAudioContext() {
  if (!audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    audioContext = new AudioContextClass();
  }
  if (audioContext.state === "suspended") {
    audioContext.resume().catch((error) => console.error("Could not resume audio context:", error));
  }
  return audioContext;
}

function playNotification(type) {
  if (!soundEnabled) return;
  const context = getAudioContext();
  if (!context) return;

  const now = context.currentTime;
  const notes = type === "join" ? [660, 880] : [520, 390];
  notes.forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = now + index * 0.11;
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.12, start + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.19);
  });
}

function monitorAudio(stream, avatar) {
  const context = getAudioContext();
  if (!context) return () => {};
  const analyser = context.createAnalyser();
  const source = context.createMediaStreamSource(stream);
  const samples = new Uint8Array(analyser.fftSize);
  source.connect(analyser);
  let frame;
  let active = true;

  const measure = () => {
    if (!active) return;
    analyser.getByteTimeDomainData(samples);
    let energy = 0;
    for (const sample of samples) {
      const amplitude = (sample - 128) / 128;
      energy += amplitude * amplitude;
    }
    const level = Math.min(1, Math.sqrt(energy / samples.length) * 5);
    avatar.classList.toggle("talking", level > 0.06);
    if (avatar === selfAvatar) microphoneMeter.dataset.level = String(Math.round(level * 10));
    frame = requestAnimationFrame(measure);
  };
  measure();

  return () => {
    active = false;
    cancelAnimationFrame(frame);
    source.disconnect();
    analyser.disconnect();
    avatar.classList.remove("talking");
    if (avatar === selfAvatar) microphoneMeter.dataset.level = "0";
  };
}

themeButton.addEventListener("click", () => {
  applyTheme(root.dataset.theme === "dark" ? "light" : "dark");
});

nameInput.value = localStorage.getItem("sout-name") || "";
nameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") joinButton.click();
});

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2400);
}

function updateEmptyNote() {
  emptyNote.classList.toggle("hidden", peers.size > 0);
  const connected = !controlPanel.classList.contains("hidden");
  connectionLabel.textContent = peers.size
    ? `معك ${peers.size + 1} في القناة`
    : connected ? "قناتك مباشرة" : "مساحة خاصة";
}

function setRoomName(name) {
  roomName = name.trim().slice(0, 48) || "غرفة صوتية";
  channelTitle.textContent = roomName;
  channelTitle.classList.remove("hidden");
  updateRoomUrl();
}

function addScreenTile(name, stream, isLocal = false) {
  const tile = document.createElement("article");
  tile.className = "screen-tile";
  const heading = document.createElement("span");
  heading.className = "screen-tile-name";
  heading.textContent = isLocal ? `${name} · شاشتك` : `${name} · شاشة مشتركة`;
  const video = document.createElement("video");
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true;
  video.srcObject = stream;
  tile.append(heading, video);
  screenGrid.append(tile);
  screenPanel.classList.remove("hidden");
  video.play().catch((error) => {
    console.error("Could not play shared screen:", error);
    showToast("تعذر عرض الشاشة المشتركة");
  });
  return tile;
}

function removeScreenTile(tile) {
  tile?.remove();
  if (!screenGrid.childElementCount) screenPanel.classList.add("hidden");
}

function createPeer(peer) {
  if (peers.has(peer.id)) return peers.get(peer.id);

  const peerSocket = socket;
  const peerConnection = new RTCPeerConnection({ iceServers: rtcIceServers });
  const screenTransceiver = peerConnection.addTransceiver("video", { direction: "sendrecv" });
  const audio = document.createElement("audio");
  audio.className = "peer-audio";
  audio.autoplay = true;
  audio.playsInline = true;
  document.body.append(audio);

  const person = document.createElement("div");
  person.className = "person-card";
  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.dataset.tone = String(peers.size % 8);
  avatar.textContent = Array.from(peer.name)[0] || "?";
  const name = document.createElement("span");
  name.className = "person-name";
  name.textContent = peer.name;
  const caption = document.createElement("span");
  caption.className = "person-caption";
  caption.textContent = "متصل";
  person.append(avatar, name, caption);
  participants.append(person);

  const state = {
    connection: peerConnection,
    audio,
    person,
    avatar,
    name: peer.name,
    polite: socket.id.localeCompare(peer.id) > 0,
    makingOffer: false,
    ignoreOffer: false,
    isSettingRemoteAnswerPending: false,
    signalQueue: Promise.resolve(),
    pendingCandidates: [],
    iceRestartAttempts: 0,
    iceRestartTimer: null,
    monitorCleanup: null,
    screenSender: screenTransceiver.sender,
    screenTile: null,
    muted: Boolean(peer.muted)
  };
  if (peer.muted) caption.textContent = "الميكروفون مكتوم";
  peers.set(peer.id, state);
  participants.classList.toggle("many", peers.size > 4);
  updateFileRecipients();

  const restartIceConnection = (delay) => {
    clearTimeout(state.iceRestartTimer);
    state.iceRestartTimer = setTimeout(() => {
      const currentState = peerConnection.iceConnectionState;
      if (peerConnection.signalingState === "closed" || currentState === "connected" || currentState === "completed") return;
      if (state.iceRestartAttempts >= 2 || typeof peerConnection.restartIce !== "function") {
        caption.textContent = "تعذّر الاتصال";
        return;
      }

      state.iceRestartAttempts += 1;
      try {
        peerConnection.restartIce();
      } catch (error) {
        console.error("Could not restart ICE:", error);
        caption.textContent = "تعذّر الاتصال";
        return;
      }
      state.iceRestartTimer = setTimeout(() => {
        const latestState = peerConnection.iceConnectionState;
        if (peerConnection.signalingState === "closed" || latestState === "connected" || latestState === "completed") return;
        if (state.iceRestartAttempts < 2) {
          restartIceConnection(0);
        } else {
          caption.textContent = "تعذّر الاتصال";
        }
      }, 12_000);
    }, delay);
  };

  peerConnection.ontrack = (event) => {
    if (event.track.kind === "video") {
      const showScreen = () => {
        if (!state.screenTile) {
          state.screenTile = addScreenTile(peer.name, event.streams[0] || new MediaStream([event.track]));
        }
      };
      const hideScreen = () => {
        removeScreenTile(state.screenTile);
        state.screenTile = null;
      };
      if (!event.track.muted) showScreen();
      event.track.addEventListener("unmute", showScreen);
      event.track.addEventListener("mute", hideScreen);
      event.track.addEventListener("ended", hideScreen, { once: true });
      return;
    }
    audio.srcObject = event.streams[0];
    state.monitorCleanup?.();
    state.monitorCleanup = monitorAudio(event.streams[0], avatar);
    audio.play().catch((error) => {
      console.error("Could not play peer audio:", error);
      enableAudioButton.classList.remove("hidden");
      showToast("اضغط «تفعيل الصوت» للسماح بتشغيل صوت المشاركين");
    });
  };
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) peerSocket.emit("signal", { target: peer.id, signal: { candidate: event.candidate } });
  };
  peerConnection.onnegotiationneeded = async () => {
    try {
      state.makingOffer = true;
      await peerConnection.setLocalDescription();
      peerSocket.emit("signal", { target: peer.id, signal: { description: peerConnection.localDescription } });
    } catch (error) {
      console.error("Could not negotiate with peer:", error);
      showToast("تعذر بدء الاتصال مع أحد المشاركين");
    } finally {
      state.makingOffer = false;
    }
  };
  peerConnection.oniceconnectionstatechange = () => {
    const iceState = peerConnection.iceConnectionState;
    if (iceState === "connected" || iceState === "completed") {
      clearTimeout(state.iceRestartTimer);
      state.iceRestartTimer = null;
      state.iceRestartAttempts = 0;
      caption.textContent = state.muted ? "الميكروفون مكتوم" : "متصل";
      return;
    }
    if (iceState !== "disconnected" && iceState !== "failed") return;
    restartIceConnection(iceState === "disconnected" ? 5_000 : 0);
  };
  peerConnection.onconnectionstatechange = () => {
    if (peerConnection.connectionState === "connected") caption.textContent = state.muted ? "الميكروفون مكتوم" : "متصل";
    if (peerConnection.connectionState === "failed") caption.textContent = "تعذّر الاتصال";
  };

  if (localStream) {
    (processedStream || localStream).getTracks().forEach((track) => peerConnection.addTrack(track, processedStream || localStream));
    audio.volume = microphonePreferences.speakerVolume;
  }

  if (screenShareStream) {
    state.screenSender.replaceTrack(screenShareStream.getVideoTracks()[0])
      .catch((error) => {
        console.error("Could not share screen with a new participant:", error);
        showToast("تعذر مشاركة الشاشة مع مشارك جديد");
      });
  }

  updateEmptyNote();

  return state;
}

function removePeer(peerId) {
  const peer = peers.get(peerId);
  if (!peer) return;
  clearTimeout(peer.iceRestartTimer);
  peer.connection.close();
  peer.monitorCleanup?.();
  removeScreenTile(peer.screenTile);
  peer.audio.remove();
  peer.person.remove();
  peers.delete(peerId);
  participants.classList.toggle("many", peers.size > 4);
  updateFileRecipients();
  updateEmptyNote();
}

function clearPeers() {
  peers.forEach((peer) => {
    clearTimeout(peer.iceRestartTimer);
    peer.connection.close();
    peer.monitorCleanup?.();
    removeScreenTile(peer.screenTile);
    peer.audio.remove();
    peer.person.remove();
  });
  peers.clear();
  participants.classList.remove("many");
  updateFileRecipients();
  updateEmptyNote();
}

function connectToRoom(name) {
  const roomSocket = io();
  let connectionSetup = 0;
  socket = roomSocket;
  roomSocket.on("connect_error", (error) => {
    if (controlPanel.classList.contains("hidden")) {
      formError.textContent = `تعذر الاتصال بالخادم: ${error.message}`;
      joinButton.disabled = false;
      joinButton.querySelector("span").textContent = "انضم للمحادثة";
      localStream?.getTracks().forEach((track) => track.stop());
      localStream = null;
      currentName = "";
      intentionalLeave = true;
      roomSocket.disconnect();
      if (socket === roomSocket) socket = null;
    } else {
      connectionLabel.textContent = "يعاد الاتصال...";
      showToast("تعذر الاتصال بالخادم، جارٍ إعادة المحاولة");
    }
  });

  roomSocket.on("connect", async () => {
    const setup = ++connectionSetup;
    intentionalLeave = false;
    try {
      const configuration = await loadIceServers();
      rtcIceServers = configuration.iceServers;
      maxFileSize = configuration.maxFileSize;
    } catch (error) {
      console.error("Could not load ICE server configuration:", error);
      rtcIceServers = defaultIceServers;
      maxFileSize = defaultMaxFileSize;
      showToast("تعذر تحميل إعدادات TURN؛ ستُجرَّب الاتصالات المباشرة فقط");
    }
    if (setup !== connectionSetup || socket !== roomSocket || !roomSocket.connected) return;
    if (!controlPanel.classList.contains("hidden")) {
      clearPeers();
    }

    const muted = localStream.getAudioTracks()[0]?.enabled === false;
    roomSocket.emit("join-room", { roomId, name, roomName, muted }, (result) => {
      if (setup !== connectionSetup || socket !== roomSocket || !roomSocket.connected) return;
      if (result?.error) {
        formError.textContent = result.error;
        if (controlPanel.classList.contains("hidden")) {
          joinButton.disabled = false;
          joinButton.querySelector("span").textContent = "انضم للمحادثة";
          localStream?.getTracks().forEach((track) => track.stop());
          localStream = null;
          currentName = "";
          intentionalLeave = true;
          roomSocket.disconnect();
          if (socket === roomSocket) socket = null;
        } else {
          showToast(result.error);
        }
        return;
      }

      joinPanel.classList.add("hidden");
      controlPanel.classList.remove("hidden");
      filePanel.classList.remove("hidden");
      selfName.textContent = name;
      selfInitial.textContent = Array.from(name)[0] || "?";
      selfCaption.textContent = muted ? "الميكروفون مكتوم" : "متصل";
      updateMuteButton(muted);
      setRoomName(result.roomName);
      localMonitorCleanup?.();
      localMonitorCleanup = monitorAudio(localStream, selfAvatar);
      applyMicrophoneMuteState();
      fileSharing.attach(roomSocket, rtcIceServers, maxFileSize);
      result.peers.forEach(createPeer);
      updateFileRecipients();
      updateEmptyNote();
    });
  });
  roomSocket.on("disconnect", () => {
    connectionSetup += 1;
    if (socket === roomSocket && !intentionalLeave && !controlPanel.classList.contains("hidden")) {
      clearPeers();
      fileSharing.cleanup();
      localMonitorCleanup?.();
      localMonitorCleanup = null;
      connectionLabel.textContent = "يعاد الاتصال...";
      showToast("انقطع الاتصال، جارٍ إعادة المحاولة");
    }
  });
  roomSocket.on("peer-joined", (peer) => {
    createPeer(peer);
    showToast(`${peer.name} انضم إلى القناة`);
    playNotification("join");
  });
  roomSocket.on("peer-left", ({ id }) => {
    const peer = peers.get(id);
    if (peer) {
      showToast(`${peer.name} غادر القناة`);
      playNotification("leave");
    }
    removePeer(id);
  });
  roomSocket.on("peer-status", ({ id, muted }) => {
    const peer = peers.get(id);
    if (peer) {
      peer.muted = muted;
      const caption = peer.person.querySelector(".person-caption");
      caption.textContent = muted ? "الميكروفون مكتوم" : "متصل";
    }
  });
  roomSocket.on("signal", ({ from, signal }) => {
    const peer = peers.get(from);
    if (!peer) return;
    peer.signalQueue = peer.signalQueue
      .then(async () => {
        if (signal.description) {
          const offerCollision = signal.description.type === "offer" &&
            (peer.makingOffer || (peer.connection.signalingState !== "stable" && !peer.isSettingRemoteAnswerPending));
          peer.ignoreOffer = !peer.polite && offerCollision;
          if (peer.ignoreOffer) return;

          peer.isSettingRemoteAnswerPending = signal.description.type === "answer";
          try {
            await peer.connection.setRemoteDescription(signal.description);
          } finally {
            peer.isSettingRemoteAnswerPending = false;
          }
          if (signal.description.type === "offer") {
            await peer.connection.setLocalDescription();
            roomSocket.emit("signal", { target: from, signal: { description: peer.connection.localDescription } });
          }
          const candidates = peer.pendingCandidates.splice(0);
          for (const candidate of candidates) {
            await peer.connection.addIceCandidate(candidate);
          }
        } else if (signal.candidate) {
          if (peer.ignoreOffer) return;
          if (peer.connection.remoteDescription) {
            await peer.connection.addIceCandidate(signal.candidate);
          } else {
            peer.pendingCandidates.push(signal.candidate);
          }
        }
      })
      .catch((error) => {
        console.error("Could not process peer signal:", error);
        showToast("تعذر إنشاء اتصال صوتي. حاول الانضمام مجدداً.");
      });
  });
}

async function joinWithName(name) {
  if (!name) {
    formError.textContent = "اكتب اسمك أولاً للانضمام.";
    nameInput.focus();
    return;
  }
  if (name.length > 32) {
    formError.textContent = "يجب ألا يتجاوز الاسم 32 حرفاً.";
    return;
  }

  formError.textContent = "";
  joinButton.disabled = true;
  joinButton.querySelector("span").textContent = "جارٍ الاتصال...";
  try {
    if (!localStream) localStream = await requestMicrophone(microphonePreferences.deviceId);
    await configureOutgoingAudio();
    applyMicrophoneMuteState();
    localStorage.setItem("sout-name", name);
    currentName = name;
    connectToRoom(name);
  } catch (error) {
    console.error("Could not access microphone:", error);
    formError.textContent = microphoneErrorMessage(error);
    joinButton.disabled = false;
    joinButton.querySelector("span").textContent = "انضم للمحادثة";
  }
}

joinButton.addEventListener("click", () => joinWithName(nameInput.value.trim()));

window.showToast = showToast;

function getAudioConstraints(deviceId) {
  const constraints = {
    echoCancellation: microphonePreferences.echoCancellation,
    noiseSuppression: microphonePreferences.noiseSuppression,
    autoGainControl: microphonePreferences.autoGainControl
  };
  if (deviceId) constraints.deviceId = { exact: deviceId };
  return constraints;
}

function microphoneErrorMessage(error) {
  switch (error?.name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "لم يُسمح باستخدام الميكروفون. فعّل الإذن من إعدادات الموقع في المتصفح.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "لم يتم العثور على ميكروفون. وصّل جهازاً ثم حاول مجدداً.";
    case "NotReadableError":
    case "TrackStartError":
      return "الميكروفون مستخدم أو تعذّر تشغيله. أغلق التطبيقات الأخرى التي تستخدمه.";
    case "OverconstrainedError":
      return "تعذّر استخدام إعدادات هذا الميكروفون. اختر جهازاً آخر أو أعد المحاولة.";
    default:
      return "تعذّر الوصول إلى الميكروفون. تحقق من توصيله وأذونات المتصفح.";
  }
}

async function requestMicrophone(deviceId) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("المتصفح لا يدعم الوصول إلى الميكروفون.");
  }
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: getAudioConstraints(deviceId), video: false });
  } catch (error) {
    if (error.name !== "OverconstrainedError") throw error;
    try {
      const audio = deviceId ? { deviceId: { ideal: deviceId } } : true;
      return await navigator.mediaDevices.getUserMedia({ audio, video: false });
    } catch (fallbackError) {
      console.error("Could not retry microphone access with relaxed constraints:", fallbackError);
      throw error;
    }
  }
}

function configureMicrophoneFilter(highPass = microphoneHighPass, lowPass = microphoneLowPass) {
  if (!highPass || !lowPass) return;
  const maximumFrequency = highPass.context.sampleRate / 2;
  highPass.frequency.value = microphonePreferences.microphoneFilter ? Math.min(80, maximumFrequency) : 10;
  lowPass.frequency.value = microphonePreferences.microphoneFilter ? Math.min(10000, maximumFrequency) : maximumFrequency;
}

function createOutgoingAudioPipeline(stream) {
  const context = getAudioContext();
  if (!context || !stream) return { stream, source: null, highPass: null, lowPass: null, gain: null, compressor: null };
  const source = context.createMediaStreamSource(stream);
  const highPass = context.createBiquadFilter();
  highPass.type = "highpass";
  highPass.Q.value = 0.707;
  const lowPass = context.createBiquadFilter();
  lowPass.type = "lowpass";
  lowPass.Q.value = 0.707;
  configureMicrophoneFilter(highPass, lowPass);
  const gain = context.createGain();
  gain.gain.value = microphonePreferences.voiceBoost;
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -12;
  compressor.knee.value = 6;
  compressor.ratio.value = 10;
  compressor.attack.value = 0.005;
  compressor.release.value = 0.18;
  const destination = context.createMediaStreamDestination();
  source.connect(highPass);
  highPass.connect(lowPass);
  lowPass.connect(gain);
  gain.connect(compressor);
  compressor.connect(destination);
  return { stream: destination.stream, source, highPass, lowPass, gain, compressor };
}

function disposeAudioPipeline(pipelineStream, source, gain, compressor, highPass, lowPass) {
  source?.disconnect();
  highPass?.disconnect();
  lowPass?.disconnect();
  gain?.disconnect();
  compressor?.disconnect();
  pipelineStream?.getTracks().forEach((track) => track.stop());
}

function configureOutgoingAudio() {
  const previous = {
    stream: processedStream,
    source: microphoneSource,
    highPass: microphoneHighPass,
    lowPass: microphoneLowPass,
    gain: microphoneGain,
    compressor: microphoneCompressor
  };
  const next = createOutgoingAudioPipeline(localStream);
  processedStream = next.stream;
  microphoneSource = next.source;
  microphoneHighPass = next.highPass;
  microphoneLowPass = next.lowPass;
  microphoneGain = next.gain;
  microphoneCompressor = next.compressor;
  disposeAudioPipeline(previous.stream, previous.source, previous.gain, previous.compressor, previous.highPass, previous.lowPass);
}

function updateFileRecipients() {
  fileSharing.updatePeers(Array.from(peers, ([id, peer]) => ({ id, name: peer.name })));
}

function currentMuteState() {
  return Boolean(manualMicMuted || (pushToTalk.checked && !pushToTalkPressed));
}

function applyMicrophoneMuteState() {
  const track = localStream?.getAudioTracks()[0];
  if (!track) return;
  const muted = currentMuteState();
  track.enabled = !muted;
  updateMuteButton(muted);
  selfCaption.textContent = muted ? "الميكروفون مكتوم" : "متصل";
  socket?.emit("peer-status", { muted });
}

async function applyMicrophoneConstraints() {
  const track = localStream?.getAudioTracks()[0];
  if (!track) return;
  try {
    await track.applyConstraints(getAudioConstraints());
  } catch (error) {
    console.error("Could not apply microphone processing preferences:", error);
    showToast("تعذر تطبيق إعداد معالجة الصوت على هذا الميكروفون");
  }
}

async function loadMicrophoneDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const previous = microphoneSelect.value || microphonePreferences.deviceId;
    microphoneSelect.replaceChildren();
    for (const [index, device] of devices.filter((entry) => entry.kind === "audioinput").entries()) {
      const option = document.createElement("option");
      option.value = device.deviceId;
      option.textContent = device.label || `ميكروفون ${index + 1}`;
      microphoneSelect.append(option);
    }
    microphoneSelect.value = previous;
  } catch (error) {
    console.error("Could not enumerate microphones:", error);
    showToast("تعذر عرض أجهزة الميكروفون");
  }
}

navigator.mediaDevices?.addEventListener?.("devicechange", async () => {
  await loadMicrophoneDevices();
  if (!microphonePreferences.deviceId || microphoneSelect.value) return;
  if (!localStream) {
    microphonePreferences.deviceId = "";
    localStorage.setItem("sout-device", "");
    showToast("فُصل الميكروفون المحدد؛ سيُستخدم الجهاز الافتراضي عند الانضمام");
    return;
  }
  microphoneSelect.dispatchEvent(new Event("change"));
  showToast("فُصل الميكروفون المحدد؛ جارٍ الانتقال إلى الجهاز الافتراضي");
});

function initializeAudioSettings() {
  voiceBoost.value = String(Math.max(1, Math.min(2.5, microphonePreferences.voiceBoost)));
  voiceBoostValue.value = `${Number(voiceBoost.value).toFixed(1)}×`;
  speakerVolume.value = String(Math.max(0, Math.min(1, microphonePreferences.speakerVolume)));
  speakerVolumeValue.value = `${Math.round(Number(speakerVolume.value) * 100)}%`;
  document.getElementById("noise-suppression").checked = microphonePreferences.noiseSuppression;
  microphoneFilter.checked = microphonePreferences.microphoneFilter;
  document.getElementById("echo-cancellation").checked = microphonePreferences.echoCancellation;
  document.getElementById("auto-gain").checked = microphonePreferences.autoGainControl;
  pushToTalk.checked = microphonePreferences.pushToTalk;
  microphoneSelect.value = microphonePreferences.deviceId;
}

initializeAudioSettings();

document.getElementById("audio-settings-button").addEventListener("click", () => {
  audioDialog.showModal();
  loadMicrophoneDevices();
});
document.getElementById("prejoin-audio-button").addEventListener("click", () => {
  audioDialog.showModal();
  loadMicrophoneDevices();
});
document.getElementById("audio-dialog-close").addEventListener("click", () => audioDialog.close());
voiceBoost.addEventListener("input", () => {
  microphonePreferences.voiceBoost = Number(voiceBoost.value);
  voiceBoostValue.value = `${microphonePreferences.voiceBoost.toFixed(1)}×`;
  localStorage.setItem("sout-boost", String(microphonePreferences.voiceBoost));
  if (microphoneGain) microphoneGain.gain.setTargetAtTime(microphonePreferences.voiceBoost, audioContext.currentTime, 0.04);
});
speakerVolume.addEventListener("input", () => {
  microphonePreferences.speakerVolume = Number(speakerVolume.value);
  speakerVolumeValue.value = `${Math.round(microphonePreferences.speakerVolume * 100)}%`;
  localStorage.setItem("sout-volume", String(microphonePreferences.speakerVolume));
  peers.forEach((peer) => { peer.audio.volume = microphonePreferences.speakerVolume; });
});
document.getElementById("noise-suppression").addEventListener("change", (event) => {
  microphonePreferences.noiseSuppression = event.target.checked;
  localStorage.setItem("sout-noise", String(event.target.checked));
  applyMicrophoneConstraints();
});
microphoneFilter.addEventListener("change", () => {
  microphonePreferences.microphoneFilter = microphoneFilter.checked;
  localStorage.setItem("sout-filter", String(microphoneFilter.checked));
  configureMicrophoneFilter();
  showToast(microphoneFilter.checked ? "تم تفعيل فلتر الميكروفون" : "تم إيقاف فلتر الميكروفون");
});
document.getElementById("echo-cancellation").addEventListener("change", (event) => {
  microphonePreferences.echoCancellation = event.target.checked;
  localStorage.setItem("sout-echo", String(event.target.checked));
  applyMicrophoneConstraints();
});
document.getElementById("auto-gain").addEventListener("change", (event) => {
  microphonePreferences.autoGainControl = event.target.checked;
  localStorage.setItem("sout-autogain", String(event.target.checked));
  applyMicrophoneConstraints();
});
microphoneSelect.addEventListener("change", async () => {
  const previousDevice = microphonePreferences.deviceId;
  if (!localStream) {
    microphonePreferences.deviceId = microphoneSelect.value;
    localStorage.setItem("sout-device", microphoneSelect.value);
    return;
  }

  let replacement;
  let nextPipeline;
  let previousStream = localStream;
  let previousProcessed = processedStream;
  let senders = [];
  try {
    replacement = await requestMicrophone(microphoneSelect.value);
    const previousPipeline = {
      source: microphoneSource,
      highPass: microphoneHighPass,
      lowPass: microphoneLowPass,
      gain: microphoneGain,
      compressor: microphoneCompressor
    };
    nextPipeline = createOutgoingAudioPipeline(replacement);
    const newTrack = nextPipeline.stream.getAudioTracks()[0];
    for (const peer of peers.values()) {
      const sender = peer.connection.getSenders().find((item) => item.track?.kind === "audio");
      if (sender) senders.push(sender);
    }
    await Promise.all(senders.map((sender) => sender.replaceTrack(newTrack)));
    localStream = replacement;
    processedStream = nextPipeline.stream;
    microphoneSource = nextPipeline.source;
    microphoneHighPass = nextPipeline.highPass;
    microphoneLowPass = nextPipeline.lowPass;
    microphoneGain = nextPipeline.gain;
    microphoneCompressor = nextPipeline.compressor;
    microphonePreferences.deviceId = microphoneSelect.value;
    localStorage.setItem("sout-device", microphoneSelect.value);
    localMonitorCleanup?.();
    localMonitorCleanup = monitorAudio(localStream, selfAvatar);
    previousStream.getTracks().forEach((track) => track.stop());
    disposeAudioPipeline(
      previousProcessed,
      previousPipeline.source,
      previousPipeline.gain,
      previousPipeline.compressor,
      previousPipeline.highPass,
      previousPipeline.lowPass
    );
    applyMicrophoneMuteState();
    showToast("تم تغيير الميكروفون");
  } catch (error) {
    console.error("Could not change microphone:", error);
    const oldTrack = previousProcessed?.getAudioTracks()[0] || previousStream?.getAudioTracks()[0];
    if (oldTrack && senders.length) {
      const rollback = await Promise.allSettled(senders.map((sender) => sender.replaceTrack(oldTrack)));
      rollback.filter((result) => result.status === "rejected").forEach((result) => {
        console.error("Could not restore a previous microphone track:", result.reason);
      });
    }
    if (nextPipeline) {
      disposeAudioPipeline(
        nextPipeline.stream === replacement ? null : nextPipeline.stream,
        nextPipeline.source,
        nextPipeline.gain,
        nextPipeline.compressor,
        nextPipeline.highPass,
        nextPipeline.lowPass
      );
    }
    replacement?.getTracks().forEach((track) => track.stop());
    microphonePreferences.deviceId = previousDevice;
    microphoneSelect.value = previousDevice;
    localStorage.setItem("sout-device", previousDevice);
    showToast(`${microphoneErrorMessage(error)} تمت إعادة الميكروفون السابق`);
  }
});
pushToTalk.addEventListener("change", () => {
  microphonePreferences.pushToTalk = pushToTalk.checked;
  localStorage.setItem("sout-ptt", String(pushToTalk.checked));
  pushToTalkPressed = false;
  applyMicrophoneMuteState();
});

document.addEventListener("keydown", (event) => {
  if (event.code !== "Space" || !pushToTalk.checked || event.repeat || !localStream) return;
  if (event.target instanceof HTMLElement && (event.target.isContentEditable || ["INPUT", "BUTTON", "SELECT", "TEXTAREA"].includes(event.target.tagName))) return;
  event.preventDefault();
  pushToTalkPressed = true;
  applyMicrophoneMuteState();
});
document.addEventListener("keyup", (event) => {
  if (event.code !== "Space" || !pushToTalk.checked || !pushToTalkPressed) return;
  pushToTalkPressed = false;
  applyMicrophoneMuteState();
});
window.addEventListener("blur", () => {
  if (!pushToTalkPressed) return;
  pushToTalkPressed = false;
  applyMicrophoneMuteState();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && pushToTalkPressed) {
    pushToTalkPressed = false;
    applyMicrophoneMuteState();
  }
});

function updateMuteButton(muted) {
  muteButton.classList.toggle("is-muted", muted);
  muteLabel.textContent = muted ? "إلغاء الكتم" : "كتم الصوت";
  muteButton.setAttribute("aria-label", muted ? "إلغاء كتم الميكروفون" : "كتم الميكروفون");
  muteIcon.innerHTML = muted
    ? '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m3 3 18 18M9 9v3a3 3 0 0 0 5.1 2.1M15 9V6a3 3 0 0 0-5.8-1M19 11a7 7 0 0 1-1 3.6M5 11a7 7 0 0 0 11.9 5M12 18v3m-4 0h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z" stroke="currentColor" stroke-width="1.8"/><path d="M19 11a7 7 0 0 1-14 0m7 7v3m-4 0h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
}

enableAudioButton.addEventListener("click", async () => {
  try {
    if (audioContext?.state === "suspended") await audioContext.resume();
    await Promise.all(Array.from(peers.values(), (peer) => peer.audio.play()));
    enableAudioButton.classList.add("hidden");
  } catch (error) {
    console.error("Could not enable peer audio playback:", error);
    showToast("تعذر تفعيل الصوت. تحقق من إعدادات الصوت في المتصفح.");
  }
});

muteButton.addEventListener("click", () => {
  if (!localStream?.getAudioTracks()[0]) return;
  manualMicMuted = !manualMicMuted;
  applyMicrophoneMuteState();
});

function updateScreenShareButton() {
  const isSharing = Boolean(screenShareStream);
  screenShareButton.classList.toggle("is-sharing", isSharing);
  screenShareLabel.textContent = isSharing ? "إيقاف المشاركة" : "مشاركة الشاشة";
  screenShareButton.setAttribute("aria-label", isSharing ? "إيقاف مشاركة الشاشة" : "مشاركة الشاشة");
  screenShareButton.title = navigator.mediaDevices?.getDisplayMedia
    ? ""
    : "مشاركة الشاشة غير مدعومة في هذا المتصفح";
}

async function stopScreenShare(notify = true, detach = true) {
  const stream = screenShareStream;
  if (!stream) return;
  screenShareStream = null;
  stream.getTracks().forEach((track) => track.stop());
  removeScreenTile(localScreenTile);
  localScreenTile = null;
  updateScreenShareButton();

  if (detach) {
    const results = await Promise.allSettled(
      Array.from(peers.values(), (peer) => peer.screenSender.replaceTrack(null))
    );
    results.filter((result) => result.status === "rejected").forEach((result) => {
      console.error("Could not stop sharing a screen with a participant:", result.reason);
    });
  }
  if (notify) showToast("تم إيقاف مشاركة الشاشة");
}

async function startScreenShare() {
  if (!localStream) return;
  if (!navigator.mediaDevices?.getDisplayMedia) {
    showToast("مشاركة الشاشة غير مدعومة في هذا المتصفح");
    return;
  }

  screenShareButton.disabled = true;
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 15, max: 30 } },
      audio: false
    });
    const track = stream.getVideoTracks()[0];
    if (!track) {
      stream.getTracks().forEach((mediaTrack) => mediaTrack.stop());
      throw new Error("Screen capture did not provide a video track.");
    }

    screenShareStream = stream;
    localScreenTile = addScreenTile(currentName, stream, true);
    track.addEventListener("ended", () => stopScreenShare(), { once: true });
    updateScreenShareButton();

    const results = await Promise.allSettled(
      Array.from(peers.values(), (peer) => peer.screenSender.replaceTrack(track))
    );
    results.filter((result) => result.status === "rejected").forEach((result) => {
      console.error("Could not start sharing a screen with a participant:", result.reason);
    });
    if (results.some((result) => result.status === "rejected")) {
      showToast("بدأت المشاركة، لكن تعذر بث الشاشة إلى أحد المشاركين");
    } else {
      showToast("بدأت مشاركة الشاشة");
    }
  } catch (error) {
    if (error.name === "NotAllowedError") {
      showToast("تم إلغاء طلب مشاركة الشاشة");
    } else if (error.name === "NotSupportedError") {
      showToast("مشاركة الشاشة غير مدعومة على هذا الجهاز أو المتصفح");
    } else {
      console.error("Could not share screen:", error);
      showToast("تعذرت مشاركة الشاشة. تحقق من أذونات المتصفح.");
    }
  } finally {
    screenShareButton.disabled = false;
  }
}

screenShareButton.addEventListener("click", () => {
  if (screenShareStream) {
    stopScreenShare();
  } else {
    startScreenShare();
  }
});
updateScreenShareButton();

copyButton.addEventListener("click", async () => {
  const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(roomId)}&title=${encodeURIComponent(roomName)}`;
  try {
    await navigator.clipboard.writeText(inviteUrl);
    copyLabel.textContent = "تم نسخ الرابط";
    showToast("رابط الدعوة جاهز للمشاركة");
    setTimeout(() => { copyLabel.textContent = "نسخ رابط الدعوة"; }, 1800);
  } catch (error) {
    console.error("Could not copy invitation link:", error);
    showToast("تعذر نسخ الرابط. انسخه من شريط العنوان.");
  }
});

function leaveRoom() {
  intentionalLeave = true;
  clearPeers();
  fileSharing.cleanup();
  localStream?.getTracks().forEach((track) => track.stop());
  localStream = null;
  stopScreenShare(false, false);
  disposeAudioPipeline(processedStream, microphoneSource, microphoneGain, microphoneCompressor, microphoneHighPass, microphoneLowPass);
  processedStream = null;
  microphoneSource = null;
  microphoneHighPass = null;
  microphoneLowPass = null;
  microphoneGain = null;
  microphoneCompressor = null;
  manualMicMuted = false;
  pushToTalkPressed = false;
  localMonitorCleanup?.();
  localMonitorCleanup = null;
  socket?.disconnect();
  socket = null;
  currentName = "";
  selfName.textContent = "أنت";
  selfInitial.textContent = "؟";
  selfCaption.textContent = "بانتظارك";
  selfAvatar.classList.remove("talking");
  updateMuteButton(false);
  updateEmptyNote();
  controlPanel.classList.add("hidden");
  filePanel.classList.add("hidden");
  joinPanel.classList.remove("hidden");
  joinButton.disabled = false;
  joinButton.querySelector("span").textContent = "انضم للمحادثة";
  connectionLabel.textContent = "مساحة خاصة";
}

document.getElementById("leave-button").addEventListener("click", leaveRoom);

function openChannelDialog() {
  channelError.textContent = "";
  channelInput.value = "";
  channelDialog.showModal();
  channelInput.focus();
}

document.getElementById("create-channel-button").addEventListener("click", openChannelDialog);
document.getElementById("new-channel-control").addEventListener("click", openChannelDialog);
document.getElementById("dialog-close").addEventListener("click", () => channelDialog.close());
channelDialog.addEventListener("click", (event) => {
  if (event.target === channelDialog) channelDialog.close();
});

channelForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = channelInput.value.trim();
  if (!name || name.length > 48) {
    channelError.textContent = "أدخل اسماً للقناة لا يتجاوز 48 حرفاً.";
    channelInput.focus();
    return;
  }

  const wasConnected = Boolean(localStream && currentName);
  roomId = crypto.randomUUID();
  setRoomName(name);
  channelDialog.close();

  if (wasConnected) {
    intentionalLeave = true;
    clearPeers();
    localMonitorCleanup?.();
    localMonitorCleanup = null;
    const previousSocket = socket;
    socket = null;
    previousSocket?.disconnect();
    connectToRoom(currentName);
    showToast(`تم إنشاء قناة «${name}»`);
    return;
  }

  const savedName = nameInput.value.trim();
  if (savedName) {
    joinWithName(savedName);
  } else {
    showToast("أُنشئت القناة. اكتب اسمك للانضمام وشارك الرابط.");
    nameInput.focus();
  }
});
