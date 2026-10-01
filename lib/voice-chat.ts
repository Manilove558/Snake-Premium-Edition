// lib/voice-chat.ts — WebRTC peer-to-peer voice chat for multiplayer rooms.
// Signaling + presence ride on the existing Firebase Realtime Database.
// No extra server, no extra cost. Audio flows directly between devices.
//
// Session model: ONE manager per (roomCode, playerId) lives in a module-level
// registry for the whole room session. The lobby's VoiceChat panel and the
// battle's compact mic button attach as LISTENERS to the same manager, so
// voice keeps flowing across lobby -> battle -> rematch transitions.
// The session is destroyed only when the player leaves the room (or the
// page unloads), never on component unmount.

import { getFirebaseDb } from "@/lib/firebase"
import {
  ref,
  set,
  update,
  remove,
  onValue,
  onDisconnect,
  push,
  serverTimestamp,
} from "firebase/database"

export type VoiceState = "off" | "starting" | "on" | "error"

export interface VoicePeer {
  id: string
  name: string
  muted: boolean
}

export interface VoiceEvents {
  onPeers: (peers: VoicePeer[]) => void
  onState: (s: VoiceState, err?: string) => void
  onMuted: (m: boolean) => void
}

interface SignalMsg {
  from: string
  to: string
  kind: "offer" | "answer" | "ice"
  payload: unknown
  at: number
}

const STUN = [{ urls: "stun:stun.l.google.com:19302" }]
// Free TURN relay (OpenRelay) as fallback: STUN-only peer-to-peer often fails
// on mobile carrier NATs (Jio/Airtel). TURN relays the audio when direct fails.
const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "turn:openrelay.metered.ca:80", username: "openrelay", credential: "openrelay" },
  { urls: "turn:openrelay.metered.ca:443", username: "openrelay", credential: "openrelay" },
] as RTCIceServer[]

export class VoiceChatManager {
  private stream: MediaStream | null = null
  private pcs = new Map<string, RTCPeerConnection>()
  private audioEls = new Map<string, HTMLAudioElement>()
  private unsubs: Array<() => void> = []
  private seenSignals = new Set<string>()
  private started = false
  private selfMuted = true

  // Multi-listener support (lobby panel + battle mic button share one manager)
  private listeners = new Map<number, VoiceEvents>()
  private nextListenerId = 1
  private lastState: VoiceState = "off"
  private lastErr: string | undefined
  private lastMuted = true
  private lastPeers: VoicePeer[] = []

  constructor(
    private code: string,
    private playerId: string,
    private playerName: string,
  ) {}

  /** Attach a UI listener; it immediately receives the current snapshot. */
  addListener(events: VoiceEvents): number {
    const id = this.nextListenerId++
    this.listeners.set(id, events)
    events.onState(this.lastState, this.lastErr)
    events.onMuted(this.lastMuted)
    events.onPeers([...this.lastPeers])
    return id
  }

  removeListener(id: number) {
    this.listeners.delete(id)
  }

  private emitState(s: VoiceState, err?: string) {
    this.lastState = s
    this.lastErr = err
    this.listeners.forEach((l) => l.onState(s, err))
  }

  private emitMuted(m: boolean) {
    this.lastMuted = m
    this.listeners.forEach((l) => l.onMuted(m))
  }

  private emitPeers(peers: VoicePeer[]) {
    this.lastPeers = peers
    this.listeners.forEach((l) => l.onPeers([...peers]))
  }

  private get db() {
    return getFirebaseDb()
  }
  private voiceRef() {
    return ref(this.db, `rooms/${this.code}/voice/${this.playerId}`)
  }
  private inboxRef() {
    return ref(this.db, `rooms/${this.code}/signals/${this.playerId}`)
  }

  /** Enable voice: ask for mic, announce presence, start signaling. */
  async start() {
    if (this.started) return
    this.started = true
    this.emitState("starting")
    // Mic needs a secure context (https / localhost / native app).
    // Plain http LAN pages are blocked by browsers — not a permission issue.
    if (typeof window !== "undefined" && !window.isSecureContext) {
      this.started = false
      this.emitState(
        "error",
        "Mic ke liye https chahiye — yeh http page par browser mic block kar deta hai. Voice chat Android app me test karo.",
      )
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      this.stream = stream
      this.selfMuted = true
      stream.getAudioTracks().forEach((t) => (t.enabled = false))
      this.emitMuted(true)

      // Announce presence (auto-removed on disconnect)
      await set(this.voiceRef(), {
        name: this.playerName,
        muted: true,
        joinedAt: serverTimestamp(),
      })
      onDisconnect(this.voiceRef()).remove()

      // Watch the roster
      const rosterRef = ref(this.db, `rooms/${this.code}/voice`)
      const offRoster = onValue(rosterRef, (snap) => {
        const peers: VoicePeer[] = []
        snap.forEach((c) => {
          if (c.key !== this.playerId) {
            const v = c.val() as { name?: string; muted?: boolean }
            peers.push({ id: c.key as string, name: v?.name ?? "Player", muted: !!v?.muted })
          }
        })
        this.emitPeers(peers)
        // Drop dead connections: a peer that left voice gets a stale PC.
        // Closing it forces a fresh negotiation when they rejoin, instead of
        // reusing a dead connection (the "worked once, then never again" bug).
        const alive = new Set(peers.map((p) => p.id))
        ;[...this.pcs.keys()].forEach((id) => {
          if (!alive.has(id)) this.closePeer(id)
        })
        // Connect to every peer (deterministic offerer: larger id offers)
        peers.forEach((p) => this.ensurePeer(p.id))
      })
      this.unsubs.push(offRoster)

      // Watch my signaling inbox
      const offInbox = onValue(this.inboxRef(), (snap) => {
        snap.forEach((c) => {
          const key = c.key as string
          if (this.seenSignals.has(key)) return
          this.seenSignals.add(key)
          const msg = c.val() as SignalMsg
          if (msg && msg.to === this.playerId) void this.handleSignal(msg)
        })
      })
      this.unsubs.push(offInbox)

      this.emitState("on")
    } catch (e) {
      this.started = false
      this.emitState("error", "Mic blocked hai — browser/app settings me microphone allow karo.")
    }
  }

  setMuted(m: boolean) {
    this.selfMuted = m
    this.stream?.getAudioTracks().forEach((t) => (t.enabled = !m))
    this.emitMuted(m)
    // User tapped: retry remote playback (helps if autoplay was blocked earlier)
    this.audioEls.forEach((el) => el.play().catch(() => {}))
    if (this.started) {
      update(this.voiceRef(), { muted: m }).catch(() => {})
    }
  }

  private async ensurePeer(peerId: string) {
    if (this.pcs.has(peerId) || !this.stream) return
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    this.pcs.set(peerId, pc)
    this.stream.getTracks().forEach((t) => pc.addTrack(t, this.stream as MediaStream))
    pc.ontrack = (e) => this.attachRemoteAudio(peerId, e.streams[0])
    pc.onicecandidate = (e) => {
      if (e.candidate) void this.sendSignal(peerId, "ice", e.candidate.toJSON())
    }
    // Deterministic offerer: larger playerId creates the offer (avoids glare)
    if (this.playerId > peerId) {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      await this.sendSignal(peerId, "offer", { type: offer.type, sdp: offer.sdp })
    }
  }

  private async handleSignal(msg: SignalMsg) {
    let pc = this.pcs.get(msg.from)
    if (!pc) {
      if (!this.stream) return
      pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
      this.pcs.set(msg.from, pc)
      this.stream.getTracks().forEach((t) => pc!.addTrack(t, this.stream as MediaStream))
      pc.ontrack = (e) => this.attachRemoteAudio(msg.from, e.streams[0])
      pc.onicecandidate = (e) => {
        if (e.candidate) void this.sendSignal(msg.from, "ice", e.candidate.toJSON())
      }
    }
    try {
      if (msg.kind === "offer") {
        const o = msg.payload as { type: RTCSdpType; sdp?: string }
        await pc.setRemoteDescription(new RTCSessionDescription(o))
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        await this.sendSignal(msg.from, "answer", { type: answer.type, sdp: answer.sdp })
      } else if (msg.kind === "answer") {
        const a = msg.payload as { type: RTCSdpType; sdp?: string }
        await pc.setRemoteDescription(new RTCSessionDescription(a))
      } else if (msg.kind === "ice") {
        await pc.addIceCandidate(new RTCIceCandidate(msg.payload as RTCIceCandidateInit))
      }
    } catch {
      // transient signaling hiccup — next renegotiation recovers
    }
  }

  private async sendSignal(to: string, kind: SignalMsg["kind"], payload: unknown) {
    try {
      await push(ref(this.db, `rooms/${this.code}/signals/${to}`), {
        from: this.playerId,
        to,
        kind,
        payload,
        at: serverTimestamp(),
      } as Omit<SignalMsg, "at"> & { at: unknown })
    } catch {}
  }

  private attachRemoteAudio(peerId: string, stream: MediaStream) {
    let el = this.audioEls.get(peerId)
    if (!el) {
      el = document.createElement("audio")
      el.autoplay = true
      // Remote voice should play through the speaker even in silent mode
      try {
        // @ts-expect-error — playsInline exists on HTMLAudioElement in browsers
        el.playsInline = true
      } catch {}
      document.body.appendChild(el)
      this.audioEls.set(peerId, el)
    }
    el.srcObject = stream
    el.play().catch(() => {})
  }

  private closePeer(peerId: string) {
    this.pcs.get(peerId)?.close()
    this.pcs.delete(peerId)
    const el = this.audioEls.get(peerId)
    if (el) {
      el.srcObject = null
      el.remove()
      this.audioEls.delete(peerId)
    }
  }

  /** Leave voice chat (stays in the room). Call destroyVoiceManager on room leave. */
  async stop() {
    this.unsubs.forEach((u) => u())
    this.unsubs = []
    ;[...this.pcs.keys()].forEach((id) => this.closePeer(id))
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.seenSignals.clear()
    try {
      await remove(this.voiceRef())
    } catch {}
    try {
      await remove(this.inboxRef())
    } catch {}
    this.started = false
    this.selfMuted = true
    this.emitMuted(true)
    this.emitPeers([])
    this.emitState("off")
  }
}

// ---------------------------------------------------------------------------
// Room-session registry: one VoiceChatManager per (roomCode, playerId).
// UI components attach/detach listeners; only room leave destroys the session.
// ---------------------------------------------------------------------------

const sessionManagers = new Map<string, VoiceChatManager>()

export function getVoiceManager(
  code: string,
  playerId: string,
  playerName: string,
  events: VoiceEvents,
): { mgr: VoiceChatManager; listenerId: number } {
  const key = `${code}:${playerId}`
  let mgr = sessionManagers.get(key)
  if (!mgr) {
    mgr = new VoiceChatManager(code, playerId, playerName)
    sessionManagers.set(key, mgr)
  }
  const listenerId = mgr.addListener(events)
  return { mgr, listenerId }
}

export function releaseVoiceListener(code: string, playerId: string, listenerId: number) {
  sessionManagers.get(`${code}:${playerId}`)?.removeListener(listenerId)
}

/** Call when the player leaves the room — ends voice for everyone locally. */
export function destroyVoiceManager(code: string, playerId: string) {
  const key = `${code}:${playerId}`
  const mgr = sessionManagers.get(key)
  if (mgr) {
    sessionManagers.delete(key)
    void mgr.stop()
  }
}
