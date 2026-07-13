/**
 * index.js — app entry point (Expo managed workflow, SDK 54+)
 *
 * SDK 54 removed `expo/AppEntry.js`; the standard replacement is a root
 * index.js that calls registerRootComponent directly. Behavior is
 * unchanged from the old AppEntry.js (which did the same two calls under
 * the hood): registerRootComponent also handles the createRoot/AppRegistry
 * wiring for both Expo Go and native builds.
 */
import { registerRootComponent } from 'expo';

import App from './App';

registerRootComponent(App);
