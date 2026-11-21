// A small one-capture speech recognizer for 문장만들기 (the dialogue player keeps its own engine in app.js).
// Browser: Web Speech API en-US (continuous + interim; Chrome's self-ending sessions are restarted, keeping the text).
// Claude artifact: the `dictation` capability. app.js obtains it once and puts it in hub.dictation; while a
// 문장만들기 capture runs, hub.owner receives its events instead of the player.
import { tokenize } from "./core.js";

export const hub = { dictation: null, owner: null };
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const speechEngine = () => hub.dictation ? "dictation" : SR ? "native" : null;

// opts: bias() → Set of answer tokens (picks the best alternative), onUpdate({finalText, interim, parts}),
//       onEnd({text, parts, interim, dropped}), onError(code), onResume()
export function createRecognizer(opts) {
  let rec = null, listening = false, finished = true, stopReq = false, drop = false;
  let base = "", finalText = "", interim = "", parts = [], baseParts = 0;
  const emit = () => opts.onUpdate({ finalText, interim, parts: [...parts] });
  function done() {
    if (finished) return; finished = true; listening = false; hub.owner = null;
    opts.onEnd({ text: (finalText + " " + interim).trim(), parts: [...parts], interim, dropped: drop });
  }
  function nativeStart() {
    rec = new SR(); rec.lang = "en-US"; rec.interimResults = true; rec.continuous = true; rec.maxAlternatives = 3;
    rec.onresult = e => {
      const set = opts.bias ? opts.bias() : null;
      let fin = "", inter = ""; const ps = [];
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          let ba = r[0].transcript, bh = -1;
          if (set) for (let k = 0; k < r.length; k++) { const hit = tokenize(r[k].transcript).toks.filter(t => set.has(t.t)).length; if (hit > bh) { bh = hit; ba = r[k].transcript; } }
          fin += ba + " "; ps.push(ba);
        } else inter += r[0].transcript;
      }
      finalText = (base + " " + fin).trim(); interim = inter.trim(); parts = [...parts.slice(0, baseParts), ...ps]; emit();
    };
    rec.onerror = e => { if (e.error === "no-speech" || e.error === "aborted") return; stopReq = true; opts.onError && opts.onError(e.error); };
    rec.onend = () => {
      if (listening && !stopReq && !finished) {         // Chrome ended the session by itself: restart, keep the text
        if (interim) parts.push(interim);
        base = (finalText + " " + interim).trim(); finalText = base; interim = ""; baseParts = parts.length;
        try { nativeStart(); opts.onResume && opts.onResume(); return; } catch (err) {}
      }
      done();
    };
    rec.start();
  }
  return {
    get listening() { return listening; },
    start() {
      base = ""; finalText = ""; interim = ""; parts = []; baseParts = 0; finished = false; listening = true; stopReq = false; drop = false;
      const eng = speechEngine();
      if (eng === "dictation") {
        hub.owner = {
          partial: text => { if (listening) { interim = text || ""; emit(); } },
          final: text => { if (!listening) return; finalText = (finalText + " " + (text || "")).trim(); if (text) parts.push(text); interim = ""; emit(); },
          state: s => { if (s === "idle" && !finished) done(); },
        };
        return hub.dictation.start().catch(err => { const r = String(err && (err.code || err.message) || err); finished = true; listening = false; hub.owner = null; opts.onError && opts.onError(/not_granted/.test(r) ? "not-allowed" : r); });
      }
      if (eng === "native") { try { nativeStart(); } catch (e) { finished = true; listening = false; opts.onError && opts.onError("start"); } return; }
      finished = true; listening = false; opts.onError && opts.onError("unsupported");
    },
    stop(dropIt = false) {
      if (finished) return; stopReq = true; drop = dropIt;
      if (speechEngine() === "dictation") hub.dictation.stop().catch(() => {}).finally(done);
      else if (rec) { try { dropIt ? rec.abort() : rec.stop(); } catch (e) { done(); } }
      if (dropIt) done();
    },
  };
}
