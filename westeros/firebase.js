import { initializeApp } from "https://www.gstatic.com/firebasejs/10.1.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.1.0/firebase-auth.js";
import { getDatabase, ref, get, set, onValue, push, remove } from "https://www.gstatic.com/firebasejs/10.1.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyAHZfys1YpBosbEeK30GG2aVLgG5CpV0DI",
  authDomain: "demonslayerranks.firebaseapp.com",
  databaseURL: "https://demonslayerranks-default-rtdb.europe-west1.firebasedatabase.app",
  storageBucket: "demonslayerranks.firebasestorage.app",
  projectId: "demonslayerranks",
  messagingSenderId: "244021550640",
  appId: "1:244021550640:web:4d2a3c7a52c205f5e997f5",
  measurementId: "G-WH3WQBKPX4"
};
const app = initializeApp(firebaseConfig, "westeros-card-collection");
const auth = getAuth(app);
const db = getDatabase(app);
const provider = new GoogleAuthProvider();
const path = (name) => ref(db, `westeros/${name}`);
const usernameEmail = (name) => `${name.toLowerCase()}@westeros.demonslayerranks.firebaseapp.com`;
const isRulesDenied = (error) => error?.code === "PERMISSION_DENIED" || /permission denied/i.test(error?.message || "");

window.gameFirebase = {
  auth,
  signInGoogle: () => signInWithPopup(auth, provider),
  signInPassword: (name, password) => signInWithEmailAndPassword(auth, usernameEmail(name), password),
  createPasswordAccount: (name, password) => createUserWithEmailAndPassword(auth, usernameEmail(name), password),
  signOut: () => signOut(auth),
  async getProfile(uid) { const snap = await get(path(`users/${uid}`)); return snap.exists() ? snap.val() : null; },
  async getProfiles() { try { const snap = await get(path("users")); return snap.exists() ? snap.val() : {}; } catch (error) { console.warn("Spielerliste derzeit nicht lesbar:", error.code || error.message); return {}; } },
  async getAdmins() { try { const snap = await get(path("admins")); return snap.exists() ? snap.val() : {}; } catch (error) { console.warn("Adminrollen derzeit nicht lesbar:", error.code || error.message); return {}; } },
  async getAdminLogs() { try { const snap = await get(path("adminLogs")); return snap.exists() ? snap.val() : {}; } catch (error) { console.warn("Adminprotokoll derzeit nicht lesbar:", error.code || error.message); return {}; } },
  logAdminAction(entry) { return push(path("adminLogs"), entry); },
  async isDeletedAccount(uid) { try { const snap = await get(path(`deletedAccounts/${uid}`)); return snap.exists() && snap.val() === true; } catch (error) { console.warn("Kontosperren derzeit nicht lesbar:", error.code || error.message); return false; } },
  async deleteGameProfile(uid) {
    try { await set(path(`deletedAccounts/${uid}`), true); }
    catch (error) { if (!isRulesDenied(error)) throw error; console.warn("Kontosperre konnte mit den aktuellen Regeln nicht gespeichert werden; entferne das Spielkonto trotzdem."); }
    await remove(path(`admins/${uid}`));
    await remove(path(`users/${uid}`));
  },
  saveProfile(uid, profile) { return set(path(`users/${uid}`), profile); },
  setAdmin(uid, role) { return set(path(`admins/${uid}`), role || null); },
  listenProfile(uid, callback) { return onValue(path(`users/${uid}`), (snap) => callback(snap.exists() ? snap.val() : null)); }
};

onAuthStateChanged(auth, (user) => {
  window.dispatchEvent(new CustomEvent("westeros-auth", { detail: user }));
});

