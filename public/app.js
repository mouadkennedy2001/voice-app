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
const selfPerson = document.getElementById("self-person");
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
const profileButton = document.getElementById("profile-button");
const profileDialog = document.getElementById("profile-dialog");
const profileDialogClose = document.getElementById("profile-dialog-close");
const authView = document.getElementById("auth-view");
const profileView = document.getElementById("profile-view");
const authForm = document.getElementById("auth-form");
const authUsername = document.getElementById("auth-username");
const authPassword = document.getElementById("auth-password");
const authSubmit = document.getElementById("auth-submit");
const authError = document.getElementById("auth-error");
const loginModeButton = document.getElementById("login-mode-button");
const registerModeButton = document.getElementById("register-mode-button");
const profileDisplayName = document.getElementById("profile-display-name");
const profileAccountName = document.getElementById("profile-account-name");
const profileAvatarInput = document.getElementById("profile-avatar-input");
const profileAvatarPreview = document.getElementById("profile-avatar-preview");
const profileAvatarFallback = document.getElementById("profile-avatar-fallback");
const headerProfileAvatar = document.getElementById("header-profile-avatar");
const profileButtonLabel = document.getElementById("profile-button-label");
const profileError = document.getElementById("profile-error");
const pttButton = document.getElementById("ptt-button");
const filesControl = document.getElementById("files-control");
const filesControlFooter = document.getElementById("files-control-footer");
const chatControl = document.getElementById("chat-control");
const chatControlFooter = document.getElementById("chat-control-footer");
const chatBadge = document.getElementById("chat-badge");
const chatBadgeFooter = document.getElementById("chat-badge-footer");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const chatMessages = document.getElementById("chat-messages");
const typingNote = document.getElementById("typing-note");
const repoControl = document.getElementById("repo-control");
const repoControlFooter = document.getElementById("repo-control-footer");
const repoTopButton = document.getElementById("repo-top-button");
const repoRefreshButton = document.getElementById("repo-refresh");
const repoChannelsView = document.getElementById("repo-channels-view");
const repoFilesView = document.getElementById("repo-files-view");
const repoChannelsList = document.getElementById("repo-channels");
const repoFilesList = document.getElementById("repo-files");
const repoFilesStatus = document.getElementById("repo-files-status");
const repoChannelsStatus = document.getElementById("repo-channels-status");
const repoTabFiles = document.getElementById("repo-tab-files");
const repoTabChannels = document.getElementById("repo-tab-channels");
const repoFileInput = document.getElementById("repo-file-input");
const handButton = document.getElementById("hand-button");
const handLabel = document.getElementById("hand-label");
const participantsCount = document.getElementById("participants-count");
const selfStatus = document.getElementById("self-status");
const channelListed = document.getElementById("channel-listed");
const drawerElements = {
  files: document.getElementById("drawer-files"),
  chat: document.getElementById("drawer-chat"),
  repo: document.getElementById("drawer-repo")
};

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
const defaultMaxFileSize = 12_000_000_000;
let rtcIceServers = defaultIceServers;
let maxFileSize = defaultMaxFileSize;
let socket;
let localStream;
let toastTimer;
let intentionalLeave = false;
let roomReady = false;
let accountUser = null;
let csrfToken = null;
let authMode = "login";
let selectedAvatarFile = null;
let profilePreviewUrl;
let roomListed = true;
let handRaised = false;
let chatUnread = 0;
let typingClearTimer;
const sharedFiles = new Map();
const typingPeers = new Map();
const typingExpiry = new Map();

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
  : "dark");

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

async function apiRequest(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (csrfToken && options.method && options.method !== "GET") headers.set("X-CSRF-Token", csrfToken);
  const response = await fetch(url, { ...options, headers, credentials: "same-origin", cache: "no-store" });
  let result;
  try {
    result = await response.json();
  } catch (error) {
    throw new Error("تعذّر قراءة استجابة الخادم.");
  }
  if (!response.ok) throw new Error(result.error || "تعذّر إكمال الطلب.");
  return result;
}

function setAvatarImage(element, url) {
  element.querySelector(".profile-photo")?.remove();
  if (!url) return;
  const image = document.createElement("img");
  image.className = "profile-photo";
  image.alt = "";
  image.src = url;
  image.addEventListener("error", () => image.remove(), { once: true });
  element.prepend(image);
}

function clearPendingAvatar() {
  selectedAvatarFile = null;
  profileAvatarInput.value = "";
  delete profileAvatarInput.dataset.removeAvatar;
  if (profilePreviewUrl) URL.revokeObjectURL(profilePreviewUrl);
  profilePreviewUrl = null;
}

function applyAccountProfile(user) {
  accountUser = user;
  if (!user) {
    clearPendingAvatar();
    profileButtonLabel.textContent = "حساب";
    headerProfileAvatar.textContent = "؟";
    headerProfileAvatar.replaceChildren(document.createTextNode("؟"));
    profileAvatarPreview.classList.add("hidden");
    profileAvatarFallback.classList.remove("hidden");
    setAvatarImage(selfAvatar, null);
    authView.classList.remove("hidden");
    profileView.classList.add("hidden");
    return;
  }

  const initial = Array.from(user.displayName || user.username)[0] || "؟";
  profileButtonLabel.textContent = user.displayName;
  headerProfileAvatar.textContent = "";
  headerProfileAvatar.replaceChildren(document.createTextNode(initial));
  setAvatarImage(headerProfileAvatar, user.avatarUrl);
  profileAccountName.textContent = `@${user.username}`;
  profileDisplayName.value = user.displayName;
  profileAvatarFallback.textContent = initial;
  setAvatarImage(profileAvatarFallback, user.avatarUrl);
  profileAvatarFallback.classList.toggle("hidden", Boolean(user.avatarUrl));
  profileAvatarPreview.classList.add("hidden");
  if (user.avatarUrl) {
    profileAvatarPreview.src = user.avatarUrl;
    profileAvatarPreview.classList.remove("hidden");
  }
  nameInput.value = user.displayName;
  localStorage.setItem("sout-name", user.displayName);
  authView.classList.add("hidden");
  profileView.classList.remove("hidden");
}

async function refreshAccount() {
  try {
    const result = await apiRequest("/api/me");
    csrfToken = result.csrfToken;
    applyAccountProfile(result.user);
  } catch (error) {
    console.error("Could not load the account profile:", error);
    showToast("تعذّر تحميل الملف الشخصي من الخادم");
  }
}

function setAuthMode(mode) {
  authMode = mode;
  const isRegister = mode === "register";
  loginModeButton.classList.toggle("is-active", !isRegister);
  loginModeButton.setAttribute("aria-pressed", String(!isRegister));
  registerModeButton.classList.toggle("is-active", isRegister);
  registerModeButton.setAttribute("aria-pressed", String(isRegister));
  authSubmit.querySelector("span").textContent = isRegister ? "إنشاء الحساب" : "تسجيل الدخول";
  authPassword.autocomplete = isRegister ? "new-password" : "current-password";
  authPassword.minLength = isRegister ? 10 : 0;
  authError.textContent = "";
}

profileButton.addEventListener("click", () => {
  profileError.textContent = "";
  authError.textContent = "";
  profileDialog.showModal();
});
profileDialogClose.addEventListener("click", () => profileDialog.close());
profileDialog.addEventListener("click", (event) => {
  if (event.target === profileDialog) profileDialog.close();
});
loginModeButton.addEventListener("click", () => setAuthMode("login"));
registerModeButton.addEventListener("click", () => setAuthMode("register"));
authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  authError.textContent = "";
  authSubmit.disabled = true;
  try {
    const endpoint = authMode === "register" ? "/api/auth/register" : "/api/auth/login";
    const result = await apiRequest(endpoint, {
      method: "POST",
      body: JSON.stringify({ username: authUsername.value, password: authPassword.value })
    });
    csrfToken = result.csrfToken;
    authPassword.value = "";
    clearPendingAvatar();
    applyAccountProfile(result.user);
    if (socket) {
      leaveRoom();
      showToast("تم تسجيل الدخول. أعد الانضمام لتحديث اسمك وصورتك لدى المشاركين.");
    } else {
      showToast(authMode === "register" ? "تم إنشاء الحساب وحفظ الملف الشخصي" : "تم تسجيل الدخول");
    }
  } catch (error) {
    authError.textContent = error.message;
  } finally {
    authSubmit.disabled = false;
  }
});

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(new Error("تعذرت قراءة الصورة المحددة.")));
    reader.readAsDataURL(file);
  });
}

profileAvatarInput.addEventListener("change", () => {
  const file = profileAvatarInput.files?.[0];
  if (!file) return;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 2 * 1024 * 1024) {
    profileError.textContent = "اختر صورة JPG أو PNG أو WebP لا يتجاوز حجمها 2 MiB.";
    profileAvatarInput.value = "";
    return;
  }
  selectedAvatarFile = file;
  if (profilePreviewUrl) URL.revokeObjectURL(profilePreviewUrl);
  profilePreviewUrl = URL.createObjectURL(file);
  profileAvatarPreview.src = profilePreviewUrl;
  profileAvatarPreview.classList.remove("hidden");
  profileAvatarFallback.classList.add("hidden");
  profileError.textContent = "";
});

document.getElementById("save-profile-button").addEventListener("click", async () => {
  profileError.textContent = "";
  const displayName = profileDisplayName.value.trim();
  if (!displayName || displayName.length > 32) {
    profileError.textContent = "أدخل اسماً ظاهراً من 1 إلى 32 محرفاً.";
    return;
  }
  const saveButton = document.getElementById("save-profile-button");
  saveButton.disabled = true;
  try {
    const changes = { displayName };
    if (selectedAvatarFile) changes.avatar = await readFileAsDataUrl(selectedAvatarFile);
    else if (profileAvatarInput.dataset.removeAvatar === "true") changes.avatar = null;
    const result = await apiRequest("/api/profile", { method: "PUT", body: JSON.stringify(changes) });
    selectedAvatarFile = null;
    if (profilePreviewUrl) URL.revokeObjectURL(profilePreviewUrl);
    profilePreviewUrl = null;
    profileAvatarInput.value = "";
    delete profileAvatarInput.dataset.removeAvatar;
    csrfToken = (await apiRequest("/api/me")).csrfToken;
    applyAccountProfile(result.user);
    if (currentName && socket?.connected) {
      currentName = result.user.displayName;
      selfName.textContent = currentName;
      selfInitial.textContent = Array.from(currentName)[0] || "؟";
      setAvatarImage(selfAvatar, result.user.avatarUrl);
    }
    showToast("تم حفظ الملف الشخصي");
  } catch (error) {
    console.error("Could not save the account profile:", error);
    profileError.textContent = error.message;
  } finally {
    saveButton.disabled = false;
  }
});

document.getElementById("remove-avatar-button").addEventListener("click", () => {
  selectedAvatarFile = null;
  if (profilePreviewUrl) URL.revokeObjectURL(profilePreviewUrl);
  profilePreviewUrl = null;
  profileAvatarInput.value = "";
  profileAvatarInput.dataset.removeAvatar = "true";
  profileAvatarPreview.classList.add("hidden");
  profileAvatarFallback.classList.remove("hidden");
});

document.getElementById("logout-button").addEventListener("click", async () => {
  try {
    await apiRequest("/api/auth/logout", { method: "POST", body: "{}" });
    if (socket) leaveRoom();
    csrfToken = null;
    clearPendingAvatar();
    applyAccountProfile(null);
    profileDialog.close();
    showToast("تم تسجيل الخروج");
  } catch (error) {
    profileError.textContent = error.message;
  }
});

refreshAccount();

function updateEmptyNote() {
  emptyNote.classList.toggle("hidden", peers.size > 0);
  const connected = !controlPanel.classList.contains("hidden");
  connectionLabel.textContent = peers.size
    ? `معك ${peers.size + 1} في القناة`
    : connected ? "قناتك مباشرة" : "مساحة خاصة";
  const total = peers.size + 1;
  participantsCount.textContent = `${total} / 8`;
  participantsCount.setAttribute("aria-label", `${total} من 8 مشاركين`);
}

function updateSelfStatus(muted = currentMuteState()) {
  if (!inActiveRoom()) {
    selfCaption.textContent = "بانتظارك";
    if (selfStatus) {
      selfStatus.className = "status-pill";
      selfStatus.textContent = "جاهز";
    }
    selfPerson.classList.remove("is-muted");
    return;
  }
  selfCaption.textContent = handRaised ? "يدك مرفوعة" : muted ? "الميكروفون مكتوم" : "متصل";
  if (selfStatus) {
    const tone = handRaised ? "status-hand" : muted ? "status-muted" : "status-speaking";
    selfStatus.className = `status-pill ${tone}`;
    selfStatus.textContent = handRaised ? "يد مرفوعة" : muted ? "مكتوم" : "متصل";
  }
  selfPerson.classList.toggle("is-muted", muted && !handRaised);
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

function ensureScreenTransceiver(state) {
  if (state.screenTransceiver) return state.screenTransceiver;
  const track = screenShareStream?.getVideoTracks()[0] || null;
  state.screenTransceiver = state.connection.addTransceiver(track || "video", {
    direction: "sendrecv",
    streams: track ? [screenShareStream] : []
  });
  state.screenSender = state.screenTransceiver.sender;
  return state.screenTransceiver;
}

async function syncScreenTrackWithPeer(state) {
  if (state.connection.signalingState === "closed") return;
  const track = screenShareStream?.getVideoTracks()[0] || null;
  if (!track) {
    if (state.screenTransceiver) state.screenTransceiver.direction = "inactive";
    if (state.screenSender) await state.screenSender.replaceTrack(null);
    return;
  }
  const transceiver = ensureScreenTransceiver(state);
  if (transceiver.direction !== "sendrecv") transceiver.direction = "sendrecv";
  if (transceiver.sender.track !== track) await transceiver.sender.replaceTrack(track);
}

function setPeerStatus(state, text, tone = "speaking") {
  state.caption.textContent = text;
  state.statusBadge.className = `status-pill status-${tone}`;
  state.statusBadge.textContent = text;
  state.person.classList.toggle("is-muted", tone === "muted");
}

function createPeer(peer) {
  if (peers.has(peer.id)) return peers.get(peer.id);

  const peerSocket = socket;
  const peerConnection = new RTCPeerConnection({ iceServers: rtcIceServers });
  const audio = document.createElement("audio");
  audio.className = "peer-audio";
  audio.autoplay = true;
  audio.playsInline = true;
  document.body.append(audio);

  const person = document.createElement("article");
  person.className = "participant-card";
  const top = document.createElement("div");
  top.className = "participant-top";
  const role = document.createElement("span");
  role.className = "role-badge";
  role.textContent = "عضو";
  const badges = document.createElement("div");
  badges.className = "participant-badges";
  const statusBadge = document.createElement("span");
  statusBadge.className = "status-pill status-speaking";
  statusBadge.textContent = "متصل";
  const handBadge = document.createElement("span");
  handBadge.className = "status-pill status-hand hidden";
  handBadge.innerHTML = '<svg aria-hidden="true"><use href="#i-hand"></use></svg><span>يد مرفوعة</span>';
  badges.append(statusBadge, handBadge);
  top.append(role, badges);

  const center = document.createElement("div");
  center.className = "participant-center";
  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.dataset.tone = String(peers.size % 8);
  avatar.textContent = Array.from(peer.name)[0] || "?";
  if (peer.avatarUrl) setAvatarImage(avatar, peer.avatarUrl);
  const name = document.createElement("h3");
  name.className = "participant-name";
  name.textContent = peer.name;
  const caption = document.createElement("p");
  caption.className = "participant-caption";
  caption.textContent = "متصل";
  center.append(avatar, name, caption);

  const bottom = document.createElement("div");
  bottom.className = "participant-bottom";
  const bottomLabel = document.createElement("span");
  bottomLabel.textContent = "الصوت";
  const volumeControl = document.createElement("label");
  volumeControl.className = "peer-volume-control";
  const volumeIcon = document.createElement("span");
  volumeIcon.className = "visually-hidden";
  volumeIcon.textContent = "مستوى صوت المشارك";
  const volume = document.createElement("input");
  volume.type = "range";
  volume.min = "0";
  volume.max = "1";
  volume.step = "0.05";
  volume.value = String(storedRange(`sout-peer-volume:${peer.name}`, microphonePreferences.speakerVolume, 0, 1));
  volume.setAttribute("aria-label", `مستوى صوت ${peer.name}`);
  volumeControl.append(volumeIcon, volume);
  bottom.append(bottomLabel, volumeControl);
  person.append(top, center, bottom);
  participants.append(person);

  const state = {
    connection: peerConnection,
    audio,
    person,
    avatar,
    name: peer.name,
    nameElement: name,
    caption,
    statusBadge,
    handBadge,
    polite: socket.id.localeCompare(peer.id) > 0,
    makingOffer: false,
    ignoreOffer: false,
    isSettingRemoteAnswerPending: false,
    signalQueue: Promise.resolve(),
    pendingCandidates: [],
    iceRestartAttempts: 0,
    iceRestartTimer: null,
    monitorCleanup: null,
    screenTransceiver: null,
    screenSender: null,
    screenTile: null,
    muted: Boolean(peer.muted),
    raised: Boolean(peer.raised),
    volumeControl: volume
  };
  audio.volume = Number(volume.value);
  volume.addEventListener("input", () => {
    audio.volume = Number(volume.value);
    localStorage.setItem(`sout-peer-volume:${peer.name}`, volume.value);
  });
  if (peer.muted) {
    caption.textContent = "الميكروفون مكتوم";
    statusBadge.className = "status-pill status-muted";
    statusBadge.textContent = "مكتوم";
    person.classList.add("is-muted");
  }
  if (state.raised) handBadge.classList.remove("hidden");
  peers.set(peer.id, state);
  participants.classList.toggle("many", peers.size > 4);
  updateFileRecipients();

  const restartIceConnection = (delay) => {
    clearTimeout(state.iceRestartTimer);
    state.iceRestartTimer = setTimeout(() => {
      const currentState = peerConnection.iceConnectionState;
      if (peerConnection.signalingState === "closed" || currentState === "connected" || currentState === "completed") return;
      if (state.iceRestartAttempts >= 2 || typeof peerConnection.restartIce !== "function") {
        setPeerStatus(state, "تعذّر الاتصال", "muted");
        return;
      }

      state.iceRestartAttempts += 1;
      try {
        peerConnection.restartIce();
      } catch (error) {
        console.error("Could not restart ICE:", error);
        setPeerStatus(state, "تعذّر الاتصال", "muted");
        return;
      }
      state.iceRestartTimer = setTimeout(() => {
        const latestState = peerConnection.iceConnectionState;
        if (peerConnection.signalingState === "closed" || latestState === "connected" || latestState === "completed") return;
        if (state.iceRestartAttempts < 2) {
          restartIceConnection(0);
        } else {
          setPeerStatus(state, "تعذّر الاتصال", "muted");
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
      setPeerStatus(state, state.muted ? "الميكروفون مكتوم" : "متصل", state.muted ? "muted" : "speaking");
      return;
    }
    if (iceState !== "disconnected" && iceState !== "failed") return;
    restartIceConnection(iceState === "disconnected" ? 5_000 : 0);
  };
  peerConnection.onconnectionstatechange = () => {
    if (peerConnection.connectionState === "connected") {
      setPeerStatus(state, state.muted ? "الميكروفون مكتوم" : "متصل", state.muted ? "muted" : "speaking");
    }
    if (peerConnection.connectionState === "failed") setPeerStatus(state, "تعذّر الاتصال", "muted");
  };

  if (localStream) {
    (processedStream || localStream).getTracks().forEach((track) => peerConnection.addTrack(track, processedStream || localStream));
    audio.volume = microphonePreferences.speakerVolume;
  }

  if (screenShareStream) {
    syncScreenTrackWithPeer(state)
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
    roomSocket.emit("join-room", { roomId, name, roomName, muted, listed: roomListed }, (result) => {
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
      roomReady = true;
      roomListed = result.listed !== false;
      const visibleName = accountUser?.displayName || name;
      selfName.textContent = visibleName;
      selfInitial.textContent = Array.from(visibleName)[0] || "?";
      updateMuteButton(muted);
      setRoomName(result.roomName);
      localMonitorCleanup?.();
      localMonitorCleanup = monitorAudio(localStream, selfAvatar);
      applyMicrophoneMuteState();
      fileSharing.attach(roomSocket, rtcIceServers, maxFileSize);
      sharedFiles.clear();
      for (const share of result.sharedFiles || []) {
        if (share?.id) sharedFiles.set(share.id, share);
      }
      result.peers.forEach(createPeer);
      renderSharedFiles();
      renderChatHistory(result.chatHistory || []);
      typingPeers.clear();
      renderTyping();
      updateChatAvailability();
      updateFileRecipients();
      updateEmptyNote();
      if (handRaised) roomSocket.emit("hand", { raised: true });
    });
  });
  roomSocket.on("disconnect", () => {
    connectionSetup += 1;
    if (socket === roomSocket && !intentionalLeave && !controlPanel.classList.contains("hidden")) {
      roomReady = false;
      clearPeers();
      fileSharing.cleanup();
      localMonitorCleanup?.();
      localMonitorCleanup = null;
      connectionLabel.textContent = "يعاد الاتصال...";
      updateChatAvailability();
      updateSelfStatus();
      showToast("انقطع الاتصال، جارٍ إعادة المحاولة");
    }
  });
  roomSocket.on("peer-joined", (peer) => {
    createPeer(peer);
    renderSharedFiles();
    showToast(`${peer.name} انضم إلى القناة`);
    playNotification("join");
    appendChatSystem(`${peer.name} انضم إلى القناة`);
    updateEmptyNote();
  });
  roomSocket.on("peer-left", ({ id }) => {
    const peer = peers.get(id);
    if (peer) {
      showToast(`${peer.name} غادر القناة`);
      playNotification("leave");
      appendChatSystem(`${peer.name} غادر القناة`);
    }
    clearTimeout(typingExpiry.get(id));
    typingExpiry.delete(id);
    typingPeers.delete(id);
    renderTyping();
    removePeer(id);
    renderSharedFiles();
    updateEmptyNote();
  });
  roomSocket.on("peer-status", ({ id, muted }) => {
    const peer = peers.get(id);
    if (!peer) return;
    peer.muted = muted;
    setPeerStatus(peer, muted ? "الميكروفون مكتوم" : "متصل", muted ? "muted" : "speaking");
  });
  roomSocket.on("hand", ({ id, raised }) => {
    if (id === roomSocket.id) {
      handRaised = raised;
      updateHandButton();
      return;
    }
    const peer = peers.get(id);
    if (!peer) return;
    peer.raised = raised;
    peer.handBadge.classList.toggle("hidden", !raised);
    if (raised) {
      showToast(`${peer.name} رفع يده ✋`);
      playNotification("join");
    }
  });
  roomSocket.on("chat-message", (message) => {
    if (!message || message.from === roomSocket.id) return;
    renderChatMessage(message);
    if (!drawerElements.chat.classList.contains("is-open")) {
      chatUnread += 1;
      updateChatBadge();
      playNotification("join");
    }
  });
  roomSocket.on("chat-typing", ({ id, name, typing }) => {
    clearTimeout(typingExpiry.get(id));
    if (typing) {
      typingPeers.set(id, name);
      typingExpiry.set(id, setTimeout(() => {
        typingPeers.delete(id);
        typingExpiry.delete(id);
        renderTyping();
      }, 3500));
    } else {
      typingExpiry.delete(id);
      typingPeers.delete(id);
    }
    renderTyping();
  });
  roomSocket.on("file-share-added", (share) => {
    if (!share?.id) return;
    sharedFiles.set(share.id, share);
    renderSharedFiles();
  });
  roomSocket.on("file-share-updated", (share) => {
    if (!share?.id) return;
    sharedFiles.set(share.id, share);
    renderSharedFiles();
  });
  roomSocket.on("file-share-removed", ({ shareId }) => {
    sharedFiles.delete(shareId);
    renderSharedFiles();
  });
  roomSocket.on("directory-updated", () => {
    if (drawerElements.repo.classList.contains("is-open") && !repoChannelsView.classList.contains("hidden")) {
      refreshDirectory();
    }
  });
  roomSocket.on("peer-profile", ({ id, displayName, avatarUrl }) => {
    const peer = peers.get(id);
    if (!peer || typeof displayName !== "string") return;
    peer.name = displayName;
    peer.nameElement.textContent = displayName;
    peer.avatar.setAttribute("aria-label", displayName);
    peer.volumeControl.setAttribute("aria-label", `مستوى صوت ${displayName}`);
    setAvatarImage(peer.avatar, avatarUrl);
    updateFileRecipients();
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
  if (accountUser) {
    name = accountUser.displayName;
    nameInput.value = name;
  }
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
  updateSelfStatus(muted);
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
  pttButton.classList.toggle("hidden", !pushToTalk.checked);
  pttButton.setAttribute("aria-pressed", "false");
  pttButton.classList.remove("is-pressed");
  applyMicrophoneMuteState();
});

function setPushToTalkPressed(pressed) {
  if (!pushToTalk.checked || !localStream) return;
  pushToTalkPressed = pressed;
  pttButton.setAttribute("aria-pressed", String(pressed));
  pttButton.classList.toggle("is-pressed", pressed);
  applyMicrophoneMuteState();
}

pttButton.classList.toggle("hidden", !pushToTalk.checked);
pttButton.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  pttButton.setPointerCapture(event.pointerId);
  setPushToTalkPressed(true);
});
pttButton.addEventListener("pointerup", () => setPushToTalkPressed(false));
pttButton.addEventListener("pointercancel", () => setPushToTalkPressed(false));
pttButton.addEventListener("lostpointercapture", () => setPushToTalkPressed(false));
pttButton.addEventListener("contextmenu", (event) => event.preventDefault());

document.addEventListener("keydown", (event) => {
  if (event.code !== "Space" || !pushToTalk.checked || event.repeat || !localStream) return;
  if (event.target instanceof HTMLElement && (event.target.isContentEditable || ["INPUT", "BUTTON", "SELECT", "TEXTAREA"].includes(event.target.tagName))) return;
  event.preventDefault();
  setPushToTalkPressed(true);
});
document.addEventListener("keyup", (event) => {
  if (event.code !== "Space" || !pushToTalk.checked || !pushToTalkPressed) return;
  setPushToTalkPressed(false);
});
window.addEventListener("blur", () => {
  if (!pushToTalkPressed) return;
  setPushToTalkPressed(false);
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && pushToTalkPressed) {
    setPushToTalkPressed(false);
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
  const supported = Boolean(navigator.mediaDevices?.getDisplayMedia);
  screenShareButton.disabled = !supported && !isSharing;
  screenShareButton.title = supported ? "" : "مشاركة الشاشة غير مدعومة في هذا المتصفح";
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
      Array.from(peers.values(), syncScreenTrackWithPeer)
    );
    results.filter((result) => result.status === "rejected").forEach((result) => {
      console.error("Could not stop sharing a screen with a participant:", result.reason);
    });
  }
  if (notify) showToast("تم إيقاف مشاركة الشاشة");
}

async function startScreenShare() {
  if (!localStream) {
    showToast("انضم إلى قناة أولاً لمشاركة الشاشة.");
    return;
  }
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
      Array.from(peers.values(), syncScreenTrackWithPeer)
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
    updateScreenShareButton();
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
  roomReady = false;
  currentName = "";
  handRaised = false;
  updateHandButton();
  sharedFiles.clear();
  renderSharedFiles();
  chatMessages.replaceChildren();
  chatUnread = 0;
  updateChatBadge();
  for (const timer of typingExpiry.values()) clearTimeout(timer);
  typingExpiry.clear();
  typingPeers.clear();
  renderTyping();
  updateChatAvailability();
  closeDrawer("chat");
  closeDrawer("repo");
  closeDrawer("files");
  selfName.textContent = "أنت";
  selfInitial.textContent = "؟";
  selfCaption.textContent = "بانتظارك";
  if (selfStatus) {
    selfStatus.className = "status-pill";
    selfStatus.textContent = "جاهز";
  }
  selfAvatar.classList.remove("talking");
  updateMuteButton(false);
  updateEmptyNote();
  controlPanel.classList.add("hidden");
  joinPanel.classList.remove("hidden");
  joinButton.disabled = false;
  joinButton.querySelector("span").textContent = "انضم للمحادثة";
  connectionLabel.textContent = "مساحة خاصة";
  participantsCount.textContent = "1 / 8";
}

document.getElementById("leave-button").addEventListener("click", leaveRoom);
filesControl.addEventListener("click", () => openDrawer("files"));
filesControlFooter?.addEventListener("click", () => openDrawer("files"));

function openChannelDialog() {
  channelError.textContent = "";
  channelInput.value = "";
  if (channelListed) channelListed.checked = true;
  channelDialog.showModal();
  channelInput.focus();
}

document.getElementById("create-channel-button").addEventListener("click", openChannelDialog);
document.getElementById("new-channel-control")?.addEventListener("click", openChannelDialog);
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
  roomListed = channelListed ? channelListed.checked : true;
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

/* ============================================================
   Drawers, chat, shared-file repository, and hand raising
   ============================================================ */

let directorySocket = null;
let directoryRequestId = 0;

function inActiveRoom() {
  return Boolean(roomReady && socket?.connected && currentName && !controlPanel.classList.contains("hidden"));
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  const units = ["بايت", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

function formatShareDate(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("ar", { month: "short", day: "numeric" });
}

function formatChatTime(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" });
}

function scrollChatToEnd() {
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function showChatEmpty() {
  if (chatMessages.querySelector(".chat-message, .chat-system")) return;
  const empty = document.createElement("p");
  empty.className = "chat-empty";
  empty.textContent = inActiveRoom()
    ? "لا رسائل بعد في هذه القناة. ابدأ المحادثة مع المشاركين."
    : "انضم إلى قناة لتتمكن من الدردشة مع المشاركين.";
  chatMessages.replaceChildren(empty);
}

function updateChatAvailability() {
  const available = inActiveRoom();
  chatInput.disabled = !available;
  const submit = chatForm.querySelector("button[type='submit']");
  if (submit) submit.disabled = !available;
  chatInput.placeholder = available ? "اكتب رسالة…" : "انضم إلى قناة لبدء الدردشة";
}

function updateChatBadge() {
  const value = chatUnread > 0 ? String(chatUnread) : "0";
  for (const badge of [chatBadge, chatBadgeFooter]) {
    if (!badge) continue;
    badge.textContent = value;
    badge.classList.toggle("hidden", chatUnread === 0);
  }
}

function renderChatMessage(message, options = {}) {
  if (!message || typeof message.text !== "string") return;
  chatMessages.querySelector(".chat-empty")?.remove();
  const isSelf = Boolean(socket?.connected && message.from === socket.id);
  const article = document.createElement("article");
  article.className = `chat-message${isSelf ? " self" : ""}`;

  const head = document.createElement("div");
  head.className = "chat-message-head";
  const author = document.createElement("span");
  author.textContent = isSelf ? "أنت" : (message.name || "مشارك");
  const time = document.createElement("time");
  time.className = "chat-message-time";
  time.dateTime = new Date(message.at || Date.now()).toISOString();
  time.textContent = formatChatTime(message.at);
  head.append(author, time);

  const body = document.createElement("p");
  body.className = "chat-message-text";
  body.textContent = message.text;

  article.append(head, body);
  chatMessages.append(article);
  while (chatMessages.children.length > 120) {
    chatMessages.firstElementChild.remove();
  }
  if (options.scroll !== false && (isSelf || drawerElements.chat.classList.contains("is-open"))) {
    scrollChatToEnd();
  }
}

function renderChatHistory(history) {
  chatMessages.replaceChildren();
  for (const message of history) renderChatMessage(message, { scroll: false });
  showChatEmpty();
  scrollChatToEnd();
}

function appendChatSystem(text) {
  if (!text) return;
  chatMessages.querySelector(".chat-empty")?.remove();
  const note = document.createElement("p");
  note.className = "chat-system";
  note.textContent = text;
  chatMessages.append(note);
  while (chatMessages.children.length > 120) {
    chatMessages.firstElementChild.remove();
  }
  if (drawerElements.chat.classList.contains("is-open")) scrollChatToEnd();
}

function renderTyping() {
  const names = [...new Set(typingPeers.values())].filter(Boolean);
  typingNote.textContent = names.length
    ? `${names.join("، ")} ${names.length === 1 ? "يكتب الآن…" : "يكتبون الآن…"}`
    : "";
}

function updateHandButton() {
  if (!handButton) return;
  handButton.setAttribute("aria-pressed", String(handRaised));
  if (handLabel) handLabel.textContent = handRaised ? "خفض اليد" : "رفع اليد";
  updateSelfStatus();
}

function toggleHand() {
  if (!inActiveRoom()) {
    showToast("انضم إلى قناة أولاً لرفع يدك.");
    return;
  }
  handRaised = !handRaised;
  updateHandButton();
  socket.emit("hand", { raised: handRaised });
  showToast(handRaised ? "رُفعت يدك ✋" : "أُنزلت يدك");
}

function openDrawer(name) {
  for (const [key, element] of Object.entries(drawerElements)) {
    if (!element) continue;
    const open = key === name;
    element.classList.toggle("is-open", open);
    element.setAttribute("aria-hidden", String(!open));
  }
  document.body.classList.add("drawer-open");

  if (name === "chat") {
    chatUnread = 0;
    updateChatBadge();
    updateChatAvailability();
    showChatEmpty();
    scrollChatToEnd();
    if (!chatInput.disabled) {
      setTimeout(() => chatInput.focus({ preventScroll: true }), 220);
    }
  } else if (name === "repo") {
    renderSharedFiles();
    if (!repoChannelsView.classList.contains("hidden")) refreshDirectory();
  } else if (name === "files") {
    document.getElementById("file-recipient")?.focus({ preventScroll: true });
  }
}

function closeDrawer(name) {
  const element = drawerElements[name];
  if (element) {
    element.classList.remove("is-open");
    element.setAttribute("aria-hidden", "true");
  }
  if (!Object.values(drawerElements).some((drawer) => drawer?.classList.contains("is-open"))) {
    document.body.classList.remove("drawer-open");
  }
}

function closeAllDrawers() {
  for (const name of Object.keys(drawerElements)) closeDrawer(name);
}

function createRepoEmpty(text) {
  const empty = document.createElement("p");
  empty.className = "repo-empty";
  empty.textContent = text;
  return empty;
}

function renderSharedFiles() {
  if (!repoFilesList) return;
  repoFilesList.replaceChildren();
  if (!inActiveRoom()) {
    repoFilesStatus.textContent = "مستودع الملفات مرتبط بالقناة الحالية.";
    repoFilesList.append(createRepoEmpty("انضم إلى قناة لعرض الملفات التي أضافها المشاركون. تبقى البايتات على أجهزتهم ولا تُرفع إلى الخادم."));
    return;
  }

  const list = [...sharedFiles.values()]
    .filter((share) => share?.id)
    .sort((left, right) => (right.addedAt || 0) - (left.addedAt || 0));

  if (!list.length) {
    repoFilesStatus.textContent = "لا ملفات مشتركة في هذه القناة بعد.";
    repoFilesList.append(createRepoEmpty("أضف ملفاً من جهازك ليظهر هنا لبقية المشاركين. لا يُنقل الملف إلا بعد طلب أحدهم وموافقتك."));
    return;
  }

  repoFilesStatus.textContent = `${list.length} ملفاً · تُنقل البايتات P2P فقط`;

  for (const share of list) {
    const isOwner = share.owner === socket?.id;
    const ownerOnline = isOwner || peers.has(share.owner);
    const item = document.createElement("article");
    item.className = "repo-item";

    const head = document.createElement("div");
    head.className = "repo-item-head";
    const title = document.createElement("div");
    title.className = "repo-item-title";
    title.innerHTML = '<svg aria-hidden="true"><use href="#i-file"></use></svg>';
    const fileName = document.createElement("span");
    fileName.textContent = share.file?.name || "ملف";
    title.append(fileName);
    head.append(title);

    const meta = document.createElement("p");
    meta.className = "repo-item-meta";
    const date = formatShareDate(share.addedAt);
    const parts = [
      formatFileSize(share.file?.size),
      isOwner ? "أضفته أنت" : `أضافه ${share.ownerName || "مشارك"}`,
      `${share.downloads || 0} طلب تنزيل`
    ];
    if (date) parts.push(date);
    if (!ownerOnline) parts.push("صاحب الملف غير متصل الآن");
    meta.textContent = parts.join(" · ");

    const actions = document.createElement("div");
    actions.className = "repo-item-actions";
    if (isOwner) {
      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "btn btn-ghost";
      removeButton.textContent = "حذف من المستودع";
      removeButton.addEventListener("click", () => {
        if (!socket?.connected) return showToast("انضم إلى قناة أولاً.");
        window.fileSharing?.unshareFile(share.id);
        showToast("أُزيل الملف من مستودع القناة.");
      });
      actions.append(removeButton);
    } else {
      const downloadButton = document.createElement("button");
      downloadButton.type = "button";
      downloadButton.className = "btn btn-accent";
      downloadButton.textContent = ownerOnline ? "طلب التنزيل P2P" : "صاحب الملف غير متصل";
      downloadButton.disabled = !ownerOnline;
      if (ownerOnline) {
        downloadButton.addEventListener("click", () => {
          window.fileSharing?.requestSharedFile(share.id);
        });
      }
      actions.append(downloadButton);
    }

    item.append(head, meta, actions);
    repoFilesList.append(item);
  }
}

function renderDirectory(entries) {
  repoChannelsList.replaceChildren();
  if (!entries.length) {
    repoChannelsStatus.textContent = "لا توجد قنوات عامة الآن.";
    repoChannelsList.append(createRepoEmpty("أنشئ قناة جديدة وفعّل خيار إظهارها في مستودع القنوات العام لتظهر هنا."));
    return;
  }

  repoChannelsStatus.textContent = `${entries.length} قناة نشطة`;
  const active = inActiveRoom();

  for (const entry of entries) {
    const item = document.createElement("article");
    item.className = "repo-item";

    const head = document.createElement("div");
    head.className = "repo-item-head";
    const title = document.createElement("div");
    title.className = "repo-item-title";
    title.innerHTML = '<svg aria-hidden="true"><use href="#i-broadcast"></use></svg>';
    const titleText = document.createElement("span");
    titleText.textContent = entry.name || "غرفة صوتية";
    title.append(titleText);
    head.append(title);

    const meta = document.createElement("p");
    meta.className = "repo-item-meta";
    const isCurrent = active && entry.id === roomId;
    const metaParts = [`${entry.members} من 8 مشاركين`, `${entry.files || 0} ملفاً`];
    if (isCurrent) metaParts.push("قناتك الحالية");
    meta.textContent = metaParts.join(" · ");

    const actions = document.createElement("div");
    actions.className = "repo-item-actions";
    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "btn btn-accent";
    if (isCurrent) {
      openButton.textContent = "أنت هنا";
      openButton.disabled = true;
    } else if (entry.members >= 8) {
      openButton.textContent = "القناة ممتلئة";
      openButton.disabled = true;
    } else {
      openButton.textContent = active ? "الانتقال إلى القناة" : "اختيار القناة";
      openButton.addEventListener("click", () => switchRoom(entry.id, entry.name));
    }

    const inviteButton = document.createElement("button");
    inviteButton.type = "button";
    inviteButton.className = "btn btn-ghost";
    inviteButton.textContent = "نسخ الدعوة";
    inviteButton.addEventListener("click", () => {
      const url = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(entry.id)}&title=${encodeURIComponent(entry.name || "غرفة صوتية")}`;
      copyInviteText(url);
    });

    actions.append(openButton, inviteButton);
    item.append(head, meta, actions);
    repoChannelsList.append(item);
  }
}

function refreshDirectory() {
  if (!repoChannelsList) return;
  const requestId = ++directoryRequestId;
  repoChannelsStatus.textContent = "جارٍ تحميل القنوات…";

  const apply = (result) => {
    if (requestId !== directoryRequestId) return;
    if (!result || result.error) {
      repoChannelsStatus.textContent = result?.error || "تعذّر تحميل مستودع القنوات.";
      repoChannelsList.replaceChildren(createRepoEmpty("تعذّر تحميل القنوات النشطة. تحقق من اتصالك ثم أعد المحاولة."));
      return;
    }
    renderDirectory(Array.isArray(result.rooms) ? result.rooms : []);
  };

  if (socket?.connected) {
    socket.emit("room-directory", {}, apply);
    return;
  }
  if (directorySocket) return;

  const temporarySocket = io();
  directorySocket = temporarySocket;
  let settled = false;
  const finish = (result) => {
    if (settled) return;
    settled = true;
    if (directorySocket === temporarySocket) directorySocket = null;
    apply(result);
    temporarySocket.disconnect();
  };
  temporarySocket.on("connect", () => {
    temporarySocket.emit("room-directory", {}, finish);
  });
  temporarySocket.on("connect_error", () => {
    finish({ error: "تعذّر الاتصال بالخادم لعرض القنوات." });
  });
  setTimeout(() => {
    if (!settled) finish({ error: "انتهت مهلة تحميل مستودع القنوات." });
  }, 6500);
}

function switchRoom(nextRoomId, nextName) {
  if (typeof nextRoomId !== "string" || !nextRoomId) return;
  const connected = inActiveRoom();
  if (connected && nextRoomId === roomId) {
    closeDrawer("repo");
    showToast("أنت في هذه القناة بالفعل.");
    return;
  }

  const displayName = (nextName || "غرفة صوتية").trim().slice(0, 48) || "غرفة صوتية";
  const wasConnected = connected;
  roomId = nextRoomId;
  roomListed = true;
  setRoomName(displayName);
  closeDrawer("repo");

  if (!wasConnected) {
    showToast(`تم اختيار «${displayName}». اكتب اسمك ثم انضم للمحادثة.`);
    nameInput.focus();
    return;
  }

  intentionalLeave = true;
  stopScreenShare(false, false);
  clearPeers();
  window.fileSharing?.cleanup();
  sharedFiles.clear();
  renderSharedFiles();
  chatMessages.replaceChildren();
  showChatEmpty();
  chatUnread = 0;
  updateChatBadge();
  for (const timer of typingExpiry.values()) clearTimeout(timer);
  typingExpiry.clear();
  typingPeers.clear();
  renderTyping();
  localMonitorCleanup?.();
  localMonitorCleanup = null;
  roomReady = false;
  updateChatAvailability();
  updateSelfStatus();
  const previousSocket = socket;
  socket = null;
  previousSocket?.disconnect();
  connectToRoom(currentName);
  showToast(`جارٍ الانتقال إلى «${displayName}»…`);
}

async function copyInviteText(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast("نُسخ رابط دعوة القناة.");
  } catch {
    const helper = document.createElement("textarea");
    helper.value = text;
    helper.setAttribute("readonly", "");
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.append(helper);
    helper.select();
    try {
      document.execCommand("copy");
      showToast("نُسخ رابط دعوة القناة.");
    } catch {
      showToast("تعذّر نسخ الرابط. انسخه من شريط العنوان.");
    }
    helper.remove();
  }
}

chatControl?.addEventListener("click", () => openDrawer("chat"));
chatControlFooter?.addEventListener("click", () => openDrawer("chat"));
repoControl?.addEventListener("click", () => openDrawer("repo"));
repoControlFooter?.addEventListener("click", () => openDrawer("repo"));
repoTopButton?.addEventListener("click", () => openDrawer("repo"));
handButton?.addEventListener("click", toggleHand);

document.querySelectorAll("[data-close-drawer]").forEach((element) => {
  element.addEventListener("click", () => closeDrawer(element.dataset.closeDrawer));
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeAllDrawers();
});

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  if (!inActiveRoom()) {
    showToast("انضم إلى قناة أولاً لإرسال الرسائل.");
    return;
  }

  const payload = text.slice(0, 800);
  chatInput.value = "";
  socket.emit("chat-message", { text: payload }, (result) => {
    if (result?.error) {
      showToast(result.error);
      if (!chatInput.value) chatInput.value = payload;
      return;
    }
    renderChatMessage({
      id: crypto.randomUUID(),
      from: socket.id,
      name: accountUser?.displayName || currentName,
      text: payload,
      at: Date.now()
    });
  });
  socket.emit("chat-typing", { typing: false });
  clearTimeout(typingClearTimer);
});

chatInput.addEventListener("input", () => {
  if (!inActiveRoom()) return;
  socket.emit("chat-typing", { typing: true });
  clearTimeout(typingClearTimer);
  typingClearTimer = setTimeout(() => {
    if (socket?.connected) socket.emit("chat-typing", { typing: false });
  }, 1600);
});

repoRefreshButton?.addEventListener("click", () => {
  renderSharedFiles();
  refreshDirectory();
  showToast("حُدّث المستودع.");
});

repoTabFiles?.addEventListener("click", () => {
  repoTabFiles.classList.add("is-active");
  repoTabChannels.classList.remove("is-active");
  repoTabFiles.setAttribute("aria-selected", "true");
  repoTabChannels.setAttribute("aria-selected", "false");
  repoFilesView.classList.remove("hidden");
  repoChannelsView.classList.add("hidden");
  renderSharedFiles();
});

repoTabChannels?.addEventListener("click", () => {
  repoTabChannels.classList.add("is-active");
  repoTabFiles.classList.remove("is-active");
  repoTabChannels.setAttribute("aria-selected", "true");
  repoTabFiles.setAttribute("aria-selected", "false");
  repoChannelsView.classList.remove("hidden");
  repoFilesView.classList.add("hidden");
  refreshDirectory();
});

repoFileInput?.addEventListener("change", () => {
  const file = repoFileInput.files?.[0];
  repoFileInput.value = "";
  if (!file) return;
  if (!inActiveRoom()) {
    showToast("انضم إلى قناة أولاً لإضافة ملف إلى مستودعها.");
    return;
  }
  window.fileSharing?.shareFile(file, (result) => {
    if (result?.error) {
      showToast(result.error);
      return;
    }
    showToast(`أُضيف «${file.name}» إلى المستودع. يبقى الملف على جهازك.`);
  });
});

renderChatHistory([]);
renderSharedFiles();
updateChatBadge();
updateChatAvailability();
updateHandButton();
