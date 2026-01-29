// Firebase Configuration
// TODO: Replace with your actual Firebase project configuration
const firebaseConfig = {
    apiKey: "AIzaSyAcDLX8xujdFUOo8vVhxqE4URygfZDuCkY",
  authDomain: "koreadecode.firebaseapp.com",
  projectId: "koreadecode",
  storageBucket: "koreadecode.firebasestorage.app",
  messagingSenderId: "525928843461",
  appId: "1:525928843461:web:c20f7822818404d30e88ac",
  measurementId: "G-SE3SY5NJG9"
};

// Initialize Firebase
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, doc, getDoc, updateDoc, deleteDoc, serverTimestamp, query, orderBy, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

export { auth, db, storage, signInWithEmailAndPassword, onAuthStateChanged, signOut, collection, addDoc, getDocs, doc, getDoc, updateDoc, deleteDoc, serverTimestamp, query, orderBy, where, ref, uploadBytes, getDownloadURL };
