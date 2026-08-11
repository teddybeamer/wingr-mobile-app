/// <reference types="nativewind/types" />

// Metro transforms the global stylesheet through NativeWind at bundle time.
// This declaration lets TypeScript accept its side-effect import in App.tsx.
declare module "*.css";
