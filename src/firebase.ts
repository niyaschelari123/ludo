import { getApp, getApps, initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: "AIzaSyAgT-qfqDMBVvjxvCoWP8Pr7jxQNbFAFVA",
  authDomain: "ludomine-51337.firebaseapp.com",
  projectId: "ludomine-51337",
  storageBucket: "ludomine-51337.firebasestorage.app",
  messagingSenderId: "892565098077",
  appId: "1:892565098077:web:8a84e868ad1a817b9f07b4"
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId,
)

const app = getApps().length ? getApp() : initializeApp(firebaseConfig)

export const auth = getAuth(app)
export const db = getFirestore(app)
