"use client"

import { initializeApp, getApps, type FirebaseApp } from "firebase/app"
import { getDatabase, type Database } from "firebase/database"
import { getAuth, initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, type Auth } from "firebase/auth"
import { Capacitor } from "@capacitor/core"

// Firebase project: snake-premium-e (Singapore RTDB, Spark/free plan)
// This config is public by design — it ships inside the app.
// Real security comes from the Realtime Database rules (see firebase-rules.json).
const firebaseConfig = {
  apiKey: "AIzaSyDZRVOKTjJ-rXhUVIUjqXpuAqdOMS0KDYk",
  authDomain: "snake-premium-e.firebaseapp.com",
  databaseURL: "https://snake-premium-e-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "snake-premium-e",
  storageBucket: "snake-premium-e.firebasestorage.app",
  messagingSenderId: "442557852028",
  appId: "1:442557852028:web:2d310f36bde725359bdcf9",
  measurementId: "G-9ZQP1N27YM",
}

let app: FirebaseApp
let db: Database
let auth: Auth

export function getFirebaseApp(): FirebaseApp {
  if (!app) app = getApps().length ? getApps()[0]! : initializeApp(firebaseConfig)
  return app
}

// Inside the Android WebView the default popup/redirect resolver does not work, so use plain persistence there.
export function getFirebaseAuth(): Auth {
  if (!auth) {
    const a = getFirebaseApp()
    auth = Capacitor.isNativePlatform()
      ? initializeAuth(a, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] })
      : getAuth(a)
  }
  return auth
}

// Lazy init so nothing touches Firebase during SSR/prerender.
export function getFirebaseDb(): Database {
  if (!db) {
    db = getDatabase(getFirebaseApp())
  }
  return db
}
