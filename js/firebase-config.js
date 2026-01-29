// Import the functions you need from the SDKs you need
import {
    initializeApp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
    getAuth
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
    getFirestore
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
    getStorage
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

// Your web app's Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyAcDLX8xujdFUOo8vVhxqE4URygfZDuCkY",
    authDomain: "koreadecode.firebaseapp.com",
    projectId: "koreadecode",
    storageBucket: "koreadecode.appspot.com",
    messagingSenderId: "525928843461",
    appId: "1:525928843461:web:c20f7822818404d30e88ac"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// Export the initialized services
export {
    app,
    auth,
    db,
    storage
};
