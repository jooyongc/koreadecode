// Firebase Configuration
const firebaseConfig = {
    apiKey: "YOUR_API_KEY", // Replace with your actual API key
    authDomain: "koreadecode.firebaseapp.com",
    projectId: "koreadecode",
    storageBucket: "koreadecode.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
};

// Initialize Firebase for global scope
// This allows scripts loaded after this one to use the firebase objects
if (typeof firebase !== 'undefined') {
    const app = firebase.initializeApp(firebaseConfig);
    const auth = firebase.auth();
    const db = firebase.firestore();
    const storage = firebase.storage();
}
