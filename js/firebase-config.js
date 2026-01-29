// Declare global variables for Firebase services
var app, auth, db, storage;

// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyAcDLX8xujdFUOo8vVhxqE4URygfZDuCkY",
    authDomain: "koreadecode.firebaseapp.com",
    projectId: "koreadecode",
    storageBucket: "koreadecode.appspot.com",
    messagingSenderId: "525928843461",
    appId: "1:525928843461:web:c20f7822818404d30e88ac"
};

// Initialize Firebase for global scope
if (typeof firebase !== 'undefined') {
    app = firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db = firebase.firestore();
    storage = firebase.storage();
}
