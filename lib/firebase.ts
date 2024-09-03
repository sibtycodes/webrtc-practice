// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import firebase from "firebase/compat/app";
import { addDoc, getFirestore} from "firebase/firestore";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCEHfdzUfc3rzMdxgAg-Wq4NJ4xrmp66_Q",
  authDomain: "videobrainboost.firebaseapp.com",
  projectId: "videobrainboost",
  storageBucket: "videobrainboost.appspot.com",
  messagingSenderId: "109103733717",
  appId: "1:109103733717:web:12b04cbc22d3ce94007b5c"
};

// Initialize Firebase
export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app)