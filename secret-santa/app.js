(function () {
  "use strict";

  const CONFIG = window.SECRET_SANTA_CONFIG || {};
  const PEOPLE = window.SECRET_SANTA_PARTICIPANTS || [];
  const DATA = window.SECRET_SANTA_DATA;
  const enc = new TextEncoder();
  const $ = (id) => document.getElementById(id);

  // The recipient lives only in this closure, and only after the present is opened.
  let currentName = null;

  function normalizeEmail(email) {
    let [user, domain] = String(email).trim().toLowerCase().split("@");
    if (domain === "googlemail.com") domain = "gmail.com";
    if (domain === "gmail.com") user = user.split("+")[0].replace(/\./g, "");
    return user + "@" + domain;
  }

  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
  const sha256Hex = async (s) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));

  function decodeJwt(token) {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = new TextDecoder().decode(b64(part + "=".repeat((4 - (part.length % 4)) % 4)));
    return JSON.parse(json);
  }

  async function findPerson(email) {
    const h = await sha256Hex(normalizeEmail(email));
    return PEOPLE.find((p) => p.emailHashes.includes(h)) || null;
  }

  async function unwrap(giver) {
    const id = await sha256Hex(DATA.pepper + "|id|" + giver);
    const entry = DATA.entries[id];
    if (!entry) throw new Error("No assignment found for " + giver + ".");
    const base = await crypto.subtle.importKey("raw", enc.encode(DATA.pepper + ":" + giver), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt: b64(entry.salt), iterations: DATA.iterations },
      base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(entry.iv) }, key, b64(entry.ct));
    return new TextDecoder().decode(pt);
  }

  function show(section) {
    for (const id of ["signed-out", "signed-in", "error"]) $(id).hidden = id !== section;
  }

  function fail(msg) {
    currentName = null;
    $("error-msg").textContent = msg;
    show("error");
  }

  async function onCredential(response) {
    try {
      const claims = decodeJwt(response.credential);
      if (claims.aud !== CONFIG.googleClientId) return fail("That sign-in wasn't meant for this page.");
      if (claims.exp * 1000 < Date.now()) return fail("That sign-in expired. Please try again.");
      if (!claims.email_verified) return fail("Your Google email isn't verified yet.");
      const person = await findPerson(claims.email);
      if (!person) return fail(claims.email + " isn't on Santa's list. Try the email Travis has for you, or ask him to add this one.");
      currentName = person.name;
      $("who").textContent = person.name;
      $("gift").classList.remove("open");
      show("signed-in");
    } catch (e) {
      console.error(e);
      fail("Something went wrong signing in. Please try again.");
    }
  }

  function confetti() {
    const bits = ["❄️", "⭐", "🎄", "🎁", "✨", "🔔"];
    for (let i = 0; i < 40; i++) {
      const el = document.createElement("span");
      el.className = "confetti";
      el.textContent = bits[i % bits.length];
      el.style.left = Math.random() * 100 + "vw";
      el.style.animationDuration = 2 + Math.random() * 2.5 + "s";
      el.style.animationDelay = Math.random() * 0.6 + "s";
      document.body.appendChild(el);
      el.addEventListener("animationend", () => el.remove());
    }
  }

  async function openGift() {
    if (!currentName) return;
    $("gift").classList.add("open");
    try {
      const recipient = await unwrap(currentName);
      setTimeout(() => {
        $("recipient").textContent = recipient;
        $("modal").hidden = false;
        $("close").focus();
        confetti();
      }, 450);
    } catch (e) {
      console.error(e);
      fail("Couldn't unwrap your present. Tell Travis the elves tangled the ribbon.");
    }
  }

  function closeModal() {
    $("modal").hidden = true;
    $("recipient").textContent = "";
    $("gift").classList.remove("open");
  }

  function signOut() {
    currentName = null;
    closeModal();
    if (window.google && google.accounts) google.accounts.id.disableAutoSelect();
    show("signed-out");
  }

  function initGoogle() {
    if (!CONFIG.googleClientId || CONFIG.googleClientId.startsWith("REPLACE_ME")) {
      $("g-signin").textContent = "🛠️ Santa's workshop is still setting up. Check back soon!";
      return;
    }
    google.accounts.id.initialize({ client_id: CONFIG.googleClientId, callback: onCredential, auto_select: false });
    google.accounts.id.renderButton($("g-signin"), { theme: "filled_blue", size: "large", shape: "pill", text: "signin_with" });
  }

  function snow() {
    const c = $("snow");
    const ctx = c.getContext("2d");
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let flakes = [];
    function resize() {
      c.width = innerWidth * devicePixelRatio;
      c.height = innerHeight * devicePixelRatio;
      const n = Math.min(160, Math.floor(innerWidth / 8));
      flakes = Array.from({ length: n }, () => ({
        x: Math.random() * c.width, y: Math.random() * c.height,
        r: (1 + Math.random() * 3) * devicePixelRatio, s: 0.4 + Math.random() * 1.2, d: Math.random() * Math.PI * 2,
      }));
    }
    function tick() {
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.fillStyle = "rgba(255,255,255,.85)";
      for (const f of flakes) {
        f.y += f.s * devicePixelRatio;
        f.d += 0.01;
        f.x += Math.sin(f.d) * 0.5 * devicePixelRatio;
        if (f.y > c.height) { f.y = -f.r; f.x = Math.random() * c.width; }
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.fill();
      }
      requestAnimationFrame(tick);
    }
    addEventListener("resize", resize);
    resize();
    tick();
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("note").textContent = CONFIG.exchangeNote || "";
    $("gift").addEventListener("click", openGift);
    $("close").addEventListener("click", closeModal);
    $("signout").addEventListener("click", signOut);
    $("retry").addEventListener("click", signOut);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("modal").hidden) closeModal(); });
    if (!DATA) fail("The names haven't been drawn yet.");
    snow();
  });

  window.SecretSanta = { initGoogle, _onCredential: onCredential };
})();
