import { initializeApp } from "https://www.gstatic.com/firebasejs/10.1.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.1.0/firebase-auth.js";
import { getDatabase, ref, get, set, update, onValue, push, remove, runTransaction } from "https://www.gstatic.com/firebasejs/10.1.0/firebase-database.js";

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
const battlePlayer = (name, source) => { const deck = [...source]; for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; } return { name, hp: 2000, maxHp: 2000, deck: deck.slice(5), hand: deck.slice(0, 5), field: [], influence: 1, maxInfluence: 1, fatigue: 0 }; };
const usernameEmail = (name) => `${name.toLowerCase()}@westeros.demonslayerranks.firebaseapp.com`;
const isRulesDenied = (error) => error?.code === "PERMISSION_DENIED" || /permission denied/i.test(error?.message || "");
const offerPath = (sellerUid, cardId) => path(`marketOffers/${sellerUid}/${cardId}`);
const copyData = (value) => value == null ? value : JSON.parse(JSON.stringify(value));

async function settleReservedOffer(sellerUid, cardId, buyerUid, listing) {
  const soldAt = Date.now();
  const sold = { ...listing, status: "sold", buyerUid, soldAt };
  const payout = {
    sellerUid,
    sellerName: listing.sellerName || "Spieler",
    buyerUid,
    cardId,
    currency: listing.currency,
    amount: Number(listing.price),
    listingToken: listing.listingToken,
    createdAt: soldAt
  };
  const changes = {};
  changes[`westeros/marketOffers/${sellerUid}/${cardId}`] = sold;
  changes[`westeros/marketPayouts/${sellerUid}/${listing.listingToken}`] = payout;
  await update(ref(db), changes);
}

async function claimMarketPayouts(uid) {
  const payoutsSnap = await get(path(`marketPayouts/${uid}`));
  if (!payoutsSnap.exists()) return 0;
  let claimed = 0;
  for (const [token, payout] of Object.entries(payoutsSnap.val() || {})) {
    if (!payout || !["silver", "gold"].includes(payout.currency) || !(Number(payout.amount) > 0)) continue;
    const result = await runTransaction(path(`users/${uid}`), (current) => {
      if (!current) return;
      const next = copyData(current);
      next.marketClaims = next.marketClaims || {};
      if (next.marketClaims[token]) return next;
      next[payout.currency] = Math.min(100000000, (Number(next[payout.currency]) || 0) + Number(payout.amount));
      next.marketClaims[token] = true;
      if (next.marketListings?.[payout.cardId] === token) delete next.marketListings[payout.cardId];
      return next;
    }, { applyLocally: false });
    if (!result.committed) continue;
    await remove(path(`marketPayouts/${uid}/${token}`));
    claimed++;
  }
  return claimed;
}

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
  listenMarketOffers(callback, onError) {
    return onValue(path("marketOffers"), (snap) => callback(snap.exists() ? snap.val() : {}), onError);
  },
  listenMarketPayouts(uid, callback, onError) {
    return onValue(path(`marketPayouts/${uid}`), (snap) => callback(snap.exists() ? snap.val() : {}), onError);
  },
  async createMarketOffer(uid, offer) {
    const listingToken = crypto.randomUUID().replace(/-/g, "");
    const target = offerPath(uid, offer.cardId);
    const prepared = await runTransaction(target, (current) => {
      if (current && current.status !== "sold") return;
      return { ...offer, sellerUid: uid, listingToken, status: "preparing" };
    }, { applyLocally: false });
    if (!prepared.committed) throw new Error("MARKET_CARD_ALREADY_LISTED");

    const removed = await runTransaction(path(`users/${uid}`), (current) => {
      if (!current) return;
      const next = copyData(current);
      const count = Number(next.owned?.[offer.cardId]) || 0;
      if (count < 1) return;
      next.owned = next.owned || {};
      if (count === 1) delete next.owned[offer.cardId];
      else next.owned[offer.cardId] = count - 1;
      next.marketListings = next.marketListings || {};
      next.marketListings[offer.cardId] = listingToken;
      return next;
    }, { applyLocally: false });
    if (!removed.committed) {
      await remove(target);
      throw new Error("MARKET_CARD_NOT_OWNED");
    }

    try {
      await set(target, { ...prepared.snapshot.val(), status: "active" });
      return removed.snapshot.val();
    } catch (error) {
      await runTransaction(path(`users/${uid}`), (current) => {
        if (!current || current.marketListings?.[offer.cardId] !== listingToken) return;
        const next = copyData(current);
        next.owned = next.owned || {};
        next.owned[offer.cardId] = (Number(next.owned[offer.cardId]) || 0) + 1;
        delete next.marketListings[offer.cardId];
        return next;
      }, { applyLocally: false });
      await remove(target);
      throw error;
    }
  },
  async cancelMarketOffer(uid, cardId) {
    const target = offerPath(uid, cardId);
    const reserved = await runTransaction(target, (current) => {
      if (!current || current.sellerUid !== uid || current.status !== "active") return;
      return { ...current, status: "canceling" };
    }, { applyLocally: false });
    if (!reserved.committed) throw new Error("MARKET_OFFER_NOT_AVAILABLE");
    const listingToken = reserved.snapshot.val().listingToken;
    const restored = await runTransaction(path(`users/${uid}`), (current) => {
      if (!current || current.marketListings?.[cardId] !== listingToken) return;
      const next = copyData(current);
      next.owned = next.owned || {};
      next.owned[cardId] = (Number(next.owned[cardId]) || 0) + 1;
      delete next.marketListings[cardId];
      return next;
    }, { applyLocally: false });
    if (!restored.committed) {
      await runTransaction(target, (current) => current?.status === "canceling" ? { ...current, status: "active" } : current, { applyLocally: false });
      throw new Error("MARKET_CARD_RETURN_FAILED");
    }
    try {
      await remove(target);
    } catch (error) {
      await runTransaction(path(`users/${uid}`), (current) => {
        if (!current || current.marketListings?.[cardId]) return;
        const next = copyData(current);
        const count = Number(next.owned?.[cardId]) || 0;
        if (count <= 1) delete next.owned[cardId];
        else next.owned[cardId] = count - 1;
        next.marketListings = next.marketListings || {};
        next.marketListings[cardId] = listingToken;
        return next;
      }, { applyLocally: false });
      await runTransaction(target, (current) => current?.status === "canceling" ? { ...current, status: "active" } : current, { applyLocally: false });
      throw error;
    }
    return restored.snapshot.val();
  },
  async buyMarketOffer(buyerUid, sellerUid, cardId) {
    if (buyerUid === sellerUid) throw new Error("MARKET_CANNOT_BUY_OWN");
    const target = offerPath(sellerUid, cardId);
    const reserved = await runTransaction(target, (current) => {
      if (!current || current.status !== "active" || current.sellerUid !== sellerUid) return;
      return { ...current, status: "reserved", reservedBy: buyerUid, reservedAt: Date.now() };
    }, { applyLocally: false });
    if (!reserved.committed) throw new Error("MARKET_OFFER_ALREADY_SOLD");
    const listing = reserved.snapshot.val();
    const currency = listing.currency;
    const amount = Number(listing.price);
    const buyerUpdate = await runTransaction(path(`users/${buyerUid}`), (current) => {
      if (!current) return;
      const next = copyData(current);
      next.marketPurchases = next.marketPurchases || {};
      if (next.marketPurchases[listing.listingToken]) return next;
      if ((Number(next[currency]) || 0) < amount) return;
      next[currency] = Number(next[currency]) - amount;
      next.owned = next.owned || {};
      next.owned[cardId] = (Number(next.owned[cardId]) || 0) + 1;
      next.marketPurchases[listing.listingToken] = true;
      return next;
    }, { applyLocally: false });
    if (!buyerUpdate.committed) {
      await runTransaction(target, (current) => current?.status === "reserved" && current.reservedBy === buyerUid ? { ...current, status: "active", reservedBy: null, reservedAt: null } : current, { applyLocally: false });
      const buyer = await get(path(`users/${buyerUid}`));
      if (!buyer.exists()) throw new Error("MARKET_BUYER_PROFILE_MISSING");
      if ((Number(buyer.val()?.[currency]) || 0) < amount) throw new Error("MARKET_NOT_ENOUGH_CURRENCY");
      throw new Error("MARKET_PROFILE_UPDATE_FAILED");
    }
    try {
      await settleReservedOffer(sellerUid, cardId, buyerUid, listing);
      return buyerUpdate.snapshot.val();
    } catch (error) {
      const current = await get(target);
      if (current.val()?.status === "sold" && current.val()?.buyerUid === buyerUid) return buyerUpdate.snapshot.val();
      await runTransaction(path(`users/${buyerUid}`), (value) => {
        if (!value?.marketPurchases?.[listing.listingToken]) return;
        const next = copyData(value);
        next[currency] = Math.min(100000000, (Number(next[currency]) || 0) + amount);
        const count = Number(next.owned?.[cardId]) || 0;
        if (count <= 1) delete next.owned[cardId];
        else next.owned[cardId] = count - 1;
        delete next.marketPurchases[listing.listingToken];
        return next;
      }, { applyLocally: false });
      await runTransaction(target, (value) => value?.status === "reserved" && value.reservedBy === buyerUid ? { ...value, status: "active", reservedBy: null, reservedAt: null } : value, { applyLocally: false });
      throw error;
    }
  },
  async recoverMarket(uid) {
    const profileSnap = await get(path(`users/${uid}`));
    const currentProfile = profileSnap.val() || {};
    const offersSnap = await get(path("marketOffers"));
    const offers = offersSnap.val() || {};
    for (const [sellerUid, cards] of Object.entries(offers)) {
      for (const [cardId, offer] of Object.entries(cards || {})) {
        if (offer?.status === "preparing" && sellerUid === uid) {
          if (currentProfile.marketListings?.[cardId] === offer.listingToken) await set(offerPath(sellerUid, cardId), { ...offer, status: "active" });
          else await remove(offerPath(sellerUid, cardId));
        } else if (offer?.status === "canceling" && sellerUid === uid) {
          if (currentProfile.marketListings?.[cardId] === offer.listingToken) await set(offerPath(sellerUid, cardId), { ...offer, status: "active" });
          else await remove(offerPath(sellerUid, cardId));
        } else if (offer?.status === "reserved") {
          const expired = Date.now() - Number(offer.reservedAt || 0) > 120000;
          if (offer.reservedBy === uid && currentProfile.marketPurchases?.[offer.listingToken]) await settleReservedOffer(sellerUid, cardId, uid, offer);
          else if (expired) {
            const buyerProfile = offer.reservedBy === uid ? currentProfile : (await get(path(`users/${offer.reservedBy}`))).val() || {};
            if (!buyerProfile.marketPurchases?.[offer.listingToken]) await runTransaction(offerPath(sellerUid, cardId), (latest) => latest?.status === "reserved" && Date.now() - Number(latest.reservedAt || 0) > 120000 ? { ...latest, status: "active", reservedBy: null, reservedAt: null } : latest, { applyLocally: false });
          }
        }
      }
    }
    await claimMarketPayouts(uid);
  },
  logAdminAction(entry) { return push(path("adminLogs"), entry); },
  async isDeletedAccount(uid) { try { const snap = await get(path(`deletedAccounts/${uid}`)); return snap.exists() && snap.val() === true; } catch (error) { console.warn("Kontosperren derzeit nicht lesbar:", error.code || error.message); return false; } },
  async deleteGameProfile(uid) {
    try { await set(path(`deletedAccounts/${uid}`), true); }
    catch (error) { if (!isRulesDenied(error)) throw error; console.warn("Kontosperre konnte mit den aktuellen Regeln nicht gespeichert werden; entferne das Spielkonto trotzdem."); }
    await remove(path(`admins/${uid}`));
    await remove(path(`users/${uid}`));
    try {
      const offers = await get(path(`marketOffers/${uid}`));
      for (const cardId of Object.keys(offers.val() || {})) await remove(offerPath(uid, cardId));
      const payouts = await get(path(`marketPayouts/${uid}`));
      for (const token of Object.keys(payouts.val() || {})) await remove(path(`marketPayouts/${uid}/${token}`));
    } catch (error) {
      console.warn("Marktplatzdaten des entfernten Kontos konnten nicht bereinigt werden:", error.code || error.message);
    }
  },
  saveProfile(uid, profile) { return set(path(`users/${uid}`), profile); },
  claimMarketPayouts,
  setAdmin(uid, role) { return set(path(`admins/${uid}`), role || null); },
  listenProfile(uid, callback) { return onValue(path(`users/${uid}`), (snap) => callback(snap.exists() ? snap.val() : null)); },
  async joinBattleQueue(uid, name, deck) {
    const queuePath = path('battleQueue');
    const own = { uid, name, deck, status: 'waiting', joinedAt: Date.now() };
    const snap = await get(queuePath);
    const waiting = snap.exists() ? snap.val() : {};
    for (const [otherUid, candidate] of Object.entries(waiting)) {
      if (otherUid === uid || candidate?.status !== 'waiting' || !Array.isArray(candidate.deck) || candidate.deck.length !== 20) continue;
      const battleId = push(path('battles')).key;
      const claim = await runTransaction(path(`battleQueue/${otherUid}`), current => current?.status === 'waiting' ? { ...current, status: 'matched', battleId } : undefined, { applyLocally: false });
      if (!claim.committed) continue;
      const room = {
        players: {
          [otherUid]: battlePlayer(candidate.name || 'Spieler', candidate.deck),
          [uid]: battlePlayer(name, deck)
        },
        turn: otherUid, round: 1, log: ['Das Duell beginnt. 4.000 LP für jedes Haus.'], usedEffects: {}, createdAt: Date.now()
      };
      await set(path(`battles/${battleId}`), room);
      await set(path(`battleQueue/${uid}`), { ...own, status: 'matched', battleId });
      return { battleId };
    }
    await set(path(`battleQueue/${uid}`), own);
    return { waiting: true };
  },
  listenBattleQueue(uid, callback, onError) { return onValue(path(`battleQueue/${uid}`), snap => callback(snap.exists() ? snap.val() : null), onError); },
  listenBattle(battleId, callback, onError) { return onValue(path(`battles/${battleId}`), snap => callback(snap.exists() ? snap.val() : null), onError); },
  async updateBattle(battleId, uid, value) {
    const result = await runTransaction(path(`battles/${battleId}`), current => {
      if (!current?.players?.[uid] || current.winner) return;
      return value;
    }, { applyLocally: false });
    if (!result.committed) throw new Error('Dein Zug konnte nicht gespeichert werden.');
    return result.snapshot.val();
  },
  async leaveBattleQueue(uid) { return remove(path(`battleQueue/${uid}`)); },
};

onAuthStateChanged(auth, (user) => {
  window.dispatchEvent(new CustomEvent("westeros-auth", { detail: user }));
});

